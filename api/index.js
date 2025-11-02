const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// ===================================================================
// ========== שינוי 1: המניפסט מגדיר עכשיו קטלוג של סרטים ==========
// ===================================================================
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '8.0.0', // הגרסה המנצחת
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [
        {
            type: 'movie', // שינינו ל-movie
            id: 'shuffled-sitcom-episodes',
            name: 'Shuffled Sitcom Episodes'
        }
    ],
    resources: ['catalog'],
    types: ['movie'], // שינינו ל-movie
    idPrefixes: ['tt']
};

// ===================================================================
// ========== שינוי 2: הפונקציה יוצרת עכשיו אובייקט מסוג "סרט" ==========
// ===================================================================
function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.showIds || !episode.showIds.imdb) return null;
    
    // אובייקט ה-meta מתאר עכשיו "סרט" שהוא בעצם פרק
    return {
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`, // ID של הפרק
        type: 'movie', // שינינו ל-movie
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: episode.showIds.imdb, // נשתמש בפוסטר של הסדרה
        background: episode.showIds.imdb, // וברקע של הסדרה
        description: `This is a random episode from '${episode.showTitle}'.\n\nEpisode Title: "${episode.title}"\n\n${episode.overview}`
    };
}

// ... (שאר הקוד נשאר זהה לחלוטין)
let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getShuffledEpisodes() {
    const now = Date.now();
    if (allEpisodesCache && (now - lastFetchTime < CACHE_DURATION)) {
        return allEpisodesCache;
    }
    const blobUrl = await kv.get('episodes_blob_url');
    if (!blobUrl) throw new Error('Blob URL not found. Cron job may not have run yet.');
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Failed to fetch episode blob: ${response.statusText}`);
    const episodes = await response.json();
    allEpisodesCache = episodes;
    lastFetchTime = now;
    return episodes;
}

// Handler ראשי
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];

    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    // הניתוב בודק עכשיו קטלוג מסוג movie
    if (path.startsWith('/catalog/movie/shuffled-sitcom-episodes')) {
        try {
            const skip = parseInt(req.query.skip) || 0;
            const limit = 50;

            const allEpisodes = await getShuffledEpisodes();
            const paginatedEpisodes = allEpisodes.slice(skip, skip + limit);
            const metas = paginatedEpisodes
                .map((ep, idx) => episodeToMeta(ep, skip + idx))
                .filter(Boolean);

            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
