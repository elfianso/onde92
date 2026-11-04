// GET /api/geocode?q=… | ?lat=&lon= — proxy Base Adresse Nationale (sans clé).
'use strict';
const core = require('../lib/core');
module.exports = async (req, res) => { const r = await core.geocodeRoute(core.params(req)); core.sendJSON(req, res, r.status, r.body, r.cache); };
