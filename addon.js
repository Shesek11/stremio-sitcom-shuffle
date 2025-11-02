const { addonBuilder } = require('stremio-addon-sdk');
const { kv } = require('@vercel/kv');

// ========== Manifest - מידע על ה-Addon ==========
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '2.0.0', // עדכנתי גרסה לציון השינוי הגדול
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

// ========== פונקציית עזר - המרת פרק לפורמט Stremio ==========
function episodeToMeta(episode, index) {
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

// ========== Catalog Handler - הגרסה החדשה והיעילה ==========
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'series' || id !== 'shuffled-episodes') {
        return { metas: [] };
    }

    try {
        const skip = parseInt(extra.skip) || 0;
        const limit = 100;
        // אינדקס הסיום. lrange כולל את האינדקס האחרון.
        const stop = skip + limit - 1; 

        console.log(`Fetching page from KV. Range: ${skip} to ${stop}`);
        
        // שימוש ב-lrange כדי למשוך רק את הטווח (העמוד) שאנו צריכים
        const paginatedEpisodes = await kv.lrange('shuffled-episodes', skip, stop);

        if (!paginatedEpisodes || paginatedEpisodes.length === 0) {
            console.log('No episodes found for this page or cache is empty.');
            return { metas: [] };
        }

        const metas = paginatedEpisodes.map((ep, idx) =>
            episodeToMeta(ep, skip + idx)
        );

        return { metas };

    } catch (error) {
        console.error('Error fetching episodes from KV store:', error);
        return { metas: [] };
    }
});

// ========== ייצוא הממשק עבור Vercel ==========
module.exports = builder.getInterface();
