// Rejoue une réponse /api/sm/<zone> (fichier) dans core.js et vérifie que chaque passage temps réel ressort à la bonne minute.
'use strict';
const { load } = require('./harness'); const fs = require('fs');
const r = JSON.parse(fs.readFileSync(process.argv[2])); const nowMs = Date.parse(r.fetchedAt) + (+process.argv[3] || 0) * 1000; const X = load(nowMs);
(async () => {
  const sm = new Map();
  for (const [stop, line, destRef, dest, t, , canc] of r.visits) { const k = 'idfm:' + line; try { await X.getLine(k); } catch (e) { console.log('NO LINE', k); continue; }
    let a = sm.get(k); if (!a) sm.set(k, a = { fetchedAt: r.fetchedAt, journeys: [] }); a.journeys.push({ dest, destRef, calls: [{ stop, ed: t, st: canc ? 'cancelled' : null }] }); }
  for (const [k, v] of sm) X.S.rt[k] = { mode: 'temps-reel', kind: 'stops', ...v };
  let ok = 0, bad = 0;
  for (const [stop, line, destRef, dest, t] of r.visits) {
    const k = 'idfm:' + line, L = X.S.data[k]; if (!L) continue;
    if (!L.stops[stop]) { console.log('UNKNOWN STOP', L.label, stop, dest); bad++; continue; }
    if (!L.dirsAt.has(stop)) continue; // arrivée au terminus : volontairement pas affichée comme départ
    const te = Date.parse(t); const ds = X.departures(k, stop, nowMs, 12);
    const hit = ds.find(d => d.rt && d.t === te);
    if (te < nowMs - 30e3) continue;
    if (!hit) { bad++; console.log('MISSING', L.label, L.stops[stop].name, stop, '→', dest, X.fmtHM(te), 'got', ds.map(d => X.fmtHM(d.t) + (d.rt ? 'R' : 'p') + d.dir).join(' ')); continue; }
    // direction cohérente avec le terminus annoncé ?
    const hs = X.S.data[k].main[hit.dir]; ok++;
    if (process.env.V) console.log('ok', L.label, L.stops[stop].name, X.fmtHM(te), 'dir', hit.dir, 'hs', hit.headsign, '| feed', dest, 'fin', hit.fin, 'delay', Math.round(hit.delay / 1000));
  }
  console.log('visits ok', ok, 'bad', bad);
})();
