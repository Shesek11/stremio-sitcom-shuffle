const { addonBuilder } = require('stremio-addon-sdk');
const { kv } = require('@vercel/kv');

// ========== Manifest - מידע על ה-Addon ==========
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '1.0.0', // אפשר לשקול לעדכן גרסה ל-2.0.0 אחרי שינוי כה גדול
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
// פונקציה זו נשארת כאן כי אנחנו עדיין צריכים אותה כדי להציג את המידע
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

// ========== Catalog Handler ==========
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'series' || id !== 'shuffled-episodes') {
        return { metas: [] };
    }

    console.log('Fetching shuffled episodes from KV store...');
    try {
        // שלב 1: שליפה מהירה של כל רשימת הפרקים ממסד הנתונים
        const episodesCache = await kv.get('shuffled-episodes');

        // אם המטמון ריק (למשל, ה-cron job עוד לא רץ), החזר רשימה ריקה
        if (!episodesCache || episodesCache.length === 0) {
            console.log('Cache is empty. Waiting for the cron job to run.');
            return { metas: [] };
        }

        // שלב 2: Pagination על הרשימה שהתקבלה
        const skip = parseInt(extra.skip) || 0;
        const limit = 100; // אפשר להגדיר מספר קטן יותר אם רוצים
        const paginatedEpisodes = episodesCache.slice(skip, skip + limit);

        // שלב 3: המרת הפרקים לפורמט ש-Stremio מבין
        const metas = paginatedEpisodes.map((ep, idx) =>
            episodeToMeta(ep, skip + idx)
        );

        return { metas };

    } catch (error) {
        console.error('Error fetching episodes from KV store:', error);
        return { metas: [] }; // החזר רשימה ריקה במקרה של שגיאה
    }
});

// ========== ייצוא הממשק עבור Vercel ==========
module.exports = builder.getInterface();
