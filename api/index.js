const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '23.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ 
        type: 'movie', 
        id: 'shuffled-episodes', 
        name: 'Shuffled Sitcom Episodes',
        extra: [{ name: 'skip', isRequired: false }]
    }],
    resources: ['catalog', 'meta'],
    types: ['movie'],
    idPrefixes: ['tt']
};

let allEpisodesCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

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
            const metas = allEpisodes.map(episode => {
                if (!episode || !episode.ids?.imdb) return null;
                
                return {
                    id: episode.ids.imdb,
                    type: 'movie',
                    name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
                    poster: episode.showPoster,
                    posterShape: 'poster',
                    background: episode.showFanart,
                    logo: episode.showPoster,
                    description: episode.overview || `${episode.title}\n\n${episode.showTitle} - Season ${episode.season}, Episode ${episode.episode}`,
                    releaseInfo: String(episode.showYear || ''),
                    runtime: '23 min',
                    website: `https://www.imdb.com/title/${episode.ids.imdb}/`
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
            const episodeData = allEpisodes.find(ep => ep.ids?.imdb === episodeImdbId);

            if (!episodeData) {
                return res.status(404).send(JSON.stringify({ err: 'Episode not found' }));
            }
            
            const metaObject = {
                id: episodeImdbId,
                type: 'movie',
                name: `${episodeData.showTitle} - S${String(episodeData.season).padStart(2, '0')}E${String(episodeData.episode).padStart(2, '0')}`,
                poster: episodeData.showPoster,
                posterShape: 'poster',
                background: episodeData.showFanart,
                logo: episodeData.showPoster,
                description: `**${episodeData.title}**\n\n${episodeData.overview || 'No description available'}\n\n━━━━━━━━━━\n📺 Show: ${episodeData.showTitle}\n📅 Season ${episodeData.season}, Episode ${episodeData.episode}\n🎬 Year: ${episodeData.showYear || 'N/A'}`,
                releaseInfo: String(episodeData.showYear || ''),
                runtime: '23 min',
                genres: ['Comedy', 'Sitcom'],
                director: [],
                cast: [],
                links: [
                    {
                        name: 'IMDb',
                        category: 'imdb',
                        url: `https://www.imdb.com/title/${episodeImdbId}/`
                    }
                ],
                trailerStreams: [],
                behaviorHints: {
                    defaultVideoId: episodeImdbId,
                    hasScheduledVideos: false
                }
            };

            return res.send(JSON.stringify({ meta: metaObject }));

        } catch (error) {
            console.error("Error in meta handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
