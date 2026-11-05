// GET /api/status — état du service : réseaux couverts, données, politique de cache/quota temps réel. Ne renvoie jamais la clé.
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../lib/core');
const rt2 = require('../lib/rt2');

let NETS = null;
function networks() {
  if (NETS) return NETS;
  try { NETS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'n', 'networks.json'), 'utf8')); }
  catch (e) { NETS = { networks: [] }; }
  return NETS;
}

module.exports = (req, res) => {
  const meta = core.loadMeta(), now = Date.now(), nets = networks();
  core.sendJSON(req, res, 200, {
    app: 'Prochain',
    realtimeConfigured: !!(process.env.PRIM_API_KEY || '').trim(),
    demo: process.env.PRIM_MOCK === '1' && !process.env.PRIM_API_KEY,
    platform: 'vercel',
    networks: (nets.networks || []).map(n => ({ id: n.id, name: n.name, region: n.region, lines: n.nLines, modes: n.modes, generated: n.generated, window: n.window, rt: n.rt?.type || null })),
    gtfsGenerated: meta.generated,
    gtfs: { source: 'commit', generated: meta.generated },
    rtCache: {
      ttlNowSec: core.rtTtl(now) / 1000, peakSec: core.RT_TTL_PEAK / 1000, offPeakSec: core.RT_TTL_OFFPEAK / 1000, peakHoursParis: '06:30-20:30',
      inService: Object.fromEntries(meta.lines.map(l => [l.short, core.inService(l.short, now)])),
      worstCasePrimCallsToday: core.worstCasePerDay(),
    },
    quota: {
      note: 'PRIM : 2 quotas distincts. « requête ligne » (estimated-timetable, lignes 144/160/244/360) et « prochains passages » (stop-monitoring, un appel par zone d\'arrêt affichée). Cache CDN partagé par zone ; budget journalier par instance. GTFS-RT Ilévia/SNCF : flux ouverts (proxy transport.data.gouv.fr), sans quota.',
      stopMonitoringTtlSec: rt2.smTtl ? rt2.smTtl(now) / 1000 : null,
      stopMonitoring: rt2.smStatus(),
      gtfsrt: rt2.rtStatus(),
    },
  }, 'public, max-age=0, s-maxage=60');
};
