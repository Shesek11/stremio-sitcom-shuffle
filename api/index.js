const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '23.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ type: 'series', id: 'shuffled-episodes', name: 'Shuffled Sitcom Episodes' }],
    resources: ['catalog', 'meta'],
    types: ['series'],
    idPrefixes: ['scs']
};

async function getShuffledEpisodes() {
    console.log('Fetching blob URL from KV store...');
    const blobUrl = await kv.get('episodes_blob_url');
    if (!blobUrl) throw new Error('Blob URL not found. Cron job may not have run yet.');

    console.log(`Fetching latest episode data from Blob URL: ${blobUrl}`);
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Failed to fetch episode blob: ${response.statusText}`);

    const episodes = await response.json();
    console.log(`Successfully fetched ${episodes.length} episodes from blob.`);
    return episodes;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');

    const path = decodeURIComponent(req.url.split('?')[0]);

    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }

    // Catalog Handler
    if (path.startsWith('/catalog/series/shuffled-episodes')) {
        try {
            const allEpisodes = await getShuffledEpisodes();
            const metas = allEpisodes.map(episode => {
                 if (!episode || !episode.showIds?.imdb) return null;
                 return {
                    id: `scs:${episode.showIds.imdb}:${episode.season}:${episode.episode}`,
                    type: 'series',
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

            // Parse scs:ttXXXXXXX:season:episode
            if (fullId.startsWith('scs:')) {
                const parts = fullId.substring(4).split(':');
                const [seriesId, season, episodeNum] = parts;

                const allEpisodes = await getShuffledEpisodes();
                const episodeData = allEpisodes.find(
                    ep => ep.showIds.imdb === seriesId && ep.season == season && ep.episode == episodeNum
                );

                if (episodeData) {
                    const metaObject = {
                        id: fullId,
                        type: 'series',
                        name: `${episodeData.showTitle} - S${String(season).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`,
                        poster: episodeData.showPoster || null,
                        background: episodeData.showFanart || null,
                        description: `${episodeData.showTitle}\n\nEpisode: "${episodeData.title}"\n\n${episodeData.overview || ''}`,
                        releaseInfo: `${episodeData.showYear || ''}`,
                        // videos array with standard tt:season:episode ID
                        // so stream addons (Torrentio etc.) can resolve streams
                        videos: [{
                            id: `${seriesId}:${season}:${episodeNum}`,
                            title: episodeData.title || `Episode ${episodeNum}`,
                            season: Number(season),
                            episode: Number(episodeNum),
                            released: new Date().toISOString(),
                            overview: episodeData.overview || ''
                        }]
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
