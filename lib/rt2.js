// Temps réel « tout réseau » :
//  - Île-de-France : PRIM « Prochains passages — requête unitaire » (stop-monitoring) par zone d'arrêt :
//    UN appel renvoie toutes les lignes (bus, tram, métro, RER, Transilien) qui passent à cet arrêt.
//    Quota PRIM par défaut : 1 000 appels/jour (séparé du quota « requête ligne » des 4 lignes historiques).
//    → cache mémoire + CDN par zone (120 s en journée, 300 s sinon), budget journalier par instance, repli « Prévu ».
//  - Réseaux GTFS-RT (Ilévia, SNCF…) : flux TripUpdates complet décodé, résumé et mis en cache 30-60 s (pas de clé, pas de quota connu).
'use strict';
const https = require('https'), zlib = require('zlib');
const { decodeFeed } = require('./gtfsrt');
const core = require('./core');
const NETS = require('../scripts/networks.json').networks;

// ---------- PRIM stop-monitoring ----------
const SM_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=';
const SM_BUDGET = +process.env.PRIM_SM_DAILY_BUDGET || 950;
const SM_TTL_PEAK = (+process.env.SM_TTL_PEAK || 120) * 1000, SM_TTL_OFF = (+process.env.SM_TTL_OFFPEAK || 300) * 1000;
const smTtl = (now = Date.now()) => { const s = core.parisSeconds(new Date(now)); return s >= 6.5 * 3600 && s < 20.5 * 3600 ? SM_TTL_PEAK : SM_TTL_OFF; };
const sm = { day: null, used: 0, errors: 0, lastError: null, cache: new Map() };
function getBuf(url, headers = {}, timeout = 9000, hops = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Prochain/2.0 (+https://onde92.vercel.app)', 'Accept-Encoding': 'gzip, deflate', ...headers }, timeout }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops) { res.resume(); return resolve(getBuf(new URL(res.headers.location, url).href, headers, timeout, hops - 1)); }
      let s = res; const enc = res.headers['content-encoding'];
      if (enc === 'gzip') s = res.pipe(zlib.createGunzip()); else if (enc === 'deflate') s = res.pipe(zlib.createInflate());
      const chunks = []; s.on('data', c => chunks.push(c)); s.on('error', reject);
      s.on('end', () => { const b = Buffer.concat(chunks); if (res.statusCode !== 200) { const e = new Error('HTTP ' + res.statusCode + ' ' + b.toString('utf8', 0, 160)); e.status = res.statusCode; return reject(e); } resolve(b); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}
const qid = v => { const s = (v && (v.value || v)) || ''; const m = /:Q:(\d+)/.exec(s) || /:SP:(\d+)/.exec(s); return m ? m[1] : String(s); };
const lineId = v => { const s = (v && (v.value || v)) || ''; const m = /Line::(C\d+)/.exec(s); return m ? m[1] : s; };
function normalizeSM(j) {
  const out = [];
  for (const d of j?.Siri?.ServiceDelivery?.StopMonitoringDelivery || []) for (const v of d.MonitoredStopVisit || []) {
    const mvj = v.MonitoredVehicleJourney || {}, c = mvj.MonitoredCall || {};
    const t = c.ExpectedDepartureTime || c.ExpectedArrivalTime || c.AimedDepartureTime || c.AimedArrivalTime; if (!t) continue;
    out.push([qid(v.MonitoringRef), lineId(mvj.LineRef), qid(mvj.DestinationRef), (mvj.DestinationName?.[0]?.value) || (c.DestinationDisplay?.[0]?.value) || '',
      t, c.AimedDepartureTime || c.AimedArrivalTime || null, /cancel/i.test(c.DepartureStatus || c.ArrivalStatus || '') ? 1 : 0, c.VehicleAtStop ? 1 : 0]);
  }
  return out;
}
async function stopMonitoring(area, { key = (process.env.PRIM_API_KEY || '').trim(), fetcher } = {}) {
  const now = Date.now(), ttl = smTtl(now), day = core.parisDay();
  if (sm.day !== day) { sm.day = day; sm.used = 0; sm.errors = 0; }
  if (!key) return { status: 200, body: { mode: 'theorique', reason: 'no_key', visits: [] }, maxAge: 600 };
  const c = sm.cache.get(area);
  const fresh = c && c.data && now - c.at < (c.ttl || ttl);
  if (fresh) return { status: 200, body: { ...c.data, cacheAge: Math.round((now - c.at) / 1000) }, maxAge: Math.max(5, Math.round(((c.ttl || ttl) - (now - c.at)) / 1000)) };
  if (sm.used >= SM_BUDGET) return { status: 200, body: c?.data ? { ...c.data, stale: true } : { mode: 'theorique', reason: 'budget', visits: [] }, maxAge: 900 };
  let entry = c; if (!entry) { if (sm.cache.size > 3000) sm.cache.clear(); sm.cache.set(area, entry = { at: 0, data: null, pending: null }); }
  if (!entry.pending) {
    sm.used++;
    entry.pending = (fetcher ? fetcher(area) : getBuf(SM_URL + encodeURIComponent(`STIF:StopArea:SP:${area}:`), { apikey: key, Accept: 'application/json' }).then(b => JSON.parse(b.toString('utf8'))))
      .then(j => { const visits = normalizeSM(j); entry.data = { mode: visits.length ? 'temps-reel' : 'theorique', reason: visits.length ? null : 'empty', area, fetchedAt: new Date().toISOString(), visits }; entry.at = Date.now(); entry.ttl = visits.length ? ttl : Math.max(ttl, 600e3); })
      .catch(e => { sm.errors++; sm.lastError = String(e.message).slice(0, 160); const perm = e.status === 400 || e.status === 404; entry.data = { mode: 'theorique', reason: perm ? 'hors-perimetre' : 'error', area, visits: [] }; entry.at = Date.now(); entry.ttl = perm ? 6 * 3600e3 : 60e3; })
      .finally(() => { entry.pending = null; });
  }
  await entry.pending;
  return { status: 200, body: entry.data, maxAge: Math.max(5, Math.round((entry.ttl - (Date.now() - entry.at)) / 1000)) };
}
const smStatus = () => ({ day: sm.day, usedThisInstance: sm.used, dailyBudgetPerInstance: SM_BUDGET, ttlNowSec: smTtl() / 1000, errors: sm.errors, lastError: sm.lastError, cachedAreas: sm.cache.size });

// ---------- GTFS-RT ----------
const rtc = new Map();
const TRIPKEY = { full: s => s, split: s => s.split(':')[0], index: s => s };
async function gtfsrt(netId) {
  const net = NETS.find(n => n.id === netId && n.rt && n.rt.type === 'gtfsrt');
  if (!net) return { status: 404, body: { error: 'réseau sans GTFS-RT' }, maxAge: 3600 };
  const ttl = (net.rt.ttl || 30) * 1000, now = Date.now();
  let c = rtc.get(netId); if (!c) rtc.set(netId, c = { at: 0, data: null, pending: null });
  if (c.data && now - c.at < ttl) return { status: 200, body: c.data, maxAge: Math.max(5, Math.round((ttl - (now - c.at)) / 1000)) };
  if (!c.pending) c.pending = getBuf(net.rt.url, { Accept: 'application/x-protobuf' }, 12000).then(buf => {
    const f = decodeFeed(buf), tk = TRIPKEY[net.tripKey] || TRIPKEY.full, trips = [];
    for (const tu of f.tripUpdates) {
      if (!tu.trip || !tu.trip.trip_id || tu.trip.rel === 3) continue; // annulée : on la laisse au théorique (le flux SNCF l'indique aussi par arrêt)
      const u = tu.stu.filter(s => s.stop_id && s.rel !== 1).map(s => { const e = s.dep || s.arr || {}; return [s.stop_id, e.time || null, e.delay != null ? e.delay : null]; }).filter(x => x[1] || x[2] != null);
      if (u.length) trips.push([tk(tu.trip.trip_id), tu.trip.start_date || null, u]);
    }
    c.data = { mode: trips.length ? 'temps-reel' : 'theorique', net: netId, feedTime: f.timestamp ? new Date(f.timestamp * 1000).toISOString() : null, fetchedAt: new Date().toISOString(), trips };
    c.at = Date.now(); c.err = null;
  }).catch(e => { c.err = String(e.message).slice(0, 160); if (!c.data) { c.data = { mode: 'theorique', reason: 'error', net: netId, trips: [] }; c.at = Date.now() - ttl + 30e3; } }).finally(() => { c.pending = null; });
  await c.pending;
  return { status: 200, body: c.data, maxAge: Math.max(5, Math.round((ttl - (Date.now() - c.at)) / 1000)) };
}
const rtStatus = () => Object.fromEntries([...rtc].map(([k, c]) => [k, { at: c.at ? new Date(c.at).toISOString() : null, trips: c.data?.trips?.length || 0, err: c.err || null }]));
module.exports = { stopMonitoring, smStatus, gtfsrt, rtStatus, normalizeSM, smTtl };
