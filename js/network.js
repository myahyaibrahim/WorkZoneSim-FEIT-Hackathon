// Builds simulation graphs from raw OSM (Overpass JSON):
//  - vehicle graph: directed edges between intersections with capacity, free-flow time, delay parameter
//  - pedestrian graph: walkable links (footpaths, shared paths, streets)
//  - tram tracks, bus/tram route relations and stops for public transport impacts
import { makeProjection, polylineLength, bearingXY, distPointPolyline } from './geo.js';

import { LINK_TYPES, OSM_LINK_TYPE, DEFAULT_SPEED, DEFAULT_LANES } from './standards.js';

// Road hierarchy (rank orders roads for display, detours and zoning). Capacity per lane and the Akçelik delay
// parameter J come from the link type in standards.js; lanes default to DEFAULT_LANES only where OSM has no lanes tag.
const RANK = { motorway: 1, motorway_link: 2, trunk: 2, trunk_link: 3, primary: 3, primary_link: 4, secondary: 4, secondary_link: 5,
  tertiary: 5, tertiary_link: 6, unclassified: 6, residential: 7, living_street: 8 };
const LABEL = { motorway: 'Freeway', motorway_link: 'Freeway ramp', trunk: 'Highway', trunk_link: 'Highway link', primary: 'Primary arterial',
  primary_link: 'Arterial link', secondary: 'Secondary arterial', secondary_link: 'Arterial link', tertiary: 'Collector', tertiary_link: 'Collector link',
  unclassified: 'Local road', residential: 'Local street', living_street: 'Shared zone' };
export const ROAD_CLASS = Object.fromEntries(Object.keys(RANK).map(k => {
  const lt = LINK_TYPES[OSM_LINK_TYPE[k]];
  const speed = k === 'motorway' ? DEFAULT_SPEED.freeway : k === 'living_street' ? DEFAULT_SPEED.sharedZone : DEFAULT_SPEED.builtUp;
  return [k, { rank: RANK[k], speed, capLane: lt.capLane, J: lt.J, linkType: OSM_LINK_TYPE[k], lanes: DEFAULT_LANES[k] ?? 1, label: LABEL[k] }];
}));
const PED_OK = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
  'footway', 'pedestrian', 'path', 'steps', 'cycleway', 'primary_link', 'secondary_link', 'tertiary_link']);

function vehicleAllowed(t) {
  if (!ROAD_CLASS[t.highway]) return false;
  if (t.area === 'yes') return false;
  const mv = t.motor_vehicle || t.motorcar || t.vehicle;
  if (mv === 'no' || mv === 'private') return false;
  if ((t.access === 'no' || t.access === 'private') && !(mv === 'yes' || mv === 'destination')) return false;
  return true;
}
function pedAllowed(t) {
  if (!PED_OK.has(t.highway)) return false;
  if (t.foot === 'no' || t.access === 'private') return false;
  if (t.highway === 'service' && (t.service === 'drive-through')) return false;
  return true;
}
function parseSpeed(s, def) {
  if (!s) return def;
  const m = /(\d+)\s*(mph)?/.exec(s);
  if (!m) return def;
  const v = +m[1] * (m[2] ? 1.609 : 1);
  return v >= 5 && v <= 130 ? v : def;
}
function parseLanes(s) { const v = parseInt(s, 10); return v > 0 && v < 12 ? v : 0; }

// Split ways into links between junctions, clipped to a circle. Boundary nodes (where a way leaves the
// circle) become gateways through which external traffic enters and leaves the study area.
function splitWays(ways, nodeMap, inside) {
  const use = new Map();
  for (const w of ways) {
    const ns = w.nodes;
    for (let i = 0; i < ns.length; i++) use.set(ns[i], (use.get(ns[i]) || 0) + (i === 0 || i === ns.length - 1 ? 2 : 1));
  }
  const segs = [];
  for (const w of ways) {
    const ns = w.nodes;
    let run = [], runStartBoundary = false;
    const flush = (endBoundary) => {
      if (run.length >= 2) {
        let start = 0;
        for (let i = 1; i < run.length; i++) {
          if (i === run.length - 1 || use.get(run[i]) > 1) {
            segs.push({ way: w, nodes: run.slice(start, i + 1),
              aBoundary: start === 0 && runStartBoundary, bBoundary: i === run.length - 1 && endBoundary });
            start = i;
          }
        }
      }
      run = [];
    };
    for (let i = 0; i < ns.length; i++) {
      const nd = nodeMap.get(ns[i]);
      if (nd && inside(nd)) {
        if (!run.length) runStartBoundary = i > 0;
        run.push(ns[i]);
      } else if (run.length) flush(true);
      else run = [];
    }
    flush(false);
  }
  return segs;
}

export function buildNetwork(osm, center, radius) {
  const proj = makeProjection(center[0], center[1]);
  const nodeMap = new Map();
  const ways = [], rels = [], stopNodes = [];
  for (const el of osm.elements) {
    if (el.type === 'node') {
      const prev = nodeMap.get(el.id);
      if (!prev) nodeMap.set(el.id, { id: el.id, lat: el.lat, lon: el.lon, tags: el.tags, xy: proj.fwd(el.lat, el.lon) });
      else if (el.tags && !prev.tags) prev.tags = el.tags;
    } else if (el.type === 'way') ways.push(el);
    else if (el.type === 'relation') rels.push(el);
  }
  for (const nd of nodeMap.values()) {
    const t = nd.tags;
    if (t && (t.highway === 'bus_stop' || t.railway === 'tram_stop' || t.public_transport === 'platform')) stopNodes.push(nd);
  }
  const clipR = radius * 1.08;
  const inside = nd => Math.hypot(nd.xy[0], nd.xy[1]) <= clipR;

  const vehWays = ways.filter(w => w.tags?.highway && vehicleAllowed(w.tags));
  const pedWays = ways.filter(w => w.tags?.highway && pedAllowed(w.tags));
  const tramWays = ways.filter(w => w.tags?.railway === 'tram');

  const veh = buildVehicleGraph(splitWays(vehWays, nodeMap, inside), nodeMap);
  const ped = buildPedGraph(splitWays(pedWays, nodeMap, inside), nodeMap);

  const tram = tramWays.map(w => {
    const pts = w.nodes.map(id => nodeMap.get(id)).filter(Boolean);
    return { id: w.id, ll: pts.map(p => [p.lat, p.lon]), xy: pts.map(p => p.xy) };
  }).filter(t => t.xy.length > 1);

  const wayById = new Map(ways.map(w => [w.id, w]));
  const routes = rels.map(r => {
    const t = r.tags || {};
    const wayIds = [], stopIds = [];
    for (const m of r.members || []) {
      if (m.type === 'way' && (!m.role || m.role === 'forward' || m.role === 'backward')) wayIds.push(m.ref);
      else if (m.type === 'node' && /^(stop|platform)/.test(m.role || '')) stopIds.push(m.ref);
    }
    const geoms = wayIds.map(id => wayById.get(id)).filter(Boolean)
      .map(w => w.nodes.map(id => nodeMap.get(id)).filter(Boolean).map(n => [n.lat, n.lon]));
    return { id: r.id, mode: t.route, ref: t.ref || '', name: t.name || `${t.route} ${t.ref || r.id}`, from: t.from, to: t.to,
      colour: t.colour, operator: t.operator || t.network || '', wayIds: new Set(wayIds), stopIds, geoms,
      stops: stopIds.map(id => nodeMap.get(id)).filter(n => n && inside(n)).map(n => ({ id: n.id, name: n.tags?.name || 'Stop', lat: n.lat, lon: n.lon, xy: n.xy })) };
  }).filter(r => r.geoms.length);

  const stops = stopNodes.filter(inside).map(n => ({ id: n.id, name: n.tags?.name || 'Stop', mode: n.tags?.railway === 'tram_stop' || /tram/i.test(n.tags?.tram || '') ? 'tram' : 'bus', lat: n.lat, lon: n.lon, xy: n.xy }));

  // junction control from OSM: signals are often mapped on the stop lines, so a junction is signalised when a
  // traffic_signals node lies within 30 m of it; stop / give-way signs mark the minor approach
  const signalXY = [], yieldXY = [];
  for (const nd of nodeMap.values()) {
    if (nd.tags?.highway === 'traffic_signals' || nd.tags?.crossing === 'traffic_signals' && nd.tags?.highway === 'traffic_signals') signalXY.push(nd.xy);
    else if (nd.tags?.highway === 'stop' || nd.tags?.highway === 'give_way') yieldXY.push(nd.xy);
  }
  for (const nd of veh.nodes) {
    if (nd.degree >= 3) nd.signal = signalXY.some(p => Math.hypot(p[0] - nd.xy[0], p[1] - nd.xy[1]) < 30);
  }
  veh.signalCount = veh.nodes.filter(n => n.signal).length;
  veh.osmSignals = signalXY.length;
  return { center, radius, proj, veh, ped, tram, routes, stops };
}

function makeNodeIndex(segs, nodeMap) {
  const index = new Map(), nodes = [];
  const get = (osmId, boundary) => {
    let i = index.get(osmId);
    if (i === undefined) {
      const nd = nodeMap.get(osmId);
      i = nodes.length; index.set(osmId, i);
      nodes.push({ i, osm: osmId, lat: nd.lat, lon: nd.lon, xy: nd.xy, boundary: false });
    }
    if (boundary) nodes[i].boundary = true;
    return i;
  };
  return { index, nodes, get };
}

function buildCSR(n, from, to) {
  const m = from.length, outStart = new Int32Array(n + 1), outEdge = new Int32Array(m);
  for (let e = 0; e < m; e++) outStart[from[e] + 1]++;
  for (let i = 0; i < n; i++) outStart[i + 1] += outStart[i];
  const fill = outStart.slice(0, n);
  for (let e = 0; e < m; e++) outEdge[fill[from[e]]++] = e;
  return { outStart, outEdge };
}

function buildVehicleGraph(segs, nodeMap) {
  const NI = makeNodeIndex(segs, nodeMap);
  const links = [];
  const eFrom = [], eTo = [], eLink = [], eDir = [], eLen = [], eT0 = [], eCap = [], eLanes = [], eJ = [], eRank = [], eSpeed = [];
  for (const s of segs) {
    const t = s.way.tags, cls = ROAD_CLASS[t.highway];
    const a = NI.get(s.nodes[0], s.aBoundary), b = NI.get(s.nodes[s.nodes.length - 1], s.bBoundary);
    if (a === b) continue;
    const pts = s.nodes.map(id => nodeMap.get(id));
    const xy = pts.map(p => p.xy), ll = pts.map(p => [p.lat, p.lon]);
    const len = Math.max(1, polylineLength(xy));
    const ow = t.oneway, junction = t.junction;
    let oneway = 0;
    if (ow === 'yes' || ow === 'true' || ow === '1') oneway = 1;
    else if (ow === '-1' || ow === 'reverse') oneway = -1;
    else if (ow !== 'no' && (t.highway === 'motorway' || t.highway === 'motorway_link' || junction === 'roundabout' || junction === 'circular')) oneway = 1;
    const total = parseLanes(t.lanes);
    let lf, lb;
    if (oneway) { lf = total || cls.lanes; lb = lf; }
    else {
      lf = parseLanes(t['lanes:forward']) || (total ? Math.max(1, Math.round(total / 2)) : cls.lanes);
      lb = parseLanes(t['lanes:backward']) || (total ? Math.max(1, total - lf) : cls.lanes);
    }
    const speed = parseSpeed(t.maxspeed, cls.speed);
    const link = { id: links.length, a, b, wayId: s.way.id, name: t.name || t.ref || cls.label, ref: t.ref || '', cls: t.highway, rank: cls.rank,
      ll, xy, len, oneway, lanesF: lf, lanesB: lb, speed, edgeF: -1, edgeB: -1, brg: bearingXY(xy[0], xy[xy.length - 1]) };
    const addEdge = (from, to, dir, lanes) => {
      const e = eFrom.length;
      eFrom.push(from); eTo.push(to); eLink.push(link.id); eDir.push(dir); eLen.push(len);
      eT0.push(len / (speed / 3.6)); // free-flow time at the posted limit; intersection delay comes from the Akçelik term

      eCap.push(lanes * cls.capLane); eLanes.push(lanes); eJ.push(cls.J); eRank.push(cls.rank); eSpeed.push(speed);
      return e;
    };
    if (oneway >= 0) link.edgeF = addEdge(a, b, 1, lf);
    if (oneway <= 0) link.edgeB = addEdge(b, a, -1, oneway ? lf : lb);
    links.push(link);
  }
  const n = NI.nodes.length;
  // Akçelik's function is defined per link between intersections, but OSM also splits roads where no
  // intersection exists. Convention: the delay term applies once per intersection approach, edges ending at a
  // node with 3+ connected roads. Short links (< 25 m) joining two such nodes are the inside of a divided-road
  // intersection; their queue is counted on the approach that feeds them, so they carry no delay term.
  const nbrs = Array.from({ length: n }, () => new Set());
  for (const L of links) { nbrs[L.a].add(L.b); nbrs[L.b].add(L.a); }
  NI.nodes.forEach(nd => { nd.degree = nbrs[nd.i].size; });
  const eJW = eTo.map((to, e) => nbrs[to].size < 3 ? 0 : (eLen[e] < 25 && nbrs[eFrom[e]].size >= 3 ? 0 : 1));
  const g = {
    nodes: NI.nodes, nodeIndex: NI.index, links, n, m: eFrom.length, jw: Float64Array.from(eJW),
    from: Int32Array.from(eFrom), to: Int32Array.from(eTo), link: Int32Array.from(eLink), dir: Int8Array.from(eDir),
    len: Float64Array.from(eLen), t0: Float64Array.from(eT0), cap: Float64Array.from(eCap), lanes: Int8Array.from(eLanes),
    J: Float64Array.from(eJ), rank: Int8Array.from(eRank), speed: Float64Array.from(eSpeed),
  };
  Object.assign(g, buildCSR(n, g.from, g.to));
  // reverse adjacency for upstream searches (sign / VMS placement)
  const rev = buildCSR(n, g.to, g.from);
  g.inStart = rev.outStart; g.inEdge = rev.outEdge;
  g.scc = largestSCC(g);
  return g;
}

function buildPedGraph(segs, nodeMap) {
  const NI = makeNodeIndex(segs, nodeMap);
  const links = [], eFrom = [], eTo = [], eLink = [], eLen = [];
  for (const s of segs) {
    const a = NI.get(s.nodes[0]), b = NI.get(s.nodes[s.nodes.length - 1]);
    if (a === b) continue;
    const pts = s.nodes.map(id => nodeMap.get(id));
    const xy = pts.map(p => p.xy), len = Math.max(1, polylineLength(xy));
    const hw = s.way.tags.highway;
    const link = { id: links.length, a, b, wayId: s.way.id, hw, xy, ll: pts.map(p => [p.lat, p.lon]), len,
      footway: s.way.tags.footway, service: s.way.tags.service, name: s.way.tags.name, width: parseFloat(s.way.tags.width) || null,
      brg: bearingXY(xy[0], xy[xy.length - 1]) };
    links.push(link);
    // pedestrians walk slower along steps and prefer footpaths over carriageways
    const w = len * (hw === 'steps' ? 2 : 1);
    eFrom.push(a, b); eTo.push(b, a); eLink.push(link.id, link.id); eLen.push(w, w);
  }
  const g = { nodes: NI.nodes, links, n: NI.nodes.length, m: eFrom.length,
    from: Int32Array.from(eFrom), to: Int32Array.from(eTo), link: Int32Array.from(eLink), len: Float64Array.from(eLen) };
  Object.assign(g, buildCSR(g.n, g.from, g.to));
  return g;
}

// Kosaraju (iterative). Returns Uint8Array flag for nodes in the largest strongly connected component.
function largestSCC(g) {
  const n = g.n, visited = new Uint8Array(n), order = [];
  const itStack = new Int32Array(n), nodeStack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    let sp = 0; nodeStack[0] = s; itStack[0] = g.outStart[s]; visited[s] = 1;
    while (sp >= 0) {
      const v = nodeStack[sp];
      if (itStack[sp] < g.outStart[v + 1]) {
        const w = g.to[g.outEdge[itStack[sp]++]];
        if (!visited[w]) { visited[w] = 1; sp++; nodeStack[sp] = w; itStack[sp] = g.outStart[w]; }
      } else { order.push(v); sp--; }
    }
  }
  const comp = new Int32Array(n).fill(-1);
  let nc = 0; const sizes = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const s = order[k];
    if (comp[s] >= 0) continue;
    let size = 0; const stack = [s]; comp[s] = nc;
    while (stack.length) {
      const v = stack.pop(); size++;
      for (let i = g.inStart[v]; i < g.inStart[v + 1]; i++) {
        const u = g.from[g.inEdge[i]];
        if (comp[u] < 0) { comp[u] = nc; stack.push(u); }
      }
    }
    sizes.push(size); nc++;
  }
  let best = 0;
  for (let c = 1; c < nc; c++) if (sizes[c] > sizes[best]) best = c;
  const flag = new Uint8Array(n);
  for (let i = 0; i < n; i++) flag[i] = comp[i] === best ? 1 : 0;
  return flag;
}

// Nearest vehicle link to a projected point (used for click-to-select closures).
export function nearestLink(g, p, maxD = 40, filter) {
  let best = null;
  for (const L of g.links) {
    if (filter && !filter(L)) continue;
    const r = distPointPolyline(p, L.xy);
    if (r.d < maxD && (!best || r.d < best.d)) best = { link: L, d: r.d, t: r };
  }
  return best;
}

export function nearestNode(g, p, filter) {
  let best = -1, bd = Infinity;
  for (const nd of g.nodes) {
    if (filter && !filter(nd)) continue;
    const d = Math.hypot(nd.xy[0] - p[0], nd.xy[1] - p[1]);
    if (d < bd) { bd = d; best = nd.i; }
  }
  return best;
}

// Signal control from the DTP Victorian Traffic Signals register. Intersection sites (type INT) control the graph
// junctions nearest their coordinates (all junction nodes within 30 m, or the nearest within 45 m); nodes of one site
// share one controller. Pedestrian signals (POS, FLASH PX) are listed but not modelled as vehicle control.
export function applySignalSites(net, sites) {
  const g = net.veh, P = net.proj, R = net.radius * 1.1;
  for (const nd of g.nodes) { nd.signal = false; nd.site = null; }
  const list = [];
  for (const [no, type, lat, lon, name, vols] of sites) {
    const xy = P.fwd(lat, lon);
    if (Math.hypot(xy[0], xy[1]) > R) continue;
    const site = { no, type, lat, lon, name, vols, nodes: [] };
    if (type === 'INT') {
      const cand = g.nodes.filter(nd => nd.degree >= 3).map(nd => ({ nd, d: Math.hypot(nd.xy[0] - xy[0], nd.xy[1] - xy[1]) })).filter(c => c.d < 45).sort((a, b) => a.d - b.d);
      const pick = cand.filter(c => c.d < 30);
      for (const c of (pick.length ? pick : cand.slice(0, 1))) { c.nd.signal = true; c.nd.site = no; site.nodes.push(c.nd.i); }
    }
    list.push(site);
  }
  g.signalSites = list;
  g.signalSource = 'DTP';
  g.signalCount = g.nodes.filter(n => n.signal).length;
  return list;
}
