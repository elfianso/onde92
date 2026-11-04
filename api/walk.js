// GET /api/walk?from=lat,lon&to=lat,lon — itinéraire piéton OSRM (routing.openstreetmap.de, sans clé).
'use strict';
const core = require('../lib/core');
module.exports = async (req, res) => { const r = await core.walkRoute(core.params(req)); core.sendJSON(req, res, r.status, r.body, r.cache); };
