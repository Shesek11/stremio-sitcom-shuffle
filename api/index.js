const { serveHTTP } = require('stremio-addon-sdk');
const addonInterface = require('../addon.js');

module.exports = (req, res) => {
    serveHTTP(addonInterface, { req, res });
};
