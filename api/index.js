const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// אובייקט המניפסט
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '6.2.0', // הגרסה הסופית באמת
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

// ===================================================================
// ========== פונקציית עזר להמרת פרק - הגרסה המתוקנת ==========
// ===================================================================
function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.showIds || !episode.showIds.imdb) return null;
    return {
        // התיקון: הסרנו את ה-"tt" המיותר. המשתנה כבר מכיל אותו.
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
        type: 'series',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        // התיקון: הסרנו את ה-"tt" המיותר גם מכאן
        poster: episode.showIds.imdb,
        background: episode.showIds.imdb,
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

// Handler ראשי
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];

    // בקשה למניפסט
    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    // בקשה לקטלוג
    if (path.startsWith('/catalog/series/shuffled-episodes')) {
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

    // אם לא זו ולא זו, החזר 404
    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
