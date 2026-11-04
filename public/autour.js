/* Onde 92 — « Autour de moi » (arrêts et bus proches) & « On va où ? » (itinéraire sur les lignes 144 · 160 · 244 · 360).
   Tout est calculé dans le navigateur à partir des horaires GTFS déjà chargés (line-*.json) et du temps réel PRIM
   déjà mis en cache par ligne (/api/rt/:ligne) : aucun appel PRIM supplémentaire. Marche : /api/walk (OSRM piéton). */
'use strict';
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
// Recherche combinée : arrêts des 4 lignes (instantané) + adresses/lieux BAN.
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
  const render = () => {
    box.innerHTML = hits.map((h, i) => `<button class="result ${i === sel ? 'sel' : ''}" data-i="${i}" role="option" type="button"><span class="nb-r-ic ${h.kind === 'stop' ? 'stop' : ''}">${h.kind === 'stop' ? BUS_SVG : PIN_SVG}</span><span class="nb-r-t">${esc(h.label)}<small>${h.kind === 'stop' ? 'Arrêt' : esc(h.type === 'housenumber' ? 'Adresse' : h.type === 'street' ? 'Rue' : h.type === 'municipality' ? 'Commune' : 'Lieu')}${h.city && h.kind !== 'stop' && !String(h.label).includes(h.city) ? ' · ' + esc(h.city) : ''}</small></span>${h.lines ? `<span class="rb">${h.lines.map(s => badge(S.meta[s], 'sm')).join('')}</span>` : ''}</button>`).join('');
  };
  const run = async q => {
    const my = ++seq; const stops = nbStopHits(q); hits = stops; sel = -1; render();
    if (q.length < 3) return hits;
    try {
      const r = await fetch('/api/geocode?q=' + encodeURIComponent(q)).then(r => r.json()); if (my !== seq) return hits;
      // On remonte les adresses de la commune tapée, puis celles proches du réseau (les 4 lignes).
      const nq = norm(q), pl = nbPlaces();
      const rank = a => (a.city && nq.includes(norm(a.city)) ? 0 : 2) + (pl.some(p => Math.abs(p.lat - a.lat) < .03 && haversine([p.lat, p.lon], [a.lat, a.lon]) < 2000) ? 0 : 1);
      const addr = (r.results || []).filter(a => !stops.some(s => haversine([s.lat, s.lon], [a.lat, a.lon]) < 60)).map((a, i) => ({ ...a, kind: 'addr', _r: rank(a) * 100 + i })).sort((a, b) => a._r - b._r);
      hits = [...stops.slice(0, addr.length ? 3 : 4), ...addr].slice(0, 7); render();
      if (!hits.length) box.innerHTML = '<div class="result muted">Aucun résultat</div>';
    } catch (e) { if (!hits.length) box.innerHTML = '<div class="result muted">Recherche d\'adresse indisponible</div>'; }
    return hits;
  };
  input.addEventListener('input', () => { clearTimeout(tmr); const q = input.value.trim(); if (!q) { hits = []; render(); return; } tmr = setTimeout(() => run(q), 220); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[Math.max(0, sel)]; if (h) pick(h); else run(input.value.trim()).then(hs => hs[0] && pick(hs[0])); }
    else if (e.key === 'Escape') { hits = []; render(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) { box.innerHTML = ''; } }, 180));
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

/* ---------- vue ---------- */
async function viewAutour(params) {
  setLineTheme(null); S.view = { name: 'autour' }; document.title = 'Autour de moi — Onde 92';
  const st = {
    origin: mbGet('onde-origin'), home: mbGet('onde-home'), dest: mbGet('onde-dest'),
    tab: 'near', term: mbGet('onde-nb-term', ''), sel: null, opt: 0,
    near: [], places: [], R: NB.R, plan: null, planKey: null, ready: false,
  };
  if (params.get('to') || (st.dest && params.get('v') === 'go')) st.tab = 'go';
  const app = $('#app');
  app.innerHTML = `
  <div class="nb fade-in">
    <div class="line-head nb-head"><a class="back" href="#/" aria-label="Retour">${BACK_SVG}</a>
      <div class="line-title"><span class="eyebrow">Autour de moi · On va où ?</span><h1>Tes bus, <span>à deux pas.</span></h1></div></div>
    <div class="nb-grid">
      <section class="card nb-plan" aria-label="Départ et destination">
        <div class="nb-field from">
          <span class="nb-dot from" aria-hidden="true"></span>
          <div class="nb-in"><label for="nbFrom">Départ</label><input id="nbFrom" type="search" inputmode="search" autocomplete="off" placeholder="Ton adresse, ou « Me localiser »"><div class="results" id="nbFromRes" role="listbox"></div></div>
          <button class="nb-ibtn gps" id="nbGeo" type="button" aria-label="Me localiser" title="Me localiser">${GPS_SVG}</button>
          <button class="nb-ibtn" id="nbHome" type="button" aria-label="Maison" title="Maison" hidden>${HOME_SVG}</button>
        </div>
        <div class="nb-link" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="nb-field to">
          <span class="nb-dot to" aria-hidden="true"></span>
          <div class="nb-in"><label for="nbTo">On va où&nbsp;?</label><input id="nbTo" type="search" inputmode="search" autocomplete="off" placeholder="Adresse, lieu ou arrêt (ex. La Défense)"><div class="results" id="nbToRes" role="listbox"></div></div>
          <button class="nb-ibtn" id="nbClear" type="button" aria-label="Effacer la destination" title="Effacer" hidden>${X_SVG}</button>
        </div>
      </section>
      <div class="card map-wrap nb-map">
        <div id="nbMap" aria-label="Carte des arrêts et des bus"></div>
        <div class="map-fab"><button class="icon-btn" id="nbFit" aria-label="Recentrer" title="Recentrer">${TARGET_SVG}</button><button class="icon-btn gps" id="nbGeo2" aria-label="Me localiser" title="Me localiser">${GPS_SVG}</button></div>
        <div class="map-legend" id="nbLegend"></div>
      </div>
      <div class="nb-body">
        <div class="seg tabs nb-tabs" role="tablist"><button data-tab="near" role="tab">${PIN_SVG}Bus proches</button><button data-tab="go" role="tab">${FLAG_SVG}On va où&nbsp;?</button></div>
        <div id="nbBody"></div>
      </div>
    </div>
  </div>`;
  const body = $('#nbBody');

  /* ----- carte ----- */
  const map = L.map('nbMap', { ...MAP_OPTS, minZoom: 11 }); L.control.zoom({ position: 'bottomright' }).addTo(map);
  const tiles = addTiles(map);
  const linesLayer = L.layerGroup().addTo(map), farLayer = L.layerGroup(), nearLayer = L.layerGroup().addTo(map), focusLayer = L.layerGroup().addTo(map), meLayer = L.layerGroup().addTo(map), busLayer = L.layerGroup().addTo(map);
  const canvas = L.canvas({ padding: 0.3 });
  S.cleanup.push(() => map.remove());
  const allBounds = L.latLngBounds(S.lines.flatMap(l => S.data[l.short].main.flatMap(M => [[M.shape[0][0], M.shape[0][1]], [M.shape.at(-1)[0], M.shape.at(-1)[1]]])));
  map.fitBounds(allBounds, { padding: [20, 20] });
  setTimeout(() => map.invalidateSize(), 60);
  function drawLines() {
    linesLayer.clearLayers(); farLayer.clearLayers();
    const light = isLight();
    for (const l of S.lines) for (const M of S.data[l.short].main) {
      const ll = M.shape.map(p => [p[0], p[1]]);
      if (light) L.polyline(ll, { color: '#1a2233', weight: 5, opacity: .14, interactive: false, renderer: canvas }).addTo(linesLayer);
      L.polyline(ll, { color: l.color, weight: 3, opacity: light ? .75 : .55, interactive: false, renderer: canvas, lineCap: 'round', lineJoin: 'round' }).addTo(linesLayer);
    }
    for (const p of nbPlaces()) {
      const c = S.meta[p.lines[0]].color;
      L.circleMarker([p.lat, p.lon], { renderer: canvas, radius: 3.5, weight: 2, color: light ? '#1a2233' : c, fillColor: cssVar('--bg2'), fillOpacity: 1, opacity: .8 })
        .bindTooltip(`${esc(p.name)}`, { className: 'stop-tip', direction: 'top', offset: [0, -4] })
        .on('click', () => { map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 16.5), { duration: .7 }); placePopup(p); }).addTo(farLayer);
    }
    syncZoom();
  }
  function syncZoom() { // désencombrement : petits points des arrêts lointains dès le zoom 14, noms des arrêts proches dès 15,5
    const z = map.getZoom();
    if (z >= 14 && !map.hasLayer(farLayer)) farLayer.addTo(map); else if (z < 14 && map.hasLayer(farLayer)) farLayer.remove();
    map.getContainer().classList.toggle('z-hi', z >= 15.5); map.getContainer().classList.toggle('z-lo', z < 13.5);
  }
  map.on('zoomend', syncZoom);
  drawLines();
  const onTheme = () => { tiles.refresh(); drawLines(); drawNear(); drawFocus(); };
  window.addEventListener('onde-theme', onTheme); S.cleanup.push(() => window.removeEventListener('onde-theme', onTheme));
  const fly = (b, opt = {}) => { if (b.isValid && !b.isValid()) return; const m = innerWidth < 600; map.flyToBounds(b, { paddingTopLeft: m ? [30, 56] : [56, 64], paddingBottomRight: m ? [62, 30] : [70, 48], maxZoom: 17.25, duration: .9, ...opt }); };
  function placePopup(p) {
    const now = Date.now(); const rows = [];
    for (const q of p.quays) for (const d of departures(q.short, q.sid, now, 3)) rows.push({ ...d, short: q.short });
    rows.sort((a, b) => a.t - b.t);
    L.popup({ offset: [0, -6], autoPan: true, autoPanPadding: [30, 30], className: 'nb-popup' }).setLatLng([p.lat, p.lon]).setContent(`<div class="pop"><h4>${esc(p.name)}</h4><div style="display:flex;gap:6px;margin-bottom:6px">${p.lines.map(s => badge(S.meta[s], 'sm')).join('')}</div>${rows.slice(0, 4).map(d => `<div class="dep">${badge(S.meta[d.short], 'sm')}<span class="dest">→ ${esc(d.headsign)}</span>${whenFin(d, now)}</div>`).join('') || '<div class="muted">Pas de passage prévu</div>'}<a class="chip" style="margin-top:8px" href="#/arret/${encodeURIComponent(p.key)}">Voir l'arrêt</a></div>`).openOn(map);
  }
  const iconMe = () => L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: `<div class="mb-home-mk nb-me"><i></i>${st.origin && st.home && Math.abs(st.home.lat - st.origin.lat) < 1e-5 && Math.abs(st.home.lon - st.origin.lon) < 1e-5 ? HOME_SVG : '<b></b>'}</div>` });
  const iconDest = () => L.divIcon({ className: '', iconSize: [34, 42], iconAnchor: [17, 40], html: `<div class="nb-dest-mk">${FLAG_SVG}</div>` });
  function drawMe() {
    meLayer.clearLayers();
    if (st.origin) {
      if (st.tab === 'near') L.circle([st.origin.lat, st.origin.lon], { radius: st.R, color: cssVar('--live'), weight: 1.5, opacity: .55, dashArray: '4 7', fillColor: cssVar('--live'), fillOpacity: .045, interactive: false }).addTo(meLayer);
      L.marker([st.origin.lat, st.origin.lon], { icon: iconMe(), zIndexOffset: 3000, keyboard: false }).bindTooltip(esc(st.origin.label || 'Départ'), { className: 'stop-tip', direction: 'top', offset: [0, -18] }).addTo(meLayer);
    }
    if (st.dest) L.marker([st.dest.lat, st.dest.lon], { icon: iconDest(), zIndexOffset: 3000, keyboard: false }).bindTooltip(esc(st.dest.label), { className: 'stop-tip', direction: 'top', offset: [0, -40] }).addTo(meLayer);
  }
  function drawNear() { // marqueurs « pastille » des arrêts proches (couleurs des lignes, nom au zoom fort)
    nearLayer.clearLayers(); if (st.tab !== 'near') return;
    for (const p of st.places) {
      const on = st.sel && p.quays.some(q => q.sid === st.sel.sid);
      const ic = L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0], html: `<div class="nb-pl ${on ? 'on' : ''}"><span class="nb-pl-d">${p.lines.map(s => `<i style="--c:${S.meta[s].color};--t:${S.meta[s].textColor}">${s}</i>`).join('')}</span><b>${esc(p.name)}</b></div>` });
      L.marker([p.lat, p.lon], { icon: ic, zIndexOffset: on ? 2500 : 1500, keyboard: false, title: p.name }).on('click', () => {
        const g = st.near.find(g => p.quays.some(q => q.sid === g.sid) && (!st.term || S.data[g.short].main[g.dir].headsign === st.term)) || st.near.find(g => p.quays.some(q => q.sid === g.sid));
        if (g) selectRow(g.short + '|' + g.dir, true); else placePopup(p);
      }).addTo(nearLayer);
    }
  }
  let focusSig = '';
  function drawFocus() {
    focusLayer.clearLayers(); focusSig = '';
    const walkLine = (path, cls = '') => { L.polyline(path, { color: cssVar('--bg2') || '#000', weight: 8, opacity: .9, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(focusLayer); L.polyline(path, { color: cssVar('--live'), weight: 4.5, opacity: 1, dashArray: '1 9', lineCap: 'round', lineJoin: 'round', interactive: false, className: 'mb-walk ' + cls }).addTo(focusLayer); };
    const stopPin = (s, meta, label, outline) => L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', iconSize: [46, 30], iconAnchor: [23, 34], html: `<div class="mb-stop-mk ${outline ? 'out' : ''}" style="--c:${meta.color};--t:${meta.textColor}">${esc(meta.short)}</div>` }), zIndexOffset: 2800 }).bindTooltip(esc(label), { className: 'stop-tip', direction: 'top', offset: [0, -34], permanent: innerWidth > 600 }).addTo(focusLayer);
    if (st.tab === 'near' && st.sel && st.origin) {
      const g = st.near.find(g => g.short + '|' + g.dir === st.sel.key); if (!g) return;
      const meta = S.meta[g.short], M = S.data[g.short].main[g.dir];
      const ll = M.shape.map(p => [p[0], p[1]]);
      L.polyline(ll, { color: meta.color, weight: 14, opacity: .16, interactive: false, lineCap: 'round' }).addTo(focusLayer);
      L.polyline(ll, { color: meta.color, weight: 5, opacity: .95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(focusLayer);
      walkLine(g.walk.path || [[st.origin.lat, st.origin.lon], [g.s.lat, g.s.lon]]);
      stopPin(g.s, meta, g.s.name);
      focusSig = 'n' + g.short + g.dir;
    }
    if (st.tab === 'go' && st.plan && st.plan.opts[st.opt]) {
      const op = st.plan.opts[st.opt], meta = S.meta[op.short], P = op.P;
      const d0 = P.dist[op.a.k], d1 = P.dist[op.b.k];
      const seg = [posAt(P, d0).ll, ...P.shape.filter(p => p[2] > d0 && p[2] < d1).map(p => [p[0], p[1]]), posAt(P, d1).ll];
      L.polyline(P.shape.map(p => [p[0], p[1]]), { color: meta.color, weight: 3, opacity: .35, dashArray: '4 8', interactive: false }).addTo(focusLayer);
      L.polyline(seg, { color: meta.color, weight: 16, opacity: .2, interactive: false, lineCap: 'round' }).addTo(focusLayer);
      if (isLight()) L.polyline(seg, { color: '#1a2233', weight: 9, opacity: .5, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(focusLayer);
      L.polyline(seg, { color: meta.color, weight: 6, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(focusLayer);
      const Ld = S.data[op.short];
      for (let k = op.a.k + 1; k < op.b.k; k++) { const s = Ld.stops[P.stops[k]]; L.circleMarker([s.lat, s.lon], { radius: 4, weight: 2.5, color: isLight() ? '#1a2233' : meta.color, fillColor: cssVar('--bg2'), fillOpacity: 1 }).bindTooltip(esc(s.name), { className: 'stop-tip', direction: 'top', offset: [0, -4] }).addTo(focusLayer); }
      if (st.origin) walkLine(op.walkA.path || [[st.origin.lat, st.origin.lon], [op.a.s.lat, op.a.s.lon]]);
      if (op.b.d > 0) walkLine(op.walkB.path || [[op.b.s.lat, op.b.s.lon], [st.dest.lat, st.dest.lon]]);
      stopPin(op.a.s, meta, 'Montée · ' + op.a.s.name); stopPin(op.b.s, meta, 'Descente · ' + op.b.s.name, true);
      focusSig = 'g' + op.short + op.dir;
    }
  }
  // bus en circulation (temps réel sinon théorique), seulement ceux visibles, sonar conservé
  const busMk = new Map(); let lastBus = 0;
  {
    const stop = loop(() => {
      const t = performance.now(); if (t - lastBus < 90) return; lastBus = t;
      const now = Date.now(), bb = map.getBounds().pad(0.25), seen = new Set();
      let shorts, focus = null;
      if (st.tab === 'go' && st.plan?.opts[st.opt]) { const op = st.plan.opts[st.opt]; shorts = [op.short]; focus = op.short + '|' + op.dir; }
      else { shorts = st.near.length ? [...new Set(st.near.map(g => g.short))] : S.lines.map(l => l.short); focus = st.sel?.key || null; }
      for (const sh of shorts) { const meta = S.meta[sh];
        for (const { v, st: s } of running(sh, now)) {
          const key = sh + '|' + v.p.dir; if (st.tab === 'go' && key !== focus) continue;
          const pos = posAt(v.p, s.dist); if (!bb.contains(pos.ll)) continue;
          const id = sh + v.id; seen.add(id); const cls = focus && key !== focus ? 'other' : '';
          let m = busMk.get(id);
          if (!m) { m = L.marker(pos.ll, { icon: busIcon(meta, v, cls), keyboard: false, zIndexOffset: cls ? 500 : 1200, title: `Bus ${sh} → ${v.headsign}` }).addTo(busLayer); m._cls = cls; busMk.set(id, m); }
          if (m._cls !== cls) { m.setIcon(busIcon(meta, v, cls)); m._cls = cls; m.setZIndexOffset(cls ? 500 : 1200); }
          m.setLatLng(pos.ll); const h = m.getElement()?.querySelector('.head'); if (h) h.style.transform = `rotate(${pos.brg}deg)`;
        }
      }
      for (const [id, m] of busMk) if (!seen.has(id)) { m.remove(); busMk.delete(id); }
    });
    S.cleanup.push(stop);
  }
  const onRt = () => { for (const m of busMk.values()) m.remove(); busMk.clear(); refresh(true); };
  window.addEventListener('onde-rt', onRt); S.cleanup.push(() => window.removeEventListener('onde-rt', onRt));

  /* ----- départ / arrivée ----- */
  const fromIn = $('#nbFrom'), toIn = $('#nbTo');
  const setFromLabel = () => { fromIn.value = st.origin ? st.origin.label : ''; $('#nbHome').hidden = !st.home; };
  const setToLabel = () => { toIn.value = st.dest ? st.dest.label : ''; $('#nbClear').hidden = !st.dest; };
  nbSearch(fromIn, $('#nbFromRes'), o => setOrigin({ ...o, src: 'addr' }));
  const toSearch = nbSearch(toIn, $('#nbToRes'), d => setDest(d));
  fromIn.addEventListener('focus', () => fromIn.select()); toIn.addEventListener('focus', () => toIn.select());
  fromIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== fromIn) fromIn.value = st.origin ? st.origin.label : fromIn.value; }, 250));
  function setOrigin(o) {
    st.origin = o; mbSet('onde-origin', o); st.sel = null; setFromLabel(); computeNear(); if (st.dest) computePlan(); else refresh(true);
    if (st.tab === 'near') fly(L.latLngBounds([[o.lat, o.lon], ...st.places.slice(0, 6).map(p => [p.lat, p.lon])]).pad(0.05));
  }
  function setDest(d) {
    st.dest = d; mbSet('onde-dest', d); setToLabel(); st.tab = 'go'; st.opt = 0; computePlan();
  }
  $('#nbClear').onclick = () => { st.dest = null; mbSet('onde-dest', null); st.plan = null; setToLabel(); st.tab = 'near'; refresh(true); if (st.origin) fly(L.latLngBounds([[st.origin.lat, st.origin.lon], ...st.places.slice(0, 6).map(p => [p.lat, p.lon])])); };
  $('#nbHome').onclick = () => st.home && setOrigin({ ...st.home, src: 'home' });
  const geo = () => {
    if (!navigator.geolocation) return toast('Géolocalisation non disponible sur cet appareil');
    const bs = [$('#nbGeo'), $('#nbGeo2')]; bs.forEach(b => b.classList.add('busy'));
    navigator.geolocation.getCurrentPosition(async p => {
      bs.forEach(b => b.classList.remove('busy'));
      const o = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), label: 'Ma position', src: 'gps', acc: Math.round(p.coords.accuracy) };
      setOrigin(o);
      try { const r = await fetch(`/api/geocode?lat=${o.lat}&lon=${o.lon}`).then(r => r.json()); if (r.results?.[0] && st.origin === o) { o.label = 'Près de ' + r.results[0].label; mbSet('onde-origin', o); setFromLabel(); } } catch (e) { }
    }, err => { bs.forEach(b => b.classList.remove('busy')); toast(err.code === 1 ? 'Autorise la localisation, ou tape ton adresse' : 'Position introuvable, tape ton adresse'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  $('#nbGeo').onclick = geo; $('#nbGeo2').onclick = geo;
  $('#nbFit').onclick = () => {
    if (st.tab === 'go' && st.plan?.opts[st.opt]) return fitOpt();
    if (st.sel) return fitSel();
    if (st.origin) return fly(L.latLngBounds([[st.origin.lat, st.origin.lon], ...st.places.slice(0, 8).map(p => [p.lat, p.lon])]));
    fly(allBounds);
  };
  $$('.nb-tabs button').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; refresh(true); if (st.tab === 'go') { if (st.plan?.opts.length) fitOpt(); else if (!st.dest) setTimeout(() => toIn.focus(), 50); } else if (st.sel) fitSel(); else $('#nbFit').click(); });

  /* ----- bus proches ----- */
  function computeNear() {
    st.near = []; st.places = []; if (!st.origin) return;
    const o = [st.origin.lat, st.origin.lon];
    const cand = nbQuays().map(q => ({ ...q, d: haversine(o, [q.s.lat, q.s.lon]) }));
    st.R = NB.R; let within = cand.filter(q => q.d <= st.R);
    if (!within.length) { st.R = NB.R_MAX; within = cand.filter(q => q.d <= st.R); }
    const best = new Map();
    for (const q of within) { const k = q.short + '|' + q.dir; if (!best.has(k) || best.get(k).d > q.d) best.set(k, q); }
    st.near = [...best.values()].map(q => ({ ...q, key: q.short + '|' + q.dir, walk: { duration: q.d * 1.3 / MB.SPEED, distance: q.d * 1.3, source: 'approx' } }));
    st.places = nbPlaces().map(p => ({ ...p, d: haversine(o, [p.lat, p.lon]) })).filter(p => p.d <= st.R).map(p => ({ ...p, walk: { duration: p.d * 1.3 / MB.SPEED, distance: p.d * 1.3, source: 'approx' } }));
    sortNear();
    // itinéraires piétons réels (OSRM), arrêt par arrêt, puis re-tri par temps de marche
    const key = o.join(); const sids = [...new Map([...st.near.map(g => [g.sid, g.s]), ...st.places.flatMap(p => p.quays.map(q => [q.sid, q.s]))]).entries()]
      .sort((a, b) => haversine(o, [a[1].lat, a[1].lon]) - haversine(o, [b[1].lat, b[1].lon])).slice(0, 16);
    let pending = sids.length, i = 0;
    const next = async () => {
      while (i < sids.length) { const [sid, s] = sids[i++];
        const w = await walkRoute(st.origin, s); if (!st.origin || [st.origin.lat, st.origin.lon].join() !== key) return;
        for (const g of st.near) if (g.sid === sid) g.walk = w;
        for (const p of st.places) if (p.quays.some(q => q.sid === sid) && (p.walk.source === 'approx' || w.duration < p.walk.duration)) p.walk = w;
        if (--pending === 0 || pending % 4 === 0) { sortNear(); refresh(true); }
      }
    };
    for (let c = 0; c < 4; c++) next();
  }
  function sortNear() { st.near.sort((a, b) => a.walk.duration - b.walk.duration); st.places.sort((a, b) => a.walk.duration - b.walk.duration); }
  function selectRow(key, fromMap) {
    st.sel = st.sel?.key === key && !fromMap ? null : { key, sid: st.near.find(g => g.key === key)?.sid };
    refresh(true); if (st.sel) fitSel(); else drawFocus();
    if (fromMap && st.sel) $(`.nb-row[data-key="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function fitSel() { const g = st.near.find(g => g.key === st.sel?.key); if (!g || !st.origin) return; fly(L.latLngBounds([[st.origin.lat, st.origin.lon], [g.s.lat, g.s.lon], ...(g.walk.path || [])]), { maxZoom: 17.5 }); }
  function nearHTML(now) {
    if (!st.origin) return `<div class="card nb-empty"><div class="mb-sonar"><i></i><i></i><i></i>${PIN_SVG}</div><div><h3>Où es-tu&nbsp;?</h3><p>Tape ton adresse ou touche <b>Me localiser</b> : on te montre les arrêts des lignes 144, 160, 244 et 360 autour de toi, les prochains bus et si tu as le temps de les attraper.</p><div class="nb-empty-btns"><button class="mb-btn" data-act="geo">${GPS_SVG}<span>Me localiser</span></button>${st.home ? `<button class="mb-btn" data-act="home">${HOME_SVG}<span>Maison</span></button>` : ''}</div></div></div>`;
    if (!st.near.length) return `<div class="card nb-empty"><div class="mb-sonar"><i></i><i></i><i></i>${PIN_SVG}</div><div><h3>Aucun arrêt à moins de ${fmtDist(NB.R_MAX)}</h3><p>Les lignes 144, 160, 244 et 360 ne passent pas près de ce point. Essaie une autre adresse, ou regarde les lignes sur la carte.</p></div></div>`;
    const terms = [...new Set(st.near.map(g => S.data[g.short].main[g.dir].headsign))];
    if (st.term && !terms.includes(st.term)) st.term = '';
    const groups = st.near.filter(g => !st.term || S.data[g.short].main[g.dir].headsign === st.term);
    const byLine = new Map(); for (const g of groups) { if (!byLine.has(g.short)) byLine.set(g.short, []); byLine.get(g.short).push(g); }
    const live = [...byLine.keys()].some(isLive);
    return `
      <div class="nb-sec-h"><span class="eyebrow">Arrêts à moins de ${fmtDist(st.R)}</span><span class="faint">triés par temps de marche</span></div>
      <div class="nb-stops">${st.places.slice(0, 10).map(p => `<button class="nb-stop" data-place="${esc(p.key)}|${p.lat.toFixed(5)}"><span class="nb-stop-l">${p.lines.map(s => `<i style="--c:${S.meta[s].color}"></i>`).join('')}</span><b>${esc(p.name)}</b><small>${WALK_SVG}${fmtDur(p.walk.duration)} · ${fmtDist(p.walk.distance)}</small></button>`).join('')}</div>
      <div class="nb-sec-h"><span class="eyebrow">Prochains bus</span>${live ? '<span class="tag rt"><i class="dot-live"></i>Temps réel</span>' : '<span class="tag th">Horaires prévus</span>'}</div>
      <div class="nb-terms" role="radiogroup" aria-label="Direction"><span class="nb-terms-l">Je vais vers</span><button class="chip ${!st.term ? 'on' : ''}" data-term="">Toutes</button>${terms.map(t => `<button class="chip ${st.term === t ? 'on' : ''}" data-term="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="nb-lines">${[...byLine.entries()].map(([sh, gs]) => { const meta = S.meta[sh];
        return `<div class="card nb-line fade-in" style="--c:${meta.color};--t:${meta.textColor}">
          <div class="nb-line-h">${badge(meta)}<span class="nb-line-n">${esc((meta.termini[1] || '').replace(/ - .*$/, ''))} <i>⇄</i> ${esc((meta.termini[0] || '').replace(/ - .*$/, ''))}</span><a class="chip" href="#/ligne/${sh}">Ligne</a></div>
          ${gs.map(g => rowHTML(g, now)).join('')}</div>`; }).join('')}</div>
      <p class="nb-note"><span class="tag rt"><i class="dot-live"></i>Live</span> heure estimée par IDFM (PRIM) · <span class="tag th">Prévu</span> horaire théorique GTFS · ${FIN_TAG} dernier bus de la soirée. Marche : itinéraire piéton OSRM, marge 1 min à l'arrêt.</p>`;
  }
  function rowHTML(g, now) {
    const Ld = S.data[g.short], M = Ld.main[g.dir], W = g.walk.duration;
    const ds = departures(g.short, g.sid, now, 14).filter(d => d.dir === g.dir && d.t > now - 20e3);
    const on = st.sel?.key === g.key;
    const a = ds[0], b = ds[1];
    const va = a && nbVerdict(a, W, now), vb = b && nbVerdict(b, W, now);
    const more = on ? ds.slice(0, 5).map(d => { const v = nbVerdict(d, W, now); return `<div class="nb-mr ${v.k}"><span class="nb-mr-t"><b>${fmtHM(d.t)}</b>${finTag(d)}</span>${srcTag(d)}<span class="nb-mr-v"><i></i>${v.txt}</span><span class="nb-mr-m">${d.t - now < 60e3 ? '<1' : nbMins(d.t, now)} min</span></div>`; }).join('') : '';
    return `<div class="nb-row ${on ? 'on' : ''} ${va ? va.k : 'none'}" data-key="${g.key}" role="button" tabindex="0" aria-expanded="${on}">
      <div class="nb-row-a"><span class="nb-to">→ ${esc(M.headsign)}</span><small>${WALK_SVG}<b>${fmtDur(W)}</b> à pied · ${esc(g.s.name)} · ${fmtDist(g.walk.distance)}${g.walk.source === 'approx' ? ' (est.)' : ''}</small></div>
      <div class="nb-row-w">${a ? `<span class="nb-min ${a.rt ? 'rt' : ''}">${nbWhen(a, now)}</span>${srcTag(a)}${finTag(a)}` : '<span class="nb-min none">—</span>'}</div>
      <div class="nb-row-v">${a ? `<span class="vpill ${va.k}"><i></i>${va.txt}</span>` : '<span class="vpill miss"><i></i>Plus de bus prévu</span>'}${b ? `<span class="nb-then">puis <b>${fmtHM(b.t)}</b>${b.fin ? ' ' + FIN_TAG : ''}${nbMins(b.t, now) < 60 ? ' · ' + nbMins(b.t, now) + ' min' : ''} · <span class="vdot ${vb.k}"></span>${vb.short}</span>` : a ? '<span class="nb-then">puis : plus de bus</span>' : ''}</div>
      ${on ? `<div class="nb-more">${more}<a class="chip" href="#/monbus?l=${g.short}&d=${g.dir}&s=${g.sid}">Compte à rebours détaillé →</a></div>` : ''}
    </div>`;
  }

  /* ----- on va où ----- */
  async function computePlan() {
    refresh(true);
    if (!st.origin || !st.dest) { st.plan = null; refresh(true); if (st.dest) fly(L.latLngBounds([[st.dest.lat, st.dest.lon]]).pad(0.01), { maxZoom: 15 }); return; }
    const O = st.origin, D = st.dest, key = [O.lat, O.lon, D.lat, D.lon].join(); st.planKey = key;
    const direct = haversine([O.lat, O.lon], [D.lat, D.lon]);
    const opts = nbPlan(O, D);
    st.plan = { opts: opts.slice(0, 4), direct, walkDirect: direct <= 2500 ? { duration: direct * 1.3 / MB.SPEED, distance: direct * 1.3, source: 'approx' } : null, loading: true };
    st.opt = 0; reorder(); refresh(true); fitOpt();
    const jobs = [];
    for (const op of st.plan.opts) {
      jobs.push(walkRoute(O, op.a.s).then(w => { op.walkA = w; }));
      if (op.b.d > 0) jobs.push(walkRoute({ lat: op.b.s.lat, lon: op.b.s.lon }, { lat: D.lat, lon: D.lon }).then(w => { op.walkB = w; }));
    }
    if (st.plan.walkDirect) jobs.push(walkRoute(O, { lat: D.lat, lon: D.lon }).then(w => { if (st.plan) st.plan.walkDirect = w; }));
    await Promise.all(jobs); if (st.planKey !== key || !st.plan) return;
    st.plan.loading = false; reorder(); refresh(true); fitOpt();
    st.plan.opts.forEach(op => pollRT(op.short));
  }
  function evalOpt(op, now) {
    const deps = nbOptDeps(op, now).map(d => ({ ...d, v: nbVerdict(d, op.walkA.duration, now) }));
    const catchable = deps.filter(d => d.v.k !== 'miss');
    const first = catchable[0] || null;
    return { deps, first, arrive: first ? first.arr + op.walkB.duration * 1000 : null };
  }
  function reorder() {
    if (!st.plan) return; const now = Date.now(), cur = st.plan.opts[st.opt];
    for (const op of st.plan.opts) op._arr = evalOpt(op, now).arrive ?? Infinity;
    st.plan.opts.sort((a, b) => a._arr - b._arr || a.cost - b.cost);
    st.opt = Math.max(0, st.plan.opts.indexOf(cur));
  }
  function fitOpt() {
    const op = st.plan?.opts[st.opt]; if (!op) { if (st.origin && st.dest) fly(L.latLngBounds([[st.origin.lat, st.origin.lon], [st.dest.lat, st.dest.lon]])); return; }
    fly(L.latLngBounds([[st.origin.lat, st.origin.lon], [st.dest.lat, st.dest.lon], [op.a.s.lat, op.a.s.lon], [op.b.s.lat, op.b.s.lon], ...(op.walkA.path || []), ...(op.walkB.path || [])]), { maxZoom: 16.5 });
  }
  function goHTML(now) {
    if (!st.dest) return `<div class="card nb-empty"><div class="mb-sonar"><i></i><i></i><i></i>${FLAG_SVG}</div><div><h3>On va où&nbsp;?</h3><p>Tape une adresse, un lieu ou un arrêt dans « On va où ? ». On cherche la ligne (144, 160, 244 ou 360) qui t'y emmène : l'arrêt où monter, la direction, l'arrêt où descendre et le temps de trajet.</p><div class="nb-empty-btns">${['La Défense', 'Nanterre Préfecture', 'Place de la Paix, Suresnes', 'Rueil-Malmaison RER'].map(x => `<button class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div></div></div>`;
    if (!st.origin) return `<div class="card nb-empty"><div class="mb-sonar"><i></i><i></i><i></i>${PIN_SVG}</div><div><h3>Et tu pars d'où&nbsp;?</h3><p>Indique ton point de départ (adresse ou <b>Me localiser</b>) pour trouver le bus jusqu'à <b>${esc(st.dest.label)}</b>.</p><div class="nb-empty-btns"><button class="mb-btn" data-act="geo">${GPS_SVG}<span>Me localiser</span></button>${st.home ? `<button class="mb-btn" data-act="home">${HOME_SVG}<span>Maison</span></button>` : ''}</div></div></div>`;
    const P = st.plan; if (!P) return '';
    const wd = P.walkDirect;
    const walkCard = wd ? `<div class="card nb-walkonly"><span class="nb-wo-ic">${WALK_SVG}</span><div><b>${fmtDur(wd.duration)} à pied</b><small>${fmtDist(wd.distance)} en marchant directement${wd.source === 'approx' ? ' (estimé)' : ''}</small></div></div>` : '';
    if (!P.opts.length) return `<div class="nb-sec-h"><span class="eyebrow">Vers ${esc(st.dest.label)}</span></div>
      <div class="card nb-none"><div class="nb-none-ic">${BUS_SVG}</div><div><h3>Aucune de nos lignes ne fait ce trajet</h3><p>Les lignes 144, 160, 244 et 360 n'ont pas d'arrêt à moins de ${fmtDist(NB.R_GO)} à la fois de ton départ et de ta destination, dans le bon sens. Il faudra une autre ligne (ou une correspondance) : vérifie sur le calculateur d'Île-de-France Mobilités.</p></div></div>${walkCard}`;
    return `<div class="nb-sec-h"><span class="eyebrow">Vers ${esc(st.dest.label)}</span><span class="faint">${P.loading ? 'calcul des trajets à pied…' : P.opts.length + ' possibilité' + (P.opts.length > 1 ? 's' : '')}</span></div>
      <div class="nb-opts">${P.opts.map((op, i) => optHTML(op, i, now)).join('')}</div>${walkCard}
      <p class="nb-note">Temps de trajet en bus : horaires GTFS de la course (arrêt de montée → arrêt de descente). Départs <span class="tag rt"><i class="dot-live"></i>Live</span> = estimation IDFM temps réel, <span class="tag th">Prévu</span> = horaire théorique. ${FIN_TAG} = dernier bus de la soirée.</p>`;
  }
  function optHTML(op, i, now) {
    const meta = S.meta[op.short], Ld = S.data[op.short], M = Ld.main[op.dir], on = i === st.opt;
    const ev = evalOpt(op, now), f = ev.first, deps = ev.deps;
    const shown = f ? [f, ...deps.filter(d => d.t > f.t).slice(0, 1)] : deps.slice(0, 2);
    const total = ev.arrive ? Math.round((ev.arrive - now) / 60000) : null;
    const ride = f ? f.ride : op.ride, nstops = f ? f.stops : op.b.k - op.a.k;
    const slow = st.plan.walkDirect && ev.arrive && st.plan.walkDirect.duration * 1000 + now <= ev.arrive;
    return `<div class="card nb-opt ${on ? 'on' : ''}" data-opt="${i}" style="--c:${meta.color};--t:${meta.textColor}" role="button" tabindex="0" aria-pressed="${on}">
      <div class="nb-opt-h">${badge(meta)}<div class="nb-opt-d"><span class="eyebrow">Direction</span><b>${esc(M.headsign)}</b></div>
        <div class="nb-opt-tot">${total != null ? `<b>${total}<small>min</small></b><span>arrivée ~${fmtHM(ev.arrive)}</span>` : '<b class="none">—</b><span>plus de bus</span>'}</div></div>
      ${slow ? `<div class="nb-opt-warn">${WALK_SVG}Aussi rapide à pied (${fmtDur(st.plan.walkDirect.duration)})</div>` : ''}
      <ol class="nb-steps">
        <li class="walk"><span class="nb-st-ic">${WALK_SVG}</span><div><b>${fmtDur(op.walkA.duration)} à pied</b> jusqu'à l'arrêt <b>${esc(op.a.s.name)}</b><small>${fmtDist(op.walkA.distance)}${op.walkA.source === 'approx' ? ' (estimé)' : ''}</small></div></li>
        <li class="bus"><span class="nb-st-ic">${BUS_SVG}</span><div><b>Monte dans le ${esc(op.short)}</b> direction ${esc(M.headsign)}
          <div class="nb-deps">${shown.length ? shown.map((d, j) => `<div class="nb-dp ${d.v.k}"><span class="nb-dp-t"><b>${fmtHM(d.t)}</b>${finTag(d)}</span><span class="nb-dp-m">${d.t - now < 60e3 ? '<1' : nbMins(d.t, now)} min ${srcTag(d)}</span><span class="vpill ${d.v.k}"><i></i>${j === 0 ? d.v.txt : d.v.short}</span></div>`).join('') : '<div class="muted" style="font-size:13px">Plus de départ prévu aujourd\'hui vers cet arrêt.</div>'}</div>
          <small>~${Math.max(1, Math.round(ride / 60))} min de trajet · ${nstops} arrêt${nstops > 1 ? 's' : ''}${f && f.approx ? ' (durée habituelle)' : ''}</small></div></li>
        <li class="off"><span class="nb-st-ic">${FLAG_SVG}</span><div>Descends à <b>${esc(op.b.s.name)}</b>${f ? `<small>vers ${fmtHM(f.arr)}</small>` : ''}</div></li>
        ${op.b.d > 0 ? `<li class="walk"><span class="nb-st-ic">${WALK_SVG}</span><div><b>${fmtDur(op.walkB.duration)} à pied</b> jusqu'à l'arrivée<small>${fmtDist(op.walkB.distance)}${op.walkB.source === 'approx' ? ' (estimé)' : ''}</small></div></li>` : ''}
      </ol></div>`;
  }

  /* ----- rendu ----- */
  let lastHTML = '';
  function refresh(full) {
    const now = Date.now();
    $$('.nb-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === st.tab));
    const h = st.tab === 'near' ? nearHTML(now) : goHTML(now);
    if (h !== lastHTML) { body.innerHTML = h; lastHTML = h; }
    if (full) { drawMe(); drawNear(); drawFocus(); }
    else { const want = st.tab === 'near' && st.sel ? 'n' + st.sel.key.replace('|', '') : st.tab === 'go' && st.plan?.opts[st.opt] ? 'g' + st.plan.opts[st.opt].short + st.plan.opts[st.opt].dir : ''; if (want !== focusSig) drawFocus(); }
    const lg = $('#nbLegend');
    if (lg) lg.innerHTML = st.tab === 'go' && st.plan?.opts[st.opt] ? `<span class="chip">${badge(S.meta[st.plan.opts[st.opt].short], 'sm')}<span>Ton trajet</span></span>` : st.origin && st.near.length ? `<span class="chip"><span class="tag ${st.near.some(g => isLive(g.short)) ? 'rt' : 'th'}">${st.near.some(g => isLive(g.short)) ? 'Temps réel' : 'Théorique'}</span><span>${st.places.length} arrêt${st.places.length > 1 ? 's' : ''} à moins de ${fmtDist(st.R)}</span></span>` : '';
    const u = new URLSearchParams(); if (st.tab === 'go') u.set('v', 'go');
    history.replaceState(null, '', '#/autour' + (u.toString() ? '?' + u : ''));
  }
  body.addEventListener('click', e => {
    const row = e.target.closest('.nb-row'); if (row && !e.target.closest('a')) return selectRow(row.dataset.key);
    const tb = e.target.closest('[data-term]'); if (tb) { st.term = tb.dataset.term; mbSet('onde-nb-term', st.term); if (st.sel && !st.near.some(g => g.key === st.sel.key && (!st.term || S.data[g.short].main[g.dir].headsign === st.term))) st.sel = null; return refresh(true); }
    const pl = e.target.closest('[data-place]'); if (pl) { const [k, la] = pl.dataset.place.split('|'); const p = st.places.find(p => p.key === k && p.lat.toFixed(5) === la); if (p) { map.flyTo([p.lat, p.lon], 17.25, { duration: .8 }); setTimeout(() => placePopup(p), 850); if (innerWidth <= 920) $('.nb-map').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } return; }
    const op = e.target.closest('.nb-opt'); if (op && !e.target.closest('a')) { st.opt = +op.dataset.opt; refresh(true); fitOpt(); return; }
    const ex = e.target.closest('[data-ex]'); if (ex) { toIn.value = ex.dataset.ex; toSearch.run(ex.dataset.ex).then(hs => hs[0] && toSearch.pick(hs[0])); return; }
    const act = e.target.closest('[data-act]'); if (act) { if (act.dataset.act === 'geo') geo(); else if (st.home) setOrigin({ ...st.home, src: 'home' }); }
  });
  body.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && (e.target.classList.contains('nb-opt') || e.target.classList.contains('nb-row'))) { e.preventDefault(); e.target.click(); } });

  setFromLabel(); setToLabel();
  computeNear();
  if (params.get('to')) { const q = params.get('to'); toIn.value = q; toSearch.run(q).then(hs => { if (hs[0]) toSearch.pick(hs[0]); else refresh(true); }); }
  else if (st.dest && st.tab === 'go') computePlan();
  refresh(true);
  if (st.origin && st.tab === 'near') setTimeout(() => fly(L.latLngBounds([[st.origin.lat, st.origin.lon], ...st.places.slice(0, 6).map(p => [p.lat, p.lon])]).pad(0.05)), 250);
  every(1000, () => refresh(false));
  every(30000, () => { const sh = st.tab === 'go' && st.plan ? st.plan.opts.map(o => o.short) : [...new Set(st.near.map(g => g.short))]; [...new Set(sh)].forEach(pollRT); });
  every(60000, () => { if (st.tab === 'go' && st.plan && !st.plan.loading) { reorder(); refresh(false); } });
}
