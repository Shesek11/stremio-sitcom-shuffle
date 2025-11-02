const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// ID ייחודי לסדרה הוירטואלית שלנו
const SHUFFLE_SERIES_ID = 'shfl:sitcom_shuffle';

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '19.0.0', // The Playlist Version
    name: 'Sitcom Shuffle',
    description: 'A playlist of random shuffled sitcom episodes.',
    catalogs: [{ type: 'series', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    // הוספנו stream handler
    resources: ['catalog', 'meta', 'stream'], 
    types: ['series'],
    idPrefixes: [SHUFFLE_SERIES_ID.split(':')[0]]
};

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
    
    // ================== CATALOG HANDLER ==================
    if (path.startsWith('/catalog/series/shuffled-episodes')) {
        try {
            const allEpisodes = await getShuffledEpisodes();
            const metas = allEpisodes.map((episode, index) => {
                 if (!episode) return null;
                 return {
                    // ה-ID מצביע על פרק בסדרה הוירטואלית שלנו
                    id: `${SHUFFLE_SERIES_ID}:1:${index + 1}`,
                    type: 'series',
                    name: `${episode.showTitle} - S${episode.season}E${episode.episode}`,
                    poster: episode.showPoster || null
                 };
            }).filter(Boolean);
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    // ================== META HANDLER ==================
    if (path.startsWith('/meta/series/')) {
        try {
            const seriesId = path.split('/')[3].replace('.json', '');
            if (seriesId !== SHUFFLE_SERIES_ID) {
                return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
            }

            const allEpisodes = await getShuffledEpisodes();
            const metaObject = {
                id: SHUFFLE_SERIES_ID,
                type: 'series',
                name: 'Sitcom Shuffle Playlist',
                poster: 'https://via.placeholder.com/300x450/1a1a2e/ffffff?text=Sitcom%0AShuffle',
                description: 'A continuously shuffled playlist of your favorite sitcom episodes.',
                // בניית רשימת ה"פרקים" של הסדרה הוירטואלית
                videos: allEpisodes.map((episode, index) => ({
                    id: `${SHUFFLE_SERIES_ID}:1:${index + 1}`,
                    title: `${episode.showTitle} - S${episode.season}E${episode.episode}`,
                    season: 1,
                    episode: index + 1,
                    overview: episode.overview
                }))
            };
            return res.send(JSON.stringify({ meta: metaObject }));
        } catch (error) {
            console.error("Error in meta handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    // ================== STREAM HANDLER ==================
    if (path.startsWith('/stream/series/')) {
        try {
            const fullId = path.split('/')[3].replace('.json', ''); // shfl:sitcom_shuffle:1:25
            const parts = fullId.split(':');
            const seriesId = `${parts[0]}:${parts[1]}`;
            const episodeNum = parseInt(parts[3]);

            if (seriesId !== SHUFFLE_SERIES_ID) {
                return res.status(404).send(JSON.stringify({ streams: [] }));
            }

            const allEpisodes = await getShuffledEpisodes();
            // מצא את הפרק האמיתי שתואם למספר הסידורי
            const targetEpisode = allEpisodes[episodeNum - 1];

            if (!targetEpisode) {
                return res.status(404).send(JSON.stringify({ streams: [] }));
            }

            // ה-ID האמיתי של הפרק (עבור Torrentio)
            const realEpisodeId = `${targetEpisode.showIds.imdb}:${targetEpisode.season}:${targetEpisode.episode}`;
            
            console.log(`Redirecting stream request for virtual episode ${episodeNum} to real ID ${realEpisodeId}`);

            // בצע הפניה ל-Stremio עצמו
            return res.status(302).set('Location', `stremio:///stream/series/${realEpisodeId}.json`).send();

        } catch (error) {
            console.error("Error in stream handler:", error);
            return res.status(500).send(JSON.stringify({ streams: [] }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
