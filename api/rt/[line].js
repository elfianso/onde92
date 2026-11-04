// GET /api/rt/:line — proxy PRIM temps réel d'une ligne (fonction Vercel).
// Quota : le CDN Vercel garde la réponse s-maxage secondes (270 s en journée, 900 s le soir/la nuit),
// + cache mémoire de l'instance ; aucun appel PRIM quand aucune course n'est prévue (±30 min).
'use strict';
const core = require('../../lib/core');

const realtime = core.makeRealtime({
  key: () => (process.env.PRIM_API_KEY || '').trim(),
  mock: process.env.PRIM_MOCK === '1',
  ttlMs: core.rtTtl,
  gate: (short, c, now) => core.inService(short, now) ? { ok: true } : { ok: false, reason: 'hors-service', maxAge: 300 },
});

module.exports = async (req, res) => {
  const short = String((req.query && req.query.line) || (req.url || '').split('?')[0].split('/').pop());
  if (!/^\d{3}$/.test(short)) return core.sendJSON(req, res, 404, { error: 'ligne inconnue' }, 'public, s-maxage=3600');
  try {
    const r = await realtime(short);
    core.sendJSON(req, res, r.status, r.body, `public, max-age=0, s-maxage=${r.maxAge}, stale-while-revalidate=60, stale-if-error=600`);
  } catch (e) { console.error(e); core.sendJSON(req, res, 500, { error: 'internal' }, 'no-store'); }
};
