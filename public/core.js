/* Prochain — moteur partagé (horaires GTFS, temps réel PRIM en cache, positions, « fin », marche, verdict, itinéraire).
   Utilisé par la page principale (onde.js) et par les pages lignes (lignes.html). Aucun accès DOM au chargement. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM18 11H6V6h12v5z"/></svg>';
const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" stroke-linejoin="round"/></svg>';
const BACK_SVG = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SWAP_SVG = '<svg viewBox="0 0 24 24"><path d="M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH_SVG = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/></svg>';
const TARGET_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round"/></svg>';

/* ---------------- Heure de Paris ---------------- */
const PF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function parisParts(ms = Date.now()) { const o = {}; for (const p of PF.formatToParts(new Date(ms))) o[p.type] = p.value; return { ymd: o.year + o.month + o.day, h: (+o.hour) % 24, m: +o.minute, s: +o.second }; }
const midCache = {};
function midnight(ymd) { // instant (ms) = « midi moins 12 h » à Paris (référence GTFS)
  if (midCache[ymd]) return midCache[ymd];
  const y = +ymd.slice(0, 4), mo = +ymd.slice(4, 6) - 1, d = +ymd.slice(6, 8);
  const noon = Date.UTC(y, mo, d, 12); const off = (parisParts(noon).h - 12) * 3600e3;
  return (midCache[ymd] = noon - off - 12 * 3600e3);
}
function addDays(ymd, n) { const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + n)); return d.toISOString().slice(0, 10).replace(/-/g, ''); }
const todayYmd = () => parisParts().ymd;
const pad = n => String(n).padStart(2, '0');
function fmtHM(ms) { const p = parisParts(ms); return pad(p.h) + ':' + pad(p.m); }
function fmtSecs(s) { return pad(Math.floor(s / 3600) % 24) + ':' + pad(Math.floor(s / 60) % 60); }
const DOW = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function ymdDate(ymd) { return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))); }
function dayLabel(ymd) { const t = todayYmd(); if (ymd === t) return "Aujourd'hui"; if (ymd === addDays(t, 1)) return 'Demain'; const d = ymdDate(ymd); return DOW[d.getUTCDay()] + ' ' + d.getUTCDate(); }
// Jour d'une heure par rapport à `now` : vide (même jour), « demain », ou « lun. 9 ». Jamais « demain » pour un autre jour.
function relDayShort(t, now) {
  const y = parisParts(t).ymd, n = parisParts(now).ymd;
  if (y === n) return '';
  if (y === addDays(n, 1)) return 'demain';
  const d = ymdDate(y);
  return DOW[d.getUTCDay()] + ' ' + d.getUTCDate();
}
// Marque devant une heure « puis » affichée en horloge, seulement si son jour diffère du départ mis en avant.
function followDayMark(t, anchor, now) {
  if (t - now < 60 * 60e3) return '';
  const lab = relDayShort(t, now);
  if (!lab) return '';
  if (anchor == null) return lab;
  return lab === relDayShort(anchor, now) ? '' : lab;
}
// Échec de chargement (tuile ou ligne) : on n'insiste pas en boucle ; « Réessayer » efface la mémoire.
function failMemo() {
  const until = new Map();
  return {
    block(key, now, wait = 20000) { until.set(key, now + wait); },
    cooling(key, now) { return (until.get(key) || 0) > now; },
    clear() { until.clear(); },
  };
}
function dayLong(ymd) { const d = ymdDate(ymd); return ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
function minsUntil(ms, now = Date.now()) { return Math.round((ms - now) / 60000); }
function whenHTML(ms, now, rt) {
  const m = Math.floor((ms - now) / 60000);
  if (ms - now < 60000) return `<span class="when ${rt ? 'rt' : ''} imm">${rt ? '<i class="dot-live"></i>' : ''}À l'arrêt</span>`;
  if (m < 60) return `<span class="when ${rt ? 'rt' : ''}">${rt ? '<i class="dot-live"></i>' : ''}${m}<small>min</small></span>`;
  return `<span class="when">${fmtHM(ms)}</span>`;
}
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------------- État ---------------- */
const S = {
  lines: [], meta: {}, data: {}, rt: {}, status: null, journeys: {}, journeysAt: {},
  favs: JSON.parse(localStorage.getItem('onde-favs') || '[]'),
  view: null, cleanup: [],
};
const saveFavs = () => localStorage.setItem('onde-favs', JSON.stringify(S.favs));
const isFav = name => S.favs.includes(name);
function toggleFav(name) { S.favs = isFav(name) ? S.favs.filter(f => f !== name) : [...S.favs, name]; saveFavs(); toast(isFav(name) ? '★ Arrêt ajouté aux favoris' : 'Arrêt retiré des favoris'); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200); }

// Clé de ligne : « 144 » (anciennes pages, /data/line-144.json) ou « reseau:id » (/data/n/<reseau>/l/<id>.json).
const linePath = k => k.includes(':') ? `/data/n/${k.split(':')[0]}/l/${k.slice(k.indexOf(':') + 1)}.json` : `/data/line-${k}.json`;
const linePending = {};
async function getLine(short) {
  if (S.data[short]) return S.data[short];
  if (linePending[short]) return linePending[short];
  return (linePending[short] = fetch(linePath(short)).then(r => { if (!r.ok) throw new Error('ligne ' + short + ' : ' + r.status); return r.json(); }).then(L => prepLine(short, L)).finally(() => { delete linePending[short]; }));
}
function prepLine(short, L) {
  L.short = short;
  L.patterns.forEach((p, i) => { p.idx = i; p.stopIndex = new Map(); p.stops.forEach((s, k) => { if (!p.stopIndex.has(s)) p.stopIndex.set(s, k); }); p.trips = []; });
  L.tripObjs = L.trips.map(([svc, pi, t0, dl0, tid]) => { const dl = typeof dl0 === 'number' ? L.deltas[dl0] : dl0; const times = [t0]; let t = t0; for (const d of dl) times.push(t += d); const o = { svc, p: L.patterns[pi], times, tid }; L.patterns[pi].trips.push(o); return o; });
  L.main = [0, 1].map(d => L.patterns.filter(p => p.dir === d).sort((a, b) => b.n - a.n)[0]);
  if (!L.main[0]) L.main[0] = L.main[1]; if (!L.main[1]) L.main[1] = L.main[0];
  // sens desservis à chaque quai (hors terminus d'arrivée) : sert à classer un passage temps réel
  L.dirsAt = new Map(); for (const p of L.patterns) p.stops.forEach((s, k) => { if (k === p.stops.length - 1) return; let a = L.dirsAt.get(s); if (!a) L.dirsAt.set(s, a = new Set()); a.add(p.dir); });
  L._svc = {};
  L.activeSvc = ymd => L._svc[ymd] ||= new Set(Object.entries(L.services).filter(([, ds]) => ds.includes(ymd)).map(([s]) => s));
  for (const [id, s] of Object.entries(L.stops)) { s.id = id; s.key = norm(s.name); }
  return (S.data[short] = L);
}

/* ---------------- Calcul des positions ---------------- */
function bearing(a, b) { const y = (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), x = b[0] - a[0]; return Math.atan2(y, x) * 180 / Math.PI; }
function posAt(p, dist) {
  const sh = p.shape; if (dist <= 0) return { ll: [sh[0][0], sh[0][1]], brg: bearing(sh[0], sh[1]) };
  let lo = 0, hi = sh.length - 1; if (dist >= sh[hi][2]) return { ll: [sh[hi][0], sh[hi][1]], brg: bearing(sh[hi - 1], sh[hi]) };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sh[m][2] <= dist) lo = m; else hi = m; }
  const a = sh[lo], b = sh[hi], f = (dist - a[2]) / ((b[2] - a[2]) || 1);
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], brg: bearing(a, b) };
}
// Position d'une course à l'instant `now` : interpolation linéaire entre deux arrêts consécutifs.
function stateAt(v, now) {
  const t = v.tms, n = t.length;
  if (now < t[0]) return (t[0] - now <= 120e3) ? { i: 0, f: 0, dist: v.p.dist[0], waiting: true } : null;
  if (now > t[n - 1] + 20e3) return null;
  if (now >= t[n - 1]) return { i: n - 2, f: 1, dist: v.p.dist[n - 1], arrived: true };
  let i = 0; while (i < n - 2 && t[i + 1] <= now) i++;
  const seg = t[i + 1] - t[i]; const f = seg > 0 ? Math.min(1, Math.max(0, (now - t[i]) / seg)) : 1;
  return { i, f, dist: v.p.dist[i] + (v.p.dist[i + 1] - v.p.dist[i]) * f };
}
function theoJourneys(L, now, slack = 60e3) { // slack : courses terminées (à l'horaire) depuis moins de `slack` gardées (retards temps réel)
  const out = []; const td = parisParts(now).ymd;
  for (const day of [addDays(td, -1), td, addDays(td, 1)]) {
    const mid = midnight(day), svcs = L.activeSvc(day);
    for (const t of L.tripObjs) {
      if (!svcs.has(t.svc)) continue;
      const end = mid + t.times[t.times.length - 1] * 1000; if (end < now - slack || mid + t.times[0] * 1000 > now + 26 * 3600e3) continue;
      out.push({ id: 'T' + t.tid + day, p: t.p, tms: t.times.map(x => mid + x * 1000), rt: false, trip: t, day, headsign: t.p.headsign, delay: 0 });
    }
  }
  return out;
}
// Temps réel PRIM (réseau La Défense – Saint-Cloud) : le flux « requête ligne » regroupe les prévisions
// par rang de passage, pas par véhicule (une « course » PRIM mélange plusieurs bus). On traite donc chaque
// prévision comme « un bus arrivera à l'arrêt k à l'heure e », on en déduit sa position via les temps de
// parcours théoriques, on regroupe les prévisions qui désignent le même bus, puis on rattache chaque bus
// à une course GTFS (retard).
function runProfile(L, p, now) {
  const td = todayYmd(); const mid = midnight(td); const svcs = L.activeSvc(td); const s = (now - mid) / 1000;
  let trips = p.trips.filter(t => svcs.has(t.svc) && t.times[0] > s - 5400 && t.times[0] < s + 1800);
  if (trips.length < 2) trips = p.trips;
  return p.stops.map((_, k) => { const a = trips.map(t => t.times[k] - t.times[0]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)] * 1000; });
}
function rtPredictions(L, rt) {
  // prévisions brutes par quai : stop -> [{e, dest}]
  if (rt._preds) return rt._preds;
  const m = new Map();
  for (const j of rt.journeys) for (const c of j.calls) {
    const e = Date.parse(c.ed || c.ea || c.ad || c.aa); if (isNaN(e)) continue;
    if (!m.has(c.stop)) m.set(c.stop, []);
    m.get(c.stop).push({ e, dest: j.destRef, destName: j.dest, prox: c.prox, cancelled: /cancel/i.test(c.st || '') });
  }
  for (const a of m.values()) a.sort((x, y) => x.e - y.e);
  return (rt._preds = m);
}
function rtJourneys(L, rt) {
  const ref = Date.parse(rt.fetchedAt) || Date.now(); const preds = rtPredictions(L, rt); const out = [];
  const td = todayYmd(); const days = [addDays(td, -1), td, addDays(td, 1)];
  let matched = 0, total = 0;
  for (const dir of [0, 1]) {
    // parcours de référence : celui qui a le plus de courses autour de maintenant (les variantes du soir diffèrent)
    const svT = L.activeSvc(td), midT = midnight(td), sNow = (ref - midT) / 1000; const cnt = new Map();
    for (const t of L.tripObjs) if (t.p.dir === dir && svT.has(t.svc) && t.times[0] < sNow + 1800 && t.times[t.times.length - 1] > sNow - 1800) cnt.set(t.p, (cnt.get(t.p) || 0) + 1);
    const P = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0].n - a[0].n)[0]?.[0] || L.main[dir]; if (!P) continue; const R = runProfile(L, P, ref);
    const lastStops = new Set(L.patterns.filter(p => p.dir === dir).map(p => p.stops[p.stops.length - 1]));
    const obs = [];
    P.stops.forEach((sid, k) => {
      for (const pr of preds.get(sid) || []) {
        if (pr.cancelled || pr.e < ref - 30e3) continue;
        if (pr.dest && !lastStops.has(pr.dest) && L.patterns.some(p => p.dir !== dir && p.stops[p.stops.length - 1] === pr.dest)) continue; // autre sens
        obs.push({ k, e: pr.e, r: R[k] - (pr.e - ref), prox: pr.prox });
      }
    });
    obs.sort((a, b) => (a.e - ref) - (b.e - ref) || a.k - b.k);
    const buses = [];
    for (const o of obs) {
      if (o.r < -120e3) continue; // pas encore parti du terminus
      const tol = Math.max(150e3, 0.2 * (o.e - ref));
      let best = null, bd = Infinity;
      for (const b of buses) { const d = Math.abs(b.r - o.r); if (d < tol && d < bd && !b.pts.some(p => p.k === o.k)) { bd = d; best = b; } }
      if (best) { if (best.pts.every(p => (p.k < o.k) === (p.e < o.e))) best.pts.push(o); }
      else buses.push({ r: o.r, pts: [o] });
    }
    for (const b of buses) {
      const pts = b.pts.sort((a, c) => a.k - c.k); const n = P.stops.length; const tms = new Array(n);
      for (const p of pts) tms[p.k] = p.e;
      const f = pts[0], l = pts[pts.length - 1];
      for (let i = 0; i < f.k; i++) tms[i] = f.e - (R[f.k] - R[i]);
      for (let i = l.k + 1; i < n; i++) tms[i] = l.e + (R[i] - R[l.k]);
      for (let a = 0; a < pts.length - 1; a++) { const A = pts[a], B = pts[a + 1]; const span = (R[B.k] - R[A.k]) || 1; for (let i = A.k + 1; i < B.k; i++) tms[i] = A.e + (B.e - A.e) * (R[i] - R[A.k]) / span; }
      for (let i = 1; i < n; i++) if (tms[i] < tms[i - 1]) tms[i] = tms[i - 1];
      b.v = { id: `R${dir}-${f.k}-${Math.round(f.e / 1000)}`, p: P, tms, rt: true, delay: 0, headsign: P.headsign, known: pts.map(p => p.k), approach: pts.find(p => p.prox) ? L.stops[P.stops[pts.find(p => p.prox).k]].name : null };
    }
    // rattachement aux courses théoriques (glouton sur |retard|, retard positif favorisé)
    const opts = [];
    buses.forEach((b, bi) => {
      const f = b.pts[0];
      for (const day of days) { const mid = midnight(day), svcs = L.activeSvc(day);
        for (const t of L.tripObjs) { if (t.p.dir !== dir || !svcs.has(t.svc)) continue; const k = t.p.stopIndex.get(P.stops[f.k]); if (k == null) continue;
          const d = f.e - (mid + t.times[k] * 1000); if (d < -5 * 60e3 || d > 25 * 60e3) continue; opts.push({ bi, t, mid, day, d, cost: d >= 0 ? d : -2.5 * d }); } }
    });
    opts.sort((a, b) => a.cost - b.cost); const usedB = new Set(), usedT = new Set();
    for (const o of opts) { const key = o.t.tid + o.mid; if (usedB.has(o.bi) || usedT.has(key)) continue; usedB.add(o.bi); usedT.add(key);
      const v = buses[o.bi].v; v.trip = o.t; v.day = o.day; v.delay = o.d; v.headsign = o.t.p.headsign;
      v.aimed = P.stops.map((sid, k) => { const j = o.t.p.stopIndex.get(sid); return j != null ? o.mid + o.t.times[j] * 1000 : v.tms[k] - o.d; }); }
    total += buses.length; matched += usedB.size;
    out.push(...buses.map(b => b.v));
  }
  S.rtStats ||= {}; S.rtStats[L.short] = { predictions: [...preds.values()].reduce((a, x) => a + x.length, 0), buses: total, matched };
  return out;
}
function isLive(short) { const r = S.rt[short]; return !!(r && r.mode === 'temps-reel' && (r.kind === 'trips' ? r.byTrip?.size : r.journeys?.length)); }
function journeys(short, force) {
  const L = S.data[short]; if (!L) return [];
  const now = Date.now();
  if (!force && S.journeys[short] && now - S.journeysAt[short] < 15000) return S.journeys[short];
  const R = S.rt[short];
  let js = R && R.kind === 'trips' && R.byTrip ? tripRtJourneys(L, R, now) : isLive(short) ? rtJourneys(L, R) : theoJourneys(L, now);
  S.journeysAt[short] = now; return (S.journeys[short] = js);
}
// GTFS-RT (TripUpdates) : chaque course connue reçoit ses heures estimées (retard propagé d'arrêt en arrêt).
// R.byTrip : clé course (|jour) -> [[stop_id, heure_epoch_s, retard_s|null], …]
function tripRtJourneys(L, R, now) {
  const out = theoJourneys(L, now, 3 * 3600e3), keep = [];
  for (const v of out) {
    const e = R.byTrip.get(v.trip.tid + '|' + v.day) || (R.noDate ? R.byTrip.get(v.trip.tid) : null);
    if (!e) { if (v.tms[v.tms.length - 1] >= now - 60e3) keep.push(v); continue; }
    const u = e.u || e; if (e.cancelled) { v.cancelled = true; v.rt = true; keep.push(v); continue; }
    const P = v.p, n = P.stops.length, del = new Array(n).fill(null), exact = new Array(n).fill(false), skip = new Array(n).fill(false);
    let off0 = null, bad = false;
    for (const [sid, t, d, sk] of u) {
      const k = P.stopIndex.get(sid); if (k == null) continue;
      if (sk) { skip[k] = true; continue; }
      // l'heure absolue prime sur le retard ; contrôle de cohérence : un écart > 3 h ou un retard annoncé contredit = mauvaise course (n° de train réutilisé…)
      const dt = t ? t * 1000 - v.tms[k] : d * 1000;
      if (Math.abs(dt) > 3 * 3600e3 || (t && d != null && Math.abs(dt - d * 1000) > 20 * 60e3)) { bad = true; break; }
      del[k] = dt; exact[k] = !!t; if (off0 == null) off0 = dt;
    }
    if (bad || off0 == null) { if (v.tms[v.tms.length - 1] >= now - 60e3) keep.push(v); continue; }
    const first = del.findIndex(x => x != null), aimed = v.tms.slice(); let cur = del[first];
    for (let k = 0; k < n; k++) { if (del[k] != null) cur = del[k]; v.tms[k] = aimed[k] + (k < first ? del[first] : cur); }
    // heures interpolées gardées dans l'ordre ; les heures annoncées par le flux restent telles quelles
    for (let k = 1; k < n; k++) if (!exact[k] && v.tms[k] < v.tms[k - 1]) v.tms[k] = v.tms[k - 1];
    v.aimed = aimed; v.rt = true; v.delay = cur; v.skip = skip.some(Boolean) ? skip : null;
    if (v.tms[n - 1] >= now - 60e3) keep.push(v);
  }
  return keep;
}
function running(short, now = Date.now()) {
  const out = [];
  for (const v of journeys(short)) { if (v.cancelled) continue; const st = stateAt(v, now); if (st) out.push({ v, st }); }
  return out;
}
// Prochains départs à un quai (temps réel en priorité, complété par le théorique).
// Chaque départ porte la course GTFS rattachée (trip, k = rang de l'arrêt dans sa variante, day = journée de service)
// et `fin` = dernier passage de la soirée à ce quai dans ce sens (voir isFin).
function departures(short, stopId, now = Date.now(), n = 4) {
  const L = S.data[short]; const res = []; const rtMax = [0, 0]; const used = new Set(); const R = S.rt[short];
  if (R && R.kind === 'trips' && R.byTrip) { // GTFS-RT : heures estimées des courses connues, horaires prévus sinon
    for (const v of journeys(short)) {
      const k = v.p.stopIndex.get(stopId); if (k == null || k === v.p.stops.length - 1 || v.cancelled || v.skip?.[k]) continue;
      const t = v.tms[k]; if (t < now - 30e3) continue;
      res.push({ t, rt: v.rt, aim: v.aimed ? v.aimed[k] : null, delay: v.aimed ? t - v.aimed[k] : 0, headsign: v.headsign, dir: v.p.dir, trip: v.trip, k, day: v.day });
    }
    const out = res.sort((a, b) => a.t - b.t).slice(0, n); for (const d of out) d.fin = isFin(L, stopId, d); return out;
  }
  const raw = isLive(short) ? rtPredictions(L, R).get(stopId) : null;
  const dirOf = pr => { const ds = L.dirsAt?.get(stopId); if (ds && ds.size === 1) return [...ds][0]; const nn = pr.destName ? norm(pr.destName) : ''; const p = nn && L.patterns.find(p => (!ds || ds.has(p.dir)) && (norm(p.headsign).includes(nn) || nn.includes(norm(p.headsign)))); return p ? p.dir : (L.main[0].stopIndex.has(stopId) ? 0 : 1); };
  if (raw && raw.length) {
    const js = journeys(short);
    const here = L.stops[stopId], hereN = here ? norm(here.name) : '';
    for (const pr of raw) {
      if (pr.e < now - 30e3 || pr.cancelled) continue;
      // arrivée au terminus (ex. métro 11 « vers Châtelet » à Châtelet) : pas un départ que l'on peut prendre
      if (!L.dirsAt?.has(stopId) || (pr.dest && pr.dest === stopId)) continue;
      if (pr.destName && hereN && norm(pr.destName) === hereN) continue;
      // course théorique la plus proche pour ce passage (retard affiché, dédoublonnage)
      let bv = null, bd = Infinity; for (const v of js) { const k = v.p.stopIndex.get(stopId); if (k == null || !v.aimed) continue; const d = Math.abs(v.tms[k] - pr.e); if (d < bd && d < 120e3) { bd = d; bv = v; } }
      const k = bv ? bv.p.stopIndex.get(stopId) : null;
      if (bv?.trip) used.add(bv.trip.tid + bv.day);
      const pat = L.patterns.find(p => p.stops[p.stops.length - 1] === pr.dest);
      const tk = bv?.trip ? bv.trip.p.stopIndex.get(stopId) : null;
      const dir = pat && (!L.dirsAt?.get(stopId) || L.dirsAt.get(stopId).has(pat.dir)) ? pat.dir : dirOf(pr);
      res.push({ t: pr.e, rt: true, aim: bv ? bv.aimed[k] : null, delay: bv ? pr.e - bv.aimed[k] : 0, headsign: pat ? pat.headsign : (pr.destName || ''), dir, prox: pr.prox, trip: tk != null ? bv.trip : null, k: tk, day: tk != null ? bv.day : null });
      rtMax[dir] = Math.max(rtMax[dir], pr.e);
    }
  } else if (isLive(short) && R.kind !== 'stops') { // flux « ligne » complet ; un flux « arrêt » ne dit rien des autres arrêts
    for (const v of journeys(short)) {
      const k = v.p.stopIndex.get(stopId); if (k == null || k === v.p.stops.length - 1) continue;
      const t = v.tms[k]; if (t < now - 30e3) continue;
      if (v.trip) used.add(v.trip.tid + v.day);
      const tk = v.trip ? v.trip.p.stopIndex.get(stopId) : null;
      res.push({ t, rt: true, aim: v.aimed?.[k], delay: v.aimed ? t - v.aimed[k] : 0, headsign: v.headsign, cancelled: v.cancelled, dir: v.p.dir, trip: tk != null ? v.trip : null, k: tk, day: tk != null ? v.day : null });
      rtMax[v.p.dir] = Math.max(rtMax[v.p.dir], t);
    }
  }
  const td = parisParts(now).ymd;
  for (const day of [addDays(td, -1), td, addDays(td, 1)]) {
    const mid = midnight(day), svcs = L.activeSvc(day);
    for (const tr of L.tripObjs) {
      if (!svcs.has(tr.svc) || used.has(tr.tid + day)) continue;
      const k = tr.p.stopIndex.get(stopId); if (k == null || k === tr.p.stops.length - 1) continue;
      const t = mid + tr.times[k] * 1000; if (t < now - 30e3 || (rtMax[tr.p.dir] && t <= rtMax[tr.p.dir] + 60e3)) continue;
      res.push({ t, rt: false, headsign: tr.p.headsign, dir: tr.p.dir, trip: tr, k, day });
    }
  }
  const out = res.sort((a, b) => a.t - b.t).slice(0, n);
  for (const d of out) d.fin = isFin(L, stopId, d);
  return out;
}

/* ---------------- « fin » : dernier passage de la soirée ----------------
   Le GTFS IDFM range les courses d'après minuit (00:20, 00:50…) dans la journée calendaire SUIVANTE, et
   d'autres réseaux utilisent des heures > 24:00 : le « max de la journée de service » serait donc faux
   (23:53 au lieu de 00:50 sur le 144). On construit plutôt, pour chaque quai et chaque sens, la frise
   absolue des départs prévus (heures > 24 h comprises) sur plusieurs jours, et un départ est « fin »
   quand le suivant, au même quai et dans le même sens, n'arrive pas avant au moins 3 h (coupure de nuit).
   Restreint au soir/à la nuit (18 h–5 h) pour ne pas qualifier de « fin » une éventuelle coupure de journée. */
const FIN_GAP = 3 * 3600e3;
function depTimeline(Ld, day) { // quai|sens -> départs prévus (ms, triés) des journées day-1 … day+2
  Ld._tl ||= {}; if (Ld._tl[day]) return Ld._tl[day];
  const m = new Map();
  for (const dd of [addDays(day, -1), day, addDays(day, 1), addDays(day, 2)]) {
    const mid = midnight(dd), svcs = Ld.activeSvc(dd);
    for (const t of Ld.tripObjs) {
      if (!svcs.has(t.svc)) continue; const P = t.p;
      for (let k = 0; k < P.stops.length - 1; k++) { const key = P.stops[k] + '|' + P.dir; let a = m.get(key); if (!a) m.set(key, a = []); a.push(mid + t.times[k] * 1000); }
    }
  }
  for (const a of m.values()) a.sort((x, y) => x - y);
  const keys = Object.keys(Ld._tl); if (keys.length > 6) delete Ld._tl[keys[0]];
  return (Ld._tl[day] = m);
}
function gtfsLastDay(Ld) { return Ld._lastDay ||= Object.values(Ld.services).reduce((m, ds) => ds.length && ds[ds.length - 1] > m ? ds[ds.length - 1] : m, ''); }
// d : {t, aim?, trip?, k?, day?, dir}. Heure de référence = heure prévue de la course rattachée si connue.
function isFin(Ld, stopId, d) {
  let ref = d.trip && d.day ? midnight(d.day) + d.trip.times[d.k] * 1000 : (d.aim || d.t);
  const h = parisParts(ref).h; if (h >= 5 && h < 18) return false;
  const arr = depTimeline(Ld, parisParts(ref - 4 * 3600e3).ymd).get(stopId + '|' + d.dir); if (!arr || !arr.length) return false;
  if (!(d.trip && d.day)) { // passage temps réel non rattaché : on se cale sur le départ prévu le plus proche (±15 min)
    let best = null; for (const x of arr) if (Math.abs(x - ref) <= 15 * 60e3 && (best == null || Math.abs(x - ref) < Math.abs(best - ref))) best = x;
    if (best == null) return false; ref = best;
  }
  let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= ref) lo = mid + 1; else hi = mid; }
  const next = arr[lo];
  if (next == null) return addDays(parisParts(ref).ymd, 1) <= gtfsLastDay(Ld); // fin des données : on ne conclut que si le GTFS couvre le lendemain
  return next - ref >= FIN_GAP;
}
const FIN_TAG = '<em class="fin" title="Dernier passage de la soirée à cet arrêt, dans ce sens">fin</em>';
const finTag = d => d && d.fin ? FIN_TAG : '';
// Heure / minutes d'un départ, avec « fin » en dessous si c'est le dernier.
function whenFin(d, now) { const w = whenHTML(d.t, now, d.rt); return d.fin ? `<span class="tw">${w}${FIN_TAG}</span>` : w; }

async function pollRT(short) {
  try {
    const r = await fetch('/api/rt/' + short).then(r => r.json());
    const was = isLive(short); S.rt[short] = r; journeys(short, true);
  } catch (e) { /* hors ligne : on reste en théorique */ }
  updateLivePill(); window.dispatchEvent(new CustomEvent('onde-rt', { detail: short }));
}

/* ---------------- UI commune ---------------- */
function badge(meta, cls = '') { return `<span class="badge ${cls} m-${meta.mode || 'bus'}" style="--c:${meta.color};--t:${meta.textColor}">${esc(meta.label || meta.short)}</span>`; }
function setLineTheme(meta) {
  const r = document.documentElement.style;
  if (meta) { r.setProperty('--line', meta.color); r.setProperty('--line-ink', meta.textColor); }
  else { r.removeProperty('--line'); r.removeProperty('--line-ink'); }
}
function updateLivePill() {
  const pill = $('#livePill'), lab = $('#liveLabel'); if (!pill) return;
  const shorts = S.view?.short ? [S.view.short] : S.lines.map(l => l.short);
  const live = shorts.some(isLive); const demo = shorts.some(s => S.rt[s]?.demo);
  pill.classList.toggle('is-live', live); pill.classList.toggle('is-theo', !live);
  lab.textContent = live ? (demo ? 'Démo temps réel' : 'Temps réel') : 'Horaires théoriques';
  pill.title = live ? 'Positions estimées à partir des prochains passages temps réel (PRIM, IDFM)' : (S.status?.realtimeConfigured ? 'Temps réel momentanément indisponible : positions calculées sur les horaires prévus' : 'Aucune clé PRIM configurée : positions calculées sur les horaires prévus (GTFS IDFM)');
}
function tickClock() { const p = parisParts(); $('#clock').textContent = pad(p.h) + ':' + pad(p.m) + ':' + pad(p.s); }
function every(ms, fn) { fn(); const id = setInterval(fn, ms); S.cleanup.push(() => clearInterval(id)); }
function loop(fn) { let id, last = 0, on = true; const f = t => { if (!on) return; if (t - last > 33) { last = t; try { fn(); } catch (e) { console.error(e); } } id = requestAnimationFrame(f); }; id = requestAnimationFrame(f); const stop = () => { on = false; cancelAnimationFrame(id); }; S.cleanup.push(stop); return stop; }

/* ---------------- Marche & verdict (ex-monbus.js) ---------------- */
const HOME_SVG = '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" stroke-linejoin="round"/></svg>';
const GPS_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2l7.5 18.5-7.5-4-7.5 4z" transform="rotate(45 12 12)" stroke-linejoin="round"/></svg>';
const WALK_SVG = '<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2" fill="currentColor" stroke="none"/><path d="M10 21l2-6 3 3v3M9 12l1.5-4 3.5 1 2 3 2 1M10.5 8L7 10l-1 3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MB = {
  BUFFER: 60e3,        // on vise d'être à l'arrêt 1 min avant le bus
  HURRY: 0.75,         // en pressant le pas : ~25 % plus vite (≈ 6 km/h)
  SPEED: 4.8 / 3.6,    // repli : 4,8 km/h, distance à vol d'oiseau × 1,3
  walkCache: new Map(),
};
const mbGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const mbSet = (k, v) => v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
function haversine(a, b) { const R = 6371000, r = Math.PI / 180; const dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const fmtDur = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)}`; };
function fmtCount(ms) { if (ms <= 0) return 'maintenant'; const s = Math.round(ms / 1000); if (s < 60) return `${s} s`; const m = Math.floor(s / 60); return m < 60 ? `${m} min ${pad(s % 60)} s` : `${Math.floor(m / 60)} h ${pad(m % 60)}`; }

// Arrêts (quais) d'une ligne dans un sens, dans l'ordre du parcours principal, sans les terminus d'arrivée.
function lineDirStops(short, dir) {
  const Ld = S.data[short]; const M = Ld.main[dir]; if (!M) return []; const seen = new Set(); const out = [];
  const add = (p, k) => { const sid = p.stops[k]; if (seen.has(sid) || k === p.stops.length - 1) return; seen.add(sid); out.push({ sid, s: Ld.stops[sid], order: M.stopIndex.has(sid) ? M.stopIndex.get(sid) : (M.stopIndex.get(p.stops[k + 1]) ?? 99) - .5 }); };
  M.stops.forEach((_, k) => add(M, k));
  for (const p of Ld.patterns) if (p.dir === dir && p !== M && p.n >= 3) p.stops.forEach((_, k) => add(p, k));
  return out.sort((a, b) => a.order - b.order);
}
function nearestStops(origin, short, dir, n = 3) {
  return lineDirStops(short, dir).map(x => ({ ...x, d: haversine([origin.lat, origin.lon], [x.s.lat, x.s.lon]) })).sort((a, b) => a.d - b.d).slice(0, n);
}
function suggestAll(origin) {
  const out = [];
  for (const l of S.lines) for (const dir of [0, 1]) { const [b] = nearestStops(origin, l.short, dir, 1); if (b && b.d < 2000) out.push({ short: l.short, dir, ...b }); }
  return out.sort((a, b) => a.d - b.d);
}
async function walkRoute(origin, stop) {
  const key = `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}>${stop.lat},${stop.lon}`;
  if (MB.walkCache.has(key)) return MB.walkCache.get(key);
  let w;
  try {
    const r = await fetch(`/api/walk?from=${origin.lat},${origin.lon}&to=${stop.lat},${stop.lon}`); if (!r.ok) throw new Error(r.status);
    w = await r.json(); w.path.unshift([origin.lat, origin.lon]); w.path.push([stop.lat, stop.lon]);
    // OSRM foot compte ~4,5 km/h ; on garde sa durée (feux, traversées compris)
  } catch (e) {
    const d = haversine([origin.lat, origin.lon], [stop.lat, stop.lon]) * 1.3;
    w = { source: 'approx', distance: Math.round(d), duration: Math.round(d / MB.SPEED), path: [[origin.lat, origin.lon], [stop.lat, stop.lon]] };
  }
  MB.walkCache.set(key, w); return w;
}
// Verdict pour un passage à l'heure t (ms) avec une marche de walkSec secondes.
function verdict(t, walkSec, now) {
  const leaveBy = t - walkSec * 1000 - MB.BUFFER;
  const hurryBy = t - walkSec * 1000 * MB.HURRY;
  if (leaveBy - now >= 0) return { k: 'ok', leaveBy, left: leaveBy - now };
  if (hurryBy - now >= 0) return { k: 'tight', leaveBy: hurryBy, left: hurryBy - now };
  return { k: 'miss', leaveBy, left: leaveBy - now };
}

/* ---------------- Arrêts proches & itinéraire (ex-autour.js) ---------------- */
const PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.4"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24"><path d="M6 21V4M6 4h10.5l-2 4 2 4H6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>';
const NB = { R: 800, R_MAX: 1500, R_GO: 1000, places: null, quays: null };

/* ---------- index des arrêts ---------- */
// Quais desservis (ligne, sens) — hors terminus d'arrivée.
function nbQuays() {
  if (NB.quays) return NB.quays;
  const out = [];
  for (const l of S.lines) for (const dir of [0, 1]) for (const x of lineDirStops(l.short, dir)) out.push({ short: l.short, dir, sid: x.sid, s: x.s });
  return (NB.quays = out);
}
// « Lieux » : quais de même nom à moins de 250 m regroupés (un seul marqueur par arrêt sur la carte).
function nbPlaces() {
  if (NB.places) return NB.places;
  const out = [];
  for (const l of S.lines) { const Ld = S.data[l.short];
    for (const [sid, s] of Object.entries(Ld.stops)) {
      let p = out.find(p => p.key === s.key && haversine([p.lat, p.lon], [s.lat, s.lon]) < 250);
      if (!p) out.push(p = { key: s.key, name: s.name, lat: s.lat, lon: s.lon, lines: new Set(), quays: [] });
      p.lines.add(l.short); p.quays.push({ short: l.short, sid, s });
    }
  }
  for (const p of out) { p.group = nbGroup(p.name); p.lat = p.quays.reduce((a, q) => a + q.s.lat, 0) / p.quays.length; p.lon = p.quays.reduce((a, q) => a + q.s.lon, 0) / p.quays.length; p.lines = [...p.lines].sort(); }
  return (NB.places = out);
}
// « La Défense (Calder - Miro) » et « La Défense (voie Perronet Nord) » = même pôle « la defense ».
const nbBase = n => String(n).replace(/\s*\([^)]*\)\s*$/, '');
const nbGroup = n => norm(nbBase(n));
// Recherche combinée : arrêts des 4 lignes (instantané) + lieux OSM (Photon/Nominatim) et adresses BAN.
function nbPlaceCaption(h) {
  if (h.kind === 'stop') return 'Arrêt';
  const T = { housenumber: 'Adresse', street: 'Rue', municipality: 'Commune', locality: 'Lieu', shop: 'Commerce', school: 'École', food: 'Restaurant', station: 'Gare / station', park: 'Parc', landmark: 'Lieu', health: 'Santé', culture: 'Culture', civic: 'Service', place: 'Lieu' };
  const t = T[h.type] || 'Lieu';
  return t + (h.city && !String(h.label).includes(h.city) ? ' · ' + h.city : '');
}
function nbStopHits(q) {
  const v = norm(q); if (v.length < 2) return [];
  const w = v.split(' ');
  const m = nbPlaces().filter(p => w.every(x => p.key.includes(x))).sort((a, b) => a.key.indexOf(w[0]) - b.key.indexOf(w[0]) || a.name.localeCompare(b.name));
  const groups = new Map();
  for (const p of m) { const g = groups.get(p.group); if (g) g.push(p); else groups.set(p.group, [p]); }
  return [...groups.values()].slice(0, 4).map(ps => {
    const lines = [...new Set(ps.flatMap(p => p.lines))].sort();
    return { label: ps.length > 1 ? nbBase(ps[0].name) : ps[0].name, lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length, kind: 'stop', lines, group: ps[0].group, n: ps.length };
  });
}
function nbSearch(input, box, onPick) {
  let tmr, seq = 0, hits = [], sel = -1;
  if (box && !box.id) box.id = (input.id || 'cherche') + '-res';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  if (box.id) input.setAttribute('aria-controls', box.id);
  const syncAria = () => {
    const open = !!(box && box.innerHTML.trim());
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (sel >= 0 && hits[sel]) input.setAttribute('aria-activedescendant', box.id + '-opt-' + sel);
    else input.removeAttribute('aria-activedescendant');
    const cur = box.querySelector('.result.sel');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    box.innerHTML = hits.map((h, i) => `<button class="result ${i === sel ? 'sel' : ''}" id="${box.id}-opt-${i}" data-i="${i}" role="option" aria-selected="${i === sel}" type="button"><span class="nb-r-ic ${h.kind === 'stop' ? 'stop' : (h.type || '')}">${h.kind === 'stop' ? BUS_SVG : PIN_SVG}</span><span class="nb-r-t">${esc(h.label)}<small>${esc(nbPlaceCaption(h))}</small></span>${h.lines ? `<span class="rb">${h.lines.slice(0, 4).map(s => S.meta[s] ? badge(S.meta[s], 'sm') : '').join('')}${h.lines.length > 4 ? `<span class="more-n">+${h.lines.length - 4}</span>` : ''}</span>` : ''}</button>`).join('');
    syncAria();
  };
  const run = async q => {
    const my = ++seq; const stops = nbStopHits(q); hits = stops; sel = -1; render();
    if (q.length < 3) return hits;
    try {
      const near = (typeof U !== 'undefined' && U.origin) ? '&near=' + U.origin.lat + ',' + U.origin.lon : '';
      const r = await fetch('/api/geocode?q=' + encodeURIComponent(q) + near).then(r => r.json()); if (my !== seq) return hits;
      // On remonte les lieux de la commune tapée, puis ceux proches du réseau (les 4 lignes) et du point actuel.
      const nq = norm(q), pl = nbPlaces(), o = (typeof U !== 'undefined' && U.origin) ? [U.origin.lat, U.origin.lon] : null;
      const rank = a => (a.city && nq.includes(norm(a.city)) ? 0 : 2) + (pl.some(p => Math.abs(p.lat - a.lat) < .03 && haversine([p.lat, p.lon], [a.lat, a.lon]) < 2000) ? 0 : 1) + (o && haversine(o, [a.lat, a.lon]) < 4000 ? 0 : 0.5);
      const addr = (r.results || []).filter(a => !stops.some(s => haversine([s.lat, s.lon], [a.lat, a.lon]) < 60)).map((a, i) => ({ ...a, kind: a.kind || 'place', _r: rank(a) * 100 + i })).sort((a, b) => a._r - b._r);
      hits = [...stops.slice(0, addr.length ? 3 : 4), ...addr].slice(0, 8); render();
      if (!hits.length) { box.innerHTML = '<div class="result muted">Aucun lieu trouvé — essaie autrement.</div>'; syncAria(); }
    } catch (e) { if (!hits.length) { box.innerHTML = '<div class="result muted">Recherche indisponible — réessaie dans un instant.</div>'; syncAria(); } }
    return hits;
  };
  input.addEventListener('input', () => { clearTimeout(tmr); const q = input.value.trim(); if (!q) { hits = []; sel = -1; render(); return; } tmr = setTimeout(() => run(q), 280); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[Math.max(0, sel)]; if (h) pick(h); else run(input.value.trim()).then(hs => hs[0] && pick(hs[0])); }
    else if (e.key === 'Escape' && (hits.length || box.innerHTML.trim())) { hits = []; sel = -1; render(); e.stopPropagation(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) { box.innerHTML = ''; sel = -1; syncAria(); } }, 180));
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(hits[+b.dataset.i]); });
  const pick = h => { hits = []; render(); input.blur(); onPick({ label: h.label, lat: h.lat, lon: h.lon, kind: h.kind, city: h.city, group: h.group }); };
  return { run, pick };
}

/* ---------- calculs ---------- */
const nbMins = (t, now) => Math.floor((t - now) / 60000);
function nbWhen(d, now) { const m = nbMins(d.t, now); return d.t - now < 60e3 ? '<b>&lt;1</b><small>min</small>' : m < 60 ? `<b>${m}</b><small>min</small>` : `<b class="hm">${fmtHM(d.t)}</b>`; }
function nbVerdict(d, W, now) {
  const v = verdict(d.t, W, now);
  const txt = v.k === 'ok' ? (v.left < 60e3 ? "Tu l'as · pars maintenant" : `Tu l'as · pars avant ${fmtHM(v.leaveBy)}`) : v.k === 'tight' ? 'Juste · pars maintenant, vite' : 'Raté';
  return { ...v, txt, short: v.k === 'ok' ? "Tu l'as" : v.k === 'tight' ? 'Juste' : 'Raté' };
}
const srcTag = d => d.rt ? '<span class="tag rt"><i class="dot-live"></i>Live</span>' : '<span class="tag th">Prévu</span>';
// Profil de parcours médian d'une variante (secondes depuis le 1er arrêt).
function rideProfile(P) {
  if (P._rp) return P._rp;
  const tr = P.trips.length ? P.trips : [];
  return (P._rp = P.stops.map((_, k) => { const a = tr.map(t => t.times[k] - t.times[0]).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : k * 90; }));
}
// Itinéraire : pour chaque ligne et chaque sens, le meilleur couple (arrêt de montée près du départ, arrêt de descente près de l'arrivée).
function nbPlan(O, D) {
  const o = [O.lat, O.lon], dd = [D.lat, D.lon], walkS = m => m * 1.3 / MB.SPEED, best = new Map();
  for (const l of S.lines) { const Ld = S.data[l.short];
    for (const P of Ld.patterns) {
      if (P.n < 3) continue;
      const n = P.stops.length, A = [], B = [];
      for (let k = 0; k < n; k++) { const s = Ld.stops[P.stops[k]], p = [s.lat, s.lon]; const dO = haversine(o, p), dD = D.group && nbGroup(s.name) === D.group ? 0 : haversine(dd, p);
        if (k < n - 1 && dO <= NB.R_GO) A.push({ k, sid: P.stops[k], s, d: dO }); if (k > 0 && dD <= NB.R_GO) B.push({ k, sid: P.stops[k], s, d: dD }); }
      if (!A.length || !B.length) continue;
      const rp = rideProfile(P);
      for (const a of A) for (const b of B) {
        if (b.k <= a.k) continue;
        const ride = rp[b.k] - rp[a.k], cost = walkS(a.d) + ride + walkS(b.d) + 240; // + attente moyenne
        const key = l.short + '|' + P.dir, cur = best.get(key);
        if (!cur || cost < cur.cost - 30 || (Math.abs(cost - cur.cost) <= 30 && P.n > cur.P.n)) best.set(key, { short: l.short, dir: P.dir, P, a, b, ride, cost, walkA: { duration: walkS(a.d), distance: a.d * 1.3, source: 'approx' }, walkB: { duration: walkS(b.d), distance: b.d * 1.3, source: 'approx' } });
      }
    }
  }
  return [...best.values()].sort((x, y) => x.cost - y.cost);
}
// Prochains départs d'une option qui desservent bien l'arrêt de descente, avec temps de trajet GTFS de la course.
function nbOptDeps(op, now) {
  const Ld = S.data[op.short], rp = rideProfile(op.P), out = [];
  for (const d of departures(op.short, op.a.sid, now, 24)) {
    if (d.dir !== op.dir || d.t < now - 20e3) continue;
    let ride, stops, approx = false;
    if (d.trip) { const ja = d.k, jb = d.trip.p.stopIndex.get(op.b.sid); if (jb == null || jb <= ja) continue; ride = d.trip.times[jb] - d.trip.times[ja]; stops = jb - ja; }
    else { ride = rp[op.b.k] - rp[op.a.k]; stops = op.b.k - op.a.k; approx = true; }
    out.push({ ...d, ride, stops, approx, arr: d.t + ride * 1000 });
    if (out.length >= 6) break;
  }
  return out;
}
