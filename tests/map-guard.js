// Le zoom ne doit pas déplacer l'origine : molette, pincement et double-clic restent autour du rond.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../public/prochain.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/prochain.css'), 'utf8');

assert.ok(src.includes("scrollZoom: { around: 'center' }"), 'molette autour du centre');
assert.ok(src.includes("touchZoomRotate: { around: 'center' }"), 'pincement autour du centre');
assert.ok(src.includes('doubleClickZoom: false'), 'double-clic natif coupé');
assert.ok(src.includes('map.boxZoom.enable()'), 'zoom rectangle laissé tel quel');
assert.ok(src.includes('map.dragPan.enable()'), 'pan souris conservé');
assert.ok(src.includes('if (panOrigin && !U.camLock)'), 'le centre n’est mémorisé que pendant un pan');
assert.ok(src.includes('if (panOrigin) { panOrigin = false; U.userMove = false; schedulePin(true); }'), 'recalcul seulement après un pan');

const dbl = src.slice(src.indexOf("map.on('dblclick'"), src.indexOf("map.on('mousemove'"));
assert.ok(dbl.includes('easeTo'), 'double-clic zoome');
assert.ok(!dbl.includes('center:'), 'le double-clic ne recentre pas');
assert.ok(!/easeTo\(\{[^}]*lat/.test(dbl), 'le double-clic ne change pas le lieu');

assert.ok(src.includes('const SM_EVERY = 60e3'), 'poll PRIM inchangé');
assert.ok(src.includes('SM_MAX = 3'), 'trois zones d’arrêt au plus');
assert.ok(src.includes('areas.length < SM_MAX'), 'plafond des zones conservé');
assert.ok(src.includes('followDayMark('), 'les suivants indiquent le jour');
assert.ok(src.includes("data-act=\"retry\""), 'réessai après échec de chargement');
assert.ok(src.includes('tileFail.cooling'), 'une tuile en échec n’est pas relancée en boucle');
assert.ok(src.includes('lineFail.cooling'), 'une ligne en échec n’est pas relancée en boucle');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(!/id="panel"[^>]*aria-live/.test(html), 'la liste entière n’est plus une région live');
assert.ok(/id="toast"[^>]*aria-live="polite"/.test(html), 'le toast reste annoncé');
assert.ok(css.includes('.chev'), 'affordance d’ouverture');
assert.ok(!css.includes('.chev{position:absolute'), 'le chevron ne recouvre plus l’heure');
console.log('map-guard ok');
