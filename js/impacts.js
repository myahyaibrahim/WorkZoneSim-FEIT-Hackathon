// Pedestrian and public transport impacts of a work zone.
import { dijkstra } from './assign.js';
import { distPointPolyline, axisDiff, bearingXY, mulberry32, pointAlong, cumulativeLengths } from './geo.js';
import { PERIODS } from './demand.js';
import { WALK_SPEED, PT_LOAD, THROUGH_SHARE, TRANSFER_PENALTY_MIN, MULT } from './standards.js';

const WALK = WALK_SPEED; // m/s, Austroads design walking speed
const CARRIAGEWAY = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'primary_link', 'secondary_link', 'tertiary_link']);

function orientedXY(g, c, k) { const L = g.links[c.links[k]]; return L.a === c.nodes[k] ? L.xy : L.xy.slice().reverse(); }

// ---------------- pedestrians ----------------

export function pedImpact(net, closures, sensors, period, userPedCount = null) {
  const P = net.ped, g = net.veh;
  const closed = new Uint8Array(P.links.length);
  const segs = [];
  let mids = null;
  for (const c of closures) {
    if (c.footpath === 'open') continue;
    const sides = c.footpath === 'both' ? new Set([1, -1]) : new Set([c.footpath === 'left' ? 1 : -1]);
    c.links.forEach((lid, k) => {
      const xy = orientedXY(g, c, k), L = g.links[lid];
      const halfW = (L.oneway ? L.lanesF : L.lanesF + L.lanesB) * 1.65;
      segs.push({ xy, c });
      const minX = Math.min(...xy.map(p => p[0])) - 40, maxX = Math.max(...xy.map(p => p[0])) + 40;
      const minY = Math.min(...xy.map(p => p[1])) - 40, maxY = Math.max(...xy.map(p => p[1])) + 40;
      mids ??= P.links.map(PL => { const cum = cumulativeLengths(PL.xy); return pointAlong(PL.xy, cum, cum[cum.length - 1] / 2); });
      for (const PL of P.links) {
        const mid = mids[PL.id];
        if (mid.p[0] < minX || mid.p[0] > maxX || mid.p[1] < minY || mid.p[1] > maxY) continue;
        const r = distPointPolyline(mid.p, xy);
        if (r.d > halfW + 9 || r.t <= 0.02 && r.i === 0 || r.t >= 0.98 && r.i === xy.length - 2) continue;
        if (axisDiff(mid.brg, bearingXY(xy[r.i], xy[r.i + 1])) > 25) continue; // crossings stay open
        if (CARRIAGEWAY.has(PL.hw) && r.d < 4) { if (sides.size === 2 || PL.wayId === L.wayId && c.type === 'full') closed[PL.id] = 1; continue; }
        const a = xy[r.i], b = xy[r.i + 1];
        const cross = (b[0] - a[0]) * (mid.p[1] - a[1]) - (b[1] - a[1]) * (mid.p[0] - a[0]);
        if (sides.has(cross > 0 ? 1 : -1)) closed[PL.id] = 1;
      }
    });
  }
  const closedIds = [];
  for (let i = 0; i < closed.length; i++) if (closed[i]) closedIds.push(i);
  if (!closedIds.length) {
    const centres = closures.flatMap(c => c.links.map(l => { const L = g.links[l]; return L.xy[L.xy.length >> 1]; }));
    return { affected: false, closedLinks: [], ...pedExposure(net, sensors, period, centres, userPedCount),
      note: closures.some(c => c.footpath !== 'open') ? 'No mapped footpath found alongside the work zone.' : 'Footpaths remain open along the work zone.' };
  }

  // sample walking trips around the site
  const centres = closedIds.map(i => { const L = P.links[i]; return L.xy[L.xy.length >> 1]; });
  const near = [];
  for (const nd of P.nodes) {
    let d = Infinity;
    for (const c of centres) d = Math.min(d, Math.hypot(nd.xy[0] - c[0], nd.xy[1] - c[1]));
    if (d < 350) near.push(nd.i);
  }
  const rng = mulberry32(42);
  const baseCost = P.len, scenCost = new Float64Array(P.m);
  for (let e = 0; e < P.m; e++) scenCost[e] = closed[P.link[e]] ? Infinity : P.len[e];
  const dB = new Float64Array(P.n), pB = new Int32Array(P.n), dS = new Float64Array(P.n), pS = new Int32Array(P.n);
  const trips = [];
  for (let o = 0; o < 70 && near.length > 2; o++) {
    const src = near[Math.floor(rng() * near.length)];
    dijkstra(P, src, baseCost, dB, pB, { maxCost: 1500 });
    let scenDone = false;
    for (let t = 0; t < 8; t++) {
      const dst = near[Math.floor(rng() * near.length)];
      const straight = Math.hypot(P.nodes[src].xy[0] - P.nodes[dst].xy[0], P.nodes[src].xy[1] - P.nodes[dst].xy[1]);
      if (dst === src || straight < 60 || straight > 600 || dB[dst] === Infinity) continue;
      let hit = false;
      for (let e = pB[dst]; e >= 0; e = pB[P.from[e]]) if (closed[P.link[e]]) { hit = true; break; }
      const trip = { src, dst, base: dB[dst], hit };
      if (hit) {
        if (!scenDone) { dijkstra(P, src, scenCost, dS, pS, { maxCost: 3000 }); scenDone = true; }
        trip.scen = dS[dst];
        if (trips.filter(x => x.hit && x.path).length < 3 && dS[dst] < Infinity) {
          trip.path = pathLL(P, pS, dst); trip.basePath = pathLL(P, pB, dst);
        }
      }
      trips.push(trip);
    }
  }
  const hits = trips.filter(t => t.hit);
  const reach = hits.filter(t => t.scen < Infinity);
  const detours = reach.map(t => t.scen - t.base);
  const avgDetour = detours.length ? detours.reduce((a, b) => a + b, 0) / detours.length : 0;

  const { pedsPerHour, pedSource, sensor } = pedExposure(net, sensors, period, centres, userPedCount);
  const closedLen = closedIds.reduce((s, i) => s + P.links[i].len, 0);
  return {
    affected: true, closedLinks: closedIds.map(i => P.links[i].ll), closedLen,
    sampled: trips.length, affectedShare: trips.length ? hits.length / trips.length : 0,
    avgDetour, maxDetour: detours.length ? Math.max(...detours) : 0, avgExtraMin: avgDetour / WALK / 60,
    cutOff: hits.length - reach.length, pedsPerHour, pedSource, sensor,
    // equivalent in-vehicle person-hours: detour walking time × TfNSW walk multiplier; assumes every counted
    // pedestrian walks past the closed frontage
    pedHoursPerHour: pedsPerHour == null ? null : pedsPerHour * avgDetour / WALK / 3600 * MULT.walk,
    examples: trips.filter(t => t.path).map(t => ({ base: t.basePath, detour: t.path, extra: t.scen - t.base })),
  };
}

// Pedestrian volume passing the work zone: nearest City of Melbourne sensor (within 250 m), else a count the
// user enters. No volume is invented where neither exists.
function pedExposure(net, sensors, period, centres, userPedCount) {
  const hour = PERIODS[period].hour;
  let sensor = null, sd = Infinity;
  for (const s of sensors || []) {
    const xy = net.proj.fwd(s.lat, s.lon);
    for (const c of centres) { const d = Math.hypot(xy[0] - c[0], xy[1] - c[1]); if (d < sd) { sd = d; sensor = s; } }
  }
  if (sensor && sd < 250 && sensor.hourly[hour] != null) {
    return { pedsPerHour: sensor.hourly[hour], sensor, pedSource: `City of Melbourne sensor “${sensor.name}” (${Math.round(sd)} m away, 90-day average at ${hour}:00, all days)` };
  }
  if (userPedCount > 0) return { pedsPerHour: userPedCount, sensor: null, pedSource: 'Pedestrian count entered by the user' };
  return { pedsPerHour: null, sensor: null, pedSource: 'No pedestrian count available (no City of Melbourne sensor within 250 m), enter a site count to value pedestrian delay' };
}

function pathLL(P, pred, dst) {
  const out = [];
  for (let e = pred[dst]; e >= 0; e = pred[P.from[e]]) {
    const L = P.links[P.link[e]];
    const ll = P.from[e] === L.a ? L.ll : L.ll.slice().reverse();
    out.unshift(...ll.slice(1));
    if (pred[P.from[e]] < 0) out.unshift(ll[0]);
  }
  return out;
}

// ---------------- public transport ----------------

// Services per hour for a route number and period, from the GTFS timetable (departures from the first stop,
// averaged over the two directions because OSM route variants do not carry the GTFS direction).
function servicesPerHour(service, mode, ref, period) {
  const P = PERIODS[period], r = service?.[mode]?.[ref];
  if (!r) return null;
  const day = r[P.day === 'weekend' ? 'sat' : 'wk'];
  if (!day) return null;
  const dirs = Object.values(day).map(a => a[P.hour] || 0);
  const perDir = dirs.reduce((x, y) => x + y, 0) / dirs.length;
  return perDir > 0 ? { perDir, headway: 60 / perDir } : { perDir: 0, headway: null };
}

export function ptImpact(net, closures, sc, base, scen, period, service) {
  const dayKey = PERIODS[period].day;
  const g = net.veh;
  const workLinks = new Map(); // link id -> closure
  for (const c of closures) for (const l of c.allLinks || c.links) workLinks.set(l, c);
  const isClosed = lid => { const L = g.links[lid]; return (L.edgeF >= 0 && sc.closed[L.edgeF]) || (L.edgeB >= 0 && sc.closed[L.edgeB]); };
  const out = { bus: [], tram: [], stopsAffected: [], replacement: [] };
  if (!workLinks.size) return out;

  // route passes the point AND runs parallel to the work-zone link there (excludes crossing routes)
  const nearRoute = (r, m, tol) => r.geoms.some(line => {
    const xy = line.map(p => net.proj.fwd(p[0], p[1]));
    if (xy.length < 2) return false;
    const q = distPointPolyline(m.p, xy);
    return q.d < tol && axisDiff(bearingXY(xy[q.i], xy[q.i + 1]), m.brg) < 30;
  });
  const linkMid = lid => { const L = g.links[lid]; const cum = cumulativeLengths(L.xy); return pointAlong(L.xy, cum, cum[cum.length - 1] / 2); };

  // --- buses ---
  for (const r of net.routes.filter(r => r.mode === 'bus')) {
    const aff = [...workLinks.keys()].filter(l => r.wayIds.has(g.links[l].wayId) && nearRoute(r, linkMid(l), 15));
    if (!aff.length) continue;
    const closedAff = aff.filter(isClosed);
    const sv = servicesPerHour(service, 'bus', r.ref, period);
    const entry = { ref: r.ref, name: r.name, operator: r.operator, id: r.id, geoms: r.geoms, freq: sv?.perDir ?? null, headway: sv?.headway ?? null };
    if (closedAff.length) {
      const { a, b } = chainEnds(g, closedAff);
      const d1 = odTime(g, scen.time, a, b), d2 = odTime(g, scen.time, b, a);
      const baseLen = closedAff.reduce((s, l) => s + g.links[l].len, 0);
      const baseT = closedAff.reduce((s, l) => { const L = g.links[l]; const e = L.edgeF >= 0 ? L.edgeF : L.edgeB; return s + base.time[e]; }, 0);
      const det = [d1, d2].filter(d => d && d.t < Infinity).sort((x, y) => x.t - y.t)[0];
      entry.status = det ? 'Diverted' : 'Cannot divert in study area';
      entry.extraMin = det ? Math.max(0, (det.t - baseT) / 60) : null;
      entry.extraKm = det ? Math.max(0, (det.len - baseLen) / 1000) : null;
      entry.detourLL = det ? det.ll(net) : null;
      entry.stopsSkipped = r.stops.filter(s => closedAff.some(l => distPointPolyline(s.xy, g.links[l].xy).d < 25)).map(s => s.name);
    } else {
      let extra = 0;
      for (const l of aff) {
        const L = g.links[l];
        extra += Math.max(L.edgeF >= 0 ? scen.time[L.edgeF] - base.time[L.edgeF] : 0, L.edgeB >= 0 ? scen.time[L.edgeB] - base.time[L.edgeB] : 0);
      }
      entry.status = 'Delayed through work zone';
      entry.extraMin = extra / 60; entry.extraKm = 0; entry.stopsSkipped = [];
    }
    // passengers crossing the site per hour (one direction) × extra in-vehicle minutes
    entry.paxPerHour = entry.freq == null ? null : entry.freq * PT_LOAD.bus[dayKey] * THROUGH_SHARE;
    entry.paxHours = entry.paxPerHour == null ? null : (entry.extraMin || 0) / 60 * entry.paxPerHour;
    out.bus.push(entry);
  }

  // --- trams: tracks running along a work-zone link ---
  const trackLinks = [];
  for (const [lid, c] of workLinks) {
    const m = linkMid(lid);
    const onTrack = net.tram.some(t => { const r = distPointPolyline(m.p, t.xy); return r.d < 14 && axisDiff(bearingXY(t.xy[r.i], t.xy[r.i + 1]), m.brg) < 25; });
    if (onTrack) trackLinks.push({ lid, c, closed: isClosed(lid) || c.type === 'shuttle', mid: m });
  }
  if (trackLinks.length) {
    for (const r of net.routes.filter(r => r.mode === 'tram')) {
      const hits = trackLinks.filter(t => nearRoute(r, t.mid, 14));
      if (!hits.length) continue;
      const blocking = hits.filter(h => h.closed);
      const sv = servicesPerHour(service, 'tram', r.ref, period);
      const entry = { ref: r.ref, name: r.name, operator: r.operator, id: r.id, geoms: r.geoms, freq: sv?.perDir ?? null, headway: sv?.headway ?? null };
      entry.paxPerHour = entry.freq == null ? null : entry.freq * PT_LOAD.tram[dayKey] * THROUGH_SHARE;
      entry.stopsClosed = r.stops.filter(s => hits.some(h => distPointPolyline(s.xy, g.links[h.lid].xy).d < 30)).map(s => s.name);
      if (blocking.length) {
        entry.status = 'Service interrupted, trams cannot pass';
        const rep = replacementBus(net, g, scen, r, blocking.map(h => h.lid), entry.headway);
        Object.assign(entry, rep);
        // per passenger: two tram↔bus transfers at the ATAP different-mode penalty, plus waiting half a headway at
        // each transfer weighted by the TfNSW transfer-wait multiplier (equivalent in-vehicle minutes)
        entry.equivMin = entry.headway ? 2 * TRANSFER_PENALTY_MIN + 2 * MULT.transferWait * entry.headway / 2 : null;
        entry.paxHours = entry.paxPerHour == null || entry.equivMin == null ? null : entry.equivMin / 60 * entry.paxPerHour;
      } else {
        entry.status = 'Tracks inside lane closure, check clearance / speed restriction';
        entry.paxHours = 0; // no published basis for a delay value; flagged for checking
      }
      out.tram.push(entry);
    }
  }
  const allStops = new Map();
  for (const r of [...out.bus, ...out.tram]) for (const s of [...(r.stopsSkipped || []), ...(r.stopsClosed || [])]) allStops.set(s, true);
  out.stopsAffected = [...allStops.keys()];
  return out;
}

function chainEnds(g, lids) {
  const deg = new Map();
  for (const l of lids) { const L = g.links[l]; deg.set(L.a, (deg.get(L.a) || 0) + 1); deg.set(L.b, (deg.get(L.b) || 0) + 1); }
  const ends = [...deg.entries()].filter(([, d]) => d === 1).map(([n]) => n);
  const cand = ends.length >= 2 ? ends : [...deg.keys()];
  let best = [cand[0], cand[cand.length - 1]], bd = -1;
  for (const a of cand) for (const b of cand) {
    const d = Math.hypot(g.nodes[a].xy[0] - g.nodes[b].xy[0], g.nodes[a].xy[1] - g.nodes[b].xy[1]);
    if (d > bd) { bd = d; best = [a, b]; }
  }
  return { a: best[0], b: best[1] };
}

function odTime(g, time, a, b) {
  const dist = new Float64Array(g.n), pred = new Int32Array(g.n);
  dijkstra(g, a, time, dist, pred, { target: b });
  if (dist[b] === Infinity) return null;
  const edges = [];
  for (let e = pred[b]; e >= 0; e = pred[g.from[e]]) edges.push(e);
  edges.reverse();
  return {
    t: dist[b], len: edges.reduce((s, e) => s + g.len[e], 0), edges,
    ll: (net) => edges.flatMap((e, i) => { const L = g.links[g.link[e]]; const xy = g.dir[e] === 1 ? L.ll : L.ll.slice().reverse(); return i ? xy.slice(1) : xy; }),
  };
}

function replacementBus(net, g, scen, route, blockLids, headway) {
  // tram stops either side of the blockage, projected on the blocked corridor axis
  const pts = blockLids.flatMap(l => g.links[l].xy);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let ax = 0, ay = 0;
  for (const l of blockLids) { const L = g.links[l]; ax += Math.abs(L.xy[L.xy.length - 1][0] - L.xy[0][0]); ay += Math.abs(L.xy[L.xy.length - 1][1] - L.xy[0][1]); }
  const dir = ax > ay ? [1, 0] : [0, 1];
  const halfLen = Math.max(...pts.map(p => Math.abs((p[0] - cx) * dir[0] + (p[1] - cy) * dir[1])));
  let neg = null, pos = null;
  for (const s of route.stops) {
    const t = (s.xy[0] - cx) * dir[0] + (s.xy[1] - cy) * dir[1];
    if (t < -halfLen - 20 && (!neg || t > neg.t)) neg = { s, t };
    if (t > halfLen + 20 && (!pos || t < pos.t)) pos = { s, t };
  }
  if (!neg || !pos) return { replacementMin: null, replacementBuses: null, replacementNote: 'Tram stops either side of the closure are outside the study area, plan replacement buses along the full route.' };
  const nearest = xy => { let b = -1, bd = Infinity; for (const nd of g.nodes) { if (!g.scc[nd.i]) continue; const d = Math.hypot(nd.xy[0] - xy[0], nd.xy[1] - xy[1]); if (d < bd) { bd = d; b = nd.i; } } return b; };
  const a = nearest(neg.s.xy), b = nearest(pos.s.xy);
  const r1 = odTime(g, scen.time, a, b), r2 = odTime(g, scen.time, b, a);
  const t = Math.max(r1?.t || 0, r2?.t || 0) / 60;
  if (!t) return { replacementMin: null, replacementBuses: null, replacementNote: 'No road path between the tram stops either side of the closure.' };
  // fleet = round-trip running time ÷ headway (matching the tram timetable); operator layover not included
  return {
    replacementMin: t, replacementBuses: headway ? Math.ceil(2 * t / headway) : null,
    replacementFrom: neg.s.name, replacementTo: pos.s.name, replacementLL: r1 ? r1.ll(net) : r2?.ll(net),
  };
}
