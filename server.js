const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
// Load .env from project dir first, fallback to home dir (survives xCloud deploys)
const envLocal = path.join(__dirname, '.env');
const envHome = path.join(require('os').homedir(), '.env');
require('dotenv').config({ path: fs.existsSync(envLocal) ? envLocal : envHome });

const PORT = process.env.PORT || 3020;
// Store data in home dir so it persists across xCloud deploys
const DATA_DIR = path.join(require('os').homedir(), 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ======================== CONFIG ========================

const CONFIG = {
    TRAKT_USERNAME: process.env.TRAKT_USERNAME,
    TRAKT_LIST_SLUG: process.env.TRAKT_LIST_SLUG,
    TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    CRON_SCHEDULE: process.env.CRON_SCHEDULE || '0 */6 * * *' // every 6 hours
};

// ======================== TRAKT API ========================

// No OAuth: the list is public, so the Client ID alone reads it. (Trakt removed
// legacy apps in 2026 and new apps get no client secret, which killed token refresh.)
const TRAKT_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'SitcomShuffle/24.0 (+https://github.com/Shesek11/stremio-sitcom-shuffle)',
    'trakt-api-version': '2',
    'trakt-api-key': CONFIG.TRAKT_CLIENT_ID
};

async function traktGet(url) {
    const response = await fetch(url, { headers: TRAKT_HEADERS });
    if (!response.ok) throw new Error(`Trakt API error: ${response.status} ${response.statusText}`);
    return response;
}

async function traktFetch(url) {
    return (await traktGet(url)).json();
}

async function traktFetchPaginated(url) {
    const allItems = [];
    const separator = url.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
        const response = await traktGet(`${url}${separator}page=${page}&limit=100`);
        const items = await response.json();
        allItems.push(...items);
        const totalPages = parseInt(response.headers.get('x-pagination-page-count') || '1');
        console.log(`Trakt pagination: page ${page}/${totalPages}, got ${items.length} items`);
        if (page >= totalPages || items.length === 0) return allItems;
    }
}

// Trakt/TMDB are missing IMDB ids for some Israeli shows even when IMDB has
// them; without an imdb id the catalog filters the show out entirely.
const IMDB_OVERRIDES = {
    'haverot-2013': 'tt3046098',
    '2015-217906': 'tt4792146' // Prudim (פרודים)
};

// Posters for shows TMDB has no artwork for (taken from IMDB).
const POSTER_OVERRIDES = {
    '2015-217906': 'https://m.media-amazon.com/images/M/MV5BZGUxNjlmYTItZTM1MS00ZTllLWI1NDYtOTJhOWMxMWY0YmZjXkEyXkFqcGc@._V1_SX500.jpg'
};

async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME.toLowerCase()}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows`;
    const items = await traktFetchPaginated(url);
    return items.map(item => {
        const show = item.show;
        if (!show.ids.imdb && IMDB_OVERRIDES[show.ids.slug]) {
            show.ids.imdb = IMDB_OVERRIDES[show.ids.slug];
        }
        return show;
    });
}

async function getShowEpisodes(showSlug) {
    // 'full' adds per-episode overview, air date, runtime and rating.
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=full,episodes`;
    try {
        const seasons = await traktFetch(url);
        const episodes = [];
        for (const season of seasons) {
            if (season.number === 0) continue;
            for (const ep of season.episodes || []) {
                episodes.push({
                    season: season.number,
                    episode: ep.number,
                    title: ep.title || `Episode ${ep.number}`,
                    overview: ep.overview || '',
                    firstAired: ep.first_aired || null,
                    runtime: ep.runtime || null,
                    rating: ep.rating || null,
                    ids: ep.ids || {}
                });
            }
        }
        return episodes;
    } catch (e) {
        console.error(`Failed to fetch episodes for ${showSlug}:`, e.message);
        return [];
    }
}

// ======================== TMDB API ========================

async function getTmdbImages(tmdbId) {
    if (!tmdbId || !CONFIG.TMDB_API_KEY) return { poster: null, fanart: null };
    try {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${CONFIG.TMDB_API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) return { poster: null, fanart: null };
        const data = await response.json();
        return {
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            fanart: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
            // Israeli shows: show the Hebrew title instead of Trakt's transliteration.
            hebrewTitle: data.original_language === 'he' ? data.original_name : null
        };
    } catch (e) {
        console.error(`TMDB fetch failed for ${tmdbId}:`, e.message.replace(/api_key=[^&\s]+/g, 'api_key=REDACTED'));
        return { poster: null, fanart: null };
    }
}

// Episode stills (and fallbacks for fields Trakt left empty) for one season,
// keyed by episode number.
async function getTmdbSeason(tmdbId, season, language = 'en-US') {
    if (!tmdbId || !CONFIG.TMDB_API_KEY) return {};
    try {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${CONFIG.TMDB_API_KEY}&language=${language}`;
        const response = await fetch(url);
        if (!response.ok) return {};
        const data = await response.json();
        return Object.fromEntries((data.episodes || []).map(ep => [ep.episode_number, ep]));
    } catch (e) {
        console.error(`TMDB season fetch failed for ${tmdbId} S${season}:`, e.message.replace(/api_key=[^&\s]+/g, 'api_key=REDACTED'));
        return {};
    }
}

// Placeholder names ("Episode 5" / "פרק 5") that a real title should replace.
const GENERIC_TITLE = /^(Episode|פרק)\s*\d+$/i;

async function enrichWithTmdb(episodes, tmdbId) {
    const seasons = [...new Set(episodes.map(ep => ep.season))];
    for (const season of seasons) {
        const seasonEps = episodes.filter(e => e.season === season);
        const tmdbEps = await getTmdbSeason(tmdbId, season);
        for (const ep of seasonEps) {
            const t = tmdbEps[ep.episode];
            if (!t) continue;
            if (t.still_path) ep.still = `https://image.tmdb.org/t/p/w500${t.still_path}`;
            if (GENERIC_TITLE.test(ep.title) && t.name && !GENERIC_TITLE.test(t.name)) ep.title = t.name;
            ep.overview = ep.overview || t.overview || '';
            ep.firstAired = ep.firstAired || t.air_date || null;
            ep.runtime = ep.runtime || t.runtime || null;
            ep.rating = ep.rating || t.vote_average || null;
        }

        // Hebrew only fills gaps (Israeli shows mostly have no English text), so
        // English shows keep English. Fetched only for seasons that need it.
        if (!seasonEps.some(ep => !ep.overview || GENERIC_TITLE.test(ep.title))) continue;
        const heEps = await getTmdbSeason(tmdbId, season, 'he-IL');
        for (const ep of seasonEps) {
            const t = heEps[ep.episode];
            if (!t) continue;
            if (GENERIC_TITLE.test(ep.title) && t.name && !GENERIC_TITLE.test(t.name)) ep.title = t.name;
            ep.overview = ep.overview || t.overview || '';
        }
    }
}

// Per-episode fields Nuvio/Stremio show on the episode card. Nuvio parses
// runtime and rating as strings, so they must not be sent as numbers.
function videoDetails(ep) {
    return {
        thumbnail: ep.still || ep.showFanart || undefined,
        overview: ep.overview || undefined,
        released: ep.firstAired || new Date().toISOString(),
        runtime: ep.runtime ? `${ep.runtime} min` : undefined,
        rating: ep.rating ? Number(ep.rating).toFixed(1) : undefined
    };
}

// ======================== SHUFFLE ========================

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function fairShuffle(episodes) {
    const shows = {};
    episodes.forEach(ep => {
        const showId = ep.showIds?.slug || 'unknown';
        if (!shows[showId]) shows[showId] = [];
        shows[showId].push(ep);
    });

    Object.keys(shows).forEach(id => {
        shows[id] = shuffleArray(shows[id]);
    });

    const result = [];
    const showKeys = Object.keys(shows);

    while (showKeys.length > 0) {
        const roundOrder = shuffleArray([...showKeys]);
        for (const showId of roundOrder) {
            if (shows[showId].length > 0) {
                result.push(shows[showId].pop());
            } else {
                const idx = showKeys.indexOf(showId);
                if (idx > -1) showKeys.splice(idx, 1);
            }
        }
    }

    return result;
}

// ======================== DATA PIPELINE ========================

async function fetchAndShuffle() {
    console.log('=== Shuffle job started ===');
    const startTime = Date.now();

    const shows = await getShowsFromList();
    console.log(`Found ${shows.length} shows.`);

    // Fetch TMDB images
    console.log('Fetching TMDB images...');
    const imageCache = {};
    for (let i = 0; i < shows.length; i += 5) {
        const batch = shows.slice(i, i + 5);
        await Promise.all(batch.map(async (show) => {
            const images = await getTmdbImages(show.ids?.tmdb);
            if (!images.poster && POSTER_OVERRIDES[show.ids.slug]) {
                images.poster = POSTER_OVERRIDES[show.ids.slug];
            }
            imageCache[show.ids.slug] = images;
        }));
    }

    // Fetch episodes
    console.log('Fetching episodes...');
    const allEpisodes = [];
    for (let i = 0; i < shows.length; i += 5) {
        const batch = shows.slice(i, i + 5);
        const results = await Promise.all(batch.map(async (show) => {
            const episodes = await getShowEpisodes(show.ids.slug);
            await enrichWithTmdb(episodes, show.ids?.tmdb);
            const images = imageCache[show.ids.slug] || { poster: null, fanart: null };
            episodes.forEach(ep => {
                ep.showTitle = images.hebrewTitle || show.title;
                ep.showYear = show.year;
                ep.showIds = show.ids;
                ep.showPoster = images.poster;
                ep.showFanart = images.fanart;
            });
            return episodes;
        }));
        results.forEach(eps => allEpisodes.push(...eps));
    }

    // Keep the last good data if Trakt returned nothing (outage / API change).
    if (allEpisodes.length === 0) throw new Error('Fetched 0 episodes, keeping existing data.');

    const shuffled = fairShuffle(allEpisodes);
    fs.writeFileSync(EPISODES_FILE, JSON.stringify(shuffled));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`=== Shuffle complete: ${shuffled.length} episodes in ${elapsed}s ===`);
    return shuffled.length;
}

function loadEpisodes() {
    try {
        if (fs.existsSync(EPISODES_FILE)) {
            return JSON.parse(fs.readFileSync(EPISODES_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load episodes:', e.message);
    }
    return [];
}

// ======================== STREMIO ADDON (SDK) ========================

const CATALOG_PAGE_SIZE = 100;

const addon = new addonBuilder({
    id: 'community.sitcom.shuffle',
    version: '25.1.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{
        type: 'series',
        id: 'shuffled-episodes',
        name: 'Shuffled Sitcom Episodes',
        extra: [{ name: 'skip' }]
    }, {
        type: 'series',
        id: 'shuffle-binge',
        name: 'Sitcom Shuffle (Binge / Autoplay)'
    }],
    resources: ['catalog', 'meta', 'stream', 'subtitles'],
    types: ['series'],
    idPrefixes: ['scs']
});

// Re-shuffle on each fresh catalog open so the user sees a different mix every
// time, instead of the same first few episodes. The cron only fetches data
// (every 6h); shuffling here decouples variety from that slow refresh.
let catalogCache = [];

// Binge series: the whole shuffle as ONE series so Stremio autoplays the next
// episode. The order is re-shuffled each time the binge catalog is opened (same
// "fresh mix every time" idea as the regular catalog), and cached so the order
// stays stable while you watch. meta handler reads this cache.
let bingeCache = [];

function buildBingeOrder() {
    bingeCache = fairShuffle(loadEpisodes().filter(ep => ep?.showIds?.imdb));
    return bingeCache;
}

addon.defineCatalogHandler(({ type, id, extra }) => {
    // Binge catalog: one tile that opens the single autoplay series.
    if (id === 'shuffle-binge') {
        buildBingeOrder(); // re-shuffle on open
        const poster = bingeCache.find(ep => ep.showPoster)?.showPoster;
        return Promise.resolve({ metas: [{
            id: 'scs:binge',
            type: 'series',
            name: 'Sitcom Shuffle (Binge / Autoplay)',
            poster: poster || undefined
        }] });
    }

    const skip = parseInt(extra?.skip) || 0;

    // skip=0 marks the start of a new scroll: re-shuffle and cache the order.
    // skip>0 pages through the cached order so pagination stays consistent.
    if (skip === 0 || catalogCache.length === 0) {
        catalogCache = fairShuffle(loadEpisodes().filter(ep => ep?.showIds?.imdb));
    }

    const metas = catalogCache
        .slice(skip, skip + CATALOG_PAGE_SIZE)
        .map(ep => ({
            id: `scs:${ep.showIds.imdb}:${ep.season}:${ep.episode}`,
            type: 'series',
            name: `${ep.showTitle} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`,
            poster: ep.showPoster || undefined,
            background: ep.showFanart || ep.still || undefined,
            description: `"${ep.title}"${ep.overview ? `\n\n${ep.overview}` : ''}`,
            releaseInfo: String(ep.showYear || ''),
            imdbRating: ep.rating ? Number(ep.rating).toFixed(1) : undefined
        }));
    return Promise.resolve({ metas });
});

addon.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('scs:')) return Promise.resolve({ meta: null });

    // Binge series: all shuffled episodes as one series, numbered S01E01..N so
    // Stremio plays them in order with autoplay. Each video.id keeps the real
    // imdb:season:episode so external stream addons (Torrentio etc.) resolve it.
    if (id === 'scs:binge') {
        if (bingeCache.length === 0) buildBingeOrder(); // cold start / direct open
        const poster = bingeCache.find(ep => ep.showPoster)?.showPoster;
        // 'scs:' prefix routes stream requests to OUR handler (which aggregates
        // upstream addons), instead of letting Stremio show every addon's list.
        const videos = bingeCache.map((ep, i) => ({
            id: `scs:${ep.showIds.imdb}:${ep.season}:${ep.episode}`,
            title: `${ep.showTitle} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}${ep.title ? ` - ${ep.title}` : ''}`,
            season: 1,
            episode: i + 1,
            ...videoDetails(ep)
        }));
        return Promise.resolve({ meta: {
            id: 'scs:binge',
            type: 'series',
            name: 'Sitcom Shuffle (Binge / Autoplay)',
            poster: poster || undefined,
            description: `${videos.length} shuffled episodes in a row, with autoplay.`,
            videos
        } });
    }

    const parts = id.substring(4).split(':');
    const [seriesId, season, episodeNum] = parts;

    const episodes = loadEpisodes();
    const ep = episodes.find(
        e => e.showIds.imdb === seriesId && e.season == season && e.episode == episodeNum
    );

    if (!ep) return Promise.resolve({ meta: null });

    return Promise.resolve({
        meta: {
            id: id,
            type: 'series',
            name: `${ep.showTitle} - S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`,
            poster: ep.showPoster || undefined,
            background: ep.showFanart || undefined,
            description: `${ep.showTitle}\n\nEpisode: "${ep.title}"\n\n${ep.overview || ''}`,
            releaseInfo: String(ep.showYear || ''),
            videos: [{
                id: `${seriesId}:${season}:${episodeNum}`,
                title: ep.title || `Episode ${episodeNum}`,
                season: Number(season),
                episode: Number(episodeNum),
                ...videoDetails(ep)
            }]
        }
    });
});

// Upstream addons in priority order: comma-separated base URLs (the installed
// manifest URL, with or without the trailing /manifest.json).
function addonList(value) {
    return value.split(',')
        .map(u => u.trim().replace(/\/manifest\.json$/, '').replace(/\/+$/, ''))
        .filter(Boolean);
}
const UPSTREAM_ADDONS = addonList(process.env.UPSTREAM_ADDONS || 'https://torrentio.strem.fun');
const SUBTITLE_ADDONS = addonList(process.env.SUBTITLE_ADDONS || [
    'https://opensubtitles-v3.strem.io',
    'https://4b139a4b7f94-wizdom-stremio-v2.baby-beamup.club',
    'https://4b139a4b7f94-ktuvit-stremio.baby-beamup.club',
    'https://ktuvit-latest-nuvio.vercel.app' // K&W-Hub: Hebrew subs ranked by file match
].join(','));

// Fetch one resource (stream/subtitles) for a real imdb episode id from every
// upstream addon in parallel; results stay in priority order, failures are skipped.
async function fetchUpstream(bases, resource, epId, extra) {
    // The id comes from the request; only a real episode id may reach the upstream URL.
    if (!/^tt\d+:\d+:\d+$/.test(epId)) return [];
    const extraPath = extra && Object.keys(extra).length ? `/${new URLSearchParams(extra)}` : '';
    const results = await Promise.all(bases.map(async base => {
        try {
            const res = await fetch(`${base}/${resource}/series/${epId}${extraPath}.json`, {
                signal: AbortSignal.timeout(15000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return (await res.json())[resource === 'stream' ? 'streams' : 'subtitles'] || [];
        } catch (e) {
            console.error(`Upstream ${base} ${resource} failed for ${epId}: ${e.message}`);
            return [];
        }
    }));
    return results.flat();
}

// Binge episodes (scs:tt...:s:e): fetch streams from all upstream addons,
// return them in priority order, all tagged with one constant bingeGroup so
// Stremio's autoplay picks the top stream of the next episode automatically —
// no source-selection screen between episodes.
addon.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith('scs:tt')) return { streams: [] };
    const epId = id.substring(4); // tt...:season:episode

    // Drop entries that can't play (AIOStreams error/info rows have no url):
    // autoplay picks the first stream, so a message row would stall the binge.
    const streams = (await fetchUpstream(UPSTREAM_ADDONS, 'stream', epId))
        .filter(s => s.url || s.infoHash || s.ytId).map(s => ({
        ...s,
        behaviorHints: { ...s.behaviorHints, bingeGroup: 'scs-binge' }
    }));
    console.log(`Streams for ${epId}: ${streams.length} from ${UPSTREAM_ADDONS.length} upstream(s)`);
    return { streams };
});

// Subtitle addons only accept tt ids, and Nuvio matches them against the item id
// (scs:...), so it never asks them for our items; Stremio does the same for binge
// videos. Serve subtitles ourselves. The id is tt...:s:e (Nuvio, regular catalog)
// or scs:tt...:s:e (binge).
addon.defineSubtitlesHandler(async ({ id, extra }) => {
    const epId = id.replace(/^scs:/, '');
    if (!epId.startsWith('tt')) return { subtitles: [] };
    const subtitles = await fetchUpstream(SUBTITLE_ADDONS, 'subtitles', epId, extra);
    console.log(`Subtitles for ${epId}: ${subtitles.length} from ${SUBTITLE_ADDONS.length} upstream(s)`);
    return { subtitles };
});

// ======================== EXPRESS SERVER ========================

const app = express();

// Request logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Force Stremio to re-request the catalog on every open instead of serving its
// own cached copy — otherwise the re-shuffle never reaches the user. Scoped to
// catalog only; episode meta stays cacheable.
app.use((req, res, next) => {
    if (req.url.includes('/catalog/')) res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
});

// Catalog-only wrapper for MyTrakt: Nuvio can't disable one resource of an
// addon, so serve MyTrakt's manifest without stream/subtitles/search (it
// returns nothing there and only slows source lookup). Every other request
// redirects to the real addon. MYTRAKT_URL is the user's personal addon URL.
const MYTRAKT_URL = (process.env.MYTRAKT_URL || '').replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
// Unguessable mount path derived from the private URL, so strangers can't reach
// the user's Trakt catalogs (watch history) through this public server.
const MYTRAKT_PATH = MYTRAKT_URL &&
    `/mt-${require('crypto').createHash('sha256').update(MYTRAKT_URL).digest('hex').slice(0, 20)}`;
if (MYTRAKT_URL) {
    app.get(`${MYTRAKT_PATH}/manifest.json`, async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
            const r = await fetch(`${MYTRAKT_URL}/manifest.json`, { signal: AbortSignal.timeout(15000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const m = await r.json();
            m.id = `${m.id}.catalogs`;
            m.name = `${m.name} (catalogs)`;
            m.resources = m.resources.filter(r2 => ['catalog', 'meta'].includes(r2.name || r2));
            res.json(m);
        } catch (e) {
            console.error('MyTrakt manifest failed:', e.message);
            res.status(502).json({ error: 'MyTrakt unavailable' });
        }
    });
    app.get(`${MYTRAKT_PATH}/*`, (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.redirect(302, MYTRAKT_URL + req.url.slice(MYTRAKT_PATH.length));
    });
}

// Mount the SDK router (handles manifest, catalog, meta, stream, CORS)
const addonInterface = addon.getInterface();
app.use('/', getRouter(addonInterface));

// Root path health check (TV clients check this)
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(addonInterface.manifest);
});

// Manual trigger for reshuffle
app.get('/reshuffle', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const count = await fetchAndShuffle();
        res.json({ success: true, count });
    } catch (e) {
        console.error('Reshuffle failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// ======================== START ========================

app.listen(PORT, async () => {
    console.log(`Sitcom Shuffle addon running on port ${PORT}`);
    console.log(`Install in Stremio: http://localhost:${PORT}/manifest.json`);

    // Run shuffle on startup if no data exists
    if (!fs.existsSync(EPISODES_FILE)) {
        console.log('No episode data found, running initial shuffle...');
        try {
            await fetchAndShuffle();
        } catch (e) {
            console.error('Initial shuffle failed:', e.message);
        }
    }

    // Schedule periodic reshuffle
    cron.schedule(CONFIG.CRON_SCHEDULE, async () => {
        try {
            await fetchAndShuffle();
        } catch (e) {
            console.error('Scheduled shuffle failed:', e.message);
        }
    });
    console.log(`Cron scheduled: ${CONFIG.CRON_SCHEDULE}`);
});
