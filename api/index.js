const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '17.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'movie', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    resources: ['catalog'],
    types: ['movie'],
    idPrefixes: ['tt']
};

function episodeToMeta(episode, index) {
    if (!episode || !episode.ids?.imdb || !episode.showIds?.imdb) return null;
    
    return {
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`, // ID עבור Torrentio
        // השדה החשוב ביותר: imdb_id בתוך האובייקט posterMeta
        // Stremio ישתמש בזה כדי למצוא את המידע הנכון
        posterMeta: {
            imdb: episode.ids.imdb
        },
        type: 'movie',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        // Stremio ישתמש ב-posterMeta כדי למצוא את הפוסטר הנכון בעצמו
        poster: episode.ids.imdb,
        background: episode.showFanart || null,
        description: `This is a random episode from '${episode.showTitle}'.\n\nEpisode Title: "${episode.title}"\n\n${episode.overview}`
    };
}

let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getShuffledEpisodes() {
    const now = Date.now();
    if (allEpisodesCache && (now - lastFetchTime < CACHE_DURATION)) {
        console.log('Returning episodes from in-memory cache.');
        return allEpisodesCache;
    }
    const blobUrl = await kv.get('episodes_blob_url');
    if (!blobUrl) throw new Error('Blob URL not found. Cron job may not have run yet.');
    
    console.log(`Fetching episode data from Blob URL: ${blobUrl}`);
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Failed to fetch episode blob: ${response.statusText}`);
    
    const episodes = await response.json();
    allEpisodesCache = episodes;
    lastFetchTime = now;
    
    console.log(`Successfully fetched and cached ${episodes.length} episodes.`);
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
