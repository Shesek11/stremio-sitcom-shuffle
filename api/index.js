const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '8.1.0', // הגרסה המתוקנת
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [
        {
            type: 'movie',
            // ===================================================================
            // ========== שינוי 1: חזרנו ל-ID שעבד ==========
            id: 'shuffled-episodes',
            // ===================================================================
            name: 'Shuffled Sitcom Episodes'
        }
    ],
    resources: ['catalog'],
    types: ['movie'],
    idPrefixes: ['tt']
};

function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.showIds || !episode.showIds.imdb) return null;
    
    return {
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
        type: 'movie',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: episode.showIds.imdb,
        background: episode.showIds.imdb,
        description: `This is a random episode from '${episode.showTitle}'.\n\nEpisode Title: "${episode.title}"\n\n${episode.overview}`
    };
}

// ... (שאר הקוד: getShuffledEpisodes נשאר זהה לחלוטין)
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

    // ===================================================================
    // ========== שינוי 2: הנתב תואם עכשיו ל-ID הישן ==========
    if (path.startsWith('/catalog/movie/shuffled-episodes')) {
    // ===================================================================
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
