const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '21.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'movie', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    resources: ['catalog', 'meta'],
    types: ['movie'],
    idPrefixes: ['tt']
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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];

    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    // Catalog Handler
    if (path.startsWith('/catalog/movie/shuffled-episodes')) {
        try {
            const allEpisodes = await getShuffledEpisodes();
            const metas = allEpisodes.map((episode, index) => {
                if (!episode || !episode.ids?.imdb) return null;
                
                // שימוש ב-IMDB ID של הפרק עצמו
                const episodeImdbId = episode.ids.imdb;
                
                return {
                    id: episodeImdbId,
                    type: 'movie',
                    name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')} - ${episode.title}`,
                    poster: episode.showPoster || null,
                    background: episode.showFanart || null,
                    description: episode.overview || '',
                    releaseInfo: `${episode.showYear || ''}`
                };
            }).filter(Boolean);
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    // Meta Handler
    if (path.startsWith('/meta/movie/')) {
        try {
            const episodeImdbId = path.split('/')[3].replace('.json', '');
            const allEpisodes = await getShuffledEpisodes();
            
            // חיפוש לפי IMDB ID של הפרק
            const episodeData = allEpisodes.find(ep => ep.ids?.imdb === episodeImdbId);

            if (!episodeData) {
                return res.status(404).send(JSON.stringify({ err: 'Episode not found' }));
            }
            
            const metaObject = {
                id: episodeImdbId,
                type: 'movie',
                name: `${episodeData.showTitle} - S${String(episodeData.season).padStart(2, '0')}E${String(episodeData.episode).padStart(2, '0')} - ${episodeData.title}`,
                poster: episodeData.showPoster,
                background: episodeData.showFanart,
                description: `${episodeData.overview || 'No description available'}\n\nShow: ${episodeData.showTitle}\nSeason ${episodeData.season}, Episode ${episodeData.episode}`,
                releaseInfo: `${episodeData.showYear || ''}`,
                imdbRating: episodeData.rating || null,
                // מידע נוסף שיכול לעזור
                links: [
                    {
                        name: "IMDb",
                        category: "imdb",
                        url: `https://www.imdb.com/title/${episodeImdbId}/`
                    }
                ]
            };

            return res.send(JSON.stringify({ meta: metaObject }));

        } catch (error) {
            console.error("Error in meta handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
