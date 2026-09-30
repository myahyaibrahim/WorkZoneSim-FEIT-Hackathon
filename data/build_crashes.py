# Builds data/crashes.json from DTP "Victoria road crash data" (victorian_road_crash_data.csv, CC BY 4.0).
# https://opendata.transport.vic.gov.au/dataset/victoria-road-crash-data
# Keeps Greater Melbourne (STAT_DIV_NAME = Metro) injury crashes in the analysis years:
#   2019 and 2021-2024. 2020 is excluded (COVID-19 lockdowns: Metro crashes 18% below 2019);
#   2025 is excluded (incomplete: Sep-Dec 2025 well below other months, reporting lag).
# Row: [lat, lon, year, severity (1 fatal, 2 serious injury, 3 other injury), pedestrians, bicyclists, motorcyclists, LGA index]
# 'lgas' lists the local government area names; the tool uses them to tell which council a site is in.
import csv, json, sys
src, out = sys.argv[1], sys.argv[2]
YEARS = [2019, 2021, 2022, 2023, 2024]
SEV = {'Fatal accident': 1, 'Serious injury accident': 2, 'Other injury accident': 3}
rows, skipped, lgas = [], 0, []
for r in csv.DictReader(open(src, encoding='utf-8-sig')):
    if r['STAT_DIV_NAME'] != 'Metro': continue
    y = int(r['ACCIDENT_DATE'][:4])
    if y not in YEARS: continue
    sev = SEV.get(r['SEVERITY'])
    try: lat, lon = float(r['LATITUDE']), float(r['LONGITUDE'])
    except ValueError: skipped += 1; continue
    if sev is None: skipped += 1; continue
    n = lambda k: int(r[k] or 0)
    lga = r['LGA_NAME'].strip()
    if lga not in lgas: lgas.append(lga)
    rows.append([round(lat, 5), round(lon, 5), y, sev, n('PEDESTRIAN'), n('BICYCLIST'), n('MOTORCYCLIST'), lgas.index(lga)])
meta = {'source': 'DTP Victoria road crash data (CC BY 4.0)', 'years': YEARS, 'region': 'Greater Melbourne (Metro)',
        'fields': ['lat', 'lon', 'year', 'severity', 'pedestrians', 'bicyclists', 'motorcyclists', 'lga'], 'n': len(rows)}
json.dump({**meta, 'lgas': lgas, 'rows': rows}, open(out, 'w'), separators=(',', ':'))
print(meta, 'skipped', skipped)
