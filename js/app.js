// Work Zone Impact Simulator, UI controller.
import { fetchOSM, fetchTrafficVolumes, fetchPedestrianSensors, bboxAround } from './data.js';
import { buildNetwork, nearestLink, nearestNode, ROAD_CLASS, applySignalSites } from './network.js';
import { buildZones, matchCounts, modelLinkFlow, PERIODS } from './demand.js';
import { runBaseline, runScenario } from './sim.js';
import { INVENTORY, CLOSURE_TYPES, selectChain, makeClosure, applyScenario, selectLink, planEquipment } from './workzone.js';
import { normName, bearingXY, cumulativeLengths } from './geo.js';
import { Animator } from './anim.js';
import { economics } from './econ.js';
import { complianceChecks, approvals, exploreOptions } from './decision.js';
import { councilReport } from './report.js';
import { MODEL_NAME } from './model.js';
import { MicroSim } from './micro.js';
import { matchCrashes, yearsLabel } from './safety.js';
import { impactRating, BIZ_GROUP } from './council.js';
import { generateScenarios, assessPillars, PILLARS, scheduleHours, scheduleLabel, WINDOWS } from './scenarios.js';
import { loadRates, saveRates, resetRates, buildBOM, RATE_NOTE, RPM_LINKS } from './rates.js';
import { geh } from './demand.js';
import { PARAMETERS, SOURCES, VTT, INFO, levelOfService, WALK_SPEED } from './standards.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (v, d = 0) => v == null || !isFinite(v) ? '–' : v.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = v => { if (v == null || !isFinite(v)) return '–'; return (v < -0.5 ? '−A$' : 'A$') + Math.round(Math.abs(v)).toLocaleString('en-AU'); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- presets (Greater Melbourne)
const PRESETS = [
  { title: 'Collins St, Melbourne CBD', desc: 'Full closure between Swanston St and Elizabeth St for a crane lift; north footpath closed.',
    center: [-37.8158, 144.9651], radius: 1000, street: 'Collins Street', a: [-37.8153, 144.9666], b: [-37.8164, 144.9637],
    props: { type: 'full', footpath: 'left' }, period: 'OFF', duration: 10, tags: ['full', 'tram', 'CBD'] },
  { title: 'Sydney Rd, Brunswick', desc: 'Full closure Union St → Glenlyon Rd for tram track renewal (route 19).',
    center: [-37.7729, 144.9611], radius: 1200, street: 'Sydney Road', a: [-37.77424, 144.96092], b: [-37.77155, 144.96136],
    props: { type: 'full' }, period: 'AM', duration: 48, tags: ['full', 'tram'] },
  { title: 'Hoddle St, Collingwood', desc: 'Kerbside lane closure Victoria Pde → Johnston St for drainage works on a 6-lane arterial.',
    center: [-37.8048, 144.9921], radius: 1300, street: 'Hoddle Street', a: [-37.8096, 144.9912], b: [-37.7998, 144.9930],
    props: { type: 'lane', direction: 'both', lanesClosed: 1 }, period: 'PM', duration: 8, tags: ['lane', 'arterial'] },
  { title: 'Chapel St, Prahran', desc: 'Southbound lane closure Commercial Rd → High St for a service pit; busy shopping strip.',
    center: [-37.8485, 144.9935], radius: 1100, street: 'Chapel Street', a: [-37.8468, 144.9941], b: [-37.8505, 144.9933],
    props: { type: 'lane', direction: 'ab', footpath: 'right' }, period: 'OFF', duration: 6, tags: ['lane', 'tram'] },
  { title: 'Glenferrie Rd, Hawthorn', desc: 'Night full closure Burwood Rd → Riversdale Rd for resurfacing (tram 16).',
    center: [-37.8257, 145.0348], radius: 1200, street: 'Glenferrie Road', a: [-37.8226, 145.03535], b: [-37.82873, 145.03422],
    props: { type: 'full' }, period: 'NIGHT', duration: 16, tags: ['full', 'night', 'tram'] },
  { title: 'Whitehorse Rd, Box Hill', desc: 'Lane closure Elgar Rd → Station St for utility works beside the route 109 terminus.',
    center: [-37.8176, 145.1195], radius: 1300, street: 'Whitehorse Road', a: [-37.8169, 145.1150], b: [-37.81828, 145.12379],
    props: { type: 'lane', direction: 'both' }, period: 'AM', duration: 8, tags: ['lane', 'arterial'] },
];

// ---------------------------------------------------------------- state
const S = {
  net: null, zones: [], matches: [], sensors: [], site: null, siteName: '',
  closures: [], inventory: INVENTORY.map(i => ({ ...i })), baseCache: new Map(),
  result: null, plan: null, planSc: null, stale: false, saved: [], mode: null, pick: null, view: 'scen', netMode: 'class', busy: false,
  streetNodes: new Map(), fetchedAt: null,
  stage: 'input', scen: null, sel: null, rates: loadRates(), bomQty: {}, submitted: null, emergency: [], win: 'day',
};

// ---------------------------------------------------------------- map
const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([-37.8136, 144.9631], 11);
const bases = {
  'Light': L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 16, attribution: 'Basemap &copy; Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 16 }),
  ]),
  'Street': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri' }),
};
bases.Light.addTo(map);
L.control.layers(bases, null, { position: 'bottomright' }).addTo(map);
map.attributionControl.addAttribution('Traffic counts: Transport Victoria (CC BY 4.0) · Pedestrians: City of Melbourne');
map.createPane('closure'); map.getPane('closure').style.zIndex = 420;
map.createPane('equip'); map.getPane('equip').style.zIndex = 640;
const canvasR = L.canvas({ padding: 0.3, tolerance: 5 });
const zoomClass = () => { map.getContainer().classList.toggle('z-far', map.getZoom() < 17); try { for (const pl of linkLines) pl.setStyle({ opacity: map.getZoom() >= 16 && S.result ? 0.3 : 0.9 }); } catch { /* network not drawn yet */ } };
map.on('zoomend', zoomClass); zoomClass();

const layers = {
  study: L.layerGroup().addTo(map),
  network: L.layerGroup().addTo(map),
  pt: L.layerGroup().addTo(map),
  ped: L.layerGroup().addTo(map),
  counts: L.layerGroup(),
  zones: L.layerGroup(),
  signals: L.layerGroup(),
  crashes: L.layerGroup(),
  closures: L.layerGroup().addTo(map),
  equipment: L.layerGroup().addTo(map),
  pick: L.layerGroup().addTo(map),
};
let linkLines = [];
const anim = new Animator(map);
anim.onTick = () => { $('#clock').textContent = anim.clockLabel(); $('#dotScale').textContent = `${anim.vehicles} vehicles`; };

// ---------------------------------------------------------------- UI helpers
function toast(msg, err = false, ms = 4200) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms);
}
function overlay(title, sub = '', frac = null) {
  $('#overlay').classList.remove('hidden'); $('#ovTitle').textContent = title; $('#ovSub').textContent = sub;
  $('#ovBar').style.width = frac == null ? '0%' : Math.round(frac * 100) + '%';
}
function hideOverlay() { $('#overlay').classList.add('hidden'); }
function setSrc(key, text, cls) { const el = $(`.src[data-src="${key}"]`); if (!el) return; el.querySelector('b').textContent = text; el.className = 'src ' + (cls || ''); }
const STAGE_OF = { site: 'input', input: 'input', zone: 'reco', results: 'reco', compare: 'reco', reco: 'reco', equip: 'proc', proc: 'proc' };
function switchTab(name) {
  const st = STAGE_OF[name] || 'input';
  S.stage = st;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === st));
  $$('.pane').forEach(p => p.classList.toggle('active', p.dataset.stage === st));
  if (name === 'zone') $('#advanced').open = true;
  if (st === 'proc') renderProc();
  updateSteps(); updateRunbar();
}
// the run button does the next step of the current stage
function updateRunbar() {
  const b = $('#runBtn'); if (!b) return;
  const cfg = S.stage === 'input' ? ['▶ Generate scenarios', genScenarios, !(S.net && S.closures.length)]
    : S.stage === 'reco' ? ['▶ Re-run selected', runSimulation, !(S.net && S.closures.length && S.sel != null)]
    : ['▶ Recalibrate', recalibrate, !S.result];
  b.textContent = cfg[0]; S.runAction = cfg[1]; b.disabled = cfg[2];
  if ($('#genBtn')) $('#genBtn').disabled = !(S.net && S.closures.length);
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
// stepper: mark the steps the user has completed
function updateSteps() {
  const done = { input: !!S.scen?.rows?.length, reco: S.sel != null && !!S.result, proc: !!S.submitted };
  $$('.stepper .tab').forEach(t => t.classList.toggle('done', !!done[t.dataset.tab] && !t.classList.contains('active')));
}
function runStatus(msg) { $('#runStatus').innerHTML = msg; }
const tick = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------- site loading
// example scenarios: a quiet card per site (treatment icon, title, one meta line, one-line description)
const PRESET_IC = {
  full: '<path d="M9.5 4h5l4 15h-13z"/><path d="M3.5 19h17"/><path d="M8.3 9.5h7.4M7.2 14h9.6"/>',
  lane: '<path d="M5 20L9 4M19 20L15 4"/><path d="M12 5v2M12 11v2M12 17v2"/>',
};
function renderPresets() {
  $('.ex-head .muted').textContent = PRESETS.length;
  $('#presets').innerHTML = PRESETS.map((p, i) => {
    const kind = p.props.type === 'full' ? 'Full closure' : p.props.type === 'lane' ? 'Lane closure' : CLOSURE_TYPES[p.props.type];
    const meta = [kind, p.tags.includes('tram') && 'tram route', PERIODS[p.period].label.replace(/ \(.*\)$/, '')].filter(Boolean).join(' · ');
    return `<button class="preset${S.presetIdx === i ? ' on' : ''}" data-i="${i}">
      <span class="pr-ic ${p.props.type}${p.period === 'NIGHT' ? ' night' : ''}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PRESET_IC[p.props.type] || PRESET_IC.full}</svg></span>
      <span class="pr-main"><span class="t">${esc(p.title)}</span><span class="m">${esc(meta)}</span><span class="d">${esc(p.desc)}</span></span>
      <span class="pr-go" aria-hidden="true">›</span>
    </button>`; }).join('');
  $$('.preset').forEach(el => el.addEventListener('click', () => {
    const p = PRESETS[+el.dataset.i];
    S.presetIdx = +el.dataset.i;
    setRadius(p.radius);
    renderPresets();
    loadSite(p.center[0], p.center[1], p.radius, p.title, p);
  }));
}
function setRadius(v) {
  const sel = $('#radius');
  if (![...sel.options].some(o => o.value === String(v))) sel.add(new Option(`${(v / 1000).toFixed(1)} km`, String(v)));
  sel.value = String(v);
  // highlight the nearest step (example sites use their own radius)
  const btns = $$('.radius-seg [data-r]');
  if (!btns.length) return;
  const near = btns.reduce((a, b) => Math.abs(b.dataset.r - v) < Math.abs(a.dataset.r - v) ? b : a);
  btns.forEach(b => { b.classList.toggle('on', b === near); b.setAttribute('aria-checked', b === near); });
}
$$('.radius-seg [data-r]').forEach(b => b.addEventListener('click', () => { setRadius(b.dataset.r); $('#radius').dispatchEvent(new Event('change')); }));
setRadius($('#radius').value);

const inMelbourne = (lat, lon) => lat > -38.55 && lat < -37.35 && lon > 144.3 && lon < 145.95;

async function loadSite(lat, lon, radius, name, preset) {
  if (S.busy) return;
  if (!inMelbourne(lat, lon)) { toast('That location is outside Greater Melbourne. Pick a site within the metropolitan area.', true); return; }
  S.busy = true;
  anim.pause(); anim.clear(); $('#simbar').classList.add('hidden');
  Object.values(layers).forEach(l => l.clearLayers());
  Object.assign(S, { net: null, closures: [], baseCache: new Map(), result: null, plan: null, planSc: null, stale: false, mode: null, pick: null });
  renderClosures(); renderResults(); renderInventory();
  $('#runBtn').disabled = true;
  S.site = { lat, lon, radius }; S.siteName = name || `Site at ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const bb = bboxAround(lat, lon, radius * 1.15);
  L.circle([lat, lon], { radius, color: '#03080B', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(layers.study);
  map.fitBounds(L.latLng(lat, lon).toBounds(radius * 2.1));
  overlay('Connecting to live data', 'OpenStreetMap · Transport Victoria · City of Melbourne', 0.05);
  setSrc('osm', 'loading…'); setSrc('dtp', 'loading…'); setSrc('ped', 'loading…');
  try {
    const [osmR, tvR, pedR] = await Promise.allSettled([
      fetchOSM(bb, t => overlay('Connecting to live data', t, 0.15)),
      fetchTrafficVolumes(bb),
      fetchPedestrianSensors(bb),
    ]);
    if (osmR.status !== 'fulfilled') throw new Error('Could not download the road network: ' + osmR.reason?.message);
    overlay('Building simulation network', '', 0.8); await tick();
    const net = buildNetwork(osmR.value, [lat, lon], radius);
    if (net.veh.m < 30) throw new Error('Too few roads found here, choose a site on the road network.');
    S.net = net;
    if (S.dtpSignals) applySignalSites(net, S.dtpSignals.sites);
    loadCrashes();
    S.zones = buildZones(net);
    S.matches = tvR.status === 'fulfilled' ? matchCounts(net, tvR.value) : [];
    S.sensors = pedR.status === 'fulfilled' ? pedR.value : [];
    S.fetchedAt = new Date();
    // hospitals, ambulance, fire and police stations (OSM), for the emergency services pillar
    const EM = { hospital: 'Hospital', ambulance_station: 'Ambulance station', fire_station: 'Fire station', police: 'Police station' };
    S.emergency = osmR.value.elements.filter(el => EM[el.tags?.amenity] && !(el.tags.amenity === 'hospital' && el.tags.emergency === 'no'))
      .map(el => ({ kind: EM[el.tags.amenity], name: el.tags.name || EM[el.tags.amenity], lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon })).filter(x => x.lat != null);
    const SHOP_GROUP = s => /supermarket|convenience|greengrocer|butcher|bakery|deli|alcohol|beverages/.test(s) ? 'Food shops' : 'Retail';
    S.businesses = osmR.value.elements.filter(el => el.tags && (el.tags.shop || BIZ_GROUP[el.tags.amenity]))
      .map(el => ({ name: el.tags.name || null, group: el.tags.shop ? SHOP_GROUP(el.tags.shop) : BIZ_GROUP[el.tags.amenity], lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon })).filter(b => b.lat != null);
    setSrc('osm', `${fmt(osmR.value.elements.length)} elements`, 'ok');
    if (tvR.status === 'fulfilled') setSrc('dtp', `${S.matches.length} links matched`, S.matches.length ? 'ok' : 'na'); else setSrc('dtp', 'unavailable', 'err');
    if (pedR.status === 'fulfilled') setSrc('ped', S.sensors.length ? `${S.sensors.length} sensors` : 'none here', S.sensors.length ? 'ok' : 'na'); else setSrc('ped', 'unavailable', 'err');
    S.streetNodes = new Map();
    for (const Lk of net.veh.links) {
      const k = normName(Lk.name);
      if (!S.streetNodes.has(k)) S.streetNodes.set(k, new Set());
      S.streetNodes.get(k).add(Lk.a); S.streetNodes.get(k).add(Lk.b);
    }
    drawNetwork(); drawPT(); drawSensors(); drawCounts(); drawZones(); drawSignals(); drawCrashes(); updateLegend();
    renderNetStats();
    $('#runBtn').disabled = false;
    runStatus(`Area loaded: <b>${fmt(net.veh.links.length)}</b> road links. Mark the work site on the map.`);
    if (preset) applyPreset(preset);
    else switchTab('input');
  } catch (e) {
    console.error(e);
    toast(e.message, true, 8000);
    setSrc('osm', 'failed', 'err');
    runStatus('Could not load the site. Check your connection and try again.');
  } finally { hideOverlay(); S.busy = false; }
}

const PRESET_SCHED = {
  'Collins St, Melbourne CBD': { days: 1, win: 'day' }, 'Sydney Rd, Brunswick': { days: 2, win: '247' }, 'Hoddle St, Collingwood': { days: 2, win: 'day' },
  'Chapel St, Prahran': { days: 1, win: 'day' }, 'Glenferrie Rd, Hawthorn': { days: 2, win: 'night' }, 'Whitehorse Rd, Box Hill': { days: 2, win: 'day' },
};
function applyPreset(p) {
  const g = S.net.veh, key = normName(p.street), nodes = S.streetNodes.get(key);
  if (!nodes) { toast(`${p.street} not found in the downloaded network.`, true); return; }
  const snap = ll => nearestNode(g, S.net.proj.fwd(ll[0], ll[1]), nd => nodes.has(nd.i));
  const chain = selectChain(g, snap(p.a), snap(p.b), p.street);
  if (!chain) { toast('Could not trace the preset closure on the current OSM network.', true); return; }
  S.closures = [makeClosure(g, chain, { street: p.street, ...p.props, type: 'full', direction: 'both' })];
  $('#period').value = p.period;
  const ps = PRESET_SCHED[p.title] || { days: 1, win: 'day' };
  $('#days').value = ps.days; setWindow(ps.win);
  $$('.geo-seg [data-geo]').forEach(b => b.classList.toggle('on', b.dataset.geo === 'segment'));
  onClosuresChanged();
  switchTab('input');
  toast('Example loaded. Check the schedule, then press Generate scenarios.');
}

// ---------------------------------------------------------------- schedule (Input)
function setWindow(kind) {
  S.win = kind;
  if (WINDOWS[kind] && kind !== '247') { $('#winFrom').value = WINDOWS[kind][0]; $('#winTo').value = WINDOWS[kind][1]; }
  $$('.win-seg [data-win]').forEach(b => b.classList.toggle('on', b.dataset.win === kind));
  $('.win-custom').classList.toggle('show', kind === 'custom');
  schedChanged();
}
const PRIO_LABEL = { cost: 'Lowest cost', pt: 'Keep trams and buses running', nonight: 'Avoid night works', fast: 'Finish in the fewest days', access: 'Keep business and resident access' };
S.prioOrder = ['cost'];
function renderPrioRanks() {
  $$('[data-prio]').forEach(c => { c.checked = S.prioOrder.includes(c.dataset.prio);
    let b = c.parentElement.querySelector('.rk'); if (!b) { b = document.createElement('span'); b.className = 'rk'; c.after(b); }
    b.textContent = c.checked ? S.prioOrder.indexOf(c.dataset.prio) + 1 : '+'; });
}
$$('[data-prio]').forEach(c => c.addEventListener('change', () => {
  const k = c.dataset.prio;
  S.prioOrder = c.checked ? [...S.prioOrder.filter(x => x !== k), k] : S.prioOrder.filter(x => x !== k);
  renderPrioRanks();
}));
renderPrioRanks();
function readPriorities() {
  const pri = S.prioOrder.slice();
  return { keys: pri, priorities_in_order: pri.map((k, i) => `${i + 1}. ${PRIO_LABEL[k]}`), budget_aud: +$('#budget').value || null, notes: $('#prioNotes').value.trim() || null };
}
function readSchedule() {
  const [from, to] = S.win === '247' ? ['00:00', '24:00'] : [$('#winFrom').value || '09:30', $('#winTo').value || '15:30'];
  return { startDate: $('#appStart').value || null, days: Math.max(1, Math.round(+$('#days').value || 1)), from, to, weekend: false };
}
function schedChanged() {
  const sc = readSchedule(), h = scheduleHours(sc);
  $('#schedSummary').textContent = `${fmt(h.total)} working hours · ${Object.entries(h.periods).map(([p, x]) => `${fmt(x)} h ${PERIODS[p].label.replace(/ \(.*\)$/, '').toLowerCase()}`).join(', ')}`;
  $('#appHours').value = sc.from === '00:00' && sc.to === '24:00' ? '24 hours' : `${sc.from} to ${sc.to}`;
  $('#duration').value = Math.max(1, Math.round(h.total));
}
$$('.win-seg [data-win]').forEach(b => b.addEventListener('click', () => setWindow(b.dataset.win)));
['#days', '#appStart'].forEach(id => $(id).addEventListener('change', schedChanged));
['#winFrom', '#winTo'].forEach(id => $(id).addEventListener('change', () => { if (S.win !== 'custom') { S.win = 'custom'; $$('.win-seg [data-win]').forEach(b => b.classList.toggle('on', b.dataset.win === 'custom')); } schedChanged(); }));
$('#genBtn').addEventListener('click', () => genScenarios());

// ---------------------------------------------------------------- scenarios (Recommendation)
async function genScenarios() {
  if (!S.net || !S.closures.length) { toast('Mark the work site on the map first.', true); return; }
  if (S.busy) return;
  S.busy = true; anim.pause();
  const sched = readSchedule(), g = S.net.veh;
  try {
    overlay('Building scenarios', 'Four execution options, hour by hour', 0);
    const footprint = S.closures.map(c => ({ ...c, type: 'full', direction: 'both' }));
    const rows = await generateScenarios(g, footprint, sched, async (cs, period) => {
      const base = await ensureBaseline(period, () => {});
      const r = await runScenario(S.net, base, cs, S.inventory, { ...planOpts() }, S.sensors, null, S.matches);
      r.base = base;
      return { r, cost: costs(r), checks: complianceChecks(S.net, cs, r, base) };
    }, (l, f) => overlay('Building scenarios', l, f));
    for (const row of rows) {
      row.pillars = assessPillars(S.net, row.r, row.r.base, row.closures, S.emergency, S.zones);
      row.bom = buildBOM(row.r.plan, S.inventory, row.sched, row.hours, S.rates);
      row.contractor = row.bom.net;
      row.highs = Object.values(row.pillars).filter(p => p.level === 'High').length;
    }
    // rule-based pick (fallback and cross-check for the AI): within the contractor's hard limits, passes the checks,
    // fewest high-impact pillars, then lowest equipment + community cost
    const pr = readPriorities();
    const breaks = row => (pr.keys.includes('nonight') && row.key === 'night') || (pr.budget_aud && row.contractor > pr.budget_aud);
    const rank = [...rows].sort((a, b) => breaks(a) - breaks(b) || (a.fails > 0) - (b.fails > 0) || a.highs - b.highs || (a.contractor + a.community) - (b.contractor + b.community));
    if (rank[0]) rank[0].recommended = true;
    S.scen = { rows, sched, best: rank[0] || null };
    S.sel = null; S.result = null; S.aiAdvice = null; S.scenAdvice = null; S.submitted = null; S.bomQty = {};
    $('#resultsBody').innerHTML = ''; setRP(false);
    renderReco();
    switchTab('reco');
    if (rows.length > 1) openCompare(scenCompareItems());
    // the AI recommendation runs as soon as the scenarios are ready
    if (S.aiEnabled) askAI(aiScenX(), $('#aiCardScen'), 'scen');
  } catch (e) { console.error(e); toast('Scenario generation failed: ' + e.message, true, 8000); }
  finally { hideOverlay(); S.busy = false; updateRunbar(); updateSteps(); }
}
const LV_CLASS = { High: 'bad', Medium: 'warn', Low: 'ok' };
const COMMUNITY_NOTE = 'Cost the closure puts on road users and the community over your working hours, not paid by the contractor: extra travel time for cars, vans and trucks, vehicle running costs, public transport and pedestrian delay, emissions, noise, air pollution and crash risk. Each working hour is modelled in its own traffic period and valued with TfNSW / ATAP parameter values (June 2024 AUD).';
const dayLabel = sc => `${sc.days} ${sc.weekend ? 'weekend ' : ''}day${sc.days > 1 ? 's' : ''}`;
const winLabel = sc => sc.from === '00:00' && sc.to === '24:00' ? '24/7' : `${sc.from}–${sc.to}`;
function renderReco() {
  const el = $('#recoBody'), x = S.scen;
  if (!x) { el.innerHTML = '<p class="empty">Set the work site and schedule, then press <b>Generate scenarios</b>.</p>'; return; }
  el.innerHTML = `<div class="reco-head"><div><div class="si-t">Execution scenarios</div><div class="muted small">${esc(S.siteName)} · ${esc(scheduleLabel(x.sched))}</div></div>
      <button class="btn sm primary" id="cmpScen">Compare</button></div>
    <div class="ai-card" id="aiCardScen">
      <div class="ai-head"><span class="ai-badge">AI</span><b>AI recommendation</b><button class="btn sm" id="aiAsk">${S.scenAdvice ? 'Ask again' : 'Ask AI'}</button></div>
      <div id="aiBody">${S.scenAdvice ? aiAdviceHtml(S.scenAdvice, aiScenX()) : S.aiEnabled ? '<p class="muted small ai-wait" style="margin:4px 0 0">Weighing the scenarios against your priorities…</p>' : '<p class="muted small" style="margin:4px 0 0">AI is not set up on this server; the model pick is shown instead.</p>'}</div>
    </div>
    <div class="scn-list">${x.rows.map((row, i) => { const aiPick = S.scenAdvice?.advice?.recommended_option === i;
      return `<div class="scn${S.sel === i ? ' on' : ''}${aiPick || (!S.scenAdvice && row.recommended) ? ' best' : ''}">
      <div class="scn-h"><span class="oc-letter">${String.fromCharCode(65 + i)}</span>
        <div class="scn-hm"><div class="scn-t">${esc(row.name)}</div><div class="scn-s">${esc(dayLabel(row.sched))} · ${esc(winLabel(row.sched))} · ${fmt(row.hours.total)} h</div></div>
        <span class="scn-chips">${aiPick ? '<span class="chip ai">AI recommendation</span>' : !S.scenAdvice && row.recommended ? '<span class="chip ok">Recommended</span>' : ''}</span></div>
      <div class="scn-p">${PILLARS.map(([k, lab]) => `<span class="pl ${LV_CLASS[row.pillars[k].level]}" title="${esc(lab)}: ${row.pillars[k].level}. ${esc(row.pillars[k].text)}"><i></i>${esc(lab.split(' ')[0])}</span>`).join('')}</div>
      <div class="scn-f"><div class="scn-m"><span>Equipment & fees</span><b>${money(row.contractor)}</b></div><div class="scn-m"><span>Community cost <i class="info" title="${esc(COMMUNITY_NOTE)}">i</i></span><b>${money(row.community)}</b></div>
        ${row.fails ? `<span class="chip bad" title="${esc(row.failText)}">${row.fails} need${row.fails > 1 ? '' : 's'} action</span>` : ''}
        <button class="btn sm ${S.sel === i ? 'ghost' : 'primary'}" data-sel="${i}">${S.sel === i ? 'Selected' : 'Select'}</button></div>
    </div>`; }).join('')}</div>
    ${S.sel != null && S.result ? `<button class="btn primary wide" id="toProc">Continue to procurement →</button>` : ''}
    <p class="muted small">Each scenario does the same total working hours. Equipment & fees: the hire cost of the equipment each layout needs, plus fixed fees. Community cost: the cost the closure puts on road users and the community (travel time, vehicle running, public transport, emissions, crash risk) over your working hours. Knock-on ratings: ${PILLARS.map(([, l]) => l.toLowerCase()).join(', ')}.</p>`;
  el.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => selectScenario(+b.dataset.sel));
  $('#cmpScen').onclick = () => openCompare(scenCompareItems());
  const card = $('#aiCardScen');
  card.querySelector('#aiAsk').onclick = () => askAI(aiScenX(), card, 'scen');
  wireAI(aiScenX(), card);
  $('#toProc')?.addEventListener('click', () => switchTab('proc'));
}
async function selectScenario(i) {
  const row = S.scen.rows[i];
  closeCompare();
  S.sel = i; S.bomQty = {}; S.submitted = null;
  S.closures = row.closures.map(c => ({ ...c }));
  renderClosures(); renderGeoSummary();
  $('#period').value = row.period; $('#duration').value = Math.max(1, Math.round(row.hours.total));
  await runSimulation();
  renderReco(); updateSteps(); updateRunbar();
}
function scenCompareItems() {
  return S.scen.rows.map((row, i) => snapshot(row.r, row.cost, row.checks, {
    name: row.name, recommended: row.recommended, closures: row.closures, period: `${dayLabel(row.sched)} (${winLabel(row.sched)})`,
    dur: row.hours.total, days: row.sched.days, cost: row.contractor, community: row.community, pillars: row.pillars, strategy: row.strategy,
    apply: () => selectScenario(i), adjust: async () => { await selectScenario(i); $('#advanced').open = true; },
  }));
}
// the AI sees the four scenarios the same way it sees explorer options
function aiScenX() {
  const rows = S.scen.rows.map((row, i) => ({ treatment: { label: `${row.name} (${scheduleLabel(row.sched)})` }, period: row.period, cost: row.cost, closures: row.closures, r: row.r, checks: row.checks,
    contractor: row.contractor, community: row.community, schedule: scheduleLabel(row.sched), pillars: row.pillars, onApply: () => selectScenario(i),
    equipment: row.bom.lines.map(l => ({ item_key: l.key, label: l.label, quantity: l.qty })), scenIndex: i }));
  return { rows, best: rows[S.scen.rows.indexOf(S.scen.best)] || null };
}

// ---------------------------------------------------------------- procurement
const aud = v => (v < 0 ? '−A$' : 'A$') + Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function currentBOM() {
  const row = S.scen?.rows[S.sel];
  return row && S.result ? buildBOM(S.result.plan, S.inventory, row.sched, row.hours, S.rates, S.bomQty) : null;
}
function renderProc(before) {
  const el = $('#procBody'), row = S.scen?.rows[S.sel], r = S.result;
  if (!row || !r) { el.innerHTML = '<p class="empty">Select a scenario in <b>Recommendation</b> first.</p>'; $('#procDocs').innerHTML = ''; return; }
  const bom = currentBOM(), pil = assessPillars(S.net, r, r.base, S.closures, S.emergency, S.zones);
  const unitH = bom.lines.some(l => l.unit === 'hour');
  el.innerHTML = `<div class="proc-head"><span class="oc-letter">${String.fromCharCode(65 + S.sel)}</span><div><div class="si-t">${esc(row.name)}</div>
      <div class="muted small">${esc(S.siteName)} · ${esc(dayLabel(row.sched))} · ${esc(winLabel(row.sched))}${$('#appStart').value ? ` · from ${new Date($('#appStart').value).toLocaleDateString('en-AU')}` : ''}</div></div></div>
    <h3>Equipment and cost review</h3>
    ${S.rates.placeholder ? `<div class="note">${esc(RATE_NOTE)}</div>` : ''}
    <table class="bom"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Hire</th><th class="num">Subtotal</th></tr></thead><tbody>
      ${bom.lines.map(l => `<tr><td>${esc(l.label)}${l.qty < l.required ? `<div class="bom-warn">Plan needs ${l.required}</div>` : ''}</td>
        <td class="num"><input type="number" min="0" step="1" value="${l.qty}" data-q="${l.key}" aria-label="Quantity ${esc(l.label)}"></td>
        <td class="num"><span class="cur">$</span><input type="number" min="0" step="0.5" value="${l.rate}" data-r="${l.key}" aria-label="Rate ${esc(l.label)}"><span class="per">/${l.unit === 'hour' ? 'h' : 'day'}</span></td>
        <td class="num">${l.units} ${l.unit === 'hour' ? 'h' : 'd'}</td><td class="num" data-sub="${l.key}">${aud(l.subtotal)}</td></tr>`).join('')}
      ${bom.fixed.map((f, i) => `<tr class="fx"><td colspan="4">${esc(f.label)}</td><td class="num"><span class="cur">$</span><input type="number" min="0" step="10" value="${f.amount}" data-f="${i}" aria-label="${esc(f.label)}"></td></tr>`).join('')}
    </tbody><tfoot>
      <tr><td colspan="4">Total excl. GST</td><td class="num" id="bomNet">${aud(bom.net)}</td></tr>
      <tr class="muted"><td colspan="4">GST 10%</td><td class="num" id="bomGst">${aud(bom.gst)}</td></tr>
      <tr class="total"><td colspan="4">Total incl. GST</td><td class="num" id="bomGross">${aud(bom.gross)}</td></tr></tfoot></table>
    <div class="proc-acts"><button class="btn" id="recalBtn">Recalibrate simulation</button><a href="#" id="rateReset" class="small">Reset rates</a></div>
    <h3>Knock-on effects${before ? ' after recalibration' : ''}</h3>
    <div class="pil-list">${PILLARS.map(([k, lab]) => `<div class="pil"><span class="risk ${LV_CLASS[pil[k].level]}"><i></i>${pil[k].level}</span><div><b>${esc(lab)}</b><div class="muted small">${esc(pil[k].text)}${before && before[k].level !== pil[k].level ? ` (was ${before[k].level})` : ''}</div></div></div>`).join('')}</div>
    <!--DOCS-->
    <h3>Documents</h3>
    <div class="doc-row"><button class="btn" id="quoteBtn">Quote (PDF)</button><button class="btn" id="tmpBtn2">TMP report</button><button class="btn" id="tiaBtn2">TIA report</button></div>
    ${S.submitted ? `<div class="confirm"><div class="confirm-t">Quote request prepared</div><div>Reference <b>${esc(S.submitted.ref)}</b> · ${S.submitted.at.toLocaleString('en-AU')}</div>
      <div class="muted small">Demo: this request was not sent to RPM Hire. In production it would send the equipment list, schedule and delivery details to RPM Hire's quoting system and return their confirmation.</div></div>`
      : '<button class="btn primary wide big" id="submitBtn">Submit to RPM Hire for quote</button><p class="muted small center">Demo: prepares the request, nothing is sent.</p>'}`;
  const html = el.innerHTML, cut = html.indexOf('<!--DOCS-->');
  el.innerHTML = html.slice(0, cut); $('#procDocs').innerHTML = html.slice(cut);
  const refresh = () => {
    const b = currentBOM();
    for (const l of b.lines) { const c = el.querySelector(`[data-sub="${l.key}"]`); if (c) c.textContent = aud(l.subtotal); }
    $('#bomNet').textContent = aud(b.net); $('#bomGst').textContent = aud(b.gst); $('#bomGross').textContent = aud(b.gross);
  };
  el.querySelectorAll('[data-q]').forEach(i => i.oninput = () => { S.bomQty[i.dataset.q] = Math.max(0, Math.round(+i.value || 0)); refresh(); });
  el.querySelectorAll('[data-r]').forEach(i => i.oninput = () => { S.rates.items[i.dataset.r] = { ...(S.rates.items[i.dataset.r] || { unit: 'day' }), rate: Math.max(0, +i.value || 0) }; S.rates.placeholder = false; saveRates(S.rates); refresh(); });
  el.querySelectorAll('[data-f]').forEach(i => i.oninput = () => { S.rates.fixed[+i.dataset.f].amount = Math.max(0, +i.value || 0); S.rates.placeholder = false; saveRates(S.rates); refresh(); });
  $('#rateReset').onclick = e => { e.preventDefault(); S.rates = resetRates(); renderProc(); };
  $('#recalBtn').onclick = () => recalibrate();
  $('#quoteBtn').onclick = () => openQuote();
  $('#tmpBtn2').onclick = () => exportCouncilReport('tmp');
  $('#tiaBtn2').onclick = () => exportCouncilReport('tia');
  $('#submitBtn')?.addEventListener('click', () => {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    S.submitted = { ref: `WZS-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, at: d };
    renderProc(before); updateSteps(); openQuote();
  });
}
// re-run the selected scenario with the edited quantities as the equipment available on site
async function recalibrate() {
  if (!S.result) return;
  const before = assessPillars(S.net, S.result, S.result.base, S.closures, S.emergency, S.zones);
  for (const it of S.inventory) if (S.bomQty[it.key] != null) it.stock = S.bomQty[it.key];
  if (S.bomQty.vms != null) $('#maxVms').value = S.bomQty.vms;
  await runSimulation();
  switchTab('proc'); renderProc(before);
  toast('Simulation recalibrated with your equipment quantities.');
}
function openQuote() {
  const row = S.scen?.rows[S.sel], b = currentBOM(); if (!row || !b) return;
  const w = window.open('', '_blank');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Quote request ${esc(S.submitted?.ref || '')}</title>
<style>body{font:10.5pt/1.5 Arial,sans-serif;color:#1f2937;max-width:820px;margin:28px auto;padding:0 24px}h1{font-size:20pt;margin:6px 0 2px;color:#0b1f3a}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:700}.muted{color:#64748b;font-size:9pt}.demo{background:#fef3c7;border:1px solid #fde68a;padding:8px 10px;border-radius:6px;font-size:9.5pt}.kv td:first-child{color:#64748b;width:32%}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right">Print / save as PDF</button>
${S.logo ? `<img src="${S.logo}" alt="WorkZoneSim" style="height:34px">` : ''}
<h1>Equipment quote request</h1><div class="muted">To: RPM Hire · Prepared with WorkZoneSim · ${new Date().toLocaleDateString('en-AU')}${S.submitted ? ` · Ref ${esc(S.submitted.ref)}` : ''}</div>
<p class="demo"><b>Demo.</b> Not sent to RPM Hire. ${S.rates.placeholder ? esc(RATE_NOTE) : 'Rates as entered by the user.'}</p>
<table class="kv"><tr><td>Site</td><td>${esc(S.siteName)} · ${esc(S.closures.map(c => c.street).join(', '))}</td></tr>
<tr><td>Scenario</td><td>${esc(row.name)}</td></tr><tr><td>Schedule</td><td>${esc(dayLabel(row.sched))}, ${esc(winLabel(row.sched))}${$('#appStart').value ? `, from ${new Date($('#appStart').value).toLocaleDateString('en-AU')}` : ''} · ${fmt(row.hours.total)} working hours</td></tr>
<tr><td>Applicant</td><td>${esc($('#appApplicant').value || '[applicant]')} · ${esc($('#appContact').value || '[contact]')}</td></tr></table>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Hire</th><th class="n">Subtotal</th></tr></thead><tbody>
${b.lines.map(l => `<tr><td>${esc(l.label)}</td><td class="n">${l.qty}</td><td class="n">${aud(l.rate)}/${l.unit === 'hour' ? 'h' : 'day'}</td><td class="n">${l.units} ${l.unit === 'hour' ? 'h' : 'd'}</td><td class="n">${aud(l.subtotal)}</td></tr>`).join('')}
${b.fixed.map(f => `<tr><td colspan="4">${esc(f.label)}</td><td class="n">${aud(+f.amount || 0)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td colspan="4">Total excl. GST</td><td class="n">${aud(b.net)}</td></tr><tr><td colspan="4" class="muted">GST 10%</td><td class="n muted">${aud(b.gst)}</td></tr><tr><td colspan="4">Total incl. GST</td><td class="n">${aud(b.gross)}</td></tr></tfoot></table>
<p class="muted">Quantities from the traffic management layout for this scenario (AGTTM / QGTTM Part 3 spacing), adjusted by the user where changed. Delivery address and dates to be confirmed with RPM Hire.</p></body></html>`;
  if (w) { w.document.write(html); w.document.close(); } else download('quote-request.html', html, 'text/html');
}

function renderNetStats() {
  const n = S.net;
  const gw = S.zones.filter(z => z.kind === 'gateway').length;
  const trams = new Set(n.routes.filter(r => r.mode === 'tram').map(r => r.ref)).size;
  const buses = new Set(n.routes.filter(r => r.mode === 'bus').map(r => r.ref)).size;
  $('#netStats').classList.remove('hidden');
  $('#netStats').innerHTML = `<h4>${esc(S.siteName)}</h4><div class="kv">
    <span>Road links (vehicle)</span><span>${fmt(n.veh.links.length)}</span>
    <span>Footpath / walking links</span><span>${fmt(n.ped.links.length)}</span>
    <span>Traffic zones (gateways + local)</span><span>${gw} + ${S.zones.length - gw}</span>
    <span>DTP count links matched</span><span>${S.matches.length}</span>
    <span>Tram routes / bus routes</span><span>${trams} / ${buses}</span>
    <span>PT stops</span><span>${n.stops.length}</span>
    <span>Pedestrian sensors</span><span>${S.sensors.length}</span>
    <span>Signalised intersections (DTP)</span><span>${(n.veh.signalSites || []).filter(s => s.type === 'INT').length}</span>
    <span>Pedestrian signals (DTP)</span><span>${(n.veh.signalSites || []).filter(s => s.type !== 'INT').length}</span>
    <span>Injury crashes (DTP, ${S.crashes ? yearsLabel(S.crashes.years) : '-'})</span><span>${S.crashes ? fmt(S.crashes.list.length) : 'not loaded'}</span></div>
    <p class="muted small" style="margin-top:8px">Data downloaded ${S.fetchedAt.toLocaleString('en-AU')}.</p>`;
}

// ---------------------------------------------------------------- map drawing
const CLASS_STYLE = r => r <= 1 ? ['#1e3a8a', 5] : r === 2 ? ['#9a3412', 4.5] : r === 3 ? ['#ea580c', 4] : r === 4 ? ['#fbbf24', 3.2] : r === 5 ? ['#a8a29e', 2.4] : r === 6 ? ['#d6d3d1', 1.8] : ['#e2e8f0', 1.4];
const vcColor = x => x < 0.5 ? '#22c55e' : x < 0.75 ? '#a3e635' : x < 0.9 ? '#facc15' : x < 1.0 ? '#f97316' : '#dc2626';

function drawNetwork() {
  layers.network.clearLayers();
  linkLines = S.net.veh.links.map(Lk => {
    const pl = L.polyline(Lk.ll, { renderer: canvasR, interactive: true, lineCap: 'round' });
    pl.bindTooltip(() => linkTip(Lk), { sticky: true, opacity: 0.95 });
    pl.addTo(layers.network);
    return pl;
  });
  styleNetwork();
}

function linkTip(Lk) {
  const g = S.net.veh;
  const cls = ROAD_CLASS[Lk.cls]?.label || Lk.cls;
  let h = `<b>${esc(Lk.name)}</b><br>${cls} · ${Lk.oneway ? `one-way, ${Lk.lanesF} lane(s)` : `${Lk.lanesF}+${Lk.lanesB} lanes`} · ${Math.round(Lk.speed)} km/h`;
  const m = S.matches.find(x => x.link === Lk.id);
  const period = currentPeriod();
  if (m) h += `<br>DTP count (${period}): <b>${fmt(m.obs[period])}</b> veh/h · AADT ${fmt(m.aadt)}`;
  const base = S.result ? null : S.baseCache.get(baseKey());
  if (S.result) {
    const r = S.result.links[Lk.id];
    h += `<br>Baseline: ${fmt(r.base)} veh/h (V/C ${r.vcBase.toFixed(2)})<br>With work zone: <b>${fmt(r.scen)}</b> veh/h (V/C ${r.vcScen.toFixed(2)})<br>Change: <b>${r.delta >= 0 ? '+' : ''}${fmt(r.delta)}</b> veh/h`;
  } else if (base) {
    h += `<br>Modelled baseline: ${fmt(modelLinkFlow(g, base.res.flow, Lk))} veh/h`;
  }
  return h;
}

function styleNetwork() {
  if (!S.net) return;
  const mode = S.netMode, res = S.result, g = S.net.veh;
  S.net.veh.links.forEach((Lk, i) => {
    const pl = linkLines[i];
    if (mode === 'class' || !res) {
      const [c, w] = CLASS_STYLE(Lk.rank);
      pl.setStyle({ color: c, weight: w, opacity: 0.85 });
    } else if (mode === 'vc') {
      const r = res.links[i], useScen = S.view === 'scen';
      const f = useScen ? r.scen : r.base, vc = useScen ? r.vcScen : r.vcBase;
      const closed = useScen && ((Lk.edgeF < 0 || res.sc.closed[Lk.edgeF]) && (Lk.edgeB < 0 || res.sc.closed[Lk.edgeB]));
      if (closed) pl.setStyle({ color: '#111827', weight: 3, opacity: 0.8, dashArray: '2 5' });
      else pl.setStyle({ color: f < 15 ? '#cbd5e1' : vcColor(vc), weight: f < 15 ? 1.2 : Math.min(10, 1.5 + f / 250), opacity: 0.9, dashArray: null });
    } else if (mode === 'co2') {
      const d = res.env.linkDCO2[i] / 1000, a = Math.abs(d); // kg/h
      if (a < 0.5) pl.setStyle({ color: '#cbd5e1', weight: 1.2, opacity: 0.8, dashArray: null });
      else pl.setStyle({ color: d > 0 ? (a > 10 ? '#7f1d1d' : '#dc2626') : (a > 10 ? '#065f46' : '#34d399'), weight: Math.min(11, 2 + a / 2), opacity: 0.9, dashArray: null });
    } else {
      const d = res.links[i].delta, a = Math.abs(d);
      const closed = (Lk.edgeF < 0 || res.sc.closed[Lk.edgeF]) && (Lk.edgeB < 0 || res.sc.closed[Lk.edgeB]);
      if (closed) { pl.setStyle({ color: '#111827', weight: 3, opacity: 0.8, dashArray: '2 5' }); return; }
      if (a < 20) pl.setStyle({ color: '#cbd5e1', weight: 1.2, opacity: 0.8, dashArray: null });
      else pl.setStyle({ color: d > 0 ? (a > 400 ? '#b91c1c' : '#ef4444') : (a > 400 ? '#1d4ed8' : '#60a5fa'), weight: Math.min(11, 2 + a / 120), opacity: 0.9, dashArray: null });
    }
  });
  updateLegend();
}

// keep only the parts of long route geometries that lie inside the study area
function clipToStudy(lines) {
  const n = S.net, R = n.radius * 1.12, out = [];
  for (const line of lines) {
    let run = [];
    for (const p of line) {
      const xy = n.proj.fwd(p[0], p[1]);
      if (Math.hypot(xy[0], xy[1]) <= R) run.push(p); else { if (run.length > 1) out.push(run); run = []; }
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

// public transport colours: teal trams, dark slate buses (not used by traffic, vehicles, work zone or crashes)
const PT_COL = { tram: '#0f766e', bus: '#334155' };
function drawPT() {
  layers.pt.clearLayers();
  const n = S.net, res = S.result;
  const affTram = new Set(res?.pt.tram.map(t => t.id) || []), affBus = new Set(res?.pt.bus.map(b => b.id) || []);
  for (const r of n.routes.filter(r => r.mode === 'bus')) {
    const hit = affBus.has(r.id);
    L.polyline(clipToStudy(r.geoms), { renderer: canvasR, color: PT_COL.bus, weight: hit ? 3 : 1.2, opacity: hit ? 0.8 : 0.35, dashArray: hit ? null : '4 4', interactive: hit })
      .bindTooltip(`<b>Bus ${esc(r.ref)}</b> ${esc(r.name)}`, { sticky: true }).addTo(layers.pt);
  }
  for (const t of n.tram) L.polyline(clipToStudy([t.ll]), { renderer: canvasR, color: PT_COL.tram, weight: 2, opacity: 0.6, interactive: false }).addTo(layers.pt);
  for (const r of n.routes.filter(r => r.mode === 'tram' && affTram.has(r.id))) {
    L.polyline(clipToStudy(r.geoms), { renderer: canvasR, color: PT_COL.tram, weight: 3.5, opacity: 0.8 }).bindTooltip(`<b>Tram ${esc(r.ref)}</b> ${esc(r.name)}, affected`, { sticky: true }).addTo(layers.pt);
  }
  for (const s of n.stops) {
    L.circleMarker([s.lat, s.lon], { renderer: canvasR, radius: 2.5, color: s.mode === 'tram' ? PT_COL.tram : PT_COL.bus, weight: 1.2, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(`${s.mode === 'tram' ? 'Tram' : 'Bus'} stop: ${esc(s.name)}`).addTo(layers.pt);
  }
  if (res) {
    for (const b of res.pt.bus) if (b.detourLL) L.polyline(b.detourLL, { color: PT_COL.bus, weight: 4, dashArray: '8 6', opacity: 0.95 }).bindTooltip(`Bus ${esc(b.ref)} diversion (+${fmt(b.extraMin, 1)} min)`, { sticky: true }).addTo(layers.pt);
    const seen = new Set();
    for (const t of res.pt.tram) {
      if (!t.replacementLL || seen.has(t.ref)) continue;
      seen.add(t.ref);
      L.polyline(t.replacementLL, { color: PT_COL.tram, weight: 4, dashArray: '2 6', opacity: 0.95 }).bindTooltip(`Replacement bus for tram ${esc(t.ref)}: ${esc(t.replacementFrom)} ↔ ${esc(t.replacementTo)}`, { sticky: true }).addTo(layers.pt);
    }
  }
}

function drawSensors() {
  layers.ped.clearLayers();
  const hour = PERIODS[currentPeriod()].hour;
  for (const s of S.sensors) {
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="sensor-ico" style="transform:translate(-50%,-50%)"></div>', iconSize: [0, 0] }) })
      .bindTooltip(`<b>${esc(s.name)}</b><br>Pedestrian sensor · avg ${fmt(s.hourly[hour])} people/h at ${hour}:00`).addTo(layers.ped);
  }
  const ped = S.result?.ped;
  if (ped?.affected) {
    for (const ll of ped.closedLinks) L.polyline(ll, { color: PED_COL.closed, weight: 5, opacity: 0.85, dashArray: '1 6', lineCap: 'round' }).bindTooltip('Footpath closed').addTo(layers.ped);
    for (const ex of ped.examples) L.polyline(ex.detour, { color: PED_COL.detour, weight: 3, dashArray: '6 5', opacity: 0.9 }).bindTooltip(`Example pedestrian detour: +${fmt(ex.extra)} m`, { sticky: true }).addTo(layers.ped);
  }
}

function drawCounts() {
  layers.counts.clearLayers();
  const g = S.net.veh, period = currentPeriod(), base = S.baseCache.get(baseKey());
  for (const m of S.matches) {
    const Lk = g.links[m.link], mid = Lk.ll[Lk.ll.length >> 1];
    const mod = base ? modelLinkFlow(g, base.res.flow, Lk) : null;
    L.circleMarker(mid, { renderer: canvasR, radius: 4, color: '#0b1f3a', weight: 1, fillColor: '#38bdf8', fillOpacity: 0.9 })
      .bindTooltip(`<b>${esc(m.road)}</b> (DTP ${m.year || ''})<br>Observed ${period}: ${fmt(m.obs[period])} veh/h${mod != null ? `<br>Modelled: ${fmt(mod)} veh/h` : ''}<br>AADT (two-way): ${fmt(m.aadt)}`).addTo(layers.counts);
  }
}

// DTP road crash data snapped to the network (safety.js); feeds crash history, rates and the safety cost line
function loadCrashes() {
  if (!S.net || !S.crashData) { setSrc('crash', S.crashData === false ? 'unavailable' : 'loading…', S.crashData === false ? 'err' : ''); return; }
  S.crashes = matchCrashes(S.net, S.crashData);
  setSrc('crash', `${fmt(S.crashes.list.length)} crashes`, S.crashes.list.length ? 'ok' : 'na');
}

// diamond markers in colours no other map layer uses (vehicles, traffic change, congestion, PT, equipment)
const CRASH_SEV = { 1: ['Fatal', '#000000', 10], 2: ['Serious injury', '#78350f', 8], 3: ['Other injury', '#db2777', 7] };
const crashDiamond = (col, px) => `<div style="width:${px}px;height:${px}px;background:${col};border:1px solid #fff;transform:translate(-50%,-50%) rotate(45deg);box-shadow:0 0 1px #000"></div>`;
function drawCrashes() {
  layers.crashes.clearLayers();
  if (!S.crashes) return;
  for (const c of [...S.crashes.list].sort((a, b) => b.sev - a.sev)) {
    const [lab, col, rad] = CRASH_SEV[c.sev];
    const who = [c.ped && 'pedestrian', c.cyc && 'cyclist', c.moto && 'motorcyclist'].filter(Boolean).join(', ');
    L.marker(c.ll, { icon: L.divIcon({ className: '', html: crashDiamond(col, rad), iconSize: [0, 0] }), keyboard: false })
      .bindTooltip(`<b>${lab} crash</b>, ${c.year}${who ? `<br>Involved: ${who}` : ''}<br><span style="color:#64748b">${esc(S.net.veh.links[c.link].name)} · DTP road crash data</span>`)
      .addTo(layers.crashes);
  }
}

function drawSignals() {
  layers.signals.clearLayers();
  const sites = S.net?.veh.signalSites || [];
  const HOURS = ['AM', 'OFF', 'PM', 'NIGHT', 'WE'], hi = HOURS.indexOf(currentPeriod());
  const TYPE = { INT: 'Signalised intersection', POS: 'Pedestrian operated signal', 'FLASH PX': 'Flashing pedestrian crossing' };
  for (const s of sites) {
    const html = s.type === 'INT'
      ? '<svg width="12" height="20" viewBox="0 0 12 20" style="transform:translate(-50%,-50%)"><rect x="0.5" y="0.5" width="11" height="19" rx="2" fill="#facc15" stroke="#111" stroke-width=".8"/><rect x="2" y="2" width="8" height="16" rx="1.5" fill="#111827"/><circle cx="6" cy="5" r="1.9" fill="#ef4444"/><circle cx="6" cy="10" r="1.9" fill="#f59e0b"/><circle cx="6" cy="15" r="1.9" fill="#22c55e"/></svg>'
      : '<div style="transform:translate(-50%,-50%);width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #0ea5e9"></div>';
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html, iconSize: [0, 0] }) })
      .bindTooltip(`<b>SCATS site ${s.no}</b> ${esc(s.name)}<br>${TYPE[s.type] || s.type}${s.vols && s.vols[hi] != null ? `<br>${fmt(s.vols[hi])} veh/h in the analysis hour (SCATS, Aug 2026)` : ''}${s.type === 'INT' && !s.nodes.length ? '<br><i>not matched to a junction</i>' : ''}`)
      .addTo(layers.signals);
  }
}

function drawZones() {
  layers.zones.clearLayers();
  for (const z of S.zones) {
    L.circleMarker([z.lat, z.lon], { renderer: canvasR, radius: z.kind === 'gateway' ? 6 : 4, color: '#fff', weight: 1.5, fillColor: z.kind === 'gateway' ? '#7c3aed' : '#64748b', fillOpacity: 0.95 })
      .bindTooltip(z.kind === 'gateway' ? `Gateway: ${esc(z.name)}` : 'Local activity zone').addTo(layers.zones);
  }
}

function drawClosures() {
  layers.closures.clearLayers();
  if (!S.net) return;
  const g = S.net.veh;
  for (const c of S.closures) {
    const col = c.type === 'full' ? '#dc2626' : c.type === 'direction' ? '#e11d48' : '#f97316';
    for (const lid of c.allLinks) {
      L.polyline(g.links[lid].ll, { pane: 'closure', color: col, weight: 12, opacity: 0.6, lineCap: 'butt' })
        .bindTooltip(`<b>${esc(c.label)}</b><br>${CLOSURE_TYPES[c.type]} · ${fmt(c.length)} m`, { sticky: true }).addTo(layers.closures);
    }
    const [A, B] = [c.poly[0], c.poly[c.poly.length - 1]].map(p => S.net.proj.inv(p[0], p[1]));
    for (const [ll, t] of [[A, 'A'], [B, 'B']]) L.marker(ll, { pane: 'closure', icon: L.divIcon({ className: '', html: `<div class="pin" style="transform:translate(-50%,-50%);background:${col}">${t}</div>`, iconSize: [0, 0] }) }).addTo(layers.closures);
  }
}

// ---------------------------------------------------------------- equipment rendering
function eqHtml(item, text, arrow, missing) {
  const m = missing ? ' missing' : '';
  switch (item) {
    case 'sign_rwa': return `<div class="eq eq-diamond${m}"><div><span>RW</span></div></div>`;
    case 'sign_lane': return `<div class="eq eq-diamond${m}"><div><span>LN</span></div></div>`;
    case 'sign_stop': return `<div class="eq eq-diamond${m}"><div><span>STP</span></div></div>`;
    case 'sign_closed': return `<div class="eq eq-rect eq-closed${m}">ROAD CLOSED</div>`;
    case 'sign_detour': return `<div class="eq eq-rect eq-detour${m}">${arrow === 'left' ? '◀ ' : ''}DETOUR${arrow === 'right' ? ' ▶' : ''}</div>`;
    case 'sign_end': return `<div class="eq eq-rect eq-end${m}">${esc(text || 'END')}</div>`;
    case 'sign_fp': return `<div class="eq eq-rect eq-fp${m}">FOOTPATH CLOSED</div>`;
    case 'sign_speed': return `<div class="eq eq-speed${m}">${esc(text || '40')}</div>`;
    case 'vms': return `<div class="eq eq-vms${m}">VMS</div>`;
    case 'arrow': return `<div class="eq eq-arrow${m}">➜</div>`;
    case 'tc': return `<div class="eq eq-tc${m}">TC</div>`;
    case 'barrier': return `<div class="eq eq-rect eq-detour" style="background:#fff;border-color:#f97316;color:#c2410c">▮▮▮</div>`;
    case 'cone': return `<div class="eq" style="color:#f97316;font-size:14px">▲</div>`;
    case 'fence': return `<div class="eq eq-rect eq-fp">⋕⋕</div>`;
    default: return `<div class="eq">•</div>`;
  }
}

// split a lat/lon polyline at a fraction of its length: [covered part, remainder]
function splitLL(ll, frac) {
  if (frac >= 1) return [ll, []];
  if (frac <= 0) return [[], ll];
  const d = [0]; for (let i = 1; i < ll.length; i++) d.push(d[i - 1] + L.latLng(ll[i - 1]).distanceTo(L.latLng(ll[i])));
  const cut = d[d.length - 1] * frac; let i = 1; while (i < d.length - 1 && d[i] < cut) i++;
  const t = (cut - d[i - 1]) / Math.max(1e-9, d[i] - d[i - 1]), p = [ll[i - 1][0] + (ll[i][0] - ll[i - 1][0]) * t, ll[i - 1][1] + (ll[i][1] - ll[i - 1][1]) * t];
  return [[...ll.slice(0, i), p], [p, ...ll.slice(i)]];
}

function drawEquipment(plan) {
  layers.equipment.clearLayers();
  if (!plan) return;
  for (const d of plan.detours) L.polyline(d.ll, { pane: 'closure', color: '#7c3aed', weight: 5, opacity: 0.85, dashArray: '10 7' })
    .bindTooltip(`Signed detour (${d.dir === 'ab' ? 'A→B' : 'B→A'}) · ${fmt(d.len)} m`, { sticky: true }).addTo(layers.equipment);
  for (const ln of plan.lines) {
    const st = ln.kind === 'barrier' ? { color: '#f97316', weight: 6, dashArray: '5 3', opacity: 1 } : ln.kind === 'cones' ? { color: '#fb923c', weight: 4, dashArray: '1 7', lineCap: 'round', opacity: 1 } : { color: '#0284c7', weight: 3.5, dashArray: '6 3', opacity: 0.95 };
    const name = ln.kind === 'barrier' ? `Water-filled barriers${ln.count ? ` ×${ln.count}` : ''}` : ln.kind === 'cones' ? 'Cones / delineation' : 'Pedestrian fencing';
    const [have, gap] = splitLL(ln.ll, ln.avail ?? 1);
    if (have.length > 1) L.polyline(have, { pane: 'equip', ...st }).bindTooltip(name).addTo(layers.equipment);
    if (gap.length > 1) {
      L.polyline(gap, { pane: 'equip', ...st, color: '#9ca3af', opacity: 0.55 }).addTo(layers.equipment);
      L.polyline(gap, { pane: 'equip', color: '#dc2626', weight: 2.2, dashArray: '4 5', opacity: 1 })
        .bindTooltip(`<b>${esc(name)}: not in depot stock</b><br>${Math.round((1 - ln.avail) * 100)}% of this line has no equipment; hire or transfer before the works.`, { sticky: true }).addTo(layers.equipment);
    }
  }
  const label = k => S.inventory.find(i => i.key === k)?.label || k;
  for (const mk of plan.markers) {
    const html = `<div style="transform:translate(-50%,-50%)">${eqHtml(mk.item, mk.text, mk.arrow, mk.missing)}</div>`;
    const msg = mk.kind === 'vms' ? `<br>Message: <b>${esc(vmsMessage().replace(/\|/g, ' / '))}</b>` : '';
    L.marker(mk.ll, { pane: 'equip', icon: L.divIcon({ className: '', html, iconSize: [0, 0] }), zIndexOffset: mk.kind === 'vms' ? 1000 : 0 })
      .bindPopup(`<b>${esc(label(mk.item))}</b>${mk.sub ? `<br>${esc(mk.sub)}` : ''}${msg}<br><span class="muted">${esc(S.closures.find(c => c.id === mk.closure)?.label || 'Project-wide')}</span>${mk.missing ? '<br><b style="color:#dc2626">Not enough stock, this item cannot be deployed.</b>' : ''}<br><span class="muted small">${mk.ll[0].toFixed(5)}, ${mk.ll[1].toFixed(5)}</span>`)
      .addTo(layers.equipment);
  }
}

// ---------------------------------------------------------------- legend
// Map legend: one section per data layer, each with a show / hide toggle (kept in sync with the Layers menu),
// and a header that folds the whole legend.
const EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A9.1 9.1 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/></svg>';
const PED_COL = { closed: '#111827', detour: '#0891b2' };
const legendOn = key => key === 'vehicles' ? anim.show.vehicles : key === 'live' ? anim.show.signals : map.hasLayer(layers[key]);
function setLayer(key, on) {
  if (key === 'vehicles') anim.show.vehicles = on;
  else if (key === 'live') anim.show.signals = on;
  else {
    const l = layers[key];
    if (on) l.addTo(map); else map.removeLayer(l);
    const cb = $(`#layerbar input[data-layer="${key}"]`); if (cb) cb.checked = on;
    if (key === 'pt') anim.show.pt = on;
  }
  anim.draw(); updateLegend();
}
$('#legend').addEventListener('click', e => {
  const t = e.target.closest('[data-leg]');
  if (t) { e.stopPropagation(); setLayer(t.dataset.leg, !legendOn(t.dataset.leg)); return; }
  if (e.target.closest('.lhead')) $('#legend').classList.toggle('collapsed');
});
if (innerWidth <= 900) $('#legend').classList.add('collapsed');
const plan_short = () => !!S.plan && (S.plan.lines.some(l => (l.avail ?? 1) < 1) || S.plan.markers.some(m => m.missing));
function updateLegend() {
  updateSteps();
  const el = $('#legend');
  if (!S.net) { el.innerHTML = '<div class="lhead"><span>Greater Melbourne</span></div><div class="muted">Choose a site to start.</div>'; return; }
  const sec = (key, title, items) => { const on = legendOn(key);
    return `<div class="lsec${on ? '' : ' off'}"><div class="lt"><button class="eye" data-leg="${key}" title="${on ? 'Hide' : 'Show'} ${esc(title.toLowerCase())}" aria-pressed="${on}">${on ? EYE : EYE_OFF}</button><span class="ltt">${title}</span></div>${on ? items : ''}</div>`; };
  const li = (sw, t) => `<div class="li">${sw}${t}</div>`;
  const line = (bg, extra = '') => `<span class="sw" style="background:${bg};${extra}"></span>`;
  const out = ['<div class="lhead"><span>Legend</span><span class="lmin" aria-hidden="true"></span></div>'];
  // traffic
  let title, items = '';
  if (S.netMode === 'class' || !S.result) {
    title = 'Road hierarchy';
    for (const [lab, r] of [['Freeway', 1], ['Highway', 2], ['Primary arterial', 3], ['Secondary arterial', 4], ['Collector', 5], ['Local', 7]]) items += li(line(CLASS_STYLE(r)[0]), lab);
  } else if (S.netMode === 'vc') {
    title = `Congestion (${S.view === 'scen' ? 'with work zone' : 'baseline'})`;
    for (const [lab, x] of [['Free flow  < 0.5', 0.3], ['0.5 – 0.75', 0.6], ['0.75 – 0.9', 0.8], ['0.9 – 1.0', 0.95], ['Over capacity  > 1.0', 1.2]]) items += li(line(vcColor(x)), lab);
    items += li(line('repeating-linear-gradient(90deg,#111 0 2px,transparent 2px 6px)'), 'Closed') + '<div class="muted small">Line width = traffic volume</div>';
  } else if (S.netMode === 'co2') {
    title = 'CO₂e change (kg/h)';
    items = li(line('#7f1d1d'), 'More than +10') + li(line('#dc2626'), '+0.5 to +10') + li(line('#34d399'), '−0.5 to −10') + li(line('#065f46'), 'Less than −10') + '<div class="muted small">Line width = size of change</div>';
  } else {
    title = 'Traffic change (veh/h)';
    items = li(line('#b91c1c'), 'More than +400') + li(line('#ef4444'), '+20 to +400') + li(line('#60a5fa'), '−20 to −400') + li(line('#1d4ed8'), 'Less than −400');
  }
  out.push(sec('network', title, items));
  const sim = !$('#simbar').classList.contains('hidden');
  if (sim) {
    out.push(sec('vehicles', 'Vehicles (simulation)', anim.colorBy === 'speed'
      ? li('<span class="dot" style="background:#16a34a"></span>', 'Near speed limit') + li('<span class="dot" style="background:#f59e0b"></span>', 'Slow') + li('<span class="dot" style="background:#dc2626"></span>', 'Stopped / queuing')
      : li('<span class="dot" style="background:#3b82f6"></span>', 'Informed driver') + li('<span class="dot" style="background:#7c3aed"></span>', 'Habitual driver') + li('<span class="dot" style="background:#e11d48"></span>', 'Habitual, re-routed at closure')));
    out.push(sec('live', 'Traffic signals', li('<svg width="12" height="22" viewBox="0 0 12 22" aria-hidden="true"><rect x="0.5" y="0.5" width="11" height="21" rx="2" fill="#facc15"/><rect x="2" y="2" width="8" height="18" rx="1.5" fill="#111827"/><circle cx="6" cy="5.2" r="2.2" fill="#ef4444"/><circle cx="6" cy="11" r="2.2" fill="#3d2a0a"/><circle cx="6" cy="16.8" r="2.2" fill="#0f2f1a"/></svg>', 'Live state (from zoom 16)')));
  }
  out.push(sec('pt', 'Public transport', li(line(PT_COL.tram), 'Tram route') + li(line(`repeating-linear-gradient(90deg,${PT_COL.bus} 0 4px,transparent 4px 7px)`), 'Bus route')
    + li(`<span class="dot" style="background:#fff;border:1.5px solid ${PT_COL.tram}"></span>`, 'Stop')
    + (sim && anim.pt?.routes.length ? li(line('#2dd4bf', 'height:6px;border:1.5px solid #134e4a'), 'Tram (timetable)') + li(line('#fff', 'height:6px;width:10px;border:1.5px solid #334155'), 'Bus (timetable)') : '')
    + (S.result?.pt.tram.some(t => t.replacementLL) ? li(line(`repeating-linear-gradient(90deg,${PT_COL.tram} 0 3px,transparent 3px 8px)`), 'Replacement bus') : '')));
  if (S.result?.ped?.affected || S.sensors?.length) out.push(sec('ped', 'Pedestrians', (S.result?.ped?.affected ? li(line(`repeating-linear-gradient(90deg,${PED_COL.closed} 0 2px,transparent 2px 6px)`), 'Footpath closed') + li(line(`repeating-linear-gradient(90deg,${PED_COL.detour} 0 6px,transparent 6px 10px)`), 'Pedestrian detour') : '') + (S.sensors?.length ? li('<span class="sensor-ico" style="margin:0 5px 0 4px"></span>', 'Pedestrian sensor') : '')));
  if (S.crashes) out.push(sec('crashes', 'Injury crashes', `<div class="muted small" style="margin:-1px 0 2px">${yearsLabel(S.crashes.years)}</div>` + Object.values(CRASH_SEV).map(([lab, col]) => li(`<span style="display:inline-block;width:8px;height:8px;margin:0 7px 0 3px;background:${col};transform:rotate(45deg)"></span>`, lab)).join('')));
  if (S.plan) out.push(sec('equipment', 'Work zone', li(line('#f97316'), 'Barriers / cones') + li(line('repeating-linear-gradient(90deg,#7c3aed 0 8px,transparent 8px 12px)'), 'Signed detour') + li(line('#0284c7'), 'Pedestrian fencing') + (plan_short() ? li(line('#9ca3af', 'outline:1.5px dashed #dc2626;outline-offset:1px'), 'Not in depot stock (grey)') : '')));
  el.innerHTML = out.join('');
}

// ---------------------------------------------------------------- picking on the map
$('#pickSite')?.addEventListener('click', () => {
  S.mode = S.mode === 'site' ? null : 'site';
  $('#pickSite').classList.toggle('active', S.mode === 'site');
  map.getContainer().style.cursor = S.mode ? 'crosshair' : '';
  if (S.mode) toast('Click anywhere in Greater Melbourne to centre the study area.');
});

$('#addZone').addEventListener('click', () => {
  if (!S.net) { toast('Load a site first.', true); switchTab('site'); return; }
  S.mode = 'zoneA'; S.pick = null; layers.pick.clearLayers();
  map.getContainer().style.cursor = 'crosshair';
  $('#pickHint').classList.remove('hidden');
  $('#pickHint').innerHTML = 'Click the <b>start</b> of the work zone on a road. <a href="#" id="cancelPick">Cancel</a>';
  $('#cancelPick').onclick = e => { e.preventDefault(); endPick(); };
});

function endPick() {
  S.mode = null; S.pick = null; layers.pick.clearLayers();
  map.getContainer().style.cursor = '';
  $('#pickHint').classList.add('hidden');
}

let hoverLine = null, lastMove = 0;
map.on('mousemove', e => {
  if (!(S.mode === 'zoneA' || S.mode === 'zoneB') || !S.net) return;
  const now = performance.now(); if (now - lastMove < 40) return; lastMove = now;
  const p = S.net.proj.fwd(e.latlng.lat, e.latlng.lng);
  const filt = S.mode === 'zoneB' ? Lk => normName(Lk.name) === normName(S.pick.street) : null;
  const nl = nearestLink(S.net.veh, p, 60, filt);
  if (hoverLine) { layers.pick.removeLayer(hoverLine); hoverLine = null; }
  if (nl) hoverLine = L.polyline(nl.link.ll, { color: '#1d4ed8', weight: 8, opacity: 0.5, interactive: false }).bindTooltip(esc(nl.link.name), { permanent: true, direction: 'top', offset: [0, -6] }).addTo(layers.pick);
});

$$('.geo-seg [data-geo]').forEach(b => b.addEventListener('click', () => startGeo(b.dataset.geo)));
function startGeo(kind) {
  S.geoKind = kind; S.mode = kind === 'point' ? 'point' : 'zoneA'; S.pick = null; layers.pick.clearLayers();
  $$('.geo-seg [data-geo]').forEach(b => b.classList.toggle('on', b.dataset.geo === kind));
  map.getContainer().style.cursor = 'crosshair';
  $('#pickHint').classList.remove('hidden');
  $('#pickHint').innerHTML = `${kind === 'point' ? 'Click the work location on a road: a pit, a crane lift, one block.' : 'Click the <b>start</b> of the work zone on a road, then its <b>end</b>.'} <a href="#" id="cancelPick">Cancel</a>`;
  $('#cancelPick').onclick = e => { e.preventDefault(); endPick(); $$('.geo-seg [data-geo]').forEach(b => b.classList.remove('on')); };
}
function renderGeoSummary() {
  const el = $('#geoSummary'); if (!el) return;
  if (!S.closures.length || !S.net) { el.innerHTML = ''; return; }
  el.innerHTML = S.closures.map((c, i) => { const m = closureMeta(c);
    return `<div class="geo-card"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M6.7 15.8L17.3 8.2"/></svg>
      <div><b>${esc(c.street)}</b><div class="muted small">${m.from && m.to ? `${esc(m.from)} to ${esc(m.to)} · ` : ''}${fmt(c.length)} m</div></div>
      <button class="btn sm ghost" data-clear="${i}" aria-label="Remove">✕</button></div>`; }).join('');
  el.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { S.closures.splice(+b.dataset.clear, 1); onClosuresChanged(); });
}

map.on('click', async e => {
  // the first click anywhere loads the area around it, then marks the work site
  if ((S.mode === 'point' || S.mode === 'zoneA') && (!S.net || map.distance([S.site.lat, S.site.lon], e.latlng) > S.site.radius * 0.75)) {
    const keep = { mode: S.mode, kind: S.geoKind };
    await loadSite(e.latlng.lat, e.latlng.lng, 1200, null);
    if (!S.net) return;
    S.mode = keep.mode; S.geoKind = keep.kind; startGeo(keep.kind);
  }
  if (S.mode === 'point' && S.net) {
    const g = S.net.veh, nl = nearestLink(g, S.net.proj.fwd(e.latlng.lat, e.latlng.lng), 60);
    if (!nl) { toast('Click closer to a road.', true); return; }
    const c = makeClosure(g, { links: [nl.link.id], nodes: [nl.link.a, nl.link.b] }, { street: nl.link.name });
    if (!c.abEdges.length && !c.baEdges.length) { toast('Could not build a work site there.', true); return; }
    S.closures = [c]; endPick(); onClosuresChanged();
    return;
  }
  if (S.mode === 'site') {
    S.mode = null; $('#pickSite')?.classList.remove('active'); map.getContainer().style.cursor = '';
    loadSite(e.latlng.lat, e.latlng.lng, +$('#radius').value, null);
    return;
  }
  if (!S.net || !(S.mode === 'zoneA' || S.mode === 'zoneB')) return;
  const g = S.net.veh, p = S.net.proj.fwd(e.latlng.lat, e.latlng.lng);
  if (S.mode === 'zoneA') {
    const nl = nearestLink(g, p, 60);
    if (!nl) { toast('Click closer to a road.', true); return; }
    const street = nl.link.name, nodes = S.streetNodes.get(normName(street));
    const A = nearestNode(g, p, nd => nodes.has(nd.i));
    S.pick = { street, A };
    L.marker([g.nodes[A].lat, g.nodes[A].lon], { icon: L.divIcon({ className: '', html: '<div class="pin" style="transform:translate(-50%,-50%)">A</div>', iconSize: [0, 0] }) }).addTo(layers.pick);
    S.mode = 'zoneB';
    $('#pickHint').innerHTML = `Now click the <b>end</b> of the work zone on <b>${esc(street)}</b>. <a href="#" id="cancelPick">Cancel</a>`;
    $('#cancelPick').onclick = ev => { ev.preventDefault(); endPick(); };
  } else {
    const nodes = S.streetNodes.get(normName(S.pick.street));
    const B = nearestNode(g, p, nd => nodes.has(nd.i));
    if (B === S.pick.A) { toast('Pick an end point at a different intersection along the street.', true); return; }
    const chain = selectChain(g, S.pick.A, B, S.pick.street);
    if (!chain) { toast('No connected road between those points.', true); return; }
    const c = makeClosure(g, chain, { street: S.pick.street });
    if (!c.abEdges.length && !c.baEdges.length) { toast('Could not build a work zone there.', true); return; }
    if (S.stage === 'input') S.closures = [c]; else S.closures.push(c);
    endPick();
    onClosuresChanged();
  }
});

// ---------------------------------------------------------------- closures panel
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = b => COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8];
function crossStreet(nodeIdx, street) {
  const g = S.net.veh, names = new Set();
  for (let k = g.outStart[nodeIdx]; k < g.outStart[nodeIdx + 1]; k++) names.add(g.links[g.link[g.outEdge[k]]].name);
  for (let k = g.inStart[nodeIdx]; k < g.inStart[nodeIdx + 1]; k++) names.add(g.links[g.link[g.inEdge[k]]].name);
  names.delete(street);
  return [...names].filter(n => !/^(Local street|Collector|Shared zone|Arterial link|Collector link)$/.test(n))[0] || null;
}
function closureMeta(c) {
  const g = S.net.veh;
  const brg = bearingXY(c.poly[0], c.poly[c.poly.length - 1]);
  const lastL = g.links[c.links[c.links.length - 1]];
  const bNode = lastL.a === c.nodes[c.nodes.length - 1] ? lastL.b : lastL.a;
  const from = crossStreet(c.nodes[0], c.street), to = crossStreet(bNode, c.street);
  const maxLanes = Math.max(1, ...[...c.abEdges, ...c.baEdges].map(e => g.lanes[e]));
  return { ab: compass(brg) + 'bound', ba: compass(brg + 180) + 'bound', leftSide: compass(brg - 90) + ' side', rightSide: compass(brg + 90) + ' side', from, to, maxLanes };
}

function renderClosures() {
  const el = $('#closureList');
  if (!S.closures.length) { el.innerHTML = '<p class="muted small" style="margin-top:10px">No work zones yet.</p>'; drawClosures(); return; }
  el.innerHTML = S.closures.map(c => {
    const m = closureMeta(c);
    const sel = (name, opts, val) => `<select data-k="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const between = m.from && m.to ? `between ${esc(m.from)} and ${esc(m.to)}` : '';
    return `<div class="closure ${c.type}" data-id="${c.id}">
      <div class="head"><div><b>${esc(c.street)}</b><div class="muted small">${between} · ${fmt(c.length)} m${c.twinLinks.length ? ' · both carriageways' : ''}</div></div>
        <div><button class="btn sm" data-act="zoom" title="Zoom to">⌖</button> <button class="btn sm danger" data-act="del" title="Remove">✕</button></div></div>
      <div class="grid2">
        <label>Treatment ${sel('type', Object.entries(CLOSURE_TYPES), c.type)}</label>
        <label>Direction ${sel('direction', [['both', 'Both directions'], ['ab', `A→B (${m.ab})`], ['ba', `B→A (${m.ba})`]], c.direction)}</label>
        <label>Lanes closed ${sel('lanesClosed', Array.from({ length: Math.max(1, m.maxLanes) }, (_, i) => [i + 1, `${i + 1} of ${m.maxLanes}`]), c.lanesClosed)}</label>
        <label>Work zone speed ${sel('speed', [[40, '40 km/h'], [60, '60 km/h'], [20, '20 km/h (shuttle)']], c.speed)}</label>
        <label>Footpath ${sel('footpath', [['open', 'Open'], ['left', `Closed: ${m.leftSide}`], ['right', `Closed: ${m.rightSide}`], ['both', 'Closed: both sides']], c.footpath)}</label>
        <label>Delineation ${sel('delineation', [['barrier', 'Water-filled barriers'], ['cone', 'Cones']], c.delineation)}</label>
      </div></div>`;
  }).join('');
  el.querySelectorAll('.closure').forEach(card => {
    const c = S.closures.find(x => x.id === +card.dataset.id);
    const upd = () => {
      const dirSel = card.querySelector('[data-k=direction]'), laneSel = card.querySelector('[data-k=lanesClosed]');
      dirSel.disabled = c.type === 'full' || c.type === 'shuttle';
      laneSel.disabled = c.type !== 'lane';
      card.className = `closure ${c.type}`;
    };
    card.querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
      const k = s.dataset.k; c[k] = ['lanesClosed', 'speed'].includes(k) ? +s.value : s.value;
      if (k === 'type' && c.type === 'direction' && c.direction === 'both') { c.direction = 'ab'; card.querySelector('[data-k=direction]').value = 'ab'; }
      if (k === 'type' && c.type === 'shuttle') { c.speed = 20; card.querySelector('[data-k=speed]').value = 20; }
      upd(); onClosuresChanged(false);
    }));
    card.querySelector('[data-act=del]').onclick = () => { S.closures = S.closures.filter(x => x !== c); onClosuresChanged(); };
    card.querySelector('[data-act=zoom]').onclick = () => map.fitBounds(L.latLngBounds(c.poly.map(p => S.net.proj.inv(p[0], p[1]))).pad(0.8));
    upd();
  });
  drawClosures();
}

function onClosuresChanged(rerender = true) {
  if (rerender) renderClosures(); else drawClosures();
  S.plan = null; layers.equipment.clearLayers();
  S.explore = null; renderExplore();
  if (S.result) { S.stale = true; runStatus('Work zone changed, press <b>Run simulation</b> to update the results.'); }
  else runStatus(S.closures.length ? 'Work site marked. Set the schedule and press <b>Generate scenarios</b>.' : 'Mark the work site on the map.');
  renderInventory();
  renderGeoSummary();
  updateLegend(); updateRunbar();
}

['#period', '#level'].forEach(id => $(id).addEventListener('change', () => {
  if (S.result) { S.stale = true; runStatus('Timing changed, press <b>Run simulation</b> to update the results.'); }
  if (S.net) { drawSensors(); drawCounts(); drawSignals(); }
}));
['#duration', '#deter', '#spend'].forEach(id => $(id).addEventListener('change', () => { if (S.result) renderResults(); }));
$('#pedCount').addEventListener('change', () => { if (S.result) { S.stale = true; runStatus('Pedestrian count changed, re-run to update.'); } });
$('#prenotify').addEventListener('change', () => { if (S.result) { S.stale = true; runStatus('Assumption changed, re-run to update.'); } });

// ---------------------------------------------------------------- inventory panel
function renderInventory() {
  const plan = S.plan;
  const req = plan ? Object.fromEntries(plan.items.map(i => [i.key, i.required])) : {};
  $('#inventory').innerHTML = `<tr><th>Item</th><th class="num">Stock</th><th class="num">Needed</th><th>Status</th></tr>` +
    S.inventory.map(i => {
      const r = req[i.key] ?? null, short = r != null ? Math.max(0, r - i.stock) : 0;
      return `<tr><td><span class="ico">${eqHtml(i.key, i.key === 'sign_speed' ? '40' : i.key === 'sign_end' ? 'END' : '', 'right', false)}</span>${esc(i.label)}${i.unitLen ? ` <span class="muted small">(${i.unitLen} m unit)</span>` : ''}</td>
        <td class="num"><input type="number" min="0" value="${i.stock}" data-key="${i.key}"></td>
        <td class="num">${r == null ? '–' : fmt(r)}</td>
        <td>${r == null ? '' : short ? `<span class="status-short">short ${short}</span>` : '<span class="status-ok">OK</span>'}</td></tr>`;
    }).join('');
  $$('#inventory input').forEach(inp => inp.addEventListener('change', () => {
    S.inventory.find(i => i.key === inp.dataset.key).stock = Math.max(0, +inp.value || 0);
    if (S.plan) { planOnly(); if (S.result) { S.stale = true; runStatus('Inventory changed, re-run to update how many drivers are informed.'); } }
  }));
  const notes = plan ? [...plan.notes] : [];
  $('#planNotes').innerHTML = plan ? (notes.length ? notes.map(n => `<div class="note">${esc(n)}</div>`).join('') : '<div class="note ok">All required equipment is available in the depot.</div>') +
    `<div class="card"><div class="kv"><span>VMS boards placed / needed</span><span>${plan.vmsPlaced} / ${plan.vmsRequired}</span>
    <span>Advance-signage coverage</span><span>${Math.round(plan.signCoverage * 100)}%</span>
    <span>Work-zone traffic passing a VMS</span><span>${Math.round(plan.vmsCoverage * 100)}%</span>
    <span>Drivers informed in advance</span><span>${Math.round(plan.informed * 100)}%</span></div>
    <p class="muted small" style="margin:6px 0 0">Informed drivers re-route before reaching the site. The rest follow their usual route and divert late at the closure, which adds queueing on the approaches.</p></div>` : '';
  if (plan) {
    const groups = {};
    for (const mk of plan.markers) (groups[mk.item] ||= []).push(mk);
    const label = k => S.inventory.find(i => i.key === k)?.label || k;
    // one row per device type: name, quantity, numbered location buttons that zoom the map (red = no stock)
    const miss = plan.markers.filter(m => m.missing).length;
    $('#deployList').innerHTML = `<details class="fold dep" open><summary>Deployment list<span class="dep-n">${plan.markers.length} items${miss ? ` · <b>${miss} no stock</b>` : ''}</span></summary>
      <div class="dep-list">${Object.entries(groups).map(([k, arr]) => `<div class="dep-row">
        <div class="dep-h"><span class="dep-t">${esc(label(k).replace(/[“”"]/g, ''))}</span><span class="dep-q">×${arr.length}</span></div>
        <div class="dep-pins">${arr.map((mk, i) => `<button class="dep-pin${mk.missing ? ' miss' : ''}" data-ll="${mk.ll.join(',')}" title="${mk.ll[0].toFixed(5)}, ${mk.ll[1].toFixed(5)}${mk.sub ? ` · ${esc(mk.sub)}` : ''}${mk.missing ? ' · not in stock' : ''}">${i + 1}</button>`).join('')}</div>
      </div>`).join('')}</div>
      <p class="muted small" style="margin:6px 0 0">Click a number to zoom to that device. ${RPM_LINKS.catalogue ? `<a href="${esc(RPM_LINKS.catalogue)}" target="_blank" rel="noopener">See equipment photos</a>` : '<span class="ph-link">See equipment photos [link]</span>'}.</p></details>`;
    $$('#deployList .dep-pin').forEach(b => b.onclick = () => map.setView(b.dataset.ll.split(',').map(Number), 19));
  } else $('#deployList').innerHTML = '';
}
$('#planBtn').addEventListener('click', () => planOnly(true));

function vmsMessage() {
  const custom = $('#vmsMsg').value.trim();
  if (custom) return custom;
  const c = S.closures[0];
  if (!c) return '';
  const st = c.street.replace(/ Street$/, ' ST').replace(/ Road$/, ' RD').toUpperCase();
  return c.type === 'full' || c.type === 'direction' ? `${st} CLOSED | USE DETOUR` : `ROADWORKS ${st} | EXPECT DELAYS`;
}
const planOpts = () => ({ prenotify: $('#prenotify').checked, maxVms: +$('#maxVms').value, vmsMessage: vmsMessage(),
  pedCount: parseFloat($('#pedCount').value) || null, ptService: S.ptService, crashes: S.crashes, crashData: S.crashData || null,
  noisy: $('#noisy').value === 'yes', crashLinks: crashRiskLinks(), businesses: S.businesses || null });
// links with a fatal, serious, pedestrian or cyclist injury crash on record: the signed detour avoids them
function crashRiskLinks() {
  if (!S.crashes) return null;
  if (S.crashRisk?.src !== S.crashes) S.crashRisk = { src: S.crashes, set: new Set(S.crashes.list.filter(c => c.sev <= 2 || c.ped || c.cyc).map(c => c.link)) };
  return S.crashRisk.set;
}
const currentPeriod = () => $('#period').value;
const baseKey = () => `${currentPeriod()}|${$('#level').value}`;

async function ensureBaseline(period = currentPeriod(), progress) {
  const key = `${period}|${$('#level').value}`;
  if (S.baseCache.has(key)) return S.baseCache.get(key);
  const base = await runBaseline(S.net, S.zones, S.matches, period, progress || ((stage, f) => overlay(stage, PERIODS[period].label, f * 0.5)), +$('#level').value);
  S.baseCache.set(key, base);
  if (period === currentPeriod()) drawCounts();
  return base;
}

function appDetails() {
  const v = id => $(id).value.trim();
  return { applicant: v('#appApplicant'), contact: v('#appContact'), works: v('#appWorks'), start: v('#appStart') ? new Date(v('#appStart') + 'T00:00') : null,
    hours: v('#appHours'), preparer: v('#appPreparer'), version: v('#appVersion'), tmpNo: v('#appTmpNo') };
}

// ---------------------------------------------------------------- decide: option explorer
$('#exploreBtn').addEventListener('click', async () => {
  if (!S.net || !S.closures.length) { toast('Load a site and add a work zone first.', true); return; }
  if (S.busy) return;
  S.busy = true; anim.pause();
  const g = S.net.veh;
  try {
    overlay('Exploring options', '', 0);
    let label = '', frac = 0;
    const res = await exploreOptions(g, S.closures, async (cs, period) => {
      const base = await ensureBaseline(period, (stage, f) => overlay('Exploring options', `${label}, ${stage}`, frac));
      const r = await runScenario(S.net, base, cs, S.inventory, { ...planOpts() }, S.sensors, null, S.matches);
      r.base = base;
      return { r, cost: costs(r), checks: complianceChecks(S.net, cs, r, base) };
    }, (l, f) => { label = l; frac = f; overlay('Exploring options', l, f); });
    S.explore = res; S.aiAdvice = null;
    renderExplore();
  } catch (e) { console.error(e); toast('Option search failed: ' + e.message, true); }
  finally { hideOverlay(); S.busy = false; }
});

function renderExplore() {
  const x = S.explore, el = $('#exploreBody');
  if (!x) { el.innerHTML = ''; return; }
  const b = x.best;
  const status = o => o.fails ? `<span class="chip bad" title="${esc(o.failText)}">Fails ${o.fails}</span>` : `<span class="chip ok">Passes</span>${o.warns ? `<span class="chip warn">${o.warns} to check</span>` : ''}`;
  el.innerHTML = `${b ? `<div class="reco">
      <div class="reco-k">Recommended</div>
      <div class="reco-t">${esc(b.treatment.label)}</div>
      <div class="reco-s">${esc(PERIODS[b.period].label)} · ${money(b.cost.sum)} · ${fmt(Math.max(0, b.r.kpi.dVHT))} extra veh-h/h${b.trams.length ? ` · tram ${esc(b.trams.join(', '))} cut` : ''}</div>
      <button class="btn primary sm" data-apply="${x.rows.indexOf(b)}">Apply and run</button></div>`
    : '<div class="note">No option passes every check. The reasons are listed with each option; change the equipment stock, the treatment or the work zone length.</div>'}
    <div class="ai-card" id="aiCard">
      <div class="ai-head"><span class="ai-badge">AI</span><b>AI advice</b><button class="btn sm" id="aiAsk">${S.aiAdvice ? 'Ask again' : 'Ask AI'}</button></div>
      <div id="aiBody">${S.aiAdvice ? aiAdviceHtml(S.aiAdvice, x) : '<p class="muted small" style="margin:4px 0 0">A written recommendation and what to do next, from the options below.</p>'}</div>
    </div>
    <div class="opt-head"><span>${x.rows.length} options, lowest cost first</span><button class="btn sm primary" id="cmpExplore">Compare <span id="cmpN">0</span></button></div>
    <div class="opt-list">${x.rows.map((o, i) => `<label class="opt${o === b ? ' is-best' : ''}">
      <input type="checkbox" data-cmp="${i}" ${i < 4 || o === b ? 'checked' : ''}>
      <span class="opt-main"><span class="opt-t">${esc(o.treatment.label)}</span><span class="opt-s">${esc(PERIODS[o.period].label)}</span>
        <span class="opt-c">${status(o)}${o.fails ? `<span class="opt-why">${esc(o.failText)}</span>` : ''}</span></span>
      <span class="opt-r"><span class="opt-cost">${money(o.cost.sum)}</span><button class="btn sm ghost" data-apply="${i}" title="Apply this option and run it">Apply</button></span>
    </label>`).join('')}</div>
    <p class="muted small">Same works duration for every option (${fmt(econParams().duration)} h); day and night productivity differences are not modelled.</p>`;
  const count = () => { $('#cmpN').textContent = el.querySelectorAll('[data-cmp]:checked').length; };
  el.querySelectorAll('[data-cmp]').forEach(c => c.onchange = count); count();
  el.querySelectorAll('[data-apply]').forEach(btn => btn.onclick = e => { e.preventDefault(); const o = x.rows[+btn.dataset.apply]; applyOption(o.closures, o.period); });
  $('#aiAsk').onclick = () => askAI(x);
  wireAI(x);
  $('#cmpExplore').onclick = () => {
    const pick = [...el.querySelectorAll('[data-cmp]:checked')].map(c => x.rows[+c.dataset.cmp]);
    if (pick.length < 2) { toast('Select at least two options.', true); return; }
    openCompare(pick.map(o => snapshot(o.r, o.cost, o.checks, { name: `${o.treatment.label}`, recommended: o === b, closures: o.closures, apply: () => applyOption(o.closures, o.period), adjust: () => adjustOption(o.closures, o.period) })));
  };
}

// ---------------------------------------------------------------- AI advice (Gemini, through server.js)
// The model sees only the tool's own results for up to eight options and must pick one of them.
function aiPayload(x) {
  const rows = x.rows.slice(0, 8);
  if (x.best && !rows.includes(x.best)) rows.push(x.best);
  const r0 = rows[0].r;
  return {
    ...(x.rows[0]?.schedule ? { contractor: readPriorities() } : {}),
    site: S.siteName, council: r0.council ? { name: r0.council.name, cbd: r0.council.cbd } : null,
    works: { description: $('#appWorks').value.trim() || null, duration_hours: econParams().duration, closure: S.closures.map(c => ({ street: c.street, length_m: Math.round(c.length), footpath: c.footpath })) },
    tool_recommendation: x.best ? x.rows.indexOf(x.best) : null,
    options: rows.map(o => { const s = snapshot(o.r, o.cost, o.checks);
      return { id: x.rows.indexOf(o), name: o.schedule ? o.treatment.label : `${o.treatment.label}, ${PERIODS[o.period].label}`,
        ...(o.contractor != null ? { equipment_and_fees_aud: Math.round(o.contractor), community_cost_aud: Math.round(o.community), schedule: o.schedule,
          knock_on: Object.fromEntries(Object.entries(o.pillars || {}).map(([k, v]) => [k, `${v.level}: ${v.text}`])) } : { total_cost_aud: Math.round(s.cost) }),
        cost_per_hour_aud: Math.round(s.perHour),
        extra_vehicle_hours_per_hour: +s.dVHT.toFixed(1), delay_per_vehicle_min: +s.perAffected.toFixed(1), rerouted_veh_per_h: Math.round(s.rerouted),
        longest_new_queue_m: Math.round(s.queue), queue_street: s.queueName || null, trams_interrupted: s.trams, bus_routes_affected: s.buses.length,
        pedestrian_detour_m: Math.round(s.ped), local_streets_over_double: s.localHot, co2e_t: +s.co2t.toFixed(2), equipment_shortfalls: s.shortfalls,
        checks_failed: o.checks.filter(c => c.status === 'fail').map(c => ({ check: c.topic, finding: c.finding, fix: c.rec })),
        checks_to_confirm: o.checks.filter(c => c.status === 'warn').map(c => c.topic),
        ...(o.equipment ? { equipment: o.equipment } : {}) }; }),
  };
}
function aiAdviceHtml(res, x) {
  const a = res.advice, o = x.rows[a.recommended_option], ru = a.runner_up != null ? x.rows[a.runner_up] : null;
  const list = arr => arr?.length ? `<ul>${arr.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  return `<div class="ai-reco">${o ? `<div class="ai-pick"><span>${esc(o.treatment.label)}</span><span class="muted">${o.schedule ? '' : `${esc(PERIODS[o.period].label)} · `}${money(o.contractor ?? o.cost.sum)}</span><button class="btn sm primary" data-ai-apply="${a.recommended_option}">Apply</button></div>` : ''}
    <p class="ai-line">${esc(a.headline)}</p>
    <details class="ai-more"><summary>Why, next steps and trade-offs</summary>
    ${a.why?.length ? `<div class="ai-sec">Why</div>${list(a.why)}` : ''}
    ${a.actions?.length ? `<div class="ai-sec">What to do before lodging</div>${list(a.actions)}` : ''}
    ${a.trade_offs?.length ? `<div class="ai-sec">Trade-offs</div>${list(a.trade_offs)}` : ''}
    </details>
    ${o && o.checks.some(c => c.status === 'fail') ? `<div class="note">Needs action before lodging: ${o.checks.filter(c => c.status === 'fail').map(c => esc(c.topic)).join(', ')}.</div>` : ''}
    ${o && a.equipment_changes?.length ? `<div class="ai-sec">Suggested equipment changes</div><ul>${a.equipment_changes.filter(c => o.equipment?.some(e => e.item_key === c.item_key) || S.inventory.some(i => i.key === c.item_key)).map(c => `<li><b>${esc((S.inventory.find(i => i.key === c.item_key)?.label || c.item_key).replace(/[“”"]/g, ''))}: ${c.quantity}</b> · ${esc(c.reason)}</li>`).join('')}</ul>
      ${o.scenIndex != null ? `<button class="btn sm" data-ai-eq="${a.recommended_option}">Use these quantities in procurement</button>` : ''}` : ''}
    ${ru ? `<p class="muted small">Runner-up: ${esc(ru.treatment.label)}${ru.schedule ? '' : `, ${esc(PERIODS[ru.period].label)}`}.</p>` : ''}
    <p class="ai-foot">Written by ${esc(res.model)} from this tool's results. Check it before relying on it.</p></div>`;
}
function wireAI(x, root = document) {
  root.querySelectorAll('#aiBody [data-ai-apply]').forEach(b => b.onclick = () => { const o = x.rows[+b.dataset.aiApply]; if (!o) return; if (o.onApply) o.onApply(); else applyOption(o.closures, o.period); });
  // take the AI's equipment changes into the bill of materials, then the user can recalibrate
  root.querySelectorAll('#aiBody [data-ai-eq]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.aiEq, adv = (S.scenAdvice || S.aiAdvice)?.advice;
    if (S.sel !== i || !S.result) await selectScenario(i);
    for (const c of adv?.equipment_changes || []) if (S.inventory.some(it => it.key === c.item_key)) S.bomQty[c.item_key] = Math.max(0, Math.round(c.quantity));
    switchTab('proc');
    toast('AI quantities loaded. Press Recalibrate to see their effect.');
  });
}
async function askAI(x, root = document, kind = 'explore') {
  const body = root.querySelector('#aiBody'), btn = root.querySelector('#aiAsk');
  btn.disabled = true; body.innerHTML = '<p class="muted small ai-wait">Asking the AI…</p>';
  try {
    const r = await fetch('api/advise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aiPayload(x)) });
    const j = await r.json().catch(() => ({ message: `Server returned ${r.status}` }));
    if (!r.ok) {
      body.innerHTML = `<div class="note">${j.error === 'no_key' ? 'AI advice is not set up. Put <code>GEMINI_API_KEY=your-key</code> in a <code>.env</code> file next to <code>server.js</code> and restart the server.' : `AI advice failed: ${esc(j.message || 'unknown error')}`}</div>`;
      return;
    }
    if (!(j.advice?.recommended_option in x.rows)) { body.innerHTML = '<div class="note">The AI did not pick one of the options. Try again.</div>'; return; }
    if (kind === 'scen') { S.scenAdvice = j; renderReco(); return; }
    S.aiAdvice = j;
    body.innerHTML = aiAdviceHtml(j, x); wireAI(x, root); btn.textContent = 'Ask again';
  } catch (e) { body.innerHTML = `<div class="note">AI advice failed: ${esc(e.message)}</div>`; }
  finally { btn.disabled = false; }
}

// load an option into the work zone editor without running it
function adjustOption(closures, period) {
  closeCompare();
  S.closures = closures.map(c => ({ ...c }));
  $('#period').value = period;
  onClosuresChanged();
  switchTab('zone');
  toast('Option loaded in the work zone editor. Change it, then press Run.');
}

function applyOption(closures, period) {
  closeCompare();
  S.closures = closures.map(c => ({ ...c }));
  $('#period').value = period;
  onClosuresChanged();
  runSimulation();
}

async function planOnly(showOverlay = false) {
  if (!S.net || !S.closures.length) { toast('Add a work zone first.', true); return; }
  if (S.busy) return;
  S.busy = true;
  try {
    if (showOverlay) overlay('Preparing equipment plan');
    const base = await ensureBaseline();
    const g = S.net.veh, sc = applyScenario(g, S.closures), sel = selectLink(g, base.od, base.res, sc);
    S.plan = planEquipment(S.net, S.closures, sc, sel, S.inventory, { ...planOpts(), baseFlow: base.res.flow });
    drawEquipment(S.plan); renderInventory(); updateLegend();
  } catch (e) { console.error(e); toast(e.message, true); }
  finally { hideOverlay(); S.busy = false; }
}

// ---------------------------------------------------------------- run simulation
$('#runBtn').addEventListener('click', () => S.runAction?.());
async function runSimulation() {
  if (!S.net) return;
  if (!S.closures.length) { toast('Add at least one work zone first.', true); switchTab('zone'); return; }
  if (S.busy) return;
  S.busy = true; anim.pause();
  const t0 = performance.now();
  try {
    overlay('Starting simulation', '', 0.02);
    const base = await ensureBaseline();
    const res = await runScenario(S.net, base, S.closures, S.inventory, planOpts(), S.sensors, (stage, f) => overlay(stage, 'Work zone scenario', 0.5 + f * 0.5), S.matches);
    res.base = base;
    // microsimulation (IDM car-following, MOBIL lane changing, Webster signals) of baseline and work zone
    const microCtx = { net: S.net, od: base.od, base, scen: { res: res.res, sc: res.sc }, closures: S.closures, informed: res.informed, hv: base.hv?.edge, seed: 7 };
    const mb = await new MicroSim(microCtx, 'base').run(f => overlay('Microsimulation: baseline', 'IDM + MOBIL, every vehicle simulated', f));
    const ms = await new MicroSim(microCtx, 'scen').run(f => overlay('Microsimulation: with work zone', 'IDM + MOBIL, every vehicle simulated', f));
    const g = S.net.veh, val = [];
    for (const m of S.matches) { const L = g.links[m.link], obs = m.obs[currentPeriod()]; if (!(obs > 0)) continue; val.push({ obs, mod: (L.edgeF >= 0 ? mb.flows[L.edgeF] : 0) + (L.edgeB >= 0 ? mb.flows[L.edgeB] : 0) }); }
    res.micro = { ctx: microCtx, base: mb, scen: ms,
      validation: val.length ? { n: val.length, gehOk: val.filter(v => geh(v.mod, v.obs) < 5).length / val.length, ratio: val.reduce((s, v) => s + v.mod, 0) / val.reduce((s, v) => s + v.obs, 0) } : null };
    res.meta = { site: S.siteName, period: currentPeriod(), level: +$('#level').value, prenotify: $('#prenotify').checked, when: new Date(), runtime: (performance.now() - t0) / 1000 };
    S.result = res; S.plan = res.plan; S.stale = false; S.rpOpen = true;
    drawEquipment(res.plan); renderInventory();
    S.netMode = 'delta'; $('#netMode').value = 'delta';
    styleNetwork(); drawPT(); drawSensors(); renderResults();
    startAnimation();
    switchTab('results');
    runStatus(`Simulated in ${res.meta.runtime.toFixed(1)} s · ${PERIODS[currentPeriod()].label}. Press ▶ on the map to watch traffic.`);
  } catch (e) {
    console.error(e); toast('Simulation failed: ' + e.message, true, 8000);
  } finally { hideOverlay(); S.busy = false; }
}

// ---------------------------------------------------------------- results
function microSection(r) {
  const b = r.micro.base, s = r.micro.scen, v = r.micro.validation, g = S.net.veh;
  const d = (x, y, k = 1) => `${(y - x) >= 0 ? '+' : ''}${fmt(y - x, k)}`;
  const q = [...s.maxQueue].map((len, e) => ({ e, len, base: b.maxQueue[e] })).filter(x => x.len - x.base > 30).sort((x, y) => (y.len - y.base) - (x.len - x.base)).slice(0, 5);
  return `<h3>Microsimulation</h3>
    <table class="t"><tr><th></th><th class="num">Baseline</th><th class="num">Work zone</th><th class="num">Change</th></tr>
    <tr><td>Mean travel time (min)</td><td class="num">${fmt(b.meanTT, 1)}</td><td class="num">${fmt(s.meanTT, 1)}</td><td class="num">${d(b.meanTT, s.meanTT)}</td></tr>
    <tr><td>Mean delay (min per trip)</td><td class="num">${fmt(b.meanDelay, 1)}</td><td class="num">${fmt(s.meanDelay, 1)}</td><td class="num">${d(b.meanDelay, s.meanDelay)}</td></tr>
    <tr><td>Total delay (veh-h)</td><td class="num">${fmt(b.delayVh)}</td><td class="num">${fmt(s.delayVh)}</td><td class="num">${d(b.delayVh, s.delayVh, 0)}</td></tr>
    <tr><td>Time stopped (veh-h)</td><td class="num">${fmt(b.stoppedHours)}</td><td class="num">${fmt(s.stoppedHours)}</td><td class="num">${d(b.stoppedHours, s.stoppedHours, 0)}</td></tr>
    <tr><td>Trips completed in the hour</td><td class="num">${fmt(b.served * 100)}%</td><td class="num">${fmt(s.served * 100)}%</td><td class="num">${d(b.served * 100, s.served * 100, 0)} pts</td></tr>
    <tr><td>Re-routed at the closure</td><td class="num">-</td><td class="num">${fmt(s.rerouted)}</td><td></td></tr>
    <tr><td>Removed after 300 s blocked</td><td class="num">${fmt(b.teleported)}</td><td class="num">${fmt(s.teleported)}</td><td class="num">${d(b.teleported, s.teleported, 0)}</td></tr></table>
    ${q.length ? `<p class="small" style="margin:6px 0 2px"><b>Longest measured queues added by the work zone</b></p><table class="t">${q.map(x => `<tr><td>${esc(g.links[g.link[x.e]].name)}</td><td class="num">${fmt(x.base)} → ${fmt(x.len)} m</td></tr>`).join('')}</table>` : ''}
    ${(() => { if (!b.intersections) return '';
      const bi = new Map(b.intersections.map(x => [x.key, x]));
      const rows = s.intersections.map(x => ({ s: x, b: bi.get(x.key) })).filter(x => x.b && x.b.flow + x.s.flow > 0).sort((p, q) => (q.s.delay - q.b.delay) - (p.s.delay - p.b.delay)).slice(0, 5);
      return rows.length ? `<p class="small" style="margin:8px 0 2px" id="r-int"><b>Signalised intersections most affected</b></p>
        <table class="t"><tr><th>Intersection</th><th class="num">DoS</th><th class="num">Delay (s)</th><th class="num">LOS</th></tr>
        ${rows.map(({ b: x, s: y }) => `<tr><td>${esc(y.name)}</td><td class="num">${x.dos.toFixed(2)} → ${y.dos.toFixed(2)}</td><td class="num">${fmt(x.delay)} → ${fmt(y.delay)}</td><td class="num">${levelOfService(x.delay, x.dos)} → <b>${levelOfService(y.delay, y.dos)}</b></td></tr>`).join('')}</table>` : ''; })()}
    <p class="muted small" style="margin-top:6px">Every vehicle simulated for 15 min warm-up plus the measured hour: IDM car-following, MOBIL lane changing, Webster fixed-time signals at ${fmt(b.signals)} DTP signal sites (${fmt(b.signalsScats)} sized from SCATS volumes), give-way by road hierarchy. ${v ? `Baseline flows are ${fmt(v.ratio * 100)}% of Transport Victoria counts on ${v.n} links (${fmt(v.gehOk * 100)}% within GEH 5); ${v.ratio < 0.8 ? 'the microsimulation network carries less than observed, so absolute delays are overstated and the change between runs is the more reliable result.' : 'the network carries close to the observed flows.'}` : ''}</p>`;
}

function kpiCard(v, l, cls = '') { return `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`; }

function groupByRef(list) {
  const m = new Map();
  for (const r of list) {
    const k = r.ref || r.name;
    const cur = m.get(k);
    if (!cur) m.set(k, { ...r, dirs: 1, stops: new Set([...(r.stopsSkipped || []), ...(r.stopsClosed || [])]), maxPax: r.paxHours || 0, unknownFreq: r.freq == null });
    else {
      cur.dirs++; cur.maxPax = Math.max(cur.maxPax, r.paxHours || 0);
      for (const s of [...(r.stopsSkipped || []), ...(r.stopsClosed || [])]) cur.stops.add(s);
      if ((r.extraMin || 0) > (cur.extraMin || 0)) cur.extraMin = r.extraMin;
      if ((r.replacementBuses || 0) > (cur.replacementBuses || 0)) Object.assign(cur, { replacementBuses: r.replacementBuses, replacementMin: r.replacementMin, replacementFrom: r.replacementFrom, replacementTo: r.replacementTo });
    }
  }
  // OSM often holds several variants per route; count at most one service per direction
  for (const g of m.values()) g.paxHours = g.maxPax * Math.min(2, g.dirs);
  return [...m.values()];
}

function econParams() {
  const num = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
  return { duration: Math.max(1, num('#duration') || 1), deter: num('#deter'), spend: num('#spend') };
}

function costs(r) {
  const p = econParams();
  const ptPax = [...groupByRef(r.pt.bus), ...groupByRef(r.pt.tram)].reduce((s, x) => s + (x.paxHours || 0), 0);
  const pedH = r.ped.affected && r.ped.pedHoursPerHour != null ? r.ped.pedHoursPerHour : 0;
  // business trade: only valued when the user supplies both a deterrence rate and an average spend
  const business = r.footfall != null && p.deter != null && p.spend != null ? r.footfall * p.deter / 100 * p.spend : 0;
  const ec = economics({ ...r, ptPersonHours: ptPax, pedPersonHours: pedH }, { duration: p.duration, business });
  return { ...ec, lineTotals: ec.total, p, dur: p.duration, ptPax, pedH, businessValued: business > 0, total: ec.sum, vehHours: r.kpi.dVHT * p.duration };
}

const ECON_LINES = [
  ['carTime', 'Car travel time'], ['lcvTime', 'Light commercial vehicle time'], ['freight', 'Heavy vehicle (freight) time'],
  ['voc', 'Vehicle operating cost (fuel, tyres, maintenance)'], ['pt', 'Public transport passengers'], ['ped', 'Pedestrian delay'],
  ['carbon', 'Carbon (CO₂-e)'], ['airQual', 'Air pollution (health)'], ['noise', 'Traffic noise'], ['safety', 'Road safety (crash risk)'], ['business', 'Local business trade (user input)'],
];
const signed = (v, d = 0) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), d);

const CHECK_TAG = { fail: ['Action needed', 'status-short'], stock: ['Hire', 'st-warn'], warn: ['Validate', 'st-warn'], action: ['Recommendation', 'st-act'], info: ['Note', 'muted'], pass: ['Ready', 'status-ok'] };
function complianceHtml(ch) {
  const order = ['fail', 'stock', 'warn', 'action', 'info'], n = (...k) => ch.filter(x => k.includes(x.status)).length;
  const row = x => `<tr><td style="white-space:nowrap"><span class="${CHECK_TAG[x.status][1]}">${CHECK_TAG[x.status][0]}</span></td><td><b>${esc(x.topic)}</b><br>${esc(x.finding)}${x.status !== 'pass' && x.rec ? `<div class="rec"><b>${x.status === 'warn' ? 'Validate' : 'Action'}:</b> ${esc(x.rec)}${x.status === 'stock' ? ` ${salesLink()}` : ''}</div>` : ''}<div class="basis">${esc(x.basis)}</div></td></tr>`;
  const open = order.flatMap(k => ch.filter(x => x.status === k)), passed = ch.filter(x => x.status === 'pass');
  const sum = [[n('fail', 'stock'), 'need action', 'status-short'], [n('warn'), 'need field validation', 'st-warn'], [n('action'), 'recommendation', 'st-act'], [n('pass'), 'ready to deploy', 'status-ok']]
    .filter(([v]) => v).map(([v, t, c]) => `<span class="${c}">${v} ${t}${v > 1 && t === 'recommendation' ? 's' : ''}</span>`).join(' · ');
  return `<div class="chk-sum">${sum}</div>
    <table class="t">${open.map(row).join('')}</table>
    ${passed.length ? `<details class="fold"><summary>${passed.length} ready to deploy</summary><table class="t">${passed.map(row).join('')}</table></details>` : ''}`;
}
const salesLink = () => RPM_LINKS.sales ? `<a href="${esc(RPM_LINKS.sales)}" target="_blank" rel="noopener">Consult our Sales Team</a>` : '<span class="ph-link">Consult our Sales Team [link]</span>';

function safetySection(r) {
  const s = r.safety;
  if (!s) return '<p class="muted small">Crash data is not loaded, so road safety is not assessed.</p>';
  const row = (lab, x) => `<tr><td>${lab}</td><td class="num">${x.n}</td><td class="num">${x.fatal + x.serious}</td><td class="num">${x.ped}</td><td class="num">${x.cyc}</td></tr>`;
  const TYPE = { arterial: 'Arterial', local: 'Local / collector', freeway: 'Freeway' };
  const rates = Object.entries(s.rates).filter(([, t]) => t.mvkt > 0).map(([k, t]) => `${TYPE[k]} ${money(t.costPerMvkt)}/M veh-km ${t.fromData ? `(${t.n} crashes)` : '(TfNSW average, fewer than 10 crashes)'}`).join(' · ');
  return `<table class="t"><tr><th>Injury crashes ${yearsLabel(s.years)}</th><th class="num">All</th><th class="num">Fatal / serious</th><th class="num">Pedestrian</th><th class="num">Cyclist</th></tr>
    ${row('<b>Work zone section</b>', s.site)}
    ${s.diverted.slice(0, 5).map(d => row(`${esc(d.name)} <span class="muted">+${fmt(d.up)} veh/h</span>`, d)).join('')}
    ${row('Whole study area', s.area)}</table>
    <p class="small" style="margin:6px 0 2px">Change in expected crash cost from diverted and longer trips: <b>${money(s.costPerHour)}</b> per hour of works${s.crashesPerHour ? ` (${signed(s.crashesPerHour * 1000, 2)} injury crashes per 1,000 hours)` : ''}.</p>
    <p class="muted small" style="margin:0">Observed crash cost by road type: ${rates}. Crash rates are DTP crashes divided by modelled vehicle-km; costs per crash from TfNSW EPV Table 5.2. Risk inside the work zone itself is not valued.</p>`;
}

// results drawer on the right of the map; the side panel keeps the steps and decisions
function setRP(open) {
  const has = !!S.result;
  $('#rpanel').classList.toggle('closed', !(open && has));
  $('.mapwrap').classList.toggle('rp-open', !!(open && has));
  $('#rpOpen').classList.toggle('hidden', !has || open);
  S.rpOpen = open;
  setTimeout(() => map.invalidateSize(), 220);
}
$('#rpClose').addEventListener('click', () => setRP(false));
$('#rpOpen').addEventListener('click', () => setRP(true));

function renderResults() {
  const el = $('#resultsBody'), r = S.result;
  if (!r) { el.innerHTML = '<p class="muted">Select a scenario to see its impacts.</p>'; setRP(false); return; }
  const row = S.scen?.rows?.[S.sel];
  $('#rpTitle').textContent = row ? `${String.fromCharCode(65 + S.sel)} · ${row.name}` : r.meta.site;
  const k = r.kpi, c = costs(r), base = r.base;
  const trams = groupByRef(r.pt.tram), buses = groupByRef(r.pt.bus);
  const blockedTrams = trams.filter(t => /interrupted/.test(t.status));
  const maxBar = Math.max(1, ...r.increased.map(s => s.up));
  const calib = base.calib;
  const ch = complianceChecks(S.net, S.closures, r, base);
  const nF = ch.filter(x => x.status === 'fail').length, nW = ch.filter(x => x.status === 'warn').length, nA = ch.filter(x => x.status === 'action').length;
  const verdict = nF ? ['bad', 'Needs changes', `${nF} need${nF > 1 ? '' : 's'} action`] : nW ? ['warn', 'Feasible with conditions', `${nW} to validate on site`] : ['ok', 'Ready to lodge', 'All checks met'];
  // the three largest impacts, most serious first
  const top = [
    blockedTrams.length && [3, `${blockedTrams.length} tram route${blockedTrams.length > 1 ? 's' : ''} cut (${blockedTrams.map(t => esc(t.ref)).join(', ')})`],
    ch.find(x => x.status === 'fail') && [3, `${esc(ch.find(x => x.status === 'fail').topic)}: ${esc(ch.find(x => x.status === 'fail').finding)}`],
    k.maxQueue && k.maxQueue.lengthM > 100 && [2, `${fmt(k.maxQueue.lengthM)} m queue on ${esc(k.maxQueue.name)}`],
    r.rerouted > 100 && [2, `${fmt(r.rerouted)} veh/h re-routed`],
    r.ped.affected && [1, `Footpath closed, ${fmt(r.ped.avgDetour)} m average detour`],
    r.amenity.hotspots && [1, `${r.amenity.hotspots} local street${r.amenity.hotspots > 1 ? 's' : ''} with over double traffic`],
    buses.length && [1, `${buses.length} bus route${buses.length > 1 ? 's' : ''} diverted or delayed`],
  ].filter(Boolean).sort((a, b) => b[0] - a[0]).slice(0, 3);
  const RT = [['overview', 'Overview'], ['traffic', 'Traffic'], ['transit', 'Transit'], ['cost', 'Cost'], ['safety', 'Safety'], ['checks', `Evaluation${nF + nW ? ` <span class="tab-n ${nF ? 'bad' : 'warn'}">${nF + nW}</span>` : ''}`]];
  S.rtab ??= 'overview';
  el.innerHTML = `
    <div class="resbar"><div class="res-title">${esc(r.meta.site)}<span>${S.scen?.rows?.[S.sel] ? `${esc(scheduleLabel(S.scen.rows[S.sel].sched))} · busiest hour: ${esc(PERIODS[r.period].label.replace(/ \(.*\)$/, '').toLowerCase())}` : `${esc(PERIODS[r.period].label)} · ${fmt(c.dur)} h`}</span></div>
      <div class="acts"><button class="btn primary sm" id="expTmp" title="Traffic Management Plan (council format)">TMP</button><button class="btn primary sm" id="expTia" title="Traffic Impact Assessment (council CTIA format)">TIA</button><button class="btn sm" id="saveCmp" title="Save this run to compare options in the Decide tab">Save</button></div>
    </div>
    <div class="verdict ${verdict[0]}">
      <div class="vd-head"><span class="vd-dot"></span><span class="vd-t">${verdict[1]}</span><span class="vd-s">${verdict[2]}${nA ? ` · ${nA} action${nA > 1 ? 's' : ''}` : ''}</span></div>
      <div class="vd-cost"><b>${money(c.total)}</b> economic cost over ${fmt(c.dur)} h · ${r.closures.map(x => `${esc(x.label)}, ${CLOSURE_TYPES[x.type].toLowerCase()}`).join('; ')}</div>
      ${top.length ? `<ul class="vd-list">${top.map(t => `<li>${t[1]}</li>`).join('')}</ul>` : '<div class="vd-cost">No material impact on traffic, public transport or pedestrians.</div>'}
      <a href="#" class="vd-link" data-rt-go="checks">${nF + nW ? 'See what to fix' : 'See checks'} →</a>
    </div>
    ${S.stale ? '<div class="note">Inputs have changed since this run, press Run simulation to refresh.</div>' : ''}
    ${[...new Set(r.warnings)].map(w => `<div class="note">${esc(w)}</div>`).join('')}
    <nav class="rtabs" role="tablist">${RT.map(([id, t]) => `<button role="tab" data-rt="${id}" aria-selected="${S.rtab === id}" class="${S.rtab === id ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <div class="rtab" data-rtab="overview">
    <div class="kpis">
      ${kpiCard(k.dVHT >= 0.5 ? `+${fmt(k.dVHT)}` : '0', 'extra vehicle-hours of travel, per hour', k.dVHT > 50 ? 'bad' : '')}
      ${kpiCard(k.extraMinPerAffected >= 0.05 ? `+${fmt(k.extraMinPerAffected, 1)} min` : '0 min', 'average delay per vehicle that used the work zone')}
      ${kpiCard(fmt(r.rerouted), 'vehicles/h rerouted')}
      ${kpiCard(k.maxQueue ? `${fmt(k.maxQueue.lengthM)} m` : 'none', k.maxQueue ? `longest new queue by end of hour: ${esc(k.maxQueue.name)}` : 'no new queues over capacity', k.maxQueue?.lengthM > 300 ? 'bad' : '')}
      ${kpiCard(money(c.total), `total economic cost over ${fmt(c.dur)} h of works`)}
      ${kpiCard(`${Math.round(r.informed * 100)}%`, 'drivers informed in advance (navigation apps if published, VMS)', r.informed >= 0.8 ? 'good' : '')}
      ${kpiCard(blockedTrams.length ? `${blockedTrams.length} route${blockedTrams.length > 1 ? 's' : ''}` : (buses.length ? `${buses.length}` : 'none'), blockedTrams.length ? 'tram routes interrupted' : buses.length ? 'bus routes delayed or diverted' : 'public transport routes affected', blockedTrams.length ? 'bad' : '')}
      ${kpiCard(r.ped.affected ? `+${fmt(r.ped.avgDetour)} m` : '0 m', r.ped.affected ? `average pedestrian detour (${fmt(r.ped.pedsPerHour)} people/h nearby)` : 'pedestrian detour, footpaths open')}
      ${kpiCard(`${signed(c.co2t, Math.abs(c.co2t) < 10 ? 2 : 1)} t`, `CO₂e over the works (${signed(c.fuelL)} L of fuel)`, c.co2t > 1 ? 'bad' : '')}
      ${r.businesses ? kpiCard(`${r.businesses.n}`, r.businesses.n ? `businesses front the work zone: ${r.businesses.groups.map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}` : 'businesses front the work zone') : ''}
      ${kpiCard(r.amenity.hotspots ? `${r.amenity.hotspots} street${r.amenity.hotspots > 1 ? 's' : ''}` : 'none', r.amenity.hotspots ? `local streets where traffic more than doubles${r.amenity.nightNoise ? ', night noise risk' : ''}` : 'local streets with a large traffic increase', r.amenity.hotspots ? 'bad' : '')}
    </div>

    </div>
    <div class="rtab" data-rtab="traffic">
    ${r.micro ? microSection(r) : ''}
    <h3 id="r-traffic">Traffic, where the diverted traffic goes</h3>
    <table class="t"><tr><th>Street</th><th class="num">Change (veh/h)</th><th class="num">Peak V/C</th></tr>
      ${r.increased.map(s => `<tr><td>${esc(s.name)}</td><td class="num barcell"><i style="width:${(s.up / maxBar * 100).toFixed(0)}%"></i><span>+${fmt(s.up)}</span></td><td class="num" style="color:${vcColor(s.vc)}">${s.vc.toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No significant increases.</td></tr>'}
    </table>
    ${r.relieved.length ? `<p class="small muted" style="margin-top:6px">Less traffic on: ${r.relieved.map(s => `${esc(s.name)} (${fmt(s.down)})`).join(', ')}</p>` : ''}
    ${r.queues.length ? `<details open><summary>New queues over capacity</summary><table class="t">${r.queues.slice(0, 6).map(q => `<tr><td>${esc(q.name)}</td><td class="num">${fmt(q.lengthM)} m</td><td class="num">V/C ${q.vc.toFixed(2)}</td></tr>`).join('')}</table></details>` : ''}
    <div class="card"><div class="kv">
      <span>Traffic through the work zone (before)</span><span>${fmt(r.affectedFlow)} veh/h</span>
      <span>Late diversions at the closure</span><span>${fmt(r.lateFlow)} veh/h</span>
      <span>Average trip time</span><span>${fmt(base.summary.avgTripMin, 1)} → ${fmt(r.summary.avgTripMin, 1)} min</span>
      <span>Extra distance travelled</span><span>${k.dVKT >= 0 ? '+' : ''}${fmt(k.dVKT)} veh‑km/h</span>
      ${k.unserved > 1 ? `<span>Trips needing local access</span><span>${fmt(k.unserved)} veh/h</span>` : ''}
    </div></div>

    </div>
    <div class="rtab" data-rtab="transit">
    <h3>Pedestrians</h3>
    ${r.ped.affected ? `<div class="card"><div class="kv">
      <span>Footpath closed</span><span>${fmt(r.ped.closedLen)} m</span>
      <span>Walking trips nearby that are affected</span><span>${Math.round(r.ped.affectedShare * 100)}%</span>
      <span>Average / longest detour</span><span>${fmt(r.ped.avgDetour)} m / ${fmt(r.ped.maxDetour)} m</span>
      <span>Extra walking time (average)</span><span>${fmt(r.ped.avgExtraMin, 1)} min</span>
      <span>Pedestrian volume</span><span>${fmt(r.ped.pedsPerHour)} /h</span></div>
      <p class="muted small" style="margin:6px 0 0">${esc(r.ped.pedSource)}</p></div>` : `<div class="note ok">${esc(r.ped.note)}</div>`}

    <h3 id="r-pt">Public transport</h3>
    ${blockedTrams.length || trams.length ? trams.map(t => `<div class="card"><h4><span>🚋 Tram ${esc(t.ref)}</span><span class="pill ${/interrupted/.test(t.status) ? 'full' : 'lane'}">${/interrupted/.test(t.status) ? 'interrupted' : 'check'}</span></h4>
      <div class="small">${esc(t.status)}${t.stops.size ? ` · stops out of service: ${[...t.stops].map(esc).join(', ')}` : ''}</div>
      ${t.replacementBuses ? `<div class="small" style="margin-top:4px">Replacement buses: <b>${t.replacementBuses} buses</b> between ${esc(t.replacementFrom)} and ${esc(t.replacementTo)} (${fmt(t.replacementMin, 1)} min one way)</div>` : t.replacementNote ? `<div class="small muted">${esc(t.replacementNote)}</div>` : ''}</div>`).join('') : ''}
    ${buses.map(b => `<div class="card"><h4><span>🚌 Bus ${esc(b.ref)}</span><span class="pill ${b.status === 'Diverted' ? 'full' : 'lane'}">${esc(b.status.toLowerCase())}</span></h4>
      <div class="small">+${fmt(b.extraMin, 1)} min${b.extraKm ? `, +${fmt(b.extraKm, 2)} km` : ''} per trip${b.stops.size ? ` · stops skipped: ${[...b.stops].map(esc).join(', ')}` : ''}</div></div>`).join('')}
    ${!trams.length && !buses.length ? '<div class="note ok">No tram or bus routes run through the work zone.</div>' : `<p class="small muted">Passenger delay ≈ ${fmt(c.ptPax, 1)} equivalent passenger-hours per hour. Frequencies come from the PTV GTFS timetable and boardings per trip from DTP patronage; one third of passengers are assumed to cross the site (uniform trip ends).${[...trams, ...buses].some(x => x.unknownFreq) ? ' Some routes are not in the GTFS timetable and are not valued.' : ''}</p>`}

    </div>
    <div class="rtab" data-rtab="checks-eq">
    <h3>Equipment</h3>
    ${r.plan.items.some(i => i.shortfall) ? `<div class="note">Shortfalls: ${r.plan.items.filter(i => i.shortfall).map(i => `${esc(i.label)} (−${i.shortfall})`).join('; ')}</div>` : '<div class="note ok">Depot stock covers the full traffic management layout.</div>'}
    <p class="small">${r.plan.markers.length} signs/devices placed, ${r.plan.detours.length} signed detour(s), ${r.plan.vmsPlaced} VMS board(s). <a href="#" id="toEquip">Open equipment plan →</a></p>

    </div>
    <div class="rtab" data-rtab="cost">
    <h3 id="r-cost">Economic impact</h3>
    <table class="t"><tr><th>Cost item</th><th class="num">Per hour</th><th class="num">Over ${fmt(c.dur)} h</th></tr>
      ${ECON_LINES.filter(([key]) => key !== 'business' || c.businessValued).map(([key, lab]) => `<tr><td>${lab}</td><td class="num">${money(c.lines[key])}</td><td class="num">${money(c.lineTotals[key])}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${money(c.perHour)}</td><td class="num">${money(c.sum)}</td></tr>
    </table>
    <p class="muted small" style="margin-top:6px">June 2024 AUD (TfNSW EPV 2025.1, ATAP PV2/PV5). Every hour of the works is assumed to look like the analysis hour.
      Heavy vehicles are ${fmt(100 * r.env.base.vkt.hcv / Math.max(1, r.env.base.vkt.car + r.env.base.vkt.lcv + r.env.base.vkt.hcv), 1)}% of distance travelled (DTP counts, ${r.env.hv.counted} links).
      ${c.businessValued ? `Business trade uses your inputs: ${c.p.deter}% of ${fmt(r.footfall)} people/h × $${c.p.spend}.` : 'Business trade is not valued: there is no published standard. Enter a deterrence rate and spend in the Work zone tab to include it.'}
      ${c.sum < 0 ? `<br><b>A negative total is within model error</b> (equilibrium gap ${(r.res.gap * 100).toFixed(1)}%) and does not mean the works bring a benefit.` : ''}</p>

    <h3>Environment & community</h3>
    <div class="card"><div class="kv">
      <span>CO₂e</span><span>${signed((r.env.scen.co2 - r.env.base.co2) / 1000)} kg/h · ${signed(c.co2t, 2)} t total</span>
      <span>NOx (fleet average, per vkm)</span><span>${signed(c.noxKg, 2)} kg total</span>
      <span>PM2.5 (fleet average, per vkm)</span><span>${signed(c.pmKg, 3)} kg total</span>
      <span>Fuel</span><span>${signed(c.fuelL)} L total</span>
      <span>Network CO₂e change</span><span>${signed((r.env.scen.co2 / r.env.base.co2 - 1) * 100, 1)}%</span>
      <span>Extra traffic on local streets</span><span>${fmt(r.amenity.addedVkt)} veh‑km/h</span>
      <span>Footfall past the site</span><span>${r.footfall == null ? 'no count' : fmt(r.footfall) + ' people/h'}</span>
    </div>
    ${r.amenity.streets.length ? `<p class="small" style="margin:8px 0 2px"><b>Local streets taking diverted traffic</b></p><table class="t">${r.amenity.streets.slice(0, 6).map(st => `<tr><td>${esc(st.name)}</td><td class="num">${fmt(st.base)} → ${fmt(st.base + st.up)} veh/h</td></tr>`).join('')}</table>` : ''}
    ${r.amenity.nightNoise ? '<div class="note">Night works push traffic onto residential streets. Expect noise complaints, and consider EPA Victoria night-work guidance and resident notification.</div>' : ''}
    <p class="muted small" style="margin:6px 0 0">Fuel use comes from the ATAP PV2 speed-dependent model (car, LCV, heavy rigid) on each link's congested speed. CO₂-e uses NGA Factors 2025. NOx and PM2.5 use Australian fleet-average g/km (Smit 2014) and do not vary with speed.</p></div>

    </div>
    <div class="rtab" data-rtab="safety">
    <h3 id="r-safety">Road safety</h3>
    ${safetySection(r)}

    </div>
    <div class="rtab" data-rtab="checks">
    <h3 id="r-checks">Compliance and approvals</h3>
    ${complianceHtml(ch)}

    <h3>Model confidence</h3>
    <div class="card"><p class="small" style="margin:0 0 6px"><b>${esc(MODEL_NAME)}</b></p><div class="kv">
      <span>DTP count links used</span><span>${calib ? calib.n : 0}</span>
      ${calib ? `<span>Links within GEH 5</span><span>${Math.round(calib.gehOk * 100)}%</span><span>R² modelled vs observed</span><span>${calib.r2.toFixed(2)}</span>` : ''}
      <span>Baseline average speed</span><span>${fmt(base.summary.avgSpeed, 1)} km/h</span>
      <span>Equilibrium gap (baseline / scenario)</span><span>${(base.res.gap * 100).toFixed(1)}% / ${(r.res.gap * 100).toFixed(1)}%</span>
    </div>
    <p class="muted small" style="margin:6px 0 0">A common calibration target is GEH &lt; 5 on at least 85% of counted links.</p>
    </div>

    <div class="btnrow">
      <button class="btn" id="expGeo">Download plan (GeoJSON)</button>
      <button class="btn" id="expCsv">Link impacts (CSV)</button>
    </div>
    </div>`;
  // equipment summary belongs with the checks
  const eq = el.querySelector('[data-rtab="checks-eq"]'), chk = el.querySelector('[data-rtab="checks"]');
  chk.insertBefore(eq, chk.querySelector('h3:nth-of-type(2)') || null); eq.removeAttribute('class'); eq.removeAttribute('data-rtab');
  const showTab = id => {
    S.rtab = id;
    el.querySelectorAll('[data-rt]').forEach(b => { b.classList.toggle('on', b.dataset.rt === id); b.setAttribute('aria-selected', b.dataset.rt === id); });
    el.querySelectorAll('.rtab').forEach(p => p.hidden = p.dataset.rtab !== id);
    el.closest('.rp-body, .panes').scrollTop = 0;
  };
  el.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => showTab(b.dataset.rt));
  el.querySelectorAll('[data-rt-go]').forEach(a => a.onclick = e => { e.preventDefault(); showTab(a.dataset.rtGo); });
  showTab(S.rtab);
  setRP(S.rpOpen !== false);
  $('#toEquip').onclick = e => { e.preventDefault(); switchTab('equip'); };
  $('#saveCmp').onclick = saveComparison;
  $('#expGeo').onclick = exportGeoJSON;
  $('#expCsv').onclick = exportCSV;
  renderCompare();
  $('#expTmp').onclick = () => exportCouncilReport('tmp');
  $('#expTia').onclick = () => exportCouncilReport('tia');
}

// ---------------------------------------------------------------- animation
// Scheduled trams and buses for the animation: GTFS shapes clipped to the study area, scheduled speed, and the
// timetable headway for the analysis hour and day type.
function buildPT(r, view) {
  if (!S.ptShapes || !S.ptService) return null;
  const P = S.net.proj, per = PERIODS[r.period], day = per.day === 'weekend' ? 'sat' : 'wk';
  const R2 = (S.site.radius * 1.15) ** 2, routes = [];
  const closurePts = S.closures.flatMap(c => c.poly);
  const cut = new Set(view === 'scen' ? [...r.pt.tram.filter(t => /interrupted/.test(t.status)).map(t => 'tram|' + t.ref), ...r.pt.bus.filter(b => b.status === 'Diverted').map(b => 'bus|' + b.ref)] : []);
  for (const mode of ['tram', 'bus']) for (const [ref, dirs] of Object.entries(S.ptShapes[mode])) for (const [dir, sh] of Object.entries(dirs)) {
    const tph = S.ptService[mode]?.[ref]?.[day]?.[dir]?.[per.hour];
    if (!tph) continue;
    // longest run of the shape inside the study circle
    // densify (simplified shapes can have km-long straight segments) so the study-area clip is exact enough
    const xy = [];
    sh.pts.forEach((p, i) => { const q = P.fwd(p[0], p[1]); if (i) { const o = xy[xy.length - 1], n = Math.ceil(Math.hypot(q[0] - o[0], q[1] - o[1]) / 50); for (let k = 1; k < n; k++) xy.push([o[0] + (q[0] - o[0]) * k / n, o[1] + (q[1] - o[1]) * k / n]); } xy.push(q); });
    const inside = xy.map(p => p[0] ** 2 + p[1] ** 2 < R2);
    let best = null, a = -1;
    for (let i = 0; i <= xy.length; i++) {
      if (i < xy.length && inside[i]) { if (a < 0) a = i; continue; }
      if (a >= 0 && (!best || i - a > best[1] - best[0])) best = [a, i];
      a = -1;
    }
    if (!best || best[1] - best[0] < 2) continue;
    const seg = xy.slice(best[0], best[1]), cum = cumulativeLengths(seg), len = cum[cum.length - 1];
    let hide = null;
    if (cut.has(mode + '|' + ref)) {
      const near = [];
      for (let i = 0; i < seg.length; i++) if (closurePts.some(q => Math.hypot(q[0] - seg[i][0], q[1] - seg[i][1]) < 40)) near.push(cum[i]);
      if (near.length) hide = [Math.min(...near) - 80, Math.max(...near) + 80];
    }
    routes.push({ mode, ref, xy: seg, cum, len, kmh: sh.kmh, headway: 3600 / tph, phase: (ref.length * 97 + +dir * 431) % 997, hide, color: PT_COL[mode] });
  }
  const shuttles = view === 'scen' ? [...new Map(r.pt.tram.filter(t => t.replacementLL && t.replacementBuses).map(t => [t.ref, t])).values()].map(t => {
    const seg = t.replacementLL.map(ll => P.fwd(ll[0], ll[1])), cum = cumulativeLengths(seg);
    return { xy: seg, cum, len: cum[cum.length - 1], n: t.replacementBuses, oneWaySec: (t.replacementMin || 3) * 60, color: PT_COL.tram };
  }) : [];
  return { routes, shuttles };
}

function startAnimation() {
  const r = S.result;
  anim.load(S.net, r.micro.ctx, S.view, PERIODS[r.period].hour);
  anim.setPT(buildPT(r, S.view));
  $('#simbar').classList.remove('hidden');
  $('#dotScale').textContent = `${anim.vehicles} vehicles`;
  $('#clock').textContent = anim.clockLabel();
  anim.play(); $('#play').textContent = '⏸';
  updateLegend();
}
$('#play').onclick = () => { if (anim.running) { anim.pause(); $('#play').textContent = '▶'; } else { anim.play(); $('#play').textContent = '⏸'; } };
$$('#view button').forEach(b => b.onclick = () => {
  S.view = b.dataset.v;
  $$('#view button').forEach(x => x.classList.toggle('on', x === b));
  if (S.result) { const was = anim.running; anim.pause(); startAnimation(); if (!was) { anim.pause(); $('#play').textContent = '▶'; } styleNetwork(); }
});
$('#simSpeed').onchange = e => { anim.speed = +e.target.value; };
$('#colorBy').onchange = e => { anim.colorBy = e.target.value; anim.draw(); updateLegend(); };
$('#netMode').onchange = e => { S.netMode = e.target.value; if (!S.result && S.netMode !== 'class') toast('Run a simulation to see congestion and traffic change.'); styleNetwork(); };
$$('#layerbar input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => setLayer(cb.dataset.layer, cb.checked)));

// ---------------------------------------------------------------- compare
// One comparable record per option. Every option comes from the same network model and the same economic
// parameters, so the measures are like for like (the microsimulation runs only for the displayed run, so it is not used).
const COST_GROUPS = [
  ['time', 'Travel time', ['carTime', 'lcvTime', 'freight']], ['voc', 'Vehicle operating', ['voc']], ['pt', 'Public transport & walking', ['pt', 'ped']],
  ['env', 'Environment', ['carbon', 'airQual', 'noise']], ['other', 'Safety & business', ['safety', 'business']],
];
function snapshot(r, c, checks, extra = {}) {
  const trams = groupByRef(r.pt.tram).filter(t => /interrupted/.test(t.status)).map(t => t.ref);
  return {
    site: r.meta?.site || S.siteName, periodKey: r.period, period: PERIODS[r.period].label, dur: c.dur,
    treatment: (r.closures || []).map(x => `${CLOSURE_TYPES[x.type]}${x.label ? ` (${x.label})` : ''}`).join(' + '),
    cost: c.sum, perHour: c.perHour, dVHT: Math.max(0, r.kpi.dVHT), perAffected: Math.max(0, r.kpi.extraMinPerAffected), rerouted: r.rerouted,
    queue: r.kpi.maxQueue ? r.kpi.maxQueue.lengthM : 0, queueName: r.kpi.maxQueue?.name || '',
    trams, buses: groupByRef(r.pt.bus).map(b => b.ref), ptPax: c.ptPax || 0, ped: r.ped.affected ? r.ped.avgDetour : 0,
    localHot: r.amenity.hotspots, co2t: c.co2t, safety: c.lineTotals.safety || 0, business: c.lineTotals.business || 0,
    shortfalls: r.plan.items.filter(i => i.shortfall).map(i => `${i.label} −${i.shortfall}`), informed: r.informed, vms: `${r.plan.vmsPlaced}/${r.plan.vmsRequired}`,
    fails: checks.filter(x => x.status === 'fail').length, warns: checks.filter(x => x.status === 'warn').length,
    failText: checks.filter(x => x.status === 'fail').map(x => x.topic).join(', '),
    failList: checks.filter(x => x.status === 'fail' || x.status === 'stock').map(x => ({ topic: x.topic, finding: x.finding, rec: x.rec, stock: x.status === 'stock' })),
    warnList: [...new Map(checks.filter(x => x.status === 'warn').map(x => [x.topic, { topic: x.topic, rec: x.rec }])).values()],
    stockShort: checks.some(x => x.status === 'stock'),
    groups: Object.fromEntries(COST_GROUPS.map(([k, , keys]) => [k, keys.reduce((a, key) => a + (c.lineTotals[key] || 0), 0)])),
    ...cardFields(r, c, extra.closures),
    ...extra,
  };
}
function cardFields(r, c, closures) {
  const cls = closures || r.closures;
  const dir = cl => cl.type === 'full' || cl.type === 'shuttle' || cl.direction === 'both' ? 'Both directions' : cl.direction === 'ab' ? 'A → B' : 'B → A';
  const lanes = cl => cl.type === 'full' ? 'All' : cl.type === 'direction' ? 'All, one direction' : cl.type === 'shuttle' ? 'One lane, alternating' : `${cl.lanesClosed}`;
  const foot = cl => cl.footpath === 'open' ? 'Open' : cl.footpath === 'both' ? 'Closed, both sides' : `Closed, ${cl.footpath} side`;
  const pt = [...r.pt.tram, ...r.pt.bus], w = pt.reduce((a, t) => a + (t.paxPerHour || 0), 0);
  const ptDelay = pt.length ? (w ? pt.reduce((a, t) => a + (t.paxPerHour || 0) * (t.equivMin ?? t.extraMin ?? 0), 0) / w : pt.reduce((a, t) => a + (t.equivMin ?? t.extraMin ?? 0), 0) / pt.length) : 0;
  let risk = null;
  if (closures?.every(cl => cl.poly && cl.allLinks)) {
    const lv = impactRating(S.net, closures, r, approvals(S.net, closures, S.matches, r, null)).map(x => x.level);
    risk = lv.includes('High') ? 'High' : lv.includes('Medium') ? 'Medium' : 'Low';
  }
  return {
    biz: r.businesses ? r.businesses.n : null,
    zone: cls.map(cl => ({ street: cl.street || cl.label, treatment: CLOSURE_TYPES[cl.type], direction: dir(cl), lanes: lanes(cl), footpath: foot(cl),
      speed: cl.type === 'full' || cl.type === 'direction' ? null : Math.max(40, cl.speed || 40), length: cl.length })),
    radius: S.site?.radius, risk,
    pedMin: r.ped.affected ? r.ped.avgDetour / WALK_SPEED / 60 : 0,
    carExtraM: r.rerouted > 0 ? Math.max(0, r.kpi.dVKT) * 1000 / r.rerouted : 0,
    ptRefs: [...new Set(r.pt.tram.map(t => t.ref))], ptDelay,
    equipment: r.plan.items.filter(i => i.required).map(i => ({ key: i.key, label: i.label, qty: i.required, short: i.shortfall })),
    days: Math.max(1, Math.ceil(c.dur / 24)),
  };
}

function saveComparison() {
  const r = S.result; if (!r) return;
  const c = costs(r);
  const name = prompt('Name this option', `${r.closures.map(x => CLOSURE_TYPES[x.type]).join(' + ')} · ${PERIODS[r.period].label}`);
  if (name == null) return;
  S.saved.push(snapshot(r, c, complianceChecks(S.net, S.closures, r, r.base), { name, closures: S.closures.map(x => ({ ...x })) }));
  renderCompare(); switchTab('compare'); toast('Option saved for comparison.');
}
function renderCompare() {
  const el = $('#compareBody');
  if (!S.saved.length) {
    el.innerHTML = S.result ? '<p class="muted">No saved options yet.</p><button class="btn" id="saveCmpHere">Save the current run</button>' : '<p class="muted">No saved options yet. Run a simulation, then save it here or with <b>Save</b> in Results.</p>';
    $('#saveCmpHere')?.addEventListener('click', saveComparison);
    return;
  }
  const best = S.saved.reduce((a, b) => (b.cost < a.cost ? b : a));
  el.innerHTML = `${S.saved.length > 1 ? '<button class="btn primary" id="cmpSaved" style="width:100%">Compare side by side</button>' : '<p class="muted small">Save at least two runs to compare them side by side.</p>'}
    ${S.saved.map((s, i) => `<div class="card" style="${s === best && S.saved.length > 1 ? 'border-color:#16a34a;box-shadow:0 0 0 1px #16a34a' : ''}">
    <h4><span>${esc(s.name)}</span><span>${s === best && S.saved.length > 1 ? '<span class="pill" style="background:#dcfce7;color:#166534">lowest cost</span>' : ''} <button class="btn sm danger" data-del="${i}" aria-label="Remove">✕</button></span></h4>
    <div class="muted small">${esc(s.period)} · ${fmt(s.dur)} h · ${money(s.cost)} · ${s.fails ? `<span class="status-short">${s.fails} fail</span>` : '<span class="status-ok">passes</span>'}</div></div>`).join('')}
    ${S.saved.length > 1 ? '' : '<div class="btnrow"><button class="btn" id="saveCmpHere">Save the current run</button></div>'}`;
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { S.saved.splice(+b.dataset.del, 1); renderCompare(); });
  $('#saveCmpHere')?.addEventListener('click', saveComparison);
  $('#cmpSaved')?.addEventListener('click', () => openCompare(S.saved.map(x => ({ ...x, apply: () => applyOption(x.closures, x.periodKey), adjust: () => adjustOption(x.closures, x.periodKey) }))));
}

// ---------------------------------------------------------------- side-by-side comparison (modal)
// Categorical slots 1-5 of the validated reference palette (dataviz skill), fixed order, one per cost group.
const GROUP_COL = { time: '#2a78d6', voc: '#eb6834', pt: '#1baf7a', env: '#eda100', other: '#e87ba4' };
let cmpItems = [];
function closeCompare() { $('#cmpModal').classList.add('hidden'); }
$('#cmpClose').onclick = closeCompare;
$('#cmpModal').addEventListener('click', e => { if (e.target.id === 'cmpModal') closeCompare(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCompare(); });
$('#cmpCsv2').onclick = () => {
  const rows = [['Option', 'Time window', 'Treatment', 'Duration h', 'Total cost $', 'Cost per hour $', 'Extra veh-h per h', 'Delay per affected veh (min)', 'Rerouted veh/h', 'Longest queue m', 'Trams interrupted', 'Bus routes', 'PT passenger-h per h', 'Ped detour m', 'Local hotspots', 'CO2e t', 'Crash risk $', 'Shortfalls', 'Checks failed', 'Checks to confirm']];
  for (const s of cmpItems) rows.push([s.name, s.period, s.treatment, s.dur, s.cost.toFixed(0), s.perHour.toFixed(0), s.dVHT.toFixed(1), s.perAffected.toFixed(1), s.rerouted.toFixed(0), s.queue.toFixed(0), s.trams.join(' '), s.buses.join(' '), s.ptPax.toFixed(1), s.ped.toFixed(0), s.localHot, s.co2t.toFixed(2), s.safety.toFixed(0), s.shortfalls.join('; '), s.fails, s.warns]);
  download('work-zone-options.csv', rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
};
function openCompare(items) {
  cmpItems = items;
  const durs = new Set(items.map(s => s.dur)), sites = new Set(items.map(s => s.site));
  const minCost = Math.min(...items.map(s => s.cost));
  const RISK = { High: 'bad', Medium: 'warn', Low: 'ok' };
  const IC = {
    ped: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6l-3 7M12 13l3 7M8 10l4-2 4 2"/>',
    car: '<path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/>',
    pt: '<rect x="6" y="3" width="12" height="15" rx="3"/><path d="M6 11h12M9 21l1.5-3M15 21l-1.5-3"/><circle cx="9.5" cy="14.5" r=".6"/><circle cx="14.5" cy="14.5" r=".6"/>',
  };
  const icon = k => `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg>`;
  // lowest value in a row, across options (only marked when the options differ)
  const bestOf = get => { const v = items.map(get); const m = Math.min(...v); return v.every(x => x === v[0]) ? null : m; };
  const B = {
    pedMin: bestOf(s => s.pedMin), ped: bestOf(s => s.ped), perAffected: bestOf(s => s.perAffected), carExtraM: bestOf(s => s.carExtraM),
    rerouted: bestOf(s => s.rerouted), dVHT: bestOf(s => s.dVHT), queue: bestOf(s => s.queue), ptDelay: bestOf(s => s.ptDelay),
    perHour: bestOf(s => s.perHour), co2t: bestOf(s => s.co2t), safety: bestOf(s => s.safety), localHot: bestOf(s => s.localHot),
  };
  const row = (k, v, best) => `<dt>${k}</dt><dd${best ? ' class="best"' : ''}>${v}</dd>`;
  const num = (s, key, text) => row(text[0], text[1], B[key] != null && s[key] === B[key]);
  const plus = (v, unit, d = 0) => v >= (d ? 0.05 : 0.5) ? `+${fmt(v, d)} ${unit}` : `0 ${unit}`;
  const eqKeys = [...new Map(items.flatMap(s => s.equipment || []).map(e => [e.key, e.label])).entries()];
  const card = (s, i) => {
    const z = s.zone || [], z0 = z[0] || {}, eq = new Map((s.equipment || []).map(e => [e.key, e]));
    const low = s.cost === minCost && items.length > 1;
    return `<article class="oc${low ? ' is-low' : ''}">
      <header class="oc-h">
        <span class="oc-letter">${String.fromCharCode(65 + i)}</span>
        <div class="oc-hm"><div class="oc-name">${esc(s.name)}</div>
          <div class="oc-pills">${s.recommended ? '<span class="chip ok">Recommended</span>' : ''}${s.fails ? `<span class="chip bad" title="${esc(s.failText)}">${s.fails} need${s.fails > 1 ? '' : 's'} action</span>` : '<span class="chip ok">Ready</span>'}${s.stockShort ? '<span class="chip warn">Short on equipment stock · Call</span>' : ''}${s.warnList?.length ? `<span class="chip warn">${s.warnList.length} caution${s.warnList.length > 1 ? 's' : ''}</span>` : ''}</div></div>
      </header>
      <section><h5>Work zone</h5><dl class="oc-dl">
        ${row('Timing', esc(s.period.replace(/ \(.*\)$/, '')))}${row('Hours', esc((s.period.match(/\((.*)\)/) || [])[1] || '–'))}
        ${row('Treatment', esc(z.length > 1 ? z.map(x => x.treatment).join(' + ') : z0.treatment || s.treatment))}
        ${row('Direction', esc(z0.direction || '–'))}${row('Lanes closed', esc(z0.lanes || '–'))}${row('Footpath', esc(z0.footpath || '–'))}
        ${row('Speed past site', z0.speed ? `${z0.speed} km/h` : 'Closed')}${row('Length', z0.length ? `${fmt(z0.length)} m` : '–')}
        ${row('Duration', `${fmt(s.dur)} h`)}${row('Study radius', s.radius ? `${(s.radius / 1000).toFixed(1)} km` : '–')}
      </dl></section>
      <section><h5>Knock-on effect</h5>
        ${s.pillars ? `<div class="oc-pillars">${PILLARS.map(([k, lab]) => `<div class="oc-risk"><span>${esc(lab)}</span><span class="risk ${RISK[s.pillars[k].level]}" title="${esc(s.pillars[k].text)}"><i></i>${s.pillars[k].level}</span></div>`).join('')}</div>`
          : `<div class="oc-risk"><span>Risk level</span><span class="risk ${RISK[s.risk] || ''}"><i></i>${s.risk || 'n/a'}</span></div>`}
        <h6>${icon('ped')}Pedestrians</h6><dl class="oc-dl">
          ${num(s, 'pedMin', ['Detour time', plus(s.pedMin, 'min', 1)])}${num(s, 'ped', ['Detour distance', plus(s.ped, 'm')])}
          ${s.biz != null ? row('Businesses fronting site', `${s.biz}`) : ''}</dl>
        <h6>${icon('car')}Cars</h6><dl class="oc-dl">
          ${num(s, 'perAffected', ['Delay at the site', plus(s.perAffected, 'min', 1)])}${num(s, 'carExtraM', ['Extra distance', plus(s.carExtraM, 'm/veh')])}
          ${num(s, 'rerouted', ['Re-routed', `${fmt(s.rerouted)} veh/h`])}${num(s, 'dVHT', ['Network delay', plus(s.dVHT, 'veh-h/h')])}
          ${num(s, 'queue', ['Longest new queue', s.queue ? `${fmt(s.queue)} m` : 'none'])}</dl>
        <h6>${icon('pt')}Public transport</h6><dl class="oc-dl">
          ${row('Trams affected', s.ptRefs?.length ? esc(s.ptRefs.join(', ')) : 'none')}${row('Bus routes', s.buses.length ? `${s.buses.length}` : 'none')}
          ${num(s, 'ptDelay', ['<span title="Weighted by passengers; a cut tram counts two transfers to the replacement bus and the wait (TfNSW EPV transfer penalty)">Passenger delay (eq.)</span>', plus(s.ptDelay, 'min', 1)])}</dl>
      </section>
      <section><h5>Equipment needs</h5><dl class="oc-dl">${eqKeys.map(([k, label]) => { const e = eq.get(k);
        return row(esc(label.replace(/[“”"]/g, '').replace(/ \(.*\)$/, '')), e ? `${e.qty} × ${s.days} d${e.short ? ` <span class="short">−${e.short}</span>` : ''}` : '–'); }).join('')}</dl></section>
      <div class="oc-more"><section><h5>More detail</h5><dl class="oc-dl">
        ${num(s, 'perHour', ['Cost per hour', money(s.perHour)])}${num(s, 'co2t', ['CO₂e over the works', `${signed(s.co2t, 1)} t`])}
        ${num(s, 'safety', ['Crash risk cost', money(s.safety)])}${num(s, 'localHot', ['Local streets over 2× traffic', s.localHot || 'none'])}
        </dl></section></div>
      <section class="oc-checks"><h5>Evaluation</h5>
        ${s.failList?.length ? s.failList.map(f => `<div class="ck ${f.stock ? 'stock' : 'fail'}"><b>${esc(f.topic)}</b><span>${esc(f.finding)}</span>
          <span class="ck-fix"><b>Action:</b> ${f.stock ? salesLink() : esc(f.rec || '')}</span></div>`).join('') : '<div class="ck pass"><b>No action needed</b></div>'}
        ${s.warnList?.length ? `<div class="ck-sub">Need to validate on field (${s.warnList.length})</div><ul class="ck-list">${s.warnList.map(w => `<li title="${esc(w.rec || '')}">${esc(w.topic)}</li>`).join('')}</ul>` : ''}
      </section>
      <div class="oc-foot">
        ${s.community != null ? `<div class="oc-comm"><span>Community cost</span><b>${money(s.community)}</b></div>` : ''}
        <div class="oc-total"><span>${s.community != null ? 'Equipment & fees' : 'Total cost'}</span>${low ? '<em>Lowest</em>' : ''}<b>${money(s.cost)}</b></div>
        <div class="oc-acts">${s.adjust ? `<button class="btn" data-cmp-adjust="${i}">Adjust</button>` : ''}${s.apply ? `<button class="btn primary" data-cmp-apply="${i}">Choose</button>` : ''}</div>
      </div>
    </article>`;
  };
  const pos = s => COST_GROUPS.map(([k]) => Math.max(0, s.groups[k]));
  const maxBar = Math.max(...items.map(s => pos(s).reduce((a, b) => a + b, 0)), 1);
  const bars = items.map((s, i) => { const p = pos(s);
    return `<div class="cbrow"><div class="cblab">Option ${String.fromCharCode(65 + i)} · ${esc(s.name)}</div><div class="cbbar">${COST_GROUPS.map(([k, lab], j) => p[j] > 0 ? `<i style="width:${p[j] / maxBar * 100}%;background:${GROUP_COL[k]}" title="${esc(lab)}: ${money(s.groups[k])}"></i>` : '').join('')}</div><div class="cbval">${money(s.cost)}</div></div>`; }).join('');
  $('#cmpBody').innerHTML = `
    <p class="cmp-note">Same network model, economic values and depot stock for every option. <span class="best-key">Green</span> marks the lowest value in a row. ${durs.size > 1 ? '<b class="warn">Works durations differ; compare the cost per hour.</b> ' : ''}${sites.size > 1 ? '<b class="warn">The options are at different sites.</b>' : ''}</p>
    <div class="oc-grid" style="grid-template-columns:repeat(${items.length}, minmax(240px, 1fr))">${items.map(card).join('')}</div>
    <details class="fold cmp-cost"><summary>Where the cost comes from</summary>
      <div class="cblegend">${COST_GROUPS.map(([k, lab]) => `<span><i style="background:${GROUP_COL[k]}"></i>${lab}</span>`).join('')}</div>
      <div class="cb">${bars}</div>
      <p class="muted small" style="margin-top:10px">Total economic cost over the works, June 2024 AUD. Hover a segment for its value. Negative items are left out of the bars and included in the totals.</p>
    </details>`;
  const body = $('#cmpBody');
  body.querySelectorAll('[data-cmp-apply]').forEach(b => b.onclick = () => items[+b.dataset.cmpApply].apply());
  body.querySelectorAll('[data-cmp-adjust]').forEach(b => b.onclick = () => items[+b.dataset.cmpAdjust].adjust());
  $('#cmpModal').classList.remove('hidden');
  $('#cmpClose').focus();
}

// ---------------------------------------------------------------- exports
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function exportGeoJSON() {
  const r = S.result, g = S.net.veh, feats = [];
  const line = (ll, props) => feats.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: ll.map(p => [p[1], p[0]]) } });
  for (const c of S.closures) for (const lid of c.allLinks) line(g.links[lid].ll, { layer: 'work_zone', street: c.street, treatment: CLOSURE_TYPES[c.type], direction: c.direction, lanes_closed: c.lanesClosed, footpath: c.footpath });
  for (const d of r.plan.detours) line(d.ll, { layer: 'detour', direction: d.dir, length_m: Math.round(d.len) });
  for (const l of r.plan.lines) line(l.ll, { layer: l.kind, count: l.count || null });
  for (const mk of r.plan.markers) feats.push({ type: 'Feature', properties: { layer: 'device', item: mk.item, text: mk.text, note: mk.sub || '', missing_stock: !!mk.missing }, geometry: { type: 'Point', coordinates: [mk.ll[1], mk.ll[0]] } });
  download('work-zone-plan.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 1), 'application/geo+json');
}

function exportCSV() {
  const r = S.result, g = S.net.veh;
  const rows = [['link_id', 'street', 'class', 'baseline_veh_h', 'scenario_veh_h', 'change_veh_h', 'vc_baseline', 'vc_scenario', 'co2e_change_kg_h', 'lat', 'lon']];
  for (const x of r.links) {
    if (Math.abs(x.delta) < 1 && x.base < 1) continue;
    const Lk = g.links[x.id], mid = Lk.ll[Lk.ll.length >> 1];
    rows.push([x.id, Lk.name, Lk.cls, x.base.toFixed(0), x.scen.toFixed(0), x.delta.toFixed(0), x.vcBase.toFixed(2), x.vcScen.toFixed(2), (r.env.linkDCO2[x.id] / 1000).toFixed(2), mid[0].toFixed(6), mid[1].toFixed(6)]);
  }
  download('link-impacts.csv', rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}

async function aerialImage(net, closures) {
  // north-up aerial around the work zone for the TGS inset (Esri World Imagery export; CORS enabled)
  const pts = closures.flatMap(c => c.poly);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const span = Math.max(220, ...pts.map(p => Math.hypot(p[0] - cx, p[1] - cy) * 2.6));
  const a = net.proj.inv(cx - span / 2, cy - span * 0.375), b = net.proj.inv(cx + span / 2, cy + span * 0.375);
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${a[1]},${a[0]},${b[1]},${b[0]}&bboxSR=4326&imageSR=3857&size=840,630&format=jpg&f=image`;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

async function exportCouncilReport(doc) {
  const r = S.result; if (!r) return;
  const w = window.open('', '_blank');
  const app = appDetails();
  const aerial = await aerialImage(S.net, S.closures);
  const html = councilReport({
    net: S.net, closures: S.closures, r, c: costs(r), meta: closureMeta, app, matches: S.matches,
    checks: complianceChecks(S.net, S.closures, r, r.base), appr: approvals(S.net, S.closures, S.matches, r, app.start, econParams().duration),
    options: S.explore, inventory: S.inventory, siteName: S.siteName, fetchedAt: S.fetchedAt,
    CLOSURE_TYPES, groupByRef, aerial, logo: S.logo,
  }, doc);
  if (w) { w.document.write(html); w.document.close(); } else download(doc === 'tia' ? 'traffic-impact-assessment.html' : 'traffic-management-plan.html', html, 'text/html');
}

// ---------------------------------------------------------------- search (Nominatim)
let searchT = null;
$('#search').addEventListener('input', e => {
  clearTimeout(searchT);
  const q = e.target.value.trim();
  if (q.length < 3) { $('#searchResults').innerHTML = ''; return; }
  searchT = setTimeout(async () => {
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=au&viewbox=144.3,-37.35,145.95,-38.55&bounded=1&q=${encodeURIComponent(q)}`;
      const res = await (await fetch(u, { headers: { 'Accept-Language': 'en-AU' } })).json();
      $('#searchResults').innerHTML = res.map(r => `<div data-lat="${r.lat}" data-lon="${r.lon}">${esc(r.display_name)}</div>`).join('') || '<div class="muted">No matches in Greater Melbourne</div>';
      $$('#searchResults div[data-lat]').forEach(d => d.onclick = () => {
        $('#searchResults').innerHTML = ''; $('#search').value = d.textContent.split(',').slice(0, 2).join(',');
        loadSite(+d.dataset.lat, +d.dataset.lon, +$('#radius').value, d.textContent.split(',').slice(0, 2).join(','));
      });
    } catch { $('#searchResults').innerHTML = '<div class="muted">Search unavailable</div>'; }
  }, 450);
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#searchResults').innerHTML = ''; });

// ---------------------------------------------------------------- standards & sources table
const STATUS_LABEL = { verified: ['verified', 'ok'], derived: ['derived', 'ok'], secondary: ['via supplement', 'lane'], assumption: ['assumption', 'full'] };
function standardsTable(plain = false) {
  const rows = PARAMETERS.map(([grp, name, val, unit, src, status]) => {
    const so = src ? SOURCES[src] : null;
    const [lab, cls] = STATUS_LABEL[status];
    const cite = so ? (plain ? `${esc(so.title)}, ${esc(so.url)}` : `<a href="${so.url}" target="_blank" rel="noopener" title="${esc(so.title)}">${esc(so.short)}</a>`) : '-';
    return `<tr><td>${esc(grp)}</td><td>${esc(name)}</td><td>${esc(String(val))}${unit ? ' ' + esc(unit) : ''}</td><td>${cite}</td><td>${plain ? lab : `<span class="pill ${cls === 'ok' ? '' : cls}">${lab}</span>`}</td></tr>`;
  }).join('');
  return `<table class="${plain ? '' : 't std'}"><tr><th>Area</th><th>Parameter</th><th>Value</th><th>Source</th><th>Status</th></tr>${rows}</table>`;
}

// ---------------------------------------------------------------- boot
$('#period').innerHTML = Object.entries(PERIODS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
fetch('data/dtp_signals.json').then(r => r.json()).then(j => { S.dtpSignals = j; }).catch(() => toast('DTP signal register could not be loaded; OSM signals are used instead.', true));
fetch('data/crashes.json').then(r => r.json()).then(j => { S.crashData = j; if (S.net) { loadCrashes(); drawCrashes(); renderNetStats(); } })
  .catch(() => { S.crashData = false; setSrc('crash', 'unavailable', 'err'); toast('Crash data could not be loaded; road safety is not assessed.', true); });
fetch('api/ai-status').then(r => r.json()).then(j => { S.aiEnabled = !!j.enabled; }).catch(() => { S.aiEnabled = false; });
fetch('assets/logo.png').then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); })).then(d => { S.logo = d; }).catch(() => {});
fetch('data/pt_shapes.json').then(r => r.json()).then(j => { S.ptShapes = j; }).catch(() => {});
fetch('data/pt_service.json').then(r => r.json()).then(j => { S.ptService = j; }).catch(() => toast('PT timetable data could not be loaded, PT delays will not be valued.', true));
renderPresets(); renderInventory(); renderClosures(); renderCompare(); updateLegend();
setWindow('day'); switchTab('input');
if (/[?&]role=rpm\b/.test(location.search)) document.body.classList.add('rpm');
L.rectangle([[-38.55, 144.3], [-37.35, 145.95]], { color: '#03080B', weight: 1, fill: false, dashArray: '4 6', interactive: false }).addTo(layers.study);
// handle for debugging / automated tests in the browser console
window.workZoneSim = { map, state: S, anim };
