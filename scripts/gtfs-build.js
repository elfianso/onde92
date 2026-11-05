#!/usr/bin/env node
// Onde 92 — reconstruit data/*.json depuis le GTFS IDFM, en Node pur (aucune dépendance, aucun unzip/python).
// Usage : node scripts/gtfs-build.js <dossier_sortie> [zip_local]
// Lecture du zip en flux (répertoire central + zip64, inflateRaw), filtrage des 4 lignes à la volée :
// la mémoire reste faible (~100-200 Mo) malgré stop_times.txt (~680 Mo décompressé).
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), https = require('https'), os = require('os'), readline = require('readline');

const URL_GTFS = process.env.GTFS_URL || 'https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip';
const LINES = { '144': 'IDFM:C01169', '160': 'IDFM:C01183', '244': 'IDFM:C01240', '360': 'IDFM:C01304' };
const log = (...a) => console.log(new Date().toISOString(), '[gtfs]', ...a);

function download(url, dest, hops = 5) {
  return new Promise((ok, ko) => {
    https.get(url, { headers: { 'User-Agent': 'onde92/1.0' }, timeout: 120000 }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && hops) { r.resume(); return ok(download(new URL(r.headers.location, url).href, dest, hops - 1)); }
      if (r.statusCode !== 200) { r.resume(); return ko(new Error('HTTP ' + r.statusCode)); }
      const w = fs.createWriteStream(dest); r.pipe(w); w.on('finish', () => ok(dest)); w.on('error', ko); r.on('error', ko);
    }).on('error', ko).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

// --- zip : répertoire central (avec zip64) ---
function zipEntries(file) {
  const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
  const tailLen = Math.min(size, 65557), tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let e = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip: EOCD introuvable');
  let n = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (n === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
    const loc = e - 20; if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64: localisateur absent');
    const z = Buffer.alloc(56); fs.readSync(fd, z, 0, 56, Number(tail.readBigUInt64LE(loc + 8)));
    if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('zip64: EOCD absent');
    n = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
  }
  const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
  const out = {}; let p = 0;
  for (let k = 0; k < n; k++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: répertoire central corrompu');
    const method = cd.readUInt16LE(p + 10), nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let comp = cd.readUInt32LE(p + 20), unc = cd.readUInt32LE(p + 24), off = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nl);
    let x = p + 46 + nl; const xe = x + xl;
    while (x + 4 <= xe) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2); let q = x + 4;
      if (id === 1) {
        if (unc === 0xffffffff) { unc = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (comp === 0xffffffff) { comp = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    out[name] = { method, comp, unc, off };
    p = xe + cl;
  }
  return { fd, entries: out };
}
function entryStream(zip, name) {
  const e = zip.entries[name]; if (!e) throw new Error('zip: ' + name + ' absent');
  const h = Buffer.alloc(30); fs.readSync(zip.fd, h, 0, 30, e.off);
  const start = e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  const raw = fs.createReadStream(null, { fd: zip.fd, autoClose: false, start, end: start + e.comp - 1, highWaterMark: 1 << 20 });
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error('zip: méthode ' + e.method);
  return raw.pipe(zlib.createInflateRaw({ chunkSize: 1 << 20 }));
}
function splitCSV(line) {
  if (line.indexOf('"') < 0) return line.split(',');
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
// Parcourt un fichier GTFS ; `pre(line)` (optionnel) filtre la ligne brute avant découpage, `fn(row)` reçoit un objet.
async function each(zip, name, fn, pre) {
  const rl = readline.createInterface({ input: entryStream(zip, name), crlfDelay: Infinity });
  let head = null;
  for await (let line of rl) {
    if (!head) { head = splitCSV(line.replace(/^\uFEFF/, '')).map(s => s.trim()); continue; }
    if (!line || (pre && !pre(line))) continue;
    const v = splitCSV(line), o = {}; for (let i = 0; i < head.length; i++) o[head[i]] = v[i] ?? '';
    fn(o);
  }
}

const rad = d => d * Math.PI / 180;
function hav(a, b) { const R = 6371000, x = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const xy = (p, lat0) => [p[1] * 111320 * Math.cos(rad(lat0)), p[0] * 110540];
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const lat0 = pts[0][0], P = pts.map(p => xy(p, lat0)), keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(), [ax, ay] = P[i], [bx, by] = P[j], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let best = -1, bi = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = P[k]; let d;
      if (L === 0) d = Math.hypot(px - ax, py - ay); else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); d = Math.hypot(px - ax - t * dx, py - ay - t * dy); }
      if (d > best) { best = d; bi = k; }
    }
    if (best > tol) { keep[bi] = true; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function project(shape, cum, pt, startIdx) {
  const lat0 = shape[0][0], q = xy(pt, lat0); let best = [1e18, 0, startIdx];
  for (let i = startIdx; i < shape.length - 1; i++) {
    const a = xy(shape[i], lat0), b = xy(shape[i + 1], lat0), dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L));
    const d = Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
    if (d < best[0] - 0.01) best = [d, cum[i] + t * (cum[i + 1] - cum[i]), i];
    if (d > best[0] + 1500 && i > best[2] + 50) break;
  }
  return [best[1], best[2]];
}
const hms = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const r6 = x => Math.round(x * 1e6) / 1e6;
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const parseYmd = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
function localIso() { const d = new Date(), o = -d.getTimezoneOffset(), l = new Date(d.getTime() + o * 60000); return l.toISOString().slice(0, 19); }

async function build(zipFile, OUT) {
  const zip = zipEntries(zipFile);
  try {
    const rids = new Set(Object.values(LINES));
    const routes = {}, agency = {}, trips = new Map();
    await each(zip, 'routes.txt', r => { if (rids.has(r.route_id)) routes[r.route_id] = r; });
    await each(zip, 'agency.txt', a => { agency[a.agency_id] = a.agency_name; });
    const ridPrefix = [...rids].map(r => r + ',');
    await each(zip, 'trips.txt', t => { if (routes[t.route_id]) trips.set(t.trip_id, t); }, l => ridPrefix.some(p => l.startsWith(p)));
    if (!trips.size || Object.keys(routes).length !== 4) throw new Error('lignes absentes du GTFS');
    log('courses', trips.size);
    const st = new Map();
    await each(zip, 'stop_times.txt', s => {
      let a = st.get(s.trip_id); if (!a) st.set(s.trip_id, a = []);
      a.push([+s.stop_sequence, s.stop_id, s.arrival_time, s.departure_time]);
    }, l => trips.has(l.slice(0, l.indexOf(','))) || l.charCodeAt(0) === 34);
    log('stop_times', [...st.values()].reduce((n, a) => n + a.length, 0));
    const needShapes = new Set([...trips.values()].map(t => t.shape_id)), shapes = new Map();
    await each(zip, 'shapes.txt', r => {
      if (!needShapes.has(r.shape_id)) return; let a = shapes.get(r.shape_id); if (!a) shapes.set(r.shape_id, a = []);
      a.push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]);
    }, l => needShapes.has(l.slice(0, l.indexOf(','))) || l.charCodeAt(0) === 34);
    const stopIds = new Set(); for (const v of st.values()) for (const x of v) stopIds.add(x[1]);
    const stops = {}, parents = new Set(), allNames = new Map();
    await each(zip, 'stops.txt', s => { if (stopIds.has(s.stop_id)) { stops[s.stop_id] = s; parents.add(s.parent_station); } });
    const svcDates = new Map(), getSvc = k => { let s = svcDates.get(k); if (!s) svcDates.set(k, s = new Set()); return s; };
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    await each(zip, 'calendar.txt', c => {
      const e = parseYmd(c.end_date), set = getSvc(c.service_id);
      for (let d = parseYmd(c.start_date); d <= e; d = new Date(d.getTime() + 864e5)) if (c[DAYS[(d.getUTCDay() + 6) % 7]] === '1') set.add(ymd(d));
    });
    await each(zip, 'calendar_dates.txt', c => { if (c.exception_type === '1') getSvc(c.service_id).add(c.date); else getSvc(c.service_id).delete(c.date); });

    const generated = localIso(), meta = { generated, lines: [] }, files = {};
    for (const [short, rid] of Object.entries(LINES)) {
      const r = routes[rid], patterns = new Map(), outTrips = [], usedSvc = new Set(), usedStops = new Set();
      for (const t of trips.values()) {
        if (t.route_id !== rid) continue;
        const seq = (st.get(t.trip_id) || []).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        if (!seq.length) continue;
        const key = [t.direction_id, t.shape_id, ...seq.map(x => x[1])].join('|');
        if (!patterns.has(key)) patterns.set(key, { dir: +t.direction_id, headsign: t.trip_headsign, shape_id: t.shape_id, stops: seq.map(x => x[1]), n: 0 });
        patterns.get(key).n++;
        const times = seq.map(x => hms(x[3] || x[2]));
        outTrips.push([t.service_id, key, times[0], times.slice(1).map((v, i) => v - times[i]), t.trip_id.split(':').pop()]);
        usedSvc.add(t.service_id); seq.forEach(x => usedStops.add(x[1]));
      }
      const plist = [...patterns.values()].sort((a, b) => a.dir - b.dir || b.n - a.n), pidx = {};
      plist.forEach((p, i) => {
        pidx[[String(p.dir), p.shape_id, ...p.stops].join('|')] = i;
        const raw = (shapes.get(p.shape_id) || []).sort((a, b) => a[0] - b[0]).map(x => [x[1], x[2]]);
        const cum = [0]; for (let k = 1; k < raw.length; k++) cum.push(cum[k - 1] + hav(raw[k - 1], raw[k]));
        const dists = []; let si = 0;
        for (const s of p.stops) { const S = stops[s]; let d; [d, si] = project(raw, cum, [+S.stop_lat, +S.stop_lon], si); dists.push(Math.round(d)); }
        const simp = dp(raw, 4.0), c2 = [0]; for (let k = 1; k < simp.length; k++) c2.push(c2[k - 1] + hav(simp[k - 1], simp[k]));
        const scale = c2[c2.length - 1] ? cum[cum.length - 1] / c2[c2.length - 1] : 1;
        p.shape = simp.map((q, k) => [r6(q[0]), r6(q[1]), Math.round(c2[k] * scale)]);
        p.dist = dists; p.length = Math.round(cum[cum.length - 1] || 0); p.id = `${short}-${p.dir}-${i}`;
        delete p.shape_id;
      });
      const tripsOut = outTrips.map(([sv, k, t0, dl, tid]) => [sv, pidx[k], t0, dl, tid]).sort((a, b) => a[1] - b[1] || a[2] - b[2]);
      const stopsOut = {};
      for (const s of usedStops) { const S = stops[s]; stopsOut[s.split(':').pop()] = { name: S.stop_name, lat: r6(+S.stop_lat), lon: r6(+S.stop_lon), area: S.parent_station.split(':').pop(), wheelchair: S.wheelchair_boarding === '1' }; }
      for (const p of plist) p.stops = p.stops.map(s => s.split(':').pop());
      const services = {}; for (const s of usedSvc) services[s] = [...(svcDates.get(s) || [])].sort();
      const data = { short, routeId: rid, lineRef: 'STIF:Line::' + rid.split(':')[1] + ':', color: '#' + r.route_color, textColor: '#' + r.route_text_color,
        agency: agency[r.agency_id] ?? null, patterns: plist, stops: stopsOut, services, trips: tripsOut,
        tripFields: ['service', 'pattern', 'start_sec', 'deltas_sec', 'gtfs_trip'], generated };
      files[`line-${short}.json`] = JSON.stringify(data);
      const term = [0, 1].filter(d => plist.some(p => p.dir === d)).map(d => plist.filter(p => p.dir === d).reduce((m, p) => p.n > m.n ? p : m).headsign);
      meta.lines.push({ short, color: data.color, textColor: data.textColor, lineRef: data.lineRef, agency: data.agency, termini: term,
        nStops: new Set(Object.values(stopsOut).map(s => s.name)).size, nTrips: tripsOut.length });
      log(short, plist.length, 'variantes', tripsOut.length, 'courses', Object.keys(stopsOut).length, 'arrêts');
      if (!tripsOut.length || plist.length < 2) throw new Error('ligne ' + short + ' incomplète');
    }
    meta.lines.sort((a, b) => a.short < b.short ? -1 : 1);
    // écriture atomique : dossier temporaire puis renommage
    const tmp = OUT + '.tmp-' + process.pid; fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(tmp, f), s);
    fs.writeFileSync(path.join(tmp, 'lines.json'), JSON.stringify(meta, null, 1));
    const old = OUT + '.old-' + process.pid;
    if (fs.existsSync(OUT)) fs.renameSync(OUT, old);
    fs.renameSync(tmp, OUT); fs.rmSync(old, { recursive: true, force: true });
    return meta;
  } finally { fs.closeSync(zip.fd); }
}

async function main() {
  const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'public', 'data'));
  let zipFile = process.argv[3], tmpZip = null;
  const t0 = Date.now();
  if (!zipFile) { tmpZip = zipFile = path.join(os.tmpdir(), `idfm-gtfs-${process.pid}.zip`); log('téléchargement', URL_GTFS); await download(URL_GTFS, zipFile); log('zip', (fs.statSync(zipFile).size / 1e6).toFixed(1), 'Mo'); }
  try { const meta = await build(zipFile, OUT); log('ok →', OUT, meta.generated, ((Date.now() - t0) / 1000).toFixed(0) + ' s', 'rss max', (process.resourceUsage().maxRSS / 1024).toFixed(0) + ' Mo'); }
  finally { if (tmpZip) fs.rmSync(tmpZip, { force: true }); }
}
if (require.main === module) main().catch(e => { log('ÉCHEC', e.message); process.exit(1); });
module.exports = { build, download, zipEntries, entryStream, splitCSV, each, hav, dp, project, hms, r6, ymd, parseYmd, localIso };
