const { put } = require('@vercel/blob');
const { kv } = require('@vercel/kv');
const fetch = require('node-fetch');

// ... (קוד הגדרות ופונקציות getTraktHeaders, getShowEpisodes, shuffleArray נשאר זהה)
const CONFIG = { /* ... */ };
function getTraktHeaders() { /* ... */ }
function shuffleArray(array) { /* ... */ }

async function getShowsFromList() {
    const url = `https://api.trakt.tv/users/${CONFIG.TRAKT_USERNAME}/lists/${CONFIG.TRAKT_LIST_SLUG}/items/shows?extended=images`;
    const response = await fetch(url, { headers: getTraktHeaders() });
    if (!response.ok) throw new Error(`Failed to fetch Trakt list: ${response.statusText}`);
    const items = await response.json();
    return items.map(item => item.show);
}

async function getShowEpisodes(showSlug) {
    const url = `https://api.trakt.tv/shows/${showSlug}/seasons?extended=episodes`;
    const response = await fetch(url, { headers: getTraktHeaders() });
    if (!response.ok) {
        console.error(`Failed to fetch episodes for ${showSlug}, skipping.`);
        return [];
    }
    const seasons = await response.json();
    const episodes = [];
    for (const season of seasons) {
        if (season.number === 0) continue;
        for (const episode of season.episodes || []) {
            if (episode.ids && episode.ids.imdb) { // שומרים רק פרקים עם IMDb ID
                episodes.push({
                    season: season.number,
                    episode: episode.number,
                    title: episode.title || `Episode ${episode.number}`,
                    overview: episode.overview || '',
                    ids: episode.ids
                });
            }
        }
    }
    return episodes;
}

async function getAllEpisodesOptimized() {
    console.log('Fetching shows from Trakt list...');
    const shows = await getShowsFromList();
    console.log(`Found ${shows.length} shows.`);
    const allEpisodes = [];
    const batchSize = 5;

    for (let i = 0; i < shows.length; i += batchSize) {
        const batch = shows.slice(i, i + batchSize);
        const batchPromises = batch.map(async (show) => {
            const episodes = await getShowEpisodes(show.ids.slug);
            episodes.forEach(ep => {
                ep.showTitle = show.title;
                ep.showYear = show.year;
                ep.showIds = show.ids; // שומרים את ה-ID של הסדרה
                const posterUrl = show.images?.poster?.thumb;
                const fanartUrl = show.images?.fanart?.thumb;
                ep.showPoster = posterUrl ? posterUrl.replace('medium.jpg', 'full.jpg') : null;
                ep.showFanart = fanartUrl ? fanartUrl.replace('medium.jpg', 'full.jpg') : null;
            });
            return episodes;
        });
        const results = await Promise.all(batchPromises);
        results.forEach(episodesArray => allEpisodes.push(...episodesArray));
    }
    console.log(`Total episodes collected: ${allEpisodes.length}`);
    return allEpisodes;
}

// Handler ראשי
module.exports = async (req, res) => {
    // ... (אותו Handler כמו קודם, אין צורך לשנות)
};

// ========= הדבקת הקוד המלא של ה-Handler =========
module.exports = async (req, res) => { try { console.log('Cron Job Started with OPTIMIZED fetcher.'); const allEpisodes = await getAllEpisodesOptimized(); const shuffledEpisodes = shuffleArray(allEpisodes); console.log(`Fetched and shuffled ${shuffledEpisodes.length} episodes.`); const jsonContent = JSON.stringify(shuffledEpisodes); console.log('Uploading shuffled list to Vercel Blob...'); const blob = await put('shuffled-episodes.json', jsonContent, { access: 'public', contentType: 'application/json', cacheControl: 'max-age=0, no-cache, no-store, must-revalidate', allowOverwrite: true }); console.log('Upload complete. Blob URL:', blob.url); await kv.set('episodes_blob_url', blob.url); res.status(200).json({ message: 'Success', url: blob.url, count: shuffledEpisodes.length }); } catch (error) { console.error('Cron job failed:', error); res.status(500).json({ message: 'Failed', error: error.message }); } };
