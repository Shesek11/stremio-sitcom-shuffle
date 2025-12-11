const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '22.0.0', // הגרסה הסופית באמת
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'movie', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tt']
};

function episodeToMeta(episode, index) {
    if (!episode || !episode.showIds?.imdb) return null;
    return {
        id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
        type: 'movie',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: episode.showPoster || null,
        background: episode.showFanart || null,
        description: `This is a random episode from '${episode.showTitle}'.\n\nEpisode Title: "${episode.title}"\n\n${episode.overview}`,
        releaseInfo: `${episode.showYear || ''}`
    };
}

// ===================================================================
// ========== הסרנו את המטמון: הפונקציה תמיד תוריד את הקובץ מחדש ==========
// ===================================================================
async function getShuffledEpisodes() {
    console.log('Fetching blob URL from KV store (no in-memory cache)...');
    const blobUrl = await kv.get('episodes_blob_url');
    if (!blobUrl) throw new Error('Blob URL not found. Cron job may not have run yet.');

    console.log(`Fetching latest episode data from Blob URL: ${blobUrl}`);
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Failed to fetch episode blob: ${response.statusText}`);
    
    const episodes = await response.json();
    console.log(`Successfully fetched ${episodes.length} episodes from blob.`);
    return episodes;
}

// Handler ראשי
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = req.url.split('?')[0];
    const pathParts = path.split('/');

    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    // Catalog Handler
    if (path.startsWith('/catalog/movie/shuffled-episodes')) {
        try {
            const allEpisodes = await getShuffledEpisodes();
            const metas = allEpisodes.map(episode => {
                 if (!episode || !episode.showIds?.imdb) return null;
                 return {
                    id: `${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
                    type: 'movie',
                    name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
                    poster: episode.showPoster || null
                 };
            }).filter(Boolean);
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    // Meta Handler
    if (path.startsWith('/meta/')) {
        try {
            const fullId = path.split('/')[3].replace('.json', '');
            if (fullId.includes(':')) {
                const [seriesId, season, episodeNum] = fullId.split(':');
                const allEpisodes = await getShuffledEpisodes();
                const episodeData = allEpisodes.find(ep => ep.showIds.imdb === seriesId && ep.season == season && ep.episode == episodeNum);

                if (episodeData) {
                    const metaObject = {
                        id: fullId,
                        type: 'movie',
                        name: `${episodeData.showTitle} - S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`,
                        poster: episodeData.showPoster,
                        background: episodeData.showFanart,
                        description: `This is a random episode from '${episodeData.showTitle}'.\n\nEpisode Title: "${episodeData.title}"\n\n${episodeData.overview}`,
                        releaseInfo: `${episodeData.showYear || ''}`
                    };
                    return res.send(JSON.stringify({ meta: metaObject }));
                }
            }
        } catch (error) {
            console.error("Error in meta handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
