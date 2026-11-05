/* Onde 92 — page principale : « les bus autour de toi » + « Où vas-tu ? » sur une carte MapLibre (OpenFreeMap).
   Le moteur (horaires, temps réel, « fin », marche, itinéraire) est dans core.js. Le navigateur n'utilise que
   les endpoints en cache CDN /api/rt/<ligne> : aucun appel PRIM supplémentaire. */
'use strict';
const OSM_FONTS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const STYLE_URL = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const I = {
  walk: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2" fill="currentColor" stroke="none"/><path d="M10 21l2-6 3 3v3M9 12l1.5-4 3.5 1 2 3 2 1M10.5 8L7 10l-1 3"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  flag: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h10.5l-2 4 2 4H6"/></svg>',
  back: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  chev: '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>',
  gps: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l7.5 18.5-7.5-4-7.5 4z" transform="rotate(45 12 12)"/></svg>',
};
const U = {
  dataReady: false, origin: null, geo: 'pending', ask: false, watch: null,
  near: [], places: [], R: 800, sel: null, stop: null,
  dest: null, plan: null, opt: 0, planKey: null,
  gps: null, followGps: true, camLock: false, pinPend: null, wantFly: false,
  map: null, styleReady: false, sat: localStorage.getItem('onde-sat') === '1', styles: {},
};
const HOME = { lat: 48.874, lon: 2.205, label: 'Rueil — Suresnes', src: 'home' };
const isDark = () => document.documentElement.dataset.theme === 'dark';
const panel = $('#panel');

/* ================= formats ================= */
const minsOf = (t, now) => Math.max(0, Math.floor((t - now) / 60000));
function bigWhen(d, now) {
  if (!d) return '<span class="tm none">—</span>';
  if (d.t - now < 60e3) return `<span class="tm ${d.rt ? 'rt' : ''}"><b>&lt;1</b><small>min</small></span>`;
  const m = minsOf(d.t, now);
  return m < 60 ? `<span class="tm ${d.rt ? 'rt' : ''}"><b>${m}</b><small>min</small></span>` : `<span class="tm ${d.rt ? 'rt' : ''}"><b class="hm">${fmtHM(d.t)}</b></span>`;
}
const inLong = (d, now) => { const m = minsOf(d.t, now); return d.t - now < 60e3 ? '&lt;1 min' : m < 60 ? m + ' min' : 'dans ' + Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
const shortWhen = (d, now) => d.t - now < 60e3 ? '&lt;1 min' : minsOf(d.t, now) < 60 ? minsOf(d.t, now) + ' min' : fmtHM(d.t);
const src = d => d.rt ? '<span class="src live"><i></i>Live</span>' : '<span class="src">Prévu</span>';
const fin = d => d && d.fin ? '<em class="fin" title="Dernier bus de la soirée à cet arrêt, dans ce sens">fin</em>' : '';
const vPill = (v, long) => `<span class="v ${v.k}"><i></i>${long ? v.txt : v.short}</span>`;
const lb = (short, cls = '') => { const m = S.meta[short]; return `<span class="lb ${cls}" style="--c:${m.color};--t:${m.textColor}">${m.short}</span>`; };
const headOf = (short, dir) => S.data[short].main[dir].headsign;

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
  // le rond (centre de la carte) suit le GPS tant qu'on n'a pas déplacé la carte à la main
  if (U.forceGps || U.followGps) {
    U.forceGps = false; U.followGps = true;
    setOrigin({ ...o }, true); reverseLabel(U.origin);
  } else syncMap();
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
function setOrigin(o, fly, quick) { // quick = pendant un déplacement de carte : pas d'appels de marche (OSRM)
  U.origin = o; U.ask = false; U.sel = null; U.stop = null;
  if (o.src === 'addr') mbSet('onde-addr', { label: o.label, lat: o.lat, lon: o.lon });
  if (fly) U.wantFly = true;
  if (!U.dataReady) return render();
  computeNear(quick); if (U.dest) computePlan(quick);
  render(); syncMap();
  const shouldFly = !!(fly || (U.wantFly && U.followGps));
  U.wantFly = false;
  if (shouldFly) flyTo(o);
}

/* ================= bus proches ================= */
function computeNear(quick) {
  const O = U.origin, o = [O.lat, O.lon];
  const cand = nbQuays().map(q => ({ ...q, d: haversine(o, [q.s.lat, q.s.lon]) }));
  let R = NB.R, within = cand.filter(q => q.d <= R);
  for (const r of [NB.R_MAX, 2500]) if (!within.length) { R = r; within = cand.filter(q => q.d <= R); }
  U.R = R;
  const best = new Map();
  for (const q of within) { const k = q.short + '|' + q.dir; if (!best.has(k) || best.get(k).d > q.d) best.set(k, q); }
  const ap = d => ({ duration: d * 1.3 / MB.SPEED, distance: d * 1.3, source: 'approx' });
  U.near = [...best.values()].map(q => ({ ...q, key: q.short + '|' + q.dir, walk: ap(q.d) }));
  U.places = nbPlaces().map(p => ({ p, d: haversine(o, [p.lat, p.lon]) })).filter(x => x.d <= R);
  sortNear();
  if (quick) return;
  // trajets à pied réels (OSRM piéton) pour les arrêts de la liste, 3 à la fois
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
function nearGroups() { // par ligne (la plus proche d'abord), puis par sens
  const by = new Map();
  for (const g of U.near) { if (!by.has(g.short)) by.set(g.short, []); by.get(g.short).push(g); }
  return [...by.entries()].map(([short, rows]) => ({ short, rows: rows.sort((a, b) => a.dir - b.dir), w: Math.min(...rows.map(r => r.walk.duration)) })).sort((a, b) => a.w - b.w);
}
function rowDeps(g, now, n = 8) { return departures(g.short, g.sid, now, n + 4).filter(d => d.dir === g.dir && d.t > now - 20e3).slice(0, n); }
function rowHTML(g, now) {
  const W = g.walk.duration, ds = rowDeps(g, now, 6), a = ds[0], on = U.sel === g.key;
  const va = a && nbVerdict(a, W, now);
  const then = ds.slice(1, 3).map(d => shortWhen(d, now).replace(' min', '') + (d.fin ? ' <em class="fin">fin</em>' : '')).join(' · ');
  const thenTxt = ds.length > 1 ? `puis ${then}${minsOf(ds[1].t, now) < 60 && (!ds[2] || minsOf(ds[2].t, now) < 60) ? ' min' : ''}` : a ? 'dernier pour l\'instant' : '';
  const more = on ? `<div class="more">
      <div class="more-stop">${I.pin}<span>Arrêt <b>${esc(g.s.name)}</b> · ${fmtDist(g.walk.distance)}, ${fmtDur(W)} à pied${g.walk.source === 'approx' ? ' (estimé)' : ''}</span></div>
      <ul class="deps">${ds.map(d => { const v = nbVerdict(d, W, now); const hs = d.headsign && d.headsign !== headOf(g.short, g.dir) ? `<small>terminus ${esc(d.headsign)}</small>` : '';
        return `<li class="${v.k}"><span class="dt"><b>${fmtHM(d.t)}</b>${fin(d)}</span><span class="dm">${inLong(d, now)}${hs}</span>${src(d)}${vPill(v)}</li>`; }).join('') || '<li class="none">Plus de bus prévu.</li>'}</ul>
      <div class="more-a"><button type="button" class="link" data-stopsid="${esc(g.short + '|' + g.sid)}">${I.pin}Voir l'arrêt</button><a class="link faint" href="/lignes.html#/ligne/${g.short}?${g.dir ? 'd=1&' : ''}s=${encodeURIComponent(g.sid)}">Fiche de la ligne ${g.short}</a></div>
    </div>` : '';
  return `<div class="row ${on ? 'on' : ''}" data-key="${g.key}">
    <button class="row-h" type="button" aria-expanded="${on}">
      ${lb(g.short)}
      <span class="row-m"><b class="to">vers ${esc(headOf(g.short, g.dir))}</b>
        <small>${I.walk}${fmtDur(W)}${va ? ` · ${vPill(va)}` : ''}${thenTxt ? ` <span class="then">· ${thenTxt}</span>` : ''}</small></span>
      <span class="row-t">${bigWhen(a, now)}${a ? src(a) : '<span class="src">aujourd\'hui</span>'}${fin(a)}</span>
    </button>${more}</div>`;
}
function nearHTML(now) {
  const O = U.origin, pin = O.src === 'pin' || O.src === 'home';
  const where = O.src === 'gps' ? (O.stale ? 'Ta dernière position' : O.label === 'Ma position' ? 'Autour de ta position' : 'Près de ' + esc(O.label)) : pin ? (O.label === 'Point choisi' ? 'Autour du point choisi' : 'Près de ' + esc(O.label)) : esc(O.label);
  const back = O.src !== 'gps' && U.gps ? ` · <button type="button" class="link" data-act="regps">me recentrer</button>` : '';
  const head = `<div class="sec-h"><div><h1>${O.src === 'gps' ? 'Bus autour de toi' : 'Bus autour du point'}</h1><p class="${back ? 'two' : ''}">${I.pin}<span class="where">${where}</span><span class="acts">${back ? '' : '· '}<button type="button" class="link" data-act="ask">changer</button>${back}</span></p></div>${liveChip(U.near.map(g => g.short))}</div>`;
  if (!U.near.length) return head + `<div class="empty"><b>Aucun arrêt des lignes 144, 160, 244 ou 360 à moins de ${fmtDist(U.R)}.</b><p>Déplace la carte près d'une ligne, tape un lieu avec « changer », ou cherche ta destination ci-dessus.</p></div>`;
  return head + `<div class="list">${nearGroups().map(gr => `<div class="grp" style="--c:${S.meta[gr.short].color}">${gr.rows.map(g => rowHTML(g, now)).join('')}</div>`).join('')}</div>
    <p class="hint">${U.places.length} arrêt${U.places.length > 1 ? 's' : ''} à moins de ${fmtDist(U.R)} · déplace la carte pour voir ailleurs.</p>`;
}
function liveChip(shorts) {
  const live = [...new Set(shorts)].some(isLive);
  return live ? '<span class="chip-live"><i></i>Temps réel</span>' : '<span class="chip-live off" title="Temps réel indisponible : horaires prévus">Horaires prévus</span>';
}

/* ================= arrêt touché sur la carte ================= */
function stopHTML(now) {
  const p = U.stop, groups = new Map();
  for (const q of p.quays) for (const d of departures(q.short, q.sid, now, 10)) {
    if (d.t < now - 20e3) continue; const k = q.short + '|' + d.dir;
    if (!groups.has(k)) groups.set(k, { short: q.short, dir: d.dir, sid: q.sid, s: q.s, deps: [] });
    const g = groups.get(k); if (!g.deps.some(x => Math.abs(x.t - d.t) < 30e3)) g.deps.push(d);
  }
  const W = U.stop.walk?.duration ?? (U.origin ? haversine([U.origin.lat, U.origin.lon], [p.lat, p.lon]) * 1.3 / MB.SPEED : null);
  const gs = [...groups.values()].map(g => ({ ...g, deps: g.deps.sort((a, b) => a.t - b.t).slice(0, 3) })).sort((a, b) => a.short.localeCompare(b.short) || a.dir - b.dir);
  const dist = U.origin ? haversine([U.origin.lat, U.origin.lon], [p.lat, p.lon]) : null;
  return `<div class="sec-h"><button class="back" type="button" data-act="close" aria-label="Retour">${I.back}</button><div><h1>${esc(p.name)}</h1><p>${p.lines.map(s => lb(s, 'sm')).join('')}${W != null ? `<span class="sep">·</span>${I.walk}${fmtDur(W)} à pied (${fmtDist(U.stop.walk?.distance ?? dist * 1.3)})` : ''}</p></div>${liveChip(p.lines)}</div>
    <div class="list">${gs.map(g => { const a = g.deps[0], v = a && W != null ? nbVerdict(a, W, now) : null;
      return `<div class="srow"><div class="srow-h">${lb(g.short)}<b class="to">vers ${esc(headOf(g.short, g.dir))}</b>${v ? vPill(v, true) : ''}</div>
        <div class="srow-d">${g.deps.map(d => `<span class="sd ${d.rt ? 'rt' : ''}"><b>${shortWhen(d, now)}</b><small>${fmtHM(d.t)}${d.rt ? ' · Live' : ' · Prévu'}</small>${fin(d)}</span>`).join('')}</div></div>`; }).join('') || '<div class="empty"><b>Plus de bus prévu à cet arrêt pour l\'instant.</b></div>'}</div>`;
}
function openStop(p) {
  U.stop = { ...p, walk: null }; U.sel = null; render(); syncMap();
  if (U.origin) walkRoute(U.origin, { lat: p.lat, lon: p.lon }).then(w => { if (U.stop && U.stop.key === p.key && U.stop.lat === p.lat) { U.stop.walk = w; render(); syncMap(); } });
  scrollPanelTop();
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
  U.plan.loading = false; reorder(); U.opt = 0; render(); syncMap();
  [...new Set(U.plan.opts.map(o => o.short))].forEach(pollRT);
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
  U.opt = Math.max(0, U.plan.opts.indexOf(cur));
}
function destHTML(now) {
  const P = U.plan, D = U.dest;
  const head = `<div class="sec-h"><button class="back" type="button" data-act="cleardest" aria-label="Retour aux bus proches">${I.back}</button><div><h1>Vers ${esc(D.label)}</h1><p>${I.pin}<span class="where">Depuis ${U.origin.src === 'gps' ? 'ta position' : U.origin.src === 'pin' ? 'le point sur la carte' : esc(U.origin.label)}</span></p></div></div>`;
  if (!P) return head;
  const wd = P.walkDirect;
  const walkOnly = wd ? `<div class="walkonly">${I.walk}<span><b>${fmtDur(wd.duration)} à pied</b> en marchant directement (${fmtDist(wd.distance)}${wd.source === 'approx' ? ', estimé' : ''})</span></div>` : '';
  if (!P.opts.length) return head + `<div class="empty"><b>Aucune de nos lignes ne t'y emmène directement.</b><p>Les lignes 144, 160, 244 et 360 ne passent pas à la fois près de toi et près de cette destination. Il te faudra une autre ligne ou une correspondance.</p></div>${walkOnly}`;
  return head + `<div class="opts">${P.opts.slice(0, 3).map((op, i) => optHTML(op, i, now)).join('')}</div>${walkOnly}
    ${P.loading ? '<p class="hint">Calcul des trajets à pied…</p>' : '<p class="hint">Durée en bus d\'après les horaires de la course · Live = estimation IDFM.</p>'}`;
}
function optHTML(op, i, now) {
  const on = i === U.opt, ev = evalOpt(op, now), f = ev.first;
  const total = ev.arrive ? Math.round((ev.arrive - now) / 60000) : null;
  const ride = f ? f.ride : op.ride, ns = f ? f.stops : op.b.k - op.a.k;
  const after = f ? ev.deps.filter(d => d.t > f.t)[0] : null;
  const slow = U.plan.walkDirect && ev.arrive && now + U.plan.walkDirect.duration * 1000 <= ev.arrive;
  const missed = !f && ev.deps[0];
  return `<div class="opt ${on ? 'on' : ''}" data-opt="${i}" style="--c:${S.meta[op.short].color}" role="button" tabindex="0" aria-pressed="${on}">
    <div class="opt-h">${lb(op.short)}<b class="to">vers ${esc(headOf(op.short, op.dir))}</b>
      <span class="opt-tot">${total != null ? `<b>${total} min</b><small>arrivée ${fmtHM(ev.arrive)}</small>` : '<b class="none">—</b><small>plus de bus</small>'}</span></div>
    <ol class="steps">
      <li>${I.walk}<span><b>${fmtDur(op.walkA.duration)}</b> à pied jusqu'à <b>${esc(op.a.s.name)}</b></span></li>
      <li class="bus">${lb(op.short, 'xs')}<span>${f ? `Prochain départ <b>${shortWhen(f, now)}</b> (${fmtHM(f.t)}) ${src(f)}${fin(f)} ${vPill(f.v, true)}${after ? `<small>puis ${fmtHM(after.t)}${after.fin ? ' <em class="fin">fin</em>' : ''}</small>` : ''}` : missed ? `Dernier bus ${fmtHM(missed.t)} : ${vPill(missed.v)}` : 'Plus de départ prévu aujourd\'hui'}
        <small>${Math.max(1, Math.round(ride / 60))} min de trajet · ${ns} arrêt${ns > 1 ? 's' : ''}</small></span></li>
      <li>${I.flag}<span>Descends à <b>${esc(op.b.s.name)}</b>${op.b.d > 0 ? `, puis ${fmtDur(op.walkB.duration)} à pied` : ''}${f ? ` <small>vers ${fmtHM(f.arr)}</small>` : ''}</span></li>
    </ol>${slow ? `<p class="opt-warn">${I.walk}Aussi rapide à pied (${fmtDur(U.plan.walkDirect.duration)}).</p>` : ''}</div>`;
}
function fitOpt() {
  if (!U.origin || !U.dest || !U.map) return;
  const pts = [[U.dest.lat, U.dest.lon]];
  const op = U.plan?.opts[U.opt];
  if (op) pts.push([op.a.s.lat, op.a.s.lon], [op.b.s.lat, op.b.s.lon]);
  flyTo(U.origin, { zoom: zoomToInclude(U.origin, pts, 16.4) });
}

/* ================= adresse (repli sans géolocalisation) ================= */
function askHTML() {
  const last = mbGet('onde-addr');
  const why = U.geo === 'denied' ? 'La localisation est refusée.' : U.geo === 'unavailable' ? 'Position introuvable.' : '';
  return `<div class="ask">
    ${U.origin ? `<button class="back" type="button" data-act="unask" aria-label="Retour">${I.back}</button>` : ''}
    <h1>Où es-tu&nbsp;?</h1><p>${why} Tape une adresse, un commerce, une gare, une école, un parc…</p>
    <div class="field"><label class="search-in">${I.pin}<input id="addr" type="search" inputmode="search" enterkeyhint="search" autocomplete="street-address" placeholder="Adresse, commerce, gare, parc…" aria-label="Ton adresse ou un lieu"></label><div class="results" id="addrRes" role="listbox"></div></div>
    ${last && (!U.origin || U.origin.label !== last.label) ? `<button type="button" class="link" data-act="last">${I.pin}${esc(last.label)}</button>` : ''}
    ${U.geo !== 'denied' && U.origin?.src !== 'gps' && 'geolocation' in navigator && U.origin ? `<button type="button" class="link" data-act="geo">${I.gps}Utiliser ma position</button>` : ''}
  </div>`;
}
function pendingHTML() {
  return `<div class="ask pending"><div class="pulse"><i></i><i></i>${I.gps}</div><h1>On te localise…</h1><p>Autorise la localisation pour voir tout de suite les bus autour de toi.</p><button type="button" class="link" data-act="ask">ou tape ton adresse</button></div>`;
}

/* ================= rendu du panneau ================= */
let lastSig = '', lastHTML = '';
function mode() { if (!U.dataReady) return 'loading'; if (U.ask || !U.origin) return U.geo === 'pending' && !U.ask ? 'pending' : 'ask'; if (U.stop) return 'stop'; if (U.dest) return 'dest'; return 'near'; }
function render() {
  const m = mode(), now = Date.now();
  $('#searchBox').hidden = !(m === 'near' || m === 'dest' || m === 'stop');
  $('#app').dataset.mode = m;
  if (m === 'ask') { // champ d'adresse : rendu une seule fois (on ne l'écrase pas pendant la saisie)
    if (lastSig !== 'ask') { panel.innerHTML = askHTML(); lastSig = 'ask'; lastHTML = ''; const inp = $('#addr'); nbSearch(inp, $('#addrRes'), h => { U.followGps = false; setOrigin({ label: h.label, lat: h.lat, lon: h.lon, src: 'addr' }, true); }); if (matchMedia('(min-width: 900px)').matches || U.geo !== 'pending') setTimeout(() => inp.focus({ preventScroll: true }), 60); }
    return;
  }
  const h = m === 'loading' ? '<div class="ask pending"><div class="pulse"><i></i><i></i></div><p>Chargement des horaires…</p></div>' : m === 'pending' ? pendingHTML() : m === 'stop' ? stopHTML(now) : m === 'dest' ? destHTML(now) : nearHTML(now);
  if (h !== lastHTML || lastSig !== m) { panel.innerHTML = h; lastHTML = h; lastSig = m; }
}
function scrollPanelTop() { const sh = $('#sheet'); if (sh.scrollTop > 0) sh.scrollTo({ top: 0, behavior: 'smooth' }); }

panel.addEventListener('click', e => {
  const t = e.target;
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'ask') { U.ask = true; return render(); }
  if (act === 'unask') { U.ask = false; return render(); }
  if (act === 'geo') return locate(true);
  if (act === 'regps') return regps();
  if (act === 'last') { const l = mbGet('onde-addr'); if (l) setOrigin({ ...l, src: 'addr' }, true); return; }
  if (act === 'close') { U.stop = null; render(); syncMap(); return U.dest ? fitOpt() : fitNear(); }
  if (act === 'cleardest') return clearDest();
  const st = t.closest('[data-stopsid]'); if (st) { const [sh, sid] = st.dataset.stopsid.split('|'); const p = nbPlaces().find(p => p.quays.some(q => q.short === sh && q.sid === sid)); if (p) openStop(p, true); return; }
  const rh = t.closest('.row-h'); if (rh) { const k = rh.parentElement.dataset.key; U.sel = U.sel === k ? null : k; render(); syncMap(); if (U.sel) fitSel(); return; }
  const op = t.closest('.opt'); if (op) { U.opt = +op.dataset.opt; render(); syncMap(); fitOpt(); }
});
panel.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('opt')) { e.preventDefault(); e.target.click(); } });

/* ================= barre « Où vas-tu ? » ================= */
const qIn = $('#q');
const qSearch = nbSearch(qIn, $('#qRes'), d => setDest(d));
qIn.addEventListener('input', () => { $('#qClear').hidden = !qIn.value; });
qIn.addEventListener('focus', () => { if (U.dest) qIn.select(); if (innerWidth < 900) setTimeout(() => $('#sheet').scrollTo({ top: 0 }), 50); });
$('#qClear').onclick = () => { qIn.value = ''; $('#qClear').hidden = true; $('#qRes').innerHTML = ''; if (U.dest) clearDest(); else qIn.focus(); };
function setDest(d) { U.dest = d; U.stop = null; U.sel = null; qIn.value = d.label; $('#qClear').hidden = false; computePlan().then(() => fitOpt()); scrollPanelTop(); }
function clearDest() { U.dest = null; U.plan = null; qIn.value = ''; $('#qClear').hidden = true; render(); syncMap(); fitNear(); }

/* ================= carte (MapLibre GL + OpenFreeMap) ================= */
async function styleFor() {
  if (U.sat) {
    if (!U.styles.sat) {
      const base = await getStyle('light').catch(() => null);
      const labels = base ? base.layers.filter(l => l.type === 'symbol' && /^(highway-name|label_)/.test(l.id)).map(l => ({ ...l, paint: { ...l.paint, 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.75)', 'text-halo-width': 1.4 } })) : [];
      U.styles.sat = { version: 8, glyphs: OSM_FONTS, sources: { sat: { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 19, attribution: 'Imagerie © Esri, Maxar, Earthstar Geographics' }, ...(base ? { openmaptiles: base.sources.openmaptiles } : {}) }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }, ...labels] };
    }
    return U.styles.sat;
  }
  return getStyle(isDark() ? 'dark' : 'light');
}
async function getStyle(k) {
  if (U.styles[k]) return U.styles[k];
  const s = await fetch(STYLE_URL[k]).then(r => { if (!r.ok) throw new Error('style ' + r.status); return r.json(); });
  // plan épuré : pas de bâtiments 3D ni de points d'intérêt secondaires ; on garde les gares (repères), pas les arrêts de bus OSM
  s.layers = s.layers.filter(l => !['building-3d', 'poi_r20', 'poi_r7'].includes(l.id)).map(l => l.id === 'poi_transit' ? { ...l, filter: ['match', ['get', 'class'], ['rail'], true, false] } : l);
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
      container: 'map', style, center: cam.center, zoom: cam.zoom, minZoom: 9.5, maxZoom: 19.5,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, renderWorldCopies: false,
      attributionControl: { compact: true }, fadeDuration: 150, maxBounds: [[1.6, 48.55], [2.85, 49.15]],
    });
  } catch (e) { return mapFail('Ton navigateur ne peut pas afficher la carte (WebGL).'); }
  map.touchZoomRotate.disableRotation(); map.keyboard.disableRotation();
  map.once('load', () => { if (map.getContainer().clientWidth < 600) map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'); });
  map.on('error', ev => { if (ev && ev.error && /webgl/i.test(String(ev.error.message))) mapFail('Carte indisponible (WebGL).'); });
  map.on('style.load', () => { U.styleReady = true; addOverlays(); });
  map.on('styleimagemissing', () => { });
  bindMapEvents(map);
  busLoop();
}
function startCam() {
  const o = U.origin || HOME;
  return { center: [o.lon, o.lat], zoom: o.src === 'home' ? 14.4 : 15.2 };
}
function mapFail(msg) { const m = $('#mapMsg'); m.hidden = false; m.textContent = msg; }
const ll = p => [p[1], p[0]];
function fitPts(pts, maxZoom = 16.5) {
  const map = U.map; if (!map || !pts.length) return;
  let w = 180, s = 90, e = -180, n = -90; for (const p of pts) { w = Math.min(w, p[1]); e = Math.max(e, p[1]); s = Math.min(s, p[0]); n = Math.max(n, p[0]); }
  const c = map.getContainer(), mob = c.clientWidth < 600;
  const pad = { top: mob ? 64 : 80, bottom: mob ? 58 : 50, left: mob ? 26 : 60, right: mob ? 56 : 70 };
  if (c.clientHeight < pad.top + pad.bottom + 40) { pad.top = 20; pad.bottom = 10; }
  map.fitBounds([[w, s], [e, n]], { padding: pad, maxZoom, duration: 700 });
}
function flyTo(o, opts = {}) {
  if (!U.map || !o) return;
  const cur = U.map.getZoom();
  const zoom = opts.zoom != null ? opts.zoom : (cur < 14 ? 15.2 : cur);
  U.camLock = true;
  const dur = opts.duration != null ? opts.duration : 650;
  if (!dur) U.map.jumpTo({ center: [o.lon, o.lat], zoom });
  else U.map.easeTo({ center: [o.lon, o.lat], zoom, duration: dur });
}
function zoomToInclude(o, pts, maxZoom = 16.2) {
  const map = U.map; if (!map || !window.maplibregl?.MercatorCoordinate) return Math.min(maxZoom, map.getZoom() || 15);
  const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight;
  const padT = 70, padB = 48, padL = 36, padR = 56;
  const cs = maplibregl.MercatorCoordinate.fromLngLat({ lon: o.lon, lat: o.lat });
  let z = maxZoom;
  for (const [lat, lon] of pts) {
    const p = maplibregl.MercatorCoordinate.fromLngLat({ lon, lat });
    const dx = (p.x - cs.x) * 512, dy = (p.y - cs.y) * 512;
    const availX = (dx >= 0 ? W / 2 - padR : W / 2 - padL);
    const availY = (dy >= 0 ? H / 2 - padB : H / 2 - padT);
    if (Math.abs(dx) > 1e-12 && availX > 8) z = Math.min(z, Math.log2(availX / (Math.abs(dx) * 512)));
    if (Math.abs(dy) > 1e-12 && availY > 8) z = Math.min(z, Math.log2(availY / (Math.abs(dy) * 512)));
  }
  return Math.max(11.2, Math.min(maxZoom, z));
}
function fitNear() { if (U.origin) flyTo(U.origin, { zoom: U.map && U.map.getZoom() < 14 ? 15.2 : undefined }); }
function fitSel() {
  const g = U.near.find(g => g.key === U.sel);
  if (g && U.origin && U.map) flyTo(U.origin, { zoom: zoomToInclude(U.origin, [[g.s.lat, g.s.lon]], 17) });
}
function fitAll() { const pts = []; for (const l of S.lines) for (const M of S.data[l.short].main) pts.push(M.shape[0], M.shape.at(-1)); fitPts(pts, 13); }

const BADGE = { w: 27, h: 16, gap: 3, pad: 3, m: 2 };
function badgeImage(lines) {
  const r = 2, { w, h, gap, pad, m } = BADGE, W = m * 2 + pad * 2 + lines.length * w + (lines.length - 1) * gap, H = m * 2 + pad * 2 + h;
  const cv = document.createElement('canvas'); cv.width = W * r; cv.height = H * r; const c = cv.getContext('2d'); c.scale(r, r);
  const rr = (x, y, ww, hh, rad) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, ww, hh, rad) : c.rect(x, y, ww, hh); };
  c.shadowColor = 'rgba(0,0,0,.28)'; c.shadowBlur = 2.5; c.shadowOffsetY = .6;
  rr(m, m, W - 2 * m, H - 2 * m, 6); c.fillStyle = isDark() && !U.sat ? '#232936' : '#ffffff'; c.fill();
  c.shadowColor = 'transparent';
  c.font = '700 11px Inter, "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  lines.forEach((s, i) => { const meta = S.meta[s], x = m + pad + i * (w + gap), y = m + pad; rr(x, y, w, h, 4); c.fillStyle = meta.color; c.fill(); c.fillStyle = meta.textColor; c.fillText(s, x + w / 2, y + h / 2 + .5); });
  return { img: c.getImageData(0, 0, W * r, H * r), r };
}
function stopsGeo() {
  const near = new Map((U.places || []).map(x => [x.p, x.d]));
  return { type: 'FeatureCollection', features: nbPlaces().map((p, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { i, name: p.name, img: 'b-' + p.lines.join('-'), rank: near.has(p) ? Math.round(near.get(p)) : 5000 + i, near: near.has(p) ? 1 : 0 } })) };
}
function linesGeo() {
  const f = [];
  for (const l of S.lines) for (const M of S.data[l.short].main) f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: M.shape.map(ll) }, properties: { key: l.short + '|' + M.dir, short: l.short, color: l.color } });
  return { type: 'FeatureCollection', features: f };
}
const EMPTY = { type: 'FeatureCollection', features: [] };
function addOverlays() {
  const map = U.map; if (!map || !U.styleReady || !U.dataReady || map.getSource('stops')) return;
  const dark = isDark() && !U.sat;
  for (const combo of new Set(nbPlaces().map(p => p.lines.join('-')))) { const id = 'b-' + combo; if (map.hasImage(id)) map.removeImage(id); const b = badgeImage(combo.split('-')); map.addImage(id, b.img, { pixelRatio: b.r }); }
  map.addSource('lines', { type: 'geojson', data: linesGeo() });
  map.addSource('focus', { type: 'geojson', data: EMPTY });
  map.addSource('walk', { type: 'geojson', data: EMPTY });
  map.addSource('stops', { type: 'geojson', data: stopsGeo() });
  map.addSource('marks', { type: 'geojson', data: EMPTY });
  map.addSource('gpsacc', { type: 'geojson', data: EMPTY });
  const W = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 11, a, 15, b, 18, c];
  map.addLayer({ id: 'gpsacc', type: 'fill', source: 'gpsacc', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.14 } });
  map.addLayer({ id: 'gpsacc-ol', type: 'line', source: 'gpsacc', paint: { 'line-color': '#1a73e8', 'line-opacity': 0.35, 'line-width': 1 } });
  map.addLayer({ id: 'lines-case', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0b0e14' : '#ffffff', 'line-width': W(3.5, 7, 11), 'line-opacity': U.sat ? .5 : .9 } });
  map.addLayer({ id: 'lines', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': W(1.8, 4, 6.5), 'line-opacity': .85 } });
  map.addLayer({ id: 'focus-case', type: 'line', source: 'focus', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#0b0e14' : '#ffffff', 'line-width': W(6, 10, 15) } });
  map.addLayer({ id: 'focus', type: 'line', source: 'focus', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': W(3.5, 6.5, 10) } });
  map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': W(3, 4.5, 6), 'line-dasharray': [0.1, 1.8] } });
  map.addLayer({ id: 'stops-dot', type: 'circle', source: 'stops', minzoom: 12, paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 15, 4.5, 18, 7],
    'circle-color': dark ? '#e8ebf1' : '#ffffff', 'circle-stroke-color': dark ? '#0b0e14' : '#3c4043',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2, 18, 2.5] } });
  map.addLayer({ id: 'stops-sel', type: 'circle', source: 'stops', filter: ['==', ['get', 'i'], -1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 7, 16, 11, 18, 14], 'circle-color': 'rgba(26,115,232,.18)', 'circle-stroke-color': '#1a73e8', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'stops-lbl', type: 'symbol', source: 'stops', minzoom: 13.4, layout: {
    'icon-image': ['get', 'img'], 'icon-anchor': 'left', 'icon-offset': [6, 0], 'icon-padding': 1, 'symbol-sort-key': ['get', 'rank'],
    'text-field': ['step', ['zoom'], '', 15.6, ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5,
    'text-anchor': 'top-left', 'text-offset': [0.55, 0.95], 'text-optional': true, 'text-max-width': 11, 'text-padding': 2 },
    paint: { 'text-color': U.sat ? '#ffffff' : dark ? '#e6e9ef' : '#202124', 'text-halo-color': U.sat ? 'rgba(0,0,0,.8)' : dark ? '#0b0e14' : '#ffffff', 'text-halo-width': 1.5 } });
  map.addLayer({ id: 'stops-hit', type: 'circle', source: 'stops', minzoom: 12.5, paint: { 'circle-radius': 16, 'circle-opacity': 0 } });
  map.addLayer({ id: 'marks', type: 'circle', source: 'marks', paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 4 } });
  map.addLayer({ id: 'marks-lbl', type: 'symbol', source: 'marks', layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-allow-overlap': true }, paint: { 'text-color': dark ? '#ffffff' : '#202124', 'text-halo-color': dark ? '#0b0e14' : '#ffffff', 'text-halo-width': 2 } });
  syncMap(true);
}
function bindMapEvents(map) {
  const pick = e => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['stops-hit', 'stops-lbl'] })[0]; if (!f) return false;
    const p = nbPlaces()[f.properties.i]; if (p) openStop(p); return true;
  };
  map.on('click', e => { pick(e); });
  map.on('mousemove', e => { if (!map.getLayer('stops-hit')) return; const f = map.queryRenderedFeatures(e.point, { layers: ['stops-hit', 'stops-lbl'] }); map.getCanvas().style.cursor = f.length ? 'pointer' : ''; });
  map.on('movestart', e => {
    if (e.originalEvent) { U.followGps = false; map.getContainer().parentElement.classList.add('moving'); }
  });
  map.on('move', () => { if (!U.camLock) schedulePin(false); });
  map.on('moveend', () => {
    map.getContainer().parentElement.classList.remove('moving');
    U.camLock = false;
    schedulePin(true);
  });
}
let destMk = null, gpsMk = null;
function circleFC(lat, lon, r, n = 64) {
  const coords = [];
  const latR = r / 111320, lonR = r / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; coords.push([lon + lonR * Math.sin(a), lat + latR * Math.cos(a)]); }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }] };
}
function syncMap() {
  const map = U.map; if (!map || !U.styleReady || !map.getSource('stops')) return;
  const pin = $('#mePin');
  if (pin && U.origin) {
    pin.classList.toggle('addr', U.origin.src === 'addr');
    pin.classList.toggle('pin', U.origin.src === 'pin' || U.origin.src === 'home');
    pin.classList.toggle('gps', U.origin.src === 'gps');
  }
  const me = $('#btnMe'); if (me) me.classList.toggle('on', !!(U.followGps && U.gps));
  // cercle de précision GPS + pastille bleue quand le centre n'est plus sur soi
  if (map.getSource('gpsacc')) {
    const acc = U.gps ? Math.min(Math.max(U.gps.acc || 0, 18), 250) : 0;
    map.getSource('gpsacc').setData(U.gps && acc ? circleFC(U.gps.lat, U.gps.lon, acc) : EMPTY);
  }
  const away = U.gps && (!U.origin || U.origin.src !== 'gps' || haversine([U.origin.lat, U.origin.lon], [U.gps.lat, U.gps.lon]) > 22);
  if (away) {
    if (!gpsMk) { const el = document.createElement('div'); el.className = 'gps-dot'; el.title = 'Ta position réelle'; gpsMk = new maplibregl.Marker({ element: el }).setLngLat([U.gps.lon, U.gps.lat]).addTo(map); el.addEventListener('click', e => { e.stopPropagation(); regps(); }); }
    gpsMk.setLngLat([U.gps.lon, U.gps.lat]);
  } else if (gpsMk) { gpsMk.remove(); gpsMk = null; }
  if (U.dest) {
    if (!destMk) { const el = document.createElement('div'); el.className = 'dest-mk'; el.innerHTML = '<span>' + I.flag + '</span>'; destMk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([U.dest.lon, U.dest.lat]).addTo(map); }
    destMk.setLngLat([U.dest.lon, U.dest.lat]);
  } else if (destMk) { destMk.remove(); destMk = null; }
  map.getSource('stops').setData(stopsGeo());
  // focus : ligne choisie, trajet à pied, arrêt(s) mis en avant
  const focus = [], walk = [], marks = []; let selI = -1, dim = null;
  const places = nbPlaces();
  const placeOf = sid => places.findIndex(p => p.quays.some(q => q.sid === sid));
  if (U.stop) selI = places.findIndex(p => p.key === U.stop.key && Math.abs(p.lat - U.stop.lat) < 1e-6);
  if (U.stop && U.stop.walk?.path && U.origin) walk.push(U.stop.walk.path);
  if (!U.stop && !U.dest && U.sel) {
    const g = U.near.find(g => g.key === U.sel);
    if (g) { const M = S.data[g.short].main[g.dir]; dim = g.key; focus.push({ c: M.shape.map(ll), color: S.meta[g.short].color }); walk.push(g.walk.path || [[U.origin.lat, U.origin.lon], [g.s.lat, g.s.lon]]); selI = placeOf(g.sid); }
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
  map.setPaintProperty('lines', 'line-opacity', dim ? (dim === '-' ? .28 : ['case', ['==', ['get', 'key'], dim], .95, .28]) : .85);
  map.setPaintProperty('lines-case', 'line-opacity', dim ? .35 : (U.sat ? .5 : .9));
  U.focusLines = !U.stop && U.dest && U.plan?.opts[U.opt] ? new Set([U.plan.opts[U.opt].short + '|' + U.plan.opts[U.opt].dir]) : !U.stop && U.sel ? new Set([U.sel]) : null;
}
/* ----- le rond suit le centre de la carte : déplacer la carte = nouvel endroit ----- */
let pinT = null, pinLast = 0;
function schedulePin(final) {
  const map = U.map; if (!map) return;
  const c = map.getCenter();
  U.pinPend = { lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6) };
  clearTimeout(pinT);
  if (final) return applyPin(true);
  if (performance.now() - pinLast > 700) applyPin(false); else pinT = setTimeout(() => applyPin(false), 300);
}
function applyPin(final) {
  const pend = U.pinPend; if (!pend || !U.dataReady) return;
  if (final) U.pinPend = null;
  pinLast = performance.now();
  const { lat, lon } = pend;
  if (U.origin && haversine([lat, lon], [U.origin.lat, U.origin.lon]) < 8) {
    if (final && U.origin.src === 'pin' && U.origin.label === 'Point choisi') reverseLabel(U.origin);
    return;
  }
  let o;
  if (U.gps && haversine([lat, lon], [U.gps.lat, U.gps.lon]) < 25) o = { ...U.gps, src: 'gps' };
  else if (U.origin && U.origin.src === 'addr' && haversine([lat, lon], [U.origin.lat, U.origin.lon]) < 15) o = { ...U.origin, lat, lon };
  else {
    const last = mbGet('onde-addr');
    o = last && haversine([lat, lon], [last.lat, last.lon]) < 20 ? { ...last, src: 'addr' } : { lat, lon, label: 'Point choisi', src: 'pin' };
  }
  setOrigin(o, false, !final);
  if (final && o.src === 'pin') reverseLabel(o);
}
function regps(fly = true) {
  if (!U.gps) return locate(true);
  U.followGps = true;
  const o = { ...U.gps }; setOrigin(o, fly); reverseLabel(o);
}
async function applyStyle() {
  if (!U.map) return; let s; try { s = await styleFor(); } catch (e) { return toast('Fond de carte indisponible'); }
  U.styleReady = false; U.map.setStyle(s, { diff: false });
}

/* ----- bus en circulation (positions interpolées, sonar) ----- */
const busMk = new Map();
function busIconEl(meta, v) {
  const el = document.createElement('div'); el.className = 'bus-wrap';
  el.innerHTML = `<div class="bus-mk ${v.rt ? 'rt' : 'th'}" style="--c:${meta.color};--t:${meta.textColor}"><span class="ring"></span><span class="ring r2"></span><span class="head"></span><span class="core">${meta.short}</span></div>`;
  el.title = `Bus ${meta.short} → ${v.headsign}${v.rt ? ' (temps réel)' : ' (position estimée sur les horaires)'}`;
  return el;
}
function busLoop() {
  let last = 0;
  const tick = t => {
    requestAnimationFrame(tick);
    if (t - last < 200 || document.hidden || !U.map || !U.dataReady || !U.styleReady) return; last = t;
    const map = U.map, now = Date.now(), b = map.getBounds(), z = map.getZoom(), seen = new Set();
    const padLon = (b.getEast() - b.getWest()) * .15, padLat = (b.getNorth() - b.getSouth()) * .15;
    if (z >= 11.5) for (const l of S.lines) {
      const meta = S.meta[l.short];
      for (const { v, st } of running(l.short, now)) {
        const key = l.short + '|' + v.p.dir;
        if (U.focusLines && !U.focusLines.has(key) && U.dest) continue;
        const pos = posAt(v.p, st.dist), lon = pos.ll[1], lat = pos.ll[0];
        if (lon < b.getWest() - padLon || lon > b.getEast() + padLon || lat < b.getSouth() - padLat || lat > b.getNorth() + padLat) continue;
        const id = l.short + v.id; seen.add(id);
        let m = busMk.get(id);
        if (!m) { const el = busIconEl(meta, v); m = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map); busMk.set(id, m); m._head = el.querySelector('.head'); }
        else m.setLngLat([lon, lat]);
        const other = !!(U.focusLines && !U.focusLines.has(key));
        if (m._other !== other) { m.getElement().classList.toggle('other', other); m._other = other; }
        if (m._head) m._head.style.transform = `rotate(${pos.brg.toFixed(0)}deg)`;
      }
    }
    for (const [id, m] of busMk) if (!seen.has(id)) { m.remove(); busMk.delete(id); }
  };
  requestAnimationFrame(tick);
}
window.addEventListener('onde-rt', () => { for (const m of busMk.values()) m.remove(); busMk.clear(); render(); });

/* ================= boutons carte ================= */
$('#btnMe').onclick = () => { // recentre la carte pour placer le GPS (ou la dernière adresse) sous le rond
  if (U.gps) return regps(true);
  const addr = mbGet('onde-addr');
  if (addr) { U.followGps = false; return setOrigin({ ...addr, src: 'addr' }, true); }
  locate(true);
};
$('#btnSat').onclick = () => { U.sat = !U.sat; localStorage.setItem('onde-sat', U.sat ? '1' : '0'); $('#btnSat').setAttribute('aria-pressed', U.sat); $('#btnSat').classList.toggle('on', U.sat); applyStyle(); };
$('#btnSat').classList.toggle('on', U.sat); $('#btnSat').setAttribute('aria-pressed', U.sat);
$('#btnTheme').onclick = () => {
  const t = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = t; localStorage.setItem('onde-theme', t);
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0f1218' : '#ffffff';
  if (!U.sat) applyStyle(); else { U.styleReady = false; U.map && U.map.setStyle(U.styles.sat, { diff: false }); }
};

/* ================= démarrage ================= */
async function boot() {
  const h = location.hash; const to = /[?&]to=([^&]+)/.exec(h);
  if (h) history.replaceState(null, '', location.pathname);
  // affichage immédiat : GPS mémorisé (< 6 h), sinon le secteur Rueil / Suresnes ; le GPS réel remplace dès qu'il répond
  const lp = mbGet('onde-lastpos');
  if (lp && Date.now() - lp.t < 6 * 3600e3 && 'geolocation' in navigator) U.origin = { lat: lp.lat, lon: lp.lon, label: 'Ma position', src: 'gps', stale: true };
  else U.origin = { ...HOME };
  U.followGps = true;
  locate(); // la demande de localisation part tout de suite, pendant le chargement des horaires
  if (window.maplibregl) initMap();
  try {
    const meta = await fetch('/data/lines.json').then(r => r.json());
    S.lines = meta.lines; S.meta = Object.fromEntries(meta.lines.map(l => [l.short, l]));
    $('#footData').textContent = 'horaires du ' + meta.generated.slice(0, 10).split('-').reverse().join('/');
    await Promise.all(S.lines.map(l => getLine(l.short)));
  } catch (e) { panel.innerHTML = '<div class="empty"><b>Impossible de charger les horaires.</b><p>Vérifie ta connexion et recharge la page.</p></div>'; return; }
  U.dataReady = true;
  fetch('/api/status').then(r => r.json()).then(s => { S.status = s; }).catch(() => { });
  S.lines.forEach(l => pollRT(l.short));
  if (U.origin) setOrigin(U.origin, false); else render();
  if (U.pinPend) applyPin(true);
  addOverlays();
  if (to) { const q = decodeURIComponent(to[1]); qIn.value = q; const go = () => U.origin ? qSearch.run(q).then(hs => hs[0] && qSearch.pick(hs[0])) : setTimeout(go, 600); go(); }
  setInterval(() => { if (!document.hidden) render(); }, 5000);
  setInterval(() => { if (document.hidden) return; const sh = U.dest && U.plan ? U.plan.opts.map(o => o.short) : U.near.length ? U.near.map(g => g.short) : S.lines.map(l => l.short); [...new Set(sh)].forEach(pollRT); }, 30000);
  setInterval(() => { if (U.dest && U.plan && !U.plan.loading) { reorder(); render(); syncMap(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && U.dataReady) render(); });
}
boot();
