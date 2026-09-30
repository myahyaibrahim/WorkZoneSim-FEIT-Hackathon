// Simulation pipeline: calibrated baseline -> work zone scenario (with informed / habitual drivers)
// -> network, pedestrian and public transport impacts.
import { assign, summarise, dijkstra, tracePath } from './assign.js';
import { buildOD, calibrate, calibrationStats, modelLinkFlow } from './demand.js';
import { applyScenario, selectLink, planEquipment, addQueueWarnings } from './workzone.js';
import { pedImpact, ptImpact } from './impacts.js';
import { emissions, localAmenity, heavyShares } from './econ.js';
import { QUEUE_SPACE } from './standards.js';
import { safetyImpact } from './safety.js';
import { councilOf, businessesAt } from './council.js';

export async function runBaseline(net, zones, matches, period, progress, level = 1) {
  const g = net.veh;
  const baseSc = { t0: g.t0, cap: g.cap, closed: new Uint8Array(g.m) };
  let od;
  if (matches.length) {
    progress?.('Calibrating demand to Transport Victoria counts', 0);
    ({ od } = await calibrate(net, zones, matches, period, baseSc, f => progress?.('Calibrating demand to Transport Victoria counts', f), level));
  } else {
    zones.forEach(z => { z.scale = 1; });
    od = buildOD(zones, period, level);
  }
  progress?.('Baseline equilibrium assignment', 0);
  const res = await assign(g, od, baseSc, { iters: 14, keepPaths: true, onProgress: f => progress?.('Baseline equilibrium assignment', f) });
  return { period, level, od, res, sc: baseSc, summary: summarise(g, res, od), calib: calibrationStats(net, matches, res.flow, period) };
}

function pathHash(edges) { let h = 7; for (const e of edges) h = (Math.imul(h, 31) + e) | 0; return h + ':' + edges.length; }

export async function runScenario(net, base, closures, inventory, opts, sensors, progress, matches = []) {
  const g = net.veh, od = base.od, nz = od.zones.length;
  const sc = applyScenario(g, closures);
  const sel = selectLink(g, od, base.res, sc);
  base.hv ??= heavyShares(g, matches);
  const plan = planEquipment(net, closures, sc, sel, inventory, { ...opts, baseFlow: base.res.flow });
  const informed = plan.informed;

  // Habitual drivers keep their usual route; if it is closed they divert at the last junction before the closure.
  const fixed = new Float64Array(g.m), T2 = Float64Array.from(od.T), habitual = [];
  const ff = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) ff[e] = sc.closed[e] ? Infinity : sc.t0[e];
  const spt = new Map();
  let lateUnserved = 0, lateFlow = 0, habitualFlow = 0;
  for (let q = 0; q < nz * nz; q++) {
    const ps = base.res.paths[q], T = od.T[q];
    if (!ps || !(T > 0)) continue;
    for (const p of ps) {
      let hit = false, k = -1;
      for (let i = 0; i < p.edges.length; i++) { const e = p.edges[i]; if (sc.work[e]) hit = true; if (sc.closed[e]) { k = i; break; } }
      if (!hit) continue;
      const f = T * p.share * (1 - informed);
      if (!(f > 0)) continue;
      T2[q] -= f;
      let edges = p.edges;
      if (k >= 0) {
        const x = g.from[p.edges[k]], dest = od.zones[q % nz].node;
        let s = spt.get(x);
        if (!s) { s = { dist: new Float64Array(g.n), pred: new Int32Array(g.n) }; dijkstra(g, x, ff, s.dist, s.pred); spt.set(x, s); }
        if (s.dist[dest] === Infinity) { lateUnserved += f; continue; }
        edges = Int32Array.from([...p.edges.subarray(0, k), ...tracePath(g, s.pred, dest)]);
        lateFlow += f;
      }
      habitualFlow += f;
      for (const e of edges) fixed[e] += f;
      habitual.push({ q, edges, flow: f, late: k >= 0 });
    }
  }
  const od2 = { zones: od.zones, T: T2 };
  progress?.('Work zone equilibrium assignment', 0);
  const res = await assign(g, od2, sc, { iters: 14, fixed, keepPaths: true, onProgress: f => progress?.('Work zone equilibrium assignment', f) });
  res.unserved += lateUnserved;
  res.habitual = habitual;
  const summary = summarise(g, res, od);

  // rerouted traffic: informed trips whose path differs from every baseline path + habitual late diversions
  let rerouted = lateFlow;
  for (let q = 0; q < nz * nz; q++) {
    const ps = res.paths[q];
    if (!ps || !(T2[q] > 0)) continue;
    const baseKeys = new Set((base.res.paths[q] || []).map(p => pathHash(p.edges)));
    for (const p of ps) if (!baseKeys.has(pathHash(p.edges))) rerouted += T2[q] * p.share;
  }

  // link comparison and queues
  const links = g.links.map(L => {
    const b = modelLinkFlow(g, base.res.flow, L), s = modelLinkFlow(g, res.flow, L);
    const vcOf = (flow, cap, closed) => {
      let m = 0;
      for (const e of [L.edgeF, L.edgeB]) if (e >= 0 && !closed[e] && cap[e] > 0) m = Math.max(m, flow[e] / cap[e]);
      return m;
    };
    return { id: L.id, base: b, scen: s, delta: s - b, vcBase: vcOf(base.res.flow, g.cap, base.sc.closed), vcScen: vcOf(res.flow, sc.cap, sc.closed) };
  });
  const queues = [];
  for (let e = 0; e < g.m; e++) {
    if (sc.closed[e] || !(res.flow[e] > sc.cap[e])) continue;
    const excess = res.flow[e] - sc.cap[e];
    const baseExcess = Math.max(0, base.res.flow[e] - g.cap[e]);
    if (excess - baseExcess < 20) continue;
    const lanes = Math.max(1, sc.cap[e] < g.cap[e] ? Math.round(g.lanes[e] * sc.cap[e] / g.cap[e]) : g.lanes[e]);
    const extra = excess - baseExcess; // queue growth attributable to the work zone
    const space = QUEUE_SPACE.light * (1 - base.hv.edge[e]) + QUEUE_SPACE.heavy * base.hv.edge[e]; // SIDRA default queue space
    queues.push({ e, name: g.links[g.link[e]].name, veh: extra, lengthM: Math.min(extra * space / lanes, 5000), vc: res.flow[e] / sc.cap[e] });
  }
  queues.sort((a, b) => b.lengthM - a.lengthM);
  const seenQ = new Set();
  const queuesByStreet = queues.filter(q => !seenQ.has(q.name) && seenQ.add(q.name));

  const streets = new Map();
  for (const r of links) {
    const L = g.links[r.id];
    if (L.rank > 7) continue;
    const s = streets.get(L.name) || { name: L.name, up: 0, down: 0, base: 0, scen: 0, vc: 0, rank: L.rank };
    if (r.delta > s.up) { s.up = r.delta; s.base = r.base; s.scen = r.scen; }
    if (r.delta < s.down) s.down = r.delta;
    s.vc = Math.max(s.vc, r.vcScen); s.rank = Math.min(s.rank, L.rank);
    streets.set(L.name, s);
  }
  const streetList = [...streets.values()].filter(s => s.up > 25 || s.down < -25);

  progress?.('Pedestrian and public transport impacts', 0.5);
  const ped = pedImpact(net, closures, sensors, base.period, opts.pedCount);
  const pt = ptImpact(net, closures, sc, base.res, res, base.period, opts.ptService);

  // environment: emissions before/after, rat-running onto local streets, footfall past the site
  base.env ??= emissions(g, base.res.flow, base.res.time, base.hv.edge);
  const env = { base: base.env, scen: emissions(g, res.flow, res.time, base.hv.edge), hv: base.hv };
  const edgeDCO2 = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) edgeDCO2[e] = env.scen.edgeCO2[e] - env.base.edgeCO2[e];
  env.linkDCO2 = g.links.map(L => (L.edgeF >= 0 ? edgeDCO2[L.edgeF] : 0) + (L.edgeB >= 0 ? edgeDCO2[L.edgeB] : 0));
  const amenity = localAmenity(g, links, base.period);
  const safety = opts.crashes ? safetyImpact(net, closures, links, base, opts.crashes) : null;
  addQueueWarnings(net, plan, queuesByStreet, res.flow, sc);
  // crash history on the section: the controls go into the plan (TMP 4.3), not onto a list to check later
  if (safety) {
    const st = safety.site;
    if (st.ped) plan.notes.push(`Crash history: ${st.ped} pedestrian injury crash(es) on the section (DTP). Keep a continuous fenced pedestrian route and a traffic controller at the crossing points while works are on.`);
    if (st.cyc) plan.notes.push(`Crash history: ${st.cyc} cyclist injury crash(es) on the section (DTP). WATCH FOR CYCLISTS signs on each approach; cyclists merge with traffic past the site or use the signed alternative route.`);
    if (st.ksi && !st.ped && !st.cyc) plan.notes.push(`Crash history: ${st.ksi} fatal or serious crash(es) on the section (DTP). Advance warning and the temporary speed limit start before the approach block.`);
  }
  const council = opts.crashData ? councilOf(net, closures, opts.crashData) : null;
  const businesses = opts.businesses ? businessesAt(net, closures, opts.businesses) : null;

  const dVHT = summary.vht - base.summary.vht;
  return {
    closures: closures.map(c => ({ id: c.id, label: c.label, type: c.type, direction: c.direction, lanesClosed: c.lanesClosed, footpath: c.footpath, length: c.length })),
    period: base.period, sc, sel, plan, informed, res, summary, links, queues: queuesByStreet,
    increased: streetList.filter(s => s.up > 25).sort((a, b) => b.up - a.up).slice(0, 10),
    relieved: streetList.filter(s => s.down < -25).sort((a, b) => a.down - b.down).slice(0, 5),
    rerouted, habitualFlow, lateFlow, affectedFlow: sel.total, ped, pt, warnings: sc.warnings,
    env, amenity, safety, council, businesses, noisy: !!opts.noisy, footfall: ped.pedsPerHour,
    kpi: {
      dVHT, dVKT: summary.vkt - base.summary.vkt,
      dTripMin: summary.avgTripMin - base.summary.avgTripMin,
      extraMinPerAffected: sel.total > 0 ? dVHT * 60 / sel.total : 0,
      maxQueue: queuesByStreet[0] || null,
      unserved: summary.unserved - base.summary.unserved,
    },
  };
}
