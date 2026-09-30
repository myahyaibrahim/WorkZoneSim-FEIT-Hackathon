// Environmental and economic impact. Every parameter comes from standards.js with its published source:
//  - vehicle mix per link: DTP heavy vehicle AADT share; light vehicles split car/LCV by the TfNSW urban vkm mix
//  - VOC and fuel: ATAP PV2 stop-start / free-flow models (Tables 35, 36), VOC indexed to June 2024
//  - CO2-e: fuel × NGA 2025 scope-1 factors; NOx / PM2.5 mass: Australian fleet-average g/vkm (Smit 2014)
//  - air pollution and noise costs per vkm (TfNSW EPV / ATAP PV5); carbon value ATAP PV5 central
//  - time: TfNSW EPV urban values per vehicle-hour and per person-hour
import { VTT, LCV_SHARE_OF_LIGHT, VOC_MODEL, VOC_INDEX_2013_2024, VOC_MIN_SPEED, CO2E_PER_L, FLEET_EF,
  EXTERNAL_C_PER_VKM, CARBON_PER_T } from './standards.js';

// Heavy vehicle share per edge from DTP counts (two-way heavy vehicle AADT / two-way AADT).
// Uncounted links take the study-area median of counted links of the same road rank; ranks with no counts
// (mostly local streets) take the lowest counted-rank median. DTP data is daily, so the share does not vary by hour.
export function heavyShares(g, matches) {
  const linkShare = new Map();
  for (const m of matches) if (m.hvShare > 0 && m.hvShare < 0.6) linkShare.set(m.link, m.hvShare);
  const byRank = {};
  for (const [lid, v] of linkShare) (byRank[g.links[lid].rank] ||= []).push(v);
  const med = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  const rankMed = {};
  for (const [r, a] of Object.entries(byRank)) rankMed[r] = med(a);
  const ranks = Object.keys(rankMed).map(Number).sort((a, b) => a - b);
  const lowest = ranks.length ? Math.min(...ranks.map(r => rankMed[r])) : 0;
  const edge = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) {
    const lid = g.link[e];
    if (linkShare.has(lid)) { edge[e] = linkShare.get(lid); continue; }
    const r = g.rank[e];
    edge[e] = rankMed[r] ?? (ranks.length && r < ranks[0] ? rankMed[ranks[0]] : lowest);
  }
  return { edge, counted: linkShare.size, rankMedian: rankMed, overall: linkShare.size ? med([...linkShare.values()]) : null };
}

// ATAP PV2 model: stop-start below 60 km/h, free-flow at or above 60 km/h.
function atap(coef, v) {
  const V = Math.max(VOC_MIN_SPEED, v);
  return V < 60 ? coef[0] + coef[1] / V : coef[2] + coef[3] * V + coef[4] * V * V;
}
const CLASSES = ['car', 'lcv', 'hcv'];

// Per-hour totals for one assignment result, by vehicle class, plus CO2-e per edge for mapping.
export function emissions(g, flow, time, hv) {
  const out = { vkt: { car: 0, lcv: 0, hcv: 0 }, vht: { car: 0, lcv: 0, hcv: 0 }, vocDollars: 0, fuelL: 0, co2: 0, nox: 0, pm25: 0,
    airDollars: 0, noiseDollars: 0, edgeCO2: new Float64Array(g.m) };
  for (let e = 0; e < g.m; e++) {
    const f = flow[e];
    if (!(f > 0) || !(time[e] < Infinity)) continue;
    const km = g.len[e] / 1000, h = time[e] / 3600, v = km / h;
    const light = f * (1 - hv[e]);
    const q = { car: light * (1 - LCV_SHARE_OF_LIGHT), lcv: light * LCV_SHARE_OF_LIGHT, hcv: f * hv[e] };
    let co2e = 0;
    for (const c of CLASSES) {
      const vkm = q[c] * km;
      out.vkt[c] += vkm; out.vht[c] += q[c] * h;
      out.vocDollars += vkm * atap(VOC_MODEL[c].voc, v) * VOC_INDEX_2013_2024 / 100;
      const litres = vkm * atap(VOC_MODEL[c].fuel, v) / 100;
      out.fuelL += litres;
      co2e += litres * CO2E_PER_L[VOC_MODEL[c].fuelType];
      out.airDollars += vkm * EXTERNAL_C_PER_VKM.air[c] / 100;
      out.noiseDollars += vkm * EXTERNAL_C_PER_VKM.noise[c] / 100;
    }
    out.co2 += co2e; out.edgeCO2[e] = co2e;
    out.nox += f * km * FLEET_EF.nox; out.pm25 += f * km * FLEET_EF.pm25;
  }
  return out; // co2 in kg/h, nox/pm25 in g/h, money in $/h (June 2024)
}

// Extra traffic pushed onto local and residential streets (rat-running), the main amenity complaint.
export function localAmenity(g, links, period) {
  const streets = new Map();
  let addedVkt = 0;
  for (const r of links) {
    const L = g.links[r.id];
    if (L.rank < 6 || r.delta <= 0) continue;
    addedVkt += r.delta * L.len / 1000;
    const s = streets.get(L.name) || { name: L.name, up: 0, base: 0 };
    if (r.delta > s.up) { s.up = r.delta; s.base = r.base; }
    streets.set(L.name, s);
  }
  const list = [...streets.values()].filter(s => s.up >= 30 && !/^(Local street|Shared zone|Local road)$/.test(s.name)).sort((a, b) => b.up - a.up);
  // reported, not valued: a local street whose traffic more than doubles (and gains 50+ veh/h)
  const hotspots = list.filter(s => s.up >= 50 && s.up > s.base);
  return { addedVkt, streets: list.slice(0, 8), hotspots: hotspots.length, nightNoise: period === 'NIGHT' && hotspots.length > 0 };
}

// Money over the works duration (June 2024 AUD). r.env.base / r.env.scen come from emissions().
export function economics(r, p) {
  const b = r.env.base, s = r.env.scen, dur = p.duration;
  const dvht = c => s.vht[c] - b.vht[c];
  const lines = {
    carTime:  dvht('car') * VTT.car,
    lcvTime:  dvht('lcv') * VTT.lcv,
    freight:  dvht('hcv') * VTT.hcv,
    voc:      s.vocDollars - b.vocDollars,          // fuel + non-fuel operating cost
    pt:       r.ptPersonHours * VTT.person,
    ped:      r.pedPersonHours * VTT.person,
    carbon:   (s.co2 - b.co2) / 1000 * CARBON_PER_T,
    airQual:  s.airDollars - b.airDollars,
    noise:    s.noiseDollars - b.noiseDollars,
    safety:   r.safety ? r.safety.costPerHour : 0,  // crash risk from diverted vehicle-km (safety.js)
    business: p.business || 0,                      // only when the user supplies a deterrence rate
  };
  const perHour = Object.values(lines).reduce((a, v) => a + v, 0);
  const total = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v * dur]));
  return { perHour, lines, total, sum: perHour * dur, dur,
    co2t: (s.co2 - b.co2) / 1000 * dur, noxKg: (s.nox - b.nox) / 1000 * dur, pmKg: (s.pm25 - b.pm25) / 1000 * dur, fuelL: (s.fuelL - b.fuelL) * dur };
}
