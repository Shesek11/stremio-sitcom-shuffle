// index.js
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

// Trakt API Configuration - רק Client ID נדרש!
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const TRAKT_USERNAME = process.env.TRAKT_USERNAME; // שם המשתמש שלך ב-Trakt
const TRAKT_LIST_SLUG = process.env.TRAKT_LIST_SLUG; // שם הרשימה (מה-URL)

// Cache למניעת קריאות מיותרות
let episodesCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 3600000; // שעה במילישניות

// Manifest
const manifest = {
  id: 'community.trakt.random.episodes',
  version: '1.0.0',
  name: 'Trakt Random Episodes',
  description: 'פרקים רנדומליים מרשימות Trakt שלך - כל פעם פרק אחר!',
  resources: ['catalog', 'meta'],
  types: ['series'],
  idPrefixes: ['tt'],
  catalogs: [
    {
      type: 'series',
      id: 'trakt-random-episodes',
      name: '🎲 פרקים רנדומליים',
      extra: [
        {
          name: 'skip',
          isRequired: false
        }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

// Headers בסיסיים לכל קריאה (רק עם Client ID - בלי OAuth!)
const getTraktHeaders = () => ({
  'Content-Type': 'application/json',
  'trakt-api-version': '2',
  'trakt-api-key': TRAKT_CLIENT_ID
});

// פונקציה לשליפת סדרות מרשימה ציבורית (ללא OAuth!)
async function getListItems(username, listSlug) {
  try {
    console.log(`Fetching list: ${username}/lists/${listSlug}`);
    
    const response = await axios.get(
      `https://api.trakt.tv/users/${username}/lists/${listSlug}/items/shows`,
      { headers: getTraktHeaders() }
    );
    
    console.log(`Found ${response.data.length} shows`);
    return response.data;
  } catch (error) {
    console.error('Error fetching list items:', error.response?.status, error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      throw new Error(`הרשימה "${listSlug}" לא נמצאה. ודא שהרשימה ציבורית ושהשם נכון.`);
    }
    if (error.response?.status === 401) {
      throw new Error('Client ID לא תקין. בדוק את TRAKT_CLIENT_ID ב-Vercel.');
    }
    
    throw error;
  }
}

// פונקציה לשליפת פרטי פרקים של סדרה (ללא OAuth!)
async function getShowSeasons(showId) {
  try {
    const response = await axios.get(
      `https://api.trakt.tv/shows/${showId}/seasons?extended=episodes`,
      { headers: getTraktHeaders() }
    );
    return response.data.filter(season => season.number > 0); // מסנן את העונה 0 (ספיישלים)
  } catch (error) {
    console.error(`Error fetching seasons for show ${showId}:`, error.message);
    return [];
  }
}

// פונקציה לבחירת פרקים רנדומליים
function getRandomEpisodes(allEpisodes, count = 50) {
  const shuffled = [...allEpisodes].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// פונקציה לשליפת כל הפרקים (עם cache)
async function getAllEpisodes(forceRefresh = false) {
  const now = Date.now();
  
  // בדיקת cache
  if (!forceRefresh && episodesCache && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION)) {
    console.log('Using cached episodes');
    return episodesCache;
  }

  console.log('Fetching fresh episodes from Trakt...');
  
  try {
    // בדיקת הגדרות
    if (!TRAKT_USERNAME || !TRAKT_LIST_SLUG) {
      throw new Error('חסרות הגדרות TRAKT_USERNAME או TRAKT_LIST_SLUG');
    }

    // שליפת הסדרות מהרשימה
    const listItems = await getListItems(TRAKT_USERNAME, TRAKT_LIST_SLUG);
    
    if (listItems.length === 0) {
      console.warn('No shows found in list');
      return [];
    }
    
    // שליפת כל הפרקים מכל הסדרות
    const allEpisodes = [];
    let processedShows = 0;
    
    for (const item of listItems) {
      if (item.show) {
        const showId = item.show.ids.trakt;
        const showTitle = item.show.title;
        processedShows++;
        console.log(`[${processedShows}/${listItems.length}] Processing: ${showTitle}`);
        
        try {
          const seasons = await getShowSeasons(showId);
          
          // עיבוד הפרקים
          seasons.forEach(season => {
            if (season.episodes && season.episodes.length > 0) {
              season.episodes.forEach(episode => {
                const imdbId = item.show.ids.imdb;
                const seasonNum = String(season.number).padStart(2, '0');
                const episodeNum = String(episode.number).padStart(2, '0');
                
                allEpisodes.push({
                  id: imdbId || `trakt:${showId}`,
                  type: 'series',
                  name: `${showTitle}`,
                  poster: imdbId 
                    ? `https://images.metahub.space/poster/medium/${imdbId}/img`
                    : null,
                  posterShape: 'poster',
                  background: imdbId
                    ? `https://images.metahub.space/background/medium/${imdbId}/img`
                    : null,
                  logo: imdbId
                    ? `https://images.metahub.space/logo/medium/${imdbId}/img`
                    : null,
                  description: `🎬 ${episode.title || `פרק ${episode.number}`}\n\n📅 עונה ${season.number}, פרק ${episode.number}\n\n${episode.overview || 'אין תיאור זמין'}`,
                  releaseInfo: `S${seasonNum}E${episodeNum}`,
                  runtime: `${episode.runtime || '~'} דקות`,
                  season: season.number,
                  episode: episode.number,
                  showTitle: showTitle,
                  episodeTitle: episode.title,
                  year: item.show.year
                });
              });
            }
          });
          
          // המתנה קטנה בין בקשות
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Error processing show ${showTitle}:`, error.message);
        }
      }
    }
    
    console.log(`✅ Total episodes found: ${allEpisodes.length} from ${processedShows} shows`);
    
    // שמירה ב-cache
    episodesCache = allEpisodes;
    cacheTimestamp = now;
    
    return allEpisodes;
  } catch (error) {
    console.error('Error in getAllEpisodes:', error);
    throw error;
  }
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log('Catalog request:', { type, id, extra });
  
  if (type !== 'series' || id !== 'trakt-random-episodes') {
    return { metas: [] };
  }

  try {
    // בדיקת הגדרות
    if (!TRAKT_CLIENT_ID) {
      console.error('Missing TRAKT_CLIENT_ID');
      return {
        metas: [{
          id: 'error-config',
          type: 'series',
          name: '⚠️ שגיאת הגדרות',
          description: 'חסר TRAKT_CLIENT_ID. הגדר אותו ב-Vercel Environment Variables.'
        }]
      };
    }

    if (!TRAKT_USERNAME || !TRAKT_LIST_SLUG) {
      console.error('Missing TRAKT_USERNAME or TRAKT_LIST_SLUG');
      return {
        metas: [{
          id: 'error-config',
          type: 'series',
          name: '⚠️ שגיאת הגדרות',
          description: 'חסרים TRAKT_USERNAME או TRAKT_LIST_SLUG. הגדר אותם ב-Vercel Environment Variables.'
        }]
      };
    }

    // שליפת כל הפרקים
    const allEpisodes = await getAllEpisodes();
    
    if (allEpisodes.length === 0) {
      return {
        metas: [{
          id: 'empty',
          type: 'series',
          name: '📭 אין פרקים',
          description: `לא נמצאו פרקים ברשימה "${TRAKT_LIST_SLUG}". ודא ש:\n1. הרשימה מכילה סדרות\n2. הרשימה היא ציבורית (Public)\n3. שם המשתמש והרשימה נכונים`
        }]
      };
    }
    
    // בחירת פרקים רנדומליים
    const randomEpisodes = getRandomEpisodes(allEpisodes, 50);
    
    console.log(`✅ Returning ${randomEpisodes.length} random episodes`);
    return { metas: randomEpisodes };
  } catch (error) {
    console.error('Error in catalog handler:', error);
    return {
      metas: [{
        id: 'error',
        type: 'series',
        name: '❌ שגיאה',
        description: `${error.message}\n\nודא ש:\n• הרשימה היא ציבורית (Public)\n• TRAKT_CLIENT_ID תקין\n• TRAKT_USERNAME נכון\n• TRAKT_LIST_SLUG נכון`
      }]
    };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  console.log('Meta request:', { type, id });
  
  try {
    const allEpisodes = await getAllEpisodes();
    const episode = allEpisodes.find(ep => ep.id === id);
    
    if (episode) {
      return {
        meta: {
          id: episode.id,
          type: type,
          name: episode.name,
          poster: episode.poster,
          background: episode.background,
          logo: episode.logo,
          description: episode.description,
          releaseInfo: episode.releaseInfo,
          runtime: episode.runtime
        }
      };
    }
  } catch (error) {
    console.error('Error in meta handler:', error);
  }
  
  return {
    meta: {
      id: id,
      type: type,
      name: 'פרק רנדומלי',
      description: 'פרק מהרשימה שלך ב-Trakt'
    }
  };
});

// Health check endpoint
const healthCheck = (req, res) => {
  const isConfigured = !!(TRAKT_CLIENT_ID && TRAKT_USERNAME && TRAKT_LIST_SLUG);
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    addon: 'Trakt Random Episodes',
    version: '2.0 (No OAuth Required)',
    configured: isConfigured,
    config: {
      clientId: TRAKT_CLIENT_ID ? '✅ Set' : '❌ Missing',
      username: TRAKT_USERNAME || '❌ Missing',
      listSlug: TRAKT_LIST_SLUG || '❌ Missing'
    },
    cacheStatus: episodesCache ? `${episodesCache.length} episodes cached` : 'No cache',
    instructions: !isConfigured ? 'Set TRAKT_CLIENT_ID, TRAKT_USERNAME, and TRAKT_LIST_SLUG in Vercel Environment Variables' : null
  }, null, 2));
};

// Export for Vercel
module.exports = (req, res) => {
  // Health check
  if (req.url === '/health' || req.url === '/' || req.url === '/health/') {
    return healthCheck(req, res);
  }
  
  // Serve addon
  serveHTTP(builder.getInterface(), { req, res });
};
