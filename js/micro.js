// Microscopic traffic simulation. Every vehicle is simulated individually on its lane:
//  - longitudinal: Intelligent Driver Model (IDM), Treiber, Hennecke & Helbing (2000)
//  - lane changing: MOBIL, Kesting, Treiber & Helbing (2007), with mandatory merges where a lane ends
//  - signals: fixed-time plans with Webster (1958) cycle length and green splits
//  - unsignalised junctions: priority by road hierarchy with gap acceptance (critical headway, HCM 6 Ch. 20)
//  - junction interiors: short links (< junctionLink) between junction nodes are crossed without stopping inside,
//    and only when there is room beyond (Road Safety Road Rules 2017 r.128); queues form on the approaches
//  - Stop/Slow shuttles: alternating one-lane operation with clearance time
// Demand: Poisson departures from the calibrated OD matrix; routes sampled from the equilibrium path sets.
// Informed drivers use work-zone paths; habitual drivers keep their usual path and re-route at the last junction
// before a closed link. Vehicles blocked for longer than a time limit are removed and counted (gridlock guard).
import { dijkstra, tracePath } from './assign.js';
import { MICRO } from './standards.js';
import { mulberry32 } from './geo.js';

const LANE_W = 3.5;

export class MicroSim {
  // mode 'base' | 'scen'; ctx = { net, od, base (macro), scen (macro, for 'scen'), closures, informed, seed }
  constructor(ctx, mode) {
    const { net, od } = ctx;
    const g = net.veh;
    this.g = g; this.mode = mode; this.t = 0; this.dt = MICRO.dt;
    this.rng = mulberry32(ctx.seed ?? 7);
    const sc = mode === 'scen' ? ctx.scen.sc : null;
    this.closed = sc ? sc.closed : new Uint8Array(g.m);
    // ---- lanes available per edge: [lo, hi] (0 = kerb lane); lane closures close the kerbside lanes
    this.lo = new Int8Array(g.m); this.hi = new Int8Array(g.m); this.vmax = new Float64Array(g.m);
    for (let e = 0; e < g.m; e++) { this.lo[e] = 0; this.hi[e] = g.lanes[e] - 1; this.vmax[e] = g.speed[e] / 3.6; }
    this.shuttle = [];
    this.workLane = new Uint8Array(g.m);
    if (mode === 'scen') for (const c of ctx.closures) {
      const dirs = c.type === 'full' || c.type === 'shuttle' ? ['ab', 'ba'] : c.direction === 'both' ? ['ab', 'ba'] : [c.direction];
      for (const d of dirs) for (const e of (d === 'ab' ? c.abEdges : c.baEdges)) {
        if (e < 0 || this.closed[e]) continue;
        if (c.type === 'lane') { this.lo[e] = Math.min(g.lanes[e] - 1, c.lanesClosed); this.workLane[e] = 1; }
        if (c.type === 'shuttle') { this.lo[e] = 0; this.hi[e] = 0; this.workLane[e] = 1; }
        this.vmax[e] = Math.min(this.vmax[e], Math.max(c.type === 'shuttle' ? 20 : 40, c.speed) / 3.6);
      }
      if (c.type === 'shuttle') this.shuttle.push(this.shuttlePlan(c, ctx.base.res.flow));
    }
    this.shuttleEntry = new Map(); // entry edge -> { plan, dir }
    for (const p of this.shuttle) { this.shuttleEntry.set(p.entryAB, { p, dir: 0 }); this.shuttleEntry.set(p.entryBA, { p, dir: 1 }); }
    // ---- lane lists: vehicles ordered front (largest pos) to back
    this.lanes = Array.from({ length: g.m }, (_, e) => Array.from({ length: g.lanes[e] }, () => []));
    this.signals = this.signalPlans(net, ctx.base.res.flow, ctx.base.period);
    this.demand = mode === 'scen' ? ctx.scen.res.flow : ctx.base.res.flow; // assigned (demand) flow per edge
    this.rank = g.rank;
    // short links are part of the junction they sit in: crossed in one move, never used as queue storage. A short
    // link that ends at a signal stop line (an approach, not inside one controller's junction) keeps its queue.
    this.box = new Uint8Array(g.m);
    for (let e = 0; e < g.m; e++) this.box[e] = g.len[e] < MICRO.junctionLink && !this.workLane[e] && (!this.signals.has(g.to[e]) || this.internal(e)) ? 1 : 0;
    // ---- demand and routes
    this.vehicles = [];
    this.pending = [];   // not yet departed, sorted by time
    this.waiting = new Map(); // first edge -> queue of vehicles waiting to enter the network
    this.buildDemand(ctx);
    this.stats = { done: [], teleported: 0, exits: new Float64Array(g.m), delay: new Float64Array(g.m), maxQueue: new Float64Array(g.m), stoppedTime: 0 };
    this.spt = new Map();
    this.ff = new Float64Array(g.m);
    for (let e = 0; e < g.m; e++) this.ff[e] = this.closed[e] ? Infinity : g.len[e] / this.vmax[e];
  }

  // ------------------------------------------------------------ demand
  buildDemand(ctx) {
    const { od, base, scen, informed } = ctx;
    const nz = od.zones.length, H = MICRO.warmup + MICRO.measure;
    const pick = ps => { let r = this.rng(), acc = 0; for (const p of ps) { acc += p.share; if (r <= acc) return p.edges; } return ps[ps.length - 1].edges; };
    let id = 0;
    for (let q = 0; q < nz * nz; q++) {
      const T = od.T[q];
      if (!(T > 0)) continue;
      const basePaths = base.res.paths[q];
      if (!basePaths || !basePaths.length) continue;
      // Poisson arrivals over the horizon
      let t = -Math.log(1 - this.rng()) * 3600 / T;
      while (t < H) {
        let route, cls = 'normal';
        if (this.mode === 'scen') {
          const informedPaths = scen.res.paths[q];
          const touches = basePaths.some(p => p.edges.some(e => scen.sc.work[e]));
          if (touches && this.rng() >= informed) { route = pick(basePaths); cls = 'habitual'; }
          else route = informedPaths && informedPaths.length ? pick(informedPaths) : pick(basePaths);
        } else route = pick(basePaths);
        if (route.length) this.pending.push({ id: id++, route: Array.from(route), dest: od.zones[q % nz].node, tDep: t, cls, rerouted: false, heavy: 0 });
        t += -Math.log(1 - this.rng()) * 3600 / T;
      }
    }
    this.pending.sort((a, b) => b.tDep - a.tDep); // pop from the end
    this.hv = ctx.hv;
  }

  // ------------------------------------------------------------ signal plans (Webster)
  signalPlans(net, flow, period) {
    const g = this.g, plans = new Map(), cluster = new Map();
    // one controller per DTP site; OSM-derived signals (fallback) are grouped by 40 m proximity
    for (const nd of g.nodes) {
      if (!nd.signal) continue;
      if (nd.site != null) { cluster.set(nd.i, 'S' + nd.site); continue; }
      let c = null;
      for (const [o, cid] of cluster) { const on = g.nodes[o]; if (on.site == null && Math.hypot(on.xy[0] - nd.xy[0], on.xy[1] - nd.xy[1]) < 40) { c = cid; break; } }
      cluster.set(nd.i, c ?? 'N' + nd.i);
    }
    this.cluster = cluster;
    const groups = new Map();
    for (const [n, cid] of cluster) { if (!groups.has(cid)) groups.set(cid, []); groups.get(cid).push(n); }
    const HOURS = ['AM', 'OFF', 'PM', 'NIGHT', 'WE'];
    const siteVol = new Map();
    for (const s of g.signalSites || []) if (s.vols) siteVol.set('S' + s.no, s.vols[HOURS.indexOf(period)]);
    const brg = e => { const L = g.links[g.link[e]]; const xy = g.dir[e] === 1 ? L.xy : L.xy.slice().reverse(); const a = xy[0], b = xy[xy.length - 1]; return Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI; };
    this.signalSource = { scats: 0, model: 0 };
    for (const [cid, nodes] of groups) {
      const nodeSet = new Set(nodes), inc = [];
      for (const n of nodes) for (let k = g.inStart[n]; k < g.inStart[n + 1]; k++) inc.push(g.inEdge[k]);
      // approaches entering the junction from outside (internal links between its own nodes are not approaches)
      const approaches = inc.filter(e => !(nodeSet.has(g.from[e]) && g.len[e] < MICRO.junctionLink));
      if (approaches.length < 2) continue;
      // phase by absolute axis of the approach link: 0 = north-south, 1 = east-west
      const phaseOf = new Map();
      for (const e of inc) { const a = ((brg(e) % 180) + 180) % 180; phaseOf.set(e, a < 45 || a >= 135 ? 0 : 1); }
      if (new Set(approaches.map(e => phaseOf.get(e))).size < 2) continue;
      // intersection demand: SCATS site volume for the analysis hour, shared across approaches by modelled flow
      const Qm = approaches.reduce((s, e) => s + (flow[e] || 0), 0), V = siteVol.get(cid);
      const k = V && Qm > 1 ? V / Qm : 1;
      V && Qm > 1 ? this.signalSource.scats++ : this.signalSource.model++;
      const y = [0, 0];
      for (const e of approaches) y[phaseOf.get(e)] = Math.max(y[phaseOf.get(e)], (flow[e] || 0) * k / (MICRO.satFlow * g.lanes[e]));
      const L = MICRO.lostTimePerPhase * 2, Y = Math.min(0.9, y[0] + y[1]);
      let C = Math.min(MICRO.cycleMax, Math.max(MICRO.cycleMin, (1.5 * L + 5) / (1 - Y)));
      const eff = C - L, ys = (y[0] + y[1]) || 1;
      const g0 = Math.max(MICRO.minGreen, eff * (y[0] || ys / 2) / ys), g1 = Math.max(MICRO.minGreen, eff * (y[1] || ys / 2) / ys);
      C = g0 + g1 + L;
      const plan = { C, g: [g0, g1], lost: MICRO.lostTimePerPhase, offset: this.rng() * C, phaseOf, site: cid, volume: V ?? null, approaches, nodes, k };
      for (const n of nodes) plans.set(n, plan);
    }
    return plans;
  }

  // a link inside a signalised junction (short, between two nodes of the same controller) has no stop line of its own
  internal(e) { const c = this.cluster; return c && this.g.len[e] < MICRO.junctionLink && c.has(this.g.from[e]) && c.has(this.g.to[e]) && c.get(this.g.from[e]) === c.get(this.g.to[e]); }
  isGreen(node, e) {
    if (this.internal(e)) return true;
    const p = this.signals.get(node);
    if (!p) return true;
    const ph = p.phaseOf.get(e);
    if (ph === undefined) return true;
    const t = (this.t + p.offset) % p.C;
    const start0 = 0, end0 = p.g[0], start1 = p.g[0] + p.lost, end1 = start1 + p.g[1];
    return ph === 0 ? t >= start0 && t < end0 : t >= start1 && t < end1;
  }

  // displayed state of a signal head: green, then amber for the first seconds of the intergreen, then red
  signalState(node, e) {
    const p = this.signals.get(node), ph = p?.phaseOf.get(e);
    if (!p || ph === undefined) return 'green';
    const t = (this.t + p.offset) % p.C, amber = Math.min(MICRO.amber, p.lost);
    const [s, en] = ph === 0 ? [0, p.g[0]] : [p.g[0] + p.lost, p.g[0] + p.lost + p.g[1]];
    if (t >= s && t < en) return 'green';
    const after = (t - en + p.C) % p.C;
    return after < amber ? 'amber' : 'red';
  }

  // Stop/Slow shuttle: alternating green for each direction with clearance for the site length
  shuttlePlan(c, flow) {
    const ab = c.abEdges.filter(e => e >= 0), ba = c.baEdges.filter(e => e >= 0);
    const qa = Math.max(1, ...ab.map(e => flow[e] || 0)), qb = Math.max(1, ...ba.map(e => flow[e] || 0));
    const clear = c.length / (20 / 3.6) + 2;
    const L = 2 * clear, Y = Math.min(0.9, (qa + qb) / MICRO.satFlow);
    const C = Math.min(MICRO.cycleMax * 1.5, Math.max(MICRO.cycleMin, (1.5 * L + 5) / (1 - Y)));
    const eff = Math.max(2 * MICRO.minGreen, C - L);
    return { entryAB: ab[0], entryBA: ba[0], C, gA: eff * qa / (qa + qb), gB: eff * qb / (qa + qb), clear, edges: new Set([...ab, ...ba]) };
  }
  shuttleOpen(e) {
    const s = this.shuttleEntry.get(e);
    if (!s) return true;
    const p = s.p, t = this.t % p.C;
    return s.dir === 0 ? t < p.gA : t >= p.gA + p.clear && t < p.gA + p.clear + p.gB;
  }

  // ------------------------------------------------------------ IDM
  idm(v, v0, s, dv, heavy) {
    const P = heavy ? MICRO.heavy : MICRO.car;
    const sStar = P.s0 + Math.max(0, v * P.T + v * dv / (2 * Math.sqrt(P.a * P.b)));
    return P.a * (1 - Math.pow(v / Math.max(0.1, v0), 4) - (sStar / Math.max(0.1, s)) ** 2);
  }

  nextEdge(veh) { return veh.i + 1 < veh.route.length ? veh.route[veh.i + 1] : -1; }
  targetLane(lane, e) { return Math.max(this.lo[e], Math.min(this.hi[e], lane)); }
  // lane on edge n for a vehicle leaving edge e in lane `lane`: lanes are shared out in proportion where the lane
  // count changes (4 into 2: lanes 0–1 feed 0, lanes 2–3 feed 1). Work-zone lane closures keep the direct mapping,
  // so vehicles in closed lanes merge before the taper (laneEnds).
  mapLane(lane, e, n) {
    if (this.workLane[n] || this.workLane[e]) return this.targetLane(lane, n);
    const ne = this.hi[e] - this.lo[e] + 1, nn = this.hi[n] - this.lo[n] + 1;
    if (ne === nn) return this.targetLane(this.lo[n] + lane - this.lo[e], n);
    return this.targetLane(this.lo[n] + Math.floor((lane - this.lo[e] + 0.5) * nn / ne), n);
  }
  // a lane "ends" (mandatory merge before the edge end) only where the work zone closes lanes on the next edge;
  // ordinary drops in OSM lane counts are merged at the junction
  laneEnds(lane, n) { return this.workLane[n] && (lane < this.lo[n] || lane > this.hi[n]); }

  // junction control for the movement e -> n at node to[e]: closure, signal, Stop/Slow shuttle, give way.
  // The gap to vehicles beyond the junction is handled by the car-following model, and room by passage().
  control(veh, e, n) {
    const g = this.g;
    if (n < 0) return true;
    if (this.closed[n]) return false;
    const node = g.to[e];
    if (!this.isGreen(node, e)) return false;
    if (!this.shuttleOpen(n)) return false;
    // give way to higher-order approaches at unsignalised junctions
    if (!this.signals.has(node) && !this.cluster.has(node)) {
      let top = 99;
      for (let k = g.inStart[node]; k < g.inStart[node + 1]; k++) { const ie = g.inEdge[k]; if (g.link[ie] !== g.link[n]) top = Math.min(top, g.rank[ie]); }
      if (g.rank[e] > top) {
        // entering the priority road: yield to priority vehicles heading into the same edge (merge); crossing it:
        // yield to all moving priority traffic
        const crossing = g.rank[n] > top;
        for (let k = g.inStart[node]; k < g.inStart[node + 1]; k++) {
          const ie = g.inEdge[k];
          if (ie === e || g.rank[ie] > top) continue;
          for (const ln of this.lanes[ie]) {
            const f = ln[0];
            if (!f || f.v <= 2 || (g.len[ie] - f.pos) / f.v >= MICRO.criticalHeadway) continue;
            const fn = f.route[f.i + 1];
            if (crossing || fn === n) return false;
          }
        }
      }
    }
    return true;
  }


  // Crossing the junction at the end of edge e: follows the route through junction-interior links, checking the
  // control at every node. Returns null when a control holds the vehicle, else the landing route index t
  // (route.length = trip ends inside the junction), its lane and the metres of junction crossed.
  passage(veh, e) {
    const R = veh.route;
    let cur = e, j = veh.i + 1, lane = veh.lane, skip = 0;
    while (j < R.length) {
      const n = R[j];
      if (!this.control(veh, cur, n)) return null;
      lane = this.mapLane(lane, cur, n);
      if (!this.box[n] || j === R.length - 1) return { t: j, lane, skip };
      skip += this.g.len[n]; cur = n; j++;
    }
    return { t: j, lane, skip };
  }
  mayEnter(veh, e, n) { return this.control(veh, e, n); }

  // leader of vehicle at index k in lane list L on edge e: returns { gap, dv }
  leader(veh, e, L, k) {
    if (k > 0) { const f = L[k - 1]; return { gap: f.pos - f.len - veh.pos, v: f.v }; }
    const g = this.g, toEnd = g.len[e] - veh.pos;
    const n = this.nextEdge(veh);
    if (n < 0) return { gap: 1e6, v: veh.v }; // destination
    const p = this.passage(veh, e);
    if (!p) return { gap: toEnd, v: 0 };
    if (p.t >= veh.route.length) return { gap: 1e6, v: veh.v };
    const land = veh.route[p.t];
    // lane ends (not available on the landing edge): hold at the end until merged
    if (this.laneEnds(veh.lane, land)) return { gap: toEnd, v: 0 };
    const ln = this.lanes[land][p.lane], last = ln[ln.length - 1];
    return last ? { gap: toEnd + p.skip + last.pos - last.len, v: last.v } : { gap: toEnd + p.skip + 200, v: this.vmax[land] };
  }

  accel(veh, e, L, k) {
    const ld = this.leader(veh, e, L, k);
    return this.idm(veh.v, this.vmax[e], ld.gap, veh.v - ld.v, veh.heavy);
  }

  // ------------------------------------------------------------ MOBIL lane changes
  laneChanges(e) {
    const g = this.g, lanes = this.lanes[e], P = MICRO.mobil;
    const n = null;
    for (let li = this.lo[e]; li <= this.hi[e]; li++) {
      const L = lanes[li];
      for (let k = 0; k < L.length; k++) {
        const veh = L[k];
        if (veh.lcCool > 0) continue;
        const nx = this.nextEdge(veh);
        const mustLeave = nx >= 0 && this.laneEnds(li, nx) && g.len[e] - veh.pos < MICRO.mergeDistance;
        const aOld = this.accel(veh, e, L, k);
        let best = null;
        for (const d of [-1, 1]) {
          const tl = li + d;
          if (tl < this.lo[e] || tl > this.hi[e]) continue;
          if (nx >= 0 && this.laneEnds(tl, nx) && !this.laneEnds(li, nx)) continue; // don't move into an ending lane
          const T = lanes[tl];
          let j = 0; while (j < T.length && T[j].pos > veh.pos) j++;
          const lead = j > 0 ? T[j - 1] : null, fol = j < T.length ? T[j] : null;
          if (lead && lead.pos - lead.len - veh.pos < 1) continue;
          if (fol && veh.pos - veh.len - fol.pos < 1) continue;
          // new follower deceleration must stay safe
          const folNew = fol ? this.idm(fol.v, this.vmax[e], veh.pos - veh.len - fol.pos, fol.v - veh.v, fol.heavy) : 0;
          if (folNew < -P.bSafe) continue;
          const gapNew = lead ? lead.pos - lead.len - veh.pos : (g.len[e] - veh.pos + 200);
          const aNew = this.idm(veh.v, this.vmax[e], gapNew, veh.v - (lead ? lead.v : this.vmax[e]), veh.heavy);
          const folOld = fol ? this.idm(fol.v, this.vmax[e], lead ? lead.pos - lead.len - fol.pos : 200, fol.v - (lead ? lead.v : this.vmax[e]), fol.heavy) : 0;
          const incentive = aNew - aOld + P.politeness * (folNew - folOld) + (mustLeave ? P.mandatoryBias : 0);
          if (incentive > P.threshold && (!best || incentive > best.inc)) best = { tl, j, inc: incentive };
        }
        if (best) {
          L.splice(k, 1); k--;
          lanes[best.tl].splice(best.j, 0, veh);
          veh.lane = best.tl; veh.lcCool = MICRO.laneChangeCooldown;
        }
      }
    }
  }

  // ------------------------------------------------------------ routing for habitual drivers
  reroute(veh) {
    const g = this.g;
    const rest = veh.route.slice(veh.i + 1);
    if (!rest.some(e => this.closed[e])) return;
    const from = g.to[veh.route[veh.i]];
    let s = this.spt.get(from);
    if (!s) { s = { dist: new Float64Array(g.n), pred: new Int32Array(g.n) }; dijkstra(g, from, this.ff, s.dist, s.pred); this.spt.set(from, s); }
    if (s.dist[veh.dest] === Infinity) { veh.route = veh.route.slice(0, veh.i + 1); return; }
    veh.route = [...veh.route.slice(0, veh.i + 1), ...tracePath(g, s.pred, veh.dest)];
    veh.rerouted = true;
  }

  // ------------------------------------------------------------ main step
  step() {
    const g = this.g, dt = this.dt;
    // departures
    while (this.pending.length && this.pending[this.pending.length - 1].tDep <= this.t) {
      const p = this.pending.pop();
      const heavy = this.rng() < (this.hv ? this.hv[p.route[0]] : 0) ? 1 : 0;
      const veh = { ...p, i: 0, lane: 0, pos: 0, v: 0, len: heavy ? MICRO.heavy.len : MICRO.car.len, heavy, lcCool: 0, stuck: 0, ff: 0, stopped: 0 };
      for (const e of veh.route) veh.ff += g.len[e] / this.vmax[e];
      const q = this.waiting.get(veh.route[0]) || [];
      q.push(veh); this.waiting.set(veh.route[0], q);
    }
    // insertions at the start of the first edge
    for (const [e, q] of this.waiting) {
      while (q.length) {
        const veh = q[0];
        let bestLane = -1, bestGap = -1;
        for (let li = this.lo[e]; li <= this.hi[e]; li++) {
          const L = this.lanes[e][li], last = L[L.length - 1];
          const gap = last ? last.pos - last.len : g.len[e];
          if (gap > bestGap) { bestGap = gap; bestLane = li; }
        }
        if (bestLane < 0 || bestGap < veh.len + MICRO.car.s0 + 2 || this.closed[e]) break;
        q.shift();
        veh.lane = bestLane; veh.pos = 0;
        const L = this.lanes[e][bestLane], last = L[L.length - 1];
        veh.v = Math.min(this.vmax[e], last ? last.v : this.vmax[e]);
        veh.tEnter = this.t; veh.tEdge = this.t;
        L.push(veh);
        this.vehicles.push(veh);
        if (veh.cls === 'habitual') this.reroute(veh);
      }
    }
    // lane changes every second
    if (Math.round(this.t / dt) % 2 === 0) for (let e = 0; e < g.m; e++) if (this.hi[e] > this.lo[e] && this.lanes[e].some(l => l.length)) this.laneChanges(e);
    // accelerations
    for (let e = 0; e < g.m; e++) {
      const lanes = this.lanes[e];
      for (let li = 0; li < lanes.length; li++) {
        const L = lanes[li];
        for (let k = 0; k < L.length; k++) { const veh = L[k]; veh.acc = Math.max(-9, this.accel(veh, e, L, k)); }
      }
    }
    // move, then transfer across nodes (front vehicles first)
    const measuring = this.t >= MICRO.warmup;
    for (let e = 0; e < g.m; e++) {
      const lanes = this.lanes[e];
      for (let li = 0; li < lanes.length; li++) {
        const L = lanes[li];
        for (let k = 0; k < L.length; k++) {
          const veh = L[k];
          const v1 = Math.max(0, veh.v + veh.acc * dt);
          veh.pos += Math.max(0, (veh.v + v1) / 2 * dt);
          veh.v = v1;
          if (veh.lcCool > 0) veh.lcCool -= dt;
          if (veh.v < 0.5) { veh.stuck += dt; if (measuring) this.stats.stoppedTime += dt; } else veh.stuck = 0;
        }
      }
    }
    for (let e = 0; e < g.m; e++) {
      const lanes = this.lanes[e];
      for (let li = 0; li < lanes.length; li++) {
        const L = lanes[li];
        while (L.length && L[0].pos >= g.len[e]) {
          const veh = L[0];
          const n = this.nextEdge(veh);
          if (n < 0) { L.shift(); this.arrive(veh, false); continue; }
          const p = this.passage(veh, e), R = veh.route;
          const land = p && p.t < R.length ? R[p.t] : -1;
          const T0 = land >= 0 ? this.lanes[land][p.lane] : null, lastN = T0 ? T0[T0.length - 1] : null;
          const newPos = veh.pos - g.len[e];
          // r.128: enter the junction only when there is room on the link beyond it
          if (!p || (land >= 0 && (this.laneEnds(veh.lane, land) || (lastN && lastN.pos - lastN.len < newPos + 0.5)))) { veh.pos = g.len[e]; veh.v = Math.min(veh.v, lastN ? lastN.v : 0); break; }
          L.shift();
          if (measuring) {
            for (let j = veh.i; j < Math.min(p.t, R.length); j++) this.stats.exits[R[j]]++;
            this.stats.delay[e] += Math.max(0, this.t - veh.tEdge - g.len[e] / this.vmax[e]);
          }
          veh.tEdge = this.t;
          if (land < 0) { this.arrive(veh, false); continue; }
          veh.pos = newPos; veh.i = p.t; veh.lane = p.lane;
          const T = this.lanes[land][veh.lane];
          T.push(veh);
          if (veh.cls === 'habitual' && !veh.rerouted) this.reroute(veh);
        }
        // keep lane lists ordered (front first) after the moves
        for (let k = 1; k < L.length; k++) if (L[k].pos > L[k - 1].pos) { const x = L[k]; let j = k; while (j > 0 && L[j - 1].pos < x.pos) { L[j] = L[j - 1]; j--; } L[j] = x; }
        // physical queue: stopped vehicles contiguous from the front
        if (measuring && Math.round(this.t) % 10 === 0 && L.length && L[0].v < 1.5) {
          let j = 0; while (j < L.length && L[j].v < 1.5) j++;
          const qlen = g.len[e] - L[j - 1].pos + L[j - 1].len;
          if (qlen > this.stats.maxQueue[e]) this.stats.maxQueue[e] = qlen;
        }
        // gridlock guard
        if (L.length && L[0].stuck > MICRO.teleportTime) { const veh = L.shift(); this.arrive(veh, true); }
      }
    }
    this.t += dt;
  }

  arrive(veh, teleported) {
    veh.tArr = this.t; veh.teleported = teleported;
    if (teleported) this.stats.teleported++;
    this.stats.done.push(veh);
  }

  active() { let n = 0; for (const lanes of this.lanes) for (const L of lanes) n += L.length; return n; }

  // run the full horizon (warm-up + measurement), yielding to the UI
  async run(onProgress) {
    const H = MICRO.warmup + MICRO.measure;
    let lastYield = performance.now();
    while (this.t < H) {
      this.step();
      if (performance.now() - lastYield > 40) { onProgress?.(this.t / H); await new Promise(r => setTimeout(r, 0)); lastYield = performance.now(); }
    }
    return this.summary();
  }

  // Signalised intersection performance in the measured hour, per approach: degree of saturation (demand ÷ saturation
  // flow × lanes × g/C, with demand = assigned flow scaled to the SCATS site volume as for the signal timing; under
  // congestion the flow that gets through understates demand), average delay (time on the approach link minus
  // free-flow time), and the longest queue. Keyed by DTP site so baseline and work zone runs can be compared.
  intersections(flows) {
    const g = this.g, out = [];
    for (const p of new Set(this.signals.values())) {
      const site = (g.signalSites || []).find(s => 'S' + s.no === p.site);
      const app = p.approaches.map(e => {
        const ph = p.phaseOf.get(e), cap = MICRO.satFlow * g.lanes[e] * p.g[ph] / p.C, f = flows[e], dem = (this.demand[e] || 0) * p.k;
        return { e, name: g.links[g.link[e]].name, flow: f, demand: dem, cap, dos: cap > 0 ? dem / cap : 0, delay: f > 0 ? this.stats.delay[e] / f : 0, queue: this.stats.maxQueue[e] };
      });
      const flow = app.reduce((a, x) => a + x.flow, 0);
      out.push({ key: p.site, name: site ? site.name : app.map(a => a.name).filter((v, i, a) => a.indexOf(v) === i).join(' / '), siteNo: site?.no ?? null,
        cycle: p.C, flow, delay: flow > 0 ? app.reduce((a, x) => a + x.delay * x.flow, 0) / flow : 0,
        dos: Math.max(0, ...app.map(a => a.dos)), queue: Math.max(0, ...app.map(a => a.queue)), approaches: app });
    }
    return out;
  }

  summary() {
    const g = this.g, W = MICRO.warmup, H = W + MICRO.measure;
    // vehicles departing within the measurement hour: completed trips, plus time so far for those still travelling
    const measured = [];
    for (const v of this.stats.done) if (v.tDep >= W && v.tDep < H) measured.push({ tt: v.tArr - v.tDep, ff: v.ff, done: !v.teleported, cls: v.cls, rer: v.rerouted });
    for (const lanes of this.lanes) for (const L of lanes) for (const v of L) if (v.tDep >= W && v.tDep < H) measured.push({ tt: this.t - v.tDep, ff: v.ff, done: false, cls: v.cls, rer: v.rerouted });
    for (const q of this.waiting.values()) for (const v of q) if (v.tDep >= W && v.tDep < H) measured.push({ tt: this.t - v.tDep, ff: v.ff, done: false, cls: v.cls, rer: false });
    const n = measured.length || 1;
    const vht = measured.reduce((s, m) => s + m.tt, 0) / 3600;
    const delay = measured.reduce((s, m) => s + Math.max(0, m.tt - m.ff), 0) / 3600;
    const flows = this.stats.exits; // veh per measurement hour
    return {
      trips: measured.length, completed: measured.filter(m => m.done).length, vht, delayVh: delay,
      meanTT: measured.reduce((s, m) => s + m.tt, 0) / n / 60, meanDelay: delay * 3600 / n / 60,
      teleported: this.stats.teleported, rerouted: measured.filter(m => m.rer).length,
      flows, maxQueue: this.stats.maxQueue, stoppedHours: this.stats.stoppedTime / 3600,
      signals: new Set([...this.signals.values()]).size, signalsScats: this.signalSource.scats,
      intersections: this.intersections(flows),
      served: measured.length ? measured.filter(m => m.done).length / measured.length : 0,
    };
  }
}
