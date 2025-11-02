const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const TMDB_API_KEY = process.env.TMDB_API_KEY; // הוסף ב-Vercel environment variables

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '13.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ 
        type: 'series',
        id: 'shuffled-episodes', 
        name: 'Shuffled Sitcom Episodes' 
    }],
    resources: ['catalog'],
    types: ['series'],
    idPrefixes: ['tmdb:'] // שינוי ל-TMDB prefix
};

// המרת IMDB ID ל-TMDB ID
async function getTmdbIdFromImdb(imdbId) {
    if (!TMDB_API_KEY) return null;
    
    try {
        const response = await fetch(
            `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`
        );
        const data = await response.json();
        return data.tv_results?.[0]?.id || null;
    } catch (error) {
        console.error('Error converting IMDB to TMDB:', error);
        return null;
    }
}

async function episodeToMeta(episode, index) {
    if (!episode || !episode.showIds || !episode.showIds.imdb) return null;
    
    // המרה ל-TMDB ID
    const tmdbId = await getTmdbIdFromImdb(episode.showIds.imdb);
    if (!tmdbId) return null;
    
    return {
        id: `tmdb:${tmdbId}:${episode.season}:${episode.episode}`,
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
    if (!blobUrl) throw new Error('Blob URL not found');
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
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
            
            const metasPromises = paginatedEpisodes.map((ep, idx) => 
                episodeToMeta(ep, skip + idx)
            );
            const metas = (await Promise.all(metasPromises)).filter(Boolean);
            
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }
    
    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
