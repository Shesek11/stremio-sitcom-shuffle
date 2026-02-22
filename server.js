const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 3020;
const DATA_DIR = path.join(__dirname, 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ======================== CONFIG ========================

const CONFIG = {
    TRAKT_USERNAME: process.env.TRAKT_USERNAME,
    TRAKT_LIST_SLUG: process.env.TRAKT_LIST_SLUG,
    TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
    TRAKT_CLIENT_SECRET: process.env.TRAKT_CLIENT_SECRET,
    TRAKT_ACCESS_TOKEN: process.env.TRAKT_ACCESS_TOKEN,
    TRAKT_REFRESH_TOKEN: process.env.TRAKT_REFRESH_TOKEN,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    CRON_SCHEDULE: process.env.CRON_SCHEDULE || '0 */6 * * *' // every 6 hours
};

// ======================== LOCAL TOKEN STORAGE ========================

function loadTokens() {
    try {
        if (fs.existsSync(TOKENS_FILE)) {
            return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load tokens file:', e.message);
    }
    return {};
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function getAccessToken() {
    const tokens = loadTokens();
    return tokens.access_token || CONFIG.TRAKT_ACCESS_TOKEN;
}

function getRefreshToken() {
    const tokens = loadTokens();
    return tokens.refresh_token || CONFIG.TRAKT_REFRESH_TOKEN;
}

// ======================== TRAKT API ========================

async function refreshTraktToken() {
    console.log('Refreshing Trakt token...');
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available.');

    const response = await fetch('https://api.trakt.tv/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            refresh_token: refreshToken,
            client_id: CONFIG.TRAKT_CLIENT_ID,
            client_secret: CONFIG.TRAKT_CLIENT_SECRET,
            redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
            grant_type: 'refresh_token'
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
    console.log('Token refreshed and saved.');
    return data.access_token;
}

function getTraktHeaders(token) {
    return {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': CONFIG.TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${token}`
    };
}

async function traktFetch(url) {
    let token = getAccessToken();
    if (!token) token = await refreshTraktToken();

    let response = await fetch(url, { headers: getTraktHeaders(token) });

    if (response.status === 401) {
        console.log('Trakt 401, refreshing token...');
        token = await refreshTraktToken();
        response = await fetch(url, { headers: getTraktHeaders(token) });
    }

    if (!response.ok) throw new Error(`Trakt API error: ${response.status} ${response.statusText}`);
    return response.json();
}

async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows`;
    const items = await traktFetch(url);
    return items.map(item => item.show);
}

async function getShowEpisodes(showSlug) {
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`;
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
            fanart: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null
        };
    } catch (e) {
        console.error(`TMDB fetch failed for ${tmdbId}:`, e.message);
        return { poster: null, fanart: null };
    }
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
            imageCache[show.ids.slug] = await getTmdbImages(show.ids?.tmdb);
        }));
    }

    // Fetch episodes
    console.log('Fetching episodes...');
    const allEpisodes = [];
    for (let i = 0; i < shows.length; i += 5) {
        const batch = shows.slice(i, i + 5);
        const results = await Promise.all(batch.map(async (show) => {
            const episodes = await getShowEpisodes(show.ids.slug);
            const images = imageCache[show.ids.slug] || { poster: null, fanart: null };
            episodes.forEach(ep => {
                ep.showTitle = show.title;
                ep.showYear = show.year;
                ep.showIds = show.ids;
                ep.showPoster = images.poster;
                ep.showFanart = images.fanart;
            });
            return episodes;
        }));
        results.forEach(eps => allEpisodes.push(...eps));
    }

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

// ======================== STREMIO ADDON ========================

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '23.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'series', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    resources: ['catalog', 'meta'],
    types: ['series'],
    idPrefixes: ['scs']
};

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get('/catalog/series/shuffled-episodes.json', (req, res) => {
    const episodes = loadEpisodes();
    const metas = episodes
        .filter(ep => ep?.showIds?.imdb)
        .map(ep => ({
            id: `scs:${ep.showIds.imdb}:${ep.season}:${ep.episode}`,
            type: 'series',
            name: `${ep.showTitle} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`,
            poster: ep.showPoster || null
        }));
    res.json({ metas });
});

app.get('/meta/:type/:id.json', (req, res) => {
    const fullId = req.params.id;

    if (!fullId.startsWith('scs:')) return res.status(404).json({ error: 'Not Found' });

    const parts = fullId.substring(4).split(':');
    const [seriesId, season, episodeNum] = parts;

    const episodes = loadEpisodes();
    const ep = episodes.find(
        e => e.showIds.imdb === seriesId && e.season == season && e.episode == episodeNum
    );

    if (!ep) return res.status(404).json({ error: 'Episode not found' });

    res.json({
        meta: {
            id: fullId,
            type: 'series',
            name: `${ep.showTitle} - S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`,
            poster: ep.showPoster || null,
            background: ep.showFanart || null,
            description: `${ep.showTitle}\n\nEpisode: "${ep.title}"\n\n${ep.overview || ''}`,
            releaseInfo: `${ep.showYear || ''}`,
            videos: [{
                id: `${seriesId}:${season}:${episodeNum}`,
                title: ep.title || `Episode ${episodeNum}`,
                season: Number(season),
                episode: Number(episodeNum),
                released: new Date().toISOString(),
                overview: ep.overview || ''
            }]
        }
    });
});

// Manual trigger for reshuffle
app.get('/reshuffle', async (req, res) => {
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
