const { addonBuilder } = require('stremio-addon-sdk');
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// ========== Manifest ==========
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '5.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [
        {
            type: 'series',
            id: 'shuffled-episodes',
            name: 'Shuffled Sitcom Episodes',
            extra: [{ name: 'skip', isRequired: false }]
        }
    ],
    resources: ['catalog'],
    types: ['series'],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

// ========== פונקציית עזר - המרה לפורמט Stremio ==========
function episodeToMeta(episode, index) {
    if (!episode || !episode.ids) return null;
    return {
        id: `tt${episode.ids.imdb || episode.ids.trakt}`,
        type: 'series',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: `https://via.placeholder.com/300x450/1a1a2e/16213e?text=${encodeURIComponent(episode.showTitle)}`,
        background: `https://via.placeholder.com/1920x1080/1a1a2e/16213e?text=${encodeURIComponent(episode.showTitle)}`,
        description: `${episode.title}\n\n${episode.overview}\n\n📺 ${episode.showTitle} (${episode.showYear})\n🎲 Shuffle Position: ${index + 1}`,
        releaseInfo: `S${episode.season}E${episode.episode}`,
        genres: ['Comedy', 'Sitcom']
    };
}

// ========== לוגיקת שליפת נתונים ==========
let allEpisodesCache = null; // מטמון מקומי בזיכרון למניעת הורדות מיותרות
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 דקות

async function getShuffledEpisodes() {
    const now = Date.now();
    if (allEpisodesCache && (now - lastFetchTime < CACHE_DURATION)) {
        console.log('Returning episodes from in-memory cache.');
        return allEpisodesCache;
    }

    console.log('Fetching blob URL from KV store...');
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

// ========== Catalog Handler ==========
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    try {
        const skip = parseInt(extra.skip) || 0;
        const limit = 50;

        const allEpisodes = await getShuffledEpisodes();
        const paginatedEpisodes = allEpisodes.slice(skip, skip + limit);
        const metas = paginatedEpisodes
            .map((ep, idx) => episodeToMeta(ep, skip + idx))
            .filter(Boolean);

        return { metas };

    } catch (error) {
        console.error('Error in Catalog Handler:', error);
        return { metas: [] };
    }
});

module.exports = builder.getInterface();
