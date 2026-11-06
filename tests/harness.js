// Charge public/core.js dans un contexte Node (sans DOM) pour tester les calculs d'horaires.
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
function load(nowMs) {
  const store = new Map();
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(nowMs ?? RealDate.now()); } static now() { return nowMs ?? RealDate.now(); } }
  const ctx = { console, Intl, Math, JSON, Map, Set, Promise, setTimeout, clearTimeout, Date: nowMs != null ? FakeDate : Date,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { querySelector: () => null, querySelectorAll: () => [] }, window: { dispatchEvent() { } }, CustomEvent: class { },
    fetch: async u => { const f = path.join(PUB, u.split('?')[0]); return { ok: fs.existsSync(f), status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) }; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(PUB, 'core.js'), 'utf8') + '\n;this.__x={S,getLine,departures,journeys,midnight,parisParts,fmtHM,isFin,verdict,addDays,rtJourneys,rtPredictions,tripRtJourneys,theoJourneys,isLive};', ctx);
  return ctx.__x;
}
module.exports = { load };
