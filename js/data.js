// Live data connectors:
//  - OpenStreetMap via Overpass API: roads, footpaths, tram tracks, bus/tram routes, stops
//  - Department of Transport and Planning (Transport Victoria) Traffic Volume layer: AADT + peak-hour counts
//  - City of Melbourne Pedestrian Counting System: average hourly footfall per sensor

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const DTP_TRAFFIC = 'https://services2.arcgis.com/18ajPSI0b3ppsmMt/arcgis/rest/services/Traffic_Volume/FeatureServer/0/query';
const COM_PED = 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets';

export function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 110574, dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return { s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon };
}

const ROAD_RE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|footway|pedestrian|path|steps|cycleway|busway)$';

async function fetchWithTimeout(url, opts = {}, ms = 90000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}

export async function fetchOSM(bb, onStatus) {
  const b = `${bb.s},${bb.w},${bb.n},${bb.e}`;
  // emergency services respond from outside the study area: hospitals, ambulance, fire and police stations within ~3 km
  const e3 = `${bb.s - 0.027},${bb.w - 0.034},${bb.n + 0.027},${bb.e + 0.034}`;
  const q = `[out:json][timeout:90];
way["highway"~"${ROAD_RE}"](${b})->.roads;
way["railway"="tram"](${b})->.tram;
(.roads; .tram;)->.all;
rel(bw.all)["route"~"^(tram|bus)$"]->.routes;
(
  node["highway"="bus_stop"](${b});
  node["railway"="tram_stop"](${b});
  node["public_transport"="platform"](${b});
  node["highway"="traffic_signals"](${b});
  node["highway"~"^(stop|give_way)$"](${b});
)->.stops;
(.all; .routes; .stops;);
out body;
.all >;
out skel qt;
nwr["amenity"~"^(hospital|ambulance_station|fire_station|police)$"](${e3});
out center tags;
(
  nwr["shop"](${b});
  nwr["amenity"~"^(cafe|restaurant|fast_food|pub|bar|pharmacy|bank|clinic|doctors|dentist|post_office|childcare|kindergarten)$"](${b});
);
out center tags;`;
  let lastErr;
  for (const url of OVERPASS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        onStatus?.(`Querying OpenStreetMap (${new URL(url).host})…`);
        const r = await fetchWithTimeout(url, { method: 'POST', body: new URLSearchParams({ data: q }) }, 120000);
        if (r.status === 429 || r.status === 504) { lastErr = new Error(`Overpass busy (${r.status})`); await new Promise(res => setTimeout(res, 4000)); continue; }
        if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
        const j = await r.json();
        if (!j.elements?.length) throw new Error('Overpass returned no data');
        return j;
      } catch (e) { lastErr = e; }
    }
  }
  throw lastErr || new Error('Overpass unavailable');
}

// Transport Victoria traffic volumes (arterial network). Returns GeoJSON features in WGS84.
export async function fetchTrafficVolumes(bb) {
  const feats = [];
  for (let offset = 0; offset < 8000; offset += 2000) {
    const p = new URLSearchParams({
      where: '1=1', geometry: `${bb.w},${bb.s},${bb.e},${bb.n}`, geometryType: 'esriGeometryEnvelope',
      inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ROAD_NAME,ALLVEHS_AA,TWO_WAY_AA,TWO_WAY__1,ALLVEH_AMP,ALLVEH_PMP,ROUTE_DIRECTION,NUMBER_OF_TRAFFIC_LANES,YR,LABEL',
      returnGeometry: 'true', resultOffset: String(offset), resultRecordCount: '2000', f: 'geojson',
    });
    const r = await fetchWithTimeout(`${DTP_TRAFFIC}?${p}`, {}, 60000);
    if (!r.ok) throw new Error(`Traffic volume HTTP ${r.status}`);
    const j = await r.json();
    feats.push(...(j.features || []));
    if (!j.properties?.exceededTransferLimit && !j.exceededTransferLimit) break;
  }
  return feats.filter(f => f.geometry && (f.properties.ALLVEHS_AA > 0 || f.properties.ALLVEH_AMP > 0));
}

// City of Melbourne pedestrian sensors within the bbox, with the average hourly count for each hour of day
// over the last 90 days. Only covers the City of Melbourne municipality; elsewhere returns [].
export async function fetchPedestrianSensors(bb) {
  const where = `latitude>=${bb.s} and latitude<=${bb.n} and longitude>=${bb.w} and longitude<=${bb.e} and status="A"`;
  const r = await fetchWithTimeout(`${COM_PED}/pedestrian-counting-system-sensor-locations/records?limit=100&where=${encodeURIComponent(where)}`, {}, 30000);
  if (!r.ok) throw new Error(`Pedestrian sensors HTTP ${r.status}`);
  const sensors = (await r.json()).results || [];
  if (!sensors.length) return [];
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const ids = sensors.map(s => s.location_id).join(',');
  const q = new URLSearchParams({
    select: 'location_id,hourday,avg(pedestriancount) as avg',
    where: `sensing_date>="${since}" and location_id in (${ids})`,
    group_by: 'location_id,hourday', limit: '-1',
  });
  const r2 = await fetchWithTimeout(`${COM_PED}/pedestrian-counting-system-monthly-counts-per-hour/records?${q}`, {}, 45000);
  const rows = r2.ok ? ((await r2.json()).results || []) : [];
  const byId = new Map(sensors.map(s => [s.location_id, { id: s.location_id, name: s.sensor_description, lat: s.latitude, lon: s.longitude, hourly: new Array(24).fill(null) }]));
  for (const row of rows) { const s = byId.get(row.location_id); if (s) s.hourly[row.hourday] = row.avg; }
  return [...byId.values()].filter(s => s.hourly.some(v => v != null));
}
