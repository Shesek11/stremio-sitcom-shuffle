import { serveHTTP } from 'stremio-addon-sdk';
import addonInterface from '../addon.js';

export default function handler(req, res) {
    serveHTTP(addonInterface, { req, res });
}
