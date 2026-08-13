import { callable, constSysfsExpr, Millennium } from '@steambrew/webkit';

const styles = constSysfsExpr('cs2-profile-stats.css', {
	basePath: '../static',
	encoding: 'utf8',
}).content;

const leetifyBadge = `data:image/png;base64,${
	constSysfsExpr('leetify-badge-white-small.png', {
		basePath: '../static',
		encoding: 'base64',
	}).content
}`;

type ProviderStatus = 'loading' | 'ok' | 'not_found' | 'private' | 'unauthorized' | 'rate_limited' | 'error';

type ProviderResponse<T> = {
	status: ProviderStatus;
	message?: string;
	data?: T;
	fetched_at?: number;
};

type LeetifyProfile = {
	name?: string;
	steam64_id: string;
	profile_id?: string;
	privacy_mode?: string;
	winrate?: number;
	total_matches?: number;
	first_match_date?: string;
	ranks: {
		premier?: number;
		faceit?: number;
		faceit_elo?: number;
		leetify?: number;
	};
	rating: {
		aim?: number;
		positioning?: number;
		utility?: number;
	};
	recent_matches: Array<{
		outcome?: string;
		map_name?: string;
		finished_at?: string;
	}>;
};

type FaceitProfile = {
	nickname?: string;
	country?: string;
	player_id?: string;
	level?: number;
	elo?: number;
	stats: {
		matches?: string;
		kd?: string;
		adr?: string;
		headshots?: string;
		winrate?: string;
		recent_results: string[];
	};
};

type SteamProfile = {
	status: ProviderStatus;
	message?: string;
	steamId: string;
	memberSince?: string;
	hours?: string;
	recentHours?: string;
};

type Preferences = {
	show_steam_details: boolean;
	expand_details: boolean;
};

type ViewState = {
	leetify: ProviderResponse<LeetifyProfile>;
	faceit: ProviderResponse<FaceitProfile>;
	steam: SteamProfile;
	preferences: Preferences;
	expanded: boolean;
};

const getLeetifyProfile = callable<[{ steamId: string }], string>('get_leetify_profile');
const getFaceitProfile = callable<[{ steamId: string }], string>('get_faceit_profile');
const getPreferences = callable<[], string>('get_preferences');

const isProfilePage = () =>
	window.location.hostname === 'steamcommunity.com' && /^\/(id|profiles)\/[^/]+\/?$/i.test(window.location.pathname);

const profileBaseUrl = () => {
	const url = new URL(window.location.href);
	url.search = '';
	url.hash = '';
	return url.href.replace(/\/$/, '');
};

function parseJson<T>(raw: string): T {
	return JSON.parse(raw) as T;
}

const escapeHtml = (value: unknown) =>
	String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');

const finiteNumber = (value: unknown): number | undefined => {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const formatInteger = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(parsed);
};

const formatMetric = (value: unknown, maximumFractionDigits = 1) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(parsed);
};

const formatLeetifyRating = (value: unknown) => {
	const parsed = finiteNumber(value);
	if (parsed === undefined) return '—';
	return `${parsed > 0 ? '+' : ''}${formatMetric(parsed, 2)}`;
};

const formatWinrate = (value: unknown) => {
	const parsed = finiteNumber(value);
	if (parsed === undefined) return '—';
	return `${formatMetric(parsed <= 1 ? parsed * 100 : parsed, 1)}%`;
};

const statusMessage = (provider: 'Leetify' | 'FACEIT', response: ProviderResponse<unknown>) => {
	if (response.status === 'loading') return `Loading ${provider}…`;
	if (response.status === 'not_found') return `${provider} profile not found.`;
	if (response.status === 'private') return `${provider} profile is private.`;
	if (response.status === 'rate_limited') return `${provider} rate limit reached.`;
	return response.message || `${provider} data is unavailable.`;
};

const metric = (label: string, value: string, modifier = '') => `
	<div class="cs2ps-metric ${modifier}">
		<span class="cs2ps-metric-label">${escapeHtml(label)}</span>
		<strong class="cs2ps-metric-value">${escapeHtml(value)}</strong>
	</div>
`;

const detailedMetric = (label: string, value: string) => `
	<div class="cs2ps-detail-metric">
		<span>${escapeHtml(label)}</span>
		<strong>${escapeHtml(value)}</strong>
	</div>
`;

const renderForm = (matches: LeetifyProfile['recent_matches'] | undefined) => {
	if (!matches?.length) return '<span class="cs2ps-form-empty">No recent matches</span>';

	return matches
		.slice(0, 5)
		.map((match) => {
			const outcome = match.outcome?.toLowerCase();
			const result = outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : '•';
			const title = [match.map_name?.replace(/^de_/, ''), match.finished_at ? new Date(match.finished_at).toLocaleDateString() : '']
				.filter(Boolean)
				.join(' · ');
			return `<span class="cs2ps-form-result cs2ps-form-${outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : 'unknown'}" title="${escapeHtml(title)}">${result}</span>`;
		})
		.join('');
};

const providerState = (provider: 'Leetify' | 'FACEIT', response: ProviderResponse<unknown>) => `
	<div class="cs2ps-provider-state cs2ps-provider-${escapeHtml(response.status)}">
		<span class="cs2ps-provider-dot"></span>
		<span>${escapeHtml(statusMessage(provider, response))}</span>
	</div>
`;

const renderDetails = (state: ViewState, steamId: string) => {
	const leetify = state.leetify.data;
	const faceit = state.faceit.data;
	const leetifyUrl = `https://leetify.com/app/profile/${encodeURIComponent(steamId)}`;
	const faceitUrl = faceit?.nickname ? `https://www.faceit.com/en/players/${encodeURIComponent(faceit.nickname)}` : undefined;
	const finderUrl = `https://faceit-finder.com/id/${encodeURIComponent(steamId)}?lang=en`;

	const leetifySection =
		state.leetify.status === 'ok' && leetify
			? `
				<section class="cs2ps-detail-section">
					<div class="cs2ps-detail-heading"><span>Leetify</span><a href="${leetifyUrl}" target="_blank" rel="noopener">View on Leetify ↗</a></div>
					<div class="cs2ps-detail-grid">
						${detailedMetric('Aim', formatMetric(leetify.rating.aim))}
						${detailedMetric('Positioning', formatMetric(leetify.rating.positioning))}
						${detailedMetric('Utility', formatMetric(leetify.rating.utility))}
					</div>
				</section>
			`
			: providerState('Leetify', state.leetify);

	const faceitSection =
		state.faceit.status === 'ok' && faceit
			? `
				<section class="cs2ps-detail-section">
					<div class="cs2ps-detail-heading"><span>FACEIT · ${escapeHtml(faceit.nickname || 'Player')}</span>${faceitUrl ? `<a href="${faceitUrl}" target="_blank" rel="noopener">View on FACEIT ↗</a>` : ''}</div>
					<div class="cs2ps-detail-grid cs2ps-detail-grid-five">
						${detailedMetric('K/D', faceit.stats.kd || '—')}
						${detailedMetric('ADR', faceit.stats.adr || '—')}
						${detailedMetric('HS', faceit.stats.headshots || '—')}
						${detailedMetric('Winrate', faceit.stats.winrate || '—')}
						${detailedMetric('Matches', faceit.stats.matches || '—')}
					</div>
					<a class="cs2ps-source-link" href="${finderUrl}" target="_blank" rel="noopener">FACEIT lookup via Faceit Finder ↗</a>
				</section>
			`
			: providerState('FACEIT', state.faceit);

	const steamSection = state.preferences.show_steam_details
		? `
			<section class="cs2ps-detail-section">
				<div class="cs2ps-detail-heading"><span>Steam</span></div>
				<div class="cs2ps-detail-grid">
					${detailedMetric('CS2 hours', state.steam.hours || 'Private')}
					${detailedMetric('Last 2 weeks', state.steam.recentHours || (state.steam.status === 'loading' ? 'Loading…' : 'Private'))}
					${detailedMetric('Member since', state.steam.memberSince || (state.steam.status === 'loading' ? 'Loading…' : 'Unknown'))}
				</div>
			</section>
		`
		: '';

	return `
		<div class="cs2ps-details" ${state.expanded ? '' : 'hidden'}>
			${leetifySection}
			${faceitSection}
			${steamSection}
			<a class="cs2ps-leetify-attribution" href="https://leetify.com/" target="_blank" rel="noopener">
				<img src="${leetifyBadge}" alt="Data Provided by Leetify">
			</a>
		</div>
	`;
};

const renderCard = (root: HTMLElement, state: ViewState, steamId: string) => {
	const leetify = state.leetify.data;
	const faceit = state.faceit.data;
	const faceitLevel = faceit?.level ?? leetify?.ranks.faceit;
	const faceitElo = faceit?.elo ?? leetify?.ranks.faceit_elo;
	const faceitValue = faceitLevel ? `LVL ${formatInteger(faceitLevel)}${faceitElo ? ` · ${formatInteger(faceitElo)}` : ''}` : '—';
	const isLoading = state.leetify.status === 'loading' || state.faceit.status === 'loading';

	root.innerHTML = `
		<div class="cs2ps-card ${state.expanded ? 'cs2ps-is-expanded' : ''}">
			<button class="cs2ps-header" type="button" aria-expanded="${state.expanded}">
				<span class="cs2ps-title"><span class="cs2ps-title-mark"></span>CS2 STATS</span>
				<span class="cs2ps-header-meta">${isLoading ? '<span class="cs2ps-spinner"></span>' : ''}<span>${state.expanded ? 'Hide' : 'Details'}</span><span class="cs2ps-chevron">⌄</span></span>
			</button>
			<div class="cs2ps-summary-grid">
				${metric('Premier', formatInteger(leetify?.ranks.premier), 'cs2ps-accent-premier')}
				${metric('FACEIT', faceitValue, 'cs2ps-accent-faceit')}
				${metric('Leetify Rating', formatLeetifyRating(leetify?.ranks.leetify), 'cs2ps-accent-leetify')}
				${metric('Aim', formatMetric(leetify?.rating.aim), 'cs2ps-accent-aim')}
				${metric('Winrate', formatWinrate(leetify?.winrate))}
				${metric('Matches', formatInteger(leetify?.total_matches))}
			</div>
			<div class="cs2ps-form-row">
				<span class="cs2ps-form-label">FORM</span>
				<div class="cs2ps-form">${renderForm(leetify?.recent_matches)}</div>
			</div>
			${renderDetails(state, steamId)}
		</div>
	`;

	root.querySelector<HTMLButtonElement>('.cs2ps-header')?.addEventListener('click', () => {
		state.expanded = !state.expanded;
		renderCard(root, state, steamId);
	});
};

const fetchSteamProfile = async (): Promise<SteamProfile> => {
	const baseUrl = profileBaseUrl();
	const parser = new DOMParser();
	const profileResponse = await fetch(`${baseUrl}?xml=1`, { credentials: 'same-origin' });
	if (!profileResponse.ok) throw new Error(`Steam profile returned HTTP ${profileResponse.status}.`);

	const profileXml = parser.parseFromString(await profileResponse.text(), 'application/xml');
	const steamId = profileXml.querySelector('steamID64')?.textContent || document.querySelector<HTMLInputElement>('input[name="abuseID"]')?.value || '';
	if (!/^\d{17}$/.test(steamId)) throw new Error('Could not determine SteamID64.');

	const result: SteamProfile = {
		status: 'ok',
		steamId,
		memberSince: profileXml.querySelector('memberSince')?.textContent || undefined,
	};

	try {
		const gamesResponse = await fetch(`${baseUrl}/games?tab=all&xml=1`, { credentials: 'same-origin' });
		if (gamesResponse.ok) {
			const gamesXml = parser.parseFromString(await gamesResponse.text(), 'application/xml');
			const cs2 = Array.from(gamesXml.querySelectorAll('game')).find((game) => game.querySelector('appID')?.textContent === '730');
			result.hours = cs2?.querySelector('hoursOnRecord')?.textContent || undefined;
			result.recentHours = cs2?.querySelector('hoursLast2Weeks')?.textContent || undefined;
		}
	} catch (error) {
		console.warn('[CS2 Profile Stats] Steam games are unavailable:', error);
	}

	return result;
};

const injectStyles = () => {
	if (document.getElementById('cs2-profile-stats-styles')) return;
	const style = document.createElement('style');
	style.id = 'cs2-profile-stats-styles';
	style.textContent = styles;
	document.head.appendChild(style);
};

export default async function WebkitMain() {
	if (!isProfilePage() || document.getElementById('cs2-profile-stats')) return;

	injectStyles();

	const rightColumns = await Millennium.findElement(document, '.profile_rightcol', 8_000);
	const rightColumn = rightColumns.item(0);
	if (!rightColumn) return;

	const root = document.createElement('div');
	root.id = 'cs2-profile-stats';
	root.className = 'cs2ps-root';
	rightColumn.insertBefore(root, rightColumn.children.item(1));

	const state: ViewState = {
		leetify: { status: 'loading' },
		faceit: { status: 'loading' },
		steam: { status: 'loading', steamId: '' },
		preferences: { show_steam_details: true, expand_details: false },
		expanded: false,
	};

	renderCard(root, state, '');

	try {
		state.preferences = parseJson<Preferences>(await getPreferences());
		state.expanded = state.preferences.expand_details;
	} catch (error) {
		console.warn('[CS2 Profile Stats] Could not load preferences:', error);
	}

	try {
		state.steam = await fetchSteamProfile();
	} catch (error) {
		const fallbackSteamId = document.querySelector<HTMLInputElement>('input[name="abuseID"]')?.value || '';
		state.steam = { status: 'error', steamId: fallbackSteamId, message: error instanceof Error ? error.message : String(error) };
	}

	const steamId = state.steam.steamId;
	if (!/^\d{17}$/.test(steamId)) {
		state.leetify = { status: 'error', message: 'SteamID64 is unavailable.' };
		state.faceit = { status: 'error', message: 'SteamID64 is unavailable.' };
		renderCard(root, state, steamId);
		return;
	}

	renderCard(root, state, steamId);

	void getLeetifyProfile({ steamId })
		.then((raw) => {
			state.leetify = parseJson<ProviderResponse<LeetifyProfile>>(raw);
		})
		.catch((error) => {
			state.leetify = { status: 'error', message: error instanceof Error ? error.message : String(error) };
		})
		.finally(() => renderCard(root, state, steamId));

	void getFaceitProfile({ steamId })
		.then((raw) => {
			state.faceit = parseJson<ProviderResponse<FaceitProfile>>(raw);
		})
		.catch((error) => {
			state.faceit = { status: 'error', message: error instanceof Error ? error.message : String(error) };
		})
		.finally(() => renderCard(root, state, steamId));
}
