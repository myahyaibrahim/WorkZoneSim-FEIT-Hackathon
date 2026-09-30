// Geometry helpers. Points are [lat, lon]; projected points are [x, y] in metres
// on a local equirectangular plane centred on the study area.

const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(s));
}

export function makeProjection(lat0, lon0) {
  const kx = Math.cos(lat0 * RAD) * 111320, ky = 110574;
  return {
    fwd: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    inv: (x, y) => [y / ky + lat0, x / kx + lon0],
  };
}

// Bearing in degrees (0 = north, clockwise) of the vector a->b in projected space.
export function bearingXY(a, b) {
  const deg = Math.atan2(b[0] - a[0], b[1] - a[1]) / RAD;
  return (deg + 360) % 360;
}

export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Undirected angular difference (0..90), for "is this parallel" tests.
export function axisDiff(a, b) {
  const d = angleDiff(a, b);
  return d > 90 ? 180 - d : d;
}

export function distPointSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx, qy = a[1] + t * dy;
  return { d: Math.hypot(p[0] - qx, p[1] - qy), t, q: [qx, qy] };
}

export function distPointPolyline(p, pts) {
  let best = { d: Infinity, i: 0, t: 0, q: pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const r = distPointSeg(p, pts[i], pts[i + 1]);
    if (r.d < best.d) best = { d: r.d, i, t: r.t, q: r.q };
  }
  return best;
}

export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

export function cumulativeLengths(pts) {
  const c = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return c;
}

// Point at distance d along a polyline (with precomputed cumulative lengths); also returns local bearing.
export function pointAlong(pts, cum, d) {
  const n = pts.length;
  if (d <= 0) return { p: pts[0], brg: bearingXY(pts[0], pts[Math.min(1, n - 1)]) };
  if (d >= cum[n - 1]) return { p: pts[n - 1], brg: bearingXY(pts[Math.max(0, n - 2)], pts[n - 1]) };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / seg;
  const a = pts[lo], b = pts[hi];
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], brg: bearingXY(a, b) };
}

// Deterministic PRNG so repeated runs give identical demand samples.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Normalise Victorian road names so "Nicholson Street" matches "NICHOLSON ST".
const ABBR = { STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', PARADE: 'PDE', HIGHWAY: 'HWY', BOULEVARD: 'BVD', DRIVE: 'DR',
  PLACE: 'PL', LANE: 'LANE', TERRACE: 'TCE', CRESCENT: 'CRES', FREEWAY: 'FWY', GROVE: 'GR', COURT: 'CT', CLOSE: 'CL',
  ESPLANADE: 'ESP', PARKWAY: 'PKWY', SQUARE: 'SQ', WAY: 'WAY', HILL: 'HILL', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
export function normName(s) {
  if (!s) return '';
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).map(w => ABBR[w] || w).join(' ');
}
