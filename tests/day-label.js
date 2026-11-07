// Jour affiché à côté d'une heure : « demain » seulement pour le lendemain, pas pour un autre jour.
'use strict';
const assert = require('assert');
const { load } = require('./harness');
// Samedi 7 nov. 2026, 11:00 à Paris (CET, UTC+1).
const now = Date.parse('2026-11-07T10:00:00Z');
const X = load(now);
const p = X.parisParts(now);
assert.strictEqual(p.ymd, '20261107', 'jour paris ' + p.ymd + ' ' + p.h + ':' + p.m);
assert.strictEqual(p.h, 11);

const laterToday = Date.parse('2026-11-07T15:00:00Z'); // 16:00 Paris
const tomorrow = Date.parse('2026-11-08T08:00:00Z'); // dimanche 09:00
const monday = Date.parse('2026-11-09T08:00:00Z'); // lundi 09:00
assert.strictEqual(X.relDayShort(laterToday, now), '');
assert.strictEqual(X.relDayShort(tomorrow, now), 'demain');
assert.strictEqual(X.relDayShort(monday, now), 'lun. 9');

// Les suivants du même jour que le gros départ ne répètent pas « demain ».
const anchor = Date.parse('2026-11-08T00:30:00Z'); // dimanche 01:30
const follow = Date.parse('2026-11-08T01:10:00Z'); // dimanche 02:10
assert.strictEqual(X.followDayMark(follow, anchor, now), '');
// 15:21 puis 11:07 le lendemain : il faut le dire.
assert.strictEqual(X.followDayMark(tomorrow, laterToday, now), 'demain');
assert.strictEqual(X.followDayMark(monday, laterToday, now), 'lun. 9');
// Sous une heure, l'heure n'est pas une horloge : pas de marque.
assert.strictEqual(X.followDayMark(now + 20 * 60e3, now, now), '');

const memo = X.failMemo();
const t = 1_000_000;
memo.block('tuile', t, 5000);
assert.strictEqual(memo.cooling('tuile', t + 4999), true);
assert.strictEqual(memo.cooling('tuile', t + 5000), false);
assert.strictEqual(memo.cooling('autre', t + 1), false);
memo.clear();
assert.strictEqual(memo.cooling('tuile', t + 1), false);
console.log('day-label ok');
