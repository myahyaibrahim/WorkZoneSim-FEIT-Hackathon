# Builds data/pt_shapes.json from the Transport Victoria GTFS Schedule (CC BY 4.0):
#   https://opendata.transport.vic.gov.au/dataset/gtfs-schedule
# For each metropolitan tram (feed 3) and metropolitan bus (feed 4) route and direction:
#   - the shape used by most weekday trips, simplified (Douglas-Peucker, 8 m) and rounded to 5 decimals;
#   - the scheduled speed: median over weekday trips starting 07:00-19:00 of trip distance (shape_dist_traveled at
#     the last stop) divided by scheduled run time (last arrival - first departure).
# The map animation runs vehicles along these shapes at the scheduled speed and the timetable frequency
# (data/pt_service.json), so trams and buses move as the timetable says, not at live positions.
# Usage: python build_pt_shapes.py gtfs.zip ../data/pt_shapes.json
import zipfile, io, csv, json, sys, math, datetime, statistics, collections

outer = zipfile.ZipFile(sys.argv[1])
def inner(folder): return zipfile.ZipFile(io.BytesIO(outer.read(f'{folder}/google_transit.zip')))
def rows(z, name):
    with z.open(name) as f: yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'))
def secs(t): h, m, s = map(int, t.split(':')); return h * 3600 + m * 60 + s

def active(z, day):
    ds, wd, act = day.strftime('%Y%m%d'), day.strftime('%A').lower(), set()
    for r in rows(z, 'calendar.txt'):
        if r['start_date'] <= ds <= r['end_date'] and r[wd] == '1': act.add(r['service_id'])
    for r in rows(z, 'calendar_dates.txt'):
        if r['date'] == ds: (act.add if r['exception_type'] == '1' else act.discard)(r['service_id'])
    return act

def simplify(pts, tol):
    if len(pts) < 3: return pts
    lat0 = math.radians(pts[0][0]); kx, ky = 111320 * math.cos(lat0), 110574
    xy = [(p[1] * kx, p[0] * ky) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop(); (x1, y1), (x2, y2) = xy[a], xy[b]; dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            d = abs(dy * xy[i][0] - dx * xy[i][1] + x2 * y1 - y2 * x1) / L
            if d > best: best, bi = d, i
        if best > tol: keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

out = {'source': 'Transport Victoria GTFS Schedule (CC BY 4.0)', 'tram': {}, 'bus': {}}
for folder, mode in [('3', 'tram'), ('4', 'bus')]:
    z = inner(folder)
    lo = min(r['start_date'] for r in rows(z, 'calendar.txt'))
    d = datetime.date(int(lo[:4]), int(lo[4:6]), int(lo[6:])) + datetime.timedelta(days=7)
    tue = d + datetime.timedelta(days=(1 - d.weekday()) % 7)
    act = active(z, tue)
    routes = {r['route_id']: r['route_short_name'] for r in rows(z, 'routes.txt')}
    trips = {}
    for r in rows(z, 'trips.txt'):
        if r['service_id'] in act: trips[r['trip_id']] = (routes.get(r['route_id'], ''), r.get('direction_id') or '0', r['shape_id'])
    span = {}  # trip -> [first dep, last arr, last dist]
    for r in rows(z, 'stop_times.txt'):
        t = r['trip_id']
        if t not in trips: continue
        seq = int(r['stop_sequence']); s = span.get(t)
        if s is None: span[t] = s = [seq, secs(r['departure_time'] or r['arrival_time']), seq, 0, 0.0]
        if seq < s[0]: s[0], s[1] = seq, secs(r['departure_time'] or r['arrival_time'])
        if seq >= s[2]: s[2], s[3], s[4] = seq, secs(r['arrival_time'] or r['departure_time']), float(r['shape_dist_traveled'] or 0)
    shapeUse, speeds = collections.Counter(), collections.defaultdict(list)
    for t, (ref, dirn, shp) in trips.items():
        shapeUse[(ref, dirn, shp)] += 1
        s = span.get(t)
        if s and 7 * 3600 <= s[1] < 19 * 3600 and s[3] > s[1] and s[4] > 0: speeds[(ref, dirn)].append((s[4], s[3] - s[1]))
    best = {}
    for (ref, dirn, shp), n in shapeUse.items():
        if (ref, dirn) not in best or n > best[(ref, dirn)][1]: best[(ref, dirn)] = (shp, n)
    need = {v[0] for v in best.values()}
    pts = collections.defaultdict(list)
    for r in rows(z, 'shapes.txt'):
        if r['shape_id'] in need: pts[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon']), float(r['shape_dist_traveled'] or 0)))
    for (ref, dirn), (shp, n) in best.items():
        p = sorted(pts[shp]);
        if len(p) < 2 or not speeds.get((ref, dirn)): continue
        shapeLen = p[-1][3]
        # shape_dist_traveled units: km in this feed if the shape is < 200 units long
        unit = 1000 if shapeLen < 200 else 1
        kmh = statistics.median(dist * unit / 1000 / (sec / 3600) for dist, sec in speeds[(ref, dirn)])
        line = simplify([(la, lo) for _, la, lo, _ in p], 8)
        out[mode].setdefault(ref, {})[dirn] = {'kmh': round(kmh, 1), 'pts': [[round(a, 5), round(b, 5)] for a, b in line]}
    print(mode, len(out[mode]), 'routes')
json.dump(out, open(sys.argv[2], 'w'), separators=(',', ':'))
