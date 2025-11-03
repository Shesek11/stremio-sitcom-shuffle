const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '28.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms - continuous playback',
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
    if (path.startsWith('/meta/movie/')) {
        try {
            const fullId = path.split('/')[3].replace('.json', '');
            const [seriesId, season, episodeNum] = fullId.split(':');

            const allEpisodes = await getShuffledEpisodes();
            
            // מציאת הפרק הנוכחי
            const currentIndex = allEpisodes.findIndex(ep => 
                ep.showIds.imdb === seriesId && 
                ep.season == season && 
                ep.episode == episodeNum
            );

            if (currentIndex === -1) {
                return res.status(404).send(JSON.stringify({ err: 'Episode not found' }));
            }

            const episodeData = allEpisodes[currentIndex];
            
            // יצירת רשימת פרקים לרצף השידור - הפרק הנוכחי + 10 הבאים
            const playlistSize = 10;
            const videos = [];
            
            for (let i = 0; i <= playlistSize && (currentIndex + i) < allEpisodes.length; i++) {
                const ep = allEpisodes[currentIndex + i];
                videos.push({
                    id: `${ep.showIds.imdb}:${ep.season}:${ep.episode}`,
                    title: `${ep.showTitle} - S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')} - ${ep.title}`,
                    released: new Date().toISOString(),
                    overview: ep.overview || '',
                    thumbnail: ep.showPoster || null,
                    streams: []
                });
            }
            
            const metaObject = {
                id: fullId,
                type: 'movie',
                name: `${episodeData.showTitle} - S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`,
                poster: episodeData.showPoster,
                background: episodeData.showFanart,
                description: `🔀 **Shuffle Mode - Continuous Playback**\n\n**${episodeData.title}**\n\n${episodeData.overview || 'No description available'}\n\n━━━━━━━━━━\n📺 Show: ${episodeData.showTitle}\n📅 Season ${episodeData.season}, Episode ${episodeData.episode}\n🎬 Year: ${episodeData.showYear || 'N/A'}\n\n▶️ Playing ${playlistSize + 1} episodes in sequence`,
                releaseInfo: `${episodeData.showYear || ''}`,
                videos: videos,
                behaviorHints: {
                    defaultVideoId: fullId,
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
