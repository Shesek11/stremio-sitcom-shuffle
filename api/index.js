const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '15.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ 
        type: 'series',
        id: 'shuffled-episodes', 
        name: 'Shuffled Sitcom Episodes' 
    }],
    resources: ['catalog'], // רק catalog, בלי meta
    types: ['series'],
    idPrefixes: ['tt'] // IMDB IDs
};

function episodeToMeta(episode, index) {
    if (!episode || !episode.showIds || !episode.showIds.imdb) return null;
    
    // פשוט החזר את ה-IMDB ID של הסדרה + מספרי עונה ופרק
    // סטרמיו ימשוך את כל המטא-דאטה מ-TMDB
    return {
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
        type: 'series'
    };
}

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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    
    const path = req.url.split('?')[0];
    const pathParts = path.split('/');
    
    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }
    
    if (pathParts[1] === 'catalog' && pathParts[2] === 'series' && 
        pathParts[3]?.startsWith('shuffled-episodes')) {
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
