// Traffic assignment: shortest paths + Method of Successive Averages (MSA) user equilibrium
// with the Akcelik time-dependent link delay function (T = 1 h analysis period).

export class MinHeap {
  constructor(cap = 1024) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.size = 0; }
  clear() { this.size = 0; }
  push(key, val) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2), v = new Int32Array(this.size * 2);
      k.set(this.k); v.set(this.v); this.k = k; this.v = v;
    }
    let i = this.size++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() { // returns value; key available as this.lastKey
    const K = this.k, V = this.v;
    const topV = V[0]; this.lastKey = K[0];
    const n = --this.size;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return topV;
  }
}

const heap = new MinHeap(4096);

// Single-source shortest paths over a CSR graph. cost[e] = Infinity marks a closed edge.
// opts.maxCost stops the search early; opts.reverse walks incoming edges (upstream search).
export function dijkstra(g, src, cost, dist, pred, opts = {}) {
  dist.fill(Infinity); pred.fill(-1);
  const rev = !!opts.reverse;
  const start = rev ? g.inStart : g.outStart, list = rev ? g.inEdge : g.outEdge, far = rev ? g.from : g.to;
  const maxCost = opts.maxCost ?? Infinity, target = opts.target ?? -1;
  heap.clear();
  const sources = Array.isArray(src) ? src : [src];
  for (const s of sources) { dist[s] = 0; heap.push(0, s); }
  while (heap.size) {
    const v = heap.pop(), d = heap.lastKey;
    if (d > dist[v]) continue;
    if (v === target || d > maxCost) break;
    for (let i = start[v], end = start[v + 1]; i < end; i++) {
      const e = list[i], c = cost[e];
      if (c === Infinity) continue;
      const nd = d + c, w = far[e];
      if (nd < dist[w]) { dist[w] = nd; pred[w] = e; heap.push(nd, w); }
    }
  }
}

// Edge ids of the path src->dst from a predecessor array (forward search).
export function tracePath(g, pred, dst) {
  const out = [];
  let e = pred[dst], guard = 0;
  while (e >= 0 && guard++ < 100000) { out.push(e); e = pred[g.from[e]]; }
  return out.reverse();
}

// Akcelik link travel time (s). x = v/c, T = 1 h, J = delay parameter, w = junction weight.
export function linkTime(t0, v, cap, J, w = 1) {
  if (!(cap > 0)) return Infinity;
  const x = v / cap;
  return t0 + w * 900 * ((x - 1) + Math.sqrt((x - 1) * (x - 1) + 8 * J * x / cap));
}

export function computeTimes(g, sc, flow, out) {
  const t = out || new Float64Array(g.m), jw = sc.jw || g.jw;
  for (let e = 0; e < g.m; e++) t[e] = sc.closed[e] ? Infinity : linkTime(sc.t0[e], flow[e], sc.cap[e], g.J[e], jw[e]);
  return t;
}

const tick = () => new Promise(r => setTimeout(r, 0));

// od = { zones: [{node}], T: Float64Array(nz*nz) } in veh/h
// sc = { t0, cap, closed } per edge
// opts = { iters, fixed (Float64Array of pre-loaded flows), keepPaths, onProgress(frac) }
export async function assign(g, od, sc, opts = {}) {
  const iters = opts.iters ?? 12, m = g.m, n = g.n, nz = od.zones.length;
  const flow = new Float64Array(m), aux = new Float64Array(m), load = new Float64Array(m);
  const fixed = opts.fixed;
  const cost = new Float64Array(m), dist = new Float64Array(n), pred = new Int32Array(n);
  const paths = opts.keepPaths ? new Array(nz * nz) : null;
  let unserved = 0, gap = 0;
  for (let k = 1; k <= iters; k++) {
    for (let e = 0; e < m; e++) load[e] = flow[e] + (fixed ? fixed[e] : 0);
    computeTimes(g, sc, load, cost);
    aux.fill(0);
    let sptCost = 0;
    unserved = 0;
    for (let i = 0; i < nz; i++) {
      const row = i * nz;
      let any = false;
      for (let j = 0; j < nz; j++) if (od.T[row + j] > 0) { any = true; break; }
      if (!any) continue;
      dijkstra(g, od.zones[i].node, cost, dist, pred);
      for (let j = 0; j < nz; j++) {
        const T = od.T[row + j];
        if (!(T > 0) || i === j) continue;
        const dn = od.zones[j].node;
        if (dist[dn] === Infinity) { unserved += T; continue; }
        sptCost += T * dist[dn];
        let e = pred[dn], h = 7, len = 0;
        const rec = paths ? [] : null;
        while (e >= 0) {
          aux[e] += T;
          if (rec) { rec.push(e); h = (Math.imul(h, 31) + e) | 0; }
          len++;
          e = pred[g.from[e]];
        }
        if (paths) {
          let pm = paths[row + j];
          if (!pm) pm = paths[row + j] = new Map();
          const key = h + ':' + len, p = pm.get(key);
          if (p) p.count++; else pm.set(key, { edges: Int32Array.from(rec.reverse()), count: 1 });
        }
      }
      if ((i & 7) === 7) { opts.onProgress?.((k - 1 + i / nz) / iters); await tick(); }
    }
    // relative gap before the averaging step: (current total cost - shortest path cost) / current total cost
    let cur = 0;
    for (let e = 0; e < m; e++) if (flow[e] > 0 && cost[e] < Infinity) cur += flow[e] * cost[e];
    if (k > 1) gap = cur > 0 ? Math.max(0, (cur - sptCost) / cur) : 0;
    const step = 1 / k;
    for (let e = 0; e < m; e++) flow[e] += step * (aux[e] - flow[e]);
    opts.onProgress?.(k / iters);
  }
  const total = new Float64Array(m);
  for (let e = 0; e < m; e++) total[e] = flow[e] + (fixed ? fixed[e] : 0);
  const time = computeTimes(g, sc, total);
  // normalise stored paths into per-OD shares
  let odPaths = null;
  if (paths) {
    odPaths = new Array(nz * nz);
    for (let q = 0; q < paths.length; q++) {
      const pm = paths[q];
      if (!pm) continue;
      let tot = 0;
      for (const p of pm.values()) tot += p.count;
      odPaths[q] = [...pm.values()].map(p => ({ edges: p.edges, share: p.count / tot })).sort((a, b) => b.share - a.share);
    }
  }
  return { flow: total, assigned: flow, time, unserved, gap, paths: odPaths };
}

// Network performance indicators for one assignment result.
export function summarise(g, res, od) {
  let vkt = 0, vht = 0, vhtFree = 0;
  for (let e = 0; e < g.m; e++) {
    const f = res.flow[e];
    if (!(f > 0)) continue;
    vkt += f * g.len[e] / 1000;
    if (res.time[e] < Infinity) { vht += f * res.time[e] / 3600; vhtFree += f * g.t0[e] / 3600; }
  }
  let trips = 0;
  for (let q = 0; q < od.T.length; q++) trips += od.T[q];
  const served = trips - res.unserved;
  return { vkt, vht, delay: vht - vhtFree, trips, served, unserved: res.unserved,
    avgTripMin: served > 0 ? vht / served * 60 : 0, avgSpeed: vht > 0 ? vkt / vht : 0 };
}
