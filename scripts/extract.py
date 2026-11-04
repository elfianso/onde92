#!/usr/bin/env python3
"""Extract compact JSON for lines 144,160,244,360 from the IDFM GTFS feed.
Usage: python3 extract.py /path/to/gtfs_dir /path/to/out_dir"""
import csv, json, sys, math, datetime, collections, os
G, OUT = sys.argv[1], sys.argv[2]
LINES = {'144': 'IDFM:C01169', '160': 'IDFM:C01183', '244': 'IDFM:C01240', '360': 'IDFM:C01304'}
def rd(name): return csv.DictReader(open(os.path.join(G, name), encoding='utf-8-sig'))
routes = {r['route_id']: r for r in rd('routes.txt') if r['route_id'] in LINES.values()}
agency = {a['agency_id']: a['agency_name'] for a in rd('agency.txt')}
trips = {t['trip_id']: t for t in rd('trips.txt') if t['route_id'] in routes}
st = collections.defaultdict(list)
src = os.path.join(G, 'st4.txt') if os.path.exists(os.path.join(G, 'st4.txt')) else os.path.join(G, 'stop_times.txt')
with open(src, encoding='utf-8-sig') as f:
    for line in f:
        p = line.rstrip('\n').split(',')
        if p[0] in trips:
            st[p[0]].append((int(p[6]), p[5], p[1], p[2]))
need_shapes = {t['shape_id'] for t in trips.values()}
shapes = collections.defaultdict(list)
for r in rd('shapes.txt'):
    if r['shape_id'] in need_shapes:
        shapes[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
stop_ids = {s for v in st.values() for _, s, _, _ in v}
stops = {}; parents = set()
for s in rd('stops.txt'):
    if s['stop_id'] in stop_ids:
        stops[s['stop_id']] = s; parents.add(s['parent_station'])
pnames = {s['stop_id']: s['stop_name'] for s in rd('stops.txt') if s['stop_id'] in parents}
# calendar -> active dates
svc_dates = collections.defaultdict(set)
for c in rd('calendar.txt'):
    d = datetime.datetime.strptime(c['start_date'], '%Y%m%d').date(); e = datetime.datetime.strptime(c['end_date'], '%Y%m%d').date()
    days = [c[k] for k in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']]
    while d <= e:
        if days[d.weekday()] == '1': svc_dates[c['service_id']].add(d.strftime('%Y%m%d'))
        d += datetime.timedelta(days=1)
for c in rd('calendar_dates.txt'):
    if c['exception_type'] == '1': svc_dates[c['service_id']].add(c['date'])
    else: svc_dates[c['service_id']].discard(c['date'])
def hms(t): h, m, s = map(int, t.split(':')); return h*3600+m*60+s
def hav(a, b):
    R=6371000; la1,lo1,la2,lo2=map(math.radians,(a[0],a[1],b[0],b[1]))
    x=math.sin((la2-la1)/2)**2+math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
    return 2*R*math.asin(math.sqrt(x))
def xy(p, lat0): return (p[1]*111320*math.cos(math.radians(lat0)), p[0]*110540)
def dp(pts, tol):
    if len(pts) < 3: return pts
    lat0 = pts[0][0]; P = [xy(p, lat0) for p in pts]
    keep = [False]*len(pts); keep[0]=keep[-1]=True; stack=[(0,len(pts)-1)]
    while stack:
        i,j = stack.pop(); ax,ay=P[i]; bx,by=P[j]; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy; best=-1; bi=-1
        for k in range(i+1,j):
            px,py=P[k]
            if L==0: d=math.hypot(px-ax,py-ay)
            else:
                t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L)); d=math.hypot(px-ax-t*dx,py-ay-t*dy)
            if d>best: best,bi=d,k
        if best>tol: keep[bi]=True; stack+=[(i,bi),(bi,j)]
    return [p for p,k in zip(pts,keep) if k]
def project(shape, cum, pt, start_idx):
    """Distance along shape of closest point to pt, searching forward from start_idx (monotonic)."""
    lat0=shape[0][0]; q=xy(pt,lat0); best=(1e18,0,start_idx)
    for i in range(start_idx, len(shape)-1):
        a=xy(shape[i],lat0); b=xy(shape[i+1],lat0); dx,dy=b[0]-a[0],b[1]-a[1]; L=dx*dx+dy*dy
        t=0 if L==0 else max(0,min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/L))
        d=math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy)
        if d<best[0]-0.01: best=(d, cum[i]+t*(cum[i+1]-cum[i]), i)
        if d > best[0] + 1500 and i > best[2] + 50: break
    return best[1], best[2]
meta = {'generated': datetime.datetime.now().isoformat(timespec='seconds'), 'lines': []}
for short, rid in LINES.items():
    r = routes[rid]
    ltrips = [t for t in trips.values() if t['route_id']==rid]
    patterns = {}; out_trips = []; used_svc = set(); used_stops = set()
    for t in ltrips:
        seq = sorted(st[t['trip_id']])
        key = (t['direction_id'], t['shape_id'], tuple(s for _, s, _, _ in seq))
        if key not in patterns:
            patterns[key] = {'dir': int(t['direction_id']), 'headsign': t['trip_headsign'], 'shape_id': t['shape_id'], 'stops': list(key[2]), 'n': 0}
        patterns[key]['n'] += 1
        times = [hms(d or a) for _, _, a, d in seq]
        out_trips.append([t['service_id'], key, times[0], [times[i+1]-times[i] for i in range(len(times)-1)], t['trip_id'].split(':')[-1]])
        used_svc.add(t['service_id']); used_stops.update(key[2])
    plist = sorted(patterns.values(), key=lambda p: (p['dir'], -p['n']))
    pidx = {}
    for i, p in enumerate(plist):
        k = (str(p['dir']), p['shape_id'], tuple(p['stops'])); pidx[k] = i
        raw = [(la, lo) for _, la, lo in sorted(shapes[p['shape_id']])]
        cum=[0.0]
        for a,b in zip(raw, raw[1:]): cum.append(cum[-1]+hav(a,b))
        dists=[]; si=0
        for s in p['stops']:
            S=stops[s]; d, si = project(raw, cum, (float(S['stop_lat']), float(S['stop_lon'])), si); dists.append(round(d))
        simp = dp(raw, 4.0)
        # cumulative distances for simplified shape (recomputed on original metric)
        c2=[0.0]
        for a,b in zip(simp, simp[1:]): c2.append(c2[-1]+hav(a,b))
        scale = cum[-1]/c2[-1] if c2[-1] else 1
        p['shape'] = [[round(a,6), round(b,6), round(c*scale)] for (a,b),c in zip(simp,c2)]
        p['dist'] = dists; p['length'] = round(cum[-1]); p['id'] = f"{short}-{p['dir']}-{i}"
        del p['shape_id']
    trips_out = sorted([[sv, pidx[k], t0, dl, tid] for sv, k, t0, dl, tid in out_trips], key=lambda x: (x[1], x[2]))
    stops_out = {}
    for s in used_stops:
        S = stops[s]
        stops_out[s.split(':')[-1]] = {'name': S['stop_name'], 'lat': round(float(S['stop_lat']),6), 'lon': round(float(S['stop_lon']),6),
                                       'area': S['parent_station'].split(':')[-1], 'wheelchair': S['wheelchair_boarding']=='1'}
    for p in plist: p['stops'] = [s.split(':')[-1] for s in p['stops']]
    data = {'short': short, 'routeId': rid, 'lineRef': 'STIF:Line::' + rid.split(':')[1] + ':', 'color': '#' + r['route_color'], 'textColor': '#' + r['route_text_color'],
            'agency': agency.get(r['agency_id']), 'patterns': plist, 'stops': stops_out,
            'services': {s: sorted(svc_dates.get(s, [])) for s in used_svc}, 'trips': trips_out,
            'tripFields': ['service', 'pattern', 'start_sec', 'deltas_sec', 'gtfs_trip'], 'generated': meta['generated']}
    json.dump(data, open(os.path.join(OUT, f'line-{short}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    main = [p for p in plist if True]
    meta['lines'].append({'short': short, 'color': data['color'], 'textColor': data['textColor'], 'lineRef': data['lineRef'], 'agency': data['agency'],
        'termini': [max((p for p in plist if p['dir']==d), key=lambda p: p['n'])['headsign'] for d in (0,1) if any(p['dir']==d for p in plist)],
        'nStops': len({stops_out[s]['name'] for s in stops_out}), 'nTrips': len(trips_out)})
    print(short, len(plist), 'patterns', len(trips_out), 'trips', len(stops_out), 'stops', [ (p['dir'],p['headsign'],len(p['stops']),p['n']) for p in plist])
meta['lines'].sort(key=lambda l: l['short'])
json.dump(meta, open(os.path.join(OUT, 'lines.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
