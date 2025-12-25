const { put } = require('@vercel/blob');
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const CONFIG = {
    TRAKT_USERNAME: process.env.TRAKT_USERNAME,
    TRAKT_LIST_SLUG: process.env.TRAKT_LIST_SLUG,
    TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
    TRAKT_CLIENT_SECRET: process.env.TRAKT_CLIENT_SECRET, // Required for refresh
    TRAKT_ACCESS_TOKEN: process.env.TRAKT_ACCESS_TOKEN, // Initial fallback
    TRAKT_REFRESH_TOKEN: process.env.TRAKT_REFRESH_TOKEN // Initial fallback
};

async function getValidToken() {
    // 1. Try to get token from KV
    let token = await kv.get('trakt_access_token');
    if (token) return token;

    // 2. Fallback to env var
    return CONFIG.TRAKT_ACCESS_TOKEN;
}

async function refreshTraktToken() {
    console.log('Refreshing Trakt Access Token...');

    // Get refresh token from KV or Env
    let refreshToken = await kv.get('trakt_refresh_token') || CONFIG.TRAKT_REFRESH_TOKEN;

    if (!refreshToken) {
        throw new Error('No refresh token available in KV or ENV.');
    }

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
        throw new Error(`Failed to refresh token: ${response.status} ${errText}`);
    }

    const data = await response.json();

    // Save new tokens to KV
    await kv.set('trakt_access_token', data.access_token);
    await kv.set('trakt_refresh_token', data.refresh_token); // Rotate refresh token
    console.log('Token refreshed successfully.');

    return data.access_token;
}

async function getTraktHeaders(attemptRefresh = false) {
    if (!CONFIG.TRAKT_CLIENT_ID) {
        throw new Error('Trakt Client ID is not configured.');
    }

    let token;
    if (attemptRefresh) {
        token = await refreshTraktToken();
    } else {
        token = await getValidToken();
    }

    if (!token) {
        // If no token found anywhere, try refreshing as a last resort if we haven't already
        if (!attemptRefresh) return getTraktHeaders(true);
        throw new Error('Could not obtain a valid Trakt access token.');
    }

    return {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': CONFIG.TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${token}`
    };
}

async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows?extended=images`;

    let headers;
    try {
        headers = await getTraktHeaders();
    } catch (e) {
        console.log("Initial header fetch failed, trying refresh...", e);
        headers = await getTraktHeaders(true);
    }

    let response = await fetch(url, { headers });

    if (response.status === 401) {
        console.log('Trakt API returned 401, refreshing token...');
        headers = await getTraktHeaders(true);
        response = await fetch(url, { headers });
    }

    if (!response.ok) throw new Error(`Failed to fetch Trakt list: ${response.statusText}`);
    const items = await response.json();
    return items.map(item => item.show);
}

async function getShowEpisodes(showSlug) {
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`;
    // Note: optimization - we assume headers are valid from getShowsFromList, 
    // but individually wrapping every call safely is safer. For now using standard headers.
    // If getShowsFromList succeeded, the token should be valid for a while.
    const headers = await getValidToken().then(token => ({
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': CONFIG.TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${token}`
    }));

    const response = await fetch(url, { headers });
    if (!response.ok) {
        console.error(`Failed to fetch episodes for ${showSlug}, skipping.`);
        return [];
    }
    const seasons = await response.json();
    const episodes = [];
    for (const season of seasons) {
        if (season.number === 0) continue;
        for (const episode of season.episodes || []) {
            if (episode.ids && episode.ids.imdb) {
                episodes.push({
                    season: season.number,
                    episode: episode.number,
                    title: episode.title || `Episode ${episode.number}`,
                    overview: episode.overview || '',
                    ids: episode.ids
                });
            }
        }
    }
    return episodes;
}

async function getAllEpisodesOptimized() {
    console.log('Fetching shows from Trakt list...');
    const shows = await getShowsFromList();
    console.log(`Found ${shows.length} shows.`);
    const allEpisodes = [];
    const batchSize = 5;

    for (let i = 0; i < shows.length; i += batchSize) {
        const batch = shows.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}...`);
        const batchPromises = batch.map(async (show) => {
            const episodes = await getShowEpisodes(show.ids.slug);
            episodes.forEach(ep => {
                ep.showTitle = show.title;
                ep.showYear = show.year;
                ep.showIds = show.ids;
                const posterUrl = show.images?.poster?.thumb;
                const fanartUrl = show.images?.fanart?.thumb;
                ep.showPoster = posterUrl ? posterUrl.replace('medium.jpg', 'full.jpg') : null;
                ep.showFanart = fanartUrl ? fanartUrl.replace('medium.jpg', 'full.jpg') : null;
            });
            return episodes;
        });
        const results = await Promise.all(batchPromises);
        results.forEach(episodesArray => allEpisodes.push(...episodesArray));
    }
    console.log(`Total episodes collected: ${allEpisodes.length}`);
    return allEpisodes;
}


function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function fairShuffle(episodes) {
    // 1. Group episodes by show
    const shows = {};
    episodes.forEach(ep => {
        const showId = ep.showIds?.slug || 'unknown';
        if (!shows[showId]) shows[showId] = [];
        shows[showId].push(ep);
    });

    // 2. Shuffle episodes within each show
    Object.keys(shows).forEach(showId => {
        shows[showId] = shuffleArray(shows[showId]);
    });

    const result = [];
    const showKeys = Object.keys(shows);

    // 3. Round Robin with random show order per round
    while (showKeys.length > 0) {
        // Shuffle the order of shows for this round (so we don't always start with the same show)
        const roundShowOrder = shuffleArray([...showKeys]);

        // Iterate through all currently active shows
        // We use a backwards loop on roundShowOrder only to be safe if we were splicing, 
        // but here we just need to hit every key.
        for (const showId of roundShowOrder) {
            const showEpisodes = shows[showId];

            if (showEpisodes.length > 0) {
                // Take one episode from this show
                result.push(showEpisodes.pop());
            } else {
                // This show is empty, remove it from the master list of keys
                const keyIndex = showKeys.indexOf(showId);
                if (keyIndex > -1) {
                    showKeys.splice(keyIndex, 1);
                }
            }
        }
    }

    return result;
}

module.exports = async (req, res) => {
    try {
        console.log('Cron Job Started with OPTIMIZED fetcher.');
        const allEpisodes = await getAllEpisodesOptimized();
        const shuffledEpisodes = fairShuffle(allEpisodes);
        console.log(`Fetched and shuffled ${shuffledEpisodes.length} episodes using Fair Shuffle.`);
        const jsonContent = JSON.stringify(shuffledEpisodes);

        // ===================================================================
        // ========== התיקון: יצירת שם קובץ ייחודי ושמירתו ==========
        // ===================================================================
        const uniqueFilename = `shuffled-episodes-${Date.now()}.json`;
        console.log(`Uploading shuffled list to Vercel Blob with unique name: ${uniqueFilename}`);

        const blob = await put(uniqueFilename, jsonContent, {
            access: 'public',
            contentType: 'application/json'
        });
        // ===================================================================

        console.log('Upload complete. Blob URL:', blob.url);

        // עדכון הכתובת ב-KV לכתובת של הקובץ החדש והייחודי
        await kv.set('episodes_blob_url', blob.url);

        res.status(200).json({ message: 'Success', url: blob.url, count: shuffledEpisodes.length });

    } catch (error) {
        console.error('Cron job failed:', error);
        res.status(500).json({ message: 'Failed', error: error.message });
    }
};
