// Council requirements for temporary road and footpath closures. The City of Melbourne publishes the most complete
// set in Victoria; its rules apply in full inside the City of Melbourne and are used as a guide elsewhere.
// Sources (docs/evidence/sources):
//  - City of Melbourne, Traffic Management Plans (web page): TMP format guide = Table 15.8 and CTIA format guide =
//    Table 15.9 of the Code of Practice for Building, Construction and Works; CTIA for works of 4 weeks or more.
//  - City of Melbourne, Road closure considerations (DM #13345490): high / medium / low impact considerations.
//  - City of Melbourne, Standard conditions for consent to temporary road or footpath closures (DM #14036822).
import { DEFAULT_LANE_WIDTH } from './standards.js';

export const COM_SRC = {
  format: 'City of Melbourne, Traffic Management Plans: TMP format guide (Code of Practice for Building, Construction and Works Table 15.8)',
  ctia: 'City of Melbourne, Traffic Management Plans: CTIA format guide (Code of Practice for Building, Construction and Works Table 15.9)',
  consider: 'City of Melbourne, Road closure considerations (DM #13345490)',
  cond: n => `City of Melbourne, Standard conditions for temporary road or footpath closures (DM #14036822), condition ${n}`,
};

// Standard condition 17: minimum footpath clear width (m)
const WIDTH_3 = ['Spencer', 'Flinders', 'Swanston', 'Elizabeth', 'Collins', 'Bourke'];
const WIDTH_2 = ['Spring', 'Exhibition', 'Russell', 'Queen', 'William', 'King', 'Lonsdale', 'La Trobe'];
// Hoddle Grid (CBD): Flinders St to La Trobe St, Spencer St to Spring St, with a small margin
const inCBD = (lat, lon) => lat > -37.8235 && lat < -37.8065 && lon > 144.9505 && lon < 144.9745;
const base = name => String(name || '').replace(/ (Street|St)$/i, '').trim();

export function footpathWidth(street, lat, lon, isCoM) {
  const cbd = isCoM && inCBD(lat, lon), b = base(street);
  if (cbd && WIDTH_3.includes(b)) return { m: 3.0, why: `${street} (listed street)` };
  if (cbd && WIDTH_2.includes(b)) return { m: 2.0, why: `${street} (listed street)` };
  if (cbd) return { m: 1.5, why: 'within the CBD' };
  return { m: 1.2, why: 'outside the CBD' };
}

// Council of the site: the local government area most crashes within 400 m of the work zone are recorded in
// (DTP road crash data carries the LGA of every crash).
const LGA_NAME = { MORELAND: 'MERRI-BEK' };
export function councilOf(net, closures, crashData) {
  if (!crashData?.lgas) return null;
  const pts = closures.flatMap(c => c.poly), tally = new Map();
  let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
  const lls = pts.map(p => net.proj.inv(p[0], p[1]));
  for (const [la, lo] of lls) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const d = 0.005;
  for (const r of crashData.rows) {
    if (r[0] < la0 - d || r[0] > la1 + d || r[1] < lo0 - d || r[1] > lo1 + d) continue;
    const xy = net.proj.fwd(r[0], r[1]);
    if (!pts.some(p => Math.hypot(p[0] - xy[0], p[1] - xy[1]) < 400)) continue;
    const k = LGA_NAME[crashData.lgas[r[7]]] || crashData.lgas[r[7]];
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  if (!tally.size) return null;
  const lga = [...tally].sort((a, b) => b[1] - a[1])[0][0];
  const title = lga.toLowerCase().replace(/(^|[\s-])\w/g, s => s.toUpperCase());
  const [lat, lon] = lls[0];
  return { lga, isCoM: lga === 'MELBOURNE', name: lga === 'MELBOURNE' ? 'City of Melbourne' : `${title} City Council`, cbd: lga === 'MELBOURNE' && inCBD(lat, lon) };
}

// Road closure considerations: impact level per consideration. Returns [{ topic, level: 'High'|'Medium'|'Low'|'Check', finding }]
export function impactRating(net, closures, r, appr) {
  const g = net.veh, council = r.council, out = [];
  const peakish = r.period === 'AM' || r.period === 'PM' || r.period === 'OFF';
  const trams = [...new Set(r.pt.tram.map(t => t.ref))], blocked = [...new Set(r.pt.tram.filter(t => /interrupted/.test(t.status)).map(t => t.ref))];
  const buses = [...new Set(r.pt.bus.map(b => b.ref))];
  out.push(blocked.length ? { topic: 'Public transport', level: 'High', finding: `Tram ${blocked.join(', ')} interrupted (significant disruption to a tram route)` }
    : trams.length || buses.length > 1 ? { topic: 'Public transport', level: 'Medium', finding: `${trams.length ? `Tram ${trams.join(', ')}` : ''}${trams.length && buses.length ? ', ' : ''}${buses.length ? `bus ${buses.join(', ')}` : ''} affected` }
    : buses.length ? { topic: 'Public transport', level: 'Low', finding: `Single bus route (${buses[0]}) affected` } : { topic: 'Public transport', level: 'Low', finding: 'No route affected' });
  const fpClosed = closures.filter(c => c.footpath !== 'open');
  if (fpClosed.length) {
    const c = fpClosed[0], [lat, lon] = net.proj.inv(c.poly[0][0], c.poly[0][1]);
    const w = footpathWidth(c.street, lat, lon, council?.isCoM);
    const level = w.m >= 3 && peakish ? 'High' : w.m >= 1.5 || (r.footfall || 0) > 500 ? 'Medium' : 'Low';
    out.push({ topic: 'Pedestrians', level, finding: `Footpath closed on ${c.street}${r.footfall != null ? `, ${Math.round(r.footfall)} people/h` : ''}` });
  } else out.push({ topic: 'Pedestrians', level: 'Low', finding: 'Footpaths stay open (clear width to be maintained)' });
  out.push({ topic: 'Bike routes', level: 'Check', finding: 'Confirm whether a bike lane or shared path passes the site' });
  const full = closures.some(c => c.type === 'full' || c.type === 'direction');
  const arterial = appr.arterial || closures.some(c => c.allLinks.some(l => g.links[l].rank <= 4));
  out.push({ topic: 'Cars (network)', level: full && arterial && peakish ? 'High' : (full && arterial) || (!full && arterial && peakish) || (full && r.rerouted > 300) ? 'Medium' : 'Low',
    finding: `${full ? 'Full' : 'Partial'} closure of ${arterial ? 'a road with a through traffic function' : 'a local road'}, ${Math.round(r.rerouted)} veh/h re-routed` });
  out.push({ topic: 'Resident access', level: r.kpi.unserved > 1 ? 'High' : 'Low', finding: r.kpi.unserved > 1 ? `${Math.round(r.kpi.unserved)} veh/h need access inside the closure` : 'Local access maintained by the arrangement' });
  out.push({ topic: 'Night-time noise', level: r.period === 'NIGHT' ? (r.noisy ? 'High' : 'Low') : 'Low', finding: r.period === 'NIGHT' ? (r.noisy ? 'Noisy works after 10pm are high impact' : 'Night works, quiet components only (as entered)') : 'Works outside 10pm–7am' });
  const bz = r.businesses;
  if (bz) out.push({ topic: 'Commercial businesses', level: bz.n >= 10 && peakish ? 'Medium' : bz.n ? 'Low' : 'Low',
    finding: bz.n ? `${bz.n} business${bz.n > 1 ? 'es' : ''} front the work zone (${bz.groups.map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})` : 'No business fronts the work zone' });
  out.push({ topic: 'Events', level: 'Check', finding: 'Check the council events calendar for the works dates' });
  return out;
}

// Standard conditions as compliance checks, in the format of decision.js complianceChecks.
export function councilChecks(net, closures, r) {
  const council = r.council, checks = [];
  const add = (status, topic, finding, basis, rec = '') => checks.push({ status, topic, finding, basis, rec: status === 'pass' ? 'No action needed.' : rec });
  const guide = council?.isCoM ? '' : ' (City of Melbourne condition used as a guide; check this council\'s conditions)';
  // peak times (condition 31; CBD peak 7–9.30am and 3.30–6pm, Road closure considerations example 3)
  const peak = r.period === 'AM' || r.period === 'PM';
  add(peak ? 'warn' : 'pass', 'Outside peak times', peak ? `Works assessed in the ${r.period === 'AM' ? 'morning' : 'evening'} peak` : 'Works outside the weekday peaks',
    COM_SRC.cond(31) + guide, `Move the traffic management setup outside the weekday peaks${council?.cbd ? ' (in the CBD not between 7–9.30am or 3.30–6pm)' : ''}; the Decide tab shows the cost and checks of each time window.`);
  // footpath clear width (condition 17)
  for (const c of closures) {
    const [lat, lon] = net.proj.inv(c.poly[0][0], c.poly[0][1]);
    const w = footpathWidth(c.street, lat, lon, council?.isCoM);
    if (c.footpath === 'open') add('action', 'Footpath clear width', `${c.street}: footpaths open; keep at least ${w.m.toFixed(1)} m clear (${w.why})`, COM_SRC.cond(17) + guide,
      `Show the ${w.m.toFixed(1)} m clear width on the traffic guidance scheme.`);
    else {
      const mapped = footpathWidthOSM(net, c);
      const nBar = Math.ceil(c.length / 2) + 2;
      add('action', 'Footpath clear width', `${c.street}: footpath closed (${c.footpath === 'both' ? 'both sides' : `${c.footpath} side`}). Bypass in the plan: ${w.m.toFixed(1)} m wide (${w.why}) × ${Math.round(c.length)} m in the kerbside lane, about ${nBar} water-filled barriers on the traffic side and a temporary kerb ramp at each end${mapped ? `; mapped footpath width ${mapped.toFixed(1)} m (OpenStreetMap)` : ''}`, COM_SRC.cond('17–20') + guide,
        `Show the bypass on the TGS with No Stopping beside it (condition 19)${c.type === 'full' ? '; the road is closed, so the bypass can use the carriageway' : '; the kerbside lane must be closed for it'}. If it cannot be built, traffic controllers escort pedestrians across (condition 17c). Keep one footpath open (condition 20).`);
    }
  }
  // cyclists (conditions 22–24)
  const partial = closures.filter(c => c.type === 'lane' || c.type === 'shuttle');
  for (const c of partial) {
    const openW = c.type === 'shuttle' ? DEFAULT_LANE_WIDTH : Math.max(1, Math.min(...[...c.abEdges, ...c.baEdges].filter(e => e >= 0).map(e => net.veh.lanes[e])) - c.lanesClosed) * DEFAULT_LANE_WIDTH;
    const ok = openW >= 4.0;
    add(ok ? 'pass' : 'warn', 'Shared lane for cyclists', `${c.street}: about ${openW.toFixed(1)} m of open carriageway per direction past the site (4.0 m required)`, COM_SRC.cond(24) + guide,
      'Provide a 4.0 m shared lane past the worksite, or divert cyclists around the site; place WATCH FOR CYCLISTS signs well in advance (condition 22). END BICYCLE LANE signs are not supported (condition 23).');
  }
  if (closures.some(c => c.type === 'full' || c.type === 'direction')) add('action', 'Cyclists', 'Road closed to traffic: cyclists need a route past or around the site', COM_SRC.cond(23) + guide,
    'Retain the bicycle lane, accommodate it in the adjacent traffic lane, or divert it around the site; do not use END BICYCLE LANE signs.');
  // traffic controllers at both ends (conditions 33–34)
  add('action', 'Traffic controllers', 'Qualified traffic controllers on site at all times; one at each end of the worksite during working hours', COM_SRC.cond('33–34') + guide,
    `Roster at least ${closures.length * 2} traffic controllers per shift and check the depot / labour hire availability.`);
  // local access (conditions 12–13): the access points come from the map
  if (r.kpi.unserved > 1 || closures.some(c => c.type === 'full')) {
    const ap = accessPoints(net, closures);
    const parts = [ap.streets.length && `side streets ${ap.streets.join(', ')}`, ap.lanes.length && `laneways ${ap.lanes.join(', ')}`, ap.driveways && `${ap.driveways} driveway(s) or car park entries`].filter(Boolean);
    add('action', 'Local access', `Access to keep inside the closure: ${parts.length ? parts.join('; ') : 'none mapped'}${r.kpi.unserved > 1 ? ` (${Math.round(r.kpi.unserved)} veh/h)` : ''}`, COM_SRC.cond('12–13') + guide,
      'Traffic controllers let local vehicles in and out at these points; residents and businesses are told how in the notification letter.');
  }
  // noisy works (condition 15): from the works description in the Work zone tab
  if (r.period === 'NIGHT') add(r.noisy ? 'fail' : 'pass', 'Noisy works', r.noisy ? 'Noisy works planned after 10pm: noisy components are supported only until 10pm' : 'Quiet works only after 10pm (as entered)', COM_SRC.cond('14–15') + guide,
    'Do noisy components (e.g. road opening) before 10pm under a partial closure and keep quieter work for the night (Road closure considerations, example 3); noise no more than 10 dB above background.');
  return checks;
}

// Businesses fronting the work zone (OpenStreetMap shop and customer-facing amenity tags within 35 m of the closure).
export const BIZ_GROUP = { cafe: 'Cafés & restaurants', restaurant: 'Cafés & restaurants', fast_food: 'Cafés & restaurants', pub: 'Cafés & restaurants', bar: 'Cafés & restaurants',
  pharmacy: 'Health', clinic: 'Health', doctors: 'Health', dentist: 'Health', bank: 'Services', post_office: 'Services', childcare: 'Childcare', kindergarten: 'Childcare' };
export function businessesAt(net, closures, list) {
  if (!list?.length) return { n: 0, groups: [], names: [] };
  const pts = closures.flatMap(c => c.poly), hit = [];
  for (const b of list) {
    const xy = net.proj.fwd(b.lat, b.lon);
    if (pts.some((p, i) => i && distSeg(xy, pts[i - 1], p) < 35)) hit.push(b);
  }
  const g = new Map();
  for (const b of hit) g.set(b.group, (g.get(b.group) || 0) + 1);
  return { n: hit.length, groups: [...g].sort((a, b) => b[1] - a[1]), names: hit.filter(b => b.name).slice(0, 8).map(b => b.name) };
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Access points along a closure: side streets from the road network, laneways and driveways from the OSM service ways.
export function accessPoints(net, closures) {
  const g = net.veh, streets = new Set(), lanes = new Set(); let driveways = 0;
  for (const c of closures) {
    const own = new Set(c.allLinks), ns = c.nodes || [];
    // the cross streets at either end bound the closure; access points are the ones in between
    const ends = new Set(g.links.filter(L => [ns[0], ns[ns.length - 1]].some(v => L.a === v || L.b === v)).map(L => L.name));
    for (const v of ns.slice(1, -1)) for (const L of g.links) if ((L.a === v || L.b === v) && !own.has(L.id) && L.name !== c.street && !ends.has(L.name)) streets.add(L.name);
    const pts = c.poly;
    for (const PL of net.ped.links) {
      if (PL.hw !== 'service') continue;
      const ends = [PL.xy[0], PL.xy[PL.xy.length - 1]];
      if (!ends.some(e => pts.some(p => Math.hypot(p[0] - e[0], p[1] - e[1]) < 14))) continue;
      if (PL.service === 'alley' || PL.name) lanes.add(PL.name || 'unnamed lane'); else driveways++;
    }
  }
  return { streets: [...streets].filter(n => !/^(Local street|Local road|Collector)$/.test(n)).slice(0, 6), lanes: [...lanes].slice(0, 6), driveways };
}
// Footpath width mapped in OSM (width tag on a footway within 25 m of the closure), median of the tagged ways
function footpathWidthOSM(net, c) {
  const w = [];
  for (const PL of net.ped.links) {
    if (!PL.width || !/footway|pedestrian/.test(PL.hw)) continue;
    const mid = PL.xy[PL.xy.length >> 1];
    if (c.poly.some(p => Math.hypot(p[0] - mid[0], p[1] - mid[1]) < 25)) w.push(PL.width);
  }
  return w.length ? w.sort((a, b) => a - b)[w.length >> 1] : null;
}

// Notices required by the standard conditions (conditions 1–4), in the format of decision.js approvals()
export function councilNotices(council) {
  const guide = council?.isCoM ? '' : ' (City of Melbourne list used as a guide)';
  return [
    { item: 'Written notice to occupiers of properties near the works, including surrounding streets and lanes; consult affected properties', who: 'Applicant', lead: 'Before works start', days: 5, basis: COM_SRC.cond('1–2') + guide },
    { item: 'Notify emergency services: Victoria Police (State Event Planning Unit), Ambulance Victoria, DTP Traffic Management Centre, Fire Rescue Victoria', who: 'Applicant', lead: 'As early as possible before works', days: 5, basis: COM_SRC.cond(3) + guide },
    ...(council?.isCoM ? [{ item: 'Notify Events Melbourne and City of Melbourne Customer Relations', who: 'Applicant', lead: '24 hours before works', days: 1, basis: COM_SRC.cond(4) }] : []),
  ];
}
