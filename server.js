// Onde 92 — serveur statique + proxy PRIM (IDFM) avec cache et budget de quota.
// Aucune dépendance : Node >= 18.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = +process.env.PORT || 8092;
const KEY = (process.env.PRIM_API_KEY || '').trim();
const MOCK = process.env.PRIM_MOCK === '1';           // démo du pipeline temps réel sans clé
const DAILY_BUDGET = +process.env.PRIM_DAILY_BUDGET || 900; // quota par défaut PRIM : 1000 req/jour
const MIN_TTL = (+process.env.PRIM_MIN_TTL || 60) * 1000;  // données PRIM rafraîchies ~1×/min
const PRIM = 'https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable';
const ROOT = __dirname;
const os = require('os');
const { spawn } = require('child_process');

// --- Données GTFS : data/ (versionné) ou dossier « live » reconstruit au runtime (Render n'a pas de cron) ---
const DATA_COMMIT = path.join(ROOT, 'data');
const DATA_LIVE = process.env.GTFS_LIVE_DIR || path.join(os.tmpdir(), 'onde92-data');
const AUTO_REFRESH = process.env.GTFS_AUTO_REFRESH === '1' || (process.env.GTFS_AUTO_REFRESH !== '0' && !!process.env.RENDER);
const REFRESH_AGE = (process.env.GTFS_REFRESH_DAYS ? +process.env.GTFS_REFRESH_DAYS : 6) * 864e5;  // reconstruit si les données ont plus de 6 jours
const MIN_COVER = 14 * 864e5;                                      // … ou si le calendrier couvre moins de 14 jours
const gtfs = { dir: DATA_COMMIT, source: 'commit', generated: null, coverUntil: null, running: false, lastTry: 0, lastOk: null, lastError: null };
const readMeta = d => { try { const m = JSON.parse(fs.readFileSync(path.join(d, 'lines.json'), 'utf8')); return m.lines?.length === 4 && m.lines.every(l => fs.existsSync(path.join(d, `line-${l.short}.json`))) ? m : null; } catch { return null; } };
let LINES, byShort;
function selectData() {
  const c = readMeta(DATA_COMMIT), l = readMeta(DATA_LIVE);
  const useLive = l && (!c || String(l.generated) > String(c.generated));
  const m = useLive ? l : c; if (!m) throw new Error('data/lines.json introuvable');
  gtfs.dir = useLive ? DATA_LIVE : DATA_COMMIT; gtfs.source = useLive ? 'live' : 'commit'; gtfs.generated = m.generated;
  LINES = m.lines; byShort = Object.fromEntries(LINES.map(x => [x.short, x]));
  for (const k in lineData) delete lineData[k];
  let last = '';
  for (const x of LINES) { try { const L = JSON.parse(fs.readFileSync(path.join(gtfs.dir, `line-${x.short}.json`), 'utf8')); for (const d of Object.values(L.services)) if (d.length && d[d.length - 1] > last) last = d[d.length - 1]; } catch {} }
  gtfs.coverUntil = last ? `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}` : null;
}
function gtfsStale() {
  const gen = Date.parse(gtfs.generated + (/[Z+]/.test(gtfs.generated || '') ? '' : 'Z'));
  const cover = gtfs.coverUntil ? Date.parse(gtfs.coverUntil + 'T23:59:59Z') : 0;
  return !(gen > Date.now() - REFRESH_AGE) || cover - Date.now() < MIN_COVER;
}
function refreshGTFS(force) {
  if (gtfs.running || (!force && (!gtfsStale() || Date.now() - gtfs.lastTry < 6 * 3600e3))) return false;
  gtfs.running = true; gtfs.lastTry = Date.now();
  console.log(new Date().toISOString(), '[gtfs] reconstruction →', DATA_LIVE);
  // processus séparé, tas plafonné : ~200 Mo de RSS au pic, compatible avec les 512 Mo du plan gratuit
  const ch = spawn(process.execPath, ['--max-old-space-size=' + (+process.env.GTFS_HEAP_MB || 144), '--max-semi-space-size=4', path.join(ROOT, 'scripts/gtfs-build.js'), DATA_LIVE], { stdio: ['ignore', 'inherit', 'inherit'] });
  const done = code => {
    gtfs.running = false;
    if (code === 0) { gtfs.lastOk = new Date().toISOString(); gtfs.lastError = null; try { selectData(); console.log('[gtfs] données actives :', gtfs.source, gtfs.generated); } catch (e) { gtfs.lastError = e.message; } }
    else { gtfs.lastError = 'build exit ' + code; console.error('[gtfs] échec, on garde', gtfs.source, gtfs.generated); }
  };
  ch.on('exit', done); ch.on('error', e => { gtfs.lastError = e.message; done(1); });
  return true;
}

const lineData = {};
selectData();
const cache = {};      // short -> {at, data, pending}
let budget = { day: parisDay(), used: 0, lastCall: 0, errors: 0, lastError: null };

function parisDay(d = new Date()) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);
}
function secondsLeftToday() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).split(':').map(Number);
  return Math.max(60, 86400 - (p[0] * 3600 + p[1] * 60 + p[2]));
}
// Intervalle minimal entre deux appels PRIM (toutes lignes confondues) pour ne jamais dépasser le budget du jour.
function pacing() {
  if (budget.day !== parisDay()) budget = { day: parisDay(), used: 0, lastCall: 0, errors: 0, lastError: null };
  const remaining = DAILY_BUDGET - budget.used;
  if (remaining <= 0) return Infinity;
  return Math.max(2000, (secondsLeftToday() * 1000) / remaining);
}

function normalize(siri, lineRef) {
  const out = [];
  const del = siri?.Siri?.ServiceDelivery?.EstimatedTimetableDelivery || [];
  for (const d of del) for (const fr of d.EstimatedJourneyVersionFrame || []) for (const j of fr.EstimatedVehicleJourney || []) {
    const lr = j.LineRef?.value || j.LineRef;
    if (lineRef && lr && lr !== lineRef) continue;
    const calls = (j.EstimatedCalls?.EstimatedCall || []).map(c => {
      const sp = c.StopPointRef?.value || c.StopPointRef || '';
      const m = /StopPoint:Q:(\d+)/.exec(sp);
      return {
        stop: m ? m[1] : sp,
        aa: c.AimedArrivalTime || null, ad: c.AimedDepartureTime || null,
        ea: c.ExpectedArrivalTime || null, ed: c.ExpectedDepartureTime || null,
        st: c.DepartureStatus || c.ArrivalStatus || null,
        at: !!c.VehicleAtStop,
        prox: c.ArrivalProximityText?.value || null,
      };
    }).filter(c => c.stop);
    const rec = (j.RecordedCalls?.RecordedCall || []).map(c => {
      const sp = c.StopPointRef?.value || c.StopPointRef || '';
      const m = /StopPoint:Q:(\d+)/.exec(sp);
      return { stop: m ? m[1] : sp, aa: c.AimedArrivalTime || null, ad: c.AimedDepartureTime || null,
        ea: c.ActualArrivalTime || c.ExpectedArrivalTime || null, ed: c.ActualDepartureTime || c.ExpectedDepartureTime || null, st: 'recorded', at: false, rec: true };
    }).filter(c => c.stop);
    calls.unshift(...rec);
    if (!calls.length) continue;
    out.push({
      ref: j.DatedVehicleJourneyRef?.value || j.DatedVehicleJourneyRef || j.FramedVehicleJourneyRef?.DatedVehicleJourneyRef || null,
      dir: j.DirectionRef?.value || j.DirectionRef || null,
      dest: (j.DestinationName?.[0]?.value) || (j.DestinationName?.value) || null,
      destRef: (j.DestinationRef?.value || '').replace(/.*Q:(\d+).*/, '$1') || null,
      calls,
    });
  }
  return out;
}

function fetchPrim(lineRef) {
  return new Promise((resolve, reject) => {
    const url = PRIM + '?LineRef=' + encodeURIComponent(lineRef);
    const req = require('https').get(url, { headers: { apikey: KEY, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'onde92/1.0' }, timeout: 15000 }, res => {
      let s = res;
      if (res.headers['content-encoding'] === 'gzip') s = res.pipe(zlib.createGunzip());
      else if (res.headers['content-encoding'] === 'deflate') s = res.pipe(zlib.createInflate());
      const chunks = [];
      s.on('data', c => chunks.push(c));
      s.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('PRIM HTTP ' + res.statusCode + ' ' + body.slice(0, 200)));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      s.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// --- Mode démo (PRIM_MOCK=1) : fabrique une réponse SIRI à partir du GTFS + retards aléatoires stables.
function loadLine(short) { return lineData[short] ||= JSON.parse(fs.readFileSync(path.join(gtfs.dir, `line-${short}.json`), 'utf8')); }
function parisMidnightUTC(dayStr) { // dayStr YYYY-MM-DD → Date de minuit Paris
  const guess = new Date(dayStr + 'T00:00:00Z');
  const off = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Paris' })) - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - off);
}
function mockSiri(short) {
  const L = loadLine(short); const now = Date.now(); const day = parisDay(); const ymd = day.replace(/-/g, '');
  const mid = parisMidnightUTC(day).getTime(); const journeys = [];
  for (const [svc, pi, t0, dl, tid] of L.trips) {
    if (!(L.services[svc] || []).includes(ymd)) continue;
    const P = L.patterns[pi]; let t = t0; const times = [t0]; for (const d of dl) times.push(t += d);
    const start = mid + times[0] * 1000, end = mid + times.at(-1) * 1000;
    if (end < now - 60e3 || start > now + 3600e3) continue;
    const delay = ((parseInt(tid, 36) || 7) % 7 - 2) * 45e3;
    const calls = P.stops.map((s, i) => ({ s, aimed: mid + times[i] * 1000, exp: mid + times[i] * 1000 + delay * Math.min(1, i / 5) }))
      .filter(c => c.exp > now - 30e3)
      .map(c => ({ StopPointRef: { value: `STIF:StopPoint:Q:${c.s}:` }, AimedDepartureTime: new Date(c.aimed).toISOString(), ExpectedDepartureTime: new Date(c.exp).toISOString(), DepartureStatus: delay > 60e3 ? 'delayed' : 'onTime' }));
    if (calls.length) journeys.push({ LineRef: { value: L.lineRef }, DatedVehicleJourneyRef: 'MOCK:' + tid, DestinationName: [{ value: P.headsign }], EstimatedCalls: { EstimatedCall: calls } });
  }
  return { Siri: { ServiceDelivery: { EstimatedTimetableDelivery: [{ EstimatedJourneyVersionFrame: [{ EstimatedVehicleJourney: journeys }] }] } } };
}

async function realtime(short) {
  const line = byShort[short];
  if (!line) return { status: 404, body: { error: 'ligne inconnue' } };
  if (!KEY && !MOCK) return { status: 200, body: { mode: 'theorique', reason: 'no_key', journeys: [] } };
  const c = cache[short] ||= { at: 0, data: null, pending: null };
  const age = Date.now() - c.at;
  // chaque ligne a sa part du budget restant : intervalle = pacing global × nombre de lignes
  const canCall = Date.now() - (c.lastCall || 0) >= pacing() * Object.keys(byShort).length;
  if (c.data && (age < MIN_TTL || !canCall)) return { status: 200, body: { ...c.data, cacheAge: Math.round(age / 1000) } };
  if (!c.data && !canCall && !MOCK) return { status: 200, body: { mode: 'theorique', reason: 'quota', journeys: [] } };
  if (!c.pending) {
    budget.lastCall = c.lastCall = Date.now();
    c.pending = (MOCK && !KEY ? Promise.resolve(mockSiri(short)) : (budget.used++, fetchPrim(line.lineRef)))
      .then(siri => {
        const journeys = normalize(siri, line.lineRef);
        c.data = { mode: journeys.length ? 'temps-reel' : 'theorique', reason: journeys.length ? null : 'empty', demo: MOCK && !KEY, fetchedAt: new Date().toISOString(), journeys };
        c.at = Date.now();
      })
      .catch(e => { budget.errors++; budget.lastError = String(e.message || e).slice(0, 200); console.error('[PRIM]', short, budget.lastError); })
      .finally(() => { c.pending = null; });
  }
  await c.pending;
  if (c.data) return { status: 200, body: { ...c.data, cacheAge: Math.round((Date.now() - c.at) / 1000) } };
  return { status: 200, body: { mode: 'theorique', reason: 'error', journeys: [] } };
}

// --- « Est-ce que j'ai mon bus ? » : géocodage (Base Adresse Nationale) et itinéraire piéton (OSRM foot), sans clé.
const https = require('https');
const extCache = new Map(); // url -> {at, body}
function getJSON(url, timeout = 8000) {
  const hit = extCache.get(url); if (hit && Date.now() - hit.at < 6 * 3600e3) return Promise.resolve(hit.body);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Onde92/1.0 (horaires bus 92)', Accept: 'application/json' }, timeout }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', c => b += c);
      r.on('end', () => { if (r.statusCode !== 200) return reject(new Error('HTTP ' + r.statusCode)); try { const j = JSON.parse(b); if (extCache.size > 2000) extCache.clear(); extCache.set(url, { at: Date.now(), body: j }); resolve(j); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}
const num = (x, lo, hi) => { const v = parseFloat(x); return isFinite(v) && v >= lo && v <= hi ? v : null; };
async function geocode(q, reverse) {
  // api-adresse.data.gouv.fr (BAN) ; repli sur le nouveau point d'accès IGN qui sert la même API
  const qs = reverse ? `reverse/?lat=${reverse[0]}&lon=${reverse[1]}&limit=1` : `search/?q=${encodeURIComponent(q)}&limit=6&lat=48.875&lon=2.2&autocomplete=1`;
  let j; try { j = await getJSON('https://api-adresse.data.gouv.fr/' + qs); } catch (e) { j = await getJSON('https://data.geopf.fr/geocodage/' + qs.replace('/?', '?')); }
  return (j.features || []).map(f => ({ label: f.properties.label, city: f.properties.city, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], type: f.properties.type }));
}
async function walk(a, b) {
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  const j = await getJSON(url, 9000);
  const r = j.routes && j.routes[0]; if (!r) throw new Error('no route');
  return { source: 'osrm', distance: Math.round(r.distance), duration: Math.round(r.duration), path: r.geometry.coordinates.map(c => [+c[1].toFixed(6), +c[0].toFixed(6)]) };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}, req) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const h = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra };
  if (req && /gzip/.test(req.headers['accept-encoding'] || '') && buf.length > 1024 && /json|javascript|css|html|svg/.test(type)) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = buf.length; res.writeHead(status, h); res.end(buf);
}
function serveFile(req, res, file, cacheCtl) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': cacheCtl }, req);
  });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = decodeURIComponent(u.pathname);
  try {
    if (p === '/api/status') return send(res, 200, { realtimeConfigured: !!KEY, demo: MOCK && !KEY, budget: { day: budget.day, used: budget.used, daily: DAILY_BUDGET, paceSec: Math.round(pacing() / 1000), errors: budget.errors, lastError: budget.lastError }, gtfsGenerated: gtfs.generated, gtfs: { source: gtfs.source, generated: gtfs.generated, coverUntil: gtfs.coverUntil, autoRefresh: AUTO_REFRESH, running: gtfs.running, lastOk: gtfs.lastOk, lastError: gtfs.lastError } }, undefined, { 'Cache-Control': 'no-store' }, req);
    let m;
    if ((m = /^\/api\/rt\/(\d{3})$/.exec(p))) { const r = await realtime(m[1]); return send(res, r.status, r.body, undefined, { 'Cache-Control': 'no-store' }, req); }
    if (p === '/api/geocode') {
      const q = (u.searchParams.get('q') || '').trim().slice(0, 200); const la = num(u.searchParams.get('lat'), 40, 52), lo = num(u.searchParams.get('lon'), -6, 10);
      if (!q && la == null) return send(res, 400, { error: 'q manquant' });
      try { return send(res, 200, { results: await geocode(q, la != null && lo != null ? [la, lo] : null) }, undefined, { 'Cache-Control': 'public, max-age=3600' }, req); }
      catch (e) { return send(res, 502, { error: 'géocodage indisponible' }); }
    }
    if (p === '/api/walk') {
      const f = (u.searchParams.get('from') || '').split(',').map(Number), t = (u.searchParams.get('to') || '').split(',').map(Number);
      if (![...f, ...t].every(isFinite) || f.length !== 2 || t.length !== 2) return send(res, 400, { error: 'from/to = lat,lon' });
      try { return send(res, 200, await walk(f, t), undefined, { 'Cache-Control': 'public, max-age=86400' }, req); }
      catch (e) { return send(res, 502, { error: 'itinéraire indisponible' }); }
    }
    if (p.startsWith('/data/')) { const f = path.join(gtfs.dir, path.basename(p)); return serveFile(req, res, f, 'public, max-age=3600'); }
    let f = path.normalize(path.join(ROOT, 'public', p));
    if (!f.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'forbidden' });
    if (p === '/' || !path.extname(p)) f = path.join(ROOT, 'public/index.html');
    return serveFile(req, res, f, /vendor|fonts/.test(p) ? 'public, max-age=604800' : 'no-cache');
  } catch (e) { console.error(e); send(res, 500, { error: 'internal' }); }
}).listen(PORT, () => {
  console.log(`Onde 92 sur http://localhost:${PORT}  — temps réel: ${KEY ? 'clé PRIM présente' : MOCK ? 'DÉMO (simulé)' : 'désactivé (pas de PRIM_API_KEY)'} — GTFS ${gtfs.source} ${gtfs.generated} (jusqu'au ${gtfs.coverUntil})${AUTO_REFRESH ? ', rafraîchissement auto' : ''}`);
  if (AUTO_REFRESH) { setTimeout(() => refreshGTFS(), 20e3).unref(); setInterval(() => refreshGTFS(), 3600e3).unref(); }
});
