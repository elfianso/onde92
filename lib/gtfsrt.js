// Décodeur GTFS-RT minimal (protobuf) sans dépendance : FeedMessage → TripUpdates (+ positions des véhicules).
'use strict';
function reader(buf) {
  let p = 0;
  const varint = () => { let r = 0, s = 0, b; do { b = buf[p++]; if (s < 28) r |= (b & 0x7f) << s; else r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r >>> 0 === r ? r : r; };
  return {
    get pos() { return p; }, set pos(v) { p = v; }, buf,
    varint,
    svarint() { const v = varint(); return v & 1 ? -((v + 1) / 2) : v / 2; },
    i64() { // int64 encodé en varint (delay, time) : on gère les négatifs (complément à deux sur 10 octets)
      let lo = 0, hi = 0, s = 0, b, i = 0;
      do { b = buf[p++]; if (i < 4) lo += (b & 0x7f) * 2 ** s; else hi += (b & 0x7f) * 2 ** (s - 28); s += 7; i++; } while (b & 0x80);
      const v = lo + hi * 2 ** 28; return i >= 10 ? v - 2 ** 64 : v;
    },
    bytes() { const n = varint(); const s = buf.subarray(p, p + n); p += n; return s; },
    skip(wt) { if (wt === 0) varint(); else if (wt === 1) p += 8; else if (wt === 2) { const n = varint(); p += n; } else if (wt === 5) p += 4; else throw new Error('wire type ' + wt); },
  };
}
const str = b => Buffer.from(b.buffer, b.byteOffset, b.length).toString('utf8');
function msg(b, fn) { const r = reader(b); while (r.pos < b.length) { const k = r.varint(); fn(k >>> 3, k & 7, r); } }
function stopTimeEvent(b) { const o = {}; msg(b, (f, wt, r) => { if (f === 1 && wt === 0) o.delay = r.i64(); else if (f === 2 && wt === 0) o.time = r.i64(); else r.skip(wt); }); return o; }
function tripDesc(b) { const o = {}; msg(b, (f, wt, r) => { if (wt === 2 && f === 1) o.trip_id = str(r.bytes()); else if (wt === 2 && f === 2) o.start_time = str(r.bytes()); else if (wt === 2 && f === 3) o.start_date = str(r.bytes()); else if (wt === 2 && f === 5) o.route_id = str(r.bytes()); else if (wt === 0 && f === 4) o.rel = r.varint(); else if (wt === 0 && f === 6) o.direction_id = r.varint(); else r.skip(wt); }); return o; }
function stu(b) { const o = {}; msg(b, (f, wt, r) => { if (f === 1 && wt === 0) o.seq = r.varint(); else if (f === 2 && wt === 2) o.arr = stopTimeEvent(r.bytes()); else if (f === 3 && wt === 2) o.dep = stopTimeEvent(r.bytes()); else if (f === 4 && wt === 2) o.stop_id = str(r.bytes()); else if (f === 5 && wt === 0) o.rel = r.varint(); else r.skip(wt); }); return o; }
function tripUpdate(b) { const o = { stu: [] }; msg(b, (f, wt, r) => { if (f === 1 && wt === 2) o.trip = tripDesc(r.bytes()); else if (f === 2 && wt === 2) o.stu.push(stu(r.bytes())); else if (f === 4 && wt === 0) o.timestamp = r.i64(); else if (f === 5 && wt === 0) o.delay = r.i64(); else r.skip(wt); }); return o; }
function entity(b) { const o = {}; msg(b, (f, wt, r) => { if (f === 1 && wt === 2) o.id = str(r.bytes()); else if (f === 2 && wt === 0) o.deleted = !!r.varint(); else if (f === 3 && wt === 2) o.tu = tripUpdate(r.bytes()); else r.skip(wt); }); return o; }
function decodeFeed(buf) {
  const out = { timestamp: null, tripUpdates: [] };
  msg(buf, (f, wt, r) => {
    if (f === 1 && wt === 2) msg(r.bytes(), (g, w2, r2) => { if (g === 3 && w2 === 0) out.timestamp = r2.i64(); else r2.skip(w2); });
    else if (f === 2 && wt === 2) { const e = entity(r.bytes()); if (e.tu && !e.deleted) out.tripUpdates.push(e.tu); }
    else r.skip(wt);
  });
  return out;
}
module.exports = { decodeFeed };
