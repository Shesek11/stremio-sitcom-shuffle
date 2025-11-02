// index.js
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');

// Trakt API Configuration
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const TRAKT_ACCESS_TOKEN = process.env.TRAKT_ACCESS_TOKEN; // יש להשיג דרך OAuth

// Manifest
const manifest = {
  id: 'community.trakt.random.episodes',
  version: '1.0.0',
  name: 'Trakt Random Episodes',
  description: 'פרקים רנדומליים מרשימות Trakt שלך',
  resources: ['catalog', 'meta'],
  types: ['series'],
  idPrefixes: ['tt'],
  catalogs: [
    {
      type: 'series',
      id: 'trakt-random-episodes',
      name: 'פרקים רנדומליים',
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

// פונקציה לשליפת רשימות מ-Trakt
async function getTraktLists(accessToken) {
  try {
    const response = await axios.get('https://api.trakt.tv/users/me/lists', {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching Trakt lists:', error.message);
    return [];
  }
}

// פונקציה לשליפת סדרות מרשימה
async function getListItems(username, listId, accessToken) {
  try {
    const response = await axios.get(
      `https://api.trakt.tv/users/${username}/lists/${listId}/items/shows`,
      {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching list items:', error.message);
    return [];
  }
}

// פונקציה לשליפת פרטי פרקים של סדרה
async function getShowSeasons(showId, accessToken) {
  try {
    const response = await axios.get(
      `https://api.trakt.tv/shows/${showId}/seasons?extended=episodes`,
      {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching show seasons:', error.message);
    return [];
  }
}

// פונקציה לבחירת פרקים רנדומליים
function getRandomEpisodes(allEpisodes, count = 20) {
  const shuffled = [...allEpisodes].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'series' || id !== 'trakt-random-episodes') {
    return { metas: [] };
  }

  try {
    // כאן צריך להוסיף לוגיקה לבחירת רשימה
    // לדוגמה, ניתן לשמור את ה-LIST_ID ב-environment variable
    const LIST_ID = process.env.TRAKT_LIST_ID || 'default-list';
    const username = 'me'; // או שם משתמש ספציפי

    // שליפת הסדרות מהרשימה
    const listItems = await getListItems(username, LIST_ID, TRAKT_ACCESS_TOKEN);
    
    // שליפת כל הפרקים מכל הסדרות
    const allEpisodes = [];
    
    for (const item of listItems) {
      if (item.show) {
        const showId = item.show.ids.trakt;
        const seasons = await getShowSeasons(showId, TRAKT_ACCESS_TOKEN);
        
        // עיבוד הפרקים
        seasons.forEach(season => {
          if (season.episodes) {
            season.episodes.forEach(episode => {
              allEpisodes.push({
                id: item.show.ids.imdb || `tt${showId}`,
                type: 'series',
                name: `${item.show.title} - S${season.number}E${episode.number}`,
                poster: item.show.ids.imdb 
                  ? `https://images.metahub.space/poster/small/${item.show.ids.imdb}/img`
                  : null,
                description: episode.title,
                releaseInfo: `עונה ${season.number} פרק ${episode.number}`,
                season: season.number,
                episode: episode.number,
                showTitle: item.show.title
              });
            });
          }
        });
      }
    }

    // בחירת פרקים רנדומליים
    const randomEpisodes = getRandomEpisodes(allEpisodes, 50);
    
    return { metas: randomEpisodes };
  } catch (error) {
    console.error('Error in catalog handler:', error);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  // כאן ניתן להוסיף מידע מפורט יותר על הפרק
  return {
    meta: {
      id: id,
      type: type,
      name: 'Random Episode',
      description: 'פרק רנדומלי מהרשימה שלך'
    }
  };
});

// Export for Vercel
module.exports = (req, res) => {
  serveHTTP(builder.getInterface(), { req, res });
};
