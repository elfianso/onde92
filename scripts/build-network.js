#!/usr/bin/env node
// Construit les données statiques d'un réseau (GTFS → JSON servis en statique), piloté par scripts/networks.json.
// Usage : node --max-old-space-size=3000 scripts/build-network.js <reseau> [zip_local] [dossier_racine=public/data/n]
// Sortie : <racine>/<reseau>/lines.json (catalogue + index des tuiles), l/<ligne>.json (horaires au format du moteur),
//          t/<x>_<y>.json (arrêts par tuile ~2 km, pour « autour de moi » n'importe où).
// Aucune dépendance npm : lecture du zip en flux (gtfs-build.js), stop_times traité course par course.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const G = require('./gtfs-build.js');
const CFG = require('./networks.json');
const log = (...a) => console.log(new Date().toISOString(), '[net]', ...a);
const MODE_COLOR = { metro: '#1f3f8f', rer: '#2b62c8', train: '#5b6577', tram: '#2a8a5a', bus: '#2f7de1', car: '#6c7a89', cable: '#8a5cc2', ferry: '#1aa0b8' };

function sncfFamily(stopId) {
  const m = /OCE(.+?)-\d+$/.exec(stopId || ''); const f = m ? m[1] : '';
  if (/^Car/i.test(f)) return { fam: 'CAR', mode: 'car', label: 'Car TER' };
  if (/TGV|OUIGO|Lyria|ICE|Eurostar|Thalys/i.test(f)) return { fam: 'TGV', mode: 'train', label: /OUIGO/i.test(f) ? 'OUIGO' : /Lyria/i.test(f) ? 'Lyria' : /ICE/.test(f) ? 'ICE' : 'TGV' };
  if (/INTERCITES/i.test(f)) return { fam: 'IC', mode: 'train', label: /nuit/i.test(f) ? 'IC Nuit' : 'Intercités' };
  if (/Tram/i.test(f)) return { fam: 'TT', mode: 'tram', label: 'Tram-train' };
  if (/Navette/i.test(f)) return { fam: 'NAV', mode: 'car', label: 'Navette' };
  return { fam: 'TER', mode: 'train', label: 'TER' };
}
function modeOf(net, r) {
  const t = +r.route_type;
  if (t === 0 || t === 5 || (t >= 900 && t < 1000)) return 'tram';
  if (t === 1 || t === 7 || (t >= 400 && t < 500)) return 'metro';
  if (t === 2 || (t >= 100 && t < 200)) return net.id === 'idfm' && /^[A-E]$/.test(r.route_short_name) ? 'rer' : 'train';
  if (t === 6) return 'cable';
  if (t === 4) return 'ferry';
  return 'bus';
}
const safe = s => String(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'x';

async function build(net, zipFile, OUTROOT) {
  const zip = G.zipEntries(zipFile), strip = net.stripPrefix ? (s => s && s.startsWith(net.stripPrefix) ? s.slice(net.stripPrefix.length) : s) : (s => s);
  const W = CFG.windowDays || 21, today = new Date(), from = G.ymd(new Date(today.getTime() - 864e5)), to = G.ymd(new Date(today.getTime() + W * 864e5));
  try {
    const agency = {}; await G.each(zip, 'agency.txt', a => { agency[a.agency_id] = a.agency_name; });
    const routes = {}; await G.each(zip, 'routes.txt', r => { routes[r.route_id] = r; });
    log(net.id, 'routes', Object.keys(routes).length);
    // calendrier restreint à la fenêtre [hier, +W jours]
    const svc = new Map(), get = k => { let s = svc.get(k); if (!s) svc.set(k, s = new Set()); return s; };
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (zip.entries['calendar.txt']) await G.each(zip, 'calendar.txt', c => {
      const e = G.parseYmd(c.end_date < to ? c.end_date : to), s = get(c.service_id);
      for (let d = G.parseYmd(c.start_date > from ? c.start_date : from); d <= e; d = new Date(d.getTime() + 864e5)) if (c[DAYS[(d.getUTCDay() + 6) % 7]] === '1') s.add(G.ymd(d));
    });
    await G.each(zip, 'calendar_dates.txt', c => { if (c.date < from || c.date > to) return; if (c.exception_type === '1') get(c.service_id).add(c.date); else svc.get(c.service_id)?.delete(c.date); });
    const trips = new Map();
    await G.each(zip, 'trips.txt', t => { const s = svc.get(t.service_id); if (!s || !s.size || !routes[t.route_id]) return; trips.set(t.trip_id, { r: t.route_id, svc: t.service_id, dir: +t.direction_id || 0, hs: /^(\d+|[A-Z]{4}\d{0,2})$/.test(t.trip_headsign || '') ? '' : (t.trip_headsign || ''), shape: t.shape_id || '' }); });
    log(net.id, 'courses dans la fenêtre', trips.size, from, '→', to);
    const stops = new Map();
    await G.each(zip, 'stops.txt', s => { stops.set(s.stop_id, { name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon, parent: s.parent_station || '', wc: s.wheelchair_boarding === '1' }); });
    // stop_times : flux contigu par course → variantes + horaires compacts (écarts mutualisés)
    const lines = new Map(); let tripN = 0;
    const lineFor = (rid, fam) => {
      const key = fam ? rid + '|' + fam.fam : rid; let L = lines.get(key);
      if (!L) {
        const r = routes[rid], id = safe(strip(rid).replace(/^FR:Line::|:$/g, '') + (fam ? '-' + fam.fam : ''));
        L = { key, id, rid, r, fam, patterns: new Map(), trips: [], deltas: new Map(), dl: [], svcs: new Set(), stops: new Set() }; lines.set(key, L);
      }
      return L;
    };
    let cur = null, buf = [];
    const flush = () => {
      if (!cur) return; const T = trips.get(cur); if (!T || buf.length < 2) { buf = []; return; }
      buf.sort((a, b) => a[0] - b[0]);
      const ts = buf.map(x => x[2] ? G.hms(x[2]) : NaN);
      for (let i = 0; i < ts.length; i++) if (isNaN(ts[i])) { let j = i; while (j < ts.length && isNaN(ts[j])) j++; const a = i ? ts[i - 1] : ts[j], b = j < ts.length ? ts[j] : a; for (let k = i; k < j; k++) ts[k] = Math.round(a + (b - a) * (k - i + 1) / (j - i + 1)); i = j; }
      if (ts.some(isNaN)) { buf = []; return; }
      const sids = buf.map(x => strip(x[1]));
      const fam = net.sncfFamilies ? sncfFamily(buf[0][1]) : null;
      const L = lineFor(T.r, fam);
      const pk = T.dir + '|' + T.shape + '|' + sids.join(',');
      let P = L.patterns.get(pk); if (!P) L.patterns.set(pk, P = { dir: T.dir, headsign: T.hs || (stops.get(buf.at(-1)[1])?.name ?? ''), shape_id: T.shape, stops: sids, raw: buf.map(x => x[1]), n: 0, idx: L.patterns.size });
      P.n++;
      const d = []; for (let i = 1; i < ts.length; i++) d.push(Math.max(0, ts[i] - ts[i - 1]));
      const dk = d.join(','); let di = L.deltas.get(dk); if (di == null) { di = L.dl.length; L.deltas.set(dk, di); L.dl.push(d); }
      const tid = net.tripKey === 'full' ? cur : net.tripKey === 'split' ? cur.split(':')[0] : (tripN++).toString(36);
      L.trips.push([T.svc, P.idx, ts[0], di, tid]); L.svcs.add(T.svc);
      buf = [];
    };
    let iT, iS, iSeq, iDep, iArr;
    {
      const rl = require('readline').createInterface({ input: G.entryStream(zip, 'stop_times.txt'), crlfDelay: Infinity }); let head = null, n = 0;
      for await (const line of rl) {
        if (!head) { head = G.splitCSV(line.replace(/^\uFEFF/, '')).map(s => s.trim()); iT = head.indexOf('trip_id'); iS = head.indexOf('stop_id'); iSeq = head.indexOf('stop_sequence'); iDep = head.indexOf('departure_time'); iArr = head.indexOf('arrival_time'); continue; }
        if (!line) continue;
        const v = G.splitCSV(line), tid = v[iT];
        if (tid !== cur) { flush(); cur = tid; if (!trips.has(tid)) { cur = tid; buf = []; } }
        if (!trips.has(tid)) continue;
        buf.push([+v[iSeq], v[iS], (v[iDep] || v[iArr] || '').trim()]);
        if (++n % 2e6 === 0) log(net.id, 'stop_times', n);
      }
      flush();
    }
    trips.clear();
    log(net.id, 'lignes', lines.size);
    // tracés : simplifiés + distance de chaque arrêt le long du tracé (sinon : ligne brisée entre arrêts)
    const byShape = new Map();
    for (const L of lines.values()) for (const P of L.patterns.values()) if (net.shapes && P.shape_id) { let a = byShape.get(P.shape_id); if (!a) byShape.set(P.shape_id, a = []); a.push(P); }
    const geom = (P, raw) => {
      const cum = [0]; for (let k = 1; k < raw.length; k++) cum.push(cum[k - 1] + G.hav(raw[k - 1], raw[k]));
      const dists = []; let si = 0;
      for (const s of P.raw) { const S = stops.get(s); let d; [d, si] = G.project(raw, cum, [S.lat, S.lon], si); dists.push(Math.round(d)); }
      for (let k = 1; k < dists.length; k++) if (dists[k] < dists[k - 1]) dists[k] = dists[k - 1];
      const simp = G.dp(raw, 5.0), c2 = [0]; for (let k = 1; k < simp.length; k++) c2.push(c2[k - 1] + G.hav(simp[k - 1], simp[k]));
      const scale = c2.at(-1) ? cum.at(-1) / c2.at(-1) : 1;
      P.shape = simp.map((q, k) => [G.r6(q[0]), G.r6(q[1]), Math.round(c2[k] * scale)]); P.dist = dists; P.length = Math.round(cum.at(-1) || 0);
    };
    if (byShape.size && zip.entries['shapes.txt']) {
      let cs = null, pts = [];
      const done = () => { if (cs && byShape.has(cs) && pts.length > 1) { pts.sort((a, b) => a[0] - b[0]); const raw = pts.map(p => [p[1], p[2]]); for (const P of byShape.get(cs)) geom(P, raw); } pts = []; };
      await G.each(zip, 'shapes.txt', r => { if (r.shape_id !== cs) { done(); cs = r.shape_id; } if (byShape.has(cs)) pts.push([+r.shape_pt_sequence, +r.shape_pt_lat, +r.shape_pt_lon]); });
      done();
    }
    for (const L of lines.values()) for (const P of L.patterns.values()) if (!P.shape) {
      const raw = P.raw.map(s => { const S = stops.get(s); return [S.lat, S.lon]; }); const cum = [0];
      for (let k = 1; k < raw.length; k++) cum.push(cum[k - 1] + G.hav(raw[k - 1], raw[k]));
      P.shape = raw.map((q, k) => [G.r6(q[0]), G.r6(q[1]), Math.round(cum[k])]); P.dist = cum.map(Math.round); P.length = Math.round(cum.at(-1));
    }
    // écriture
    const OUT = path.join(OUTROOT, net.id), tmp = OUT + '.tmp-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'l'), { recursive: true }); fs.mkdirSync(path.join(tmp, 't'), { recursive: true });
    const TILE = net.tile || CFG.tile, generated = G.localIso(), catalog = [], tiles = new Map(), TL = TILE.lat, TO = TILE.lon, usedIds = new Set();
    let bytes = 0, bb = [90, 180, -90, -180];
    const sorted = [...lines.values()].sort((a, b) => (a.r.route_sort_order || 0) - (b.r.route_sort_order || 0) || String(a.r.route_short_name).localeCompare(String(b.r.route_short_name), 'fr', { numeric: true }));
    for (const L of sorted) {
      const r = L.r, mode = L.fam ? L.fam.mode : modeOf(net, r);
      let id = L.id; while (usedIds.has(id)) id += '_'; usedIds.add(id);
      const plist = [...L.patterns.values()];
      const order = plist.map((p, i) => i).sort((a, b) => plist[a].dir - plist[b].dir || plist[b].n - plist[a].n), remap = new Map(order.map((o, i) => [o, i]));
      const pats = order.map((o, i) => { const p = plist[o]; return { dir: p.dir, headsign: p.headsign, stops: p.stops, n: p.n, shape: p.shape, dist: p.dist, length: p.length, id: `${id}-${p.dir}-${i}` }; });
      const svcIds = [...L.svcs], svcMap = new Map(svcIds.map((s, i) => [s, i.toString(36)])), services = {};
      for (const s of svcIds) services[svcMap.get(s)] = [...svc.get(s)].sort();
      const tr = L.trips.map(([s, pi, t0, di, tid]) => [svcMap.get(s), remap.get(pi), t0, di, tid]).sort((a, b) => a[1] - b[1] || a[2] - b[2]);
      const stopsOut = {};
      for (const p of plist) p.raw.forEach((rs, k) => { const sid = p.stops[k]; if (stopsOut[sid]) return; const S = stops.get(rs); stopsOut[sid] = { name: S.name, lat: G.r6(S.lat), lon: G.r6(S.lon), area: strip(S.parent) || '', wheelchair: S.wc }; });
      let label = String(r.route_short_name || '').trim(); if (!label || label === 'INCONNU') label = L.fam ? L.fam.label : (r.route_long_name || '?');
      if (L.fam && label !== L.fam.label && L.fam.fam !== 'TER') label = L.fam.label;
      let color = r.route_color && !/^(FFFFFF|AAAAAA)$/i.test(r.route_color) ? '#' + r.route_color.toUpperCase() : MODE_COLOR[mode];
      if (L.fam && L.fam.fam !== 'TER') color = L.fam.fam === 'TGV' ? '#9B2743' : L.fam.fam === 'IC' ? '#3a4f9a' : color;
      const text = r.route_color && !/^(FFFFFF|AAAAAA)$/i.test(r.route_color) && r.route_text_color ? '#' + r.route_text_color.toUpperCase() : '#FFFFFF';
      const key = net.id + ':' + id;
      const term = [0, 1].map(d => { const ps = pats.filter(p => p.dir === d); return ps.length ? ps.reduce((m, p) => p.n > m.n ? p : m).headsign : null; }).filter(Boolean);
      const long = r.route_long_name && r.route_long_name !== label ? r.route_long_name : (r.route_desc || '');
      const data = { short: key, id, label, mode, net: net.id, routeId: strip(L.rid), lineRef: net.id === 'idfm' ? 'STIF:Line::' + strip(L.rid) + ':' : null,
        color, textColor: text, agency: agency[r.agency_id] ?? null, long, patterns: pats, stops: stopsOut, services, deltas: L.dl, trips: tr,
        tripFields: ['service', 'pattern', 'start_sec', 'deltas_idx', 'trip_key'], generated };
      const s = JSON.stringify(data); bytes += s.length; fs.writeFileSync(path.join(tmp, 'l', id + '.json'), s);
      const ci = catalog.length;
      catalog.push({ k: key, id, label, mode, color, text, long, agency: data.agency, termini: term, rid: strip(L.rid), n: tr.length });
      for (const [sid, S] of Object.entries(stopsOut)) {
        const tk = Math.floor(S.lat / TL) + '_' + Math.floor(S.lon / TO); let T = tiles.get(tk); if (!T) tiles.set(tk, T = new Map());
        let q = T.get(sid); if (!q) T.set(sid, q = [sid, S.name, S.lat, S.lon, S.area, []]); if (!q[5].includes(ci)) q[5].push(ci);
        bb = [Math.min(bb[0], S.lat), Math.min(bb[1], S.lon), Math.max(bb[2], S.lat), Math.max(bb[3], S.lon)];
      }
    }
    for (const [tk, T] of tiles) fs.writeFileSync(path.join(tmp, 't', tk + '.json'), JSON.stringify({ q: [...T.values()] }));
    const meta = { net: net.id, name: net.name, region: net.region, generated, window: [from, to], attribution: net.attribution, rt: net.rt, tile: TILE,
      bbox: bb.map(G.r6), tiles: [...tiles.keys()].sort(), modes: [...new Set(catalog.map(c => c.mode))], lines: catalog };
    fs.writeFileSync(path.join(tmp, 'lines.json'), JSON.stringify(meta));
    const old = OUT + '.old-' + process.pid; if (fs.existsSync(OUT)) fs.renameSync(OUT, old); fs.renameSync(tmp, OUT); fs.rmSync(old, { recursive: true, force: true });
    log(net.id, 'ok', catalog.length, 'lignes', tiles.size, 'tuiles', (bytes / 1e6).toFixed(1), 'Mo de lignes', 'rss max', (process.resourceUsage().maxRSS / 1024).toFixed(0) + ' Mo');
    return meta;
  } finally { fs.closeSync(zip.fd); }
}
// Index national : liste des réseaux, emprise, date (lu par le navigateur au démarrage).
function writeIndex(OUTROOT) {
  const nets = [];
  for (const n of CFG.networks) { const f = path.join(OUTROOT, n.id, 'lines.json'); if (!fs.existsSync(f)) continue; const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    nets.push({ id: m.net, name: m.name, region: m.region, bbox: m.bbox, generated: m.generated, window: m.window, rt: m.rt, attribution: m.attribution, modes: m.modes, nLines: m.lines.length, tile: m.tile }); }
  fs.writeFileSync(path.join(OUTROOT, 'networks.json'), JSON.stringify({ generated: G.localIso(), networks: nets }, null, 1));
  return nets;
}
async function main() {
  const id = process.argv[2], OUTROOT = path.resolve(process.argv[4] || path.join(__dirname, '..', 'public', 'data', 'n'));
  if (id === 'index') return console.log(writeIndex(OUTROOT).map(n => n.id).join(' '));
  const net = CFG.networks.find(n => n.id === id); if (!net) throw new Error('réseau inconnu : ' + id + ' (voir scripts/networks.json)');
  let zip = process.argv[3], tmpZip = null;
  if (!zip || zip === '-') { tmpZip = zip = path.join(os.tmpdir(), `gtfs-${id}-${process.pid}.zip`); log('téléchargement', net.gtfs); await G.download(net.gtfs, zip); }
  try { await build(net, zip, OUTROOT); writeIndex(OUTROOT); } finally { if (tmpZip) fs.rmSync(tmpZip, { force: true }); }
}
if (require.main === module) main().catch(e => { log('ÉCHEC', e.stack || e.message); process.exit(1); });
