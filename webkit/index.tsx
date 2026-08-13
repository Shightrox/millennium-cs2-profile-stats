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
		clutch?: number;
		opening?: number;
	};
	stats: {
		reaction_time_ms?: number;
		damage_time_min_ms?: number;
		damage_time_max_ms?: number;
		damage_time_source_url?: string;
		preaim?: number;
		spray_accuracy?: number;
		counter_strafing?: number;
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
	region?: string;
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

const PROVIDER_TIMEOUT_MS = 15_000;
const STEAM_TIMEOUT_MS = 8_000;

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

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
	new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				window.clearTimeout(timeoutId);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timeoutId);
				reject(error);
			},
		);
	});

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = STEAM_TIMEOUT_MS) => {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		window.clearTimeout(timeoutId);
	}
};

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

const formatMilliseconds = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : `${formatInteger(parsed)} ms`;
};

const formatSecondsRange = (minimum: unknown, maximum: unknown) => {
	const parsedMinimum = finiteNumber(minimum);
	const parsedMaximum = finiteNumber(maximum);
	if (parsedMinimum === undefined || parsedMaximum === undefined) return '—';
	return `${formatMetric(parsedMinimum / 1000, 2)}–${formatMetric(parsedMaximum / 1000, 2)} s`;
};

const formatPercent = (value: unknown) => {
	const parsed = finiteNumber(value);
	return parsed === undefined ? '—' : `${formatMetric(parsed, 1)}%`;
};

const statusMessage = (provider: 'Leetify' | 'FACEIT', response: ProviderResponse<unknown>) => {
	if (response.status === 'loading') return `Loading ${provider}…`;
	if (response.message) return response.message;
	if (response.status === 'not_found') return `${provider} profile not found.`;
	if (response.status === 'private') return `${provider} profile is private.`;
	if (response.status === 'rate_limited') return `${provider} rate limit reached.`;
	return `${provider} data is unavailable.`;
};

type MetricIcon = 'aim' | 'reaction' | 'winrate' | 'premier' | 'rating';

const metricIcon = (name: MetricIcon) => {
	const icons: Record<MetricIcon, string> = {
		aim: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><path d="M12 2v4M12 18v4M2 12h4M18 12h4"></path><circle cx="12" cy="12" r="1"></circle></svg>',
		reaction: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5.5 13h6L11 22l7.5-12h-6L13 2Z"></path></svg>',
		winrate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5 9 11l4 3 7-8"></path><path d="M15 6h5v5"></path></svg>',
		premier: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3Z"></path><path d="m9.5 12 1.7 1.7 3.6-4"></path></svg>',
		rating: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></svg>',
	};
	return icons[name];
};

const metric = (icon: MetricIcon, label: string, value: string, modifier = '') => `
	<div class="cs2ps-metric ${modifier}">
		<span class="cs2ps-metric-icon">${metricIcon(icon)}</span>
		<span class="cs2ps-metric-copy">
			<span class="cs2ps-metric-label">${escapeHtml(label)}</span>
			<strong class="cs2ps-metric-value">${escapeHtml(value)}</strong>
		</span>
	</div>
`;

const rankPill = (icon: 'premier' | 'rating', label: string, value: string, modifier: string) => `
	<div class="cs2ps-rank-pill ${modifier}">
		<span class="cs2ps-rank-icon">${metricIcon(icon)}</span>
		<span class="cs2ps-rank-label">${escapeHtml(label)}</span>
		<strong>${escapeHtml(value)}</strong>
	</div>
`;

const detailedMetric = (label: string, value: string) => `
	<div class="cs2ps-detail-metric">
		<span>${escapeHtml(label)}</span>
		<strong>${escapeHtml(value)}</strong>
	</div>
`;

const detailedRow = (label: string, value: string) => `
	<div class="cs2ps-detail-row">
		<span>${escapeHtml(label)}</span>
		<strong>${escapeHtml(value)}</strong>
	</div>
`;

const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';

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
	const hasFaceitLifetime = Boolean(
		faceit && [faceit.stats.kd, faceit.stats.adr, faceit.stats.headshots, faceit.stats.winrate, faceit.stats.matches].some(hasValue),
	);
	const hasScopeDamageTime = hasValue(leetify?.stats.damage_time_min_ms) && hasValue(leetify?.stats.damage_time_max_ms);

	const leetifySection =
		state.leetify.status === 'ok' && leetify
			? `
				<section class="cs2ps-detail-section">
					<div class="cs2ps-detail-heading"><span>Leetify</span><a href="${leetifyUrl}" target="_blank" rel="noopener">View on Leetify ↗</a></div>
					<div class="cs2ps-detail-grid">
						${detailedMetric('Premier', formatInteger(leetify.ranks.premier))}
						${detailedMetric('Leetify rating', formatLeetifyRating(leetify.ranks.leetify))}
						${detailedMetric('Matches', formatInteger(leetify.total_matches))}
						${detailedMetric('Aim', formatMetric(leetify.rating.aim))}
						${hasScopeDamageTime ? detailedMetric('AWP time to damage', formatSecondsRange(leetify.stats.damage_time_min_ms, leetify.stats.damage_time_max_ms)) : detailedMetric('Reaction time', formatMilliseconds(leetify.stats.reaction_time_ms))}
						${detailedMetric('Winrate', formatWinrate(leetify.winrate))}
						${detailedMetric('Positioning', formatMetric(leetify.rating.positioning))}
						${detailedMetric('Utility', formatMetric(leetify.rating.utility))}
						${detailedMetric('Preaim', formatMetric(leetify.stats.preaim))}
						${detailedMetric('Spray accuracy', formatPercent(leetify.stats.spray_accuracy))}
						${detailedMetric('Counter-strafing', formatPercent(leetify.stats.counter_strafing))}
						${detailedMetric('Opening', formatMetric(leetify.rating.opening, 2))}
					</div>
					${hasScopeDamageTime && leetify.stats.damage_time_source_url ? `<a class="cs2ps-source-link" href="${escapeHtml(leetify.stats.damage_time_source_url)}" target="_blank" rel="noopener">AWP timing provided by SCOPE.GG ↗</a>` : ''}
				</section>
			`
			: providerState('Leetify', state.leetify);

	const faceitSection =
		state.faceit.status === 'ok' && faceit
			? `
				<section class="cs2ps-detail-section">
					<div class="cs2ps-detail-heading"><span>FACEIT · ${escapeHtml(faceit.nickname || 'Player')}</span>${faceitUrl ? `<a href="${faceitUrl}" target="_blank" rel="noopener">View on FACEIT ↗</a>` : ''}</div>
					<div class="cs2ps-detail-grid">
						${detailedMetric('Level', formatInteger(faceit.level))}
						${detailedMetric('ELO', formatInteger(faceit.elo))}
						${detailedMetric('Region', (faceit.region || faceit.country || '—').toUpperCase())}
						${hasValue(faceit.stats.kd) ? detailedMetric('K/D', faceit.stats.kd!) : ''}
						${hasValue(faceit.stats.adr) ? detailedMetric('ADR', faceit.stats.adr!) : ''}
						${hasValue(faceit.stats.headshots) ? detailedMetric('HS', faceit.stats.headshots!) : ''}
						${hasValue(faceit.stats.winrate) ? detailedMetric('Winrate', faceit.stats.winrate!) : ''}
						${hasValue(faceit.stats.matches) ? detailedMetric('Matches', faceit.stats.matches!) : ''}
					</div>
					${!hasFaceitLifetime ? '<p class="cs2ps-detail-note">Lifetime statistics are unavailable from the public provider.</p>' : state.faceit.message ? `<p class="cs2ps-detail-note">${escapeHtml(state.faceit.message)}</p>` : ''}
				</section>
			`
			: providerState('FACEIT', state.faceit);

	const steamSection = state.preferences.show_steam_details
		? `
			<section class="cs2ps-detail-section">
				<div class="cs2ps-detail-heading"><span>Steam</span></div>
				<div class="cs2ps-detail-list">
					${detailedRow('CS2 hours', state.steam.hours || 'Private')}
					${detailedRow('Last 2 weeks', state.steam.recentHours || (state.steam.status === 'loading' ? 'Loading…' : 'Private'))}
					${detailedRow('Member since', state.steam.memberSince || (state.steam.status === 'loading' ? 'Loading…' : 'Unknown'))}
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
	const isLoading = state.leetify.status === 'loading' || state.faceit.status === 'loading';
	const hasPerformanceData = state.leetify.status === 'ok' && Boolean(leetify);
	const providersFinished = state.leetify.status !== 'loading' && state.faceit.status !== 'loading';
	const faceitFound = state.faceit.status === 'ok' || Boolean(faceit?.level) || Boolean(leetify?.ranks.faceit);
	const hasScopeDamageTime = hasValue(leetify?.stats.damage_time_min_ms) && hasValue(leetify?.stats.damage_time_max_ms);
	const reactionLabel = hasScopeDamageTime ? 'AWP reaction' : 'Reaction';
	const reactionValue = hasScopeDamageTime
		? formatSecondsRange(leetify?.stats.damage_time_min_ms, leetify?.stats.damage_time_max_ms)
		: formatMilliseconds(leetify?.stats.reaction_time_ms);
	const faceitStatus = faceitFound
		? { modifier: 'cs2ps-faceit-found', text: 'FACEIT account found' }
		: !providersFinished
			? { modifier: 'cs2ps-faceit-loading', text: 'Checking FACEIT account…' }
			: state.faceit.status === 'not_found'
				? { modifier: 'cs2ps-faceit-missing', text: 'No FACEIT account' }
				: { modifier: 'cs2ps-faceit-unknown', text: 'FACEIT status unavailable' };
	const emptyMessage =
		state.leetify.status === 'not_found'
			? 'Leetify has no public matches for this Steam account.'
			: state.leetify.status === 'private'
				? 'This player’s Leetify profile is private.'
				: statusMessage('Leetify', state.leetify);
	const performanceSummary = providersFinished && !hasPerformanceData
		? `
			<div class="cs2ps-empty-state">
				<span class="cs2ps-empty-icon">${metricIcon('aim')}</span>
				<span class="cs2ps-empty-copy">
					<strong>No tracked CS2 performance data</strong>
					<span>${escapeHtml(emptyMessage)}</span>
					${state.steam.hours ? `<small>Steam playtime: ${escapeHtml(state.steam.hours)} h</small>` : ''}
				</span>
			</div>
		`
		: `
			<div class="cs2ps-rank-row">
				${rankPill('premier', 'Premier', formatInteger(leetify?.ranks.premier), 'cs2ps-rank-premier')}
				${rankPill('rating', 'Leetify', formatLeetifyRating(leetify?.ranks.leetify), 'cs2ps-rank-leetify')}
			</div>
			<div class="cs2ps-summary-grid">
				${metric('aim', 'Aim', formatMetric(leetify?.rating.aim), 'cs2ps-accent-aim')}
				${metric('reaction', reactionLabel, reactionValue, 'cs2ps-accent-reaction')}
				${metric('winrate', 'Winrate', formatWinrate(leetify?.winrate), 'cs2ps-accent-winrate')}
			</div>
			<div class="cs2ps-form-row">
				<span class="cs2ps-form-label">FORM</span>
				<div class="cs2ps-form">${renderForm(leetify?.recent_matches)}</div>
			</div>
		`;

	root.innerHTML = `
		<div class="cs2ps-card ${state.expanded ? 'cs2ps-is-expanded' : ''}">
			<button class="cs2ps-header" type="button" aria-expanded="${state.expanded}">
				<span class="cs2ps-title"><span class="cs2ps-title-mark">${metricIcon('aim')}</span><span>CS2 PERFORMANCE</span></span>
				<span class="cs2ps-header-meta">${isLoading ? '<span class="cs2ps-spinner"></span>' : ''}<span>${state.expanded ? 'Hide' : 'Details'}</span><span class="cs2ps-chevron">⌄</span></span>
			</button>
			${performanceSummary}
			<div class="cs2ps-faceit-status ${faceitStatus.modifier}">
				<span class="cs2ps-faceit-mark">F</span>
				<span>${faceitStatus.text}</span>
				${faceitFound ? '<span class="cs2ps-faceit-check">✓</span>' : ''}
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
	const profileResponse = await fetchWithTimeout(`${baseUrl}?xml=1`, { credentials: 'same-origin' });
	if (!profileResponse.ok) throw new Error(`Steam profile returned HTTP ${profileResponse.status}.`);

	const profileXml = parser.parseFromString(await profileResponse.text(), 'application/xml');
	const steamId = profileXml.querySelector('steamID64')?.textContent || document.querySelector<HTMLInputElement>('input[name="abuseID"]')?.value || '';
	if (!/^\d{17}$/.test(steamId)) throw new Error('Could not determine SteamID64.');

	return {
		status: 'ok',
		steamId,
		memberSince: profileXml.querySelector('memberSince')?.textContent || undefined,
	};
};

const fetchSteamPlaytime = async (): Promise<Pick<SteamProfile, 'hours' | 'recentHours'>> => {
	const parser = new DOMParser();
	const gamesResponse = await fetchWithTimeout(`${profileBaseUrl()}/games?tab=all&xml=1`, { credentials: 'same-origin' }, 6_000);
	if (!gamesResponse.ok) return {};

	const gamesXml = parser.parseFromString(await gamesResponse.text(), 'application/xml');
	const cs2 = Array.from(gamesXml.querySelectorAll('game')).find((game) => game.querySelector('appID')?.textContent === '730');
	return {
		hours: cs2?.querySelector('hoursOnRecord')?.textContent || undefined,
		recentHours: cs2?.querySelector('hoursLast2Weeks')?.textContent || undefined,
	};
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

	void fetchSteamPlaytime()
		.then((playtime) => {
			state.steam = { ...state.steam, ...playtime };
		})
		.catch((error) => {
			console.warn('[CS2 Profile Stats] Steam games are unavailable:', error);
		})
		.finally(() => renderCard(root, state, steamId));

	void withTimeout(getLeetifyProfile({ steamId }), PROVIDER_TIMEOUT_MS, 'Leetify request timed out.')
		.then((raw) => {
			state.leetify = parseJson<ProviderResponse<LeetifyProfile>>(raw);
		})
		.catch((error) => {
			state.leetify = { status: 'error', message: error instanceof Error ? error.message : String(error) };
		})
		.finally(() => renderCard(root, state, steamId));

	void withTimeout(getFaceitProfile({ steamId }), PROVIDER_TIMEOUT_MS, 'FACEIT request timed out.')
		.then((raw) => {
			state.faceit = parseJson<ProviderResponse<FaceitProfile>>(raw);
		})
		.catch((error) => {
			state.faceit = { status: 'error', message: error instanceof Error ? error.message : String(error) };
		})
		.finally(() => renderCard(root, state, steamId));
}
