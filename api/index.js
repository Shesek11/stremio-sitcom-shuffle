const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// המניפסט מגדיר קטלוג מסוג 'movie' עם ה-ID היציב
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '9.0.0', // הגרסה הסופית
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [
        {
            type: 'movie',
            id: 'shuffled-episodes', // ה-ID היציב
            name: 'Shuffled Sitcom Episodes'
        }
    ],
    resources: ['catalog'],
    types: ['movie'],
    idPrefixes: ['tt']
};

// פונקציה שמייצרת אובייקט 'movie'
function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.showIds || !episode.showIds.imdb) return null;
    return {
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
        type: 'movie',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: episode.showIds.imdb,
        background: episode.showIds.imdb,
        description: `This is a random episode from '${episode.showTitle}'.\n\nEpisode Title: "${episode.title}"\n\n${episode.overview}`
    };
}

// ... (פונקציית getShuffledEpisodes נשארת זהה לחלוטין)
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

// ===================================================================
// ========== Handler ראשי עם נתב חכם ורישום מלא ==========
// ===================================================================
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    // שלב 1: רישום מלא של כל בקשה נכנסת
    console.log(`[REQUEST RECEIVED] Full URL: ${req.url}`);

    const path = req.url.split('?')[0];
    const pathParts = path.split('/'); // לדוגמה: ['', 'catalog', 'movie', 'shuffled-episodes.json']

    // טיפול בבקשת המניפסט
    if (path === '/manifest.json') {
        console.log('[ROUTER] Matched /manifest.json');
        return res.send(JSON.stringify(manifest));
    }

    // טיפול בבקשות קטלוג
    if (pathParts[1] === 'catalog' && pathParts.length >= 4) {
        const type = pathParts[2]; // 'movie' או 'series' וכו'
        const id = pathParts[3].replace('.json', '');
        
        console.log(`[ROUTER] Parsed catalog request. Type: "${type}", ID: "${id}"`);

        // נגיב רק ל-ID שלנו, לא משנה מה ה-type ש-Stremio ביקש (חסין לבעיות מטמון)
        if (id === 'shuffled-episodes') {
            console.log('[ROUTER] Matched catalog ID "shuffled-episodes". Processing...');
            try {
                const skip = parseInt(req.query.skip) || 0;
                const limit = 50;

                const allEpisodes = await getShuffledEpisodes();
                const paginatedEpisodes = allEpisodes.slice(skip, skip + limit);
                const metas = paginatedEpisodes
                    .map((ep, idx) => episodeToMeta(ep, skip + idx))
                    .filter(Boolean);

                console.log(`[ROUTER] Success. Returning ${metas.length} metas.`);
                return res.send(JSON.stringify({ metas }));
            } catch (error) {
                console.error("[ROUTER] Error in catalog handler:", error);
                return res.status(500).send(JSON.stringify({ error: error.message }));
            }
        }
    }

    // אם הבקשה לא זוהתה, נרשום אותה ונחזיר 404
    console.log(`[ROUTER] No match found for path: "${path}". Returning 404.`);
    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
