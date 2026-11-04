/* Onde 92 — horaires & suivi en direct des bus 144 · 160 · 244 · 360 */
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

async function getLine(short) {
  if (S.data[short]) return S.data[short];
  const L = await fetch(`/data/line-${short}.json`).then(r => r.json());
  L.patterns.forEach((p, i) => { p.idx = i; p.stopIndex = new Map(); p.stops.forEach((s, k) => { if (!p.stopIndex.has(s)) p.stopIndex.set(s, k); }); p.trips = []; });
  L.tripObjs = L.trips.map(([svc, pi, t0, dl, tid]) => { const times = [t0]; let t = t0; for (const d of dl) times.push(t += d); const o = { svc, p: L.patterns[pi], times, tid }; L.patterns[pi].trips.push(o); return o; });
  L.main = [0, 1].map(d => L.patterns.filter(p => p.dir === d).sort((a, b) => b.n - a.n)[0]);
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
function theoJourneys(L, now) {
  const out = []; const td = parisParts(now).ymd;
  for (const day of [addDays(td, -1), td, addDays(td, 1)]) {
    const mid = midnight(day), svcs = L.activeSvc(day);
    for (const t of L.tripObjs) {
      if (!svcs.has(t.svc)) continue;
      const end = mid + t.times[t.times.length - 1] * 1000; if (end < now - 60e3 || mid + t.times[0] * 1000 > now + 26 * 3600e3) continue;
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
function isLive(short) { const r = S.rt[short]; return !!(r && r.mode === 'temps-reel' && r.journeys?.length); }
function journeys(short, force) {
  const L = S.data[short]; if (!L) return [];
  const now = Date.now();
  if (!force && S.journeys[short] && now - S.journeysAt[short] < 15000) return S.journeys[short];
  let js = isLive(short) ? rtJourneys(L, S.rt[short]) : theoJourneys(L, now);
  S.journeysAt[short] = now; return (S.journeys[short] = js);
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
  const L = S.data[short]; const res = []; let rtMax = 0; const used = new Set();
  const raw = isLive(short) ? rtPredictions(L, S.rt[short]).get(stopId) : null;
  if (raw && raw.length) {
    const js = journeys(short);
    for (const pr of raw) {
      if (pr.e < now - 30e3 || pr.cancelled) continue;
      // course théorique la plus proche pour ce passage (retard affiché, dédoublonnage)
      let bv = null, bd = Infinity; for (const v of js) { const k = v.p.stopIndex.get(stopId); if (k == null || !v.aimed) continue; const d = Math.abs(v.tms[k] - pr.e); if (d < bd && d < 120e3) { bd = d; bv = v; } }
      const k = bv ? bv.p.stopIndex.get(stopId) : null;
      if (bv?.trip) used.add(bv.trip.tid + bv.day);
      const pat = L.patterns.find(p => p.stops[p.stops.length - 1] === pr.dest);
      const tk = bv?.trip ? bv.trip.p.stopIndex.get(stopId) : null;
      res.push({ t: pr.e, rt: true, aim: bv ? bv.aimed[k] : null, delay: bv ? pr.e - bv.aimed[k] : 0, headsign: pat ? pat.headsign : (pr.destName || ''), dir: pat ? pat.dir : (L.main[0].stopIndex.has(stopId) ? 0 : 1), prox: pr.prox, trip: tk != null ? bv.trip : null, k: tk, day: tk != null ? bv.day : null });
      rtMax = Math.max(rtMax, pr.e);
    }
  } else if (isLive(short)) {
    for (const v of journeys(short)) {
      const k = v.p.stopIndex.get(stopId); if (k == null || k === v.p.stops.length - 1) continue;
      const t = v.tms[k]; if (t < now - 30e3) continue;
      if (v.trip) used.add(v.trip.tid + v.day);
      const tk = v.trip ? v.trip.p.stopIndex.get(stopId) : null;
      res.push({ t, rt: true, aim: v.aimed?.[k], delay: v.aimed ? t - v.aimed[k] : 0, headsign: v.headsign, cancelled: v.cancelled, dir: v.p.dir, trip: tk != null ? v.trip : null, k: tk, day: tk != null ? v.day : null });
      rtMax = Math.max(rtMax, t);
    }
  }
  const td = parisParts(now).ymd;
  for (const day of [addDays(td, -1), td, addDays(td, 1)]) {
    const mid = midnight(day), svcs = L.activeSvc(day);
    for (const tr of L.tripObjs) {
      if (!svcs.has(tr.svc) || used.has(tr.tid + day)) continue;
      const k = tr.p.stopIndex.get(stopId); if (k == null || k === tr.p.stops.length - 1) continue;
      const t = mid + tr.times[k] * 1000; if (t < now - 30e3 || (rtMax && t <= rtMax + 60e3)) continue;
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
function badge(meta, cls = '') { return `<span class="badge ${cls}" style="--c:${meta.color};--t:${meta.textColor}">${esc(meta.short)}</span>`; }
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

/* ---------------- Accueil ---------------- */
function stopIndexAll() {
  const idx = new Map();
  for (const l of S.lines) { const L = S.data[l.short]; for (const s of Object.values(L.stops)) { const e = idx.get(s.key) || { name: s.name, key: s.key, lines: new Set(), lat: s.lat, lon: s.lon }; e.lines.add(l.short); idx.set(s.key, e); } }
  return [...idx.values()];
}
function heroWave() {
  const W = 720, H = 240, paths = [];
  const cols = ['#3CF0B0', '#7BA8FF', '#D282BE', '#D2D200'];
  for (let k = 0; k < 4; k++) paths.push(`<path stroke="${cols[k]}" stroke-opacity="${0.75 - k * 0.14}" d=""/>`);
  return `<svg class="hero-wave" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${paths.join('')}</svg>`;
}
function animateWave(svg) {
  const ps = $$('path', svg); const W = 720, H = 240;
  loop(() => {
    const t = performance.now() / 1000;
    ps.forEach((p, k) => {
      let d = ''; for (let x = 0; x <= W; x += 12) { const env = Math.sin(Math.PI * x / W); const y = H / 2 + env * (34 + k * 10) * Math.sin(x / (46 + k * 9) - t * (1.4 + k * .35) + k) * Math.sin(t * .6 + k + x / 300); d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1); }
      p.setAttribute('d', d);
    });
  });
}
async function viewHome() {
  setLineTheme(null); S.view = { name: 'home' }; document.title = 'Onde 92 — Bus 144 · 160 · 244 · 360 en direct';
  const app = $('#app');
  app.innerHTML = `
  <section class="hero fade-in">
    ${heroWave()}
    <div class="eyebrow">Hauts-de-Seine · Réseau Île-de-France Mobilités</div>
    <h1>Vos bus, <span>en direct.</span></h1>
    <p>Horaires à la minute et position de chaque bus sur le tracé des lignes 144, 160, 244 et 360 — de Rueil à La Défense, de Nanterre à Boulogne.</p>
    <div class="search">${SEARCH_SVG}<input id="q" type="search" placeholder="Rechercher un arrêt…" autocomplete="off" aria-label="Rechercher un arrêt"><div class="results" id="results" role="listbox"></div></div>
  </section>
  <section class="card nb-cta fade-in">
    <div class="nb-cta-t"><span class="eyebrow">Autour de moi</span><h2>Les bus à deux pas, et <span>on va où&nbsp;?</span></h2><p>Les arrêts près de toi sur une carte, les prochains bus dans chaque direction et si tu as le temps de les attraper. Ou dis-nous où tu vas : on te dit quel bus prendre.</p></div>
    <div class="nb-cta-a">
      <a class="mb-btn nb-cta-near" href="#/autour"><svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.4"/></svg><span>Bus autour de moi</span></a>
      <form class="search nb-cta-go" id="goForm">${SEARCH_SVG}<input id="goQ" type="search" placeholder="On va où ? (ex. La Défense)" autocomplete="off" aria-label="On va où ?"><button class="nb-cta-sub" type="submit" aria-label="Chercher">→</button></form>
    </div>
  </section>
  <a class="card mb-cta fade-in" href="#/monbus">
    <div class="mb-cta-ic"><div class="mb-sonar sm"><i></i><i></i>${BUS_SVG}</div></div>
    <div class="mb-cta-t"><span class="eyebrow">Nouveau</span><h2>Est-ce que j'ai mon bus&nbsp;?</h2><p>Ton adresse, ta ligne : on calcule le trajet à pied jusqu'à l'arrêt et on te dit quand partir.</p></div>
    <div class="mb-cta-lines">${S.lines.map(l => `<span class="mb-cta-l" data-href="#/monbus?l=${l.short}">${badge(l)}</span>`).join('')}</div>
    <span class="mb-cta-go">C'est parti →</span>
  </a>
  <div class="section-h"><h2>Choisis ta ligne</h2><span class="muted" style="font-size:13px" id="homeSrc"></span></div>
  <div class="lines-grid" id="lines">${S.lines.map(() => '<div class="skeleton"></div>').join('')}</div>
  <div class="section-h"><h2>Arrêts favoris</h2></div>
  <div id="favs"></div>
  <div class="info-strip">
    <div class="card"><span class="tag rt"><i class="dot-live"></i>Temps réel</span><h4>Prochains passages IDFM</h4><p>Quand une clé PRIM est configurée, les heures d'arrivée estimées par le système d'aide à l'exploitation recalent chaque bus.</p></div>
    <div class="card"><span class="tag th">Théorique</span><h4>Horaires prévus GTFS</h4><p>Sans flux temps réel, la position est calculée à partir des horaires officiels publiés par Île-de-France Mobilités.</p></div>
    <div class="card"><span class="tag" style="background:var(--chip)">Précision</span><h4>À la seconde, arrêt par arrêt</h4><p>Chaque course est suivie entre deux arrêts consécutifs le long du tracé réel de la ligne.</p></div>
  </div>`;
  animateWave($('.hero-wave'));
  $('#goForm').onsubmit = e => { e.preventDefault(); const q = $('#goQ').value.trim(); location.hash = q ? '#/autour?to=' + encodeURIComponent(q) : '#/autour?v=go'; };
  $$('.mb-cta-l').forEach(b => b.addEventListener('click', e => { e.preventDefault(); location.hash = b.dataset.href; }));
  if (S.favs.length) { const fh = $$('.section-h')[1], fv = $('#favs'), lh = $$('.section-h')[0]; lh.before(fh); lh.before(fv); fh.style.marginTop = '10px'; }
  const idx = stopIndexAll(); const q = $('#q'), res = $('#results'); let sel = -1;
  const render = () => {
    const v = norm(q.value); if (!v) { res.innerHTML = ''; return; }
    const words = v.split(' ');
    const hits = idx.filter(e => words.every(w => e.key.includes(w))).sort((a, b) => a.key.indexOf(words[0]) - b.key.indexOf(words[0]) || a.name.localeCompare(b.name)).slice(0, 8);
    res.innerHTML = hits.length ? hits.map((e, i) => `<a class="result ${i === sel ? 'sel' : ''}" href="#/arret/${encodeURIComponent(e.key)}" role="option"><span>${esc(e.name)}</span><span class="rb">${[...e.lines].sort().map(s => badge(S.meta[s], 'sm')).join('')}</span></a>`).join('') : '<div class="result muted">Aucun arrêt trouvé</div>';
  };
  q.addEventListener('input', () => { sel = -1; render(); });
  q.addEventListener('keydown', e => { const n = $$('.result[href]', res).length; if (e.key === 'ArrowDown') { sel = Math.min(n - 1, sel + 1); render(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); } if (e.key === 'Enter') { const a = $$('.result[href]', res)[Math.max(0, sel)]; if (a) location.hash = a.getAttribute('href'); } if (e.key === 'Escape') { q.value = ''; render(); } });
  const linesEl = $('#lines');
  linesEl.innerHTML = S.lines.map(l => `
    <a class="card line-card fade-in" href="#/ligne/${l.short}" style="--c:${l.color}">
      <div class="lc-top">${badge(l, 'xl')}<span class="bus-pict">${BUS_SVG}</span></div>
      <div class="termini"><div>${esc(l.termini[1] || '')}</div><div class="arrow">⇅</div><div>${esc(l.termini[0] || '')}</div></div>
      <div class="mini-track" data-line="${l.short}"><div class="rail"></div></div>
      <div class="lc-foot"><span class="running" data-run="${l.short}"></span><span>${S.data[l.short].main[0].stops.length} arrêts</span></div>
    </a>`).join('');
  const favRender = () => {
    const el = $('#favs'); if (!el) return;
    if (!S.favs.length) { el.innerHTML = `<div class="empty">Aucun favori pour l'instant. Touchez l'étoile ☆ sur un arrêt pour retrouver ici ses prochains passages, en un coup d'œil.</div>`; return; }
    const now = Date.now();
    el.innerHTML = `<div class="fav-grid">${S.favs.map(key => {
      const rows = [];
      for (const l of S.lines) { const L = S.data[l.short]; for (const s of Object.values(L.stops)) if (s.key === key) for (const d of departures(l.short, s.id, now, 2)) rows.push({ ...d, l }); }
      rows.sort((a, b) => a.t - b.t);
      const name = idx.find(e => e.key === key)?.name || key;
      return `<a class="card fav-card" href="#/arret/${encodeURIComponent(key)}"><h3>${esc(name)}<span style="color:#FFD15C">★</span></h3>${rows.slice(0, 4).map(d => `<div class="dep">${badge(d.l, 'sm')}<span class="dest">→ ${esc(d.headsign)}</span>${whenFin(d, now)}</div>`).join('') || '<div class="muted">Pas de passage prévu</div>'}</a>`;
    }).join('')}</div>`;
  };
  favRender();
  const tracks = $$('.mini-track');
  every(1000, () => {
    const now = Date.now(); let anyLive = false;
    for (const tr of tracks) {
      const sh = tr.dataset.line; const L = S.data[sh]; const run = running(sh, now); anyLive ||= isLive(sh);
      const want = run.slice(0, 40);
      while (tr.children.length - 1 < want.length) tr.insertAdjacentHTML('beforeend', '<i class="mb"></i>');
      while (tr.children.length - 1 > want.length) tr.lastChild.remove();
      want.forEach(({ v, st }, i) => { const el = tr.children[i + 1]; const f = st.dist / v.p.length; el.style.left = ((v.p.dir === 0 ? f : 1 - f) * 100).toFixed(2) + '%'; el.style.top = v.p.dir === 0 ? '2px' : '10px'; el.style.opacity = v.p.dir === 0 ? 1 : .55; });
      $(`[data-run="${sh}"]`).innerHTML = `${isLive(sh) ? '<span class="tag rt"><i class="dot-live"></i>Live</span>' : '<span class="tag th">Théo.</span>'} ${run.length} bus en circulation`;
    }
    $('#homeSrc').textContent = anyLive ? 'Positions temps réel' : 'Positions calculées sur les horaires prévus';
  });
  every(20000, favRender);
  every(60000, () => S.lines.forEach(l => pollRT(l.short)));
}

/* ---------------- Vue ligne ---------------- */
let MAP = null;
// Fonds de carte : OpenStreetMap (sans clé, net jusqu'au zoom 19), adouci par un filtre CSS accordé au thème
// (gris clair épuré / sombre « nuit ») ; repli automatique sur Esri Canvas si les tuiles OSM échouent.
let TILE_FALLBACK = localStorage.getItem('onde-tiles2') === 'esri';
const isLight = () => document.documentElement.dataset.theme === 'light';
function tileUrl() {
  if (TILE_FALLBACK) return isLight() ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}' : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}
const tileAttr = () => TILE_FALLBACK ? 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap' : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// Couche de tuiles partagée par toutes les cartes (bascule thème + repli automatique).
function addTiles(map) {
  let layer = null, err = 0;
  const make = () => {
    if (layer) layer.remove();
    layer = L.tileLayer(tileUrl(), { maxZoom: 20, maxNativeZoom: TILE_FALLBACK ? 16 : 19, attribution: tileAttr(), updateWhenZooming: false, keepBuffer: 4, className: 'onde-tiles' + (TILE_FALLBACK ? ' esri' : ' osm') }).addTo(map);
    layer.on('tileerror', () => { if (!TILE_FALLBACK && ++err >= 4) { TILE_FALLBACK = true; localStorage.setItem('onde-tiles2', 'esri'); make(); } });
    layer.bringToBack();
  };
  make();
  return { refresh: make, get layer() { return layer; } };
}
// Options communes : carte fluide (zoom fractionnaire, inertie, molette douce, pincement).
const MAP_OPTS = { zoomControl: false, attributionControl: true, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 110, wheelDebounceTime: 30, inertia: true, inertiaDeceleration: 2600, easeLinearity: 0.2, tapTolerance: 18, bounceAtZoomLimits: false, minZoom: 10, maxZoom: 20 };
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function busIcon(meta, v, cls = '') {
  return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: `<div class="bus-mk ${v.rt ? 'rt' : 'th'} ${cls}" style="--c:${meta.color};--t:${meta.textColor}"><span class="ring"></span><span class="ring r2"></span><span class="head"></span><span class="core">${BUS_SVG}</span></div>` });
}
function delayText(v) { if (!v.rt) return 'Horaire théorique'; const m = Math.round(v.delay / 60000); return m >= 1 ? `Retard ~${m} min` : m <= -1 ? `En avance ~${-m} min` : "À l'heure"; }

async function viewLine(short, params) {
  const Ld = await getLine(short); const meta = S.meta[short];
  if (!meta) return viewHome();
  setLineTheme(meta);
  const st = { dir: +(params.get('d') || 0), stop: params.get('s'), tab: params.get('v') || 'live', ttDay: todayYmd(), ttStop: null, selBus: null };
  if (st.stop) { for (const d of [0, 1]) if (Ld.main[d].stopIndex.has(st.stop)) st.dir = d; }
  S.view = { name: 'line', short };
  document.title = `Bus ${short} — Onde 92`;
  const app = $('#app');
  const setUrl = () => { const p = new URLSearchParams(); if (st.dir) p.set('d', st.dir); if (st.stop) p.set('s', st.stop); if (st.tab !== 'live') p.set('v', st.tab); history.replaceState(null, '', `#/ligne/${short}${p.toString() ? '?' + p : ''}`); };
  app.innerHTML = `
  <div class="line-head fade-in">
    <a class="back" href="#/" aria-label="Retour">${BACK_SVG}</a>
    ${badge(meta, 'xl')}
    <div class="line-title"><h1 id="lt"></h1><div class="sub"><span id="ltSub"></span><span id="ltMode"></span></div></div>
    <div class="dir-toggle"><div><span class="to">Direction</span><strong id="dirName"></strong></div><button class="swap" id="swap" aria-label="Inverser la direction">${SWAP_SVG}</button></div>
  </div>
  <div class="seg tabs" role="tablist"><button data-tab="live" role="tab">Suivi en direct</button><button data-tab="tt" role="tab">Fiche horaire</button></div>
  <div id="tabBody"></div>`;
  const body = $('#tabBody');
  const header = () => {
    const M = Ld.main[st.dir];
    $('#lt').textContent = `${Ld.stops[M.stops[0]].name} → ${Ld.stops[M.stops[M.stops.length - 1]].name}`;
    $('#dirName').textContent = M.headsign;
    $('#ltSub').textContent = `${M.stops.length} arrêts · ${(M.length / 1000).toFixed(1).replace('.', ',')} km · ${Ld.agency || 'IDFM'}`;
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
  };
  const modeTag = () => { $('#ltMode').innerHTML = isLive(short) ? `<span class="tag rt"><i class="dot-live"></i>Temps réel${S.rt[short].demo ? ' (démo)' : ''}</span>` : '<span class="tag th">Horaires théoriques</span>'; };
  let teardownTab = () => {};
  const showTab = () => { teardownTab(); header(); modeTag(); setUrl(); teardownTab = st.tab === 'live' ? renderLive() : renderTT(); };
  $('#swap').onclick = () => { st.dir = 1 - st.dir; st.stop = null; st.ttStop = null; showTab(); };
  $$('.tabs button').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; showTab(); });
  S.cleanup.push(() => teardownTab());

  /* ----- Suivi en direct : schéma + carte ----- */
  function renderLive() {
    const M = Ld.main[st.dir]; const other = Ld.main[1 - st.dir]; const local = [];
    body.innerHTML = `
    <div class="layout">
      <div>
        <div class="card diagram">
          <div class="diagram-h"><span class="eyebrow">Parcours</span><span class="count" id="busCount"></span></div>
          <ul class="dgm" id="dgm"><span class="flow"></span>${M.stops.map((sid, i) => { const s = Ld.stops[sid]; const term = i === 0 || i === M.stops.length - 1; return `<li class="stop-row ${term ? 'term' : ''} ${sid === st.stop ? 'sel' : ''}" data-sid="${sid}" data-i="${i}"><span class="node"></span><span class="sname"><b>${esc(s.name)}</b><span>${term ? (i === 0 ? 'Départ' : 'Terminus') : ''}${s.wheelchair ? (term ? ' · ' : '') + '♿ accessible' : ''}${isFav(s.key) ? ' <span class="favdot">★</span>' : ''}</span></span><span class="nx" data-nx="${sid}"></span></li>`; }).join('')}</ul>
        </div>
        <div id="panel"></div>
      </div>
      <div class="card map-wrap"><div id="map"></div>
        <div class="map-fab"><button class="icon-btn" id="fit" aria-label="Recentrer">${TARGET_SVG}</button></div>
        <div class="map-legend"><span class="chip"><span class="tag ${isLive(short) ? 'rt' : 'th'}" id="legTag">${isLive(short) ? 'Temps réel' : 'Théorique'}</span><span id="legTxt">bus estimés le long du tracé</span></span></div>
      </div>
    </div>`;
    // carte
    const map = L.map('map', MAP_OPTS);
    MAP = map; L.control.zoom({ position: 'bottomright' }).addTo(map);
    const tiles = addTiles(map);
    const onTheme = () => { tiles.refresh(); drawStatic(); };
    window.addEventListener('onde-theme', onTheme); local.push(() => window.removeEventListener('onde-theme', onTheme));
    let staticLayer = L.layerGroup().addTo(map); const stopMk = {};
    function drawStatic() {
      staticLayer.clearLayers(); const bg = cssVar('--bg2');
      L.polyline(other.shape.map(p => [p[0], p[1]]), { color: meta.color, weight: 3, opacity: .35, dashArray: '4 8', interactive: false }).addTo(staticLayer);
      const ll = M.shape.map(p => [p[0], p[1]]);
      L.polyline(ll, { color: meta.color, weight: 16, opacity: .16, interactive: false, lineCap: 'round' }).addTo(staticLayer);
      if (isLight()) L.polyline(ll, { color: '#1a2233', weight: 9, opacity: .55, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(staticLayer);
      L.polyline(ll, { color: meta.color, weight: 6, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(staticLayer);
      M.stops.forEach((sid, i) => {
        const s = Ld.stops[sid]; const term = i === 0 || i === M.stops.length - 1;
        const mk = L.circleMarker([s.lat, s.lon], { radius: term ? 7 : 5, color: isLight() ? '#1a2233' : meta.color, weight: term ? 4 : 3, fillColor: sid === st.stop ? meta.color : bg, fillOpacity: 1 }).addTo(staticLayer);
        mk.bindTooltip(esc(s.name), { className: 'stop-tip', direction: 'top', offset: [0, -6] });
        mk.on('click', () => selectStop(sid, true)); stopMk[sid] = mk;
      });
    }
    drawStatic();
    const bounds = L.latLngBounds(M.shape.map(p => [p[0], p[1]]));
    const fit = (anim) => anim ? map.flyToBounds(bounds, { padding: [30, 30], duration: .8 }) : map.fitBounds(bounds, { padding: [30, 30] });
    fit(); $('#fit').onclick = () => { st.selBus = null; fit(true); };
    setTimeout(() => map.invalidateSize(), 50);
    // bus
    const markers = new Map(); const dgm = $('#dgm'); const dgmBus = new Map();
    const rowH = () => (dgm.children[1]?.offsetHeight || 60);
    function frame() {
      const now = Date.now(); const run = running(short, now); const seen = new Set();
      let nThis = 0;
      for (const { v, st: s } of run) {
        seen.add(v.id); const mine = v.p.dir === st.dir; if (mine) nThis++;
        const pos = posAt(v.p, s.dist);
        let m = markers.get(v.id);
        if (!m) {
          m = L.marker(pos.ll, { icon: busIcon(meta, v, mine ? '' : 'other'), zIndexOffset: mine ? 1000 : 0, keyboard: false, title: `Bus ${short} → ${v.headsign}` }).addTo(map);
          m.on('click', () => { st.selBus = v.id; openBusPopup(m, v.id); });
          m._mine = mine; markers.set(v.id, m);
        }
        if (m._mine !== mine) { m.setIcon(busIcon(meta, v, mine ? '' : 'other')); m._mine = mine; }
        m.setLatLng(pos.ll);
        const el = m.getElement(); if (el) { const h = el.querySelector('.head'); if (h) h.style.transform = `rotate(${pos.brg}deg)`; el.querySelector('.bus-mk')?.classList.toggle('sel', st.selBus === v.id); }
        // schéma
        if (mine) {
          let y = null;
          if (v.p === M) y = s.i + s.f;
          else { const a = M.stopIndex.get(v.p.stops[s.i]), b = M.stopIndex.get(v.p.stops[s.i + 1]); if (a != null && b != null) y = a + (b - a) * s.f; else if (b != null) y = Math.max(0, b - 1 + s.f); else if (a != null) y = a; }
          if (y != null) {
            let d = dgmBus.get(v.id);
            if (!d) { d = document.createElement('div'); d.className = 'dgm-bus'; d.innerHTML = `<div class="bus-mk ${v.rt ? 'rt' : 'th'}" style="--c:${meta.color};--t:${meta.textColor}"><span class="ring"></span><span class="ring r2"></span><span class="core">${BUS_SVG}</span></div><span class="lbl"></span>`; d.onclick = () => { st.selBus = v.id; const mk = markers.get(v.id); if (mk) { map.flyTo(mk.getLatLng(), Math.max(map.getZoom(), 15), { duration: .8 }); openBusPopup(mk, v.id); } }; dgm.appendChild(d); dgmBus.set(v.id, d); }
            const rh = rowH(); d.style.transform = `translateY(${(y * rh + rh / 2).toFixed(1)}px)`;
            d.querySelector('.lbl').textContent = s.waiting ? 'Au départ' : delayText(v);
          }
        }
      }
      for (const [id, m] of markers) if (!seen.has(id)) { m.remove(); markers.delete(id); }
      for (const [id, d] of dgmBus) { const r = run.find(x => x.v.id === id); if (!r || r.v.p.dir !== st.dir) { d.remove(); dgmBus.delete(id); } }
      $('#busCount').innerHTML = `${isLive(short) ? '<span class="tag rt"><i class="dot-live"></i>Live</span>' : '<span class="tag th">Théo.</span>'} ${nThis} bus vers ${esc(M.headsign)}`;
      if (st.selBus && map._popup && map._popup.isOpen()) updatePopup(st.selBus);
    }
    function popupHTML(id) {
      const v = journeys(short).find(x => x.id === id); if (!v) return 'Course terminée';
      const s = stateAt(v, Date.now()); if (!s) return 'Course terminée';
      const next = Math.min(v.p.stops.length - 1, s.waiting ? 0 : s.i + 1); const ns = Ld.stops[v.p.stops[next]];
      return `<div class="pop"><div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">${badge(meta, 'sm')}<b>→ ${esc(v.headsign)}</b></div>
        <div class="dep"><span class="dest">${s.waiting ? 'Départ de' : 'Prochain arrêt'} <b>${esc(ns.name)}</b></span>${whenHTML(v.tms[next], Date.now(), v.rt)}</div>
        <div class="dep"><span class="dest">Terminus ${esc(Ld.stops[v.p.stops[v.p.stops.length - 1]].name)}</span><span class="when">${fmtHM(v.tms[v.tms.length - 1])}</span></div>
        <div style="margin-top:8px"><span class="tag ${v.rt ? 'rt' : 'th'}">${v.rt ? '<i class="dot-live"></i>' : ''}${delayText(v)}</span></div></div>`;
    }
    function openBusPopup(m, id) { m.bindPopup(popupHTML(id), { autoPan: false, closeButton: true, offset: [0, -14] }).openPopup(); }
    function updatePopup(id) { const m = markers.get(id); if (m && m.getPopup()) m.setPopupContent(popupHTML(id)); }
    local.push(loop(frame));
    // prochains passages dans le schéma
    function refreshNx() {
      const now = Date.now();
      for (const el of $$('[data-nx]', dgm)) {
        const d = departures(short, el.dataset.nx, now, 2).filter(x => x.dir === st.dir || true);
        const a = d[0], b = d[1];
        const fx = (h, d) => d && d.fin ? `<span class="tw">${h}${FIN_TAG}</span>` : h;
        el.innerHTML = a ? `${fx(`<span class="m ${a.rt ? 'rt' : 'th'}">${a.t - now < 60000 ? '<1' : Math.floor((a.t - now) / 60000)}′</span>`, a)}${b ? fx(`<span class="m2">${b.t - now < 3600e3 ? Math.floor((b.t - now) / 60000) + '′' : fmtHM(b.t)}</span>`, b) : ''}` : '<span class="m2">—</span>';
        if (a && a.t - now >= 3600e3) el.innerHTML = fx(`<span class="m th">${fmtHM(a.t)}</span>`, a);
      }
      if (st.stop) renderPanel();
      modeTag(); const lt = $('#legTag'); if (lt) { lt.className = 'tag ' + (isLive(short) ? 'rt' : 'th'); lt.textContent = isLive(short) ? 'Temps réel' : 'Théorique'; }
    }
    const nxId = setInterval(refreshNx, 10000); refreshNx(); local.push(() => clearInterval(nxId));
    const onRt = e => { if (e.detail === short) { for (const m of markers.values()) m.remove(); markers.clear(); for (const d of dgmBus.values()) d.remove(); dgmBus.clear(); refreshNx(); } };
    window.addEventListener('onde-rt', onRt); local.push(() => window.removeEventListener('onde-rt', onRt));
    function selectStop(sid, fromMap) {
      st.stop = sid; setUrl();
      $$('.stop-row', dgm).forEach(r => r.classList.toggle('sel', r.dataset.sid === sid));
      Object.entries(stopMk).forEach(([k, mk]) => mk.setStyle({ fillColor: k === sid ? meta.color : cssVar('--bg2') }));
      const s = Ld.stops[sid]; map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15), { duration: .7 });
      renderPanel();
      if (fromMap) dgm.querySelector(`[data-sid="${sid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (innerWidth <= 920) $('#panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function renderPanel() {
      const sid = st.stop; if (!sid) { $('#panel').innerHTML = ''; return; }
      const s = Ld.stops[sid]; const now = Date.now(); const d = departures(short, sid, now, 6);
      $('#panel').innerHTML = `<div class="card panel fade-in"><div class="panel-h"><div><span class="eyebrow">Arrêt sélectionné</span><h3>${esc(s.name)}</h3><span class="muted" style="font-size:13px">Direction ${esc(M.headsign)}${s.wheelchair ? ' · ♿ accessible' : ''}</span></div>
        <div class="actions"><button class="star ${isFav(s.key) ? 'on' : ''}" id="favBtn" aria-label="Favori">${STAR_SVG}</button></div></div>
        <div class="dep-group">${d.map(x => `<div class="dep"><span class="dest">→ ${esc(x.headsign)}</span>${x.rt && x.aim && Math.abs(x.delay) >= 60e3 ? `<s>${fmtHM(x.aim)}</s>` : ''}<span class="faint" style="font-family:var(--mono);font-size:13px">${fmtHM(x.t)}</span>${whenFin(x, now)}</div>`).join('') || '<div class="muted">Aucun passage prévu prochainement.</div>'}</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="chip" href="#/arret/${encodeURIComponent(s.key)}">Toutes les lignes à cet arrêt</a><button class="chip" id="ttGo">Fiche horaire de l'arrêt</button></div></div>`;
      $('#favBtn').onclick = () => { toggleFav(s.key); renderPanel(); };
      $('#ttGo').onclick = () => { st.ttStop = sid; st.tab = 'tt'; showTab(); };
    }
    dgm.addEventListener('click', e => { const r = e.target.closest('.stop-row'); if (r) selectStop(r.dataset.sid, false); });
    if (st.stop && M.stopIndex.has(st.stop)) setTimeout(() => selectStop(st.stop, true), 300);
    const rtId = setInterval(() => pollRT(short), 30000); local.push(() => clearInterval(rtId));
    return () => { local.forEach(f => f()); markers.clear(); map.remove(); MAP = null; };
  }

  /* ----- Fiche horaire ----- */
  function renderTT() {
    const M = Ld.main[st.dir];
    const dirPatterns = Ld.patterns.filter(p => p.dir === st.dir);
    const stopIds = [...M.stops]; for (const p of dirPatterns) for (const s of p.stops) if (!stopIds.includes(s)) stopIds.push(s);
    if (!st.ttStop || !stopIds.includes(st.ttStop)) st.ttStop = (st.stop && stopIds.includes(st.stop)) ? st.stop : M.stops[0];
    const allDates = [...new Set(Object.values(Ld.services).flat())].sort().filter(d => d >= todayYmd());
    if (!allDates.includes(st.ttDay)) st.ttDay = allDates[0];
    body.innerHTML = `
      <div class="tt-controls fade-in">
        <div class="select"><select id="ttStop" aria-label="Arrêt">${stopIds.map(s => `<option value="${s}" ${s === st.ttStop ? 'selected' : ''}>${esc(Ld.stops[s].name)}</option>`).join('')}</select></div>
        <div class="tt-days" id="ttDays">${allDates.slice(0, 21).map(d => `<button class="chip ${d === st.ttDay ? 'on' : ''}" data-d="${d}">${dayLabel(d)}<small>${ymdDate(d).getUTCDate()} ${MONTHS[ymdDate(d).getUTCMonth()]}</small></button>`).join('')}</div>
      </div>
      <div class="card tt-wrap fade-in" id="tt"></div>`;
    const draw = () => {
      const rows = []; const variants = new Map(); const now = Date.now(); const D4 = 4 * 3600;
      for (const [day, off] of [[st.ttDay, 0], [addDays(st.ttDay, 1), 86400]]) {
      const svcs = Ld.activeSvc(day); const mid = midnight(day) - off * 1000;
      for (const t of Ld.tripObjs) {
        if (t.p.dir !== st.dir || !svcs.has(t.svc)) continue;
        const k = t.p.stopIndex.get(st.ttStop); if (k == null || k === t.p.stops.length - 1) continue;
        const sec = t.times[k] + off; if (off ? sec >= 86400 + D4 || t.times[k] >= D4 : t.times[k] < D4) continue;
        const term = Ld.stops[t.p.stops[t.p.stops.length - 1]].name; const mainTerm = Ld.stops[M.stops[M.stops.length - 1]].name;
        let mark = ''; if (term !== mainTerm) { if (!variants.has(term)) variants.set(term, String.fromCharCode(97 + variants.size)); mark = variants.get(term); }
        rows.push({ s: sec, mark, ms: mid + sec * 1000, fin: isFin(Ld, st.ttStop, { t: mid + sec * 1000, trip: t, k, day, dir: st.dir }) });
      }
      }
      rows.sort((a, b) => a.s - b.s);
      const nextIdx = rows.findIndex(r => r.ms >= now - 30e3);
      const byH = new Map(); rows.forEach((r, i) => { const h = Math.floor(r.s / 3600); if (!byH.has(h)) byH.set(h, []); byH.get(h).push({ ...r, i }); });
      const curH = st.ttDay === todayYmd() ? parisParts().h : -1;
      const gaps = rows.slice(1).map((r, i) => r.s - rows[i].s);
      const peak = rows.filter(r => r.s >= 7 * 3600 && r.s < 9.5 * 3600); const pg = peak.slice(1).map((r, i) => r.s - peak[i].s);
      const med = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
      $('#tt').innerHTML = rows.length ? `
        <div class="tt-summary">
          <div>Premier départ<b>${fmtSecs(rows[0].s)}</b></div>
          <div>Dernier départ<b>${fmtSecs(rows[rows.length - 1].s)}</b></div>
          <div>Passages<b>${rows.length}</b></div>
          <div>Fréquence (pointe)<b>${pg.length ? '~' + Math.round(med(pg) / 60) + ' min' : gaps.length ? '~' + Math.round(med(gaps) / 60) + ' min' : '—'}</b></div>
          <div>Jour<b style="font-size:16px;margin-top:6px">${dayLong(st.ttDay)}</b></div>
        </div>
        <div class="tt-grid">${[...byH.entries()].map(([h, list]) => `<div class="tt-h ${h % 24 === curH && h < 24 ? 'now' : ''}">${pad(h % 24)}h</div><div class="tt-m">${list.map(r => `<span class="${r.ms < now - 30e3 ? 'past' : ''} ${r.i === nextIdx ? 'next' : ''} ${r.fin ? 'has-fin' : ''}">${pad(Math.floor(r.s / 60) % 60)}${r.mark ? `<sup>${r.mark}</sup>` : ''}${r.fin ? FIN_TAG : ''}</span>`).join('')}</div>`).join('')}</div>
        <div class="tt-notes">Direction <b>${esc(M.headsign)}</b> · horaires prévus à l'arrêt <b>${esc(Ld.stops[st.ttStop].name)}</b>.${[...variants.entries()].map(([t, m]) => ` <sup style="color:var(--theo)">${m}</sup> terminus ${esc(t)}.`).join('')} Journée de service de 4 h à 4 h : les passages après minuit figurent en fin de grille. <em class="fin">fin</em> = dernier passage de la soirée. Source : GTFS IDFM, mis à jour le ${esc((Ld.generated || '').slice(0, 10).split('-').reverse().join('/'))}.</div>`
        : `<div class="empty" style="margin:16px">Aucun passage prévu à cet arrêt ce jour-là.</div>`;
      if (!draw.done) { draw.done = true; const nx = $('#tt .tt-m span.next'); if (nx) setTimeout(() => nx.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); }
    };
    $('#ttStop').onchange = e => { st.ttStop = e.target.value; draw(); };
    $('#ttDays').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; st.ttDay = b.dataset.d; $$('#ttDays .chip').forEach(c => c.classList.toggle('on', c === b)); draw(); };
    draw();
    const id = setInterval(draw, 30000);
    return () => clearInterval(id);
  }
  showTab();
  pollRT(short).then(() => { modeTag(); });
}

/* ---------------- Vue arrêt (toutes lignes) ---------------- */
async function viewStop(key) {
  setLineTheme(null); S.view = { name: 'stop', key };
  const hits = [];
  for (const l of S.lines) { const L = S.data[l.short]; for (const s of Object.values(L.stops)) if (s.key === key) hits.push({ l, s, L }); }
  if (!hits.length) return viewHome();
  const name = hits[0].s.name; document.title = `${name} — Onde 92`;
  const shorts = [...new Set(hits.map(h => h.l.short))]; if (shorts.length === 1) setLineTheme(S.meta[shorts[0]]);
  S.view.shorts = shorts;
  $('#app').innerHTML = `
    <div class="line-head fade-in"><a class="back" href="#/" aria-label="Retour">${BACK_SVG}</a>
      <div class="line-title"><span class="eyebrow">Arrêt</span><h1>${esc(name)}</h1><div class="sub">${shorts.map(s => badge(S.meta[s], 'sm')).join(' ')}</div></div>
      <button class="star ${isFav(key) ? 'on' : ''}" id="favBtn" aria-label="Favori">${STAR_SVG}</button></div>
    <div class="fav-grid" id="stopCards"></div>`;
  $('#favBtn').onclick = () => { toggleFav(key); $('#favBtn').classList.toggle('on', isFav(key)); };
  const draw = () => {
    const now = Date.now(); const groups = [];
    for (const sh of shorts) for (const d of [0, 1]) {
      const quays = hits.filter(h => h.l.short === sh).map(h => h.s.id);
      const deps = quays.flatMap(q => departures(sh, q, now, 5)).filter(x => x.dir === d).sort((a, b) => a.t - b.t).slice(0, 4);
      const M = S.data[sh].main[d]; const q = quays.find(q => S.data[sh].patterns.some(p => p.dir === d && p.stopIndex.has(q) && p.stopIndex.get(q) < p.stops.length - 1));
      if (q) groups.push({ sh, d, deps, M, q });
    }
    $('#stopCards').innerHTML = groups.map(g => `<div class="card fav-card fade-in" style="--line:${S.meta[g.sh].color}"><h3><span style="display:flex;gap:10px;align-items:center">${badge(S.meta[g.sh], 'sm')}<span>→ ${esc(g.M.headsign)}</span></span><a class="chip" href="#/ligne/${g.sh}?${g.d ? 'd=1&' : ''}s=${g.q}">Voir la ligne</a></h3>
      ${g.deps.map(x => `<div class="dep"><span class="dest">${esc(x.headsign)}</span>${x.rt && x.aim && Math.abs(x.delay) >= 60e3 ? `<s>${fmtHM(x.aim)}</s>` : ''}<span class="faint" style="font-family:var(--mono);font-size:13px">${fmtHM(x.t)}</span>${whenFin(x, now)}</div>`).join('') || '<div class="muted">Aucun passage prévu prochainement.</div>'}</div>`).join('');
  };
  every(10000, draw);
  every(30000, () => shorts.forEach(pollRT));
}

/* ---------------- Routeur ---------------- */
async function route() {
  S.cleanup.forEach(f => { try { f(); } catch (e) { } }); S.cleanup = [];
  const h = location.hash.slice(1) || '/'; const [path, qs] = h.split('?'); const params = new URLSearchParams(qs || '');
  let m;
  if ((m = /^\/ligne\/(\d{3})/.exec(path))) await viewLine(m[1], params);
  else if ((m = /^\/arret\/(.+)/.exec(path))) await viewStop(decodeURIComponent(m[1]));
  else if (/^\/monbus/.test(path)) await viewMonBus(params);
  else if (/^\/autour/.test(path)) await viewAutour(params);
  else await viewHome();
  updateLivePill(); window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
async function init() {
  tickClock(); setInterval(tickClock, 1000);
  $('#themeBtn').onclick = () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; localStorage.setItem('onde-theme', t);
    document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#07090f' : '#F3F4F8';
    window.dispatchEvent(new Event('onde-theme'));
  };
  const meta = await fetch('/data/lines.json').then(r => r.json());
  S.lines = meta.lines; S.meta = Object.fromEntries(meta.lines.map(l => [l.short, l]));
  $('#footData').textContent = `Horaires GTFS du ${meta.generated.slice(0, 10).split('-').reverse().join('/')}`;
  await Promise.all(S.lines.map(l => getLine(l.short)));
  fetch('/api/status').then(r => r.json()).then(s => { S.status = s; updateLivePill(); }).catch(() => {});
  S.lines.forEach(l => pollRT(l.short));
  window.addEventListener('hashchange', route);
  route();
}
init();
