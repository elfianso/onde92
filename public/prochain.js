/* Prochain — page principale : tous les départs autour de toi (bus, tram, métro, RER, train) + « Où vas-tu ? »
   sur une carte MapLibre (OpenFreeMap). Données par réseau (scripts/networks.json) : arrêts par tuiles, lignes chargées
   à la demande, temps réel par zone d'arrêt (IDFM / PRIM) ou par flux GTFS-RT (Ilévia, SNCF). Moteur : core.js. */
'use strict';
const OSM_FONTS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const STYLE_URL = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const I = {
  walk: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2" fill="currentColor" stroke="none"/><path d="M10 21l2-6 3 3v3M9 12l1.5-4 3.5 1 2 3 2 1M10.5 8L7 10l-1 3"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  flag: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h10.5l-2 4 2 4H6"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  gps: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l7.5 18.5-7.5-4-7.5 4z" transform="rotate(45 12 12)"/></svg>',
  arrow: '<svg class="ic arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  live: '<svg class="rt-ic" viewBox="0 0 16 16" aria-hidden="true"><path class="a1" d="M4 12a8 8 0 0 1 8-8"/><path class="a2" d="M7.2 12A4.8 4.8 0 0 1 12 7.2"/><circle cx="12" cy="12" r="1.7"/></svg>',
  ext: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};
const MODES = {
  metro: { n: 'Métro', o: 1, ic: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 16.5V8l4.5 6 4.5-6v8.5"/></svg>' },
  rer: { n: 'RER', o: 2, ic: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 16V8h3.5a2.3 2.3 0 0 1 0 4.6H8M11.2 12.6L14.5 16"/></svg>' },
  train: { n: 'Train', o: 3, ic: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 11h14M9 17l-2.5 4M15 17l2.5 4"/><circle cx="9" cy="14" r=".6"/><circle cx="15" cy="14" r=".6"/></svg>' },
  tram: { n: 'Tram', o: 4, ic: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="3.5"/><path d="M9 3h6M12 3v3M6 13h12M9 18l-2 3M15 18l2 3"/></svg>' },
  cable: { n: 'Câble', o: 5, ic: '<svg viewBox="0 0 24 24"><path d="M3 5l18-2M12 4v5"/><rect x="6" y="9" width="12" height="10" rx="3"/><path d="M6 14h12"/></svg>' },
  bus: { n: 'Bus', o: 6, ic: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="15" rx="3.5"/><path d="M5 11h14M8 18v2.5M16 18v2.5"/><circle cx="8.5" cy="14.5" r=".6"/><circle cx="15.5" cy="14.5" r=".6"/></svg>' },
  car: { n: 'Car', o: 7, ic: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="13" rx="3"/><path d="M4 10h16M7 17v2.5M17 17v2.5"/></svg>' },
  ferry: { n: 'Navette', o: 8, ic: '<svg viewBox="0 0 24 24"><path d="M3 17c2 2 4 2 6 0 2 2 4 2 6 0 2 2 4 2 6 0M5 14l1-5h12l1 5M9 9V6h6v3"/></svg>' },
};
const modeOf = k => (S.meta[k] && S.meta[k].mode) || 'bus';
const modeIcon = m => `<span class="mi" aria-hidden="true">${(MODES[m] || MODES.bus).ic}</span>`;
const U = {
  dataReady: false, origin: null, geo: 'pending', ask: false, watch: null,
  near: [], places: [], mapPlaces: [], R: 800, sel: null, stop: null, nearGen: 0, loading: false,
  dest: null, plan: null, opt: 0, planKey: null,
  gps: null, followGps: true, camLock: false, pinPend: null, wantFly: false,
  filter: new Set(), mfilter: null, sheet: 'half',
  map: null, styleReady: false, sat: localStorage.getItem('onde-sat') === '1', styles: {},
};
const N = { index: null, metas: {}, metaP: {}, tiles: new Map(), tileP: new Map(), legacy: {} };
const HOME = { lat: 48.8585, lon: 2.3470, label: 'Paris — Châtelet', src: 'home' };
const FRANCE = [[-5.8, 41.2], [10.2, 51.3]];
const MAXL = 44; // lignes chargées au plus pour un point
const isDark = () => document.documentElement.dataset.theme === 'dark';
const panel = $('#panel');

/* ================= formats : compte à rebours d'abord, heure ensuite ================= */
const minsOf = (t, now) => Math.max(0, Math.floor((t - now) / 60000));
const FIN = '<em class="fin" title="Dernier départ de la soirée à cet arrêt, dans ce sens">fin</em>';
const fin = d => d && d.fin ? FIN : '';
// Gros compte à rebours : « 4 min », « <1 min », « maintenant », puis l'heure au-delà d'une heure.
function bigWhen(d, now, dim) {
  if (!d) return '<span class="cd none"><b>—</b></span>';
  const c = `cd${d.rt ? ' rt' : ''}${dim ? ' dim' : ''}`, lv = d.rt ? I.live : '';
  if (d.t - now < 45e3) return `<span class="${c} now">${lv}<b>maintenant</b></span>`;
  const m = minsOf(d.t, now);
  if (m < 1) return `<span class="${c}">${lv}<b>&lt;1</b><small>min</small></span>`;
  return m < 60 ? `<span class="${c}">${lv}<b>${m}</b><small>min</small></span>` : `<span class="${c} hm">${lv}<b>${fmtHM(d.t)}</b></span>`;
}
const smallWhen = (d, now) => d.t - now < 60e3 ? '&lt;1' : minsOf(d.t, now) < 60 ? String(minsOf(d.t, now)) : fmtHM(d.t);
const relWhen = (d, now) => d.t - now < 45e3 ? 'maintenant' : minsOf(d.t, now) < 60 ? 'dans ' + Math.max(1, minsOf(d.t, now)) + ' min' : 'dans ' + Math.floor(minsOf(d.t, now) / 60) + ' h ' + String(minsOf(d.t, now) % 60).padStart(2, '0');
// Les suivants, en petit : « puis 12 · 19 min »
function nextRow(ds, now) {
  if (!ds.length) return '';
  const allMin = ds.every(d => minsOf(d.t, now) < 60);
  return `<span class="nx"><span class="nx-p">puis</span>${ds.map(d => `<span class="nx-t${d.rt ? ' rt' : ''}"><span>${smallWhen(d, now)}${!allMin && minsOf(d.t, now) < 60 ? '<small> min</small>' : ''}</span>${fin(d)}</span>`).join('<i class="nx-s">·</i>')}${allMin ? '<span class="nx-u">min</span>' : ''}</span>`;
}
const shortWhen = (d, now) => d.t - now < 60e3 ? '&lt;1 min' : minsOf(d.t, now) < 60 ? minsOf(d.t, now) + ' min' : fmtHM(d.t);
const vPill = v => `<span class="v ${v.k}">${v.short}</span>`;
const lbl = k => (S.meta[k] && (S.meta[k].label || S.meta[k].short)) || '?';
const lb = (k, cls = '') => { const m = S.meta[k] || { color: '#888', textColor: '#fff', mode: 'bus' }; const t = lbl(k); return `<span class="lb m-${m.mode || 'bus'} ${t.length > 4 ? 'long' : ''} ${cls}" style="--c:${m.color};--t:${m.textColor}">${esc(t)}</span>`; };
// Sens lisible : jamais « Aller / Retour », un code de mission ou un numéro — le nom du terminus à la place.
const isCode = h => !h || /^(aller|retour|sens ?\d*|direction ?\d*|\d{1,4})$/i.test(h.trim()) || /^[A-Z]{4}\d*$/.test(h.trim());
function dirName(k, dir, hs) {
  const L = S.data[k], M = L && (L.main[dir] || L.main[0]);
  if (hs && !isCode(hs)) return hs;
  if (M && !isCode(M.headsign)) return M.headsign;
  const last = M && M.stops[M.stops.length - 1], nm = last && L.stops[last] && L.stops[last].name;
  return nm || (S.meta[k]?.termini?.[dir]) || hs || '';
}
const headOf = (k, dir) => dirName(k, dir);
const modeName = k => (MODES[modeOf(k)] || MODES.bus).n;
const vehicleWord = k => ({ metro: 'métro', rer: 'RER', train: 'train', tram: 'tram', cable: 'cabine', car: 'car', ferry: 'navette' })[modeOf(k)] || 'bus';

/* ================= réseaux, tuiles d'arrêts, lignes à la demande ================= */
async function loadIndex() {
  N.index = await fetch('/data/n/networks.json').then(r => { if (!r.ok) throw new Error('index'); return r.json(); });
  fetch('/data/lines.json').then(r => r.json()).then(m => { for (const l of m.lines) { const rid = (/Line::(C\d+)/.exec(l.lineRef) || [])[1]; if (rid) N.legacy['idfm:' + rid] = l.short; } }).catch(() => { });
}
function netsAt(lat, lon, m = 0.05) { return (N.index?.networks || []).filter(n => lat >= n.bbox[0] - m && lat <= n.bbox[2] + m && lon >= n.bbox[1] - m && lon <= n.bbox[3] + m); }
function netMeta(id) {
  if (N.metas[id]) return Promise.resolve(N.metas[id]);
  return N.metaP[id] ||= fetch(`/data/n/${id}/lines.json`).then(r => r.json()).then(m => {
    m.tileSet = new Set(m.tiles);
    for (const c of m.lines) S.meta[c.k] = { short: c.k, id: c.id, label: c.label, color: c.color, textColor: c.text, mode: c.mode, termini: c.termini, long: c.long, net: id, rid: c.rid, agency: c.agency };
    return (N.metas[id] = m);
  });
}
function tileKeys(m, lat, lon, R) {
  const TL = m.tile.lat, TO = m.tile.lon, dLat = R / 111320, dLon = R / (111320 * Math.cos(lat * Math.PI / 180));
  const out = [];
  for (let y = Math.floor((lat - dLat) / TL); y <= Math.floor((lat + dLat) / TL); y++) for (let x = Math.floor((lon - dLon) / TO); x <= Math.floor((lon + dLon) / TO); x++) { const k = y + '_' + x; if (m.tileSet.has(k)) out.push(k); }
  return out;
}
function loadTile(net, tk) {
  const id = net + '|' + tk; if (N.tiles.has(id)) return Promise.resolve(N.tiles.get(id));
  if (N.tileP.has(id)) return N.tileP.get(id);
  const p = fetch(`/data/n/${net}/t/${tk}.json`).then(r => r.json()).then(j => {
    const m = N.metas[net]; const qs = j.q.map(([sid, name, lat, lon, area, li]) => ({ net, sid, name, lat, lon, area, lines: li.map(i => m.lines[i].k) }));
    N.tiles.set(id, qs); N.tileP.delete(id); return qs;
  }).catch(e => { N.tileP.delete(id); throw e; });
  N.tileP.set(id, p); return p;
}
const netR = (id, R) => id === 'sncf' ? Math.max(R, 6000) : R;
// Quais connus (tuiles déjà chargées) autour d'un point ; `pending` = il manque des tuiles ou des catalogues.
function areaState(o, R = 2600) {
  const out = []; let pending = false;
  for (const n of netsAt(o.lat, o.lon)) {
    const m = N.metas[n.id]; if (!m) { pending = true; continue; }
    for (const tk of tileKeys(m, o.lat, o.lon, netR(n.id, R))) {
      const qs = N.tiles.get(n.id + '|' + tk); if (!qs) { pending = true; continue; }
      for (const q of qs) { if (Math.abs(q.lat - o.lat) > 0.06 || Math.abs(q.lon - o.lon) > 0.09) continue; out.push({ ...q, d: haversine([o.lat, o.lon], [q.lat, q.lon]) }); }
    }
  }
  return { quays: out, pending };
}
async function ensureArea(o, R = 2600) {
  const nets = netsAt(o.lat, o.lon);
  await Promise.all(nets.map(n => netMeta(n.id).catch(() => null)));
  await Promise.all(nets.filter(n => N.metas[n.id]).flatMap(n => tileKeys(N.metas[n.id], o.lat, o.lon, netR(n.id, R)).map(tk => loadTile(n.id, tk).catch(() => null))));
}
function refreshLines() { S.lines = Object.keys(S.data).filter(k => k.includes(':') && S.meta[k]).map(k => S.meta[k]); }
const MODE_RANK = k => (MODES[modeOf(k)] || MODES.bus).o;
const byMode = (a, b) => MODE_RANK(a) - MODE_RANK(b) || lbl(a).localeCompare(lbl(b), 'fr', { numeric: true });
// Arrêts de la carte : quais regroupés par zone d'arrêt (ou par nom à moins de 150 m).
function groupPlaces(quays) {
  const out = [], by = new Map();
  for (const q of quays) {
    const key = q.net + ':' + (q.area || norm(q.name)); let arr = by.get(key); if (!arr) by.set(key, arr = []);
    let p = arr.find(p => q.area ? true : haversine([p.lat, p.lon], [q.lat, q.lon]) < 150);
    if (!p) { p = { net: q.net, area: q.area, name: q.name, lat: q.lat, lon: q.lon, lines: new Set(), quays: [], n: 0, d: q.d }; arr.push(p); out.push(p); }
    p.lat = (p.lat * p.n + q.lat) / (p.n + 1); p.lon = (p.lon * p.n + q.lon) / (p.n + 1); p.n++; p.d = Math.min(p.d ?? Infinity, q.d ?? Infinity);
    for (const k of q.lines) { p.lines.add(k); p.quays.push({ short: k, sid: q.sid, s: { name: q.name, lat: q.lat, lon: q.lon } }); }
  }
  for (const p of out) { p.lines = [...p.lines].sort(byMode); p.group = nbGroup(p.name); p.key = norm(p.name); p.k2 = p.net + ':' + (p.area || p.key) + ':' + p.lat.toFixed(4); }
  return out;
}
// Les pages « lignes » gardent leur index (4 lignes) ; ici, la recherche d'arrêts utilise les arrêts chargés autour.
function nbPlaces() { return U.mapPlaces; }

/* ================= géolocalisation ================= */
function locate(force) {
  if (!('geolocation' in navigator)) { U.geo = 'unavailable'; return render(); }
  U.geo = 'pending'; U.ask = false; U.forceGps = !!force; render();
  navigator.geolocation.getCurrentPosition(onPos, onPosErr, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}
function onPos(p) {
  U.geo = 'ok';
  const o = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), label: 'Ma position', src: 'gps', acc: Math.round(p.coords.accuracy || 0) };
  setGps(o);
  if (U.forceGps || U.followGps) { U.forceGps = false; U.followGps = true; setOrigin({ ...o }, true); reverseLabel(U.origin); } else syncMap();
  if (U.watch == null && navigator.geolocation.watchPosition) U.watch = navigator.geolocation.watchPosition(q => {
    const n = { lat: +q.coords.latitude.toFixed(6), lon: +q.coords.longitude.toFixed(6), label: 'Ma position', src: 'gps', acc: Math.round(q.coords.accuracy || 0) };
    const moved = !U.gps || haversine([n.lat, n.lon], [U.gps.lat, U.gps.lon]) > 80; setGps(n);
    if (moved && U.followGps) { const o2 = { ...n }; setOrigin(o2, true); reverseLabel(o2); } else syncMap();
  }, () => { }, { enableHighAccuracy: true, maximumAge: 20000 });
}
function setGps(o) { U.gps = { lat: o.lat, lon: o.lon, label: 'Ma position', src: 'gps', acc: o.acc || U.gps?.acc || 0 }; mbSet('onde-lastpos', { lat: o.lat, lon: o.lon, t: Date.now() }); }
function onPosErr(e) { U.geo = e && e.code === 1 ? 'denied' : 'unavailable'; U.forceGps = false; if (!U.origin) U.ask = true; render(); }
async function reverseLabel(o) {
  try { const r = await fetch(`/api/geocode?lat=${o.lat}&lon=${o.lon}`).then(r => r.json()); const a = r.results?.[0]; if (a && U.origin === o) { o.label = a.label.replace(/\s\d{5}\s/, ', '); render(); } } catch (e) { }
}
function setOrigin(o, fly, quick) {
  U.origin = o; U.ask = false; U.sel = null; U.stop = null;
  if (o.src === 'addr') mbSet('onde-addr', { label: o.label, lat: o.lat, lon: o.lon });
  if (fly) U.wantFly = true;
  if (!U.dataReady) return render();
  computeNear(quick); if (U.dest) computePlan(quick);
  render(); syncMap();
  const shouldFly = !!(fly || (U.wantFly && U.followGps)); U.wantFly = false;
  if (shouldFly) flyTo(o);
  if (!quick) schedulePoll();
}

/* ================= départs proches ================= */
function computeNear(quick) {
  const O = U.origin, o = [O.lat, O.lon], gen = ++U.nearGen;
  const st = areaState(O);
  if (st.pending) { U.loading = true; ensureArea(O).then(() => { if (gen === U.nearGen) { computeNear(quick); render(); syncMap(); if (!quick) schedulePoll(); } }); }
  const cand = st.quays;
  let R = NB.R, within = cand.filter(q => q.d <= R);
  for (const r of [NB.R_MAX, 2500]) if (!within.length) { R = r; within = cand.filter(q => q.d <= R); }
  // pas d'arrêt urbain : une gare à moins de 6 km compte encore (trains)
  if (!within.length) { const tr = cand.filter(q => q.net === 'sncf' && q.d <= 6000); if (tr.length) { R = Math.ceil(Math.max(...tr.map(q => q.d)) / 100) * 100; within = tr; } }
  U.R = R;
  // grandes lignes / TER : la gare SNCF la plus proche (≤ 3 km) s'ajoute même hors du rayon urbain
  const inW = new Set(within), rail = cand.filter(q => q.net === 'sncf' && !inW.has(q) && q.d <= 3000).sort((a, b) => a.d - b.d);
  const railSt = []; for (const q of rail) { if (railSt.length >= 2) break; if (!railSt.some(r => r.name === q.name)) railSt.push(q); }
  within = [...within, ...rail.filter(q => railSt.some(r => r.name === q.name))];
  within.sort((a, b) => a.d - b.d);
  const want = new Map(), wantRail = new Map();
  for (const q of within) for (const k of q.lines) { const m = q.net === 'sncf' && q.d > R ? wantRail : want; if (!want.has(k) && !m.has(k)) m.set(k, q.d); }
  const keys = [...[...want.keys()].slice(0, MAXL), ...[...wantRail.keys()].slice(0, 14)], missing = keys.filter(k => !S.data[k]);
  if (missing.length) {
    U.loading = true;
    Promise.all(missing.map(k => getLine(k).catch(() => null))).then(() => { refreshLines(); if (gen === U.nearGen) { computeNear(quick); render(); syncMap(); if (!quick) schedulePoll(); } });
  } else if (!st.pending) U.loading = false;
  const keySet = new Set(keys), best = new Map();
  for (const q of within) for (const k of q.lines) {
    if (!keySet.has(k)) continue; const L = S.data[k]; if (!L) continue; const ds = L.dirsAt.get(q.sid); if (!ds) continue;
    for (const dir of ds) { const kk = k + '|' + dir; if (!best.has(kk) || best.get(kk).d > q.d) best.set(kk, { short: k, dir, sid: q.sid, s: L.stops[q.sid] || { name: q.name, lat: q.lat, lon: q.lon }, d: q.d, area: q.area, net: q.net }); }
  }
  const ap = d => ({ duration: d * 1.3 / MB.SPEED, distance: d * 1.3, source: 'approx' });
  const prev = new Map(U.near.map(g => [g.key + '@' + g.sid + '@' + o.join(), g.walk]));
  U.near = [...best.values()].map(q => { const key = q.short + '|' + q.dir; const pw = prev.get(key + '@' + q.sid + '@' + o.join()); return { ...q, key, walk: pw || ap(q.d) }; });
  U.places = groupPlaces(within);
  U.mapPlaces = groupPlaces(cand.filter(q => q.d <= Math.max(R, 1800)));
  sortNear();
  if (quick) return;
  const key = o.join(), sids = [...new Map(U.near.map(g => [g.sid, g.s])).entries()].slice(0, 10);
  let i = 0;
  const next = async () => {
    while (i < sids.length) {
      const [sid, s] = sids[i++]; const w = await walkRoute(O, s);
      if (!U.origin || [U.origin.lat, U.origin.lon].join() !== key) return;
      for (const g of U.near) if (g.sid === sid) g.walk = w;
      sortNear(); render(); syncMap();
    }
  };
  for (let c = 0; c < 3; c++) next();
}
function sortNear() { U.near.sort((a, b) => a.walk.duration - b.walk.duration); }
function nearGroups() { // une carte par ligne (la plus proche d'abord), puis ses sens
  const by = new Map();
  for (const g of U.near) { if (!by.has(g.short)) by.set(g.short, []); by.get(g.short).push(g); }
  const now = Date.now(); // lignes qui passent dans l'heure d'abord (par distance), puis celles qui dorment
  const soonOf = rows => rows.some(r => { const d = rowDeps(r, now, 1)[0]; return d && d.t - now < 60 * 60e3; });
  return [...by.entries()].map(([short, rows]) => ({ short, rows: rows.sort((a, b) => a.dir - b.dir), w: Math.min(...rows.map(r => r.walk.duration)), soon: soonOf(rows) }))
    .sort((a, b) => (b.soon - a.soon) || Math.round(a.w / 60) - Math.round(b.w / 60) || byMode(a.short, b.short) || a.w - b.w);
}
function rowDeps(g, now, n = 8) { return departures(g.short, g.sid, now, n + 4).filter(d => d.dir === g.dir && d.t > now - 20e3).slice(0, n); }
// Ligne secondaire : « Tu l'as · pars à 13:08 » / « Juste · presse le pas » / « Raté · suivant dans 12 min » — seulement si utile.
function verdictLine(ds, W, now) {
  const a = ds[0]; if (!a || W == null || W > 15 * 60 || a.t - now > 30 * 60e3) return { html: '', miss: false }; // loin à pied : verdict inutile
  const v = nbVerdict(a, W, now);
  if (v.k === 'ok') return { html: `<span class="v ok">Tu l'as</span><span>${v.left < 90e3 ? 'pars maintenant' : 'pars à ' + fmtHM(v.leaveBy)}</span>`, miss: false };
  if (v.k === 'tight') return { html: '<span class="v tight">Juste</span><span>presse le pas</span>', miss: false };
  const nx = ds.find(d => nbVerdict(d, W, now).k !== 'miss');
  return { html: `<span class="v miss">Raté</span>${nx ? `<span>suivant ${minsOf(nx.t, now) < 60 ? relWhen(nx, now) : 'à ' + fmtHM(nx.t)}</span>` : ''}`, miss: true };
}
// Un sens d'une ligne : « vers Terminus » à gauche, gros compte à rebours à droite, les suivants dessous.
function dirRowHTML(g, ds, W, now, o = {}) {
  const a = ds[0], vl = verdictLine(ds, W, now);
  const sub = vl.html || (a ? '' : `<span>Plus de ${vehicleWord(g.short)} aujourd'hui</span>`);
  const inner = `<span class="dir-l"><span class="dir-to"><small>vers</small><b>${esc(dirName(g.short, g.dir, a && a.headsign))}</b></span>${sub ? `<span class="dir-sub">${sub}</span>` : ''}${o.stop ? `<span class="dir-at">${I.pin}${esc(o.stop)}</span>` : ''}</span>
      <span class="dir-r">${bigWhen(a, now, vl.miss)}${fin(a)}${nextRow(ds.slice(1, 3), now)}</span>`;
  if (o.static) return `<div class="dir"><div class="dir-h">${inner}</div></div>`;
  const on = U.sel === g.key;
  return `<div class="dir ${on ? 'on' : ''}" data-key="${esc(g.key)}"><button class="dir-h" type="button" aria-expanded="${on}">${inner}</button>${on ? moreHTML(g, ds, W, now) : ''}</div>`;
}
function moreHTML(g, ds, W, now) {
  const tl = ds.map(d => { const v = nbVerdict(d, W, now), late = d.rt && d.delay > 90e3 ? `<small class="late">+${Math.round(d.delay / 60000)} min</small>` : '';
    const hs = d.headsign && !isCode(d.headsign) && d.headsign !== dirName(g.short, g.dir) ? `<small class="hs">→ ${esc(d.headsign)}</small>` : '';
    return `<li class="${v.k === 'miss' ? 'miss' : ''}"><b>${d.rt ? I.live : ''}${fmtHM(d.t)}</b><small>${v.k === 'miss' ? 'raté' : relWhen(d, now)}</small>${late}${hs}${fin(d)}</li>`; }).join('');
  return `<div class="more${U.opened === g.key ? ' opening' : ''}">
      ${tl ? `<ol class="tl">${tl}</ol>` : `<p class="none">Plus de ${vehicleWord(g.short)} prévu.</p>`}
      <div class="more-a"><button type="button" class="link" data-stopsid="${esc(g.short + '|' + g.sid)}">${I.pin}Tous les départs à ${esc(g.s.name)}</button>${N.legacy[g.short] ? `<a class="link faint" href="/lignes.html#/ligne/${N.legacy[g.short]}?${g.dir ? 'd=1&' : ''}s=${encodeURIComponent(g.sid)}">Fiche de la ligne</a>` : ''}</div>
    </div>`;
}
function visibleGroups() {
  let all = nearGroups();
  if (U.mfilter) all = all.filter(gr => modeOf(gr.short) === U.mfilter);
  return U.filter.size ? all.filter(gr => U.filter.has(gr.short)) : all;
}
function lineCardHTML(gr, now) {
  const stops = [...new Set(gr.rows.map(r => r.s.name))], multi = stops.length > 1;
  return `<section class="lc" data-k="${esc(gr.short)}" style="--c:${(S.meta[gr.short] || {}).color}">
      <header class="lc-h">${lb(gr.short)}<span class="lc-n">${multi ? `${stops.length} arrêts proches` : esc(stops[0])}</span><span class="lc-w">${I.walk}${fmtDur(gr.w)}</span></header>
      ${gr.rows.map(g => dirRowHTML(g, rowDeps(g, now, 6), g.walk.duration, now, { stop: multi ? g.s.name : '' })).join('')}</section>`;
}
// Liste en éléments à clé : on ne remplace que les cartes qui changent (pas de saut quand on bouge la carte).
function nearItems(now) {
  const groups = visibleGroups();
  if (!U.near.length) {
    if (U.loading) return null;
    return `<div class="empty"><b>Aucun départ par ici</b><p>Déplace la carte ou cherche où tu vas.</p><p class="cov-s">Couvert : ${(N.index?.networks || []).map(n => esc(n.region)).join(' · ')}</p></div>`;
  }
  if (!groups.length) return `<div class="empty"><b>Rien avec ce filtre</b><p>Ce mode ne passe pas tout près.</p><button type="button" class="btn ghost" data-act="nofilter">Tout afficher</button></div>`;
  return groups.map(gr => ({ k: gr.short, h: lineCardHTML(gr, now) }));
}
function footHTML() { return `<p class="foot"><span class="lg">${I.live}temps réel</span><span>sinon horaire prévu</span>${U.loading ? '<span>· chargement…</span>' : ''}</p>`; }
function skeletonHTML() { return `<div class="list sk-l">${[0, 1, 2].map(() => '<div class="lc sk"><div class="sk-h"><i></i><span></span></div><div class="sk-r"><span></span><b></b></div></div>').join('')}</div>`; }

/* ================= arrêt touché sur la carte ================= */
function stopHTML(now) {
  const p = U.stop, groups = new Map(); let missing = 0;
  for (const q of p.quays) { if (!S.data[q.short]) { missing++; continue; } for (const d of departures(q.short, q.sid, now, 10)) {
    if (d.t < now - 20e3) continue; const k = q.short + '|' + d.dir;
    if (!groups.has(k)) groups.set(k, { short: q.short, dir: d.dir, sid: q.sid, s: q.s, deps: [] });
    const g = groups.get(k); if (!g.deps.some(x => Math.abs(x.t - d.t) < 30e3)) g.deps.push(d);
  } }
  const W = U.stop.walk?.duration ?? (U.origin ? haversine([U.origin.lat, U.origin.lon], [p.lat, p.lon]) * 1.3 / MB.SPEED : null);
  const gs = [...groups.values()].map(g => ({ ...g, deps: g.deps.sort((a, b) => a.t - b.t).slice(0, 3) })).sort((a, b) => byMode(a.short, b.short) || a.dir - b.dir);
  if (!gs.length) return missing ? skeletonHTML() : `<div class="empty"><b>Plus de départ ici pour l'instant</b><p>Aucun passage annoncé à cet arrêt.</p><button type="button" class="btn ghost" data-act="close">Retour</button></div>`;
  const byLine = new Map(); for (const g of gs) { if (!byLine.has(g.short)) byLine.set(g.short, []); byLine.get(g.short).push(g); }
  return `<div class="list">${[...byLine.entries()].map(([k, rows]) => `<section class="lc" style="--c:${(S.meta[k] || {}).color}"><header class="lc-h">${lb(k)}<span class="lc-n">${esc(modeName(k))}</span></header>
      ${rows.map(g => dirRowHTML(g, g.deps, W, now, { static: true })).join('')}</section>`).join('')}</div>${footHTML()}`;
}
function openStop(p) {
  U.stop = { ...p, walk: null }; U.sel = null; render(); syncMap();
  const miss = [...new Set(p.quays.map(q => q.short))].filter(k => !S.data[k]);
  if (miss.length) Promise.all(miss.map(k => getLine(k).catch(() => null))).then(() => { refreshLines(); render(); schedulePoll(); });
  if (U.origin) walkRoute(U.origin, { lat: p.lat, lon: p.lon }).then(w => { if (U.stop && U.stop.k2 === p.k2) { U.stop.walk = w; render(); syncMap(); } });
  schedulePoll(); scrollPanelTop();
}

/* ================= Où vas-tu ? ================= */
async function computePlan(quick) {
  if (!U.origin || !U.dest) { U.plan = null; return render(); }
  const O = U.origin, D = U.dest, key = [O.lat, O.lon, D.lat, D.lon].join(); U.planKey = key;
  const direct = haversine([O.lat, O.lon], [D.lat, D.lon]);
  U.plan = { opts: nbPlan(O, D).slice(0, 4), direct, walkDirect: direct <= 2500 ? { duration: direct * 1.3 / MB.SPEED, distance: direct * 1.3, source: 'approx' } : null, loading: true };
  U.opt = 0; reorder(); render(); syncMap(); if (quick) return;
  const jobs = [];
  for (const op of U.plan.opts) {
    jobs.push(walkRoute(O, op.a.s).then(w => { op.walkA = w; }));
    if (op.b.d > 0) jobs.push(walkRoute({ lat: op.b.s.lat, lon: op.b.s.lon }, { lat: D.lat, lon: D.lon }).then(w => { op.walkB = w; }));
  }
  if (U.plan.walkDirect) jobs.push(walkRoute(O, { lat: D.lat, lon: D.lon }).then(w => { if (U.plan) U.plan.walkDirect = w; }));
  await Promise.all(jobs); if (U.planKey !== key || !U.plan) return;
  U.plan.loading = false; reorder(); U.opt = 0; render(); syncMap(); schedulePoll();
}
function evalOpt(op, now) {
  const deps = nbOptDeps(op, now).map(d => ({ ...d, v: nbVerdict(d, op.walkA.duration, now) }));
  const first = deps.find(d => d.v.k !== 'miss') || null;
  return { deps, first, arrive: first ? first.arr + op.walkB.duration * 1000 : null };
}
function reorder() {
  if (!U.plan) return; const now = Date.now(), cur = U.plan.opts[U.opt];
  for (const op of U.plan.opts) op._arr = evalOpt(op, now).arrive ?? Infinity;
  U.plan.opts.sort((a, b) => a._arr - b._arr || a.cost - b.cost);
  // une option qui ne part que dans plus de 3 h n'a d'intérêt que s'il n'y a rien d'autre
  const soon = U.plan.opts.filter(op => op._arr - now < 4 * 3600e3); if (soon.length && soon.length < U.plan.opts.length) U.plan.opts = soon;
  U.opt = Math.max(0, U.plan.opts.indexOf(cur));
}
function gmapsLink() { const O = U.origin, D = U.dest; return `https://www.google.com/maps/dir/?api=1&origin=${O.lat},${O.lon}&destination=${D.lat},${D.lon}&travelmode=transit`; }
function destHTML(now) {
  const P = U.plan; if (!P) return '';
  const wd = P.walkDirect;
  const walkOnly = wd ? `<div class="walkonly">${I.walk}<span><b>${fmtDur(wd.duration)} à pied</b> si tu marches directement · ${fmtDist(wd.distance)}</span></div>` : '';
  const ext = `<a class="link ext" href="${gmapsLink()}" target="_blank" rel="noopener">${I.ext}Trajets avec correspondance</a>`;
  if (!P.opts.length) return `<div class="empty"><b>Pas de ligne directe</b><p>Aucune ligne d'ici ne va directement là-bas. Les correspondances arrivent bientôt.</p><p>${ext}</p><button type="button" class="btn ghost" data-act="cleardest">Autre destination</button></div>${walkOnly}`;
  return `<div class="opts">${P.opts.slice(0, 3).map((op, i) => optHTML(op, i, now)).join('')}</div>${walkOnly}
    ${P.loading ? '<p class="foot"><span>Calcul des trajets à pied…</span></p>' : `<p class="foot">${ext}</p>`}`;
}
function optHTML(op, i, now) {
  const on = i === U.opt, ev = evalOpt(op, now), f = ev.first;
  const total = ev.arrive ? Math.round((ev.arrive - now) / 60000) : null;
  const ride = f ? f.ride : op.ride, ns = f ? f.stops : op.b.k - op.a.k;
  const after = f ? ev.deps.filter(d => d.t > f.t)[0] : null;
  const slow = U.plan.walkDirect && ev.arrive && now + U.plan.walkDirect.duration * 1000 <= ev.arrive;
  const missed = !f && ev.deps[0];
  const tot = total != null ? (total < 60 ? `<span class="cd"><b>${total}</b><small>min</small></span>` : `<span class="cd hm"><b>${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}</b></span>`) + `<small>arrivée ${fmtHM(ev.arrive)}</small>` : '<span class="cd none"><b>—</b></span><small>plus de départ</small>';
  const board = f ? `<b class="${f.rt ? 'rt' : ''}">${f.rt ? I.live : ''}${relWhen(f, now)}</b> · ${fmtHM(f.t)}${fin(f)} ${vPill(f.v)}` : missed ? `Dernier à ${fmtHM(missed.t)} ${vPill(missed.v)}` : 'Plus de départ aujourd\'hui';
  return `<div class="opt ${on ? 'on' : ''}" data-opt="${i}" role="button" tabindex="0" aria-pressed="${on}">
    <div class="opt-h">${lb(op.short)}<span class="dir-to"><small>vers</small><b>${esc(headOf(op.short, op.dir))}</b></span><span class="opt-tot">${tot}</span></div>
    <ol class="steps">
      <li>${I.walk}<span><b>${fmtDur(op.walkA.duration)}</b> à pied jusqu'à <b>${esc(op.a.s.name)}</b></span></li>
      <li class="ride">${lb(op.short, 'xs')}<span>${board}<small>${after ? `puis ${fmtHM(after.t)}${after.fin ? ' (fin)' : ''} · ` : ''}${Math.max(1, Math.round(ride / 60))} min de trajet · ${ns} arrêt${ns > 1 ? 's' : ''}</small></span></li>
      <li>${I.flag}<span>Descends à <b>${esc(op.b.s.name)}</b>${op.b.d > 0 ? ` · ${fmtDur(op.walkB.duration)} à pied` : ''}</span></li>
    </ol>${slow && on ? `<p class="opt-warn">${I.walk}Aussi rapide à pied (${fmtDur(U.plan.walkDirect.duration)}).</p>` : ''}</div>`;
}
function fitOpt() {
  if (!U.origin || !U.dest || !U.map) return;
  const pts = [[U.dest.lat, U.dest.lon]]; const op = U.plan?.opts[U.opt];
  if (op) pts.push([op.a.s.lat, op.a.s.lon], [op.b.s.lat, op.b.s.lon]);
  flyTo(U.origin, { zoom: zoomToInclude(U.origin, pts, 16.4) });
}

/* ================= adresse (repli sans géolocalisation) ================= */
function askHTML() {
  const last = mbGet('onde-addr');
  const why = U.geo === 'denied' ? 'Localisation refusée. ' : U.geo === 'unavailable' ? 'Position introuvable. ' : '';
  return `<div class="ask">
    ${U.origin ? `<button class="back" type="button" data-act="unask" aria-label="Retour">${I.x}</button>` : ''}
    <h1>Tu pars d'où&nbsp;?</h1><p>${why}Une adresse, une gare, un arrêt ou un lieu.</p>
    <div class="field"><label class="search-in">${I.pin}<input id="addr" type="search" inputmode="search" enterkeyhint="search" autocomplete="street-address" placeholder="Adresse, gare, arrêt, lieu…" aria-label="Ton adresse ou un lieu"></label><div class="results" id="addrRes" role="listbox"></div></div>
    ${last && (!U.origin || U.origin.label !== last.label) ? `<button type="button" class="link" data-act="last">${I.pin}${esc(last.label)}</button>` : ''}
    ${U.geo !== 'denied' && U.origin?.src !== 'gps' && 'geolocation' in navigator && U.origin ? `<button type="button" class="link" data-act="geo">${I.gps}Utiliser ma position</button>` : ''}
  </div>`;
}
function pendingHTML() { return `<div class="empty state"><div class="pulse"><i></i><i></i>${I.gps}</div><b>On te localise…</b><p>Accepte la localisation pour voir les départs autour de toi.</p><button type="button" class="btn ghost" data-act="ask">Indiquer une adresse</button></div>`; }

/* ================= statut, filtres, rendu ================= */
let lastSig = '', lastHTML = '';
function mode() { if (!U.dataReady) return 'loading'; if (U.ask || !U.origin) return U.geo === 'pending' && !U.ask ? 'pending' : 'ask'; if (U.stop) return 'stop'; if (U.dest) return 'dest'; return 'near'; }
function statusHTML(m) {
  if (m === 'stop') {
    const p = U.stop, W = p.walk?.duration;
    const dist = U.origin ? haversine([U.origin.lat, U.origin.lon], [p.lat, p.lon]) : null;
    return `<button class="back" type="button" data-act="close" aria-label="Retour">${I.back}</button>
      <div class="status-t"><b>${esc(p.name)}</b><span class="st-l">${p.lines.slice(0, 6).map(s => lb(s, 'xs')).join('')}${p.lines.length > 6 ? `<i class="more-n">+${p.lines.length - 6}</i>` : ''}${W != null ? `<span class="st-w">${I.walk}${fmtDur(W)}</span>` : dist != null ? `<span class="st-w">${fmtDist(dist)}</span>` : ''}</span></div>`;
  }
  if (m === 'dest') {
    const from = U.origin.src === 'gps' ? 'ta position' : U.origin.src === 'pin' ? 'le point sur la carte' : U.origin.label;
    return `<button class="back" type="button" data-act="cleardest" aria-label="Retour aux départs proches">${I.back}</button>
      <div class="status-t"><b>Vers ${esc(U.dest.label)}</b><span>depuis ${esc(from)}</span></div>`;
  }
  const O = U.origin, pin = O.src === 'pin' || O.src === 'home';
  const far = U.R > NB.R && U.near.length;
  const title = far ? 'Un peu plus loin' : (O.src === 'gps' ? 'Autour de toi' : "Autour d'ici");
  const where = O.src === 'gps' ? (O.stale ? 'Ta dernière position' : O.label === 'Ma position' ? 'Ta position' : esc(O.label)) : pin ? (O.label === 'Point choisi' ? 'Point sur la carte' : esc(O.label)) : esc(O.label);
  return `<div class="status-t row1"><b>${title}</b><button type="button" class="where" data-act="ask" title="Changer de point de départ">${I.pin}<span>${where}</span></button></div>`;
}
function renderStatus(m) {
  const el = $('#status'); const show = m === 'near' || m === 'dest' || m === 'stop';
  el.hidden = !show; if (!show) return;
  const h = statusHTML(m); if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}
// Filtres : les modes d'abord (Tout · Métro · RER · Bus…) ; les lignes n'apparaissent qu'une fois un mode choisi.
function renderFilters(m) {
  const el = $('#filters'); const keys = [...new Set(U.near.map(g => g.short))];
  const modes = [...new Set(keys.map(modeOf))].sort((a, b) => MODES[a].o - MODES[b].o);
  const show = m === 'near' && (modes.length > 1 || U.mfilter); el.hidden = !show; if (!show) return;
  let h = `<button type="button" class="fchip mode ${!U.mfilter ? 'on' : ''}" data-mode="" aria-pressed="${!U.mfilter}">Tout</button>` + modes.map(md => `<button type="button" class="fchip mode ${U.mfilter === md ? 'on' : ''}" data-mode="${md}" aria-pressed="${U.mfilter === md}">${modeIcon(md)}${MODES[md].n}</button>`).join('');
  if (U.mfilter) { const lk = keys.filter(k => modeOf(k) === U.mfilter).sort(byMode); if (lk.length > 1) h += '<span class="fsep" aria-hidden="true"></span>' + lk.map(k => { const l = S.meta[k]; return `<button type="button" class="fchip ln ${U.filter.has(k) ? 'on' : ''}" data-line="${esc(k)}" style="--c:${l.color};--t:${l.textColor}" aria-pressed="${U.filter.has(k)}">${esc(lbl(k))}</button>`; }).join(''); }
  if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
}
const tpl = document.createElement('template');
const nodeOf = h => { tpl.innerHTML = h.trim(); return tpl.content.firstElementChild; };
// Mise à jour à clé : on garde les nœuds identiques, on remplace ceux qui changent, on ne fait apparaître que les nouveaux.
function patchKeyed(list, items) {
  const old = new Map([...list.children].map(c => [c.dataset.k, c])); let prev = null;
  for (const it of items) {
    let el = old.get(it.k);
    if (el) { old.delete(it.k); if (el._h !== it.h) { const n = nodeOf(it.h); n._h = it.h; el.replaceWith(n); el = n; } }
    else { el = nodeOf(it.h); el._h = it.h; if (list.childElementCount) el.classList.add('enter'); }
    const want = prev ? prev.nextElementSibling : list.firstElementChild;
    if (el !== want) list.insertBefore(el, want);
    prev = el;
  }
  for (const el of old.values()) el.remove();
}
function render() {
  const m = mode(), now = Date.now();
  $('#searchBox').hidden = !(m === 'near' || m === 'dest' || m === 'stop');
  $('#app').dataset.mode = m;
  renderStatus(m); renderFilters(m);
  if (m === 'ask') {
    if (lastSig !== 'ask') { panel.innerHTML = askHTML(); lastSig = 'ask'; lastHTML = ''; const inp = $('#addr'); nbSearch(inp, $('#addrRes'), h => { U.followGps = false; setOrigin({ label: h.label, lat: h.lat, lon: h.lon, src: 'addr' }, true); }); if (isDesk() || U.geo !== 'pending') setTimeout(() => inp.focus({ preventScroll: true }), 60); }
    return;
  }
  if (m === 'near') {
    const items = nearItems(now);
    if (Array.isArray(items)) {
      let list = lastSig === 'near-list' ? panel.querySelector('.list.near') : null;
      if (!list) { panel.innerHTML = '<div class="list near"></div>' + footHTML(); list = panel.firstElementChild; lastSig = 'near-list'; lastHTML = ''; }
      patchKeyed(list, items);
      const f = footHTML(), fe = panel.querySelector('.foot'); if (fe && fe._h !== f) { fe.outerHTML = f; panel.querySelector('.foot')._h = f; }
      U.opened = null; return;
    }
    const h = items || skeletonHTML(); if (h !== lastHTML || lastSig !== 'near') { panel.innerHTML = h; lastHTML = h; lastSig = 'near'; } return;
  }
  const h = m === 'loading' ? skeletonHTML() : m === 'pending' ? pendingHTML() : m === 'stop' ? stopHTML(now) : destHTML(now);
  if (h !== lastHTML || lastSig !== m) { panel.innerHTML = h; lastHTML = h; lastSig = m; }
}
function scrollPanelTop() { const p = $('#panel'); if (p && p.scrollTop > 0) p.scrollTo({ top: 0, behavior: 'smooth' }); }

$('#sheet').addEventListener('click', e => {
  const t = e.target; const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'ask') { U.ask = true; if (!isDesk() && U.sheet === 'peek') setSheet('half'); return render(); }
  if (act === 'unask') { U.ask = false; return render(); }
  if (act === 'geo') return locate(true);
  if (act === 'last') { const l = mbGet('onde-addr'); if (l) setOrigin({ ...l, src: 'addr' }, true); return; }
  if (act === 'close') { U.stop = null; render(); syncMap(); return U.dest ? fitOpt() : fitNear(); }
  if (act === 'cleardest') return clearDest();
  if (act === 'nofilter') { U.filter.clear(); U.mfilter = null; render(); syncMap(); return; }
  if (act === 'reload') { location.reload(); return; }
  const mc = t.closest('.fchip[data-mode]'); if (mc) { const md = mc.dataset.mode; U.mfilter = !md || U.mfilter === md ? null : md; U.filter.clear(); render(); syncMap(); scrollPanelTop(); return; }
  const chip = t.closest('.fchip[data-line]');
  if (chip) { const s = chip.dataset.line; if (U.filter.has(s)) U.filter.delete(s); else U.filter.add(s); render(); syncMap(); return; }
  const st = t.closest('[data-stopsid]'); if (st) { const v = st.dataset.stopsid, i = v.lastIndexOf('|'), sh = v.slice(0, i), sid = v.slice(i + 1); const p = U.mapPlaces.find(p => p.quays.some(q => q.short === sh && q.sid === sid)); if (p) openStop(p); return; }
  const rh = t.closest('button.dir-h'); if (rh) { const k = rh.parentElement.dataset.key; U.sel = U.sel === k ? null : k; U.opened = U.sel; render(); syncMap(); if (U.sel) { fitSel(); if (!isDesk() && U.sheet !== 'full') setSheet('full'); } return; }
  const op = t.closest('.opt'); if (op) { U.opt = +op.dataset.opt; render(); syncMap(); fitOpt(); }
});
$('#sheet').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('opt')) { e.preventDefault(); e.target.click(); } });

/* ================= barre « Où vas-tu ? » ================= */
const qIn = $('#q');
const qSearch = nbSearch(qIn, $('#qRes'), d => setDest(d));
qIn.addEventListener('input', () => { $('#qClear').hidden = !qIn.value; });
qIn.addEventListener('focus', () => { if (U.dest) qIn.select(); if (!isDesk()) { setSheet('full'); setTimeout(() => scrollPanelTop(), 50); } });
$('#qClear').onclick = () => { qIn.value = ''; $('#qClear').hidden = true; $('#qRes').innerHTML = ''; if (U.dest) clearDest(); else qIn.focus(); };
function setDest(d) { U.dest = d; U.stop = null; U.sel = null; qIn.value = d.label; $('#qClear').hidden = false; if (!isDesk()) setSheet('half'); computePlan().then(() => fitOpt()); scrollPanelTop(); }
function clearDest() { U.dest = null; U.plan = null; qIn.value = ''; $('#qClear').hidden = true; render(); syncMap(); fitNear(); }

/* ================= temps réel : uniquement pour ce qui est affiché ================= */
// IDF : PRIM stop-monitoring par zone d'arrêt (3 zones max, les plus proches) ; 4 lignes historiques : flux « ligne ».
// Ilévia / SNCF : un flux GTFS-RT par réseau. Le serveur et le CDN mettent tout en cache : peu d'appels amont.
const RTP = { sm: new Map(), smAt: new Map(), gt: new Map(), gtAt: new Map(), et: new Map(), etAt: new Map(), timer: null };
const SM_EVERY = 60e3, GT_EVERY = 30e3, ET_EVERY = 30e3, SM_MAX = 3;
function schedulePoll() { clearTimeout(RTP.timer); RTP.timer = setTimeout(pollNear, 450); }
function rtTargets() {
  const lines = new Set(), areas = [];
  const add = (net, area, k) => { if (net === 'idfm' && area && !N.legacy[k] && !areas.includes(area) && areas.length < SM_MAX) areas.push(area); };
  if (U.stop) { for (const q of U.stop.quays) lines.add(q.short); if (U.stop.net === 'idfm' && U.stop.area) areas.push(U.stop.area); }
  else if (U.dest && U.plan) for (const o of U.plan.opts.slice(0, 3)) { lines.add(o.short); add(o.short.split(':')[0], (S.data[o.short]?.stops[o.a.sid] || {}).area, o.short); }
  else for (const r of visibleGroups().flatMap(g => g.rows).sort((a, b) => a.walk.duration - b.walk.duration)) { lines.add(r.short); add(r.net, r.area, r.short); }
  for (const g of U.near) lines.add(g.short);
  return { lines: [...lines].filter(k => S.data[k]), areas };
}
async function pollNear() {
  clearTimeout(RTP.timer); RTP.timer = setTimeout(pollNear, 30e3);
  if (document.hidden || !U.dataReady) return;
  const { lines, areas } = rtTargets(), now = Date.now(), jobs = [];
  for (const k of lines) { const short = N.legacy[k]; if (!short || now - (RTP.etAt.get(k) || 0) < ET_EVERY) continue; RTP.etAt.set(k, now);
    jobs.push(fetch('/api/rt/' + short).then(r => r.json()).then(r => { RTP.et.set(k, { at: Date.now(), r }); }).catch(() => { })); }
  for (const a of areas) { if (now - (RTP.smAt.get(a) || 0) < SM_EVERY) continue; RTP.smAt.set(a, now);
    jobs.push(fetch('/api/sm/' + a).then(r => r.json()).then(r => { RTP.sm.set(a, { at: Date.now(), r }); }).catch(() => { })); }
  for (const net of new Set(lines.map(k => k.split(':')[0]))) { const n = N.index.networks.find(x => x.id === net); if (!n || n.rt?.type !== 'gtfsrt' || now - (RTP.gtAt.get(net) || 0) < GT_EVERY) continue; RTP.gtAt.set(net, now);
    jobs.push(fetch('/api/gtfsrt/' + net).then(r => r.json()).then(r => { RTP.gt.set(net, { at: Date.now(), r }); }).catch(() => { })); }
  if (!jobs.length) return;
  await Promise.all(jobs); applyRT(); render(); syncMap();
}
function applyRT() {
  const now = Date.now(), fresh = 6 * 60e3, sm = new Map();
  for (const [, { at, r }] of RTP.sm) { if (now - at > fresh || r.mode !== 'temps-reel') continue;
    for (const [stop, line, destRef, dest, t, , canc] of r.visits) { const k = 'idfm:' + line; if (!S.data[k]) continue; let a = sm.get(k); if (!a) sm.set(k, a = { fetchedAt: r.fetchedAt, journeys: [] });
      a.journeys.push({ dest, destRef, calls: [{ stop, ed: t, st: canc ? 'cancelled' : null }] }); } }
  const gt = new Map();
  for (const [net, { at, r }] of RTP.gt) { if (now - at > fresh || r.mode !== 'temps-reel') continue;
    const by = new Map(); let noDate = false; for (const [tid, date, u] of r.trips) { if (!date) noDate = true; by.set(date ? tid + '|' + date : tid, u); }
    gt.set(net, { mode: 'temps-reel', kind: 'trips', byTrip: by, noDate, fetchedAt: r.fetchedAt }); }
  for (const k of Object.keys(S.data)) {
    if (!k.includes(':')) continue; const net = k.split(':')[0]; let R = null;
    const et = RTP.et.get(k);
    if (et && now - et.at < fresh && et.r.mode === 'temps-reel') R = { ...et.r, kind: 'line' };
    else if (sm.has(k)) R = { mode: 'temps-reel', kind: 'stops', ...sm.get(k) };
    else if (gt.has(net)) R = gt.get(net);
    if (R) S.rt[k] = R; else delete S.rt[k];
    S.journeys[k] = null; S.journeysAt[k] = 0;
  }
  for (const m of busMk.values()) m.remove(); busMk.clear();
}

/* ================= carte (MapLibre GL + OpenFreeMap) ================= */
async function styleFor() {
  if (U.sat) {
    if (!U.styles.sat) {
      const base = await getStyle('light').catch(() => null);
      const labels = base ? base.layers.filter(l => l.type === 'symbol' && l.source === 'openmaptiles' && /name|label|place/.test(l.id)).map(l => ({ ...l, paint: { ...l.paint, 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.75)', 'text-halo-width': 1.4 } })) : [];
      U.styles.sat = { version: 8, glyphs: base?.glyphs || OSM_FONTS, sprite: base?.sprite, sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' }, ...(base ? { openmaptiles: base.sources.openmaptiles } : {}) }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }, ...labels] };
    }
    return U.styles.sat;
  }
  return getStyle(isDark() ? 'dark' : 'light');
}
async function getStyle(k) {
  if (U.styles[k]) return U.styles[k];
  const s = await fetch(STYLE_URL[k]).then(r => { if (!r.ok) throw new Error('style ' + r.status); return r.json(); });
  s.layers = s.layers.filter(l => !/building-3d|poi_r20|poi_r7/.test(l.id));
  return (U.styles[k] = s);
}
window.ondeMapLib = initMap;
async function initMap() {
  if (U.map || !window.maplibregl) return;
  let style; try { style = await styleFor(); } catch (e) { return mapFail('Fond de carte indisponible (hors ligne ?).'); }
  let map;
  try {
    const cam = startCam();
    map = U.map = new maplibregl.Map({
      container: 'map', style, center: cam.center, zoom: cam.zoom, minZoom: 5, maxZoom: 19.5,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, renderWorldCopies: false,
      attributionControl: { compact: true }, fadeDuration: 150, maxBounds: FRANCE,
      padding: isDesk() ? undefined : { top: 0, right: 0, bottom: currentSheetH(), left: 0 },
    });
  } catch (e) { return mapFail('Ton navigateur ne peut pas afficher la carte (WebGL).'); }
  map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation();
  map.once('load', () => { if (map.getContainer().clientWidth < 600) map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'); });
  map.on('error', ev => { if (ev && ev.error && /webgl/i.test(String(ev.error.message))) mapFail('Carte indisponible (WebGL).'); });
  map.on('style.load', () => { U.styleReady = true; addOverlays(); });
  map.on('styleimagemissing', e => { if (/^b:/.test(e.id) && !map.hasImage(e.id)) { const b = badgeImage(e.id.slice(2)); map.addImage(e.id, b.img, { pixelRatio: b.r }); } });
  bindMapEvents(map);
  busLoop();
}
function startCam() { const o = U.origin || HOME; return { center: [o.lon, o.lat], zoom: o.src === 'home' ? 14.8 : 15.4 }; }
function mapFail(msg) { const m = $('#mapMsg'); m.hidden = false; m.textContent = msg; }
const ll = p => [p[1], p[0]];
function flyTo(o, opts = {}) {
  if (!U.map || !o) return;
  const cur = U.map.getZoom(); const zoom = opts.zoom != null ? opts.zoom : (cur < 13.5 ? 15.2 : cur);
  U.camLock = true; const dur = opts.duration != null ? opts.duration : 650;
  if (!dur) U.map.jumpTo({ center: [o.lon, o.lat], zoom }); else U.map.easeTo({ center: [o.lon, o.lat], zoom, duration: dur });
}
function zoomToInclude(o, pts, maxZoom = 16.2) {
  const map = U.map; if (!map || !window.maplibregl?.MercatorCoordinate) return Math.min(maxZoom, map.getZoom() || 15);
  const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight - currentSheetH();
  const padT = 70, padB = 28, padL = 36, padR = 56;
  const cs = maplibregl.MercatorCoordinate.fromLngLat({ lon: o.lon, lat: o.lat }); let z = maxZoom;
  for (const [lat, lon] of pts) {
    const p = maplibregl.MercatorCoordinate.fromLngLat({ lon, lat }); const dx = (p.x - cs.x) * 512, dy = (p.y - cs.y) * 512;
    const availX = (dx >= 0 ? W / 2 - padR : W / 2 - padL), availY = (dy >= 0 ? H / 2 - padB : H / 2 - padT);
    if (Math.abs(dx) > 1e-12 && availX > 8) z = Math.min(z, Math.log2(availX / (Math.abs(dx) * 512)));
    if (Math.abs(dy) > 1e-12 && availY > 8) z = Math.min(z, Math.log2(availY / (Math.abs(dy) * 512)));
  }
  return Math.max(10.5, Math.min(maxZoom, z));
}
function fitNear() { if (U.origin) flyTo(U.origin, { zoom: U.map && U.map.getZoom() < 13.5 ? 15.2 : undefined }); }
function fitSel() { const g = U.near.find(g => g.key === U.sel); if (g && U.origin && U.map) flyTo(U.origin, { zoom: zoomToInclude(U.origin, [[g.s.lat, g.s.lon]], 17) }); }

// Pastilles des arrêts : image générée à la demande (« b:<lignes> »), forme selon le mode (rond métro, carré RER…).
const BADGE = { h: 16, gap: 3, pad: 3, m: 2 };
function badgeImage(spec) {
  const [ks, extra] = spec.split('+'), keys = ks.split(',').filter(Boolean), r = 2, { h, gap, pad, m } = BADGE;
  const cv = document.createElement('canvas'), c = cv.getContext('2d'), F = '800 11px Inter, "Helvetica Neue", Arial, sans-serif';
  c.font = F;
  const items = keys.map(k => { const meta = S.meta[k] || { color: '#888', textColor: '#fff', mode: 'bus' }; const t = lbl(k); const round = meta.mode === 'metro' && t.length <= 3; const w = round ? h + 2 : Math.max(h + 8, Math.ceil(c.measureText(t).width) + 10); return { meta, t, w, round }; });
  const ex = extra ? Math.ceil(c.measureText('+' + extra).width) + 6 : 0;
  const W = m * 2 + pad * 2 + items.reduce((a, x) => a + x.w, 0) + Math.max(0, items.length - 1) * gap + (ex ? gap + ex : 0), H = m * 2 + pad * 2 + h;
  cv.width = W * r; cv.height = H * r; c.scale(r, r);
  const rr = (x, y, ww, hh, rad) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, ww, hh, rad) : c.rect(x, y, ww, hh); };
  c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 3; c.shadowOffsetY = .8;
  rr(m, m, W - 2 * m, H - 2 * m, 9); c.fillStyle = isDark() && !U.sat ? '#1c2230' : '#ffffff'; c.fill(); c.shadowColor = 'transparent';
  c.font = F; c.textAlign = 'center'; c.textBaseline = 'middle';
  let x = m + pad; const y = m + pad;
  for (const it of items) {
    const md = it.meta.mode; rr(x, y, it.w, h, it.round ? h / 2 : md === 'rer' || md === 'train' ? 4 : md === 'tram' ? 3 : h / 2);
    c.fillStyle = it.meta.color; c.fill(); c.fillStyle = it.meta.textColor; c.fillText(it.t, x + it.w / 2, y + h / 2 + .5); x += it.w + gap;
  }
  if (ex) { c.fillStyle = isDark() && !U.sat ? '#aab3c2' : '#5a616e'; c.fillText('+' + extra, x + ex / 2, y + h / 2 + .5); }
  return { img: c.getImageData(0, 0, W * r, H * r), r };
}
function placeImg(p) { const ks = p.lines.slice(0, 4); return 'b:' + ks.join(',') + (p.lines.length > 4 ? '+' + (p.lines.length - 4) : ''); }
function stopsGeo() {
  return { type: 'FeatureCollection', features: U.mapPlaces.map((p, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { i, name: p.name, img: placeImg(p), rank: Math.round(p.d ?? 9999) - (p.lines.some(k => MODE_RANK(k) < 5) ? 400 : 0), big: p.lines.some(k => MODE_RANK(k) < 5) ? 1 : 0 } })) };
}
function linesGeo() { // tracés des lignes proches (un par ligne et par sens desservi)
  const f = [], seen = new Set();
  for (const g of U.near) { const L = S.data[g.short]; const M = L && (L.main[g.dir] || L.main[0]); if (!M || seen.has(g.key)) continue; seen.add(g.key);
    f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: M.shape.map(ll) }, properties: { key: g.key, short: g.short, color: S.meta[g.short].color, rail: MODE_RANK(g.short) < 5 ? 1 : 0 } }); }
  f.sort((a, b) => a.properties.rail - b.properties.rail);
  return { type: 'FeatureCollection', features: f };
}
const EMPTY = { type: 'FeatureCollection', features: [] };
function addOverlays() {
  const map = U.map; if (!map || !U.styleReady || map.getSource('stops')) return;
  const dark = isDark() && !U.sat; linesSig = '';
  for (const s of ['lines', 'focus', 'walk', 'stops', 'marks', 'gpsacc', 'radius']) map.addSource(s, { type: 'geojson', data: EMPTY });
  const W = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 11, a, 15, b, 18, c];
  const rail = (a, b) => ['case', ['==', ['get', 'rail'], 1], a, b];
  map.addLayer({ id: 'radius', type: 'line', source: 'radius', paint: { 'line-color': dark ? '#7ea6ff' : '#1a73e8', 'line-opacity': .3, 'line-width': 1.2, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'gpsacc', type: 'fill', source: 'gpsacc', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'gpsacc-ol', type: 'line', source: 'gpsacc', paint: { 'line-color': '#1a73e8', 'line-opacity': 0.3, 'line-width': 1 } });
  map.addLayer({ id: 'lines-case', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0b0e14' : '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, rail(4.5, 3), 15, rail(8, 6), 18, rail(13, 10)], 'line-opacity': U.sat ? .5 : .9 } });
  map.addLayer({ id: 'lines', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, rail(2.2, 1.2), 15, rail(4.4, 2.6), 18, rail(7.5, 4.8)], 'line-opacity': .55 } });
  map.addLayer({ id: 'focus-case', type: 'line', source: 'focus', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0b0e14' : '#ffffff', 'line-width': W(6, 10, 15) } });
  map.addLayer({ id: 'focus', type: 'line', source: 'focus', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': W(3.5, 6.5, 10) } });
  map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': W(3, 4.5, 6), 'line-dasharray': [0.1, 1.8] } });
  map.addLayer({ id: 'stops-dot', type: 'circle', source: 'stops', minzoom: 12, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, ['case', ['==', ['get', 'big'], 1], 3.4, 2], 15, ['case', ['==', ['get', 'big'], 1], 6, 4.2], 18, 7.5],
    'circle-color': dark ? '#e8ebf1' : '#ffffff', 'circle-stroke-color': dark ? '#0b0e14' : '#2c3036',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2, 18, 2.5] } });
  map.addLayer({ id: 'stops-sel', type: 'circle', source: 'stops', filter: ['==', ['get', 'i'], -1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 7, 16, 11, 18, 14], 'circle-color': 'rgba(26,115,232,.18)', 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'stops-lbl', type: 'symbol', source: 'stops', minzoom: 13.6, layout: {
    'icon-image': ['get', 'img'], 'icon-anchor': 'left', 'icon-offset': [6, 0], 'icon-padding': 1, 'symbol-sort-key': ['get', 'rank'],
    'text-field': ['step', ['zoom'], '', 15.8, ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5,
    'text-anchor': 'top-left', 'text-offset': [0.55, 0.95], 'text-optional': true, 'text-max-width': 11, 'text-padding': 2 },
    paint: { 'text-color': U.sat ? '#ffffff' : dark ? '#e6e9ef' : '#202124', 'text-halo-color': U.sat ? 'rgba(0,0,0,.8)' : dark ? '#0b0e14' : '#ffffff', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'stops-hit', type: 'circle', source: 'stops', minzoom: 12.5, paint: { 'circle-radius': 16, 'circle-opacity': 0 } });
  map.addLayer({ id: 'marks', type: 'circle', source: 'marks', paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 4 } });
  map.addLayer({ id: 'marks-lbl', type: 'symbol', source: 'marks', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-allow-overlap': true }, paint: { 'text-color': dark ? '#ffffff' : '#202124', 'text-halo-color': dark ? '#0b0e14' : '#ffffff', 'text-halo-width': 2 } });
  syncMap(true);
}
function bindMapEvents(map) {
  const pick = e => { const f = map.queryRenderedFeatures(e.point, { layers: ['stops-hit', 'stops-lbl'] })[0]; if (!f) return false; const p = U.mapPlaces[f.properties.i]; if (p) openStop(p); return true; };
  map.on('click', e => { pick(e); });
  map.on('mousemove', e => { if (!map.getLayer('stops-hit')) return; const f = map.queryRenderedFeatures(e.point, { layers: ['stops-hit', 'stops-lbl'] }); map.getCanvas().style.cursor = f.length ? 'pointer' : ''; });
  // seul un geste de l'utilisateur déplace l'origine (les animations de caméra/marges programmées ne la touchent pas)
  map.on('movestart', e => { if (e.originalEvent) { U.userMove = true; U.followGps = false; map.getContainer().parentElement.classList.add('moving'); } });
  map.on('move', () => { if (U.userMove && !U.camLock) schedulePin(false); });
  map.on('moveend', () => { map.getContainer().parentElement.classList.remove('moving'); U.camLock = false; if (U.userMove) { U.userMove = false; schedulePin(true); } });
}
let destMk = null, gpsMk = null, linesSig = '';
function circleFC(lat, lon, r, n = 64) {
  const coords = [], latR = r / 111320, lonR = r / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; coords.push([lon + lonR * Math.sin(a), lat + latR * Math.cos(a)]); }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }] };
}
function syncMap() {
  const map = U.map; if (!map || !U.styleReady || !map.getSource('stops')) return;
  const pin = $('#mePin');
  if (pin && U.origin) { pin.classList.toggle('addr', U.origin.src === 'addr'); pin.classList.toggle('pin', U.origin.src === 'pin' || U.origin.src === 'home'); pin.classList.toggle('gps', U.origin.src === 'gps'); }
  const me = $('#btnMe'); if (me) me.classList.toggle('on', !!(U.followGps && U.gps));
  const acc = U.gps ? Math.min(Math.max(U.gps.acc || 0, 18), 250) : 0;
  map.getSource('gpsacc').setData(U.gps && acc ? circleFC(U.gps.lat, U.gps.lon, acc) : EMPTY);
  map.getSource('radius').setData(EMPTY); // pas de cercle : moins de bruit sur la carte
  const away = U.gps && (!U.origin || U.origin.src !== 'gps' || haversine([U.origin.lat, U.origin.lon], [U.gps.lat, U.gps.lon]) > 22);
  if (away) { if (!gpsMk) { const el = document.createElement('div'); el.className = 'gps-dot'; el.title = 'Ta position réelle'; gpsMk = new maplibregl.Marker({ element: el }).setLngLat([U.gps.lon, U.gps.lat]).addTo(map); el.addEventListener('click', e => { e.stopPropagation(); regps(); }); } gpsMk.setLngLat([U.gps.lon, U.gps.lat]); }
  else if (gpsMk) { gpsMk.remove(); gpsMk = null; }
  if (U.dest) { if (!destMk) { const el = document.createElement('div'); el.className = 'dest-mk'; el.innerHTML = '<span>' + I.flag + '</span>'; destMk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([U.dest.lon, U.dest.lat]).addTo(map); } destMk.setLngLat([U.dest.lon, U.dest.lat]); }
  else if (destMk) { destMk.remove(); destMk = null; }
  map.getSource('stops').setData(stopsGeo());
  const sig = U.near.map(g => g.key).sort().join(); if (sig !== linesSig) { linesSig = sig; map.getSource('lines').setData(linesGeo()); }
  const focus = [], walk = [], marks = []; let selI = -1, dim = null;
  const places = U.mapPlaces;
  const placeOf = sid => places.findIndex(p => p.quays.some(q => q.sid === sid));
  if (U.stop) selI = places.findIndex(p => p.k2 === U.stop.k2);
  if (U.stop && U.stop.walk?.path && U.origin) walk.push(U.stop.walk.path);
  if (!U.stop && !U.dest && U.sel) {
    const g = U.near.find(g => g.key === U.sel);
    if (g) { const L = S.data[g.short], M = L.main[g.dir] || L.main[0]; dim = g.key; focus.push({ c: M.shape.map(ll), color: S.meta[g.short].color }); walk.push(g.walk.path || [[U.origin.lat, U.origin.lon], [g.s.lat, g.s.lon]]); selI = placeOf(g.sid); }
  }
  if (!U.stop && U.dest && U.plan?.opts[U.opt]) {
    const op = U.plan.opts[U.opt], P = op.P, d0 = P.dist[op.a.k], d1 = P.dist[op.b.k], color = S.meta[op.short].color; dim = '-';
    focus.push({ c: [posAt(P, d0).ll, ...P.shape.filter(p => p[2] > d0 && p[2] < d1), posAt(P, d1).ll].map(ll), color });
    walk.push(op.walkA.path || [[U.origin.lat, U.origin.lon], [op.a.s.lat, op.a.s.lon]]);
    if (op.b.d > 0) walk.push(op.walkB.path || [[op.b.s.lat, op.b.s.lon], [U.dest.lat, U.dest.lon]]);
    marks.push({ p: op.a.s, label: 'Monte ici', color }, { p: op.b.s, label: 'Descends ici', color });
  }
  map.getSource('focus').setData({ type: 'FeatureCollection', features: focus.map(f => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: f.c }, properties: { color: f.color } })) });
  map.getSource('walk').setData({ type: 'FeatureCollection', features: walk.map(w => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: w.map(ll) }, properties: {} })) });
  map.getSource('marks').setData({ type: 'FeatureCollection', features: marks.map(m => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [m.p.lon, m.p.lat] }, properties: { label: m.label, color: m.color } })) });
  map.setFilter('stops-sel', ['==', ['get', 'i'], selI]);
  const flt = U.filter.size ? [...U.filter] : U.mfilter ? [...new Set(U.near.map(g => g.short))].filter(k => modeOf(k) === U.mfilter) : null;
  if (!dim && flt) { map.setPaintProperty('lines', 'line-opacity', ['case', ['in', ['get', 'short'], ['literal', flt]], .95, .12]); map.setPaintProperty('lines-case', 'line-opacity', .35); }
  else { map.setPaintProperty('lines', 'line-opacity', dim ? (dim === '-' ? .15 : ['case', ['==', ['get', 'key'], dim], .95, .15]) : .55); map.setPaintProperty('lines-case', 'line-opacity', dim ? .35 : (U.sat ? .5 : .9)); }
  U.focusLines = !U.stop && U.dest && U.plan?.opts[U.opt] ? new Set([U.plan.opts[U.opt].short + '|' + U.plan.opts[U.opt].dir]) : !U.stop && U.sel ? new Set([U.sel]) : (!U.stop && flt ? new Set(flt.flatMap(s => [s + '|0', s + '|1'])) : null);
}
/* ----- le rond suit le centre de la carte : déplacer la carte = nouvel endroit ----- */
let pinT = null, pinLast = 0;
function schedulePin(final) {
  const map = U.map; if (!map) return;
  const c = map.getCenter(); U.pinPend = { lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6) };
  clearTimeout(pinT);
  if (final) return applyPin(true);
  if (performance.now() - pinLast > 700) applyPin(false); else pinT = setTimeout(() => applyPin(false), 300);
}
function applyPin(final) {
  const pend = U.pinPend; if (!pend || !U.dataReady) return;
  if (final) U.pinPend = null; pinLast = performance.now();
  const { lat, lon } = pend;
  if (U.origin && haversine([lat, lon], [U.origin.lat, U.origin.lon]) < 8) { if (final && U.origin.src === 'pin' && U.origin.label === 'Point choisi') reverseLabel(U.origin); if (final) { computeNear(false); render(); syncMap(); schedulePoll(); } return; }
  let o;
  if (U.gps && haversine([lat, lon], [U.gps.lat, U.gps.lon]) < 25) o = { ...U.gps, src: 'gps' };
  else if (U.origin && U.origin.src === 'addr' && haversine([lat, lon], [U.origin.lat, U.origin.lon]) < 15) o = { ...U.origin, lat, lon };
  else { const last = mbGet('onde-addr'); o = last && haversine([lat, lon], [last.lat, last.lon]) < 20 ? { ...last, src: 'addr' } : { lat, lon, label: 'Point choisi', src: 'pin' }; }
  setOrigin(o, false, !final);
  if (final && o.src === 'pin') reverseLabel(o);
}
function regps(fly = true) { if (!U.gps) return locate(true); U.followGps = true; const o = { ...U.gps }; setOrigin(o, fly); reverseLabel(o); }
async function applyStyle() { if (!U.map) return; let s; try { s = await styleFor(); } catch (e) { return toast('Fond de carte indisponible'); } U.styleReady = false; U.map.setStyle(s, { diff: false }); }

/* ----- véhicules en circulation (positions interpolées ; temps réel quand disponible) ----- */
const busMk = new Map();
function busIconEl(k, v) {
  const meta = S.meta[k], el = document.createElement('div'); el.className = 'bus-wrap m-' + meta.mode;
  el.innerHTML = `<div class="bus-mk ${v.rt ? 'rt' : 'th'}" style="--c:${meta.color};--t:${meta.textColor}"><span class="ring"></span><span class="ring r2"></span><span class="head"></span><span class="core">${esc(lbl(k))}</span></div>`;
  el.title = `${modeName(k)} ${lbl(k)} → ${v.headsign}${v.rt ? ' (temps réel)' : ' (position estimée sur les horaires)'}`;
  return el;
}
function busLoop() {
  let last = 0;
  const tick = t => {
    requestAnimationFrame(tick);
    if (t - last < 250 || document.hidden || !U.map || !U.dataReady || !U.styleReady) return; last = t;
    const map = U.map, now = Date.now(), b = map.getBounds(), z = map.getZoom(), seen = new Set(), c = map.getCenter();
    const padLon = (b.getEast() - b.getWest()) * .1, padLat = (b.getNorth() - b.getSouth()) * .1, cand = [];
    if (z >= 12.5) for (const k of new Set(U.near.map(g => g.short))) {
      if (!S.data[k]) continue;
      for (const { v, st } of running(k, now)) {
        const key = k + '|' + v.p.dir; if (U.focusLines && !U.focusLines.has(key) && (U.dest || U.filter.size || U.mfilter)) continue;
        const pos = posAt(v.p, st.dist), lon = pos.ll[1], lat = pos.ll[0];
        if (lon < b.getWest() - padLon || lon > b.getEast() + padLon || lat < b.getSouth() - padLat || lat > b.getNorth() + padLat) continue;
        cand.push({ k, v, pos, key, d: Math.abs(lat - c.lat) + Math.abs(lon - c.lng) });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    for (const { k, v, pos, key } of cand.slice(0, 70)) {
      const id = k + v.id; seen.add(id); let m = busMk.get(id); const lat = pos.ll[0], lon = pos.ll[1];
      if (!m) { const el = busIconEl(k, v); m = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map); busMk.set(id, m); m._head = el.querySelector('.head'); }
      else m.setLngLat([lon, lat]);
      const other = !!(U.focusLines && !U.focusLines.has(key)); if (m._other !== other) { m.getElement().classList.toggle('other', other); m._other = other; }
      if (m._head) m._head.style.transform = `rotate(${pos.brg.toFixed(0)}deg)`;
    }
    for (const [id, m] of busMk) if (!seen.has(id)) { m.remove(); busMk.delete(id); }
  };
  requestAnimationFrame(tick);
}

/* ================= boutons carte ================= */
$('#btnMe').onclick = () => { if (U.gps) return regps(true); const addr = mbGet('onde-addr'); if (addr) { U.followGps = false; return setOrigin({ ...addr, src: 'addr' }, true); } locate(true); };
function syncMenuLabels() { const tl = $('#themeLbl'), sl = $('#satLbl'); if (tl) tl.textContent = isDark() ? 'Mode clair' : 'Mode sombre'; if (sl) sl.textContent = U.sat ? 'Vue plan' : 'Vue satellite'; $('#btnSat')?.setAttribute('aria-pressed', U.sat); }
$('#btnSat').onclick = () => { U.sat = !U.sat; localStorage.setItem('onde-sat', U.sat ? '1' : '0'); syncMenuLabels(); applyStyle(); };
syncMenuLabels();
$('#btnTheme').onclick = () => {
  const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('onde-theme', t);
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0e1117' : '#f4f5f8'; syncMenuLabels();
  if (!U.sat) applyStyle(); else { U.styleReady = false; U.map && U.map.setStyle(U.styles.sat, { diff: false }); }
};
const btnMore = $('#btnMore'), moreMenu = $('#moreMenu');
function closeMenu() { if (!moreMenu.hidden) { moreMenu.hidden = true; btnMore.setAttribute('aria-expanded', 'false'); } }
btnMore.onclick = e => { e.stopPropagation(); const open = moreMenu.hidden; moreMenu.hidden = !open; btnMore.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) syncMenuLabels(); };
document.addEventListener('click', e => { if (!e.target.closest('.map-menu')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

/* ================= feuille mobile (peek / half / full) ================= */
function isDesk() { return matchMedia('(min-width: 900px)').matches; }
function sheetHeights() { const H = innerHeight, chrome = $('#chrome'), grip = $('#sheetGrip'); const ch = (chrome?.offsetHeight || 150) + (grip?.offsetHeight || 22); return { peek: Math.min(Math.max(ch + 52, 168), Math.round(H * 0.36)), half: Math.round(H * 0.52), full: Math.round(H * 0.9) }; }
function currentSheetH() { if (isDesk()) return 0; const el = $('#sheet'); return el ? el.getBoundingClientRect().height : sheetHeights()[U.sheet || 'half']; }
function applyMapPad(h, animate) { if (!U.map) return; U.camLock = true; U.map.setPadding({ top: 0, right: 0, bottom: h || 0, left: 0 }, { duration: animate ? 280 : 0 }); clearTimeout(applyMapPad._t); applyMapPad._t = setTimeout(() => { U.camLock = false; }, animate ? 320 : 30); }
function setSheet(snap, animate = true) {
  const sheet = $('#sheet'); if (!sheet) return;
  if (isDesk()) { sheet.style.height = ''; sheet.dataset.snap = 'desk'; document.documentElement.style.setProperty('--sheet-h', '0px'); applyMapPad(0, animate); return; }
  U.sheet = snap; const h = sheetHeights()[snap]; sheet.dataset.snap = snap;
  sheet.style.transition = animate ? 'height .34s cubic-bezier(.2,.8,.2,1)' : 'none'; sheet.style.height = h + 'px';
  document.documentElement.style.setProperty('--sheet-h', h + 'px'); applyMapPad(h, animate);
}
function initSheet() {
  const sheet = $('#sheet'), handle = $('#sheetGrip'), chrome = $('#chrome');
  let dragging = false, startY = 0, startH = 0;
  const yOf = e => (e.touches ? e.touches[0].clientY : e.clientY);
  const ignore = e => e.target.closest('input, textarea, .search-x, .filters, .results, a, .btn, .back, .fchip, .where, .search-in');
  const onStart = e => { if (isDesk() || ignore(e)) return; dragging = true; startY = yOf(e); startH = sheet.getBoundingClientRect().height; sheet.style.transition = 'none'; sheet.classList.add('dragging'); if (e.pointerId != null && handle.setPointerCapture) try { handle.setPointerCapture(e.pointerId); } catch (err) { } };
  const onMove = e => { if (!dragging) return; const next = Math.max(sheetHeights().peek, Math.min(sheetHeights().full, startH + (startY - yOf(e)))); sheet.style.height = next + 'px'; document.documentElement.style.setProperty('--sheet-h', next + 'px'); if (e.cancelable) e.preventDefault(); };
  const onEnd = () => { if (!dragging) return; dragging = false; sheet.classList.remove('dragging'); const h = sheet.getBoundingClientRect().height, s = sheetHeights(); const nearest = [['peek', s.peek], ['half', s.half], ['full', s.full]].reduce((a, b) => Math.abs(h - a[1]) <= Math.abs(h - b[1]) ? a : b)[0]; setSheet(nearest, true); };
  handle.addEventListener('pointerdown', onStart); chrome.addEventListener('pointerdown', onStart);
  window.addEventListener('pointermove', onMove, { passive: false }); window.addEventListener('pointerup', onEnd); window.addEventListener('pointercancel', onEnd);
  $('#panel').addEventListener('scroll', () => { if (isDesk() || dragging) return; if (U.sheet === 'peek' && panel.scrollTop > 16) setSheet('half'); else if (U.sheet === 'half' && panel.scrollTop > 28) setSheet('full'); }, { passive: true });
  matchMedia('(min-width: 900px)').addEventListener('change', () => setSheet(isDesk() ? 'desk' : (U.sheet === 'desk' ? 'half' : U.sheet), false));
  window.addEventListener('resize', () => { if (!isDesk()) setSheet(U.sheet || 'half', false); });
  setSheet(isDesk() ? 'desk' : (U.sheet || 'half'), false);
}

/* ================= démarrage ================= */
// #at=lat,lon : ouvrir directement un endroit (liens partagés, démos) ; #?to=… : destination.
async function boot() {
  const h = location.hash; const to = /[?&]to=([^&]+)/.exec(h); const at = /at=(-?[\d.]+),(-?[\d.]+)/.exec(h);
  if (h) history.replaceState(null, '', location.pathname);
  const lp = mbGet('onde-lastpos');
  if (at) { U.origin = { lat: +at[1], lon: +at[2], label: 'Point choisi', src: 'pin' }; U.followGps = false; U.geo = 'ok'; }
  else if (lp && Date.now() - lp.t < 6 * 3600e3 && 'geolocation' in navigator) { U.origin = { lat: lp.lat, lon: lp.lon, label: 'Ma position', src: 'gps', stale: true }; U.followGps = true; }
  else { U.origin = { ...HOME }; U.followGps = true; }
  if (!at) locate();
  if (window.maplibregl) initMap();
  try { await loadIndex(); await ensureArea(U.origin); }
  catch (e) { panel.innerHTML = '<div class="empty"><b>Impossible de charger les horaires</b><p>Vérifie ta connexion, puis réessaie.</p><button type="button" class="btn" data-act="reload">Réessayer</button></div>'; return; }
  const g = N.index.networks.map(n => n.generated).sort()[0] || '';
  $('#footData').textContent = N.index.networks.map(n => n.name).join(' · ') + (g ? ' — horaires du ' + g.slice(0, 10).split('-').reverse().join('/') : '');
  U.dataReady = true;
  fetch('/api/status').then(r => r.json()).then(s => { S.status = s; }).catch(() => { });
  if (U.origin) setOrigin(U.origin, false); else render();
  if (U.pinPend) applyPin(true);
  addOverlays();
  if (at) { reverseLabel(U.origin); setTimeout(() => flyTo(U.origin, { duration: 0 }), 200); }
  if (to) { const q = decodeURIComponent(to[1]); qIn.value = q; let n = 0; const go = () => U.origin && (U.near.length || n > 12) ? qSearch.run(q).then(hs => hs[0] && qSearch.pick(hs[0])) : (n++, setTimeout(go, 600)); go(); }
  setInterval(() => { if (!document.hidden) render(); }, 5000);
  setInterval(() => { if (U.dest && U.plan && !U.plan.loading) { reorder(); render(); syncMap(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && U.dataReady) { render(); schedulePoll(); } });
}
initSheet();
boot();
