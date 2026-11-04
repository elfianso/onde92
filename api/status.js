// GET /api/status — état du service (clé présente ?, données GTFS, politique de cache PRIM). Ne renvoie jamais la clé.
'use strict';
const core = require('../lib/core');

module.exports = (req, res) => {
  const meta = core.loadMeta(), now = Date.now();
  core.sendJSON(req, res, 200, {
    realtimeConfigured: !!(process.env.PRIM_API_KEY || '').trim(),
    demo: process.env.PRIM_MOCK === '1' && !process.env.PRIM_API_KEY,
    platform: 'vercel',
    gtfsGenerated: meta.generated,
    gtfs: { source: 'commit', generated: meta.generated },
    rtCache: {
      ttlNowSec: core.rtTtl(now) / 1000, peakSec: core.RT_TTL_PEAK / 1000, offPeakSec: core.RT_TTL_OFFPEAK / 1000, peakHoursParis: '06:30-20:30',
      inService: Object.fromEntries(meta.lines.map(l => [l.short, core.inService(l.short, now)])),
      worstCasePrimCallsToday: core.worstCasePerDay(),
    },
  }, 'public, max-age=0, s-maxage=60');
};
