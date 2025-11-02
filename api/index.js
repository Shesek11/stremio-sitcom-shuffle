const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '15.0.0', // הגרסה שעובדת סופית
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'movie', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    resources: ['catalog'], // אנחנו רק קטלוג! לא צריכים meta.
    types: ['movie'],
    idPrefixes: ['tt']
};

function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.ids.imdb) return null;
    
    return {
        // ===================================================================
        // ========== ה-ID הוא עכשיו ה-ID האמיתי של הפרק ב-IMDb ==========
        // ===================================================================
        id: episode.ids.imdb, 
        type: 'movie',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: episode.showPoster || null // נשתמש בפוסטר של הסדרה
    };
}

let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getShuffledEpisodes() {
    const now = Date.now();
    if (allEpisodesCache && (now - lastFetchTime < CACHE_DURATION)) { return allEpisodesCache; }
    const blobUrl = await kv.get('episodes_blob_url');
    if (!blobUrl) throw new Error('Blob URL not found. Cron job may not have run yet.');
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Failed to fetch episode blob: ${response.statusText}`);
    const episodes = await response.json();
    allEpisodesCache = episodes;
    lastFetchTime = now;
    return episodes;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];
    const pathParts = path.split('/');

    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    if (pathParts[1] === 'catalog' && pathParts[2] === 'movie' && pathParts[3]?.startsWith('shuffled-episodes')) {
        try {
            const skip = parseInt(req.query.skip) || 0;
            const limit = 50;
            const allEpisodes = await getShuffledEpisodes();
            const paginatedEpisodes = allEpisodes.slice(skip, skip + limit);
            const metas = paginatedEpisodes
                .map((ep, idx) => episodeToMeta(ep, idx))
                .filter(Boolean);
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
