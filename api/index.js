const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// אובייקט המניפסט
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '6.1.0', // הגרסה היציבה
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

// פונקציית עזר להמרת פרק
function episodeToMeta(episode, index) {
    if (!episode || !episode.ids) return null;
    return {
        id: `tt${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
        type: 'series',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: `https://via.placeholder.com/300x450/1a1a2e/16213e?text=${encodeURIComponent(episode.showTitle)}`,
        background: `https://via.placeholder.com/1920x1080/1a1a2e/16213e?text=${encodeURIComponent(episode.showTitle)}`,
        description: `${episode.title}\n\n${episode.overview}\n\n📺 ${episode.showTitle} (${episode.showYear})\n🎲 Shuffle Position: ${index + 1}`,
        releaseInfo: `S${episode.season}E${episode.episode}`,
        genres: ['Comedy', 'Sitcom']
    };
}

// לוגיקת שליפת נתונים (עם מטמון)
let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 דקות

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

// ===================================================================
// ========== Handler ראשי עם ניתוב מתוקן ==========
// ===================================================================
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    // קודם כל, ננקה את הכתובת מפרמטרים כדי לקבל את הנתיב הנקי
    const path = req.url.split('?')[0];

    // --- ניתוב מדויק ---

    // בקשה למניפסט
    if (path === '/manifest.json') {
        console.log('Request received for /manifest.json');
        return res.send(JSON.stringify(manifest));
    }

    // בקשה לקטלוג
    // Stremio מבקש כתובת בפורמט: /catalog/{type}/{id}.json
    if (path.startsWith('/catalog/series/shuffled-episodes')) {
        console.log('Request received for catalog.');
        try {
            // Vercel מנתח עבורנו את הפרמטרים, אין צורך לנתח את הכתובת ידנית
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

    // אם לא זו ולא זו, החזר 404
    console.log(`Request for unknown path: ${path}`);
    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
