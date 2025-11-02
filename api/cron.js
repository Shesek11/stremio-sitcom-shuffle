// api/cron.js
const { kv } = require('@vercel/kv');
// ... העתק לכאן את כל הפונקציות שלך:
// getTraktHeaders, getShowsFromList, getShowEpisodes, getAllEpisodes, shuffleArray

// זו הפונקציה ש-Vercel תריץ
module.exports = async (req, res) => {
    try {
        console.log('Cron Job Started: Fetching and shuffling episodes...');
        const episodes = await getAllEpisodes();
        const shuffledEpisodes = shuffleArray(episodes);
        
        // שמירת הרשימה המוכנה במסד הנתונים
        await kv.set('shuffled-episodes', shuffledEpisodes);
        
        console.log(`Cron Job Finished: Saved ${shuffledEpisodes.length} episodes to KV store.`);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Cron Job failed:', error);
        res.status(500).send('Error');
    }
};
