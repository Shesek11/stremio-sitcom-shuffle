const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '26.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ 
        type: 'series',
        id: 'shuffled-episodes', 
        name: 'Shuffled Sitcom Episodes',
        extra: [
            { name: 'skip', isRequired: false }
        ]
    }],
    resources: ['catalog', 'meta'],
    types: ['series'],
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
    if (path.startsWith('/catalog/series/shuffled-episodes')) {
        try {
            const allEpisodes = await getShuffledEpisodes();
            const metas = allEpisodes.map(episode => {
                if (!episode || !episode.showIds?.imdb) return null;
                
                const seriesId = episode.showIds.imdb;
                
                return {
                    id: seriesId,
                    type: 'series',
                    name: episode.showTitle,
                    poster: episode.showPoster,
                    posterShape: 'poster',
                    background: episode.showFanart,
                    logo: episode.showPoster,
                    description: `Random episode from ${episode.showTitle}\n\nCurrent shuffle: S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')} - ${episode.title || 'Episode ' + episode.episode}\n\n${episode.overview || ''}`,
                    releaseInfo: String(episode.showYear || ''),
                    genres: ['Comedy'],
                    // המידע החשוב - איזה פרק להציג
                    _shuffled_episode: {
                        season: episode.season,
                        episode: episode.episode,
                        title: episode.title
                    }
                };
            }).filter(Boolean);
            
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }

    // Meta Handler for Series
    if (path.startsWith('/meta/series/')) {
        try {
            const seriesId = path.split('/')[3].replace('.json', '');
            const allEpisodes = await getShuffledEpisodes();
            
            // מצא את הפרק הרנדומלי של הסדרה הזו
            const episodeData = allEpisodes.find(ep => ep.showIds?.imdb === seriesId);

            if (!episodeData) {
                return res.status(404).send(JSON.stringify({ err: 'Series not found' }));
            }
            
            // בניית meta של סדרה עם הפרק הספציפי
            const metaObject = {
                id: seriesId,
                type: 'series',
                name: episodeData.showTitle,
                poster: episodeData.showPoster,
                posterShape: 'poster',
                background: episodeData.showFanart,
                logo: episodeData.showPoster,
                description: `**Random Shuffle Mode**\n\nCurrent episode: S${String(episodeData.season).padStart(2, '0')}E${String(episodeData.episode).padStart(2, '0')} - ${episodeData.title || 'Episode ' + episodeData.episode}\n\n${episodeData.overview || 'No description available'}\n\n━━━━━━━━━━━━━━\n📺 ${episodeData.showTitle}\n🎬 ${episodeData.showYear || 'N/A'}`,
                releaseInfo: String(episodeData.showYear || ''),
                genres: ['Comedy'],
                runtime: '22 min',
                country: 'USA',
                language: 'en',
                imdbRating: '8.0',
                // הגדרת הווידאו של הפרק הספציפי
                videos: [
                    {
                        id: `${seriesId}:${episodeData.season}:${episodeData.episode}`,
                        title: episodeData.title || `Episode ${episodeData.episode}`,
                        released: new Date(episodeData.showYear || 2000, 0, 1).toISOString(),
                        season: episodeData.season,
                        episode: episodeData.episode,
                        overview: episodeData.overview || '',
                        thumbnail: episodeData.showPoster
                    }
                ],
                links: [
                    {
                        name: 'IMDb',
                        category: 'imdb',
                        url: `https://www.imdb.com/title/${seriesId}/`
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
