const { put } = require('@vercel/blob');
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// ... (קוד הגדרות ופונקציות getTraktHeaders, getShowEpisodes, shuffleArray נשאר זהה)

async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${process.env.TRAKT_USERNAME}/lists/${process.env.TRAKT_LIST_SLUG}/items/shows?extended=images`;
    const response = await fetch(url, { headers: getTraktHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch Trakt list: ${response.statusText}`);
    const items = await response.json();
    return items.map(item => item.show);
}

async function getAllEpisodes() {
    console.log('Fetching shows from Trakt list...');
    const shows = await getShowsFromList();
    console.log(`Found ${shows.length} shows.`);
    const allEpisodes = [];
    for (const show of shows) {
        console.log(`Fetching episodes for: ${show.title}`);
        const episodes = await getShowEpisodes(show.ids.slug);
        
        episodes.forEach(ep => {
            ep.showTitle = show.title;
            ep.showYear = show.year;
            ep.showIds = show.ids;

            // ===================================================================
            // ========== התיקון הקריטי: קוד חסין תקלות לחלוטין ==========
            // ===================================================================
            // Optional Chaining (?.) הוא הגיבור שלנו כאן.
            // הוא ימנע קריסה גם אם 'images' או 'poster' או 'thumb' לא קיימים.
            const posterUrl = show.images?.poster?.thumb;
            const fanartUrl = show.images?.fanart?.thumb;

            ep.showPoster = posterUrl ? posterUrl.replace('medium.jpg', 'full.jpg') : null;
            ep.showFanart = fanartUrl ? fanartUrl.replace('medium.jpg', 'full.jpg') : null;
        });
        
        allEpisodes.push(...episodes);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log(`Total episodes collected: ${allEpisodes.length}`);
    return allEpisodes;
}

// Handler ראשי
module.exports = async (req, res) => { /* ... (אותו קוד Handler כמו קודם) ... */ };

// ... (הדבק כאן את שאר הפונקציות המלאות כפי שהיו)
