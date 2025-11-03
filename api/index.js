const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '25.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ 
        type: 'movie', 
        id: 'shuffled-episodes', 
        name: 'Shuffled Sitcom Episodes'
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
                if (!episode || !episode.showIds?.imdb) return null;
                
                const metaId = `${episode.showIds.imdb}:${episode.season}:${episode.episode}`;
                
                return {
                    id: metaId,
                    type: 'movie',
                    name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
                    poster: episode.showPoster || 'https://via.placeholder.com/300x450/1a1a2e/ffffff?text=No+Poster',
                    background: episode.showFanart || episode.showPoster,
                    logo: episode.showPoster,
                    description: `${episode.title || 'Episode ' + episode.episode}\n\n${episode.overview || ''}\n\n${episode.showTitle} - Season ${episode.season}, Episode ${episode.episode}`,
                    releaseInfo: String(episode.showYear || ''),
                    imdbRating: episode.rating || '7.5',
                    genres: ['Comedy', 'TV Show'],
                    runtime: '22 min'
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
            const [seriesImdbId, seasonStr, episodeStr] = fullId.split(':');
            const season = parseInt(seasonStr);
            const episodeNum = parseInt(episodeStr);
            
            const allEpisodes = await getShuffledEpisodes();
            const episodeData = allEpisodes.find(ep => 
                ep.showIds?.imdb === seriesImdbId && 
                ep.season === season && 
                ep.episode === episodeNum
            );

            if (!episodeData) {
                return res.status(404).send(JSON.stringify({ err: 'Episode not found' }));
            }
            
            const metaObject = {
                id: fullId,
                type: 'movie',
                name: `${episodeData.showTitle} - S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} - ${episodeData.title || 'Episode ' + episodeNum}`,
                poster: episodeData.showPoster || 'https://via.placeholder.com/300x450/1a1a2e/ffffff?text=No+Poster',
                background: episodeData.showFanart || episodeData.showPoster || 'https://via.placeholder.com/1920x1080/1a1a2e/ffffff?text=No+Background',
                logo: episodeData.showPoster,
                description: `**${episodeData.title || 'Episode ' + episodeNum}**\n\n${episodeData.overview || 'No description available.'}\n\n━━━━━━━━━━━━━━\n📺 Show: ${episodeData.showTitle}\n📅 Season ${season}, Episode ${episodeNum}\n🎬 Year: ${episodeData.showYear || 'N/A'}`,
                releaseInfo: String(episodeData.showYear || ''),
                imdbRating: episodeData.rating || '7.5',
                genres: ['Comedy', 'TV Show'],
                runtime: '22 min',
                country: 'USA',
                language: 'English',
                director: [],
                cast: [],
                links: [
                    {
                        name: 'IMDb Series',
                        category: 'imdb',
                        url: `https://www.imdb.com/title/${seriesImdbId}/episodes?season=${season}`
                    }
                ],
                behaviorHints: {
                    defaultVideoId: null,
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
