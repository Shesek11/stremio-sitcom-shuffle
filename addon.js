const { addonBuilder } = require('stremio-addon-sdk');
const { kv } = require('@vercel/kv');

// ========== Manifest - מידע על ה-Addon ==========
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '2.1.0', // גרסה סופית!
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
    // הגנה מפני מקרה שבו אובייקט הפרק לא תקין
    if (!episode || !episode.ids) {
        console.error('Invalid episode object passed to episodeToMeta:', episode);
        return null; 
    }
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

// ========== Catalog Handler - הגרסה הסופית והמתוקנת ==========
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'series' || id !== 'shuffled-episodes') {
        return { metas: [] };
    }

    try {
        const skip = parseInt(extra.skip) || 0;
        const limit = 100;
        const stop = skip + limit - 1; 

        console.log(`Fetching page of episode STRINGS from KV. Range: ${skip} to ${stop}`);
        const paginatedEpisodeStrings = await kv.lrange('shuffled-episodes', skip, stop);

        if (!paginatedEpisodeStrings || paginatedEpisodeStrings.length === 0) {
            console.log('No episodes found for this page or cache is empty.');
            return { metas: [] };
        }

        console.log('Parsing episode strings back into objects...');
        // ===================================================================
        // ========== התיקון הקריטי נמצא כאן! ==========
        // אנו ממירים כל מחרוזת חזרה לאובייקט לפני שאנחנו שולחים אותה הלאה
        const metas = paginatedEpisodeStrings
            .map(epString => JSON.parse(epString)) 
            .map((epObject, idx) => episodeToMeta(epObject, skip + idx))
            .filter(meta => meta !== null); // סינון פרקים לא תקינים אם היו
        // ===================================================================

        return { metas };

    } catch (error) {
        console.error('Error in Catalog Handler:', error);
        return { metas: [] };
    }
});

// ========== ייצוא הממשק עבור Vercel ==========
module.exports = builder.getInterface();
