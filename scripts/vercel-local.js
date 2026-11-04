#!/usr/bin/env node
// Harnais local « façon Vercel » (sans la CLI) : sert public/ en statique et route /api/* vers les fonctions de api/,
// avec req.query comme sur Vercel. Usage : PORT=3000 node scripts/vercel-local.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), API = path.join(ROOT, 'api');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function findHandler(p) { // /api/rt/144 -> api/rt/[line].js {line:'144'}
  const segs = p.replace(/^\/api\/?/, '').split('/').filter(Boolean); let dir = API; const query = {};
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1, s = segs[i];
    if (last && fs.existsSync(path.join(dir, s + '.js'))) return { file: path.join(dir, s + '.js'), query };
    if (!last && fs.existsSync(path.join(dir, s))) { dir = path.join(dir, s); continue; }
    const dyn = fs.readdirSync(dir).find(f => /^\[.+\](\.js)?$/.test(f)); if (!dyn) return null;
    query[dyn.replace(/^\[|\](\.js)?$/g, '')] = s;
    if (last && dyn.endsWith('.js')) return { file: path.join(dir, dyn), query };
    dir = path.join(dir, dyn);
  }
  return null;
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/')) {
    const h = findHandler(p); if (!h) { res.writeHead(404); return res.end('{"error":"not found"}'); }
    req.query = { ...Object.fromEntries(u.searchParams), ...h.query };
    try { await require(h.file)(req, res); } catch (e) { console.error(e); res.writeHead(500); res.end('{"error":"internal"}'); }
    return;
  }
  let f = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(buf); });
}).listen(+process.env.PORT || 3000, () => console.log('harnais Vercel local sur http://localhost:' + (+process.env.PORT || 3000)));
