// Work zones: closure definition, scenario network edits and the temporary traffic management (TTM)
// equipment plan, barriers, signage, VMS, arrow boards and traffic controllers, checked against inventory.
// Layout rules are indicative and follow common Victorian practice (AS 1742.3 / DTP worksite code); they are
// planning estimates, not a certified traffic management plan.
import { MinHeap, dijkstra } from './assign.js';
import { hcmWorkZoneCapacity, shuttleCapacity, LANE_NEED, signSpacingD, taperLength, coneSpacing, DEFAULT_LANE_WIDTH, INFO, CRASH_DETOUR_PENALTY } from './standards.js';
import { normName, pointAlong, cumulativeLengths, bearingXY, distPointPolyline, axisDiff, angleDiff } from './geo.js';

export const INVENTORY = [
  { key: 'barrier',     label: 'Water-filled barrier',           stock: 120, unitLen: 2.0 },
  { key: 'cone',        label: 'Traffic cones / bollards',        stock: 200 },
  { key: 'fence',       label: 'Pedestrian mesh fence panel',    stock: 60, unitLen: 2.4 },
  { key: 'sign_rwa',    label: '“ROADWORK AHEAD” sign',           stock: 16 },
  { key: 'sign_closed', label: '“ROAD CLOSED” sign',              stock: 8 },
  { key: 'sign_detour', label: '“DETOUR” arrow sign',             stock: 24 },
  { key: 'sign_end',    label: '“END ROADWORK / END DETOUR”',     stock: 12 },
  { key: 'sign_speed',  label: '40 km/h roadwork speed sign',     stock: 10 },
  { key: 'sign_lane',   label: '“LANE CLOSED” / merge sign',      stock: 6 },
  { key: 'sign_stop',   label: '“PREPARE TO STOP” sign',          stock: 4 },
  { key: 'sign_fp',     label: '“FOOTPATH CLOSED” sign',          stock: 8 },
  { key: 'vms',         label: 'VMS board (trailer)',             stock: 3 },
  { key: 'arrow',       label: 'Arrow board (trailer)',           stock: 2 },
  { key: 'tc',          label: 'Traffic controllers (persons)',   stock: 4 },
];

export const CLOSURE_TYPES = {
  full:      'Full road closure',
  direction: 'One direction closed',
  lane:      'Lane closure',
  shuttle:   'Single-lane shuttle (Stop/Slow)',
};

const LANE_W = DEFAULT_LANE_WIDTH;

// ---------- selecting a closure between two clicked points ----------

let undCache = null;
function undirected(g) {
  if (undCache?.g === g) return undCache;
  const adj = Array.from({ length: g.n }, () => []);
  for (const L of g.links) { adj[L.a].push([L.id, L.b]); adj[L.b].push([L.id, L.a]); }
  return (undCache = { g, adj });
}

// Shortest chain of links between two nodes, strongly preferring links on the named street.
export function selectChain(g, aNode, bNode, street) {
  if (aNode === bNode) return null;
  const { adj } = undirected(g);
  const want = normName(street);
  const dist = new Float64Array(g.n).fill(Infinity), prevLink = new Int32Array(g.n).fill(-1), prevNode = new Int32Array(g.n).fill(-1);
  const h = new MinHeap(256);
  dist[aNode] = 0; h.push(0, aNode);
  while (h.size) {
    const v = h.pop(), d = h.lastKey;
    if (d > dist[v]) continue;
    if (v === bNode) break;
    for (const [lid, w] of adj[v]) {
      const L = g.links[lid];
      const nd = d + L.len * (want && normName(L.name) === want ? 1 : 25);
      if (nd < dist[w]) { dist[w] = nd; prevLink[w] = lid; prevNode[w] = v; h.push(nd, w); }
    }
  }
  if (dist[bNode] === Infinity) return null;
  const links = [], nodes = [bNode];
  for (let v = bNode; v !== aNode; v = prevNode[v]) { links.push(prevLink[v]); nodes.push(prevNode[v]); }
  return { links: links.reverse(), nodes: nodes.reverse() };
}

let seq = 1;
// Build a closure from a selected chain. Short cross-street pieces inside intersections are dropped, and on
// divided roads the parallel carriageway is added so a "full closure" really closes both sides.
export function makeClosure(g, chain, props = {}) {
  const street = normName(props.street || g.links[chain.links[0]].name);
  const poly = [];
  chain.links.forEach((lid, k) => {
    const L = g.links[lid], xy = L.a === chain.nodes[k] ? L.xy : L.xy.slice().reverse();
    poly.push(...(k ? xy.slice(1) : xy));
  });
  const cum = cumulativeLengths(poly), total = cum[cum.length - 1];
  const posOf = xy => { const r = distPointPolyline(xy, poly); return { s: cum[r.i] + r.t * (cum[r.i + 1] - cum[r.i]), d: r.d, brg: bearingXY(poly[r.i], poly[r.i + 1]) }; };
  const edgeMid = e => { const L = g.links[g.link[e]]; return L.xy[L.xy.length >> 1]; };

  const keep = chain.links.map((lid, k) => ({ lid, u: chain.nodes[k] }))
    .filter(({ lid }) => { const L = g.links[lid]; return normName(L.name) === street || L.len >= 35; });
  const ab = [], ba = [];
  for (const { lid, u } of keep) {
    const L = g.links[lid];
    ab.push(L.a === u ? L.edgeF : L.edgeB);
    ba.push(L.a === u ? L.edgeB : L.edgeF);
  }
  const inChain = new Set(chain.links), twinLinks = [];
  for (const L of g.links) {
    if (inChain.has(L.id) || !L.oneway || normName(L.name) !== street) continue;
    const p = posOf(L.xy[L.xy.length >> 1]);
    if (p.d > 32 || p.s < 2 || p.s > total - 2) continue;
    const e = L.edgeF >= 0 ? L.edgeF : L.edgeB;
    const eb = bearingXY(L.xy[0], L.xy[L.xy.length - 1]) + (L.edgeF >= 0 ? 0 : 180);
    if (axisDiff(eb, p.brg) > 25) continue;
    twinLinks.push(L.id);
    if (angleDiff(eb, p.brg) < 90) ab.push(e); else ba.push(e);
  }
  const order = (list, asc) => list.filter(e => e >= 0).map(e => ({ e, s: posOf(edgeMid(e)).s })).sort((x, y) => asc ? x.s - y.s : y.s - x.s).map(x => x.e);
  const links = keep.map(k => k.lid);
  const names = [...new Set(links.map(l => g.links[l].name))];
  const first = g.links[links[0]];
  return {
    id: seq++, label: names.slice(0, 2).join(' / '), street: props.street || first.name,
    links, nodes: keep.map(k => k.u), twinLinks, allLinks: [...links, ...twinLinks],
    abEdges: order(ab, true), baEdges: order(ba, false), length: total, poly,
    type: 'full', direction: 'both', lanesClosed: 1, footpath: 'open', speed: 40, delineation: 'cone',
    ...props,
  };
}

export function closureDirs(c) {
  if (c.type === 'full' || c.type === 'shuttle') return ['ab', 'ba'];
  return c.direction === 'both' ? ['ab', 'ba'] : [c.direction];
}

// ---------- scenario network ----------

export function applyScenario(g, closures) {
  const sc = { t0: Float64Array.from(g.t0), cap: Float64Array.from(g.cap), jw: Float64Array.from(g.jw), closed: new Uint8Array(g.m), work: new Uint8Array(g.m), warnings: [] };
  for (const c of closures) {
    for (const d of closureDirs(c)) {
      for (const e of d === 'ab' ? c.abEdges : c.baEdges) {
        if (e < 0) continue;
        sc.work[e] = 1;
        const base = g.cap[e] / g.lanes[e], freeway = g.links[g.link[e]].cls === 'motorway';
        if (c.type === 'full' || c.type === 'direction') { sc.closed[e] = 1; continue; }
        if (c.type === 'lane') {
          const left = g.lanes[e] - c.lanesClosed;
          if (left <= 0) { sc.closed[e] = 1; sc.warnings.push(`${c.label}: closing ${c.lanesClosed} lane(s) removes all lanes in one direction, treated as a direction closure.`); continue; }
          // freeways: HCM 6 work zone queue discharge rate; urban roads: open lanes at AGTM mid-block capacity
          sc.cap[e] = freeway ? left * hcmWorkZoneCapacity(left, g.lanes[e], { barrier: c.delineation === 'barrier' }) : left * base;
        } else if (c.type === 'shuttle') {
          // QGTTM Pt 3 Table 5.4: maximum two-way volume for the shuttle length, shared by both directions
          const cap2 = shuttleCapacity(c.length);
          if (cap2 == null) sc.warnings.push(`${c.label}: a ${Math.round(c.length)} m Stop/Slow shuttle exceeds the 800 m maximum in QGTTM Part 3 Table 5.4: use portable signals or a closure.`);
          sc.cap[e] = (cap2 ?? 300) / 2;
        }
        sc.jw[e] = 1; // the work zone itself is the bottleneck, wherever it sits
        sc.t0[e] = g.len[e] / (Math.min(g.speed[e], c.speed) / 3.6);
      }
    }
  }
  return sc;
}

// ---------- geometry helpers ----------

function edgeXY(g, e) { const L = g.links[g.link[e]]; return g.dir[e] === 1 ? L.xy : L.xy.slice().reverse(); }
function leftNormal(brg) { const r = brg * Math.PI / 180; return [-Math.cos(r), Math.sin(r)]; }
function roadWidth(L) { return (L.oneway ? L.lanesF : L.lanesF + L.lanesB) * LANE_W; }
function toLL(net, p) { return net.proj.inv(p[0], p[1]); }

// point at distance d from the START of edge e, pushed sideways (+ = left of travel)
function edgePoint(net, e, d, side = 0) {
  const g = net.veh, xy = edgeXY(g, e), cum = cumulativeLengths(xy);
  const r = pointAlong(xy, cum, Math.max(0, Math.min(d, cum[cum.length - 1])));
  const n = leftNormal(r.brg);
  return { ll: toLL(net, [r.p[0] + n[0] * side, r.p[1] + n[1] * side]), brg: r.brg, xy: r.p };
}

// ---------- select-link analysis: baseline traffic that uses the work zone ----------

export function selectLink(g, od, base, sc) {
  const slf = new Float64Array(g.m);
  let total = 0;
  const nz = od.zones.length;
  for (let q = 0; q < nz * nz; q++) {
    const ps = base.paths?.[q];
    if (!ps || !(od.T[q] > 0)) continue;
    for (const p of ps) {
      let hit = false;
      for (const e of p.edges) if (sc.work[e]) { hit = true; break; }
      if (!hit) continue;
      const v = od.T[q] * p.share;
      total += v;
      for (const e of p.edges) slf[e] += v;
    }
  }
  return { slf, total };
}

// ---------- equipment plan ----------

export function planEquipment(net, closures, sc, sel, inventory, opts = {}) {
  const g = net.veh;
  const unitLen = k => inventory.find(i => i.key === k)?.unitLen || 2;
  const req = Object.fromEntries(inventory.map(i => [i.key, 0]));
  const markers = [], lines = [], detours = [], notes = [];
  const add = (k, n = 1) => { req[k] += n; };
  const rwaSpots = new Set();
  // links with a fatal, serious, pedestrian or cyclist crash on record (DTP) cost more in the detour search
  const risk = new Uint8Array(g.m);
  if (opts.crashLinks) for (let e = 0; e < g.m; e++) risk[e] = opts.crashLinks.has(g.link[e]) ? 1 : 0;
  const rwaEdges = new Set();
  const entryNodes = new Set();

  for (const c of closures) {
    const workLinks = new Set(c.allLinks);
    const isClosure = c.type === 'full' || c.type === 'direction';
    const dirs = closureDirs(c);

    if (isClosure) {
      // entry points: closed edges whose start node can still be reached by open traffic
      const barrierAt = new Map();
      for (const d of dirs) {
        for (const e of d === 'ab' ? c.abEdges : c.baEdges) {
          if (e < 0 || !sc.closed[e]) continue;
          const v = g.from[e];
          let open = false;
          for (let k = g.inStart[v]; k < g.inStart[v + 1]; k++) {
            const ie = g.inEdge[k];
            if (!sc.closed[ie] && !workLinks.has(g.link[ie])) { open = true; break; }
          }
          if (!open) continue;
          entryNodes.add(v);
          const key = v + ':' + g.link[e];
          if (!barrierAt.has(key)) barrierAt.set(key, { v, e, full: c.type === 'full' });
          // advance warning on every open approach into the entry node
          for (let k = g.inStart[v]; k < g.inStart[v + 1]; k++) {
            const ie = g.inEdge[k];
            if (sc.closed[ie] || workLinks.has(g.link[ie]) || rwaEdges.has(ie)) continue;
            rwaEdges.add(ie);
            const L = g.links[g.link[ie]];
            const D2 = 2 * signSpacingD(g.speed[ie]); // single advance sign at 2 × D (QGTTM Pt 3 Table 2.2)
            // a short approach block: the sign goes back onto the previous block(s), one on every street turning in
            for (const sp of upstreamSpots(g, sc, workLinks, ie, D2)) {
              const key = sp.e + ':' + Math.round(sp.at);
              if (rwaSpots.has(key)) continue;
              rwaSpots.add(key);
              const pos = edgePoint(net, sp.e, sp.at, roadWidth(g.links[g.link[sp.e]]) / 2 + 1.5);
              markers.push({ kind: 'sign', item: 'sign_rwa', ll: pos.ll, text: 'ROADWORK AHEAD',
                sub: sp.short ? `${D2} m before the closure (approach shorter, place on the previous block)` : sp.e === ie ? `${D2} m before the closure` : `${D2} m before the closure, on ${g.links[g.link[sp.e]].name}`, closure: c.id });
              add('sign_rwa');
            }
          }
        }
      }
      for (const { v, e, full } of barrierAt.values()) {
        const L = g.links[g.link[e]];
        const W = full ? roadWidth(L) : g.lanes[e] * LANE_W;
        const nBar = Math.ceil(W / unitLen('barrier'));
        add('barrier', nBar); add('sign_closed'); add('sign_detour');
        const mid = edgePoint(net, e, 6, 0);
        const n = leftNormal(mid.brg);
        const a = full ? [mid.xy[0] + n[0] * W / 2, mid.xy[1] + n[1] * W / 2] : mid.xy;
        const b = full ? [mid.xy[0] - n[0] * W / 2, mid.xy[1] - n[1] * W / 2] : [mid.xy[0] + n[0] * W, mid.xy[1] + n[1] * W];
        lines.push({ kind: 'barrier', ll: [toLL(net, a), toLL(net, b)], count: nBar, closure: c.id });
        markers.push({ kind: 'sign', item: 'sign_closed', ll: edgePoint(net, e, 9, W / 2 + 1.5).ll, text: 'ROAD CLOSED', sub: `${nBar} barriers across ${W.toFixed(1)} m`, closure: c.id });
      }
      // signed detour route per closed direction
      for (const d of dirs) {
        const es = (d === 'ab' ? c.abEdges : c.baEdges).filter(e => e >= 0 && sc.closed[e]);
        if (!es.length) continue;
        const from = g.from[es[0]], to = g.to[es[es.length - 1]];
        const det = detourRoute(g, sc, from, to, risk);
        if (!det) { notes.push(`${c.label} (${d.toUpperCase()}): no detour available inside the study area.`); continue; }
        const turns = detourTurns(g, det.edges);
        add('sign_detour', turns.length); add('sign_end');
        detours.push({ closure: c.id, dir: d, edges: det.edges, len: det.len, riskNames: [...new Set(det.edges.filter(e => risk[e]).map(e => g.links[g.link[e]].name))], ll: det.edges.flatMap((e, i) => { const xy = edgeXY(g, e); return (i ? xy.slice(1) : xy).map(p => toLL(net, p)); }) });
        for (const t of turns) markers.push({ kind: 'sign', item: 'sign_detour', ll: edgePoint(net, t.e, 8, roadWidth(g.links[g.link[t.e]]) / 2 + 1.5).ll, text: 'DETOUR', sub: t.dir, arrow: t.dir, closure: c.id });
        const last = det.edges[det.edges.length - 1];
        markers.push({ kind: 'sign', item: 'sign_end', ll: edgePoint(net, last, g.len[last] * 0.6, roadWidth(g.links[g.link[last]]) / 2 + 1.5).ll, text: 'END DETOUR', closure: c.id });
      }
    } else {
      // lane closure / shuttle: tapers, delineation, signs per direction of travel
      for (const d of dirs) {
        const es = (d === 'ab' ? c.abEdges : c.baEdges).filter(e => e >= 0);
        if (!es.length) continue;
        const e0 = es[0], eN = es[es.length - 1], v0 = g.from[e0];
        entryNodes.add(v0);
        const spd = g.speed[e0], lanes = g.lanes[e0], len = es.reduce((s, e) => s + g.len[e], 0);
        const shift = (c.type === 'lane' ? c.lanesClosed : 1) * LANE_W;
        const Lt = taperLength(spd, shift), sp = coneSpacing(spd);
        const W = roadWidth(g.links[g.link[e0]]);
        add('cone', Math.ceil(Lt / sp) + 1); // merge taper (TN195)
        if (c.delineation === 'barrier') add('barrier', Math.ceil(len / unitLen('barrier'))); else add('cone', Math.ceil(len / sp) + 1);
        add('sign_speed'); add('sign_end');
        // open lanes needed for the traffic (QGTTM Pt 3 Table 2.4)
        if (c.type === 'lane' && opts.baseFlow) {
          const open = lanes - c.lanesClosed, peak = Math.max(...es.map(e => opts.baseFlow[e]));
          if (open > 0 && peak > open * LANE_NEED.midblock) notes.push(`${c.label} (${d.toUpperCase()}): ${Math.round(peak)} veh/h needs ${Math.ceil(peak / LANE_NEED.midblock)} open lane(s) mid-block (QGTTM Pt 3 Table 2.4) but only ${open} remain. Expect queues; consider off-peak or night works.`);
        }
        // upstream approach carrying most work-zone traffic
        let up = -1, best = -1;
        for (let k = g.inStart[v0]; k < g.inStart[v0 + 1]; k++) {
          const ie = g.inEdge[k];
          if (g.link[ie] === g.link[e0]) continue;
          const f = sel.slf[ie] + (g.links[g.link[ie]].name === g.links[g.link[e0]].name ? 1e6 : 0);
          if (f > best) { best = f; up = ie; }
        }
        const signEdge = up >= 0 ? up : e0;
        // sign sequence at spacing D (QGTTM Pt 3 Table 2.2): ROADWORK AHEAD at 2D, LANE CLOSED / PREPARE TO STOP at D
        const D = signSpacingD(spd);
        const at = dist => up >= 0 ? Math.max(0, g.len[up] - dist) : 0;
        markers.push({ kind: 'sign', item: 'sign_rwa', ll: edgePoint(net, signEdge, at(2 * D), W / 2 + 1.5).ll, text: 'ROADWORK AHEAD', sub: `${2 * D} m before the taper`, closure: c.id }); add('sign_rwa');
        if (c.type === 'lane') {
          add('sign_lane');
          markers.push({ kind: 'sign', item: 'sign_lane', ll: edgePoint(net, signEdge, at(D), W / 2 + 1.5).ll, text: 'LANE CLOSED', sub: `${D} m before the taper; taper ${Math.round(Lt)} m, cones every ${sp} m`, closure: c.id });
          if (lanes >= 2 && spd >= 60) {
            add('arrow');
            markers.push({ kind: 'arrow', item: 'arrow', ll: edgePoint(net, e0, 4, lanes * LANE_W * 0.5).ll, text: 'Arrow board', closure: c.id });
          }
        } else {
          add('sign_stop'); add('tc');
          markers.push({ kind: 'tc', item: 'tc', ll: edgePoint(net, e0, 3, W / 2 + 1).ll, text: 'Traffic controller (STOP/SLOW)', closure: c.id });
          markers.push({ kind: 'sign', item: 'sign_stop', ll: edgePoint(net, signEdge, at(D), W / 2 + 1.5).ll, text: 'PREPARE TO STOP', sub: `${D} m before the controller`, closure: c.id });
        }
        markers.push({ kind: 'sign', item: 'sign_speed', ll: edgePoint(net, e0, Math.min(Lt, g.len[e0] * 0.5), W / 2 + 1.5).ll, text: `${c.speed}`, closure: c.id });
        markers.push({ kind: 'sign', item: 'sign_end', ll: edgePoint(net, eN, g.len[eN] * 0.9, W / 2 + 1.5).ll, text: 'END ROADWORK', closure: c.id });
        // closed lane footprint (left lane of the direction of travel, taper first)
        const off = c.type === 'lane' ? (lanes - c.lanesClosed) * LANE_W + LANE_W / 2 : LANE_W / 2;
        const pts = [];
        for (const e of es) {
          const xy = edgeXY(g, e), cum = cumulativeLengths(xy), tot = cum[cum.length - 1];
          for (let s = 0; s <= tot; s += Math.max(4, tot / 20)) {
            const r = pointAlong(xy, cum, s), n = leftNormal(r.brg);
            pts.push(toLL(net, [r.p[0] + n[0] * off, r.p[1] + n[1] * off]));
          }
        }
        lines.push({ kind: c.delineation === 'barrier' ? 'barrier' : 'cones', ll: pts, closure: c.id });
      }
      if (c.type === 'shuttle' && opts.baseFlow) {
        const twoWay = Math.max(0, ...c.abEdges.map(e => opts.baseFlow[e] || 0)) + Math.max(0, ...c.baEdges.map(e => opts.baseFlow[e] || 0));
        const max = shuttleCapacity(c.length);
        if (max != null && twoWay > max) notes.push(`${c.label}: ${Math.round(twoWay)} veh/h two-way exceeds the ${max} veh/h limit for a ${Math.round(c.length)} m Stop/Slow shuttle (QGTTM Pt 3 Table 5.4).`);
      }
    }

    // footpath closures
    if (c.footpath !== 'open') {
      const sides = c.footpath === 'both' ? [1, -1] : [c.footpath === 'left' ? 1 : -1];
      for (const s of sides) {
        add('fence', Math.ceil(c.length / unitLen('fence'))); add('sign_fp', 2);
        const pts = [];
        c.links.forEach((lid, k) => {
          const L = g.links[lid], xy = L.a === c.nodes[k] ? L.xy : L.xy.slice().reverse();
          const W = roadWidth(L) / 2 + 2.5, cum = cumulativeLengths(xy), tot = cum[cum.length - 1];
          for (let d = 0; d <= tot; d += Math.max(4, tot / 20)) {
            const r = pointAlong(xy, cum, d), n = leftNormal(r.brg);
            pts.push(toLL(net, [r.p[0] + n[0] * W * s, r.p[1] + n[1] * W * s]));
          }
        });
        lines.push({ kind: 'fence', ll: pts, closure: c.id });
        markers.push({ kind: 'sign', item: 'sign_fp', ll: pts[0], text: 'FOOTPATH CLOSED', sub: 'use other side', closure: c.id });
        markers.push({ kind: 'sign', item: 'sign_fp', ll: pts[pts.length - 1], text: 'FOOTPATH CLOSED', sub: 'use other side', closure: c.id });
      }
    }
  }

  // ---- VMS: advance information on the approaches that feed the work zone ----
  const vms = placeVMS(net, sc, sel, [...entryNodes], closures, opts);
  add('vms', vms.required);

  // ---- inventory check ----
  const stock = Object.fromEntries(inventory.map(i => [i.key, +i.stock || 0]));
  const items = inventory.map(i => ({ ...i, required: req[i.key], shortfall: Math.max(0, req[i.key] - stock[i.key]) })).filter(i => i.required > 0 || i.stock > 0);
  // line equipment: stock is laid along the lines in order; the part beyond it stays on the plan, flagged (avail < 1),
  // so the gap on site is visible
  const LINE_KEY = { barrier: 'barrier', cones: 'cone', fence: 'fence' };
  const lenLL = ll => { let d = 0; for (let i = 1; i < ll.length; i++) { const a = net.proj.fwd(ll[i - 1][0], ll[i - 1][1]), b = net.proj.fwd(ll[i][0], ll[i][1]); d += Math.hypot(b[0] - a[0], b[1] - a[1]); } return d; };
  for (const [kind, key] of Object.entries(LINE_KEY)) {
    const ls = lines.filter(l => l.kind === kind);
    if (!ls.length || !req[key]) continue;
    const w = ls.map(l => l.count || lenLL(l.ll)), total = w.reduce((a, b) => a + b, 0);
    let left = Math.min(1, stock[key] / req[key]) * total;
    ls.forEach((l, i) => { const have = Math.max(0, Math.min(w[i], left)); left -= have; l.avail = w[i] > 0 ? have / w[i] : 1; });
  }
  const vmsPlaced = vms.sites.slice(0, Math.min(vms.required, stock.vms));
  for (const s of vms.sites.slice(0, vms.required)) markers.push({ ...s, kind: 'vms', item: 'vms', missing: !vmsPlaced.includes(s) });
  // flag signs/arrow boards/controllers that exceed stock as "missing"
  const used = {};
  for (const mk of markers) {
    if (mk.kind === 'vms') continue;
    used[mk.item] = (used[mk.item] || 0) + 1;
    if (stock[mk.item] !== undefined && used[mk.item] > stock[mk.item]) mk.missing = true;
  }
  const cov = k => req[k] ? Math.min(1, stock[k] / req[k]) : 1;
  const signCoverage = Math.min(cov('sign_rwa'), cov('sign_detour'), cov('sign_closed'));
  const vmsCoverage = sel.total > 0 ? Math.min(1, vmsPlaced.reduce((s, v) => s + v.flow, 0) / sel.total) : (vmsPlaced.length ? 1 : 0);
  // informed = 1 − (1 − navigation users, if the closure is published) × (1 − VMS diversion × VMS coverage)
  const nav = opts.prenotify ? INFO.nav : 0;
  const informed = 1 - (1 - nav) * (1 - INFO.vms * vmsCoverage);
  if (closures.length) notes.push('Victorian Worksite Code Cl. 17: consider a road safety barrier for long-term works and for excavations deeper than 250 mm close to traffic.');
  for (const i of items) if (i.shortfall) notes.push(`Shortfall: ${i.label}, need ${i.required}, stock ${i.stock} (${i.shortfall} short).`);
  if (req.tc > stock.tc) notes.push('Not enough traffic controllers to run the Stop/Slow shuttle safely, the plan is not deployable as drawn.');
  return { items, markers, lines, detours, notes, informed, signCoverage, vmsCoverage, vmsRequired: vms.required, vmsPlaced: vmsPlaced.length };
}

// Detour search on the open network, weighted to keep diverted traffic on higher-order roads.
const CLASS_PEN = [1, 1, 1, 1, 1.1, 1.35, 1.8, 2.6, 4];
// Advance sign spots D metres before the end of edge ie: on ie if it is long enough, otherwise on each street
// feeding it (up to three blocks back). A spot that still does not fit is flagged short.
function upstreamSpots(g, sc, workLinks, ie, D) {
  if (g.len[ie] >= D) return [{ e: ie, at: g.len[ie] - D }];
  const out = [];
  const walk = (e, rem, depth) => {
    const preds = [];
    for (let k = g.inStart[g.from[e]]; k < g.inStart[g.from[e] + 1]; k++) {
      const p = g.inEdge[k];
      if (sc.closed[p] || workLinks.has(g.link[p]) || g.from[p] === g.to[e]) continue; // no closed, work or U-turn links
      preds.push(p);
    }
    if (!preds.length || depth > 3) { out.push({ e, at: 0, short: true }); return; }
    for (const p of preds.sort((a, b) => g.rank[a] - g.rank[b]).slice(0, 3)) {
      if (g.len[p] >= rem) out.push({ e: p, at: g.len[p] - rem });
      else walk(p, rem - g.len[p], depth + 1);
    }
  };
  walk(ie, D - g.len[ie], 1);
  return out;
}

// Queue-end warning: a PREPARE TO STOP sign D metres before the end of each queue that reaches back past the previous
// intersection, placed along the approach that carries the most traffic.
export function addQueueWarnings(net, plan, queues, flow, sc) {
  const g = net.veh, placed = [];
  for (const q of queues.filter(q => q.lengthM > g.len[q.e]).slice(0, 3)) {
    const D = signSpacingD(g.speed[q.e]);
    let e = q.e, rem = q.lengthM + D, guard = 0;
    while (rem > g.len[e] && guard++ < 15) {
      rem -= g.len[e];
      let best = -1;
      for (let k = g.inStart[g.from[e]]; k < g.inStart[g.from[e] + 1]; k++) {
        const p = g.inEdge[k];
        if (sc.closed[p] || g.from[p] === g.to[e]) continue;
        if (best < 0 || (flow[p] || 0) > (flow[best] || 0)) best = p;
      }
      if (best < 0) { rem = g.len[e]; break; }
      e = best;
    }
    const pos = edgePoint(net, e, Math.max(0, g.len[e] - rem), roadWidth(g.links[g.link[e]]) / 2 + 1.5);
    plan.markers.push({ kind: 'sign', item: 'sign_stop', ll: pos.ll, text: 'PREPARE TO STOP', sub: `queue end warning: ${Math.round(q.lengthM)} m queue on ${q.name}`, queue: true });
    placed.push({ name: q.name, lengthM: q.lengthM, on: g.links[g.link[e]].name });
  }
  if (placed.length) {
    const it = plan.items.find(i => i.key === 'sign_stop');
    if (it) { it.required += placed.length; it.shortfall = Math.max(0, it.required - it.stock); }
    let used = 0;
    for (const mk of plan.markers) if (mk.item === 'sign_stop') { used++; if (it && used > it.stock) mk.missing = true; }
  }
  plan.queueWarnings = placed;
  return placed;
}

function detourRoute(g, sc, from, to, risk) {
  const cost = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) cost[e] = sc.closed[e] ? Infinity : sc.t0[e] * CLASS_PEN[g.rank[e]] * (risk && risk[e] ? CRASH_DETOUR_PENALTY : 1);
  // if the closure starts/ends mid-carriageway, back off to nearby open junctions (up to ~200 m)
  const near = (start, rev) => {
    const out = [start], seen = new Set(out); let frontier = [start], d = 0;
    while (frontier.length && d++ < 4) {
      const next = [];
      for (const v of frontier) {
        const s0 = rev ? g.inStart : g.outStart, list = rev ? g.inEdge : g.outEdge, far = rev ? g.from : g.to;
        for (let k = s0[v]; k < s0[v + 1]; k++) {
          const e = list[k], w = far[e];
          if (sc.closed[e] || seen.has(w)) continue;
          seen.add(w); out.push(w); next.push(w);
        }
      }
      frontier = next;
    }
    return out;
  };
  const dist = new Float64Array(g.n), pred = new Int32Array(g.n);
  dijkstra(g, near(from, true), cost, dist, pred);
  let best = -1, bd = Infinity;
  for (const t of near(to, false)) if (dist[t] < bd) { bd = dist[t]; best = t; }
  if (best < 0) return null;
  const edges = [];
  for (let e = pred[best]; e >= 0; e = pred[g.from[e]]) edges.push(e);
  edges.reverse();
  if (!edges.length) return null;
  return { edges, len: edges.reduce((s, e) => s + g.len[e], 0) };
}

function detourTurns(g, edges) {
  const turns = [{ e: edges[0], dir: 'start' }];
  for (let i = 1; i < edges.length; i++) {
    const a = edgeXY(g, edges[i - 1]), b = edgeXY(g, edges[i]);
    const b1 = bearingXY(a[Math.max(0, a.length - 2)], a[a.length - 1]), b2 = bearingXY(b[0], b[1]);
    let d = ((b2 - b1 + 540) % 360) - 180;
    if (Math.abs(d) > 35) turns.push({ e: edges[i], dir: d > 0 ? 'right' : 'left' });
  }
  return turns;
}

function placeVMS(net, sc, sel, entries, closures, opts) {
  const g = net.veh;
  if (!entries.length || !(sel.total > 0)) return { required: 0, sites: [] };
  const needs = closures.some(c => c.type === 'full' || c.type === 'direction') || sel.total > 400;
  if (!needs) return { required: 0, sites: [] };
  const dist = new Float64Array(g.n), pred = new Int32Array(g.n);
  const cost = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) cost[e] = sc.work[e] ? Infinity : g.len[e];
  dijkstra(g, entries, cost, dist, pred, { reverse: true, maxCost: 2000 });
  const clusters = new Map();
  for (let e = 0; e < g.m; e++) {
    if (sc.work[e] || g.rank[e] > 5 || sel.slf[e] < sel.total * 0.08) continue;
    const du = dist[g.to[e]];
    if (!(du >= 120 && du <= 1500)) continue;
    const L = g.links[g.link[e]];
    const xy = edgeXY(g, e), brg = bearingXY(xy[0], xy[xy.length - 1]);
    const key = normName(L.name) + ':' + Math.round(brg / 60);
    const score = sel.slf[e] * (1 - Math.abs(du - 450) / 3000);
    const c = clusters.get(key);
    if (!c || score > c.score) clusters.set(key, { e, score, flow: sel.slf[e], du, name: L.name, brg });
  }
  const sorted = [...clusters.values()].sort((a, b) => b.score - a.score);
  const sites = [];
  for (const c of sorted) {
    const pos = edgePoint(net, c.e, g.len[c.e] * 0.5, roadWidth(g.links[g.link[c.e]]) / 2 + 3);
    if (sites.some(s => Math.hypot(s.xy[0] - pos.xy[0], s.xy[1] - pos.xy[1]) < 250)) continue;
    sites.push({ e: c.e, ll: pos.ll, xy: pos.xy, flow: c.flow, text: 'VMS', sub: `${c.name}, ${Math.round(c.du)} m upstream, ${Math.round(c.flow)} veh/h bound for work zone`, message: opts.vmsMessage });
  }
  const significant = sites.filter(s => s.flow >= sel.total * 0.15).length;
  return { required: Math.max(1, Math.min(opts.maxVms ?? 4, significant)), sites };
}
