const { put } = require('@vercel/blob');
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const CONFIG = {
    TRAKT_USERNAME: process.env.TRAKT_USERNAME,
    TRAKT_LIST_SLUG: process.env.TRAKT_LIST_SLUG,
    TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
    TRAKT_ACCESS_TOKEN: process.env.TRAKT_ACCESS_TOKEN
};

function getTraktHeaders() {
    if (!CONFIG.TRAKT_CLIENT_ID || !CONFIG.TRAKT_ACCESS_TOKEN) {
        throw new Error('Trakt API credentials are not configured in environment variables.');
    }
    return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': CONFIG.TRAKT_CLIENT_ID, 'Authorization': `Bearer ${CONFIG.TRAKT_ACCESS_TOKEN}` };
}

async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows?extended=images`;
    const response = await fetch(url, { headers: getTraktHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch Trakt list: ${response.statusText}`);
    const items = await response.json();
    return items.map(item => item.show);
}

async function getShowEpisodes(showSlug) {
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`;
    const response = await fetch(url, { headers: getTraktHeaders() });
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

module.exports = async (req, res) => {
    try {
        console.log('Cron Job Started with OPTIMIZED fetcher.');
        const allEpisodes = await getAllEpisodesOptimized();
        const shuffledEpisodes = shuffleArray(allEpisodes);
        console.log(`Fetched and shuffled ${shuffledEpisodes.length} episodes.`);
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
