const manifest = {
    id: 'community.sitcom.shuffle',
    version: '12.0.0',
    name: 'Sitcom Shuffle',
    description: 'Random shuffled episodes from your favorite sitcoms',
    catalogs: [{ 
        type: 'series', // שינוי מ-movie ל-series
        id: 'shuffled-episodes', 
        name: 'Shuffled Sitcom Episodes' 
    }],
    resources: ['catalog', 'meta'], // הוספת meta resource
    types: ['series'], // שינוי מ-movie ל-series
    idPrefixes: ['tt']
};

function episodeToMeta(episode, index) {
    if (!episode || !episode.ids || !episode.showIds || !episode.showIds.imdb) return null;
    
    // יצירת ID ייחודי עבור הפרק הספציפי הזה
    const uniqueId = `${episode.showIds.imdb}:${episode.season}:${episode.episode}:${index}`;
    
    return {
        id: uniqueId,
        type: 'series',
        name: episode.showTitle, // שם הסדרה
        poster: episode.showPoster || 'https://via.placeholder.com/300x450?text=No+Poster',
        background: episode.showFanart || episode.showPoster,
        description: episode.showOverview || `A random episode from ${episode.showTitle}`,
        releaseInfo: episode.year?.toString(),
        
        // מידע על הפרק הספציפי
        videos: [{
            id: uniqueId,
            title: episode.title || `Episode ${episode.episode}`,
            season: episode.season,
            episode: episode.episode,
            released: episode.firstAired || new Date().toISOString(),
            overview: episode.overview || '',
            thumbnail: episode.thumbnail || episode.showPoster
        }]
    };
}

// הוספת handler ל-meta resource
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    
    const path = req.url.split('?')[0];
    const pathParts = path.split('/');
    
    if (path === '/manifest.json') {
        return res.send(JSON.stringify(manifest));
    }
    
    // Handler לקטלוג
    if (pathParts[1] === 'catalog' && pathParts[2] === 'series' && 
        pathParts[3]?.startsWith('shuffled-episodes')) {
        try {
            const skip = parseInt(req.query.skip) || 0;
            const limit = 50;
            const allEpisodes = await getShuffledEpisodes();
            const paginatedEpisodes = allEpisodes.slice(skip, skip + limit);
            const metas = paginatedEpisodes
                .map((ep, idx) => episodeToMeta(ep, skip + idx))
                .filter(Boolean);
            return res.send(JSON.stringify({ metas }));
        } catch (error) {
            console.error("Error in catalog handler:", error);
            return res.status(500).send(JSON.stringify({ error: error.message }));
        }
    }
    
    // Handler למטא-דאטה של פרק ספציפי
    if (pathParts[1] === 'meta' && pathParts[2] === 'series') {
        const id = pathParts[3]?.replace('.json', '');
        if (id) {
            try {
                const allEpisodes = await getShuffledEpisodes();
                const [showId, season, episode, index] = id.split(':');
                const foundEpisode = allEpisodes.find((ep, idx) => 
                    ep.showIds?.imdb === showId && 
                    ep.season === parseInt(season) && 
                    ep.episode === parseInt(episode) &&
                    idx === parseInt(index)
                );
                
                if (foundEpisode) {
                    const meta = episodeToMeta(foundEpisode, parseInt(index));
                    return res.send(JSON.stringify({ meta }));
                }
            } catch (error) {
                console.error("Error in meta handler:", error);
            }
        }
        return res.status(404).send(JSON.stringify({ error: 'Meta not found' }));
    }
    
    return res.status(404).send(JSON.stringify({ error: 'Not Found' }));
};
