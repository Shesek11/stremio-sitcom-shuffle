const { addonBuilder } = require('stremio-addon-sdk');
const { kv } = require('@vercel/kv');

const manifest = {
    id: 'community.sitcom.shuffle',
    version: '3.0.0-debug', // גרסת דיבאג
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [
        {
            type: 'series',
            id: 'shuffled-episodes',
            name: 'Shuffled Sitcom Episodes',
            extra: [{ name: 'skip', isRequired: false }]
        }
    ],
    resources: ['catalog'],
    types: ['series'],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

function episodeToMeta(episode, index) {
    if (!episode || !episode.ids) return null;
    return {
        id: `tt${episode.ids.imdb || episode.ids.trakt}`,
        type: 'series',
        name: `${episode.showTitle} - S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        poster: `https://via.placeholder.com/300x450/1a1a2e/16213e?text=${encodeURIComponent(episode.showTitle)}`,
        background: `https://via.placeholder.com/1920x1080/1a1a2e/16213e?text=${encodeURIComponent(episode.showTitle)}`,
        description: `${episode.title}\n\n${episode.overview}\n\n📺 ${episode.showTitle} (${episode.showYear})\n🎲 Shuffle Position: ${index + 1}`,
        releaseInfo: `S${episode.season}E${episode.episode}`,
        genres: ['Comedy', 'Sitcom']
    };
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const startTime = Date.now();
    console.log(`[${startTime}] HANDLER STARTED.`);

    if (type !== 'series' || id !== 'shuffled-episodes') {
        return { metas: [] };
    }

    try {
        const skip = parseInt(extra.skip) || 0;
        const limit = 20;
        const stop = skip + limit - 1;

        console.log(`[${Date.now() - startTime}ms] STEP 1: Fetching range ${skip}-${stop} from KV.`);
        const paginatedEpisodeStrings = await kv.lrange('shuffled-episodes', skip, stop);
        console.log(`[${Date.now() - startTime}ms] STEP 2: KV fetch completed. Found ${paginatedEpisodeStrings?.length || 0} items.`);

        if (!paginatedEpisodeStrings || paginatedEpisodeStrings.length === 0) {
            console.log(`[${Date.now() - startTime}ms] No episodes found, returning empty.`);
            return { metas: [] };
        }

        console.log(`[${Date.now() - startTime}ms] STEP 3: Starting JSON.parse loop.`);
        const parsedEpisodes = paginatedEpisodeStrings.map(epString => JSON.parse(epString));
        console.log(`[${Date.now() - startTime}ms] STEP 4: JSON.parse loop finished.`);

        console.log(`[${Date.now() - startTime}ms] STEP 5: Starting episodeToMeta map loop.`);
        const metas = parsedEpisodes
            .map((epObject, idx) => episodeToMeta(epObject, skip + idx))
            .filter(meta => meta !== null);
        console.log(`[${Date.now() - startTime}ms] STEP 6: episodeToMeta map finished.`);

        console.log(`[${Date.now() - startTime}ms] HANDLER FINISHED SUCCESSFULLY. Returning ${metas.length} metas.`);
        return { metas };

    } catch (error) {
        console.error(`[${Date.now() - startTime}ms] FATAL ERROR in Catalog Handler:`, error);
        return { metas: [] };
    }
});

module.exports = builder.getInterface();
