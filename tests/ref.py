# Référence indépendante depuis le GTFS brut IDFM : prochains départs (ligne, quai) à un instant donné.
import json, sys, csv, subprocess, datetime, zoneinfo
G = '/workspace/gtfs/'
now = datetime.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
js = json.load(open(sys.argv[2])); PAR = zoneinfo.ZoneInfo('Europe/Paris')
sids = {'IDFM:' + x['sid'] for x in js}; routes = {'IDFM:' + x['k'].split(':')[1] for x in js}
trips = {}
with open(G + 'trips.txt', newline='') as f:
    for r in csv.DictReader(f):
        if r['route_id'] in routes: trips[r['trip_id']] = (r['route_id'], r['service_id'], r['direction_id'], r.get('trip_headsign', ''))
cal = {}
with open(G + 'calendar.txt', newline='') as f:
    for r in csv.DictReader(f): cal[r['service_id']] = r
exc = {}
with open(G + 'calendar_dates.txt', newline='') as f:
    for r in csv.DictReader(f): exc[(r['service_id'], r['date'])] = r['exception_type']
def active(svc, d):
    ymd = d.strftime('%Y%m%d'); e = exc.get((svc, ymd))
    if e == '1': return True
    if e == '2': return False
    c = cal.get(svc)
    if not c: return False
    return c['start_date'] <= ymd <= c['end_date'] and c[['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][d.weekday()]] == '1'
# stop_times : on garde les lignes des trips concernés (filtre awk sur stop_id pour la vitesse), + max seq par trip
pat = '|'.join(s.replace(':', '\\:') for s in sids)
st = subprocess.run(['awk', '-F,', 'NR==1||$6~/^(' + '|'.join(sorted(sids)) + ')$/', G + 'stop_times.txt'], capture_output=True, text=True).stdout.splitlines()
hdr = st[0].split(','); I = {h: i for i, h in enumerate(hdr)}
rows = [l.split(',') for l in st[1:]]
need = {r[I['trip_id']] for r in rows if r[I['trip_id']] in trips}
# dernier arrêt de chaque trip concerné
last = {}
out = subprocess.run(['awk', '-F,', 'NR>1{print $1","$7","$6}', G + 'stop_times.txt'], capture_output=True, text=True).stdout
for l in out.splitlines():
    t, seq, s = l.split(','); 
    if t in need:
        seq = int(seq)
        if t not in last or seq > last[t][0]: last[t] = (seq, s)
res = {}
nl = now.astimezone(PAR).date()
for r in rows:
    tid = r[I['trip_id']]
    if tid not in trips: continue
    if last[tid][1] == r[I['stop_id']] and last[tid][0] == int(r[I['stop_sequence']]): continue
    if 'pickup_type' in I and r[I['pickup_type']] == '1': continue
    rid, svc, dr, hs = trips[tid]; h, m, s = map(int, r[I['departure_time']].split(':'))
    for dd in (-1, 0, 1):
        d = nl + datetime.timedelta(days=dd)
        if not active(svc, d): continue
        noon = datetime.datetime(d.year, d.month, d.day, 12, tzinfo=PAR); t = noon - datetime.timedelta(hours=12) + datetime.timedelta(seconds=h*3600+m*60+s)
        if t.timestamp() * 1000 < now.timestamp() * 1000 - 30e3: continue
        res.setdefault((rid.split(':')[1], r[I['stop_id']][5:]), []).append((int(t.timestamp() * 1000), int(dr)))
bad = 0
for x in js:
    exp = sorted(res.get((x['k'].split(':')[1], x['sid']), []))[:6]
    got = [(d['t'], d['dir']) for d in x['deps']]
    if [e[0] for e in exp] != [g[0] for g in got]:
        bad += 1
        fm = lambda v: datetime.datetime.fromtimestamp(v/1000, PAR).strftime('%H:%M')
        print('DIFF', x['label'], x['name'], x['sid'], 'js', [fm(g[0]) for g in got], 'gtfs', [fm(e[0]) for e in exp])
print('checked', len(js), 'diff', bad)
