// GET /api/geocode?q=…[&near=lat,lon] | ?lat=&lon= — lieux OSM (Photon/Nominatim) + adresses BAN, sans clé.
'use strict';
const core = require('../lib/core');
module.exports = async (req, res) => { const r = await core.geocodeRoute(core.params(req)); core.sendJSON(req, res, r.status, r.body, r.cache); };
