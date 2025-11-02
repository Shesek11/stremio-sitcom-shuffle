const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// ===================================================================================
// ========== הגדרות - קורא את הנתונים ממשתני הסביבה שהגדרת ב-Vercel ==========
// ===================================================================================
// חשוב מאוד: ודא שהגדרת את כל המשתנים האלה בממשק של Vercel!
const CONFIG = {
    TRAKT_USERNAME: process.env.TRAKT_USERNAME || 'Shesek',
    TRAKT_LIST_SLUG: process.env.TRAKT_LIST_SLUG || 'sitcom-shuffle',
    TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
    TRAKT_ACCESS_TOKEN: process.env.TRAKT_ACCESS_TOKEN
};


// ===================================================================================
// ========== פונקציות עזר - כל הלוגיקה של התקשורת עם Trakt נמצאת כאן ==========
// ===================================================================================

// Headers לבקשות Trakt
function getTraktHeaders() {
    // בדיקה שהמפתחות קיימים לפני שמשתמשים בהם
    if (!CONFIG.TRAKT_CLIENT_ID || !CONFIG.TRAKT_ACCESS_TOKEN) {
        throw new Error('Trakt API credentials are not configured in environment variables.');
    }
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
        throw new Error(`Failed to fetch Trakt list: ${response.status} ${response.statusText}`);
    }
    const items = await response.json();
    return items.map(item => item.show);
}

// שליפת כל הפרקים של סדרה
async function getShowEpisodes(showSlug) {
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`;
    const response = await fetch(url, { headers: getTraktHeaders() });

    if (!response.ok) {
        console.error(`Failed to fetch episodes for ${showSlug}, skipping show.`);
        return []; // החזר מערך ריק במקום לעצור את כל התהליך
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
    console.log(`Found ${shows.length} shows.`);

    const allEpisodes = [];
    for (const show of shows) {
        console.log(`Fetching episodes for: ${show.title}`);
        const episodes = await getShowEpisodes(show.ids.slug);
        
        // הוספת מידע על הסדרה לכל פרק
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


// ===================================================================================
// ========== הפונקציה הראשית ש-Vercel מריצה ==========
// ===================================================================================
// Vercel תפעיל את הפונקציה הזו לפי הלו"ז שהוגדר ב-vercel.json
module.exports = async (req, res) => {
    try {
        console.log('Cron Job Started: Beginning to fetch and shuffle episodes.');

        // שלב 1: איסוף כל הפרקים
        const allEpisodes = await getAllEpisodes();
        if (allEpisodes.length === 0) {
            throw new Error("No episodes found, aborting update.");
        }

        // שלב 2: ערבוב הרשימה
        const shuffledEpisodes = shuffleArray(allEpisodes);
        console.log(`Shuffled ${shuffledEpisodes.length} episodes.`);

        // שלב 3: שמירת הרשימה המעורבבת והמוכנה במסד הנתונים
        await kv.set('shuffled-episodes', shuffledEpisodes);
        console.log('Successfully saved shuffled episodes to Vercel KV.');

        // החזרת תשובה חיובית. זה חשוב כדי ש-Vercel יידע שהריצה הצליחה.
        res.status(200).json({ 
            message: 'Cron job completed successfully.',
            episodeCount: shuffledEpisodes.length 
        });

    } catch (error) {
        console.error('An error occurred during the cron job:', error);
        
        // החזרת תשובת שגיאה כדי שנדע שהריצה נכשלה
        res.status(500).json({ 
            message: 'Cron job failed.',
            error: error.message 
        });
    }
};
