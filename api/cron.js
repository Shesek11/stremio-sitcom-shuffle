const { put } = require('@vercel/blob');
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

const CONFIG = {
    TRAKT_USERNAME: process.env.TRAKT_USERNAME,
    TRAKT_LIST_SLUG: process.env.TRAKT_LIST_SLUG,
    TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
    TRAKT_ACCESS_TOKEN: process.env.TRAKT_ACCESS_TOKEN
};

function getTraktHeaders() { /* ... (same as before) ... */ }

// ===================================================================
// ========== שינוי 1: אנחנו מבקשים עכשיו מידע מורחב עם תמונות ==========
// ===================================================================
async function getShowsFromList() {
    // הוספנו extended=images כדי לקבל את קישורי התמונות
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows?extended=images`;
    const response = await fetch(url, { headers: getTraktHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch Trakt list: ${response.statusText}`);
    const items = await response.json();
    return items.map(item => item.show);
}

async function getShowEpisodes(showSlug) { /* ... (same as before) ... */ }

async function getAllEpisodes() {
    console.log('Fetching shows from Trakt list...');
    const shows = await getShowsFromList();
    console.log(`Found ${shows.length} shows.`);
    const allEpisodes = [];
    for (const show of shows) {
        console.log(`Fetching episodes for: ${show.title}`);
        const episodes = await getShowEpisodes(show.ids.slug);
        
        // ===================================================================
        // ========== שינוי 2: אנחנו שומרים את קישורי התמונות בכל פרק ==========
        // ===================================================================
        episodes.forEach(ep => {
            ep.showTitle = show.title;
            ep.showYear = show.year;
            ep.showIds = show.ids;
            // הוספת קישורי התמונות לאובייקט הפרק
            if (show.images?.poster?.thumb) {
                ep.showPoster = show.images.poster.thumb.replace('medium.jpg', 'full.jpg');
            }
            if (show.images?.fanart?.thumb) {
                ep.showFanart = show.images.fanart.thumb.replace('medium.jpg', 'full.jpg');
            }
        });
        
        allEpisodes.push(...episodes);
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log(`Total episodes collected: ${allEpisodes.length}`);
    return allEpisodes;
}

function shuffleArray(array) { /* ... (same as before) ... */ }

// Handler ראשי
module.exports = async (req, res) => { /* ... (same as before) ... */ };


// ========= הדבקת הפונקציות המלאות שלא השתנו =========
function getTraktHeaders_impl() { if (!CONFIG.TRAKT_CLIENT_ID || !CONFIG.TRAKT_ACCESS_TOKEN) { throw new Error('Trakt API credentials are not configured in environment variables.'); } return { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': CONFIG.TRAKT_CLIENT_ID, 'Authorization': `Bearer ${CONFIG.TRAKT_ACCESS_TOKEN}` }; }
getTraktHeaders = getTraktHeaders_impl;

async function getShowEpisodes_impl(showSlug) { const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`; const response = await fetch(url, { headers: getTraktHeaders() }); if (!response.ok) { console.error(`Failed to fetch episodes for ${showSlug}, skipping.`); return []; } const seasons = await response.json(); const episodes = []; for (const season of seasons) { if (season.number === 0) continue; for (const episode of season.episodes || []) { episodes.push({ showSlug, showTitle: '', season: season.number, episode: episode.number, title: episode.title || `Episode ${episode.number}`, overview: episode.overview || '', ids: episode.ids }); } } return episodes; }
getShowEpisodes = getShowEpisodes_impl;

function shuffleArray_impl(array) { const shuffled = [...array]; for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } return shuffled; }
shuffleArray = shuffleArray_impl;

module.exports_impl = async (req, res) => { try { console.log('Cron Job Started: Fetching and shuffling episodes.'); const allEpisodes = await getAllEpisodes(); const shuffledEpisodes = shuffleArray(allEpisodes); console.log(`Fetched and shuffled ${shuffledEpisodes.length} episodes.`); const jsonContent = JSON.stringify(shuffledEpisodes); console.log('Uploading shuffled list to Vercel Blob...'); const blob = await put('shuffled-episodes.json', jsonContent, { access: 'public', contentType: 'application/json', cacheControl: 'max-age=0, no-cache, no-store, must-revalidate', allowOverwrite: true }); console.log('Upload complete. Blob URL:', blob.url); await kv.set('episodes_blob_url', blob.url); res.status(200).json({ message: 'Success', url: blob.url, count: shuffledEpisodes.length }); } catch (error) { console.error('Cron job failed:', error); res.status(500).json({ message: 'Failed', error: error.message }); } };
module.exports = module.exports_impl;
