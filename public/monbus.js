/* Onde 92 — « Est-ce que j'ai mon bus ? »
   Point de départ (géolocalisation ou adresse BAN) → arrêt d'une ligne → itinéraire piéton (OSRM foot)
   → pour chacun des 3 prochains passages : tu l'as / juste / raté, avec compte à rebours. */
'use strict';
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
  const Ld = S.data[short]; const M = Ld.main[dir]; const seen = new Set(); const out = [];
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

async function viewMonBus(params) {
  setLineTheme(null); S.view = { name: 'monbus' }; document.title = "Est-ce que j'ai mon bus ? — Onde 92";
  const saved = mbGet('onde-monbus', {});
  const st = {
    origin: mbGet('onde-origin'), home: mbGet('onde-home'),
    short: params.get('l') || saved.short || null, dir: params.has('d') ? +params.get('d') : (saved.dir ?? 0),
    stop: params.get('s') || saved.stop || null, walk: null, autoStop: !params.get('s') && !saved.stop,
  };
  if (st.short && !S.meta[st.short]) st.short = null;
  const app = $('#app');
  app.innerHTML = `
  <div class="mb fade-in">
    <div class="line-head mb-head"><a class="back" href="#/" aria-label="Retour">${BACK_SVG}</a>
      <div class="line-title"><span class="eyebrow">À pied jusqu'à l'arrêt</span><h1>Est-ce que j'ai mon bus&nbsp;?</h1></div></div>
    <section class="card mb-step" id="stepFrom">
      <div class="mb-step-h"><span class="mb-num">1</span><h2>D'où pars-tu&nbsp;?</h2></div>
      <div class="mb-from">
        <div class="search mb-search">${SEARCH_SVG}<input id="addr" type="search" inputmode="search" placeholder="Ton adresse (ex. 12 rue de Suresnes, Rueil)" autocomplete="street-address" aria-label="Adresse de départ"><div class="results" id="addrRes" role="listbox"></div></div>
        <div class="mb-from-btns">
          <button class="mb-btn" id="geoBtn">${GPS_SVG}<span>Me localiser</span></button>
          <button class="mb-btn" id="homeBtn" hidden>${HOME_SVG}<span>Maison</span></button>
        </div>
      </div>
      <div class="mb-origin" id="origin"></div>
    </section>
    <section class="card mb-step" id="stepLine">
      <div class="mb-step-h"><span class="mb-num">2</span><h2>Quelle ligne&nbsp;?</h2></div>
      <div class="mb-lines" id="linePick" role="radiogroup" aria-label="Ligne"></div>
      <div class="mb-sugg" id="sugg"></div>
      <div id="dirStop"></div>
    </section>
    <section class="mb-result" id="result"></section>
    <div class="mb-edit"><span>Modifier le départ, la ligne ou l'arrêt</span></div>
  </div>`;

  /* ----- 1. Départ ----- */
  const addr = $('#addr'), res = $('#addrRes'); let tmr, seq = 0, hits = [];
  const renderHits = () => { res.innerHTML = hits.map((h, i) => `<button class="result" data-i="${i}" role="option"><span>${esc(h.label)}</span><span class="faint" style="font-size:12px">${esc(h.type === 'housenumber' ? 'adresse' : h.type === 'street' ? 'rue' : h.type === 'municipality' ? 'commune' : 'lieu')}</span></button>`).join(''); };
  addr.addEventListener('input', () => {
    clearTimeout(tmr); const q = addr.value.trim(); if (q.length < 3) { hits = []; renderHits(); return; }
    tmr = setTimeout(async () => { const my = ++seq; try { const r = await fetch('/api/geocode?q=' + encodeURIComponent(q)).then(r => r.json()); if (my !== seq) return; hits = r.results || []; if (!hits.length) res.innerHTML = '<div class="result muted">Adresse introuvable</div>'; else renderHits(); } catch (e) { res.innerHTML = '<div class="result muted">Recherche d\'adresse indisponible</div>'; } }, 250);
  });
  addr.addEventListener('keydown', e => { if (e.key === 'Enter' && hits[0]) { e.preventDefault(); setOrigin({ ...hits[0], src: 'addr' }); } if (e.key === 'Escape') { hits = []; renderHits(); } });
  res.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) setOrigin({ ...hits[+b.dataset.i], src: 'addr' }); });
  $('#geoBtn').onclick = () => {
    if (!navigator.geolocation) return toast('Géolocalisation non disponible sur cet appareil');
    const b = $('#geoBtn'); b.classList.add('busy'); b.querySelector('span').textContent = 'Localisation…';
    navigator.geolocation.getCurrentPosition(async p => {
      b.classList.remove('busy'); b.querySelector('span').textContent = 'Me localiser';
      const o = { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), label: 'Ma position', src: 'gps', acc: Math.round(p.coords.accuracy) };
      setOrigin(o);
      try { const r = await fetch(`/api/geocode?lat=${o.lat}&lon=${o.lon}`).then(r => r.json()); if (r.results?.[0] && st.origin === o) { o.label = 'Près de ' + r.results[0].label; mbSet('onde-origin', o); renderOrigin(); } } catch (e) { }
    }, err => { b.classList.remove('busy'); b.querySelector('span').textContent = 'Me localiser'; toast(err.code === 1 ? 'Autorise la localisation, ou tape ton adresse' : 'Position introuvable, tape ton adresse'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  $('#homeBtn').onclick = () => st.home && setOrigin({ ...st.home, src: 'home' });
  function setOrigin(o) {
    st.origin = o; mbSet('onde-origin', o); hits = []; renderHits(); addr.value = ''; addr.blur();
    if (st.autoStop || !st.stop) { st.stop = null; st.autoStop = true; }
    renderOrigin(); renderLines(); compute();
  }
  function renderOrigin() {
    $('#homeBtn').hidden = !st.home; const el = $('#origin'); const o = st.origin;
    if (!o) { el.innerHTML = `<p class="muted mb-hint">Tape ton adresse ou touche « Me localiser ». Rien n'est envoyé ailleurs que pour trouver l'adresse et l'itinéraire à pied.</p>`; return; }
    const isHome = st.home && Math.abs(st.home.lat - o.lat) < 1e-5 && Math.abs(st.home.lon - o.lon) < 1e-5;
    el.innerHTML = `<div class="mb-o"><span class="mb-o-ic">${isHome ? HOME_SVG : o.src === 'gps' ? GPS_SVG : WALK_SVG}</span><div class="mb-o-t"><span class="eyebrow">${isHome ? 'Maison' : 'Départ'}</span><b>${esc(o.label)}</b>${o.acc ? `<small class="faint">précision ±${o.acc} m</small>` : ''}</div>
      ${isHome ? '<button class="chip" id="unHome">Oublier Maison</button>' : '<button class="chip mb-save" id="saveHome">' + HOME_SVG + 'Enregistrer comme Maison</button>'}</div>`;
    const sh = $('#saveHome'); if (sh) sh.onclick = () => { st.home = { label: o.label, lat: o.lat, lon: o.lon }; mbSet('onde-home', st.home); toast('🏠 Adresse enregistrée comme Maison (sur cet appareil)'); renderOrigin(); };
    const uh = $('#unHome'); if (uh) uh.onclick = () => { st.home = null; mbSet('onde-home', null); toast('Maison oubliée'); renderOrigin(); };
  }

  /* ----- 2. Ligne, sens, arrêt ----- */
  function renderLines() {
    $('#linePick').innerHTML = S.lines.map(l => `<button class="mb-line ${st.short === l.short ? 'on' : ''}" role="radio" aria-checked="${st.short === l.short}" data-l="${l.short}" style="--c:${l.color};--t:${l.textColor}">
      ${badge(l)}<span class="mb-line-t">${esc((l.termini[1] || '').replace(/ - .*$/, ''))}<i>⇄</i>${esc((l.termini[0] || '').replace(/ - .*$/, ''))}</span><span class="mb-check">✓</span></button>`).join('');
    $$('.mb-line').forEach(b => b.onclick = () => { const l = b.dataset.l; if (st.short !== l) { st.short = l; st.stop = null; st.autoStop = true; } setLineTheme(S.meta[l]); renderLines(); compute(); });
    // suggestions : arrêts les plus proches sur les 4 lignes
    const sg = $('#sugg');
    if (st.origin) {
      const all = suggestAll(st.origin).slice(0, 6);
      sg.innerHTML = all.length ? `<div class="mb-sub">Arrêts les plus proches de toi</div><div class="mb-sugg-list">${all.map(x => `<button class="mb-sg ${st.short === x.short && st.stop === x.sid ? 'on' : ''}" data-l="${x.short}" data-d="${x.dir}" data-s="${x.sid}" style="--c:${S.meta[x.short].color}">${badge(S.meta[x.short], 'sm')}<span><b>${esc(x.s.name)}</b><small>→ ${esc(S.data[x.short].main[x.dir].headsign)}</small></span><em>${fmtDist(x.d)}</em></button>`).join('')}</div>` : '<div class="mb-sub">Aucun arrêt des lignes 144, 160, 244, 360 à moins de 2 km.</div>';
      $$('.mb-sg', sg).forEach(b => b.onclick = () => { st.short = b.dataset.l; st.dir = +b.dataset.d; st.stop = b.dataset.s; st.autoStop = false; setLineTheme(S.meta[st.short]); renderLines(); compute(); $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    } else sg.innerHTML = '';
    const ds = $('#dirStop');
    if (!st.short) { ds.innerHTML = ''; return; }
    const Ld = S.data[st.short];
    if (st.stop && !lineDirStops(st.short, st.dir).some(x => x.sid === st.stop)) { const other = lineDirStops(st.short, 1 - st.dir).some(x => x.sid === st.stop); if (other) st.dir = 1 - st.dir; else st.stop = null; }
    if (!st.stop && st.origin) { st.stop = nearestStops(st.origin, st.short, st.dir, 1)[0]?.sid || null; st.autoStop = true; }
    const list = lineDirStops(st.short, st.dir);
    const near = st.origin ? nearestStops(st.origin, st.short, st.dir, 3) : [];
    ds.innerHTML = `
      <div class="mb-sub">Direction</div>
      <div class="seg mb-dir" role="tablist">${[0, 1].map(d => `<button class="${st.dir === d ? 'on' : ''}" data-d="${d}">→ ${esc(Ld.main[d].headsign)}</button>`).join('')}</div>
      <div class="mb-sub">Arrêt</div>
      ${near.length ? `<div class="mb-near">${near.map(x => `<button class="chip ${x.sid === st.stop ? 'on' : ''}" data-s="${x.sid}">${esc(x.s.name)} · ${fmtDist(x.d)}</button>`).join('')}</div>` : ''}
      <div class="select mb-select"><select id="stopSel" aria-label="Arrêt"><option value="">Choisir un arrêt…</option>${list.map(x => `<option value="${x.sid}" ${x.sid === st.stop ? 'selected' : ''}>${esc(x.s.name)}${st.origin ? ' — ' + fmtDist(haversine([st.origin.lat, st.origin.lon], [x.s.lat, x.s.lon])) : ''}</option>`).join('')}</select></div>`;
    $$('.mb-dir button', ds).forEach(b => b.onclick = () => { st.dir = +b.dataset.d; st.stop = null; renderLines(); compute(); });
    $$('.mb-near .chip', ds).forEach(b => b.onclick = () => { st.stop = b.dataset.s; st.autoStop = false; renderLines(); compute(); });
    $('#stopSel').onchange = e => { st.stop = e.target.value || null; st.autoStop = false; renderLines(); compute(); };
  }

  /* ----- 3. Résultat ----- */
  let map = null, layers = null, busLayer = null, busMk = new Map(), deps = [], walkFor = null;
  const persist = () => { mbSet('onde-monbus', { short: st.short, dir: st.dir, stop: st.stop }); const p = new URLSearchParams(); if (st.short) p.set('l', st.short); if (st.short) p.set('d', st.dir); if (st.stop) p.set('s', st.stop); history.replaceState(null, '', '#/monbus' + (p.toString() ? '?' + p : '')); };
  async function compute() {
    persist(); const out = $('#result'); $('.mb').classList.toggle('ready', !!(st.origin && st.short && st.stop));
    if (!st.origin || !st.short || !st.stop) {
      out.innerHTML = `<div class="card mb-empty"><div class="mb-sonar"><i></i><i></i><i></i>${BUS_SVG}</div><p>${!st.origin ? 'Indique ton point de départ' : !st.short ? 'Choisis ta ligne (ou un arrêt proche ci-dessus)' : 'Choisis ton arrêt'} et on te dit si tu as le prochain bus.</p></div>`;
      if (map) { map.remove(); map = null; } return;
    }
    const Ld = S.data[st.short], meta = S.meta[st.short], stop = Ld.stops[st.stop];
    if (!map) {
      out.innerHTML = `<div class="card mb-verdict" id="verdict"></div>
        <div class="card mb-map-card"><div id="mbMap"></div><div class="map-legend"><span class="chip" id="walkChip">${WALK_SVG}<span>…</span></span></div></div>
        <div class="card mb-list"><div class="mb-list-h"><span class="eyebrow">Prochains passages à <span id="stopName"></span></span><span id="modeTag"></span></div><div id="depList"></div></div>`;
      map = L.map('mbMap', MAP_OPTS); L.control.zoom({ position: 'bottomright' }).addTo(map);
      addTiles(map);
      layers = L.layerGroup().addTo(map); busLayer = L.layerGroup().addTo(map);
      S.cleanup.push(() => { if (map) { map.remove(); map = null; } });
    }
    setLineTheme(meta);
    $('#stopName').textContent = stop.name;
    layers.clearLayers(); busLayer.clearLayers(); busMk.clear();
    const M = Ld.main[st.dir]; const ll = M.shape.map(p => [p[0], p[1]]);
    L.polyline(ll, { color: meta.color, weight: 10, opacity: .14, interactive: false }).addTo(layers);
    L.polyline(ll, { color: meta.color, weight: 4, opacity: .8, interactive: false }).addTo(layers);
    const homeIcon = L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: `<div class="mb-home-mk"><i></i>${HOME_SVG}</div>` });
    L.marker([st.origin.lat, st.origin.lon], { icon: homeIcon, zIndexOffset: 2000 }).addTo(layers);
    const stopIcon = L.divIcon({ className: '', iconSize: [46, 30], iconAnchor: [23, 34], html: `<div class="mb-stop-mk" style="--c:${meta.color};--t:${meta.textColor}">${esc(meta.short)}</div>` });
    L.marker([stop.lat, stop.lon], { icon: stopIcon, zIndexOffset: 1900 }).bindTooltip(esc(stop.name), { className: 'stop-tip', direction: 'top', offset: [0, -34] }).addTo(layers);
    map.fitBounds(L.latLngBounds([[st.origin.lat, st.origin.lon], [stop.lat, stop.lon]]), { padding: [48, 48], maxZoom: 17 });
    setTimeout(() => map && map.invalidateSize(), 60);
    $('#verdict')._h = null; $('#verdict').innerHTML = `<div class="mb-v-load"><div class="mb-sonar sm"><i></i><i></i>${WALK_SVG}</div>Calcul du trajet à pied…</div>`;
    const key = st.origin.lat + ',' + st.origin.lon + '>' + st.stop; walkFor = key;
    const w = await walkRoute(st.origin, stop); if (walkFor !== key || !map) return;
    st.walk = w;
    L.polyline(w.path, { color: cssVar('--bg2') || '#000', weight: 8, opacity: .9, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(layers);
    L.polyline(w.path, { color: cssVar('--live') || '#3CF0B0', weight: 4.5, opacity: 1, dashArray: '1 9', lineCap: 'round', lineJoin: 'round', interactive: false, className: 'mb-walk' }).addTo(layers);
    map.flyToBounds(L.latLngBounds(w.path), { padding: [48, 48], maxZoom: 17, duration: .8 });
    $('#walkChip span').textContent = `${fmtDur(w.duration)} à pied · ${fmtDist(w.distance)}${w.source === 'approx' ? ' (estimé)' : ''}`;
    refreshDeps(); tick(true);
    pollRT(st.short).then(() => { refreshDeps(); tick(true); });
  }
  function refreshDeps() {
    if (!st.stop || !st.short) return; const now = Date.now();
    deps = departures(st.short, st.stop, now, 12).filter(d => d.dir === st.dir || d.dir == null);
  }
  function tick(full) {
    if (!st.walk || !$('#verdict')) return;
    const now = Date.now(); const W = st.walk.duration; const meta = S.meta[st.short];
    const list = deps.filter(d => d.t > now - 20e3).map(d => ({ ...d, v: verdict(d.t, W, now) }));
    const shown = list.slice(0, 3); const firstOk = list.find(d => d.v.k !== 'miss');
    const live = isLive(st.short);
    $('#modeTag').innerHTML = live ? '<span class="tag rt"><i class="dot-live"></i>Temps réel</span>' : '<span class="tag th">Horaires théoriques</span>';
    // verdict principal
    let vh;
    if (!list.length) vh = `<div class="mb-v miss"><div class="mb-v-t"><span class="eyebrow">Pas de bus</span><h3>Aucun passage prévu prochainement</h3><p>Consulte la fiche horaire de la ligne.</p></div></div>`;
    else if (!firstOk) vh = `<div class="mb-v miss"><div class="mb-v-t"><span class="eyebrow">Raté</span><h3>Pas de bus attrapable dans l'immédiat</h3></div></div>`;
    else {
      const d = firstOk, k = d.v.k;
      vh = `<div class="mb-v ${k}"><div class="mb-ring"><i></i><i></i><i></i>${k === 'ok' && d.v.left >= 60e3 ? `<b>${Math.floor(d.v.left / 60000)}</b><small>min</small>` : `<b class="go">GO</b><small>${k === 'ok' ? 'maintenant' : 'vite !'}</small>`}</div>
        <div class="mb-v-t"><span class="eyebrow">${k === 'ok' ? "Oui, tu l'as" : 'Juste !'} ${badge(meta, 'sm')}</span>
        <h3>${k === 'ok' ? (d.v.left < 60e3 ? 'Pars maintenant' : `Pars dans ${fmtCount(d.v.left)}`) : 'Pars maintenant en pressant le pas'}</h3>
        <p>Bus de <b>${fmtHM(d.t)}</b>${d.rt ? ' <span class="tag rt"><i class="dot-live"></i>temps réel</span>' : ' <span class="tag th">prévu</span>'} → ${esc(d.headsign)}. ${k === 'ok' ? `Départ au plus tard à <b>${fmtHM(d.v.leaveBy)}</b>, ${fmtDur(W)} de marche, arrivée 1 min avant le bus.` : `En marchant vite, ${fmtDur(W * MB.HURRY)} jusqu'à l'arrêt.`}</p></div></div>`;
    }
    const vEl = $('#verdict'); if (vEl._h !== vh) { vEl.innerHTML = vh; vEl._h = vh; }
    const lh = shown.map((d, i) => {
      const k = d.v.k; const nextOk = list.slice(list.indexOf(d) + 1).find(x => x.v.k !== 'miss');
      const msg = k === 'ok' ? `Tu l'as — pars avant ${fmtHM(d.v.leaveBy)}` : k === 'tight' ? 'Juste — pars maintenant en pressant le pas' : `Raté — prochain à ${nextOk ? fmtHM(nextOk.t) : '—'}`;
      const cd = k === 'ok' ? (d.v.left < 60e3 ? 'Pars maintenant' : `Pars dans ${fmtCount(d.v.left)}`) : k === 'tight' ? `Bus dans ${fmtCount(d.t - now)}` : `Bus dans ${fmtCount(d.t - now)}`;
      return `<div class="mb-dep ${k}"><div class="mb-dep-time"><b>${fmtHM(d.t)}</b>${finTag(d)}${d.rt ? '<span class="tag rt"><i class="dot-live"></i>Live</span>' : '<span class="tag th">Prévu</span>'}${d.rt && d.aim && Math.abs(d.delay) >= 60e3 ? `<s>${fmtHM(d.aim)}</s>` : ''}</div>
        <div class="mb-dep-m"><span class="mb-dep-v"><i></i>${msg}</span><small>${cd} · → ${esc(d.headsign)}${d.prox ? ' · ' + esc(d.prox) : ''}</small></div>
        <div class="mb-dep-bar"><span style="width:${Math.max(4, Math.min(100, 100 - (d.t - now) / 600 / 30)).toFixed(1)}%"></span></div></div>`;
    }).join('') || '<div class="muted" style="padding:14px 0">Aucun passage prévu prochainement.</div>';
    const lEl = $('#depList'); if (lEl._h !== lh) { lEl.innerHTML = lh; lEl._h = lh; }
    // bus en approche sur la carte
    if (map) {
      const seen = new Set();
      for (const { v, st: s } of running(st.short, now)) {
        if (v.p.dir !== st.dir) continue; seen.add(v.id); const pos = posAt(v.p, s.dist);
        let m = busMk.get(v.id); if (!m) { m = L.marker(pos.ll, { icon: busIcon(meta, v), keyboard: false, interactive: false }).addTo(busLayer); busMk.set(v.id, m); }
        m.setLatLng(pos.ll); const h = m.getElement()?.querySelector('.head'); if (h) h.style.transform = `rotate(${pos.brg}deg)`;
      }
      for (const [id, m] of busMk) if (!seen.has(id)) { m.remove(); busMk.delete(id); }
    }
  }
  renderOrigin(); renderLines(); compute();
  every(1000, () => tick());
  every(10000, () => refreshDeps());
  every(30000, () => st.short && pollRT(st.short).then(refreshDeps));
  const onTheme = () => { if (map) { map.remove(); map = null; compute(); } };
  window.addEventListener('onde-theme', onTheme); S.cleanup.push(() => window.removeEventListener('onde-theme', onTheme));
}
