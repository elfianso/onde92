/* Prochain — horaires & suivi en direct des bus 144 · 160 · 244 · 360 */
// Pages « lignes » (ancienne interface) : nécessite core.js.
'use strict';

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
  setLineTheme(null); S.view = { name: 'home' }; document.title = 'Prochain — Bus 144 · 160 · 244 · 360 en direct';
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
  document.title = `Bus ${short} — Prochain`;
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
  const name = hits[0].s.name; document.title = `${name} — Prochain`;
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
