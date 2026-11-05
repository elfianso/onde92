// GET /api/gtfsrt/:reseau — résumé compact du flux GTFS-RT TripUpdates d'un réseau (Ilévia, SNCF…), cache 30-60 s.
'use strict';
const core = require('../../lib/core'), rt2 = require('../../lib/rt2');
module.exports = async (req, res) => {
  const net = String((req.query && req.query.net) || (req.url || '').split('?')[0].split('/').pop());
  if (!/^[a-z0-9-]{2,20}$/.test(net)) return core.sendJSON(req, res, 404, { error: 'réseau inconnu' }, 'public, s-maxage=3600');
  try { const r = await rt2.gtfsrt(net); core.sendJSON(req, res, r.status, r.body, `public, max-age=0, s-maxage=${r.maxAge}, stale-while-revalidate=30, stale-if-error=300`); }
  catch (e) { console.error(e); core.sendJSON(req, res, 500, { error: 'internal' }, 'no-store'); }
};
