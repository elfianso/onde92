// Rejoue /api/rt/<ligne> (requête ligne PRIM) dans core.js : chaque prévision doit ressortir telle quelle à son arrêt.
'use strict';
const { load } = require('./harness'); const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2])); const k = process.argv[3]; const nowMs = Date.parse(r.fetchedAt); const X = load(nowMs);
(async () => {
  const L = await X.getLine(k); X.S.rt[k] = { ...r, kind: 'line' }; let ok = 0, bad = 0, term = 0;
  for (const j of r.journeys) for (const c of j.calls) {
    const te = Date.parse(c.ed || c.ea || c.ad || c.aa); if (te < nowMs - 30e3 || c.rec) continue;
    if (!L.stops[c.stop]) { bad++; console.log('UNKNOWN', c.stop); continue; }
    if (!L.dirsAt.get(c.stop)) { term++; continue; } // terminus d'arrivée
    const ds = X.departures(k, c.stop, nowMs, 12); const hit = ds.find(d => d.rt && d.t === te);
    if (!hit) { bad++; console.log('MISSING', L.stops[c.stop].name, c.stop, j.dest, X.fmtHM(te), ds.map(d => X.fmtHM(d.t) + (d.rt ? 'R' : 'p') + d.dir).join(' ')); } else ok++;
  }
  console.log(k, 'ok', ok, 'bad', bad, 'terminus', term, 'stats', JSON.stringify(X.S.rtStats));
})();
