// Traffic Management Plan (Road Safety Act 1986 s99A; Road Safety (Traffic Management) Regulations 2019 reg. 35;
// Code of Practice for Worksite Safety – Traffic Management Cl. 15) with a traffic impact assessment supporting a
// consent to work in the road reserve (Road Management Act 2004 Sch. 7).
import { REFS } from './decision.js';
import { PERIODS } from './demand.js';
import { tgsSheet, tgsNotes } from './tgs.js';
import { yearsLabel } from './safety.js';
import { COM_SRC, footpathWidth, impactRating } from './council.js';
import { levelOfService } from './standards.js';
import { ROAD_CLASS } from './network.js';
import { HOUR_SHARE, signSpacingD } from './standards.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = v => v == null || !isFinite(v) ? '–' : (v < -0.5 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-AU');
const date = d => d ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '–';
const ph = (v, label) => v ? esc(v) : `<span class="ph">[${esc(label)}]</span>`;

const DEVICE_COLOR = { sign_rwa: '#d4a300', sign_closed: '#b91c1c', sign_detour: '#ea580c', sign_end: '#334155', sign_speed: '#dc2626',
  sign_lane: '#d4a300', sign_stop: '#d4a300', sign_fp: '#1d4ed8', vms: '#111827', arrow: '#111827', tc: '#f97316' };

// Dimensioned site drawing (Cl. 15(2)): OSM road network around the site, the work zone, signed detours,
// delineation lines and every device, numbered to match the device schedule.
export function tgsSvg(net, closures, plan, focus = 'site') {
  const g = net.veh, P = net.proj;
  const pts = [];
  for (const c of closures) pts.push(...c.poly);
  const near = xy => closures.some(c => c.poly.some(q => Math.hypot(q[0] - xy[0], q[1] - xy[1]) < 180));
  for (const mk of plan.markers) { const xy = P.fwd(mk.ll[0], mk.ll[1]); if (focus === 'network' || near(xy)) pts.push(xy); }
  if (focus === 'network') for (const d of plan.detours) for (const ll of d.ll) pts.push(P.fwd(ll[0], ll[1]));
  let minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
  let minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
  const pad = 60, minSpan = 320;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const span = Math.max(minSpan, maxX - minX + 2 * pad, (maxY - minY + 2 * pad) * 1.45);
  minX = cx - span / 2; maxX = cx + span / 2;
  const spanY = span / 1.45; minY = cy - spanY / 2; maxY = cy + spanY / 2;
  const W = 1000, H = Math.round(W / 1.45), k = W / span;
  const X = p => ((p[0] - minX) * k).toFixed(1), Y = p => ((maxY - p[1]) * k).toFixed(1);
  const path = xy => xy.map((p, i) => `${i ? 'L' : 'M'}${X(p)},${Y(p)}`).join('');
  const inView = xy => xy.some(p => p[0] > minX && p[0] < maxX && p[1] > minY && p[1] < maxY);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="background:#fafaf7;border:1px solid #cbd5e1;page-break-inside:avoid;break-inside:avoid">`];
  // roads
  const widthByRank = r => r <= 2 ? 9 : r <= 4 ? 7 : r <= 5 ? 5 : 3.5;
  for (const L of g.links) if (inView(L.xy)) out.push(`<path d="${path(L.xy)}" stroke="#d6d3cc" stroke-width="${(widthByRank(L.rank) * Math.max(0.6, k)).toFixed(1)}" fill="none" stroke-linecap="round"/>`);
  for (const L of g.links) if (inView(L.xy)) out.push(`<path d="${path(L.xy)}" stroke="#ffffff" stroke-width="${(widthByRank(L.rank) * Math.max(0.6, k) - 2).toFixed(1)}" fill="none" stroke-linecap="round"/>`);
  // street labels (one per name)
  const named = new Set();
  for (const L of [...g.links].sort((a, b) => a.rank - b.rank || b.len - a.len)) {
    if (named.has(L.name) || L.len < 60 || !inView(L.xy) || /^(Local street|Collector|Shared zone|Local road|Arterial link)$/.test(L.name)) continue;
    const m = L.xy[L.xy.length >> 1];
    if (m[0] < minX || m[0] > maxX || m[1] < minY || m[1] > maxY) continue;
    const a = L.xy[0], b = L.xy[L.xy.length - 1];
    let ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    named.add(L.name);
    out.push(`<text x="${X(m)}" y="${Y(m)}" transform="rotate(${ang.toFixed(0)} ${X(m)} ${Y(m)})" font-size="12" font-family="Arial" fill="#475569" text-anchor="middle" dy="-8">${esc(L.name)}</text>`);
    if (named.size > 14) break;
  }
  // detours, work zone, delineation
  for (const d of plan.detours) out.push(`<path d="${path(d.ll.map(ll => P.fwd(ll[0], ll[1])))}" stroke="#7c3aed" stroke-width="4" stroke-dasharray="10 7" fill="none"/>`);
  for (const c of closures) for (const lid of c.allLinks) out.push(`<path d="${path(g.links[lid].xy)}" stroke="${c.type === 'full' || c.type === 'direction' ? '#dc2626' : '#f97316'}" stroke-width="${(10 * Math.max(0.6, k)).toFixed(1)}" stroke-opacity="0.55" fill="none"/>`);
  for (const l of plan.lines) {
    const st = l.kind === 'barrier' ? 'stroke="#ea580c" stroke-width="4"' : l.kind === 'cones' ? 'stroke="#fb923c" stroke-width="3" stroke-dasharray="2 5"' : 'stroke="#0284c7" stroke-width="3" stroke-dasharray="6 3"';
    out.push(`<path d="${path(l.ll.map(ll => P.fwd(ll[0], ll[1])))}" ${st} fill="none"/>`);
  }
  // devices
  plan.markers.forEach((mk, i) => {
    const p = P.fwd(mk.ll[0], mk.ll[1]);
    if (p[0] < minX || p[0] > maxX || p[1] < minY || p[1] > maxY) return;
    const col = DEVICE_COLOR[mk.item] || '#334155';
    out.push(`<circle cx="${X(p)}" cy="${Y(p)}" r="9" fill="${mk.missing ? '#ffffff' : col}" stroke="${mk.missing ? '#dc2626' : '#ffffff'}" stroke-width="2" ${mk.missing ? 'stroke-dasharray="3 2"' : ''}/>`);
    out.push(`<text x="${X(p)}" y="${Y(p)}" font-size="10" font-family="Arial" font-weight="700" fill="${mk.missing ? '#dc2626' : '#ffffff'}" text-anchor="middle" dy="3.5">${i + 1}</text>`);
  });
  // north arrow and scale bar
  const bar = [20, 50, 100, 200, 500].find(m => m * k > 90) || 500;
  out.push(`<g font-family="Arial" font-size="12" fill="#0f172a"><path d="M${W - 40},20 l10,26 l-10,-7 l-10,7 z" fill="#0f172a"/><text x="${W - 40}" y="62" text-anchor="middle">N</text>
    <rect x="20" y="${H - 30}" width="${(bar * k).toFixed(1)}" height="6" fill="#0f172a"/><text x="20" y="${H - 38}">${bar} m</text></g>`);
  out.push('</svg>');
  return out.join('');
}

// ctx = { net, closures, r, c, meta, app, matches, checks, appr, options, inventory, standardsHtml, siteName, fetchedAt, CLOSURE_TYPES, groupByRef }
// Two documents from one run. doc = 'tmp': the Traffic Management Plan, laid out item by item against the prescribed
// content of a TMP, Road Safety (Traffic Management) Regulations 2019 reg. 35, as restated in the Code of Practice for
// Worksite Safety – Traffic Management (Vic Gazette S280, 2023) Cl. 15(2)–(5), with approvals, equipment and the s99A
// declaration. doc = 'tia': the traffic impact assessment the coordinating road authority weighs under the Road
// Management Act 2004 Sch. 7 Cl. 14 (network, public transport, pedestrians, options, costs).
export function councilReport(ctx, doc = 'tmp') {
  const { net, closures, r, c, app, checks, appr, options, inventory, CLOSURE_TYPES, groupByRef } = ctx;
  const g = net.veh, per = PERIODS[r.period], base = r.base;
  const label = k => inventory.find(i => i.key === k)?.label || k;
  const trams = groupByRef(r.pt.tram), buses = groupByRef(r.pt.bus);
  const status = s => ({ pass: '<b class="ok">Pass</b>', warn: '<b class="warn">Check</b>', fail: '<b class="bad">Fail</b>', action: '<b class="act">Action</b>', info: 'Note' }[s]);
  const nFail = checks.filter(x => x.status === 'fail').length, nWarn = checks.filter(x => x.status === 'warn').length;
  const workLinks = [...new Set(closures.flatMap(cl => cl.allLinks))].map(l => g.links[l]);
  const seenCount = new Set();
  const counts = ctx.matches.filter(m => workLinks.some(L => L.id === m.link)).filter(m => { const k = m.road + m.aadt; return !seenCount.has(k) && seenCount.add(k); });
  const lanesTxt = [...new Set(workLinks.map(L => L.oneway ? `${L.lanesF} (one-way carriageway)` : `${L.lanesF} + ${L.lanesB}`))].join(', ');
  const speedVals = [...new Set(workLinks.map(L => Math.round(L.speed)))];
  const speeds = speedVals.join(' / ');
  const maxSpeed = Math.max(...speedVals);
  const hv = r.env.base.vkt.hcv / Math.max(1, r.env.base.vkt.car + r.env.base.vkt.lcv + r.env.base.vkt.hcv);
  const night = r.period === 'NIGHT';
  // temporary works speed-limit signs are no lower than 40 km/h (VicRoads guide p. 10); a Stop/Slow travel speed below that is operational, not a signed limit
  const tempSpeeds = [...new Set(closures.filter(cl => cl.type !== 'full' && cl.type !== 'direction').map(cl => Math.max(40, cl.speed)))];
  const clearanceSpeed = tempSpeeds.length ? Math.max(...tempSpeeds) : maxSpeed;
  const clearance = clearanceSpeed <= 40 ? 0.3 : clearanceSpeed <= 80 ? 0.5 : 1.0;

  const closureRows = closures.map(cl => {
    const m = ctx.meta(cl);
    return `<tr><td>${esc(cl.street)}</td><td>${m.from && m.to ? `${esc(m.from)} to ${esc(m.to)}` : '–'}</td><td>${esc(CLOSURE_TYPES[cl.type])}${cl.type === 'lane' ? ` (${cl.lanesClosed} lane)` : ''}</td>
      <td>${cl.type === 'full' || cl.type === 'shuttle' ? 'Both' : cl.direction === 'both' ? 'Both' : cl.direction === 'ab' ? m.ab : m.ba}</td><td class="n">${fmt(cl.length)} m</td><td>${cl.footpath === 'open' ? 'Open' : cl.footpath === 'both' ? 'Closed both sides' : `Closed ${cl.footpath === 'left' ? m.leftSide : m.rightSide}`}</td></tr>`;
  }).join('');
  const deviceRows = r.plan.markers.map((mk, i) => `<tr><td class="n">${i + 1}</td><td>${esc(label(mk.item))}</td><td>${esc(mk.text || '')}${mk.sub ? `, ${esc(mk.sub)}` : ''}</td><td>${mk.ll[0].toFixed(6)}, ${mk.ll[1].toFixed(6)}</td><td>${mk.missing ? '<b class="bad">Not in stock</b>' : 'Available'}</td></tr>`).join('');
  const itemRows = r.plan.items.filter(i => i.required).map(i => `<tr><td>${esc(i.label)}</td><td class="n">${i.required}</td><td class="n">${i.stock}</td><td class="n">${i.shortfall ? `<b class="bad">${i.shortfall}</b>` : '–'}</td></tr>`).join('');
  const ecoRows = [['carTime', 'Car travel time'], ['lcvTime', 'Light commercial vehicle time'], ['freight', 'Heavy vehicle time'], ['voc', 'Vehicle operating cost'], ['pt', 'Public transport passengers'], ['ped', 'Pedestrians'], ['carbon', 'Carbon'], ['airQual', 'Air pollution'], ['noise', 'Noise'], ['safety', 'Road safety (crash risk)'], ['business', 'Local business (user input)']]
    .map(([k, l]) => `<tr><td>${l}</td><td class="n">${money(c.lines[k])}</td><td class="n">${money(c.lineTotals[k])}</td></tr>`).join('');
  const sf = r.safety, crashYrs = sf ? yearsLabel(sf.years) : '';
  const crashCells = x => `<td class="n">${x.n}</td><td class="n">${x.fatal}</td><td class="n">${x.serious}</td><td class="n">${x.ped}</td><td class="n">${x.cyc}</td>`;
  const safetyHtml = sf ? `<table><tr><th>Location (injury crashes, ${crashYrs})</th><th class="n">All</th><th class="n">Fatal</th><th class="n">Serious</th><th class="n">Pedestrian</th><th class="n">Cyclist</th></tr>
<tr><td><b>Work zone section</b></td>${crashCells(sf.site)}</tr>
${sf.diverted.slice(0, 8).map(d => `<tr><td>${esc(d.name)} (+${fmt(d.up)} veh/h)</td>${crashCells(d)}</tr>`).join('')}
<tr><td>Whole study area</td>${crashCells(sf.area)}</tr></table>
<table><tr><th>Road type</th><th class="n">Crashes</th><th class="n">Exposure (M veh-km)</th><th class="n">Crash cost per M veh-km</th><th class="n">Change with works (veh-km/h)</th></tr>
${Object.entries(sf.rates).filter(([, t]) => t.mvkt > 0).map(([k, t]) => `<tr><td>${{ arterial: 'Arterial', local: 'Local / collector', freeway: 'Freeway' }[k]}</td><td class="n">${t.n}</td><td class="n">${fmt(t.mvkt, 1)}</td><td class="n">${money(t.costPerMvkt)}${t.fromData ? '' : ' *'}</td><td class="n">${fmt(sf.dMvkt[k] * 1e6)}</td></tr>`).join('')}</table>
<p>Change in expected crash cost: <b>${money(sf.costPerHour)}</b> per hour, ${money(sf.costPerHour * c.dur)} over the works${sf.crashesPerHour ? ` (${fmt(sf.crashesPerHour * c.dur, 3)} injury crashes)` : ''}.</p>
<p class="muted">Crashes: DTP Victoria road crash data, injury crashes within 20 m of the road (2020 excluded for COVID-19 restrictions; 2025 incomplete). Exposure: modelled baseline flow expanded to a year with the SCATS hour share. Cost per crash: TfNSW EPV 2025.1 Table 5.2 (inclusive willingness to pay, urban). * fewer than 10 crashes: TfNSW Table 5.1 average. The risk inside the work zone itself is not valued.</p>`
    : '<p class="ph">[Crash data not loaded]</p>';
  const riskRows = checks.filter(x => x.status !== 'pass').map((x, i) => `<tr><td class="n">R${i + 1}</td><td>${esc(x.topic)}</td><td>${esc(x.finding)}</td><td>${esc(x.rec || '')}</td><td class="ph">[likelihood]</td><td class="ph">[consequence]</td><td class="ph">[rating]</td></tr>`).join('');

  const optionsHtml = options ? `
    <table><tr><th>Rank</th><th>Treatment</th><th>Time window</th><th class="n">Cost over works</th><th class="n">Extra veh‑h/h</th><th>Trams interrupted</th><th>Criteria failed</th></tr>
    ${options.rows.slice(0, 12).map((o, i) => `<tr${o === options.best ? ' class="best"' : ''}><td class="n">${i + 1}</td><td>${esc(o.treatment.label)}</td><td>${esc(PERIODS[o.period].label)}</td><td class="n">${money(o.cost.sum)}</td><td class="n">${fmt(Math.max(0, o.r.kpi.dVHT))}</td><td>${o.trams.join(', ') || '–'}</td><td>${o.fails ? esc(o.failText) : 'none'}</td></tr>`).join('')}</table>
    <p>${options.best ? `<b>Preferred option:</b> ${esc(options.best.treatment.label)}, ${esc(PERIODS[options.best.period].label)}, the lowest-cost option that passes every check.` : '<b>No option passes every check.</b> Revise the work zone or equipment before lodging.'} All options assume the same works duration; productivity differences between day and night works are not included.</p>
    <p class="muted">${esc(REFS.rma5)}; ${esc(REFS.rma14)}.</p>`
    : `<p class="ph">[Run “Find the best option” in the Decide tab to add the options analysis (${esc(REFS.rma14)}).]</p>`;

  // compliance matrix: every prescribed element and where this document addresses it
  const req = [
    ['Reg. 35 / Code Cl. 15(2)', 'Diagram or dimensioned drawing of the specific place of the activity (or generic drawing / standard operating procedures)', '3.1', 'Provided (site drawing and detour drawing with numbered devices)'],
    ['Reg. 35 / Code Cl. 15(3)(a)', 'Nature and expected duration of the activity', '1.3', app.works && app.start ? 'Provided' : 'Applicant to complete'],
    ['Reg. 35 / Code Cl. 15(3)(b)', 'Worksite or location of the activity', '1.2', 'Provided'],
    ['Reg. 35 / Code Cl. 15(3)(c)', 'Risk assessment undertaken of the activity', '4.1, 4.2', 'Hazards identified; ratings by the qualified designer'],
    ['Reg. 35 / Code Cl. 15(3)(d)', 'Arrangement of traffic control devices for the duration, each stage, day and night where relevant', '3.2', 'Provided for the modelled stage; other stages by applicant'],
    ['Reg. 35 / Code Cl. 15(3)(e)', 'Any proposed reduction in the speed limit', '1.6', 'Provided'],
    ['Reg. 35 / Code Cl. 15(3)(f)', 'Provision for public transport, other vehicular traffic, pedestrians, cyclists and persons with disabilities', '1.4', 'Provided; cyclists by applicant'],
    ['Reg. 35 / Code Cl. 15(3)(g)', 'Other measures to control identified risks to road users and workers', '4.3', 'Provided'],
    ['Code Cl. 15(4)', 'Matters considered: nature of activity, road type, speed limit, identified delays, clearance between traffic and workers', '4.4', 'Provided'],
    ['Code Cl. 15(5)', 'Copy kept at the worksite while workers are present and available for inspection', '6.1', 'Works manager to action'],
    ['Code Cl. 11(4)', 'Appropriately trained and qualified persons engaged; TMP in operation; warnings; directions to workers', '6.2', 'Declaration by the applicant'],
  ];

  const isTmp = doc !== 'tia';
  const docType = isTmp ? 'Traffic Management Plan' : 'Traffic Impact Assessment';
  const docNo = app.tmpNo ? (isTmp ? app.tmpNo : `${app.tmpNo}-TIA`) : (isTmp ? '[TMP no.]' : '[TIA no.]'), rev = app.version || '[Rev]';
  const title = `${docType}: ${closures.map(cl => cl.street).join(', ')}`;
  const closureTable = `<table><tr><th>Street</th><th>Between</th><th>Treatment</th><th>Direction</th><th class="n">Length</th><th>Footpath</th></tr>${closureRows}</table>`;
  const siteTable = `<table>
<tr><th style="width:30%">Item</th><th>Detail</th><th style="width:28%">Source</th></tr>
<tr><td>Location</td><td>${esc(closures.map(cl => { const m = ctx.meta(cl); return `${cl.street}${m.from && m.to ? ` between ${m.from} and ${m.to}` : ''}`; }).join('; '))} (${esc(ctx.siteName)})</td><td>OpenStreetMap</td></tr>
<tr><td>Start / end coordinates</td><td>${closures.map(cl => { const a = net.proj.inv(cl.poly[0][0], cl.poly[0][1]), b = net.proj.inv(cl.poly[cl.poly.length - 1][0], cl.poly[cl.poly.length - 1][1]); return `A ${a[0].toFixed(6)}, ${a[1].toFixed(6)} → B ${b[0].toFixed(6)}, ${b[1].toFixed(6)}`; }).join('<br>')}</td><td>Drawn in the tool (WGS84)</td></tr>
<tr><td>Road type</td><td>${appr.arterial ? 'Declared arterial road' : 'Local road'}</td><td>DTP declared road network (Traffic Volume layer)</td></tr>
<tr><td>Lanes per direction</td><td>${esc(lanesTxt)}</td><td>OpenStreetMap</td></tr>
<tr><td>Posted speed limit</td><td>${esc(speeds)} km/h</td><td>OpenStreetMap / Road Safety Road Rules 2017 r.25</td></tr>
<tr><td>Traffic volume</td><td>${counts.length ? counts.slice(0, 3).map(m => `${esc(m.road)}: AADT ${fmt(m.aadt)} (two-way), ${fmt(m.obs[r.period])} veh/h in the analysis hour${m.hvShare ? `, ${fmt(m.hvShare * 100, 1)}% heavy vehicles` : ''}`).join('<br>') : `No DTP count on the site; modelled ${fmt(r.affectedFlow)} veh/h`}</td><td>Transport Victoria Traffic Volume (${counts[0]?.year || '–'})</td></tr>
<tr><td>Public transport</td><td>${[...trams, ...buses].map(x => `${trams.includes(x) ? 'Tram' : 'Bus'} ${esc(x.ref)}${x.freq != null ? ` (${fmt(x.freq, 1)} services/h per direction)` : ''}`).join(', ') || 'None through the work zone'}</td><td>PTV GTFS timetable</td></tr>
${r.businesses ? `<tr><td>Businesses fronting the site</td><td>${r.businesses.n ? `${r.businesses.n}: ${esc(r.businesses.groups.map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', '))}${r.businesses.names.length ? ` (e.g. ${esc(r.businesses.names.slice(0, 4).join(', '))})` : ''}` : 'None mapped'}</td><td>OpenStreetMap shop and amenity tags</td></tr>` : ''}
<tr><td>Pedestrians</td><td>${r.footfall != null ? fmt(r.footfall) + ' people/h' : 'No count available'}</td><td>${esc(r.ped.pedSource || '')}</td></tr>
<tr><td>Crash history</td><td>${sf ? `${sf.site.n} injury crash(es) on the work zone section, ${crashYrs}: ${sf.site.fatal} fatal, ${sf.site.serious} serious; ${sf.site.ped} involving pedestrians, ${sf.site.cyc} cyclists` : 'Not assessed'}</td><td>DTP Victoria road crash data</td></tr>
</table>`;
  const ptHtml = `${trams.length || buses.length ? `<table><tr><th>Route</th><th>Impact</th><th>Provision</th></tr>
${trams.map(t => `<tr><td>Tram ${esc(t.ref)}</td><td>${esc(t.status)}${t.stops.size ? `; stops out of service: ${[...t.stops].map(esc).join(', ')}` : ''}</td><td>${t.replacementBuses ? `${t.replacementBuses} replacement buses, ${esc(t.replacementFrom)} ↔ ${esc(t.replacementTo)} (${fmt(t.replacementMin, 1)} min one way)` : esc(t.replacementNote || 'Coordinate with DTP / Yarra Trams')}</td></tr>`).join('')}
${buses.map(b => `<tr><td>Bus ${esc(b.ref)}</td><td>${esc(b.status)}: +${fmt(b.extraMin, 1)} min${b.stops.size ? `; stops skipped: ${[...b.stops].map(esc).join(', ')}` : ''}</td><td>${b.status === 'Diverted' ? 'Diversion as shown on the detour drawing; temporary stops by the operator' : 'Continues through the work zone'}</td></tr>`).join('')}</table>
<p class="muted">Notice to the public transport provider: ${esc(REFS.rmaPT)}.</p>` : '<p>No tram or bus route runs through the work zone.</p>'}
`;
  const pedHtml = `<p>${r.ped.affected ? `${fmt(r.ped.closedLen)} m of footpath closed. ${Math.round(r.ped.affectedShare * 100)}% of sampled walking trips nearby are affected; average detour ${fmt(r.ped.avgDetour)} m, longest ${fmt(r.ped.maxDetour)} m. Pedestrian fencing and FOOTPATH CLOSED signs as scheduled (3.2).` : esc(r.ped.note || 'Footpaths remain open.')}</p>
`;
  const dataLine = `<p class="muted">Data: road network OpenStreetMap (ODbL), retrieved ${ctx.fetchedAt ? ctx.fetchedAt.toLocaleDateString('en-AU') : '-'}; traffic counts Transport Victoria (CC BY 4.0); timetable PTV GTFS (CC BY 4.0); pedestrian counts City of Melbourne.</p>`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
@page{size:A4;margin:18mm 16mm 20mm 16mm;@bottom-left{content:"${esc(docNo)} · ${esc(rev)} · ${esc(title.replace(/"/g, ''))}";font:8.5pt Arial,sans-serif;color:#64748b}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8.5pt Arial,sans-serif;color:#64748b}}
@page:first{@bottom-left{content:none}@bottom-right{content:none}}
body{font:10pt/1.5 Arial,Helvetica,sans-serif;color:#1f2937;max-width:900px;margin:24px auto;padding:0 24px;background:#fff}
h1{font-size:26pt;font-weight:700;color:#0b1f3a;margin:0 0 6px;letter-spacing:-.3px}
h2{font-size:12.5pt;color:#0b1f3a;margin:22px 0 6px;padding-bottom:3px;border-bottom:1px solid #0b1f3a;page-break-after:avoid}
h3{font-size:10.5pt;color:#0b1f3a;margin:14px 0 5px;page-break-after:avoid}
.part{font-size:9pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#0b1f3a;background:#f1f5f9;padding:5px 8px;margin-top:28px}
table{border-collapse:collapse;width:100%;margin:5px 0 10px;font-size:9pt}tr{page-break-inside:avoid}
th,td{border:1px solid #cbd5e1;padding:3.5px 6px;text-align:left;vertical-align:top}th{background:#eef2f6;font-weight:700;color:#0b1f3a}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
p,li{font-size:10pt}ul{padding-left:18px}
.muted{color:#64748b;font-size:8.5pt}.ph{color:#92400e;background:#fef3c7}.ok{color:#166534}.warn{color:#92400e}.bad{color:#991b1b}.act{color:#1e40af}
.legal{border-left:3px solid #0b1f3a;padding:3px 9px;margin:3px 0 8px;font-size:8.8pt;color:#475569}
.cover{min-height:245mm;display:flex;flex-direction:column;page-break-after:always}
.cover .band{height:10px;background:#0b1f3a;margin-bottom:34px}
.cover .brandline{display:flex;align-items:center;gap:9px;font-size:9pt;color:#64748b;margin:-18px 0 22px}
.cover .kicker{font-size:9pt;letter-spacing:2px;text-transform:uppercase;color:#64748b;margin-bottom:10px}
.cover .sub{font-size:12pt;color:#334155;margin-bottom:28px}
.cover table td:first-child{width:34%;color:#475569;background:#f8fafc}
.cover .foot{margin-top:auto;font-size:8.5pt;color:#64748b;border-top:1px solid #cbd5e1;padding-top:8px}
.toc td{border:0;border-bottom:1px dotted #cbd5e1;padding:3px 2px}
tr.best td{background:#f0fdf4}
.form td:nth-child(odd){width:24%;color:#475569;background:#f8fafc}.form th{text-align:left}.cb{display:inline-block;margin:1px 14px 1px 0;white-space:nowrap}.cbs .cb{min-width:46%}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:22px}.sig div{border-top:1px solid #1f2937;padding-top:4px;min-height:70px;font-size:9pt;color:#475569}
@media print{body{margin:0;max-width:none;padding:0}button{display:none}.pb{page-break-before:always}}
</style></head><body>
<button onclick="print()" style="float:right;padding:6px 12px">Print / save as PDF</button>

`;
  const cover = `<section class="cover">
  <div class="band"></div>
  <div class="brandline">${ctx.logo ? `<img src="${ctx.logo}" alt="WorkZoneSim" style="height:30px;width:auto">` : ''}<span>Prepared with WorkZoneSim, Work Zone Impact Simulator</span></div>
  <div class="kicker">${docType}</div>
  <h1>${esc(closures.map(cl => cl.street).join(', '))}</h1>
  <div class="sub">${esc(closures.map(cl => { const m = ctx.meta(cl); return `${CLOSURE_TYPES[cl.type]}${m.from && m.to ? `, ${m.from} to ${m.to}` : ''}`; }).join('; '))} · ${esc(ctx.siteName)}</div>
  <table>
    <tr><td>Applicant / works manager</td><td>${ph(app.applicant, 'Applicant organisation')}</td></tr>
    <tr><td>Nature of works</td><td>${ph(app.works, 'Description of works')}</td></tr>
    <tr><td>Coordinating road authority</td><td>${esc(appr.authority)}</td></tr>
    <tr><td>Proposed start and hours</td><td>${app.start ? date(app.start) : ph('', 'Start date')} · ${ph(app.hours, 'Working hours')}</td></tr>
    <tr><td>Related document</td><td>${isTmp ? 'Traffic Impact Assessment' : 'Traffic Management Plan'}${app.tmpNo ? ` ${esc(isTmp ? `${app.tmpNo}-TIA` : app.tmpNo)}` : ''}</td></tr>
    <tr><td>Road occupation</td><td>${fmt(c.dur)} hours</td></tr>
    <tr><td>Document number · revision</td><td>${app.tmpNo ? esc(docNo) : ph('', isTmp ? 'TMP no.' : 'TIA no.')} · ${ph(app.version, 'Rev')}</td></tr>
    <tr><td>Prepared by</td><td>${ph(app.preparer, 'Name and traffic management qualification')}</td></tr>
    <tr><td>Contact</td><td>${ph(app.contact, 'Name, phone, email')}</td></tr>
  </table>
  <h3>Document control</h3>
  <table><tr><th>Revision</th><th>Date</th><th>Description</th><th>Prepared</th><th>Reviewed</th><th>Approved</th></tr>
  <tr><td>${ph(app.version, 'Rev')}</td><td>${new Date().toLocaleDateString('en-AU')}</td><td>Issued for consent</td><td>${ph(app.preparer, 'Name')}</td><td class="ph">[Name]</td><td class="ph">[Name]</td></tr></table>
  <div class="foot">${isTmp ? 'Prepared under the Road Safety Act 1986 s99A, the Road Safety (Traffic Management) Regulations 2019 reg. 35 and the Code of Practice for Worksite Safety: Traffic Management (Vic, 2023). The network impacts are assessed in the accompanying Traffic Impact Assessment.' : `Prepared to support the coordinating road authority's consideration under ${esc(REFS.rma14)}. Read with the Traffic Management Plan for the same works.`}</div>
</section>

`;
  // ---- TMP body in the layout of the TfNSW TCAWS TMP-01 checklist (Traffic control at work sites Technical Manual,
  // Appendix A.2.3), filled from the run. A box is ticked only where the tool assessed or detected the item.
  const cb = (on, t) => `<span class="cb">${on ? '☒' : '☐'} ${t}</span>`;
  const today = new Date().toLocaleDateString('en-AU');
  const peakHour = (from, to) => { let best = from; for (let h = from; h < to; h++) if (HOUR_SHARE.weekday[h] > HOUR_SHARE.weekday[best]) best = h; return `${best}:00–${best + 1}:00`; };
  const ttmAround = closures.some(cl => cl.type === 'full' || cl.type === 'direction');
  const ttmPast = closures.some(cl => cl.type === 'lane' || cl.type === 'shuttle');
  const usesBarrier = closures.some(cl => cl.delineation === 'barrier');
  const laneClosure = closures.some(cl => cl.type === 'lane' || cl.type === 'shuttle');
  const blockedTrams = trams.filter(t => /interrupted/.test(t.status));
  const hvPct = counts.find(m => m.hvShare)?.hvShare ?? hv;
  const users = {
    ped: r.ped.affected || (r.footfall || 0) > 0, cyc: !!(sf && sf.site.cyc), moto: !!(sf && sf.site.moto), osom: false,
    freight: hvPct > 0.02, pwd: r.ped.affected, pt: trams.length + buses.length > 0,
  };
  const userNotes = [
    users.ped && (r.ped.affected ? `Pedestrians: ${fmt(r.ped.closedLen)} m of footpath closed, average detour ${fmt(r.ped.avgDetour)} m (1.4).` : `Pedestrians: ${fmt(r.footfall)} people/h pass the site; footpaths stay open.`),
    users.cyc && `Cyclists: ${sf.site.cyc} cyclist injury crash(es) on the section (${crashYrs}); provide for cyclists through or around the site.`,
    users.moto && `Motorcyclists: ${sf.site.moto} motorcyclist injury crash(es) on the section (${crashYrs}).`,
    users.freight && `Freight: ${fmt(hvPct * 100, 1)}% heavy vehicles (DTP); detour must suit heavy vehicle turning paths.`,
    users.pwd && 'Persons with disability, prams or children: accessible alternative route required (1.4).',
    users.pt && `Public transport: ${blockedTrams.length ? `tram ${blockedTrams.map(t => esc(t.ref)).join(', ')} interrupted` : trams.length ? `tram ${trams.map(t => esc(t.ref)).join(', ')} affected` : ''}${blockedTrams.length && buses.length ? '; ' : ''}${buses.length ? `bus ${buses.map(b => esc(b.ref)).join(', ')} diverted or delayed` : ''} (1.4).`,
  ].filter(Boolean);
  const riskItems = [
    [true, 'Proximity of traffic'], [r.queues.length > 0, 'Queued traffic'], [true, 'High traffic volume'], [true, 'Traffic speed and compliance behaviour'],
    [true, 'Traffic composition'], [true, 'Exposure and proximity of workers to live traffic'], [true, 'Length of delays for road users'], [false, 'Traffic generating land use (hospital, mine, school)'],
    [tempSpeeds.length > 0, 'Non-compliance with temporary speed limits'], [laneClosure, 'Reduced lane and shoulder widths'], [r.kpi.unserved > 1, 'Compromised access points'], [false, 'Site vehicle access and egress points'],
    [false, 'Horizontal and vertical alignment'], [false, 'Utilities including above and below services'], [!!sf, 'Crash history'], [false, 'Topographical constraints'],
    [true, 'Sight distances (sign spacing)'], [false, 'Emergency services'], [false, 'Car parking impacted'], [users.pt, 'Transport services (bus / tram stops)'],
    [ttmAround || r.kpi.unserved > 1, 'Access to private and commercial properties'], [r.amenity.streets.length > 0, 'Local road access'], [false, 'Special events or high risk venues'],
  ];
  const q0 = r.queues[0];
  const needMoa = r.plan.vmsPlaced > 0 || tempSpeeds.length > 0;
  const longWorks = c.dur > 168;
  const tcaws = `
<h2>4.1 TMP checklist</h2>
<div class="legal">Layout of the TfNSW TCAWS TMP-01 checklist (Traffic control at work sites Technical Manual, Appendix A.2.3). Legal content for Victoria: Road Safety (Traffic Management) Regulations 2019 reg. 35 and Worksite Code Cl. 15, see the compliance index. ☒ = assessed or detected by the analysis; ☐ = for the traffic management designer to complete.</div>

<h3>Prepared by</h3>
<table class="form"><tr><td>Name</td><td>${ph(app.preparer, 'Name')}</td><td>Role</td><td class="ph">[Role]</td></tr>
<tr><td>Card number</td><td class="ph">[TTM card no.]</td><td>Organisation</td><td>${ph(app.applicant, 'Organisation')}</td></tr>
<tr><td>Signature</td><td></td><td>Date</td><td>${today}</td></tr></table>

<h3>Location of works</h3>
<table class="form"><tr><td>Project</td><td>${ph(app.works, 'Project name')}</td></tr>
<tr><td>Activity / work</td><td>${ph(app.works, 'Activity')}; ${esc(closures.map(cl => `${CLOSURE_TYPES[cl.type].toLowerCase()} on ${cl.street}`).join('; '))}</td></tr>
<tr><td>Location</td><td>${esc(closures.map(cl => { const m = ctx.meta(cl); return `${cl.street}${m.from && m.to ? ` between ${m.from} and ${m.to}` : ''}`; }).join('; '))}, ${esc(ctx.siteName)}</td></tr>
<tr><td>Dates relevant for TMP work</td><td>${app.start ? date(app.start) : ph('', 'DD/MM/YY')} · ${fmt(c.dur)} hours of occupation · ${ph(app.hours, 'working hours')}</td></tr></table>

<h3>Traffic management strategy verification</h3>
<table class="form"><tr><td>Network strategy received and attached</td><td>${cb(true, 'Yes')} Traffic Impact Assessment ${esc(app.tmpNo ? `${app.tmpNo}-TIA` : '')} for the same works (network effects, public transport, pedestrians, options, costs)</td></tr>
<tr><td>Current speed limits</td><td>${esc([...new Set(workLinks.map(L => `${L.name}: ${Math.round(L.speed)} km/h`))].join('; '))}</td></tr>
<tr><td>Traffic volumes (AADT)</td><td>${counts.length ? counts.slice(0, 3).map(m => `${esc(m.road)}: ${fmt(m.aadt)} (two-way, ${m.year || 'DTP'})`).join('; ') : `No DTP count on the section; modelled ${fmt(r.affectedFlow)} veh/h in the analysis hour`}</td></tr>
<tr><td>Hourly traffic volumes</td><td>${counts.length ? counts.slice(0, 3).map(m => `${esc(m.road)}: ${fmt(m.obs[r.period])} veh/h`).join('; ') : `${fmt(r.affectedFlow)} veh/h (modelled)`}, ${esc(per.label.toLowerCase())}</td></tr>
<tr><td>Operating speed</td><td>Posted ${esc(speeds)} km/h; modelled average network speed ${fmt(base.summary.avgSpeed, 1)} km/h without works</td></tr>
<tr><td>Peak times</td><td>AM ${peakHour(5, 12)} · PM ${peakHour(12, 21)} (weekday SCATS profile, Transport Victoria)</td></tr>
<tr><td>Traffic composition</td><td>${cb(false, 'OSOM')} ${cb(hvPct > 0, `Heavy vehicles ${fmt(hvPct * 100, 1)}%`)} ${cb(false, 'Permit vehicle routes')} <span class="ph">[confirm OSOM and permit routes]</span></td></tr>
<tr><td>Site and work specific considerations</td><td>${[r.amenity.nightNoise && 'Night works push traffic onto residential streets (noise).', r.amenity.hotspots && `${r.amenity.hotspots} local street(s) more than double their traffic.`, sf && sf.site.ksi && `${sf.site.ksi} fatal or serious crash(es) on the section (${crashYrs}).`].filter(Boolean).join(' ') || '–'} <span class="ph">[environment or community concerns]</span></td></tr>
<tr><td>Additional options available</td><td>${options ? `${options.rows.length} options assessed (Traffic Impact Assessment section 5)` : '<span class="ph">[run the options assessment]</span>'}</td></tr></table>

<h3>Decision point: temporary traffic management method</h3>
<table class="form"><tr><td>Options assessment completed</td><td>${cb(!!options, 'Yes')} ${cb(!options, 'No')}</td></tr>
<tr><td>Summary of options</td><td>${options ? options.rows.slice(0, 4).map((o, i) => `${i + 1}. ${esc(o.treatment.label)}, ${esc(PERIODS[o.period].label)}: ${money(o.cost.sum)}${o.fails ? `, fails ${esc(o.failText)}` : ''}`).join('<br>') : '<span class="ph">[summary of options]</span>'}</td></tr>
<tr><td>TTM method</td><td>${cb(ttmAround, 'Around')} ${cb(ttmPast, 'Past')} ${cb(false, 'Through')}</td></tr>
<tr><td>Option selected</td><td>${esc(closures.map(cl => `${CLOSURE_TYPES[cl.type]} on ${cl.street}`).join('; '))}, ${esc(per.label)}</td></tr>
<tr><td>Justification</td><td>${options?.best ? `${options.best.treatment.label === closures.map(cl => CLOSURE_TYPES[cl.type]).join(', ') ? '' : `Lowest-cost option passing every check: ${esc(options.best.treatment.label)}, ${esc(PERIODS[options.best.period].label)} (${money(options.best.cost.sum)}). `}Assessed arrangement: +${fmt(Math.max(0, r.kpi.dVHT))} vehicle-hours per hour, ${money(c.sum)} over the works.` : `+${fmt(Math.max(0, r.kpi.dVHT))} vehicle-hours per hour, ${money(c.sum)} over the works. <span class="ph">[justification]</span>`}</td></tr></table>

<h3>Traffic management planning</h3>
<table class="form"><tr><td>TTM type</td><td>${cb(false, 'Mobile')} ${cb(false, 'Low impact')} ${cb(true, 'Static')}</td></tr>
<tr><td>Lane or shoulder widths modified</td><td>${cb(laneClosure, 'Yes')} ${cb(!laneClosure, 'No')}${laneClosure ? ' <span class="ph">[open lane widths and drawing]</span>' : ''}</td></tr>
<tr><td>Specific road users impacted</td><td>${cb(users.ped, 'Pedestrians')} ${cb(users.cyc, 'Cyclists')} ${cb(users.moto, 'Motorcyclists')} ${cb(users.osom, 'OSOM')} ${cb(users.freight, 'Freight industry')} ${cb(users.pwd, 'Persons with disability, prams or children')} ${cb(users.pt, 'Public transport')} ${cb(false, 'Other')}</td></tr>
<tr><td>Details of impacts</td><td>${userNotes.length ? `<ul style="margin:0">${userNotes.map(x => `<li>${x}</li>`).join('')}</ul>` : '–'}</td></tr>
<tr><td>Additional location specific requirements</td><td class="ph">[e.g. school zones, hospital access, events]</td></tr></table>

<h3>Risk assessment</h3>
<table class="form"><tr><td>Sources of information</td><td>OpenStreetMap road network; Transport Victoria traffic volumes and SCATS signal volumes; DTP traffic signal register; PTV GTFS timetable; City of Melbourne pedestrian counts; DTP road crash data (${crashYrs || 'not loaded'}); network and microsimulation model of the works. <span class="ph">[site inspection date]</span></td></tr>
<tr><td>Risk assessment has considered</td><td class="cbs">${riskItems.map(([on, t]) => cb(on, t)).join(' ')}</td></tr></table>
<h3>Key risks identified</h3>
<table><tr><th>ID</th><th>Hazard / issue</th><th>Detail</th><th>Proposed control</th><th>Likelihood</th><th>Consequence</th><th>Rating</th></tr>${riskRows || '<tr><td colspan="7">No issues identified by the checks.</td></tr>'}</table>

<h3>Specific controls required</h3>
<table class="form"><tr><td>Protection of workers</td><td>${cb(usesBarrier, 'Barriers')} ${cb(!usesBarrier, 'Delineation')} ${cb(false, 'Other')}<br>Minimum ${clearance} m between road safety barrier and traffic at ${clearanceSpeed} km/h (QGTTM Part 3 Table 5.1)${usesBarrier ? '' : '; cones used, confirm a barrier is not required (Code Cl. 17)'}.</td></tr>
<tr><td>Speed restriction required</td><td>${cb(tempSpeeds.length > 0, 'Yes')} ${cb(!tempSpeeds.length, 'No')}${tempSpeeds.length ? ` ${tempSpeeds.join(' / ')} km/h from the start of the taper to END ROADWORK; Memorandum of Authorisation required (1.6).` : ' Road closed to traffic within the work zone.'}</td></tr>
<tr><td>End of queue management</td><td>${q0 ? `Calculated end-of-queue length ${fmt(q0.lengthM)} m on ${esc(q0.name)} by the end of the analysis hour (V/C ${q0.vc.toFixed(2)}).` : 'No new queue over capacity in the analysis hour.'} Control: advance warning signs at 2D and ${r.plan.vmsPlaced ? `${r.plan.vmsPlaced} VMS board(s)` : 'VMS where available'} upstream of the queue${q0 && q0.lengthM > 2 * signSpacingD(maxSpeed) ? '; the queue reaches beyond the first advance sign, extend advance warning upstream of the queue end' : ''}. <span class="ph">[sight distance to the queue end]</span></td></tr>
<tr><td>Delineation of site</td><td>Signs, cones and barriers as the device schedule (3.2) and traffic guidance scheme (3.1): sign spacing D from QGTTM Part 3 Table 2.2; tapers and cone spacing from TMR TN195. Class 1 retroreflective signs and devices; no contradictory permanent signs. <span class="ph">[confirm on site]</span></td></tr>
<tr><td>Emergency service access and notification</td><td>${r.plan.detours.length ? 'Emergency vehicles use the signed detour or are escorted through the site by traffic controllers. ' : ''}<span class="ph">[emergency access strategy; services contacted (Ambulance Victoria, Fire Rescue Victoria, Victoria Police)]</span></td></tr></table>

<h3>Relevant documentation</h3>
<table class="form"><tr><td>Mandatory documents</td><td class="cbs">${cb(true, 'All traffic guidance schemes (3.1)')} ${cb(false, 'Consent to work in the road reserve (Victorian equivalent of a road occupancy licence, Part B)')} ${cb(false, 'Plans showing access to local properties or side roads')} ${cb(false, 'WHS documentation')} ${cb(false, 'Approved list of TTM personnel and contacts')} ${cb(false, 'Vehicle movement plans')} ${cb(false, 'Traffic incident plans')}<br><b>The plan cannot be approved until every mandatory document is attached.</b></td></tr>
<tr><td>Other documents</td><td class="cbs">${cb(false, 'Traffic staging plans')} ${cb(needMoa, `Memorandum of Authorisation (VMS / speed signs)${needMoa ? ', to apply' : ''}`)} ${cb(false, 'Design drawings')} ${cb(false, 'Council permits')} ${cb(r.ped.affected, 'Pedestrian and cyclist movement plans')} ${cb(users.pt, `Consultation with public transport operator${users.pt ? ', notice required (section 2)' : ''}`)} ${cb(true, 'Traffic Impact Assessment')}</td></tr></table>

<h3>Monitoring activities</h3>
<table class="form"><tr><th colspan="4">Person responsible for monitoring daily TTM work activities</th></tr>
<tr><td>Name</td><td class="ph">[Name]</td><td>Role</td><td class="ph">[Role]</td></tr>
<tr><td>Qualification</td><td class="ph">[Qualification]</td><td>Card number</td><td class="ph">[Card no.]</td></tr>
<tr><th colspan="4">Person responsible for TTM works</th></tr>
<tr><td>Name</td><td>${ph(app.contact, 'Name')}</td><td>Role</td><td class="ph">[Role]</td></tr>
<tr><td>Qualification</td><td class="ph">[Qualification]</td><td>Card number</td><td class="ph">[Card no.]</td></tr></table>

<h3>Review activities</h3>
<table><tr><th>Activity</th><th>Required</th><th>Frequency or details</th></tr>
<tr><td>Shift inspections</td><td>${cb(true, 'Yes')}</td><td>Before works start and at each shift change</td></tr>
<tr><td>Weekly inspections</td><td>${cb(longWorks, 'Yes')} ${cb(!longWorks, 'No')}</td><td>${longWorks ? 'Works run longer than a week' : 'Works shorter than a week'}</td></tr>
<tr><td>TMP review</td><td>${cb(true, 'Yes')}</td><td>Before works, and whenever the arrangement, stage or time window changes</td></tr>
<tr><td>Road safety audit</td><td>${cb(false, 'Yes')} ${cb(false, 'No')}</td><td class="ph">[as required by the road authority]</td></tr></table>

<h3>Endorsement and approval</h3>
<table class="form"><tr><th colspan="4">Endorsed by (when a principal contractor undertakes the work)</th></tr>
<tr><td>Name</td><td></td><td>Role / organisation</td><td></td></tr>
<tr><td>Signature</td><td></td><td>Date</td><td></td></tr>
<tr><th colspan="4">Approval: I have reviewed the relevant documents for the works and approve works to be completed in accordance with the TTM plan.</th></tr>
<tr><td>Name</td><td></td><td>Qualification / card number</td><td></td></tr>
<tr><td>Signature</td><td></td><td>Date</td><td></td></tr></table>
`;
  const impact = impactRating(net, closures, r, appr);
  const tmpBody = `<h2>Contents</h2>
<table class="toc">
<tr><td>Compliance index: council format guide and prescribed content</td></tr>
<tr><td>1. Works description</td></tr>
<tr><td>2. Stakeholder engagement</td></tr>
<tr><td>3. Traffic guidance scheme</td></tr>
<tr><td>4. Risk assessment and controls (TCAWS TMP-01 checklist)</td></tr>
<tr><td>5. Traffic control equipment</td></tr>
<tr><td>6. Site copy and declaration</td></tr>
</table>

<h2>Compliance index</h2>
<h3>Council TMP format guide</h3>
<div class="legal">${esc(COM_SRC.format)}${r.council && !r.council.isCoM ? `. The site is in ${esc(r.council.name)}; the City of Melbourne guide is used as the format.` : ''}</div>
<table><tr><th style="width:24%">Section</th><th>Content required</th><th style="width:10%">Where</th></tr>
<tr><td rowspan="6">1. Works description</td><td>Contact details</td><td>1.1</td></tr>
<tr><td>Site location plan</td><td>1.2</td></tr>
<tr><td>Dates and times of work</td><td>1.3</td></tr>
<tr><td>Frequency and duration of roadway or footpath closures</td><td>1.3</td></tr>
<tr><td>Detour routes and route impacts for all road users</td><td>1.4</td></tr>
<tr><td>Routes, volumes and timing of heavy vehicle movements</td><td>1.5</td></tr>
<tr><td rowspan="2">2. Stakeholder engagement</td><td>Copies of required third party agency approvals</td><td>2.1</td></tr>
<tr><td>Details of consultation and notification undertaken</td><td>2.2</td></tr>
<tr><td rowspan="7">3. Traffic guidance scheme</td><td>Scale diagrams with dimensions and labelled streets: changes to traffic conditions; closed footpath or roadway areas (why, and how extent and duration are minimised)</td><td>3.1, 2.3</td></tr>
<tr><td>Proposed redirections or detours</td><td>3.1</td></tr>
<tr><td>Clear widths for pedestrians, cyclists and vehicles adjacent to any closure</td><td>3.3</td></tr>
<tr><td>Extent of movement and operation of heavy vehicles or mobile plant</td><td>3.4</td></tr>
<tr><td>Placement of works advisory and traffic control devices and traffic controllers</td><td>3.1, 3.2</td></tr>
<tr><td>After hours arrangements</td><td>3.5</td></tr>
<tr><td>Prepared by a suitably qualified professional</td><td>Cover, 6.2</td></tr>
</table>
<h3>Prescribed content of a traffic management plan (Vic)</h3>
<div class="legal">Code Cl. 15(1): “The prescribed requirements for a traffic management plan are in regulation 35 of the Road Safety (Traffic Management) Regulations 2019.”</div>
<table><tr><th style="width:18%">Provision</th><th>Requirement</th><th style="width:8%">Section</th><th style="width:26%">Status</th></tr>
${req.map(x => `<tr><td>${x[0]}</td><td>${x[1]}</td><td>${x[2]}</td><td>${/Applicant|applicant|designer|Works manager|Declaration/.test(x[3]) ? `<span class="ph">${x[3]}</span>` : x[3]}</td></tr>`).join('')}</table>



<div class="part">1. Works description</div>
<h2>1.1 Contact details</h2>
<table class="form"><tr><td>Applicant / works manager</td><td>${ph(app.applicant, 'Applicant organisation')}</td></tr>
<tr><td>Site contact</td><td>${ph(app.contact, 'Name, phone, email')}</td></tr>
<tr><td>TMP prepared by</td><td>${ph(app.preparer, 'Name and traffic management qualification')}</td></tr>
<tr><td>Coordinating road authority</td><td>${esc(appr.authority)}</td></tr>
<tr><td>Council</td><td>${r.council ? esc(r.council.name) : '<span class="ph">[council]</span>'}</td></tr></table>

<h2>1.2 Site location plan</h2>
<div class="legal">Reg. 35 / Code Cl. 15(3)(b)</div>
${siteTable}


${ctx.aerial ? `<img src="${ctx.aerial}" alt="Aerial view of the work zone" style="width:100%;max-width:640px;border:1px solid #cbd5e1;margin:4px 0">
<p class="muted">Aerial imagery © Esri World Imagery. Work zone location as drawn on the traffic guidance scheme (3.1).</p>` : ''}

<h2>1.3 Dates, times, frequency and duration of closures</h2>
<div class="legal">Reg. 35 / Code Cl. 15(3)(a)</div>
<p><b>Activity:</b> ${ph(app.works, 'Describe the works (e.g. tram track renewal, service pit, crane lift)')}.<br>
<b>Duration:</b> ${fmt(c.dur)} hours of road occupation, starting ${app.start ? date(app.start) : ph('', 'start date')}; working hours ${ph(app.hours, 'working hours')}. Assessed for the ${esc(per.label.toLowerCase())}.</p>
${closureTable}


<h2>1.4 Detour routes and route impacts for all road users</h2>
<div class="legal">Reg. 35 / Code Cl. 15(3)(f)</div>
<h3>Public transport</h3>
${ptHtml}
<h3>Vehicles</h3>
<p>${r.plan.detours.length ? `Signed detour${r.plan.detours.length > 1 ? 's' : ''}: ${r.plan.detours.map(d => `${d.dir === 'ab' ? 'A→B' : 'B→A'} ${fmt(d.len)} m`).join('; ')} (drawing A8). ` : ''}${fmt(r.rerouted)} veh/h expected to change route; ${fmt(r.lateFlow)} veh/h divert late at the closure. ${Math.round(r.informed * 100)}% of drivers expected to be informed in advance. Local access: ${r.kpi.unserved > 1 ? `${fmt(r.kpi.unserved)} veh/h need access inside the work zone, ` : ''}<span class="ph">[describe access for residents, businesses and emergency vehicles]</span>.</p>
<h3>Pedestrians</h3>
${pedHtml}
<h3>Cyclists</h3>
<p class="ph">[Describe cyclist provision (e.g. merge with traffic, shared path, dismount signage)]</p>
<h3>Persons with disabilities</h3>
<p>${r.ped.affected ? `The alternative pedestrian route adds up to ${fmt(r.ped.maxDetour)} m. ` : ''}<span class="ph">[Describe the accessible route: continuous surface, kerb ramps, minimum width, tactile/audible provision at crossings, access to affected stops]</span></p>


<h2>1.5 Heavy vehicle movements</h2>
<p>Through traffic: ${fmt(hvPct * 100, 1)}% heavy vehicles on the section (Transport Victoria). ${r.plan.detours.length ? 'The signed detour must suit heavy vehicle turning paths.' : ''}</p>
<p class="ph">[Construction vehicles: routes, volumes and timing (by place, time and type of vehicle)]</p>

<h2>1.6 Speed limit</h2>
<div class="legal">Reg. 35 / Code Cl. 15(3)(e)</div>
<p>${tempSpeeds.length ? `Posted limit ${esc(speeds)} km/h, reduced to <b>${tempSpeeds.join(' / ')} km/h</b> through the work zone, from the start of the taper to the END ROADWORK sign. Temporary works speed-limit signs are no lower than 40 km/h and need a Memorandum of Authorisation (${esc(REFS.moa)}).` : 'None, the road is closed to traffic within the work zone.'}</p>


<div class="part">2. Stakeholder engagement</div>
<h2>2.1 Approvals and notices</h2>
<table><tr><th>Requirement</th><th>From / by</th><th>Lead time</th><th>Latest date${app.start ? '' : ' (enter a start date)'}</th><th>Basis</th></tr>
${appr.list.map(a => `<tr><td>${esc(a.item)}</td><td>${esc(a.who)}</td><td>${esc(a.lead)}</td><td>${a.by ? date(a.by) : '–'}</td><td class="muted">${esc(a.basis)}</td></tr>`).join('')}</table>
<p class="muted">Business days exclude weekends only; check public holidays.</p>


<h2>2.2 Consultation and notification undertaken</h2>
<p class="ph">[Attach copies of third party approvals, the notification letter, the distribution area and the consultation record]</p>

<h2>2.3 Impact of the closure and how it is minimised</h2>
<div class="legal">${esc(COM_SRC.consider)}</div>
<table><tr><th style="width:20%">Consideration</th><th style="width:10%">Impact</th><th>Finding</th></tr>
${impact.map(x => `<tr><td>${esc(x.topic)}</td><td><b class="${{ High: 'bad', Medium: 'warn', Low: 'ok', Check: 'act' }[x.level]}">${x.level}</b></td><td>${esc(x.finding)}</td></tr>`).join('')}</table>
<p>${options?.best ? `Of ${options.rows.length} options assessed, the lowest-impact option that passes every check is <b>${esc(options.best.treatment.label)}, ${esc(PERIODS[options.best.period].label)}</b> (Traffic Impact Assessment section 6).` : 'Options to minimise the extent and duration of the closure are assessed in the Traffic Impact Assessment.'}</p>

<div class="part">3. Traffic guidance scheme</div>
<h2 class="pb">3.1 Traffic guidance scheme drawings</h2>
<div class="legal">Reg. 35 / Code Cl. 15(2): a diagram or dimensioned drawing of the specific place where the activity is to be conducted.</div>
${(() => { const sc = { net, closures, plan: r.plan, app, appr, aerial: ctx.aerial, meta: ctx.meta, CLOSURE_TYPES, notes: tgsNotes(net, closures, r) };
  const n = r.plan.detours.length ? 2 : 1;
  return tgsSheet({ ...sc, sheetNo: 1, sheetCount: n }, 'site') + (n > 1 ? `<div class="pb"></div>${tgsSheet({ ...sc, sheetNo: 2, sheetCount: n, notes: [] }, 'detour')}` : ''); })()}
<p class="muted">Numbered devices match the device schedule in A4; a dashed outline means the item is not in depot stock.</p>
<p class="muted">Drawn from OpenStreetMap geometry with a scale bar and north point. It is not a surveyed drawing; dimensions on site follow the device schedule and AGTTM spacing.</p>


<h2>3.2 Arrangement of traffic control devices</h2>
<div class="legal">Reg. 35 / Code Cl. 15(3)(d): for the duration of the activity, for each stage, and during both daytime and night-time where relevant.</div>
<table><tr><th>Stage</th><th>Arrangement</th><th>Period</th></tr>
<tr><td>Set-up</td><td class="ph">[Installation sequence, advance signs first, then taper and delineation]</td><td class="ph">[time]</td></tr>
<tr><td>Works (modelled)</td><td>${esc(closures.map(cl => `${CLOSURE_TYPES[cl.type]} on ${cl.street}`).join('; '))}, devices 1–${r.plan.markers.length} in the schedule and drawing (3.1)</td><td>${esc(per.label)}</td></tr>
<tr><td>${night ? 'Daytime' : 'Night-time'} (if the works span it)</td><td class="ph">[Confirm whether the same arrangement applies; ${night ? 'daytime demand is higher, re-run the tool for a day window' : 'night-time visibility of devices and illumination'}]</td><td class="ph">[time]</td></tr>
<tr><td>Removal</td><td class="ph">[Removal sequence, reverse order of installation]</td><td class="ph">[time]</td></tr></table>
<h3>Device schedule</h3>
<table><tr><th class="n">#</th><th>Device</th><th>Message / placement</th><th>Latitude, longitude</th><th>Stock</th></tr>${deviceRows}</table>
<p class="muted">Sign spacing D, taper lengths and cone spacing: QGTTM Part 3 Table 2.2 and TMR TN195 (AGTTM Part 3, adopted by Code Cl. 5). VMS boards and roadworks speed-limit signs need a Memorandum of Authorisation (${esc(REFS.moa)}).</p>


<h2>3.3 Clear widths for pedestrians, cyclists and vehicles</h2>
<table><tr><th>Street</th><th>Footpath clear width required</th><th>Open carriageway per direction</th><th>Cyclists</th></tr>
${closures.map(cl => { const [la, lo] = net.proj.inv(cl.poly[0][0], cl.poly[0][1]); const w = footpathWidth(cl.street, la, lo, r.council?.isCoM);
  const open = cl.type === 'full' || cl.type === 'direction' ? null : cl.type === 'shuttle' ? 3.5 : Math.max(1, Math.min(...[...cl.abEdges, ...cl.baEdges].filter(e => e >= 0).map(e => g.lanes[e])) - cl.lanesClosed) * 3.5;
  return `<tr><td>${esc(cl.street)}</td><td>${w.m.toFixed(1)} m (${esc(w.why)})${cl.footpath !== 'open' ? '; <b class="warn">footpath closed, bypass of this width required</b>' : ''}</td><td>${open == null ? 'Closed to traffic' : `about ${open.toFixed(1)} m`}</td><td>${open == null ? 'Route past or around the site' : open >= 4 ? '4.0 m shared lane available' : '<b class="warn">below the 4.0 m shared lane</b>'}</td></tr>`; }).join('')}</table>
<p class="muted">${esc(COM_SRC.cond('17 and 22–24'))}${r.council && !r.council.isCoM ? ', used as a guide' : ''}. Lane widths assume 3.5 m per lane; <span class="ph">[confirm measured widths on site]</span>.</p>

<h2>3.4 Heavy vehicles and mobile plant</h2>
<p class="ph">[Extent of movement and operation of heavy vehicles or mobile plant; no pedestrians under a crane during lifting (condition 21)]</p>

<h2>3.5 After hours arrangements</h2>
<p>${c.dur > 12 ? 'The closure continues outside working hours: warning lights, retroreflective signs and devices stay in place (condition 32), and the site is inspected at each shift.' : 'The road is reopened at the end of each shift.'} <span class="ph">[after hours arrangement when work is not being conducted]</span></p>

<div class="part">4. Risk assessment and controls</div>
${tcaws}
<h2>4.2 Technical and council checks</h2>

<table><tr><th style="width:15%">Check</th><th style="width:8%">Result</th><th style="width:27%">Finding</th><th>Recommendation</th><th style="width:18%">Basis</th></tr>
${checks.map(x => `<tr><td>${esc(x.topic)}</td><td>${status(x.status)}</td><td>${esc(x.finding)}</td><td>${esc(x.rec || '')}</td><td class="muted">${esc(x.basis)}</td></tr>`).join('')}</table>


<h2>4.3 Other measures to control identified risks</h2>
<div class="legal">Reg. 35 / Code Cl. 15(3)(g)</div>
<ul>
${r.plan.vmsPlaced ? `<li>${r.plan.vmsPlaced} VMS board(s) on the main approaches carrying traffic bound for the work zone (devices in A4).</li>` : ''}
${r.plan.notes.filter(n => !/^Shortfall/.test(n)).map(n => `<li>${esc(n)}</li>`).join('')}
${r.meta?.prenotify ? '<li>Advance notice: closure published to VicTraffic / navigation data providers, and letters to affected residents and businesses (section 2).</li>' : '<li>Letters to affected residents and businesses (section 2).</li>'}
<li>${r.amenity.hotspots ? `${r.amenity.hotspots} local street(s) more than double their traffic, monitor and consider local traffic management.` : 'No local street more than doubles its traffic.'}</li>
<li class="ph">[Site-specific controls: plant movements, worker access, lighting, spotters, incident response]</li>
</ul>


<h2>4.4 Matters considered</h2>
<div class="legal">Code Cl. 15(4): the details above apply so far as reasonably practicable, having regard to the following.</div>
<table><tr><th style="width:32%">Matter</th><th>How it was considered</th></tr>
<tr><td>Nature of the activity</td><td>${ph(app.works, 'Description of works')}; ${esc(closures.map(cl => CLOSURE_TYPES[cl.type].toLowerCase()).join(', '))}</td></tr>
<tr><td>Type of road</td><td>${appr.arterial ? 'Declared arterial road' : 'Local road'}, ${esc(lanesTxt)} lanes per direction</td></tr>
<tr><td>Speed limit</td><td>${esc(speeds)} km/h posted${tempSpeeds.length ? `; ${tempSpeeds.join(' / ')} km/h through the work zone` : ''}</td></tr>
<tr><td>Identified delays to traffic</td><td>+${fmt(Math.max(0, r.kpi.dVHT))} vehicle-hours per hour across the study area; +${fmt(Math.max(0, r.kpi.extraMinPerAffected), 1)} min per vehicle that used the work zone; ${r.queues[0] ? `longest new queue ${fmt(r.queues[0].lengthM)} m on ${esc(r.queues[0].name)}` : 'no new queue over capacity'} (Traffic Impact Assessment)</td></tr>
<tr><td>Clearance between traffic and workers</td><td>Minimum ${clearance} m between a road safety barrier and the nearest traffic lane at ${clearanceSpeed} km/h (QGTTM Part 3 Table 5.1)${closures.some(cl => cl.delineation === 'barrier') ? '' : '; the plan uses cones, confirm a barrier is not required (Code Cl. 17)'}. <span class="ph">[Confirm the lateral clearance available on site]</span></td></tr>
</table>


<div class="part">5. Traffic control equipment</div>
<h2>5.1 Equipment required and available</h2>
<table><tr><th>Item</th><th class="n">Required</th><th class="n">In depot</th><th class="n">Shortfall</th></tr>${itemRows}</table>
${dataLine}

<div class="part">6. Site copy and declaration</div>
<h2>6.1 Availability on site</h2>
<div class="legal">Code Cl. 15(5): a copy of the traffic management plan must be kept at the location or worksite at all times when workers are present and be available for inspection.</div>
<p class="ph">[Works manager: confirm the copy location on site]</p>


<h2>6.2 Duties under the Road Safety Act 1986 s99A</h2>
<div class="legal">Code Cl. 11(4): to comply with the duty under s99A(2) a person must have in operation a traffic management plan; give appropriate warnings to road users; engage appropriately trained and qualified persons to carry out the works or direct traffic; and give appropriate directions to the persons engaged in carrying out the works.</div>
<p>The undersigned confirm that this plan has been reviewed and completed, that the persons carrying out the works and directing traffic are appropriately trained and qualified, and that a copy will be kept on site while workers are present.</p>
<div class="sig"><div>Traffic management designer, name, qualification / accreditation, signature, date</div><div>Works manager, name, organisation, signature, date</div></div>
`;
  const hierarchy = (() => { const m = new Map(); for (const L of g.links) { if (L.rank > 5 || /^(Collector|Primary arterial|Secondary arterial|Highway|Freeway|Local road|Local street)$/.test(L.name) || /link$/i.test(L.name)) continue;
    const h = m.get(L.name); if (!h || L.rank < h.rank) m.set(L.name, { name: L.name, rank: L.rank, label: ROAD_CLASS[L.cls]?.label || L.cls, lanes: Math.max(L.lanesF || 0, L.lanesB || 0) || '–', speed: Math.round(L.speed) }); }
    return [...m.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, 12); })();
  const intRows = r.micro?.base?.intersections ? (() => { const bi = new Map(r.micro.base.intersections.map(x => [x.key, x]));
    return r.micro.scen.intersections.map(s => ({ s, b: bi.get(s.key) })).filter(x => x.b && x.b.flow + x.s.flow > 0)
      .sort((a, b) => (b.s.delay - b.b.delay) - (a.s.delay - a.b.delay)).slice(0, 10); })() : [];
  const tgsPages = (() => { const sc = { net, closures, plan: r.plan, app, appr, aerial: ctx.aerial, meta: ctx.meta, CLOSURE_TYPES, notes: tgsNotes(net, closures, r) };
    const n = r.plan.detours.length ? 2 : 1;
    return tgsSheet({ ...sc, sheetNo: 1, sheetCount: n }, 'site') + (n > 1 ? `<div class="pb"></div>${tgsSheet({ ...sc, sheetNo: 2, sheetCount: n, notes: [] }, 'detour')}` : ''); })();
  const tiaBody = `<h2>Contents</h2>
<table class="toc">
<tr><td>Executive summary</td></tr>
<tr><td>1. Introduction</td></tr><tr><td>2. Locality</td></tr><tr><td>3. Staging</td></tr><tr><td>4. Road use</td></tr><tr><td>5. Impact</td></tr>
<tr><td>6. Mitigation</td></tr><tr><td>7. Implementation</td></tr><tr><td>8. Emergencies</td></tr><tr><td>9. Communication</td></tr><tr><td>10. Appendices</td></tr>
</table>
<div class="legal">Structure: ${esc(COM_SRC.ctia)}${r.council && !r.council.isCoM ? `. The site is in ${esc(r.council.name)}; the City of Melbourne guide is used as the format` : ''}. Supports the coordinating road authority's consideration under ${esc(REFS.rma14)}.</div>

<h2>Executive summary</h2>
<table>
<tr><th style="width:42%">Item</th><th>Finding</th></tr>
<tr><td>Proposed arrangement</td><td>${esc(closures.map(cl => `${CLOSURE_TYPES[cl.type]} on ${cl.street} (${fmt(cl.length)} m)`).join('; '))}</td></tr>
<tr><td>Assessment period</td><td>${esc(per.label)}; ${fmt(c.dur)} hours of occupation</td></tr>
<tr><td>Technical checks</td><td>${nFail ? `<span class="bad">${nFail} not met</span>` : '<span class="ok">All met</span>'}${nWarn ? `; ${nWarn} to confirm on site` : ''} (section 6; TMP section 4)</td></tr>
<tr><td>Network delay</td><td>+${fmt(Math.max(0, r.kpi.dVHT))} vehicle-hours per hour; +${fmt(Math.max(0, r.kpi.extraMinPerAffected), 1)} min per vehicle using the work zone</td></tr>
<tr><td>Longest new queue</td><td>${r.queues[0] ? `${fmt(r.queues[0].lengthM)} m on ${esc(r.queues[0].name)}` : 'None'}</td></tr>
<tr><td>Public transport</td><td>${trams.filter(t => /interrupted/.test(t.status)).length ? `Tram ${trams.filter(t => /interrupted/.test(t.status)).map(t => esc(t.ref)).join(', ')} interrupted` : 'No tram interruption'}; ${buses.length} bus route(s) affected</td></tr>
<tr><td>Pedestrians</td><td>${r.ped.affected ? `${fmt(r.ped.closedLen)} m of footpath closed; average detour ${fmt(r.ped.avgDetour)} m` : 'Footpaths remain open'}</td></tr>
<tr><td>Economic cost over the works</td><td>${money(c.sum)} (June 2024 AUD)</td></tr>
${options?.best ? `<tr><td>Preferred option</td><td>${esc(options.best.treatment.label)}, ${esc(PERIODS[options.best.period].label)} (section 6)</td></tr>` : ''}
</table>


<h2>1. Introduction</h2>
<p><b>Project:</b> ${ph(app.works, 'Describe the works')}. <b>Applicant:</b> ${ph(app.applicant, 'Applicant')}. <b>Occupation:</b> ${fmt(c.dur)} hours from ${app.start ? date(app.start) : ph('', 'start date')}; working hours ${ph(app.hours, 'working hours')}. Assessed for the ${esc(per.label.toLowerCase())}.</p>
${closureTable}

<h2>2. Locality</h2>
<p>${esc(ctx.siteName)}${r.council ? `, ${esc(r.council.name)}` : ''}${r.council?.cbd ? ' (Central Business District)' : ''}. Coordinating road authority: ${esc(appr.authority)}.</p>
<h3>Road use hierarchy</h3>
<table><tr><th>Road</th><th>Class</th><th class="n">Lanes per direction</th><th class="n">Speed limit</th></tr>
${hierarchy.map(h => `<tr><td>${esc(h.name)}</td><td>${esc(h.label)}</td><td class="n">${h.lanes}</td><td class="n">${h.speed} km/h</td></tr>`).join('')}</table>
<h3>Safety, amenity and access</h3>
<ul>
<li>Safety: ${sf ? `${sf.area.n} injury crashes in the study area (${crashYrs}), ${sf.area.ksi} fatal or serious, ${sf.area.ped} involving pedestrians and ${sf.area.cyc} cyclists; ${sf.site.n} on the work zone section (section 5.6).` : 'crash data not loaded.'}</li>
<li>Amenity: ${r.amenity.streets.length ? `${r.amenity.streets.length} local street(s) take diverted traffic${r.amenity.hotspots ? `, ${r.amenity.hotspots} more than doubling` : ''} (section 5.3).` : 'no local street takes a material share of the diverted traffic.'}</li>
<li>Access: ${r.kpi.unserved > 1 ? `${fmt(r.kpi.unserved)} veh/h need access to properties inside the closure.` : 'access to properties is maintained by the arrangement.'} ${trams.length + buses.length ? `Public transport: ${[...trams.map(t => `tram ${esc(t.ref)}`), ...buses.map(b => `bus ${esc(b.ref)}`)].join(', ')}.` : ''}</li>
<li class="ph">[Key stakeholders in the area: schools, hospitals, venues, loading zones]</li>
</ul>
${ctx.aerial ? `<img src="${ctx.aerial}" alt="Locality" style="width:100%;max-width:640px;border:1px solid #cbd5e1;margin:4px 0"><p class="muted">Locality: aerial imagery © Esri World Imagery.</p>` : ''}
<p class="ph">[Photographs of key elements of the location]</p>

<h2>3. Staging</h2>
<table><tr><th>Stage</th><th>Description</th><th>Timing</th></tr>
<tr><td>Set-up</td><td>Advance signs first, then taper and delineation (TMP 3.2)</td><td class="ph">[time]</td></tr>
<tr><td>Works</td><td>${esc(closures.map(cl => `${CLOSURE_TYPES[cl.type]} on ${cl.street}`).join('; '))}</td><td>${app.start ? date(app.start) : ph('', 'start date')}, ${fmt(c.dur)} hours, ${esc(per.label)}</td></tr>
<tr><td>Removal</td><td>Reverse order of installation</td><td class="ph">[time]</td></tr></table>
<p class="ph">[Project timeline; heavy vehicle movement volumes by place, time and type of vehicle]</p>

<h2>4. Road use</h2>
<h3>Existing conditions at the site</h3>
${siteTable}
<h3>Existing network (analysis hour, without works)</h3>
<table><tr><th>Measure</th><th class="n">Value</th></tr>
<tr><td>Vehicle-hours travelled in the study area</td><td class="n">${fmt(base.summary.vht)}</td></tr>
<tr><td>Vehicle-km travelled</td><td class="n">${fmt(base.summary.vkt)}</td></tr>
<tr><td>Average network speed</td><td class="n">${fmt(base.summary.avgSpeed, 1)} km/h</td></tr>
<tr><td>Transport Victoria count sites used for calibration</td><td class="n">${base.calib ? `${base.calib.n} (${Math.round(base.calib.gehOk * 100)}% within GEH 5)` : '–'}</td></tr></table>

<h2>5. Impact</h2>
<h3>5.1 Traffic network</h3>
<div class="legal">Supports the coordinating road authority's consideration under ${esc(REFS.rma14)}.</div>
<table><tr><th>Measure (analysis hour)</th><th class="n">Without works</th><th class="n">With works</th><th class="n">Change</th></tr>
<tr><td>Vehicle-hours travelled</td><td class="n">${fmt(base.summary.vht)}</td><td class="n">${fmt(r.summary.vht)}</td><td class="n">${fmt(r.kpi.dVHT)}</td></tr>
<tr><td>Vehicle-km travelled</td><td class="n">${fmt(base.summary.vkt)}</td><td class="n">${fmt(r.summary.vkt)}</td><td class="n">${fmt(r.kpi.dVKT)}</td></tr>
<tr><td>Average trip time (min)</td><td class="n">${fmt(base.summary.avgTripMin, 1)}</td><td class="n">${fmt(r.summary.avgTripMin, 1)}</td><td class="n">${fmt(r.kpi.dTripMin, 1)}</td></tr></table>
${r.micro ? `<h3>Microsimulation of every vehicle (baseline vs work zone)</h3>
<table><tr><th>Measure (measured hour)</th><th class="n">Without works</th><th class="n">With works</th><th class="n">Change</th></tr>
<tr><td>Mean travel time (min)</td><td class="n">${fmt(r.micro.base.meanTT, 1)}</td><td class="n">${fmt(r.micro.scen.meanTT, 1)}</td><td class="n">${fmt(r.micro.scen.meanTT - r.micro.base.meanTT, 1)}</td></tr>
<tr><td>Total delay (veh-h)</td><td class="n">${fmt(r.micro.base.delayVh)}</td><td class="n">${fmt(r.micro.scen.delayVh)}</td><td class="n">${fmt(r.micro.scen.delayVh - r.micro.base.delayVh)}</td></tr>
<tr><td>Time stopped (veh-h)</td><td class="n">${fmt(r.micro.base.stoppedHours)}</td><td class="n">${fmt(r.micro.scen.stoppedHours)}</td><td class="n">${fmt(r.micro.scen.stoppedHours - r.micro.base.stoppedHours)}</td></tr>
<tr><td>Trips completed within the hour</td><td class="n">${fmt(r.micro.base.served * 100)}%</td><td class="n">${fmt(r.micro.scen.served * 100)}%</td><td class="n">${fmt((r.micro.scen.served - r.micro.base.served) * 100)} pts</td></tr>
<tr><td>Vehicles re-routed at the closure</td><td class="n">-</td><td class="n">${fmt(r.micro.scen.rerouted)}</td><td></td></tr></table>
<p class="muted">Each vehicle simulated individually (car-following, lane changing, signals and give-way).${r.micro.validation ? ` Simulated baseline flows are ${fmt(r.micro.validation.ratio * 100)}% of Transport Victoria counts; the change between runs is the more reliable result.` : ''}</p>` : ''}

<h3>5.2 Intersection performance</h3>
${intRows.length ? `<table><tr><th rowspan="2">Signalised intersection</th><th colspan="4" class="n">Without works</th><th colspan="4" class="n">With works</th></tr>
<tr><th class="n">DoS</th><th class="n">Delay (s)</th><th class="n">LOS</th><th class="n">Queue (m)</th><th class="n">DoS</th><th class="n">Delay (s)</th><th class="n">LOS</th><th class="n">Queue (m)</th></tr>
${intRows.map(({ b, s }) => `<tr><td>${s.siteNo != null ? `Site ${s.siteNo}: ` : ''}${esc(s.name)}</td><td class="n">${b.dos.toFixed(2)}</td><td class="n">${fmt(b.delay)}</td><td class="n">${levelOfService(b.delay, b.dos)}</td><td class="n">${fmt(b.queue)}</td><td class="n">${s.dos.toFixed(2)}</td><td class="n">${fmt(s.delay)}</td><td class="n"><b>${levelOfService(s.delay, s.dos)}</b></td><td class="n">${fmt(s.queue)}</td></tr>`).join('')}</table>
<p class="muted">Microsimulation, measured hour. DoS: highest approach demand (assigned flow, scaled to the SCATS site volume) ÷ capacity (1,900 veh/h × lanes × green ÷ cycle). Delay: average time lost per vehicle on the approaches. LOS: HCM 6th ed. Exhibit 19-8. Queue: longest stopped queue on an approach. Signal timings are modelled (two-phase Webster plans), not the operating SCATS timings; ${r.micro.validation ? `the microsimulation carries ${fmt(r.micro.validation.ratio * 100)}% of counted flows, so the change between the two runs is more reliable than the absolute values.` : ''}</p>` : '<p>No signalised intersection in the study area.</p>'}
<h3>5.3 Streets carrying diverted traffic</h3>
<table><tr><th>Street</th><th class="n">Before (veh/h)</th><th class="n">After (veh/h)</th><th class="n">Peak V/C after</th></tr>
${r.increased.slice(0, 8).map(s => `<tr><td>${esc(s.name)}</td><td class="n">${fmt(s.base)}</td><td class="n">${fmt(s.scen)}</td><td class="n">${s.vc.toFixed(2)}</td></tr>`).join('')}</table>
${r.queues.length ? `<h3>New queues (end of analysis hour)</h3><table><tr><th>Approach</th><th class="n">Queue length</th><th class="n">V/C</th></tr>${r.queues.slice(0, 6).map(q => `<tr><td>${esc(q.name)}</td><td class="n">${fmt(q.lengthM)} m</td><td class="n">${q.vc.toFixed(2)}</td></tr>`).join('')}</table>` : ''}
${r.amenity.streets.length ? `<h3>Local streets</h3><p>${r.amenity.streets.slice(0, 6).map(s => `${esc(s.name)} ${fmt(s.base)} → ${fmt(s.base + s.up)} veh/h`).join('; ')}.</p>` : ''}

<h3>5.4 Public transport</h3>
${ptHtml}
<h3>5.5 Pedestrians and cyclists</h3>
${pedHtml}
<p class="ph">[Cyclist volumes and bike lanes past the site]</p>
<h3>5.6 Road safety</h3>
${safetyHtml}
<h3>5.7 Impact rating</h3>
<div class="legal">${esc(COM_SRC.consider)}</div>
<table><tr><th style="width:20%">Consideration</th><th style="width:10%">Impact</th><th>Finding</th></tr>
${impact.map(x => `<tr><td>${esc(x.topic)}</td><td><b class="${{ High: 'bad', Medium: 'warn', Low: 'ok', Check: 'act' }[x.level]}">${x.level}</b></td><td>${esc(x.finding)}</td></tr>`).join('')}</table>
<p class="muted">${base.calib ? `Modelled flows calibrated to ${base.calib.n} Transport Victoria count sites (${Math.round(base.calib.gehOk * 100)}% within GEH 5).` : 'No traffic counts available for calibration.'}</p>

<h2>6. Mitigation</h2>
<h3>6.1 Options considered</h3>
${optionsHtml}
<h3>6.2 Mitigation measures</h3>
<ul>
${r.plan.detours.length ? `<li>Signed detour${r.plan.detours.length > 1 ? 's' : ''} (${r.plan.detours.map(d => `${fmt(d.len)} m`).join(', ')}), TMP 3.1.</li>` : ''}
${r.plan.vmsPlaced ? `<li>${r.plan.vmsPlaced} VMS board(s) on the approaches, warning drivers before they reach the closure.</li>` : ''}
${r.meta?.prenotify ? '<li>Closure published in advance to VicTraffic and navigation data providers.</li>' : '<li>Publish the closure in advance to VicTraffic and navigation data providers, so more drivers re-route before they reach the site.</li>'}
${trams.filter(t => t.replacementBuses).map(t => `<li>Tram ${esc(t.ref)}: ${t.replacementBuses} replacement buses between ${esc(t.replacementFrom)} and ${esc(t.replacementTo)}.</li>`).join('')}
</ul>
${checks.some(x => x.status === 'fail' || x.status === 'warn') ? `<h3>Matters to resolve before lodging</h3>
<table><tr><th style="width:22%">Check</th><th style="width:9%">Result</th><th>Recommendation</th></tr>
${checks.filter(x => x.status === 'fail' || x.status === 'warn').map(x => `<tr><td>${esc(x.topic)}</td><td>${status(x.status)}</td><td>${esc(x.rec || x.finding)}</td></tr>`).join('')}</table>` : ''}

<h2>7. Implementation</h2>
<table><tr><th>Activity</th><th>Frequency</th></tr>
<tr><td>Shift inspection of signs, devices and delineation</td><td>Before works start and at each shift change</td></tr>
<tr><td>Traffic controllers at each end of the worksite</td><td>At all times during working hours</td></tr>
<tr><td>Queue monitoring on ${r.queues[0] ? esc(r.queues[0].name) : 'the approaches'}; adjust advance warning if the queue passes the first sign</td><td>During peak periods</td></tr>
<tr><td>Weekly inspection</td><td>${c.dur > 168 ? 'Weekly' : 'Not required, works shorter than a week'}</td></tr>
<tr><td>TMP review</td><td>Whenever the arrangement, stage or time window changes</td></tr></table>
<p class="ph">[Maintenance of devices; responsible persons]</p>

<h2>8. Emergencies</h2>
<table><tr><th>Contact</th><th>Role</th></tr>
<tr><td>${ph(app.contact, 'Site contact, phone')}</td><td>Project contact</td></tr>
<tr><td>${esc(appr.authority)}</td><td>Coordinating road authority</td></tr>
${r.council ? `<tr><td>${esc(r.council.name)}</td><td>Council</td></tr>` : ''}
<tr><td>Victoria Police (State Event Planning Unit), Ambulance Victoria, Fire Rescue Victoria, DTP Traffic Management Centre</td><td>Emergency services, notified before works</td></tr></table>
<p>Emergency vehicles are never held at the site; ${r.plan.detours.length ? 'they use the signed detour or are escorted through the site by traffic controllers.' : 'traffic controllers give them priority through the site.'} <span class="ph">[incident procedure]</span></p>

<h2>9. Communication</h2>
<h3>Stakeholders</h3>
<ul>
<li>Residents and businesses on ${esc([...new Set([...closures.map(cl => cl.street), ...r.amenity.streets.slice(0, 5).map(st => st.name)])].join(', '))}</li>
${trams.length || buses.length ? `<li>Public transport: DTP${trams.length ? ', Yarra Trams' : ''}${buses.length ? ', bus operator(s)' : ''}</li>` : ''}
<li>Emergency services and the DTP Traffic Management Centre</li>
${r.council?.isCoM ? '<li>Events Melbourne and City of Melbourne Customer Relations</li>' : ''}
</ul>
<h3>Approvals and notices</h3>
<table><tr><th>Requirement</th><th>From / by</th><th>Lead time</th><th>Latest date</th></tr>
${appr.list.map(a => `<tr><td>${esc(a.item)}</td><td>${esc(a.who)}</td><td>${esc(a.lead)}</td><td>${a.by ? date(a.by) : '–'}</td></tr>`).join('')}</table>
<p class="ph">[Notification templates, communication records and meeting minutes]</p>

<h2 class="pb">10. Appendices</h2>
<h3>Appendix A: Traffic guidance schemes</h3>
${tgsPages}
<h3 class="pb">Appendix B: Supplementary economic comparison</h3>
<p class="muted">Not required by the council format guide. Used to compare options on one scale (section 6.1). Every hour of the occupation is assumed to carry the analysis-hour traffic; for works spanning several time periods, assess each period separately.</p>
<table><tr><th>Cost item (June 2024 AUD)</th><th class="n">Per hour</th><th class="n">Over the works</th></tr>${ecoRows}
<tr><th>Total</th><th class="n">${money(c.perHour)}</th><th class="n">${money(c.sum)}</th></tr></table>
<p>CO₂‑e ${fmt(c.co2t, 2)} t · fuel ${fmt(c.fuelL)} L · NOx ${fmt(c.noxKg, 2)} kg · PM2.5 ${fmt(c.pmKg, 3)} kg over the works.</p>



${dataLine}
<div class="sig"><div>Prepared by, name, qualification, signature, date</div><div>Reviewed by, name, signature, date</div></div>
`;
  return head + cover + (isTmp ? tmpBody : tiaBody) + '</body></html>';
}
