local cjson = require("json")
local http = require("http")
local logger = require("logger")
local millennium = require("millennium")

local PLUGIN_VERSION = "0.2.1"
local USER_AGENT = "millennium-cs2-profile-stats/" .. PLUGIN_VERSION

local function encode(payload)
    local ok, result = pcall(cjson.encode, payload)
    if ok then
        return result
    end

    logger:error("Failed to encode an IPC response: " .. tostring(result))
    return [[{"status":"error","message":"Could not encode provider response."}]]
end

local function is_null(value)
    return value == nil or value == cjson.null
end

local function optional(value)
    if is_null(value) then
        return nil
    end

    return value
end

local function trimmed_config(key)
    local value = millennium.config.get(key)
    if type(value) ~= "string" then
        return nil
    end

    value = value:match("^%s*(.-)%s*$")
    if value == "" then
        return nil
    end

    return value
end

local function valid_steam_id(steam_id)
    return type(steam_id) == "string" and steam_id:match("^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$") ~= nil
end

local function request_json(url, headers)
    local response, request_error = http.get(url, {
        headers = headers,
        timeout = 10,
        follow_redirects = true,
        verify_ssl = true,
        user_agent = USER_AGENT,
    })

    if response == nil then
        return nil, 0, request_error or "Network request failed."
    end

    if response.status < 200 or response.status >= 300 then
        return nil, response.status, "HTTP " .. tostring(response.status)
    end

    local ok, data = pcall(cjson.decode, response.body)
    if not ok or type(data) ~= "table" then
        return nil, response.status, "Invalid JSON response."
    end

    return data, response.status, nil
end

local function post_json(url, body, headers)
    -- Millennium 3.4.0's http.post wrapper loses its generated options table and
    -- performs a GET. The generic request entry point sends the POST correctly.
    local response, request_error = http.request(url, {
        method = "POST",
        data = body,
        headers = headers,
        timeout = 10,
        follow_redirects = true,
        verify_ssl = true,
        user_agent = USER_AGENT,
    })

    if response == nil then
        return nil, 0, request_error or "Network request failed."
    end

    if response.status < 200 or response.status >= 300 then
        return nil, response.status, "HTTP " .. tostring(response.status)
    end

    local ok, data = pcall(cjson.decode, response.body)
    if not ok or type(data) ~= "table" then
        return nil, response.status, "Invalid JSON response."
    end

    return data, response.status, nil
end

local function error_status(http_status)
    if http_status == 401 or http_status == 403 then
        return "unauthorized"
    elseif http_status == 404 then
        return "not_found"
    elseif http_status == 429 then
        return "rate_limited"
    end

    return "error"
end

local function provider_error(provider, http_status, message)
    logger:warn(provider .. " request failed (" .. tostring(http_status) .. "): " .. tostring(message))
    return encode({
        status = error_status(http_status),
        message = message or "Provider request failed.",
    })
end

function get_preferences()
    return encode({
        show_steam_details = millennium.config.get("show_steam_details") ~= false,
        expand_details = millennium.config.get("expand_details") == true,
    })
end

function get_leetify_profile(steamId)
    if not valid_steam_id(steamId) then
        return encode({ status = "error", message = "Invalid SteamID64." })
    end

    local headers = { ["Accept"] = "application/json" }
    local api_key = trimmed_config("leetify_api_key")
    if api_key ~= nil then
        headers["_leetify_key"] = api_key
    end

    local url = "https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=" .. steamId
    local profile, status, request_error = request_json(url, headers)
    if profile == nil then
        return provider_error("Leetify", status, request_error)
    end

    if profile.privacy_mode ~= nil and profile.privacy_mode ~= cjson.null and profile.privacy_mode ~= "public" then
        return encode({ status = "private", message = "This Leetify profile is private." })
    end

    local ranks = type(profile.ranks) == "table" and profile.ranks or {}
    local rating = type(profile.rating) == "table" and profile.rating or {}
    local stats = type(profile.stats) == "table" and profile.stats or {}
    local recent_matches = {}

    if type(profile.recent_matches) == "table" then
        for index = 1, math.min(#profile.recent_matches, 5) do
            local match = profile.recent_matches[index]
            if type(match) == "table" then
                recent_matches[#recent_matches + 1] = {
                    outcome = optional(match.outcome),
                    map_name = optional(match.map_name),
                    finished_at = optional(match.finished_at),
                }
            end
        end
    end

    return encode({
        status = "ok",
        data = {
            name = optional(profile.name),
            steam64_id = steamId,
            profile_id = optional(profile.id),
            privacy_mode = optional(profile.privacy_mode),
            winrate = optional(profile.winrate),
            total_matches = optional(profile.total_matches),
            first_match_date = optional(profile.first_match_date),
            ranks = {
                premier = optional(ranks.premier),
                faceit = optional(ranks.faceit),
                faceit_elo = optional(ranks.faceit_elo),
                leetify = optional(ranks.leetify),
            },
            rating = {
                aim = optional(rating.aim),
                positioning = optional(rating.positioning),
                utility = optional(rating.utility),
                clutch = optional(rating.clutch),
                opening = optional(rating.opening),
            },
            stats = {
                reaction_time_ms = optional(stats.reaction_time_ms),
                preaim = optional(stats.preaim),
                spray_accuracy = optional(stats.spray_accuracy),
                counter_strafing = optional(stats.counter_strafing_good_shots_ratio),
            },
            recent_matches = recent_matches,
        },
        fetched_at = os.time(),
    })
end

local function faceit_lifetime_map(payload)
    if type(payload) ~= "table" then
        return {}
    end

    local lifetime = payload.lifetime or payload.lifetime_stats
    if type(lifetime) ~= "table" and type(payload.payload) == "table" then
        lifetime = payload.payload.lifetime or payload.payload.lifetime_stats
    end
    if type(lifetime) ~= "table" then
        return {}
    end

    local result = {}
    for key, value in pairs(lifetime) do
        if type(key) == "string" then
            result[key] = value
        elseif type(value) == "table" and type(value.key) == "string" then
            result[value.key] = optional(value.value)
        end
    end
    return result
end

local function first_lifetime_value(lifetime, keys)
    for _, key in ipairs(keys) do
        local value = optional(lifetime[key])
        if value ~= nil and tostring(value) ~= "" then
            return value
        end
    end
    return nil
end

function get_faceit_profile(steamId)
    if not valid_steam_id(steamId) then
        return encode({ status = "error", message = "Invalid SteamID64." })
    end

    local headers = {
        ["Accept"] = "application/json",
        ["Content-Type"] = "application/json",
    }
    local lookup_body = cjson.encode({
        steamUrl = "https://steamcommunity.com/profiles/" .. steamId,
    })
    local player, player_status, player_error = post_json("https://faceit-finder.com/api/search/steam", lookup_body, headers)
    if player == nil then
        return provider_error("FACEIT lookup", player_status, player_error)
    end

    local cs2 = type(player.games) == "table" and player.games.cs2 or nil
    if type(cs2) ~= "table" or is_null(player.player_id) then
        return encode({
            status = "not_found",
            message = "FACEIT lookup returned no CS2 account (HTTP " .. tostring(player_status) .. ").",
        })
    end

    local lifetime = {}
    local stats_api_url = "https://api.faceit.com/stats/v1/stats/users/" .. tostring(player.player_id) .. "/games/cs2"
    local stats_payload, stats_status, stats_error = request_json(stats_api_url, {
        ["Accept"] = "application/json",
        ["Origin"] = "https://www.faceit.com",
        ["Referer"] = "https://www.faceit.com/",
    })

    if stats_payload ~= nil then
        lifetime = faceit_lifetime_map(stats_payload)
    end

    local stats_response = nil
    local html_error = nil
    local partial_message = nil

    if next(lifetime) == nil then
        local stats_url = "https://faceit-finder.com/id/" .. steamId .. "?lang=en"
        stats_response, html_error = http.get(stats_url, {
            headers = { ["Accept"] = "text/html" },
            timeout = 12,
            follow_redirects = true,
            verify_ssl = true,
            user_agent = USER_AGENT,
        })

        if stats_response ~= nil and stats_response.status == 200 then
            local hero = stats_response.body:match("Kluczowe liczby.-ELO Rating") or stats_response.body:match("Key numbers.-ELO Rating") or stats_response.body
            lifetime.matches = hero:match(">Matches</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.winrate = hero:match(">Win Rate</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.kd = hero:match(">K/D</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.adr = hero:match(">ADR</p>%s*<p[^>]*>([^<]+)</p>")
            lifetime.headshots = hero:match(">HS %%</p>%s*<p[^>]*>([^<]+)</p>")
        end
    end

    if next(lifetime) == nil then
        partial_message = "FACEIT profile loaded, but lifetime statistics are unavailable."
        local html_status = stats_response and stats_response.status or 0
        logger:warn("FACEIT lifetime stats unavailable (API " .. tostring(stats_status) .. ", HTML " .. tostring(html_status) .. "): " .. tostring(stats_error or html_error))
    end

    return encode({
        status = "ok",
        message = partial_message,
        data = {
            nickname = optional(player.nickname),
            country = optional(player.country),
            player_id = optional(player.player_id),
            level = optional(cs2.skill_level),
            elo = optional(cs2.faceit_elo),
            region = optional(cs2.region),
            stats = {
                matches = optional(lifetime.matches) or first_lifetime_value(lifetime, { "Matches", "matches" }),
                kd = optional(lifetime.kd) or first_lifetime_value(lifetime, { "Average K/D Ratio", "K/D Ratio", "K/D", "kd" }),
                adr = optional(lifetime.adr) or first_lifetime_value(lifetime, { "ADR", "Average Damage Per Round", "adr" }),
                headshots = optional(lifetime.headshots) or first_lifetime_value(lifetime, { "Average Headshots %", "Headshots %", "HS %", "headshots" }),
                winrate = optional(lifetime.winrate) or first_lifetime_value(lifetime, { "Win Rate %", "Winrate", "winrate" }),
                recent_results = {},
            },
        },
        fetched_at = os.time(),
    })
end

local function set_default(key, value)
    if millennium.config.get(key) == nil then
        millennium.config.set(key, value)
    end
end

local function on_load()
    logger:info("Loading CS2 Profile Stats v" .. PLUGIN_VERSION .. " on Millennium " .. millennium.version())
    set_default("show_steam_details", true)
    set_default("expand_details", false)
    millennium.ready()
end

local function on_unload()
    logger:info("Unloading CS2 Profile Stats")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
