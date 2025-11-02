const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '13.0.0', // הגרסה היציבה והנכונה
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'series', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    // הוספנו meta handler
    resources: ['catalog', 'meta'], 
    types: ['series'],
    idPrefixes: ['tt']
};

let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 דקות

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

// Handler ראשי
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];
    const pathParts = path.split('/');

    // בקשה למניפסט
    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    // בקשה לקטלוג
    if (pathParts[1] === 'catalog' && pathParts[2] === 'series' && pathParts[3]?.startsWith('shuffled-episodes')) {
        try {
            const skip = parseInt(req.query.skip) || 0;
            const limit = 50;
            const allEpisodes = await getShuffledEpisodes();
            const paginatedEpisodes = allEpisodes.slice(skip, skip + limit);

            const metas = paginatedEpisodes.map(episode => {
                if (!episode || !episode.showIds || !episode.showIds.imdb) return null;
                return {
                    id: episode.showIds.imdb,
                    type: 'series',
                    name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
                    poster: episode.showPoster || null,
                    // הפרמטר הנסתר שלנו!
                    posterShape: `episode=${episode.season}:${episode.episode}`
                };
            }).filter(Boolean);

            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    // בקשה למידע (Meta)
    if (pathParts[1] === 'meta' && pathParts[2] === 'series' && pathParts[3]) {
        try {
            const seriesId = pathParts[3].replace('.json', '');
            const [season, episodeNum] = req.query.episode.split(':');
            
            const allEpisodes = await getShuffledEpisodes();
            // מצא את הפרק המדויק מהרשימה שלנו
            const episodeData = allEpisodes.find(ep => ep.showIds.imdb === seriesId && ep.season == season && ep.episode == episodeNum);

            if (!episodeData) {
                return res.status(404).send(JSON.stringify({ err: 'Episode not found in our data' }));
            }
            
            // בנה אובייקט meta מלא עם הפרק הבודד
            const metaObject = {
                id: episodeData.showIds.imdb,
                type: 'series',
                name: episodeData.showTitle,
                poster: episodeData.showPoster,
                background: episodeData.showFanart,
                description: `Displaying random episode:\nS${season}E${episodeNum} - ${episodeData.title}\n\n${episodeData.overview}`,
                videos: [{
                    id: `${episodeData.showIds.imdb}:${season}:${episodeNum}`,
                    title: `S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}: ${episodeData.title}`,
                    season: parseInt(season),
                    episode: parseInt(episodeNum),
                    released: new Date() // Stremio דורש תאריך כלשהו
                }]
            };

            return res.send(JSON.stringify({ meta: metaObject }));

        } catch (error) {
            console.error("Error in meta handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
