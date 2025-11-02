const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

// ========== הגדרות - מלא את הפרטים שלך כאן ==========
const CONFIG = {
    TRAKT_USERNAME: 'Shesek',      // שם המשתמש שלך ב-Trakt
    TRAKT_LIST_SLUG: 'sitcom-shuffle',          // slug של רשימת הסדרות (מה-URL)
    TRAKT_CLIENT_ID: '41f49f5007a6b18f0248d4a905013dd60160a0f915cfb163fb1e822e33f43c69',          // Client ID מ-Trakt
    TRAKT_ACCESS_TOKEN: 'a78753624445dee3d2d6774f1aa2592cca65a28a44bdb16989c3ae2e4ab31bbd',    // Access Token שקיבלת
    CACHE_TTL: 3600000,                         // זמן שמירה של cache (1 שעה)
    SHUFFLE_REFRESH: 86400000                   // רענון ה-shuffle כל 24 שעות
};

// ========== Manifest - מידע על ה-Addon ==========
const manifest = {
    id: 'community.sitcom.shuffle',
    version: '1.0.0',
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

// ========== Cache ==========
let episodesCache = null;
let lastShuffleTime = 0;

// ========== פונקציות עזר ==========

// Headers לבקשות Trakt
function getTraktHeaders() {
    return {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': CONFIG.TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${CONFIG.TRAKT_ACCESS_TOKEN}`
    };
}

// שליפת רשימת הסדרות מ-Trakt
async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows`;
    
    const response = await fetch(url, { headers: getTraktHeaders() });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch list: ${response.status} ${response.statusText}`);
    }
    
    const items = await response.json();
    return items.map(item => item.show);
}

// שליפת כל הפרקים של סדרה
async function getShowEpisodes(showSlug) {
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`;
    
    const response = await fetch(url, { headers: getTraktHeaders() });
    
    if (!response.ok) {
        console.error(`Failed to fetch episodes for ${showSlug}`);
        return [];
    }
    
    const seasons = await response.json();
    const episodes = [];
    
    for (const season of seasons) {
        if (season.number === 0) continue; // דילוג על specials
        
        for (const episode of season.episodes || []) {
            episodes.push({
                showSlug,
                showTitle: '', // נמלא מאוחר יותר
                season: season.number,
                episode: episode.number,
                title: episode.title || `Episode ${episode.number}`,
                overview: episode.overview || '',
                ids: episode.ids
            });
        }
    }
    
    return episodes;
}

// שליפת כל הפרקים מכל הסדרות
async function getAllEpisodes() {
    console.log('Fetching shows from Trakt list...');
    const shows = await getShowsFromList();
    console.log(`Found ${shows.length} shows`);
    
    const allEpisodes = [];
    
    for (const show of shows) {
        console.log(`Fetching episodes for: ${show.title}`);
        const episodes = await getShowEpisodes(show.ids.slug);
        
        // הוסף את שם הסדרה לכל פרק
        episodes.forEach(ep => {
            ep.showTitle = show.title;
            ep.showYear = show.year;
            ep.showIds = show.ids;
        });
        
        allEpisodes.push(...episodes);
        
        // המתנה קצרה כדי לא להכביד על ה-API
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log(`Total episodes collected: ${allEpisodes.length}`);
    return allEpisodes;
}

// ערבוב מערך (Fisher-Yates shuffle)
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// המרת פרק לפורמט Stremio
function episodeToMeta(episode, index) {
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

// ========== Catalog Handler ==========
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'series' || id !== 'shuffled-episodes') {
        return { metas: [] };
    }
    
    // בדיקה אם צריך רענון
    const now = Date.now();
    const needsRefresh = !episodesCache || 
                        (now - lastShuffleTime) > CONFIG.SHUFFLE_REFRESH;
    
    if (needsRefresh) {
        console.log('Refreshing episodes cache and shuffling...');
        try {
            const episodes = await getAllEpisodes();
            episodesCache = shuffleArray(episodes);
            lastShuffleTime = now;
            console.log(`Cache refreshed with ${episodesCache.length} episodes`);
        } catch (error) {
            console.error('Error fetching episodes:', error);
            return { metas: [] };
        }
    }
    
    // pagination
    const skip = parseInt(extra.skip) || 0;
    const limit = 100;
    const paginatedEpisodes = episodesCache.slice(skip, skip + limit);
    
    const metas = paginatedEpisodes.map((ep, idx) => 
        episodeToMeta(ep, skip + idx)
    );
    
    return { metas };
});

// ========== הפעלת השרת ==========
module.exports = builder.getInterface();
