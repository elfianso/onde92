// GET /api/sm/:zone — prochains passages temps réel d'une zone d'arrêt IDFM (toutes lignes), PRIM stop-monitoring.
// Cache CDN par zone (s-maxage = temps restant) : 1 appel PRIM par zone et par fenêtre, quel que soit le nombre de visiteurs.
'use strict';
const core = require('../../lib/core'), rt2 = require('../../lib/rt2');
module.exports = async (req, res) => {
  const area = String((req.query && req.query.area) || (req.url || '').split('?')[0].split('/').pop());
  if (!/^\d{1,8}$/.test(area)) return core.sendJSON(req, res, 404, { error: 'zone inconnue' }, 'public, s-maxage=3600');
  try { const r = await rt2.stopMonitoring(area); core.sendJSON(req, res, r.status, r.body, `public, max-age=0, s-maxage=${r.maxAge}, stale-while-revalidate=30, stale-if-error=600`); }
  catch (e) { console.error(e); core.sendJSON(req, res, 500, { error: 'internal' }, 'no-store'); }
};
