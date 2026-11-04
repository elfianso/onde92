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
const ROOT = __dirname;
const core = require('./lib/core');
const os = require('os');
const { spawn } = require('child_process');

// --- Données GTFS : data/ (versionné) ou dossier « live » reconstruit au runtime (Render n'a pas de cron) ---
const DATA_COMMIT = core.DATA_DIR;  // public/data
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
  core.clearData();
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

selectData();
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

// --- Proxy temps réel (logique commune dans lib/core.js) : cache ≥ PRIM_MIN_TTL et lissage du budget journalier.
const realtime = core.makeRealtime({
  key: KEY, mock: MOCK, dir: () => gtfs.dir, ttlMs: () => MIN_TTL,
  // chaque ligne a sa part du budget restant : intervalle = pacing global × nombre de lignes
  gate: (short, c, now) => now - (c.lastCall || 0) >= pacing() * Object.keys(byShort).length ? { ok: true } : { ok: false, reason: 'quota', stale: true, maxAge: 60 },
  onCall: () => { budget.lastCall = Date.now(); if (KEY) budget.used++; },
  onError: (short, msg) => { budget.errors++; budget.lastError = msg; console.error('[PRIM]', short, msg); },
});

// --- « Est-ce que j'ai mon bus ? » : géocodage (Base Adresse Nationale) et itinéraire piéton (OSRM foot), sans clé.
const num = core.num;

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
    if (p === '/api/geocode' || p === '/api/walk') { const r = await (p === '/api/walk' ? core.walkRoute : core.geocodeRoute)(u.searchParams); return send(res, r.status, r.body, undefined, { 'Cache-Control': r.cache.replace(/, s-maxage=\d+/, '') }, req); }
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
