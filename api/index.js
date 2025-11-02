const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('../addon.js');

// Vercel מצפה לפונקציה שמקבלת request ו-response
// serveHTTP מהספרייה יודעת לעשות בדיוק את זה
module.exports = (req, res) => {
    serveHTTP(addonInterface, { req, res });
};
