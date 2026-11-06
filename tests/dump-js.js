// node tests/dump-js.js <nowISO> lat,lon[;lat,lon] -> JSON des départs calculés par core.js
'use strict';
const { load } = require('./harness'); const fs = require('fs'), path = require('path');
const nowMs = Date.parse(process.argv[2]); const pts = process.argv[3].split(';').map(s => s.split(',').map(Number));
const X = load(nowMs); const NET = 'idfm', m = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/n/idfm/lines.json')));
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
(async () => {
  const out = [];
  for (const [lat, lon] of pts) {
    const y = Math.floor(lat / m.tile.lat), x = Math.floor(lon / m.tile.lon); const f = path.join(__dirname, `../public/data/n/idfm/t/${y}_${x}.json`);
    const j = JSON.parse(fs.readFileSync(f)); const qs = j.q.filter(q => hav([lat, lon], [q[2], q[3]]) < 500);
    for (const [sid, name, , , , li] of qs) for (const i of li) { const k = m.lines[i].k; await X.getLine(k);
      const ds = X.departures(k, sid, nowMs, 6); out.push({ k, label: m.lines[i].label, sid, name, deps: ds.map(d => ({ t: d.t, hm: X.fmtHM(d.t), dir: d.dir, fin: !!d.fin, hs: d.headsign })) }); }
  }
  console.log(JSON.stringify(out));
})();
