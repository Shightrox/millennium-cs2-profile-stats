# CS2 Profile Stats for Millennium

A compact CS2 statistics card embedded directly into Steam Community profile pages. It combines the most useful public Leetify, FACEIT, and Steam metrics without sending the user to a separate stats site.

> Early development version. Steam's profile markup and third-party data sources can change, so expect rough edges while the first release is being tested.

## Current features

- Current Premier rating
- FACEIT level and ELO
- Leetify Rating, Aim, Positioning, and Utility
- Leetify winrate, match count, and recent form
- FACEIT lifetime K/D, ADR, HS%, winrate, and match count
- Public Steam CS2 hours, recent hours, and account creation date
- Compact and expanded layouts
- Independent provider loading: one unavailable source does not hide the others
- Works without mandatory API keys

The card is inserted into the right-hand column of Steam profiles, below the current online/offline status.

## Data sources

- [Leetify Public CS API](https://api-public-docs.cs-prod.leetify.com/) for Leetify and Premier metrics. A Leetify developer key is optional and only improves rate limits. If that API does not index an otherwise public legacy profile, the plugin falls back to the keyless profile endpoint used by Leetify's web client.
- [SCOPE.GG](https://scope.gg/) public player pages for an AWP time-to-damage range when that metric is absent from a legacy Leetify profile.
- [Faceit Finder](https://faceit-finder.com/) for zero-configuration Steam-to-FACEIT lookup and public FACEIT statistics.
- Steam Community's public profile XML for SteamID64, account age, and public playtime.

Leetify may expose fewer detailed metrics for unregistered players; the summary ratings and recent matches remain available when Leetify has tracked them. Private Steam game details prevent playtime from being displayed.

FACEIT integration is isolated behind its own provider because the zero-configuration lookup is not an official, versioned FACEIT API. If that source changes, Leetify and Steam data continue to work.

Leetify data is displayed according to the [Leetify API Developer Guidelines](https://leetify.com/blog/leetify-api-developer-guidelines/). The plugin does not persist player statistics.

## Requirements

- [Millennium](https://steambrew.app/) 3.x
- Steam desktop client

For development:

- Node.js
- pnpm

## Development

```powershell
pnpm install
pnpm typecheck
pnpm build
```

Build artifacts are generated in `.millennium/Dist`.

For local testing, place the repository in Millennium's plugin directory or create a directory junction/symbolic link:

```powershell
New-Item -ItemType Junction `
  -Path '<Steam>\millennium\plugins\cs2-profile-stats' `
  -Target '<repository path>'
```

Restart Steam, enable **CS2 Profile Stats** under **Millennium → Plugins**, save the changes, and restart Steam once more. Backend changes require a full Steam restart.

## Project structure

- `backend/main.lua` — HTTP providers, configuration, and normalized IPC responses
- `webkit/index.tsx` — Steam profile detection and card rendering
- `frontend/index.tsx` — Millennium plugin settings
- `static/` — scoped stylesheet and required attribution assets

## Privacy

The plugin reads the public SteamID64 of the profile being viewed and requests public gameplay statistics from the services listed above. It does not collect telemetry, use analytics, or permanently store player statistics.

## License

[MIT](LICENSE)
