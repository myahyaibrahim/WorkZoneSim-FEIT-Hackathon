// Travel demand: zones (gateways on the study-area cordon + internal activity zones), a gravity OD
// matrix balanced with Furness, and calibration against Transport Victoria traffic counts.
import { distPointPolyline, axisDiff, bearingXY, normName, pointAlong, cumulativeLengths } from './geo.js';
import { assign } from './assign.js';

import { HOUR_SHARE, MICRO } from './standards.js';

// Analysis hours. AM/PM use DTP observed peak-hour counts; other hours scale DTP AADT by the SCATS-derived hour share.
// `factor` scales the prior (seed) demand relative to the weekday 8–9am hour.
const AM_SHARE = HOUR_SHARE.weekday[8];
export const PERIODS = {
  AM:    { label: 'Weekday AM peak (8–9am)',  hour: 8,  day: 'weekday', countKey: 'ALLVEH_AMP' },
  OFF:   { label: 'Weekday business hours (11am–12pm)', hour: 11, day: 'weekday' },
  PM:    { label: 'Weekday PM peak (5–6pm)',  hour: 17, day: 'weekday', countKey: 'ALLVEH_PMP' },
  NIGHT: { label: 'Weeknight works (10–11pm)', hour: 22, day: 'weekday' },
  WE:    { label: 'Weekend midday (12–1pm)',  hour: 12, day: 'weekend' },
};
for (const p of Object.values(PERIODS)) { p.aadtShare = HOUR_SHARE[p.day][p.hour]; p.factor = p.aadtShare / AM_SHARE; }

// forward=true: nodes that can reach the largest SCC; false: nodes reachable from it.
function reachFlags(g, forward) {
  const f = Uint8Array.from(g.scc), stack = [];
  for (let i = 0; i < g.n; i++) if (f[i]) stack.push(i);
  while (stack.length) {
    const v = stack.pop();
    const start = forward ? g.inStart : g.outStart, list = forward ? g.inEdge : g.outEdge, far = forward ? g.from : g.to;
    for (let k = start[v]; k < start[v + 1]; k++) { const w = far[list[k]]; if (!f[w]) { f[w] = 1; stack.push(w); } }
  }
  return f;
}

export function buildZones(net) {
  const g = net.veh, zones = [];
  // Gateways: cordon nodes on the collector-or-higher network. Dual-carriageway cordon nodes are pure
  // sources or sinks, so accept nodes that can reach (produce) or be reached from (attract) the main network.
  const canReach = reachFlags(g, true), reachable = reachFlags(g, false);
  for (const nd of g.nodes) {
    if (!nd.boundary || !(canReach[nd.i] || reachable[nd.i])) continue;
    let outCap = 0, inCap = 0, rank = 9, name = '';
    for (let k = g.outStart[nd.i]; k < g.outStart[nd.i + 1]; k++) {
      const e = g.outEdge[k]; outCap += g.cap[e]; if (g.rank[e] < rank) { rank = g.rank[e]; name = g.links[g.link[e]].name; }
    }
    for (let k = g.inStart[nd.i]; k < g.inStart[nd.i + 1]; k++) {
      const e = g.inEdge[k]; inCap += g.cap[e]; if (g.rank[e] < rank) { rank = g.rank[e]; name = g.links[g.link[e]].name; }
    }
    if (rank > 6) continue;
    if (!canReach[nd.i]) outCap = 0;
    if (!reachable[nd.i]) inCap = 0;
    if (!outCap && !inCap) continue;
    zones.push({ kind: 'gateway', node: nd.i, xy: nd.xy, lat: nd.lat, lon: nd.lon, name, rank, outCap, inCap, scale: 1 });
  }
  // Internal zones: one per ~350 m grid cell, weighted by local street length (activity proxy)
  const cell = 350, cells = new Map();
  for (const L of g.links) {
    const mid = L.xy[L.xy.length >> 1];
    const key = Math.floor(mid[0] / cell) + ',' + Math.floor(mid[1] / cell);
    let c = cells.get(key);
    if (!c) cells.set(key, c = { act: 0, cx: (Math.floor(mid[0] / cell) + 0.5) * cell, cy: (Math.floor(mid[1] / cell) + 0.5) * cell, nodes: new Set() });
    c.act += L.len * (L.rank >= 5 ? 1 : 0.5);
    if (L.rank >= 4) { c.nodes.add(L.a); c.nodes.add(L.b); }
  }
  for (const c of cells.values()) {
    if (Math.hypot(c.cx, c.cy) > net.radius * 0.95 || c.act < 150) continue;
    let best = -1, bd = Infinity;
    for (const i of c.nodes) {
      const nd = g.nodes[i];
      if (!g.scc[i] || nd.boundary) continue;
      const d = Math.hypot(nd.xy[0] - c.cx, nd.xy[1] - c.cy);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) continue;
    const nd = g.nodes[best];
    zones.push({ kind: 'internal', node: best, xy: nd.xy, lat: nd.lat, lon: nd.lon, name: 'Local activity', act: c.act, scale: 1 });
  }
  return zones;
}

// Gravity OD with Furness balancing. Gateway volumes start at ~40% of cordon capacity in the peak and
// internal zones generate ~40% of cordon volume; counts then refine this. `level` scales all demand.
export function buildOD(zones, period, level = 1) {
  const nz = zones.length, pf = PERIODS[period].factor * level;
  const P = new Float64Array(nz), A = new Float64Array(nz);
  let gwTotal = 0, actTotal = 0, R = 0;
  for (const z of zones) {
    if (z.kind === 'gateway') { gwTotal += 0.4 * z.outCap; R = Math.max(R, Math.hypot(z.xy[0], z.xy[1])); }
    else actTotal += z.act;
  }
  zones.forEach((z, i) => {
    if (z.kind === 'gateway') { P[i] = 0.4 * z.outCap * pf * z.scale; A[i] = 0.4 * z.inCap * pf * z.scale; }
    else { P[i] = A[i] = 0.4 * gwTotal * (z.act / (actTotal || 1)) * pf * z.scale; }
  });
  const T = new Float64Array(nz * nz);
  for (let i = 0; i < nz; i++) for (let j = 0; j < nz; j++) {
    if (i === j) continue;
    const zi = zones[i], zj = zones[j];
    const d = Math.hypot(zi.xy[0] - zj.xy[0], zi.xy[1] - zj.xy[1]);
    if (d < 350) continue;
    // through-trips favour crossing the whole study area; local trips decay with distance
    const f = zi.kind === 'gateway' && zj.kind === 'gateway' ? 0.6 * Math.min(1, d / (1.4 * R || 1)) ** 2 : Math.exp(-d / 2500) * 1.2;
    T[i * nz + j] = P[i] * A[j] * f;
  }
  const sp = P.reduce((a, b) => a + b, 0), sa = A.reduce((a, b) => a + b, 0);
  for (let j = 0; j < nz; j++) A[j] *= sp / (sa || 1);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < nz; i++) {
      let s = 0; for (let j = 0; j < nz; j++) s += T[i * nz + j];
      if (s > 0) { const k = P[i] / s; for (let j = 0; j < nz; j++) T[i * nz + j] *= k; }
    }
    for (let j = 0; j < nz; j++) {
      let s = 0; for (let i = 0; i < nz; i++) s += T[i * nz + j];
      if (s > 0) { const k = A[j] / s; for (let i = 0; i < nz; i++) T[i * nz + j] *= k; }
    }
  }
  return { zones, T, period };
}

// Attach Transport Victoria counts to vehicle links. For two-way links the observation is the
// two-way hourly flow; for one-way carriageways it is the directional flow. A count above what the link's lanes
// can pass at saturation flow cannot be carried by that link: it belongs to a parallel or grade-separated road
// (e.g. a freeway above or below it) and is dropped.
export function matchCounts(net, feats) {
  const g = net.veh, proj = net.proj;
  const fs = [];
  for (const f of feats) {
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of lines) {
      const xy = line.map(c => proj.fwd(c[1], c[0]));
      if (xy.length < 2) continue;
      const p = f.properties;
      const twoWayK = p.ALLVEHS_AA > 0 && p.TWO_WAY_AA > 0 ? Math.min(2.2, Math.max(1, p.TWO_WAY_AA / p.ALLVEHS_AA)) : 2;
      fs.push({ xy, name: normName(p.ROAD_NAME), p, twoWayK });
    }
  }
  const matches = [], dropped = [];
  for (const L of g.links) {
    if (L.rank > 6) continue;
    const cum = cumulativeLengths(L.xy);
    const mid = pointAlong(L.xy, cum, cum[cum.length - 1] / 2);
    const lname = normName(L.name);
    let best = null;
    for (const f of fs) {
      const r = distPointPolyline(mid.p, f.xy);
      if (r.d > 30) continue;
      const fb = bearingXY(f.xy[r.i], f.xy[r.i + 1]);
      if (axisDiff(fb, mid.brg) > 25) continue;
      const nameOk = f.name && lname && (lname === f.name || lname.startsWith(f.name) || f.name.startsWith(lname));
      if (!nameOk && r.d > 12) continue;
      const score = r.d + (nameOk ? 0 : 15);
      if (!best || score < best.score) best = { f, score };
    }
    if (!best) continue;
    const p = best.f.p, k = L.oneway ? 1 : best.f.twoWayK;
    const obs = {};
    for (const [key, per] of Object.entries(PERIODS)) {
      obs[key] = per.countKey && p[per.countKey] > 0 ? p[per.countKey] * k : (p.ALLVEHS_AA || 0) * per.aadtShare * k;
    }
    // TWO_WAY__1 = two-way heavy vehicle (truck) AADT, as shown in the DTP label e.g. "8,400 (6% 523*)"
    const hv = p.TWO_WAY_AA > 0 && p.TWO_WAY__1 > 0 ? p.TWO_WAY__1 / p.TWO_WAY_AA : null;
    const cap = ((L.edgeF >= 0 ? g.lanes[L.edgeF] : 0) + (L.edgeB >= 0 ? g.lanes[L.edgeB] : 0)) * MICRO.satFlow;
    if (cap > 0 && Math.max(...Object.values(obs)) > cap) { dropped.push({ link: L.id, road: p.ROAD_NAME, obs: Math.max(...Object.values(obs)), cap }); continue; }
    matches.push({ link: L.id, obs, road: p.ROAD_NAME, aadt: p.TWO_WAY_AA, truckAadt: p.TWO_WAY__1 || null, hvShare: hv, year: p.YR });
  }
  matches.dropped = dropped;
  return matches;
}

export function modelLinkFlow(g, flow, L) {
  return (L.edgeF >= 0 ? flow[L.edgeF] : 0) + (L.edgeB >= 0 ? flow[L.edgeB] : 0);
}

export function geh(m, c) { return Math.sqrt(2 * (m - c) ** 2 / (m + c || 1)); }

// Path-based matrix estimation: each OD cell is scaled by the (damped) geometric mean of observed/modelled
// ratios on the counted links its routes use. Robust to counts the model cannot reach.
export async function calibrate(net, zones, matches, period, baseSc, onProgress, level = 1) {
  const g = net.veh;
  zones.forEach(z => { z.scale = 1; });
  const od = buildOD(zones, period, level);
  const obsLink = new Map();
  for (const m of matches) if (m.obs[period] > 0) obsLink.set(m.link, m.obs[period]);
  if (!obsLink.size) return { od };
  const T0 = Float64Array.from(od.T), nz = zones.length, rounds = 5;
  for (let r = 0; r < rounds; r++) {
    const res = await assign(g, od, baseSc, { iters: 6, keepPaths: true, onProgress: f => onProgress?.((r + f) / rounds) });
    const logR = new Map(), logs = [];
    for (const [lid, obs] of obsLink) {
      const mod = modelLinkFlow(g, res.flow, g.links[lid]);
      if (mod < 5) continue; // no modelled route uses this link, cannot be corrected by scaling
      const lr = Math.log(Math.min(3, Math.max(1 / 3, obs / mod)));
      logR.set(lid, lr); logs.push(lr);
    }
    logs.sort((a, b) => a - b);
    const globalLog = logs.length ? logs[logs.length >> 1] : 0;
    for (let q = 0; q < nz * nz; q++) {
      if (!(od.T[q] > 0)) continue;
      let s = 0, w = 0;
      for (const p of res.paths[q] || []) for (const e of p.edges) {
        const lr = logR.get(g.link[e]);
        if (lr !== undefined) { s += lr * p.share; w += p.share; }
      }
      const f = Math.exp(w > 0 ? 0.8 * s / w : 0.5 * globalLog);
      od.T[q] = Math.min(T0[q] * 5, Math.max(T0[q] * 0.2, od.T[q] * f));
    }
  }
  return { od };
}

export function calibrationStats(net, matches, flow, period) {
  const g = net.veh, pts = [];
  for (const m of matches) {
    const obs = m.obs[period];
    if (!(obs > 0)) continue;
    pts.push({ obs, mod: modelLinkFlow(g, flow, g.links[m.link]), road: m.road });
  }
  if (!pts.length) return null;
  const good = pts.filter(p => geh(p.mod, p.obs) < 5).length;
  const mo = pts.reduce((s, p) => s + p.obs, 0) / pts.length, mm = pts.reduce((s, p) => s + p.mod, 0) / pts.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.obs - mo) * (p.mod - mm); sxx += (p.obs - mo) ** 2; syy += (p.mod - mm) ** 2; }
  return { n: pts.length, gehOk: good / pts.length, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0, pts };
}
