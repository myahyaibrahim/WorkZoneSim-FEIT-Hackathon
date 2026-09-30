// Decision support: compliance checks against published criteria, the approvals a work zone triggers, and an
// option explorer that tries treatments × time windows and recommends the lowest-cost option that passes.
import { LANE_NEED, shuttleCapacity, signSpacingD, SHUTTLE_MAX } from './standards.js';
import { applyScenario } from './workzone.js';
import { PERIODS } from './demand.js';
import { councilChecks, councilNotices, COM_SRC } from './council.js';

// Legal and guidance references used by the checks (all in docs/evidence/sources).
export const REFS = {
  code15: 'Code of Practice for Worksite Safety – Traffic Management (Vic, 2023) Cl. 15(3)',
  code17: 'Code of Practice for Worksite Safety – Traffic Management (Vic, 2023) Cl. 17',
  code11: 'Code of Practice for Worksite Safety – Traffic Management (Vic, 2023) Cl. 11(4)',
  qg24: 'QGTTM Part 3 (2025) Table 2.4: open lanes needed',
  qg54: 'QGTTM Part 3 (2025) Table 5.4: Stop/Slow single-lane length vs volume',
  qg22: 'QGTTM Part 3 (2025) Table 2.2: advance sign spacing D',
  rma14: 'Road Management Act 2004 Sch. 7 Cl. 14: minimise disruption to road users and priority modes',
  rma5: 'Road Management Act 2004 Sch. 7 Cl. 5: time and manner that minimise inconvenience',
  rmaPT: 'Road Management Act 2004 s48EA/48EB; Code of Practice for Management of Infrastructure in Road Reserves Cl. 43–47 (VicRoads guide p. 13)',
  consent: 'VicRoads, A Guide to Working in the Road Reserve (2020), Flow Chart 2: max 20 business days (15 for service works)',
  comConsent: 'City of Melbourne, Consent for works, up to 15 business days; notify stakeholders ≥ 5 business days before works',
  moa: 'Road Safety (Traffic Management) Regulations 2019, via VicRoads guide p. 10, MoA for VMS and roadworks speed-limit signs',
  capacity: 'Capacity (V/C = 1) per the link capacities in standards.js (AGTM Part 3 Table 6.1 / Akçelik 1991)',
  crash: 'DTP Victoria road crash data (injury crashes); Code Cl. 15(3)(c) risk assessment',
};

// ---------------------------------------------------------------- compliance checks
// status: 'pass' | 'warn' | 'fail' | 'action' (an approval or notice the plan triggers) | 'info'
// Each check carries a recommendation (rec): what to do about it, using the numbers from this run.
export function complianceChecks(net, closures, r, base) {
  const g = net.veh, sc = r.sc, checks = [];
  const add = (status, topic, finding, basis, rec = '') => checks.push({ status, topic, finding, basis, rec: status === 'pass' ? 'No action needed.' : rec });

  for (const c of closures) {
    // open lanes vs demand (lane closures)
    if (c.type === 'lane') {
      for (const d of (c.direction === 'both' ? ['ab', 'ba'] : [c.direction])) {
        const es = (d === 'ab' ? c.abEdges : c.baEdges).filter(e => e >= 0 && !sc.closed[e]);
        if (!es.length) continue;
        const lanes = Math.min(...es.map(e => g.lanes[e]));
        const open = lanes - c.lanesClosed;
        const peak = Math.max(...es.map(e => base.res.flow[e]));
        const need = Math.ceil(peak / LANE_NEED.midblock);
        if (open <= 0) continue;
        const fail = peak > open * LANE_NEED.midblock;
        const canKeep = lanes - need;
        add(fail ? 'fail' : 'pass', 'Open lanes', `${c.street} ${d === 'ab' ? 'A→B' : 'B→A'}: ${Math.round(peak)} veh/h needs ${need} lane(s); ${open} open`, REFS.qg24,
          `Keep ${need} lane(s) open (close no more than ${Math.max(0, canKeep)} of ${lanes}) by staging the works, or move them to a window where demand is at most ${fmtN(open * LANE_NEED.midblock)} veh/h. The Decide tab shows which windows pass. If neither is possible, close this direction and sign a detour.`);
      }
    }
    // Stop/Slow limits
    if (c.type === 'shuttle') {
      const max = shuttleCapacity(c.length);
      const twoWay = Math.max(0, ...c.abEdges.map(e => base.res.flow[e] || 0)) + Math.max(0, ...c.baEdges.map(e => base.res.flow[e] || 0));
      const allowed = SHUTTLE_MAX.filter(([, v]) => v >= twoWay).map(([L]) => L).pop();
      const rec = allowed
        ? `Split the site into stages of at most ${allowed} m (the QGTTM limit for ${fmtN(twoWay)} veh/h two-way), or use portable traffic signals.`
        : `${fmtN(twoWay)} veh/h two-way is above the 800 veh/h Stop/Slow limit at any length: use portable traffic signals, work off-peak, or close one direction with a detour.`;
      if (max == null) add('fail', 'Stop/Slow length', `${c.street}: ${Math.round(c.length)} m exceeds the 800 m maximum`, REFS.qg54, rec);
      else add(twoWay > max ? 'fail' : 'pass', 'Stop/Slow volume', `${c.street}: ${Math.round(twoWay)} veh/h two-way vs ${max} veh/h allowed for ${Math.round(c.length)} m`, REFS.qg54, rec);
    }
    // speed limit reduction and MoA
    if (c.type !== 'full' && c.type !== 'direction') add('action', 'Speed limit reduction', `${c.street}: ${Math.max(40, c.speed)} km/h temporary works speed limit (signs no lower than 40 km/h)`, REFS.moa,
      `Apply to the coordinating road authority for a Memorandum of Authorisation for the ${Math.max(40, c.speed)} km/h signs before installation; show them on the TGS.`);
    // pedestrians
    if (c.footpath !== 'open') add(r.ped.affected ? 'action' : 'info', 'Pedestrians & accessibility', r.ped.affected
      ? `Footpath closed (${c.footpath === 'both' ? 'both sides' : 'one side'}); alternative route in the plan: average detour ${Math.round(r.ped.avgDetour)} m, longest ${Math.round(r.ped.maxDetour)} m`
      : 'Footpath closure requested but no mapped footpath found', REFS.code15,
      r.ped.affected
        ? `Sign a continuous, accessible alternative route with FOOTPATH CLOSED signs at both ends (placed in the plan); check kerb ramps and crossings on the route${r.ped.maxDetour > 200 ? `; consider a protected temporary walkway, as the longest detour is ${Math.round(r.ped.maxDetour)} m` : ''}.`
        : 'Confirm the footpath layout on site and update the TGS.');
  }

  // detour capacity
  let worst = null;
  for (const d of r.plan.detours) for (const e of d.edges) {
    const vc = sc.cap[e] > 0 ? r.res.flow[e] / sc.cap[e] : 0;
    if (!worst || vc > worst.vc) worst = { vc, name: g.links[g.link[e]].name };
  }
  if (worst) {
    const st = worst.name.replace(/ Street$/, ' St').replace(/ Road$/, ' Rd'), vmsTxt = `${st.toUpperCase()} DETOUR · EXPECT DELAYS · ALLOW EXTRA TIME`;
    add(worst.vc > 1 ? 'fail' : worst.vc > 0.9 ? 'warn' : 'pass', worst.vc > 0.9 ? `Possible congestion on the detour on ${st}` : 'Detour capacity',
      `${worst.vc > 1 ? 'Traffic on' : 'Traffic on'} ${worst.name} reaches ${Math.round(worst.vc * 100)}% of its capacity with the detour (volume/capacity ${worst.vc.toFixed(2)})`, REFS.capacity,
      `Show road users "${vmsTxt}" on a VMS before ${st}${r.plan.vmsPlaced ? ' (use one of the planned VMS boards)' : ''}, and sign a second detour so part of the traffic avoids ${st}. Ask the road authority to lengthen green time along ${st}, or choose a scenario in a quieter window.`);
  }

  // queues reaching the previous intersection
  const spill = r.queues.filter(q => q.lengthM > g.len[q.e]);
  const qw = r.plan.queueWarnings || [];
  add(spill.length ? (qw.length ? 'action' : 'warn') : 'pass', 'Queue spill-back', spill.length
    ? `${spill.length} approach(es) queue past the previous intersection, longest ${Math.round(spill[0].lengthM)} m on ${spill[0].name}${qw.length ? `; PREPARE TO STOP sign${qw.length > 1 ? 's' : ''} placed before the queue end on ${[...new Set(qw.map(w => w.on))].join(', ')}` : ''}`
    : 'No new queue reaches the previous intersection', REFS.capacity,
    qw.length ? `PREPARE TO STOP signs are in the plan before each queue end (${qw.map(w => `${Math.round(w.lengthM)} m on ${w.name}`).join('; ')}). Keep the upstream intersections clear with a traffic controller or KEEP CLEAR marking, or move the works to a quieter window.`
      :`Place advance warning (and a VMS, if available) upstream of the expected queue end on ${spill[0]?.name} (about ${Math.round(spill[0]?.lengthM || 0)} m); keep the upstream intersection clear with a traffic controller or KEEP CLEAR arrangement; or reduce demand by working off-peak.`);

  // advance signs that do not fit on the approach
  const short = r.plan.markers.filter(m => m.item === 'sign_rwa' && /approach shorter/.test(m.sub || ''));
  const vmax = Math.max(...closures.flatMap(c => c.links.map(l => g.links[l].speed)));
  add(short.length ? 'warn' : 'pass', 'Advance warning distance', short.length
    ? `${short.length} ROADWORK AHEAD sign(s) cannot sit at 2 × D on the approach block`
    : 'All advance signs fit at 2 × D', REFS.qg22,
    `Move sign(s) ${short.map(m => r.plan.markers.indexOf(m) + 1).join(', ')} onto the previous block so each is ${2 * signSpacingD(vmax)} m before the closure, and add a sign at the turn into the approach street.`);

  // equipment
  const shortItems = r.plan.items.filter(i => i.shortfall);
  // a depot shortfall is a supply matter (hire from RPM Hire), not a failed check: status 'stock' keeps it out of scenario ranking
  add(shortItems.length ? 'stock' : 'pass', shortItems.length ? 'Short on equipment availability' : 'Equipment availability', shortItems.length
    ? `Short: ${shortItems.map(i => `${i.label} −${i.shortfall}`).join('; ')}`
    : 'Depot stock covers the full layout', 'Depot inventory (user input)',
    `Hire or transfer before deployment: ${shortItems.map(i => `${i.shortfall} × ${i.label}`).join('; ')}.${shortItems.some(i => i.key === 'vms') ? ' Without the extra VMS fewer drivers are warned in advance; re-run after changing the stock to see the effect.' : ''}${shortItems.some(i => i.key === 'barrier') ? ' Where Code Cl. 17 does not require a barrier, cones can replace barriers.' : ''}`);

  // public transport notifications
  const trams = [...new Set(r.pt.tram.map(t => t.ref))];
  const blockedRows = r.pt.tram.filter(t => /interrupted/.test(t.status));
  const blocked = [...new Set(blockedRows.map(t => t.ref))];
  const buses = [...new Set(r.pt.bus.map(b => b.ref))];
  if (trams.length || buses.length) {
    const rep = blockedRows.reduce((m, t) => Math.max(m, t.replacementBuses || 0), 0), eg = blockedRows.find(t => t.replacementFrom);
    add('action', 'Public transport', `${blocked.length ? `Tram ${blocked.join(', ')} interrupted` : trams.length ? `Tram ${trams.join(', ')} affected` : ''}${(trams.length && buses.length) ? '; ' : ''}${buses.length ? `bus ${buses.join(', ')} diverted or delayed` : ''}${r.pt.stopsAffected.length ? `; ${r.pt.stopsAffected.length} stop(s) affected` : ''}`, REFS.rmaPT,
      `Send notice to DTP${blocked.length || trams.length ? ', Yarra Trams' : ''}${buses.length ? ' and the bus operator(s)' : ''} with the consent application.${blocked.length ? ` Arrange about ${rep} replacement bus(es) per route${eg ? ` between ${eg.replacementFrom} and ${eg.replacementTo}` : ''}.` : ''}${r.pt.stopsAffected.length ? ' Agree temporary stops and passenger information.' : ''}`);
  }

  // VMS and other items
  if (r.plan.vmsPlaced) add('action', 'VMS boards', `${r.plan.vmsPlaced} VMS board(s) on the approaches`, REFS.moa,
    'Apply for a Memorandum of Authorisation for the VMS; agree the message and display period with the road authority.');
  add('info', 'Road safety barrier', 'Consider a road safety barrier for long-term works or excavations deeper than 250 mm near traffic', REFS.code17,
    'Confirm with the TMP designer whether a barrier is needed; if so, set Delineation to barriers and re-run to update the equipment count.');
  if (r.amenity.hotspots) add('action', 'Local streets', `${r.amenity.hotspots} local street(s) more than double their traffic${r.amenity.nightNoise ? ' at night' : ''}`, REFS.rma14,
    `Notify residents on ${r.amenity.streets.slice(0, 3).map(s => s.name).join(', ')}; consider LOCAL TRAFFIC ONLY signs at their entries and monitor during the works.`);
  // council standard conditions (City of Melbourne; a guide elsewhere)
  checks.push(...councilChecks(net, closures, r));
  // crash history (DTP road crash data): the work site, and streets that take diverted traffic
  const sf = r.safety;
  if (sf) {
    const vul = sf.site.ped + sf.site.cyc;
    add(vul || sf.site.ksi ? 'action' : 'pass', 'Crash history at the work site',
      `${sf.site.n} injury crash(es) on the work zone section (${sf.site.ksi} fatal or serious; ${sf.site.ped} pedestrian, ${sf.site.cyc} cyclist)`, REFS.crash,
      `Controls are in the plan (TMP 4.3): ${[sf.site.ped && 'fenced pedestrian route and a traffic controller at the crossings', sf.site.cyc && 'WATCH FOR CYCLISTS signs on the approaches', sf.site.ksi && 'advance warning before the approach block'].filter(Boolean).join('; ')}. Rate the risk in the risk assessment (TMP 4.1).`);
    const risky = sf.diverted.filter(d => d.ksi || d.ped || d.cyc);
    const onDetour = new Set(r.plan.detours.flatMap(d => d.riskNames || []));
    const signedRisky = risky.filter(d => onDetour.has(d.name)), selfRouted = risky.filter(d => !onDetour.has(d.name));
    const desc = arr => arr.slice(0, 3).map(d => `${d.name} (${d.ksi} fatal/serious, ${d.ped} pedestrian, ${d.cyc} cyclist; +${Math.round(d.up)} veh/h)`).join('; ');
    if (risky.length && !signedRisky.length) add('action', 'Crash history on diverted routes',
      `The signed detour avoids streets with serious or vulnerable road user crashes. Drivers finding their own way still use: ${desc(selfRouted)}`, REFS.crash,
      `Put LOCAL TRAFFIC ONLY or advisory signs at the entries of ${selfRouted.slice(0, 2).map(d => d.name).join(' and ')}, and publish the signed detour to navigation apps so fewer drivers use them.`);
    else add(risky.length ? 'warn' : 'pass', 'Crash history on diverted routes', risky.length
      ? `The signed detour has no alternative avoiding: ${desc(signedRisky)}`
      : 'No street taking diverted traffic has a fatal, serious, pedestrian or cyclist crash on record', REFS.crash,
      `Sign the detour along roads without this history where one exists, so fewer drivers find their own way through ${risky.slice(0, 2).map(d => d.name).join(' and ')}. If they must carry the traffic: add advance warning and VMS advice, consider a lower temporary speed limit, and avoid school start and finish times.`);
  }
  return checks;
}
const fmtN = v => Math.round(v).toLocaleString('en-AU');

// ---------------------------------------------------------------- approvals and lead times
// Declared arterials are those on the DTP Traffic Volume layer (the declared road network); the coordinating road
// authority is then the Head, Transport for Victoria, otherwise the municipal council.
export function approvals(net, closures, matches, r, startDate, durationH = 0) {
  const declared = new Set(matches.map(m => m.link));
  const arterial = closures.some(c => c.allLinks.some(l => declared.has(l)));
  const council = r.council?.name || 'Municipal council';
  const authority = arterial ? 'Head, Transport for Victoria (DTP), declared arterial road' : `${council}, local road`;
  const consentDays = arterial ? 20 : 15;
  const list = [
    { item: 'Consent to work in the road reserve', who: authority, lead: `${consentDays} business days`, days: consentDays, basis: arterial ? REFS.consent : REFS.comConsent },
    ...(arterial ? [{ item: `Road closure / occupation consent from the council for council-managed elements (footpaths, parking)`, who: council, lead: '15 business days', days: 15, basis: REFS.comConsent }] : []),
    ...councilNotices(r.council),
    ...(r.council?.isCoM && durationH >= 24 * 28 ? [{ item: 'Construction Traffic Impact Assessment with the Construction Management Plan (works of 4 weeks or more)', who: 'City of Melbourne', lead: 'At the start of the project', days: null, basis: COM_SRC.ctia }] : []),
  ];
  if (r.plan.vmsPlaced || closures.some(c => c.type !== 'full')) list.push({ item: 'Memorandum of Authorisation for VMS and roadworks speed-limit signs', who: authority, lead: 'Before devices are installed', days: null, basis: REFS.moa });
  if (r.pt.tram.length || r.pt.bus.length) list.push({ item: 'Notice to public transport provider (tram / bus services or stops affected)', who: 'DTP / Yarra Trams / bus operator', lead: 'With the consent application', days: consentDays, basis: REFS.rmaPT });
  list.push({ item: 'TMP kept on site while workers are present', who: 'Works manager', lead: 'During works', days: null, basis: REFS.code15.replace('(3)', '(5)') });
  list.push({ item: 'Notify completion of works', who: 'Works manager → coordinating road authority', lead: 'Within 7 business days after completion', days: null, basis: 'VicRoads, A Guide to Working in the Road Reserve (2020), Notification requirements, within 7 business days' });
  if (startDate) for (const a of list) if (a.days) a.by = subtractBusinessDays(startDate, a.days);
  return { arterial, authority, list };
}

export function subtractBusinessDays(date, n) {
  const d = new Date(date);
  while (n > 0) { d.setDate(d.getDate() - 1); const w = d.getDay(); if (w !== 0 && w !== 6) n--; }
  return d; // public holidays are not excluded
}

// ---------------------------------------------------------------- option explorer
// Candidate treatments derived from the drawn work zone(s).
export function candidateTreatments(g, closures) {
  const out = [{ key: 'asdrawn', label: 'As drawn', map: c => ({ ...c }) }];
  const maxLanes = c => Math.min(...[...c.abEdges, ...c.baEdges].filter(e => e >= 0).map(e => g.lanes[e]));
  if (closures.some(c => c.type === 'full' || c.type === 'direction')) {
    if (closures.every(c => maxLanes(c) >= 2)) out.push({ key: 'lane1', label: 'Lane closure (1 lane each way)', map: c => ({ ...c, type: 'lane', direction: 'both', lanesClosed: 1, speed: 40 }) });
    if (closures.every(c => c.abEdges.some(e => e >= 0) && c.baEdges.some(e => e >= 0))) {
      out.push({ key: 'dirab', label: 'One direction closed (A→B)', map: c => ({ ...c, type: 'direction', direction: 'ab' }) });
      out.push({ key: 'dirba', label: 'One direction closed (B→A)', map: c => ({ ...c, type: 'direction', direction: 'ba' }) });
    }
    if (closures.every(c => maxLanes(c) === 1 && c.length <= 800)) out.push({ key: 'shuttle', label: 'Stop/Slow shuttle', map: c => ({ ...c, type: 'shuttle', direction: 'both', speed: 20 }) });
  }
  return out;
}

// Runs treatments × periods. runOne(closures, period) must return { r, costs } for one scenario.
export async function exploreOptions(g, closures, runOne, onProgress) {
  const treatments = candidateTreatments(g, closures);
  const periods = Object.keys(PERIODS);
  const rows = [];
  let k = 0;
  for (const p of periods) {
    for (const t of treatments) {
      onProgress?.(`${t.label} · ${PERIODS[p].label}`, k++ / (treatments.length * periods.length));
      const cs = closures.map(t.map);
      const sc = applyScenario(g, cs);
      if (sc.closed.every(x => !x) && sc.work.every(x => !x)) continue;
      const { r, cost, checks } = await runOne(cs, p);
      const fails = checks.filter(x => x.status === 'fail'), warns = checks.filter(x => x.status === 'warn');
      rows.push({ treatment: t, period: p, closures: cs, cost, r, checks, fails: fails.length, warns: warns.length,
        failText: fails.map(f => f.topic).join(', '), trams: [...new Set(r.pt.tram.filter(x => /interrupted/.test(x.status)).map(x => x.ref))] });
    }
  }
  rows.sort((a, b) => (a.fails > 0) - (b.fails > 0) || a.cost.sum - b.cost.sum);
  const best = rows.find(x => x.fails === 0) || null;
  return { rows, best, treatments, periods };
}
