// Onde 92 — logique partagée entre server.js (serveur Node classique) et les fonctions Vercel (/api).
// Aucune dépendance npm. CommonJS.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');   // JSON GTFS versionnés, servis aussi en statique (/data/*)
const PRIM = 'https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable';

// ---------- heure de Paris ----------
const fmtDay = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' });
const fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const parisDay = (d = new Date()) => fmtDay.format(d);                       // YYYY-MM-DD
function parisSeconds(d = new Date()) { const [h, m, s] = fmtHM.format(d).split(':').map(Number); return (h % 24) * 3600 + m * 60 + s; }
function parisMidnightUTC(dayStr) {
  const guess = new Date(dayStr + 'T00:00:00Z');
  const off = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Paris' })) - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - off);
}
const addDay = (dayStr, n) => new Date(Date.parse(dayStr + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---------- données GTFS ----------
const dataCache = new Map(); // fichier -> objet
function readData(dir, file) {
  const f = path.join(dir || DATA_DIR, file);
  if (!dataCache.has(f)) dataCache.set(f, JSON.parse(fs.readFileSync(f, 'utf8')));
  return dataCache.get(f);
}
const clearData = () => dataCache.clear();
const loadMeta = dir => readData(dir, 'lines.json');
const loadLine = (short, dir) => readData(dir, `line-${short}.json`);

// Une ligne est « en service » si une course du jour (ou de la veille, après minuit) roule entre maintenant-5 min et maintenant+30 min.
function serviceWindows(L, day) {
  const ymd = day.replace(/-/g, ''), mid = parisMidnightUTC(day).getTime(), out = [];
  for (const [svc, , t0, dl] of L.trips) {
    if (!(L.services[svc] || []).includes(ymd)) continue;
    let end = t0; for (const d of dl) end += d;
    out.push([mid + (t0 - 1800) * 1000, mid + (end + 300) * 1000]);
  }
  return out;
}
const winCache = new Map();
function inService(short, now = Date.now(), dir) {
  const L = loadLine(short, dir), today = parisDay(new Date(now));
  for (const day of [addDay(today, -1), today]) {
    const k = (dir || '') + short + day;
    if (!winCache.has(k)) { if (winCache.size > 64) winCache.clear(); winCache.set(k, serviceWindows(L, day)); }
    if (winCache.get(k).some(([a, b]) => now >= a && now <= b)) return true;
  }
  return false;
}

// ---------- politique de cache temps réel pour le serverless (quota PRIM) ----------
// Pas d'état partagé entre instances : la borne vient du CDN (1 appel PRIM par ligne et par fenêtre s-maxage, par région de cache).
const RT_TTL_PEAK = (+process.env.RT_TTL_PEAK || 270) * 1000;      // 06:30–20:30 (Paris)
const RT_TTL_OFFPEAK = (+process.env.RT_TTL_OFFPEAK || 900) * 1000; // reste de la journée
const PEAK_FROM = 6.5 * 3600, PEAK_TO = 20.5 * 3600;
function rtTtl(now = Date.now()) { const s = parisSeconds(new Date(now)); return s >= PEAK_FROM && s < PEAK_TO ? RT_TTL_PEAK : RT_TTL_OFFPEAK; }
// Pire cas d'appels PRIM sur une journée (Paris) si chaque fenêtre de cache de chaque ligne en service est consommée.
const worstCache = new Map();
function worstCasePerDay(day = parisDay(), dir) {
  const k = (dir || '') + day; if (worstCache.has(k)) return worstCache.get(k);
  const mid = parisMidnightUTC(day).getTime(); let calls = 0;
  for (const { short } of loadMeta(dir).lines) for (let m = 0; m < 1440; m++) {
    const t = mid + m * 60e3 + 30e3;
    if (inService(short, t, dir)) calls += 60e3 / rtTtl(t);
  }
  const r = Math.round(calls); worstCache.set(k, r); return r;
}

// ---------- PRIM ----------
function normalize(siri, lineRef) {
  const out = [];
  const del = siri?.Siri?.ServiceDelivery?.EstimatedTimetableDelivery || [];
  const stopOf = c => { const sp = c.StopPointRef?.value || c.StopPointRef || ''; const m = /StopPoint:Q:(\d+)/.exec(sp); return m ? m[1] : sp; };
  for (const d of del) for (const fr of d.EstimatedJourneyVersionFrame || []) for (const j of fr.EstimatedVehicleJourney || []) {
    const lr = j.LineRef?.value || j.LineRef;
    if (lineRef && lr && lr !== lineRef) continue;
    const calls = (j.EstimatedCalls?.EstimatedCall || []).map(c => ({
      stop: stopOf(c), aa: c.AimedArrivalTime || null, ad: c.AimedDepartureTime || null,
      ea: c.ExpectedArrivalTime || null, ed: c.ExpectedDepartureTime || null,
      st: c.DepartureStatus || c.ArrivalStatus || null, at: !!c.VehicleAtStop, prox: c.ArrivalProximityText?.value || null,
    })).filter(c => c.stop);
    const rec = (j.RecordedCalls?.RecordedCall || []).map(c => ({
      stop: stopOf(c), aa: c.AimedArrivalTime || null, ad: c.AimedDepartureTime || null,
      ea: c.ActualArrivalTime || c.ExpectedArrivalTime || null, ed: c.ActualDepartureTime || c.ExpectedDepartureTime || null, st: 'recorded', at: false, rec: true,
    })).filter(c => c.stop);
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
function fetchPrim(lineRef, key) {
  return new Promise((resolve, reject) => {
    const req = https.get(PRIM + '?LineRef=' + encodeURIComponent(lineRef), { headers: { apikey: key, Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'User-Agent': 'onde92/1.0' }, timeout: 8000 }, res => {
      let s = res;
      if (res.headers['content-encoding'] === 'gzip') s = res.pipe(zlib.createGunzip());
      else if (res.headers['content-encoding'] === 'deflate') s = res.pipe(zlib.createInflate());
      const chunks = []; s.on('data', c => chunks.push(c));
      s.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error('PRIM HTTP ' + res.statusCode + ' ' + body.slice(0, 200)));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      s.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}
// Mode démo (PRIM_MOCK=1) : réponse SIRI fabriquée depuis le GTFS + retards stables.
function mockSiri(L, now = Date.now()) {
  const day = parisDay(), ymd = day.replace(/-/g, ''), mid = parisMidnightUTC(day).getTime(), journeys = [];
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

// Fabrique de proxy temps réel avec cache mémoire par ligne (par processus / instance chaude).
//  ttlMs(now)          : durée de fraîcheur du cache
//  gate(short, c, now) : {ok:true} ou {ok:false, reason, stale:bool, maxAge} — quota, hors service…
//  Renvoie {status, body, maxAge} ; maxAge = secondes restantes avant que la donnée soit périmée (pour s-maxage).
function makeRealtime({ key, mock = false, dir, ttlMs, gate, onCall, onError, fetcher = fetchPrim }) {
  const cache = {};
  const fromCache = (c, ttl, now) => ({ status: 200, body: { ...c.data, cacheAge: Math.round((now - c.at) / 1000) }, maxAge: Math.max(5, Math.round((ttl - (now - c.at)) / 1000)) });
  const theo = (reason, maxAge) => ({ status: 200, body: { mode: 'theorique', reason, journeys: [] }, maxAge });
  return async function realtime(short) {
    const k = typeof key === 'function' ? key() : key;
    let meta; try { meta = loadMeta(typeof dir === 'function' ? dir() : dir).lines.find(l => l.short === short); } catch { meta = null; }
    if (!meta) return { status: 404, body: { error: 'ligne inconnue' }, maxAge: 3600 };
    if (!k && !mock) return theo('no_key', 300);
    const now = Date.now(), ttl = ttlMs(now);
    const c = cache[short] ||= { at: 0, data: null, pending: null, lastCall: 0 };
    if (c.data && now - c.at < ttl) return fromCache(c, ttl, now);
    const g = gate ? gate(short, c, now) : { ok: true };
    if (!g.ok) return g.stale && c.data ? fromCache(c, ttl, now) : theo(g.reason, g.maxAge || 60);
    if (!c.pending) {
      c.lastCall = now; if (onCall) onCall(short);
      const L = mock && !k ? loadLine(short, typeof dir === 'function' ? dir() : dir) : null;
      c.pending = (L ? Promise.resolve(mockSiri(L)) : fetcher(meta.lineRef, k))
        .then(siri => {
          const journeys = normalize(siri, meta.lineRef);
          c.data = { mode: journeys.length ? 'temps-reel' : 'theorique', reason: journeys.length ? null : 'empty', demo: !!(mock && !k), fetchedAt: new Date().toISOString(), journeys };
          c.at = Date.now(); c.err = null;
        })
        .catch(e => { c.err = String(e.message || e).slice(0, 200); if (onError) onError(short, c.err); else console.error('[PRIM]', short, c.err); })
        .finally(() => { c.pending = null; });
    }
    await c.pending;
    if (c.data && !c.err) return fromCache(c, ttl, Date.now());
    if (c.data) return { ...fromCache(c, ttl, Date.now()), maxAge: 60 };   // ancienne donnée, on réessaie dans 1 min
    return theo('error', 60);
  };
}

// ---------- géocodage (Photon / Nominatim OSM + BAN) et itinéraire piéton (OSRM foot), sans clé ----------
// Photon (données OSM, prévu pour l'auto-complétion) et Nominatim pour commerces, écoles, gares, parcs, lieux-dits ;
// BAN pour les adresses précises en France. Aucune API Google, aucune clé.
const UA = 'Onde92/1.0 (https://onde92.vercel.app; horaires bus Hauts-de-Seine)';
const BIAS92 = { lat: 48.874, lon: 2.205 }; // Rueil — Suresnes
const BOX92 = { minLon: 2.05, minLat: 48.75, maxLon: 2.42, maxLat: 48.96 }; // Hauts-de-Seine + lisière parisienne
const extCache = new Map();
function getJSON(url, timeout = 8000) {
  const hit = extCache.get(url); if (hit && Date.now() - hit.at < 6 * 3600e3) return Promise.resolve(hit.body);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', c => b += c);
      r.on('end', () => { if (r.statusCode !== 200) return reject(new Error('HTTP ' + r.statusCode)); try { const j = JSON.parse(b); if (extCache.size > 2000) extCache.clear(); extCache.set(url, { at: Date.now(), body: j }); resolve(j); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}
let nomLock = Promise.resolve();
function nominatimGet(url, timeout = 8000) {
  // politique Nominatim : 1 req/s ; on file les appels
  const run = nomLock.then(() => getJSON(url, timeout));
  nomLock = run.then(() => new Promise(r => setTimeout(r, 1100)), () => new Promise(r => setTimeout(r, 1100)));
  return run;
}
const num = (x, lo, hi) => { const v = parseFloat(x); return isFinite(v) && v >= lo && v <= hi ? v : null; };

function osmType(key, value, fallback) {
  const k = key || '', v = value || '';
  if (k === 'shop' || v === 'supermarket' || v === 'mall' || v === 'marketplace') return 'shop';
  if (/school|college|university|kindergarten|music_school/.test(v) || k === 'amenity' && /school/.test(v)) return 'school';
  if (k === 'amenity' && /restaurant|cafe|fast_food|bar|pub|food_court|ice_cream/.test(v)) return 'food';
  if (k === 'railway' || k === 'public_transport' || /station|subway_entrance|halt|tram_stop|stop_position|aerodrome/.test(v)) return 'station';
  if (k === 'leisure' && /park|garden|playground|nature_reserve|pitch/.test(v) || k === 'landuse' && v === 'recreation_ground') return 'park';
  if (k === 'tourism' || k === 'historic' || /attraction|museum|gallery|monument|artwork|viewpoint|zoo|theme_park/.test(v)) return 'landmark';
  if (k === 'amenity' && /hospital|clinic|doctors|pharmacy|dentist/.test(v)) return 'health';
  if (k === 'amenity' && /library|theatre|cinema|community_centre|arts_centre|place_of_worship/.test(v)) return 'culture';
  if (k === 'amenity' && /townhall|courthouse|police|post_office|bank/.test(v)) return 'civic';
  if (fallback === 'house' || fallback === 'housenumber' || fallback === 'building') return 'housenumber';
  if (fallback === 'street' || fallback === 'highway' || k === 'highway') return 'street';
  if (fallback === 'city' || fallback === 'town' || fallback === 'municipality' || fallback === 'village' || fallback === 'district' || fallback === 'locality' || fallback === 'suburb') return fallback === 'city' || fallback === 'town' || fallback === 'village' || fallback === 'municipality' ? 'municipality' : 'locality';
  return fallback || 'place';
}
function fmtLabel(name, street, city) {
  const parts = [];
  if (name) parts.push(name);
  if (street && (!name || !name.includes(street))) parts.push(street);
  if (city && parts.every(p => !p.includes(city))) parts.push(city);
  return parts.join(', ') || city || name || 'Lieu';
}
function formatPhoton(f) {
  const p = f.properties || {}, g = f.geometry || {};
  const coords = g.coordinates; if (!coords || coords.length < 2) return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const city = p.city || p.town || p.village || p.district || p.locality || '';
  const name = p.name || '';
  return { label: fmtLabel(name, street, city), city, lat: coords[1], lon: coords[0], type: osmType(p.osm_key, p.osm_value, p.type), name, source: 'photon' };
}
function formatNominatim(j) {
  if (!j || j.lat == null) return null;
  const a = j.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.suburb || '';
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const name = j.name || (j.namedetails && j.namedetails.name) || '';
  const label = name || street ? fmtLabel(name, street, city) : String(j.display_name || '').replace(/, France$/, '').split(',').slice(0, 3).join(',').trim();
  return { label: label || (j.display_name || 'Lieu'), city, lat: +j.lat, lon: +j.lon, type: osmType(j.class, j.type, j.addresstype || j.type), name, source: 'nominatim' };
}
function formatBan(f) {
  const p = f.properties || {}, g = f.geometry || {};
  if (!g.coordinates) return null;
  return { label: p.label, city: p.city, lat: g.coordinates[1], lon: g.coordinates[0], type: p.type || 'housenumber', source: 'ban' };
}
function mergePlaces(...lists) {
  const out = [];
  for (const list of lists) for (const a of list || []) {
    if (!a || !isFinite(a.lat) || !isFinite(a.lon)) continue;
    if (out.some(b => Math.abs(a.lat - b.lat) < 0.00035 && Math.abs(a.lon - b.lon) < 0.00035)) continue;
    out.push(a);
  }
  return out;
}
async function photonSearch(q, bias) {
  const b = bias || BIAS92;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${b.lat}&lon=${b.lon}&limit=8&lang=fr&location_bias_scale=0.4`;
  const j = await getJSON(url);
  return (j.features || []).map(formatPhoton).filter(Boolean);
}
async function nominatimSearch(q, bias) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&accept-language=fr&countrycodes=fr&viewbox=${BOX92.minLon},${BOX92.maxLat},${BOX92.maxLon},${BOX92.minLat}&bounded=0&limit=8`;
  const j = await nominatimGet(url);
  return (Array.isArray(j) ? j : []).map(formatNominatim).filter(Boolean);
}
async function nominatimReverse(latlon) {
  const [lat, lon] = latlon;
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${(+lat).toFixed(5)}&lon=${(+lon).toFixed(5)}&format=jsonv2&addressdetails=1&accept-language=fr&zoom=18`;
  const j = await nominatimGet(url);
  const r = formatNominatim(j); return r ? [r] : [];
}
async function banSearch(q, bias) {
  const b = bias || BIAS92;
  const qs = `search/?q=${encodeURIComponent(q)}&limit=6&lat=${b.lat}&lon=${b.lon}&autocomplete=1`;
  let j; try { j = await getJSON('https://api-adresse.data.gouv.fr/' + qs); } catch (e) { j = await getJSON('https://data.geopf.fr/geocodage/' + qs.replace('/?', '?')); }
  return (j.features || []).map(formatBan).filter(Boolean);
}
async function banReverse(latlon) {
  const qs = `reverse/?lat=${latlon[0]}&lon=${latlon[1]}&limit=1`;
  let j; try { j = await getJSON('https://api-adresse.data.gouv.fr/' + qs); } catch (e) { j = await getJSON('https://data.geopf.fr/geocodage/' + qs.replace('/?', '?')); }
  return (j.features || []).map(formatBan).filter(Boolean);
}
async function geocode(q, reverse, bias) {
  if (reverse) {
    try { const r = await nominatimReverse(reverse); if (r.length) return r; } catch (e) { /* repli BAN */ }
    return banReverse(reverse);
  }
  const b = bias && isFinite(bias.lat) && isFinite(bias.lon) ? bias : BIAS92;
  let photon = [], ban = [];
  await Promise.all([
    photonSearch(q, b).then(r => { photon = r; }).catch(() => {}),
    banSearch(q, b).then(r => { ban = r; }).catch(() => {}),
  ]);
  let merged = mergePlaces(photon, ban);
  if (!merged.length) {
    try { merged = mergePlaces(await nominatimSearch(q, b), ban); } catch (e) { merged = ban; }
  }
  return merged.slice(0, 8);
}
async function walk(a, b) {
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  const j = await getJSON(url, 9000);
  const r = j.routes && j.routes[0]; if (!r) throw new Error('no route');
  return { source: 'osrm', distance: Math.round(r.distance), duration: Math.round(r.duration), path: r.geometry.coordinates.map(c => [+c[1].toFixed(6), +c[0].toFixed(6)]) };
}
// Logique HTTP commune aux deux mondes : renvoie {status, body, cache}
async function geocodeRoute(params) {
  const q = (params.get('q') || '').trim().slice(0, 200), la = num(params.get('lat'), 40, 52), lo = num(params.get('lon'), -6, 10);
  const near = (params.get('near') || '').split(',').map(Number);
  const bias = near.length === 2 && near.every(isFinite) ? { lat: near[0], lon: near[1] } : null;
  if (!q && la == null) return { status: 400, body: { error: 'q manquant' }, cache: 'no-store' };
  const reverse = !q && la != null && lo != null ? [la, lo] : null;
  try { return { status: 200, body: { results: await geocode(q, reverse, bias) }, cache: 'public, max-age=3600, s-maxage=86400' }; }
  catch (e) { return { status: 502, body: { error: 'géocodage indisponible' }, cache: 'no-store' }; }
}
async function walkRoute(params) {
  const f = (params.get('from') || '').split(',').map(Number), t = (params.get('to') || '').split(',').map(Number);
  if (f.length !== 2 || t.length !== 2 || ![...f, ...t].every(isFinite)) return { status: 400, body: { error: 'from/to = lat,lon' }, cache: 'no-store' };
  try { return { status: 200, body: await walk(f, t), cache: 'public, max-age=86400, s-maxage=86400' }; }
  catch (e) { return { status: 502, body: { error: 'itinéraire indisponible' }, cache: 'no-store' }; }
}

function sendJSON(req, res, status, body, cacheControl, extra = {}) {
  let buf = Buffer.from(JSON.stringify(body));
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cacheControl || 'no-store', ...extra };
  if (req && /gzip/.test(req.headers?.['accept-encoding'] || '') && buf.length > 1024 && !process.env.VERCEL) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = buf.length; res.writeHead(status, h); res.end(buf);
}
// Paramètres de requête, que l'on soit sous Vercel (req.query) ou Node brut.
const params = req => new URL(req.url || '/', 'http://x').searchParams;

module.exports = {
  ROOT, DATA_DIR, PRIM, parisDay, parisSeconds, parisMidnightUTC, readData, clearData, loadMeta, loadLine,
  inService, rtTtl, worstCasePerDay, RT_TTL_PEAK, RT_TTL_OFFPEAK, normalize, fetchPrim, mockSiri, makeRealtime,
  getJSON, num, geocode, walk, geocodeRoute, walkRoute, sendJSON, params,
};
