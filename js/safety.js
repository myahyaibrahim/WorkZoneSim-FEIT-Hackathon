// Road safety from observed crashes (DTP Victoria road crash data): crash history at the work site and on the
// streets that take diverted traffic, and the change in expected crash cost from the change in vehicle-km by road
// type. Crash rates are observed rates, not predictions for the work zone itself (see CRASH in standards.js).
import { CRASH, CRASH_ROAD_TYPE } from './standards.js';
import { modelLinkFlow, PERIODS } from './demand.js';
import { distPointPolyline } from './geo.js';

const TYPES = ['freeway', 'arterial', 'local'];

// [2019, 2021, 2022, 2023, 2024] -> "2019 and 2021–2024"
export function yearsLabel(ys) {
  const runs = [];
  for (const y of ys) { const r = runs[runs.length - 1]; if (r && y === r[1] + 1) r[1] = y; else runs.push([y, y]); }
  const t = runs.map(([a, b]) => a === b ? `${a}` : `${a}–${b}`);
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}` : t[0];
}
const GENERIC = /^(Local street|Local road|Shared zone|Collector|Primary arterial|Secondary arterial|Highway|Freeway.*|.*link)$/;

// Snap each crash within the network to the nearest road link (grid index, CRASH.matchDist).
export function matchCrashes(net, data) {
  if (!data?.rows) return null;
  const g = net.veh, cell = 100, pad = CRASH.matchDist, grid = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const L of g.links) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of L.xy) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
    for (let i = Math.floor((a - pad) / cell); i <= Math.floor((c + pad) / cell); i++)
      for (let j = Math.floor((b - pad) / cell); j <= Math.floor((d + pad) / cell); j++) {
        const k = i + ',' + j;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(L);
      }
  }
  const [la0, lo0] = net.proj.inv(x0, y0), [la1, lo1] = net.proj.inv(x1, y1);
  const list = [];
  for (const r of data.rows) {
    if (r[0] < la0 || r[0] > la1 || r[1] < lo0 || r[1] > lo1) continue;
    const p = net.proj.fwd(r[0], r[1]);
    let best = null, bd = pad;
    for (const L of grid.get(Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell)) || []) {
      const d = distPointPolyline(p, L.xy).d;
      if (d < bd) { bd = d; best = L; }
    }
    if (best) list.push({ ll: [r[0], r[1]], year: r[2], sev: r[3], ped: r[4], cyc: r[5], moto: r[6], link: best.id });
  }
  const byLink = new Map();
  for (const c of list) { if (!byLink.has(c.link)) byLink.set(c.link, []); byLink.get(c.link).push(c); }
  return { list, byLink, years: data.years };
}

export function crashSummary(cs) {
  const s = { n: cs.length, fatal: 0, serious: 0, other: 0, ksi: 0, ped: 0, cyc: 0, moto: 0 };
  for (const c of cs) {
    if (c.sev === 1) s.fatal++; else if (c.sev === 2) s.serious++; else s.other++;
    if (c.sev <= 2) s.ksi++;
    if (c.ped) s.ped++; if (c.cyc) s.cyc++; if (c.moto) s.moto++;
  }
  return s;
}

// Observed cost per million vehicle-km by road type. Exposure = modelled baseline hourly flow ÷ the SCATS hour share
// of AADT × 365 × number of crash years. Road types with fewer than CRASH.minCrashes use TfNSW Table 5.1.
export function crashRates(net, crashes, base) {
  const g = net.veh, share = PERIODS[base.period].aadtShare, days = 365 * crashes.years.length;
  const T = Object.fromEntries(TYPES.map(t => [t, { n: 0, ksi: 0, cost: 0, mvkt: 0 }]));
  for (const L of g.links) T[CRASH_ROAD_TYPE(L.cls)].mvkt += modelLinkFlow(g, base.res.flow, L) / share * days * L.len / 1e9;
  for (const c of crashes.list) {
    const t = T[CRASH_ROAD_TYPE(g.links[c.link].cls)];
    t.n++; t.cost += CRASH.costPerCrash[c.sev]; if (c.sev <= 2) t.ksi++;
  }
  for (const [k, t] of Object.entries(T)) {
    t.observed = t.mvkt > 0 ? t.cost / t.mvkt : null;
    t.crashPerMvkt = t.mvkt > 0 ? t.n / t.mvkt : null;
    t.fromData = t.n >= CRASH.minCrashes && t.observed != null;
    t.costPerMvkt = t.fromData ? t.observed : CRASH.avgCostPerMvkt[k];
  }
  return T;
}

// links: per-link baseline / scenario flows from runScenario (veh/h, two-way).
export function safetyImpact(net, closures, links, base, crashes) {
  const g = net.veh;
  base.crashRates ??= crashRates(net, crashes, base);
  const rates = base.crashRates;
  const dMvkt = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (const r of links) { const L = g.links[r.id]; dMvkt[CRASH_ROAD_TYPE(L.cls)] += r.delta * L.len / 1e9; }
  let costPerHour = 0, crashesPerHour = 0;
  for (const t of TYPES) {
    costPerHour += rates[t].costPerMvkt * dMvkt[t];
    if (rates[t].fromData) crashesPerHour += rates[t].crashPerMvkt * dMvkt[t];
  }

  // crash history on the work zone and on streets that gain 25+ veh/h
  const siteLinks = new Set(closures.flatMap(c => c.allLinks));
  const site = crashSummary([...siteLinks].flatMap(id => crashes.byLink.get(id) || []));
  const streets = new Map();
  for (const r of links) {
    if (r.delta < 25 || siteLinks.has(r.id)) continue;
    const L = g.links[r.id];
    if (GENERIC.test(L.name)) continue;
    const s = streets.get(L.name) || { name: L.name, up: 0, crashes: [] };
    s.up = Math.max(s.up, r.delta);
    s.crashes.push(...(crashes.byLink.get(r.id) || []));
    streets.set(L.name, s);
  }
  const diverted = [...streets.values()].map(s => ({ name: s.name, up: s.up, ...crashSummary(s.crashes) }))
    .filter(s => s.n > 0).sort((a, b) => b.ksi - a.ksi || (b.ped + b.cyc) - (a.ped + a.cyc) || b.n - a.n);
  return { years: crashes.years, site, diverted, rates, dMvkt, costPerHour, crashesPerHour, area: crashSummary(crashes.list) };
}
