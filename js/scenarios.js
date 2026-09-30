// Scenario engine for the contractor flow (Input -> Recommendation -> Procurement).
// From a work zone footprint and a schedule it builds four execution strategies, evaluates each working hour
// against the analysis period that hour falls in, and rates four knock-on pillars.
//  - Hours: each clock hour of the daily window maps to an analysis period (AM, business hours, PM, night, weekend),
//    so the community cost follows the hours the road is actually occupied.
//  - Strategies: your hours with a lane closure; night works with a full closure; a phased single-lane shuttle (or
//    one direction at a time); a weekend block with a continuous full closure. All four do the same total working
//    hours (assumption: productivity is the same in every window).
//  - Pillars: emergency services, public transport, vulnerable road users, vehicle congestion. Thresholds are listed
//    in PILLAR_RULES (assumptions, shown in the methodology).
import { PERIODS } from './demand.js';
import { candidateTreatments } from './decision.js';
import { applyScenario } from './workzone.js';
import { dijkstra } from './assign.js';
import { nearestNode } from './network.js';

export const PILLAR_RULES = {
  emergency: 'Extra congested travel time from the nearest hospitals, ambulance, fire and police stations to either end of the site: Low < 1 min, Medium 1–3 min, High ≥ 3 min',
  pt: 'High if a tram route is cut; Medium if a tram or bus route is delayed or diverted; Low otherwise',
  vru: 'High if a footpath closes where ≥ 500 people/h walk or a pedestrian or cyclist crash is on record; Medium if a footpath closes or the walking detour exceeds 50 m; Low otherwise',
  traffic: 'High if a new queue reaches the previous intersection or the signed detour exceeds capacity; Medium if vehicles using the site lose ≥ 2 min or the network gains ≥ 20 vehicle-hours per hour; Low otherwise',
};

// ---------------------------------------------------------------- schedule
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const WINDOWS = { day: ['09:30', '15:30'], night: ['20:00', '05:00'], '247': ['00:00', '24:00'] };

// analysis period for a clock hour on a weekday or weekend day
export function periodForHour(h, weekend) {
  if (h >= 22 || h < 6) return 'NIGHT';
  if (weekend) return 'WE';
  if (h >= 7 && h < 10) return 'AM';
  if (h >= 16 && h < 19) return 'PM';
  return 'OFF';
}

// hours per analysis period over the whole job: { periods: {AM: h, ...}, total, daily, days }
export function scheduleHours(s) {
  const a = toMin(s.from), b0 = toMin(s.to), b = b0 <= a ? b0 + 1440 : b0;
  const daily = (b - a) / 60, periods = {};
  const start = s.startDate ? new Date(s.startDate) : null;
  for (let d = 0; d < s.days; d++) {
    const dow = start ? new Date(start.getTime() + d * 864e5).getDay() : null;
    for (let m = a; m < b; m += 60) {
      const frac = Math.min(60, b - m) / 60, clock = (m % 1440) / 60;
      const nextDay = m >= 1440, dd = dow == null ? null : (dow + (nextDay ? 1 : 0)) % 7;
      const weekend = s.weekend || dd === 0 || dd === 6;
      const p = periodForHour(Math.floor(clock), weekend);
      periods[p] = (periods[p] || 0) + frac;
    }
  }
  return { periods, total: daily * s.days, daily, days: s.days };
}
export const scheduleLabel = s => `${s.days} ${s.weekend ? 'weekend ' : ''}day${s.days > 1 ? 's' : ''}, ${s.from === '00:00' && s.to === '24:00' ? '24/7' : `${s.from}–${s.to}`}`;

// ---------------------------------------------------------------- strategies
export function scenarioDefs(g, closures, sched) {
  const t = Object.fromEntries(candidateTreatments(g, closures).map(x => [x.key, x]));
  const total = scheduleHours(sched).total;
  const lane = t.lane1 || t.dirba || t.dirab || t.asdrawn;
  const phased = t.shuttle ? [{ tr: t.shuttle, share: 1 }] : t.dirab && t.dirba ? [{ tr: t.dirab, share: 0.5 }, { tr: t.dirba, share: 0.5 }] : [{ tr: lane, share: 1 }];
  return [
    { key: 'hours', name: `${lane === t.lane1 ? 'Lane closure' : lane.label}, your hours`, strategy: 'Keeps traffic moving past the site during your working window.', parts: [{ tr: lane, share: 1 }], sched },
    { key: 'night', name: 'Night works, full closure', strategy: 'Closes the road only when demand is lowest; more nights for the same work.', parts: [{ tr: t.asdrawn, share: 1 }], sched: { ...sched, from: WINDOWS.night[0], to: WINDOWS.night[1], days: Math.max(1, Math.ceil(total / 9)), weekend: false } },
    { key: 'phased', name: t.shuttle ? 'Phased single-lane shuttle' : 'Phased, one direction at a time', strategy: t.shuttle ? 'Traffic alternates past the site under Stop/Slow control.' : 'Half the work with each direction closed in turn.', parts: phased, sched },
    { key: 'weekend', name: 'Weekend block, full closure', strategy: 'One continuous closure over the weekend, finished in the fewest days.', parts: [{ tr: t.asdrawn, share: 1 }], sched: { ...sched, from: '00:00', to: '24:00', days: Math.max(1, Math.ceil(total / 24)), weekend: true } },
  ].filter(d => d.parts.every(p => p.tr));
}

// Runs every strategy: runOne(closures, period) -> { r, cost, checks } (network model for one analysis hour).
export async function generateScenarios(g, closures, sched, runOne, onProgress) {
  const defs = scenarioDefs(g, closures, sched), out = [];
  const jobs = defs.reduce((a, d) => a + d.parts.length * Object.keys(scheduleHours(d.sched).periods).length, 0);
  let k = 0;
  for (const d of defs) {
    const hrs = scheduleHours(d.sched);
    let community = 0, worst = null;
    for (const part of d.parts) {
      const cs = closures.map(part.tr.map);
      const sc = applyScenario(g, cs);
      if (sc.closed.every(x => !x) && sc.work.every(x => !x)) continue;
      for (const [p, h] of Object.entries(hrs.periods)) {
        onProgress?.(`${d.name} · ${PERIODS[p].label}`, k++ / jobs);
        const run = await runOne(cs, p);
        community += part.share * h * run.cost.perHour;
        if (!worst || run.cost.perHour > worst.cost.perHour) worst = { ...run, period: p, closures: cs, treatment: part.tr };
      }
    }
    if (worst) out.push({ ...d, hours: hrs, community, worst, period: worst.period, closures: worst.closures, r: worst.r, cost: worst.cost, checks: worst.checks,
      fails: worst.checks.filter(x => x.status === 'fail').length, warns: worst.checks.filter(x => x.status === 'warn').length,
      failText: worst.checks.filter(x => x.status === 'fail').map(x => x.topic).join(', ') });
  }
  return out;
}

// ---------------------------------------------------------------- knock-on pillars
const LVL = (v, lo, hi) => v >= hi ? 'High' : v >= lo ? 'Medium' : 'Low';
export function assessPillars(net, r, base, closures, stations, zones) {
  const g = net.veh;
  // emergency services: congested travel time to either end of the site, with and without the works
  const ends = [...new Set(closures.flatMap(c => [c.nodes[0], c.nodes[c.nodes.length - 1]]))];
  let srcs = (stations || []).map(s => ({ ...s, node: nearestNode(g, net.proj.fwd(s.lat, s.lon)) })).filter(s => s.node >= 0);
  if (!srcs.length) srcs = (zones || []).filter(z => z.kind === 'gateway').slice(0, 6).map(z => ({ name: z.name, kind: 'approach', node: z.node }));
  const dist = new Float64Array(g.n), pred = new Int32Array(g.n);
  let em = { delay: 0, name: null, kind: null };
  for (const s of srcs.slice(0, 10)) {
    dijkstra(g, s.node, base.res.time, dist, pred); const tb = ends.map(n => dist[n]);
    dijkstra(g, s.node, r.res.time, dist, pred); const ts = ends.map(n => dist[n]);
    const d = Math.max(0, ...ends.map((n, i) => isFinite(tb[i]) && isFinite(ts[i]) ? (ts[i] - tb[i]) / 60 : 0));
    if (d > em.delay) em = { delay: d, name: s.name, kind: s.kind };
  }
  const emergency = { level: LVL(em.delay, 1, 3), value: em.delay, text: em.name ? `+${em.delay.toFixed(1)} min from ${em.name}` : 'No extra delay', from: em.name };
  // public transport
  const cut = [...new Set(r.pt.tram.filter(t => /interrupted/.test(t.status)).map(t => t.ref))];
  const hit = r.pt.tram.length + r.pt.bus.length;
  const pt = { level: cut.length ? 'High' : hit ? 'Medium' : 'Low', text: cut.length ? `Tram ${cut.join(', ')} cut` : hit ? `${hit} route(s) delayed or diverted` : 'No route affected' };
  // vulnerable road users
  const fpClosed = closures.some(c => c.footpath !== 'open'), sf = r.safety?.site;
  const vruHigh = fpClosed && ((r.footfall || 0) >= 500 || (sf && sf.ped + sf.cyc > 0));
  const vru = { level: vruHigh ? 'High' : fpClosed || (r.ped.affected && r.ped.avgDetour > 50) ? 'Medium' : 'Low',
    text: fpClosed ? `Footpath closed${r.footfall != null ? `, ${Math.round(r.footfall)} people/h` : ''}` : sf && sf.ped + sf.cyc ? `${sf.ped} pedestrian, ${sf.cyc} cyclist crashes on record` : 'Footpaths open' };
  // vehicle congestion
  const spill = r.queues.some(q => q.lengthM > g.len[q.e]);
  let vc = 0; for (const d of r.plan.detours) for (const e of d.edges) if (r.sc.cap[e] > 0) vc = Math.max(vc, r.res.flow[e] / r.sc.cap[e]);
  const traffic = { level: spill || vc > 1 ? 'High' : r.kpi.extraMinPerAffected >= 2 || r.kpi.dVHT >= 20 ? 'Medium' : 'Low',
    text: r.queues[0] ? `${Math.round(r.queues[0].lengthM)} m queue on ${r.queues[0].name}` : `+${Math.max(0, r.kpi.extraMinPerAffected).toFixed(1)} min per vehicle` };
  return { emergency, pt, vru, traffic };
}
export const PILLARS = [['emergency', 'Emergency services'], ['pt', 'Public transport'], ['vru', 'Pedestrians & cyclists'], ['traffic', 'Traffic & queues']];
