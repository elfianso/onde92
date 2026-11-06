// Vérifie le rattachement GTFS-RT (fichier /tmp/<net>_rt.json) aux courses du GTFS embarqué.
'use strict';
const { load } = require('./harness'); const fs = require('fs'), path = require('path');
const net = process.argv[2], nowMs = Date.now(); const X = load(nowMs);
const r = JSON.parse(fs.readFileSync(`/tmp/${net}_rt.json`)); const m = JSON.parse(fs.readFileSync(path.join(__dirname, `../public/data/n/${net}/lines.json`)));
(async () => {
  const by = new Map(); let noDate = false; for (const [tid, date, u] of r.trips) { if (!date) noDate = true; by.set(date ? tid + '|' + date : tid, u); }
  const R = { mode: 'temps-reel', kind: 'trips', byTrip: by, noDate, fetchedAt: r.fetchedAt };
  let tot = 0, rtc = 0, errs = 0, maxErr = 0, n = 0; const seen = new Set();
  for (const l of m.lines) { await X.getLine(l.k); X.S.rt[l.k] = R; const js = X.journeys(l.k, true);
    for (const v of js) { if (!v.rt) continue; rtc++; const u = by.get(v.trip.tid + '|' + v.day) || by.get(v.trip.tid); seen.add(u);
      for (const [sid, t, d] of u) { const k = v.p.stopIndex.get(sid); if (k == null || !t) continue; n++; const e = Math.abs(v.tms[k] - t * 1000); if (e > 60e3) errs++; maxErr = Math.max(maxErr, e); } }
  }
  const active = r.trips.filter(([, , u]) => u.some(x => x[1] && x[1] * 1000 > nowMs - 3600e3 && x[1] * 1000 < nowMs + 6 * 3600e3)).length;
  console.log(net, 'rt trips in feed', r.trips.length, 'active~', active, 'matched feed trips', seen.size, 'journeys rt', rtc, 'stop checks', n, '>60s mismatches', errs, 'maxErr s', maxErr / 1000);
})();
