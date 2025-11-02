const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '7.0.0', // הגרסה שעובדת!
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [
        {
            type: 'series',
            id: 'shuffled-episodes',
            name: 'Shuffled Sitcom Episodes'
        }
    ],
    resources: ['catalog'],
    types: ['series'],
    idPrefixes: ['tt']
};

// ===================================================================
// ========== פונקציית עזר להמרת פרק - הגרסה הסופית ==========
// ===================================================================
function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.showIds || !episode.showIds.imdb) return null;
    
    // זהו אובייקט ה-meta הראשי. הוא מתאר את הסדרה.
    const seriesMeta = {
        id: episode.showIds.imdb, // ID של הסדרה
        type: 'series',
        name: episode.showTitle, // שם הסדרה
        poster: episode.showIds.imdb,
        background: episode.showIds.imdb,
        posterShape: 'poster',
        description: `A random episode from ${episode.showTitle}.\n\nThis is episode S${episode.season}E${episode.episode}: "${episode.title}"\n\n${episode.overview}`,
        
        // כאן הקסם קורה: אנחנו אומרים ל-Stremio
        // "בתוך הסדרה הזו, יש רק פרק אחד שמעניין אותנו כרגע"
        videos: [
            {
                id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
                title: `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}: ${episode.title}`,
                season: episode.season,
                episode: episode.episode,
                overview: episode.overview
                // released: episode.first_aired // אפשר להוסיף אם המידע קיים
            }
        ]
    };
    
    return seriesMeta;
}

// ... (שאר הקוד נשאר זהה לחלוטין)
let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getShuffledEpisodes() {
    // ... (אותה פונקציה כמו קודם)
}

module.exports = async (req, res) => {
    // ... (אותו Handler כמו קודם)
};

// ========= הדבקת שאר הקוד המלא =========
async function getShuffledEpisodes_impl() {
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
getShuffledEpisodes = getShuffledEpisodes_impl; // przypisanie do globalnej zmiennej

module.exports_impl = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];

    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    if (path.startsWith('/catalog/series/shuffled-episodes')) {
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
module.exports = module.exports_impl;
