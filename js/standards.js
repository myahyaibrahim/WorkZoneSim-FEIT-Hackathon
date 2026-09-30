// Single source of every calculation parameter, each with its published basis.
// status: 'verified' , value read from the cited document (or an official supplement reproducing it)
//         'derived'  , computed here from verified inputs (method stated)
//         'secondary', confirmed only via a report that reproduces the original table
//         'assumption': no published standard found; stated modelling assumption, shown to the user
// Prices are June 2024 AUD unless noted.

export const SOURCES = {
  tfnsw:  { short: 'TfNSW EPV 2025.1', title: 'Transport for NSW Economic Parameter Values, Version 2025.1 (Jan 2025)', url: 'https://www.transport.nsw.gov.au/system/files/media/documents/2025/tfnsw-economic-parameter-values-jan-2025.pdf' },
  pv2:    { short: 'ATAP PV2', title: 'ATAP Guidelines PV2 Road Parameter Values (2016, June 2013 prices)', url: 'https://www.atap.gov.au/sites/default/files/pv2_road_parameter_values.pdf' },
  pv5:    { short: 'ATAP PV5', title: 'ATAP Guidelines PV5 Environmental Parameter Values (May 2024, June 2023 prices)', url: 'https://www.atap.gov.au/sites/default/files/documents/pv5-multi-modal-update-20240522.pdf' },
  nga:    { short: 'NGA Factors 2025', title: 'Australian National Greenhouse Accounts Factors 2025 (DCCEEW)', url: 'https://www.dcceew.gov.au/sites/default/files/documents/national-greenhouse-account-factors-2025.pdf' },
  npi:    { short: 'Smit 2014 (NPI)', title: 'Australian Motor Vehicle Emission Inventory for the National Pollutant Inventory, R. Smit, Aug 2014', url: 'https://www.dcceew.gov.au/sites/default/files/documents/australian-motor-vehicle-emissions-inventory-2014_0.pdf' },
  akcelik:{ short: 'Akçelik 1991', title: 'Akçelik R. (1991) Travel time functions for transport planning purposes, Australian Road Research 21(3); table as reproduced in FDOT BC-791 Vol. II (2003) Table 2.1', url: 'https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/research/reports/fdot-bc791-v2-rpt.pdf' },
  agtm3:  { short: 'Austroads AGTM Pt 3', title: 'Austroads Guide to Traffic Management Part 3, Table 6.1 mid-block capacity (as reproduced in ACT TTA Appendix G)', url: 'https://www.planning.act.gov.au/__data/assets/pdf_file/0009/2348199/Appendix-G-Traffic-and-Transport-Assessment.pdf' },
  mmdg:   { short: 'VicRoads MMDG', title: 'VicRoads Managed Motorway Design Guide Vol 1 Part 3 Motorway Capacity Guide v1.1 (Oct 2019)', url: 'https://www.mainroads.wa.gov.au/4a45b7/globalassets/technical-commercial/technical-library/road-and-traffic-engineering/smart-freeways/dot-vic-reference-document-managed-motorway-design-guide-mmdg-volume-1-role-traffic-theory-science-for-optimisation-part-3-motorway-capacity-guide-vicroads-version-1.1-october-2019.pdf' },
  hcm:    { short: 'HCM 6th Ed. Ch.10', title: 'Highway Capacity Manual 6th Ed. (2016) Ch.10 work zone capacity, as restated by InTrans/Iowa State (2020) §3.1.1', url: 'https://www.intrans.iastate.edu/wp-content/uploads/2020/07/adjustment_factors_for_HCM_freeway_wz_capacity_w_cvr.pdf' },
  qgttm:  { short: 'QGTTM Pt 3 (2025)', title: 'Queensland Guide to Temporary Traffic Management Part 3: Static Worksites (Nov 2025), supplement reproducing AGTTM Part 3 tables', url: 'https://www.tmr.qld.gov.au/_/media/busind/techstdpubs/traffic-management/qgttm/qgttm-part-3.pdf' },
  tn195:  { short: 'TMR TN195', title: 'Qld TMR Technical Note TN195 Traffic Guidance Scheme worked examples (Dec 2021)', url: 'https://www.tmr.qld.gov.au/-/media/busind/techstdpubs/Technical-notes/Traffic-engineering/TN195.pdf' },
  viccode:{ short: 'Vic Worksite Code 2023', title: 'Code of Practice for Worksite Safety – Traffic Management, Victoria Government Gazette S280 (1 June 2023)', url: 'https://www.gazette.vic.gov.au/gazette/Gazettes2023/GG2023S280.pdf' },
  roadrules:{ short: 'Road Safety Road Rules 2017 (Vic)', title: 'Road Safety Road Rules 2017 (Vic), r.25 default speed limits', url: 'https://www.legislation.vic.gov.au/in-force/statutory-rules/road-safety-road-rules-2017' },
  walk:   { short: 'Truong et al. ATRF 2018', title: 'Walking speeds for timing of pedestrian walk and clearance intervals, ATRF 2018 (citing Austroads 2016)', url: 'https://australasiantransportresearchforum.org.au/wp-content/uploads/2022/03/ATRF2018_paper_22.pdf' },
  vms:    { short: 'Erke et al. 2007', title: 'Erke, Sagberg & Hagman (2007) Effects of route guidance VMS on driver behaviour, Transp. Res. Part F 10(6), incl. review of Ramsay & Luk (1997, Australia)', url: 'https://www.sciencedirect.com/science/article/abs/pii/S1369847807000150' },
  nav:    { short: 'Starkey & Charlton 2020', title: 'Starkey & Charlton (2020) Frontiers in Sustainable Cities, doi:10.3389/frsc.2020.00039', url: 'https://doi.org/10.3389/frsc.2020.00039' },
  dtp:    { short: 'DTP Traffic Volume', title: 'Transport Victoria (DTP) Traffic Volume open data, AADT, heavy vehicle AADT, AM/PM peak hour (CC BY 4.0)', url: 'https://discover.data.vic.gov.au/dataset/traffic-volume' },
  signals:{ short: 'DTP Victorian Traffic Signals', title: 'Department of Transport and Planning, Victorian Traffic Signals register (CC BY 4.0), modified 12 Aug 2026', url: 'https://opendata.transport.vic.gov.au/dataset/victorian-traffic-signals' },
  scats:  { short: 'DTP SCATS Aug 2026', title: 'Transport Victoria Traffic Signal Volume Data (SCATS), August 2026, 4,508 sites, 1.17M detector-days (CC BY 4.0)', url: 'https://opendata.transport.vic.gov.au/dataset/traffic-signal-volume-data' },
  gtfs:   { short: 'PTV GTFS Schedule', title: 'Transport Victoria GTFS Schedule, feed 24 Sep–27 Dec 2026 (CC BY 4.0)', url: 'https://opendata.transport.vic.gov.au/dataset/gtfs-schedule' },
  patron: { short: 'DTP patronage by day type', title: 'Monthly average patronage by day type and by mode, Apr 2025–Mar 2026 (CC BY 4.0)', url: 'https://opendata.transport.vic.gov.au/dataset/monthly-average-patronage-by-day-type-and-by-mode' },
  crash:  { short: 'DTP road crash data', title: 'Department of Transport and Planning, Victoria road crash data, 2012 to 2025 (CC BY 4.0), modified 14 Sep 2026', url: 'https://opendata.transport.vic.gov.au/dataset/victoria-road-crash-data' },
  com:    { short: 'CoM Pedestrian Counting', title: 'City of Melbourne Pedestrian Counting System (90-day hourly averages)', url: 'https://data.melbourne.vic.gov.au/explore/dataset/pedestrian-counting-system-monthly-counts-per-hour/' },
};

// ---------------------------------------------------------------- traffic flow
// Akçelik link types: J by link type (Akçelik 1991). Mid-block capacity per lane for interrupted urban roads
// from AGTM Part 3 Table 6.1 (900 pc/h/lane kerb lane beside parking / undivided); high-friction local streets
// use Akçelik "secondary, high friction" 600 veh/h/lane; freeways use VicRoads MMDG MSFR (3,625 veh/h for a
// 2-lane carriageway = 1,810/lane).
export const LINK_TYPES = {
  freeway:        { capLane: 1810, J: 0.1, src: 'mmdg', J_src: 'akcelik', label: 'Freeway (MMDG MSFR 2-lane carriageway ÷ 2; J Akçelik freeway)' },
  ramp:           { capLane: 1800, J: 0.2, src: 'akcelik', label: 'Arterial, uninterrupted (Akçelik)' },
  arterial:       { capLane: 900,  J: 0.4, src: 'agtm3', J_src: 'akcelik', label: 'Arterial, interrupted (AGTM 3 Table 6.1; J Akçelik)' },
  collector:      { capLane: 900,  J: 0.8, src: 'agtm3', J_src: 'akcelik', label: 'Secondary, interrupted (AGTM 3 Table 6.1; J Akçelik)' },
  local:          { capLane: 600,  J: 1.6, src: 'akcelik', label: 'Secondary, high friction (Akçelik)' },
};
export const OSM_LINK_TYPE = {
  motorway: 'freeway', motorway_link: 'ramp', trunk: 'arterial', trunk_link: 'arterial', primary: 'arterial', primary_link: 'arterial',
  secondary: 'collector', secondary_link: 'collector', tertiary: 'collector', tertiary_link: 'collector',
  unclassified: 'local', residential: 'local', living_street: 'local',
};
// Default speed where OSM has no maxspeed: Victorian default built-up limit 50 km/h, otherwise 100 km/h (r.25);
// shared zones (living_street) are signed 10 km/h in Victoria.
export const DEFAULT_SPEED = { builtUp: 50, freeway: 100, sharedZone: 10 };
// Lanes per direction where OSM has no lanes tag (modelling default, not a standard).
export const DEFAULT_LANES = { motorway: 3, trunk: 2, primary: 2, secondary: 2 };
export const ANALYSIS_PERIOD_H = 1; // Akçelik Tf, one-hour analysis period

// Hour-of-day share of AADT, derived from DTP SCATS August 2026 (weekday = Mon–Fri mean, weekend = Sat–Sun mean,
// each divided by the all-day mean). Used for off-peak/night/weekend demand where DTP gives only AM/PM peaks.
export const HOUR_SHARE = {
  weekday: [0.0074, 0.0048, 0.0039, 0.0043, 0.0083, 0.0229, 0.0448, 0.0626, 0.0769, 0.0627, 0.0568, 0.0583, 0.0607, 0.0615, 0.0677, 0.0775, 0.0790, 0.0783, 0.0619, 0.0440, 0.0357, 0.0305, 0.0225, 0.0143],
  weekend: [0.0159, 0.0108, 0.0079, 0.0064, 0.0063, 0.0090, 0.0160, 0.0233, 0.0360, 0.0515, 0.0614, 0.0677, 0.0712, 0.0691, 0.0670, 0.0653, 0.0630, 0.0616, 0.0515, 0.0398, 0.0331, 0.0292, 0.0242, 0.0180],
};

// ---------------------------------------------------------------- work zones
// Freeway/uninterrupted lane closure capacity: HCM 6 queue discharge rate, pc/h/ln.
export function hcmWorkZoneCapacity(openLanes, totalLanes, { barrier = false, night = false } = {}) {
  const OR = openLanes / totalLanes, LCSI = 1 / (OR * openLanes);
  const qdr = 2093 - 154 * LCSI - 194 * (barrier ? 0 : 1) - 179 * 0 + 9 * 0 - 59 * (night ? 1 : 0);
  return qdr * 100 / (100 - 13.4);
}
// Stop/Slow single-lane operation: QGTTM Part 3 Table 5.4 maximum single-lane length for a two-way volume.
// Read inversely as the maximum two-way volume a shuttle of a given length can be operated at.
export const SHUTTLE_MAX = [[70, 800], [100, 700], [150, 600], [250, 500], [400, 400], [600, 350], [800, 300]];
export function shuttleCapacity(lengthM) {
  for (const [L, v] of SHUTTLE_MAX) if (lengthM <= L) return v;
  return null; // longer than 800 m: not permitted as a Stop/Slow shuttle
}
// Lanes that must stay open: QGTTM Part 3 Table 2.4 (veh/h per direction per open lane).
export const LANE_NEED = { midblock: 1000, nearIntersection: 500 };
// Advance warning sign spacing D (QGTTM Pt 3 Table 2.2): ≤55 km/h 15 m, 56–65 km/h 45 m, ≥66 km/h D = speed.
export const signSpacingD = v => v <= 55 ? 15 : v <= 65 ? 45 : v;
// Merge taper: 60 m at 60 km/h, lateral shift 3.5 m at 100 km/h needs 100 m (TN195 Note 12) → L ≈ V × shift / 3.5.
export const taperLength = (v, shift) => Math.max(v, 30) * shift / 3.5;
// Cone spacing: max 4 m in 40 km/h zones, 12 m at 60 km/h (TN195 Notes 3, 27). Above 60 km/h not verified → 12 m.
export const coneSpacing = v => v <= 40 ? 4 : 12;
// Minimum clearance between a road safety barrier and the nearest traffic lane (QGTTM Pt 3 Table 5.1, p. 38).
export const barrierClearance = v => v <= 40 ? 0.3 : v <= 80 ? 0.5 : 1.0;
// Lane width when DTP traffic width is not available.
export const DEFAULT_LANE_WIDTH = 3.5;
// Queue storage per vehicle (SIDRA INTERSECTION default: light 7.0 m, heavy 13.0 m).
export const QUEUE_SPACE = { light: 7.0, heavy: 13.0 };

// ---------------------------------------------------------------- microsimulation
// IDM parameters for city traffic (Treiber & Kesting 2013, Traffic Flow Dynamics, Table 11.2: T 1.0 s, s0 2 m,
// b 1.5 m/s², δ 4). Acceleration a is calibrated, not taken from the table (a = 1.0): with a = 1.0 a standing queue
// discharges at 1,714 veh/h/lane (2.10 s headway), below the 1,900 pc/h/lane saturation flow the signal plans are
// timed for; a = 1.5 gives 1,870 veh/h/lane (1.93 s, dt 0.5 s), consistent with it.
// Heavy vehicles: longer headway, lower acceleration (assumption, same source's truck set).
// MOBIL: politeness 0.2, threshold 0.1 m/s², safe braking 4 m/s² (Kesting, Treiber & Helbing 2007).
// Signals: Webster (1958) C0 = (1.5L + 5)/(1 − Y); base saturation flow 1900 pc/h/lane (HCM 6th ed.).
// Minimum cycle 60 s (assumption): Webster's minimum-delay cycle for isolated signals falls to 40 s at modelled
// demand, but coordinated SCATS arterials run longer cycles; results are insensitive between 60 and 120 s.
// Unsignalised: critical headway 6.5 s for a minor-street movement (HCM 6th ed. Ch. 20 base value).
export const MICRO = {
  dt: 0.5, warmup: 900, measure: 3600,
  car: { T: 1.0, s0: 2, a: 1.5, b: 1.5, len: 4.5 },
  heavy: { T: 1.5, s0: 2, a: 0.6, b: 1.2, len: 12 },
  mobil: { politeness: 0.2, threshold: 0.1, bSafe: 4, mandatoryBias: 3 },
  mergeDistance: 250, laneChangeCooldown: 3,
  satFlow: 1900, lostTimePerPhase: 4, cycleMin: 60, cycleMax: 120, minGreen: 7,
  criticalHeadway: 6.5, teleportTime: 300, junctionLink: 30, amber: 3,
};

// Level of service at signalised intersections by average control delay (s/veh), HCM 6th ed. Exhibit 19-8 (also the
// delay-based LOS in SIDRA): A ≤ 10, B ≤ 20, C ≤ 35, D ≤ 55, E ≤ 80, F > 80 or degree of saturation > 1.
export const LOS_SIGNAL = [[10, 'A'], [20, 'B'], [35, 'C'], [55, 'D'], [80, 'E']];
export const levelOfService = (delay, dos = 0) => dos > 1 ? 'F' : (LOS_SIGNAL.find(([d]) => delay <= d) || [0, 'F'])[1];

// ---------------------------------------------------------------- driver information
// Informed (early-diverting) share = 1 − (1 − nav)(1 − vms × coverage).
//  nav: share of drivers following navigation directions, 64% (Starkey & Charlton 2020, n = 1,017); only counts
//       when the closure is published in advance (VicTraffic / navigation data feeds = "pre-notification").
//  vms: extra diversion when a VMS announces a road blockage, +30% (Ramsay & Luk 1997, Australia, via Erke et al. 2007;
//       literature range 5–40%).
export const INFO = { nav: 0.64, vms: 0.30, vmsRange: [0.05, 0.40] };

// ---------------------------------------------------------------- pedestrians
export const WALK_SPEED = 1.2; // m/s design walking speed (Austroads 2016 via Truong et al. 2018)

// ---------------------------------------------------------------- public transport
// Boardings per trip = average daily patronage (Apr 2025–Mar 2026) ÷ GTFS trips on a normal weekday/Saturday.
export const PT_LOAD = {
  tram: { weekday: 457723 / 5044, weekend: 415445 / 4255 },   // 90.7 / 97.6
  bus:  { weekday: 380991 / 27709, weekend: 200380 / 17022 }, // 13.7 / 11.8 (denominator includes regional town buses)
};
// Share of a service's passengers whose trip crosses the work zone: with trip ends uniformly distributed along the
// route, the share crossing a point at relative position p is 2p(1−p); averaged over an unknown p this is 1/3.
export const THROUGH_SHARE = 1 / 3;
export const TRANSFER_PENALTY_MIN = 10; // ATAP, different-mode transfer, equivalent in-vehicle minutes (TfNSW EPV Table 2.7)
export const MULT = { walk: 1.5, wait: 1.4, transferWait: 1.5 }; // TfNSW EPV Table 2.6 (multipliers on in-vehicle time)

// ---------------------------------------------------------------- economics (June 2024 AUD)
export const VTT = { car: 34.46, lcv: 42.25, hcv: 72.06, person: 20.62 }; // $/veh-h urban (TfNSW EPV Table 2.2); $/person-h private (Table 2.1)
export const LCV_SHARE_OF_LIGHT = 16 / 94; // TfNSW EPV Table 2.5 urban vkm mix: car 78%, LCV 16%, HCV 6% (Sydney proxy)
// ATAP PV2 Tables 35 (VOC, c/km, June 2013) and 36 (fuel, L/100 km). Stop-start c = A + B/V for V < 60 km/h;
// free-flow c = C0 + C1·V + C2·V² for V ≥ 60 km/h. Representative vehicles: 02 Medium Car, 04 Courier Van-Utility, 08 Heavy Rigid.
export const VOC_MODEL = {
  car: { voc: [12.6514, 1315.5178, 35.0470, -0.1751, 0.0012], fuel: [8.8017, 179.6890, 9.8014, -0.0785, 0.0008], fuelType: 'petrol' },
  lcv: { voc: [15.9354, 1357.1233, 38.4920, -0.1840, 0.0014], fuel: [8.0758, 226.1850, 10.8957, -0.1125, 0.0011], fuelType: 'dieselLV' },
  hcv: { voc: [57.1600, 2556.0769, 82.2900, -0.5525, 0.0053], fuel: [45.5089, 535.1584, 32.0378, -0.2949, 0.0040], fuelType: 'dieselHV' },
};
// Index June 2013 → June 2024: TfNSW EPV Table 3.3 medium car at 50 km/h = 50.48 c/km vs ATAP 12.6514 + 1315.5178/50 = 38.96.
export const VOC_INDEX_2013_2024 = 50.48 / (12.6514 + 1315.5178 / 50);
export const VOC_MIN_SPEED = 5; // TfNSW EPV Table 3.1: speeds below 5 km/h are set to 5 km/h
// NGA Factors 2025 Table 9, scope 1: energy content × combined factor (kg CO2-e per litre)
export const CO2E_PER_L = { petrol: 34.2 * 67.62 / 1000, dieselLV: 38.6 * 70.41 / 1000, dieselHV: 38.6 * 70.37 / 1000 };
// Fleet-average exhaust emission factors, Australia (2010 fleet), g per vehicle-km, not speed-dependent (Smit 2014 §5).
export const FLEET_EF = { nox: 1.3, pm25: 0.049 };
// Externality costs, c per vkm, urban (June 2024): air pollution TfNSW EPV Tables 6.5/6.7 (rigid used for heavy);
// noise ATAP PV5 Table 5-1 per 1000 vkt (June 2023) × 1.04, the PV5→TfNSW indexation implied by the car values (0.78 → 0.81).
export const PV5_TO_2024 = 0.81 / 0.78;
export const EXTERNAL_C_PER_VKM = {
  air:   { car: 1.03, lcv: 2.92, hcv: 8.39 },
  noise: { car: 0.81, lcv: 0.99 * PV5_TO_2024, hcv: 5.11 * PV5_TO_2024 },
};
// Carbon: ATAP PV5 Table 4-1 central value FY2026 $76/t (June 2023) indexed to June 2024.
export const CARBON_PER_T = 76 * PV5_TO_2024;

// ---------------------------------------------------------------- road safety
// Observed crash rates: DTP injury crashes 2019 and 2021–2024 (2020 lockdown year and the incomplete 2025 excluded),
// matched to the nearest road link, divided by modelled exposure (hourly flow ÷ SCATS hour share × 365 × years).
// Rates are pooled by road type (TfNSW Table 5.1 categories) because a single street has too few crashes.
// Cost per crash: TfNSW EPV Table 5.2 inclusive willingness-to-pay, urban, June 2024. Victorian "other injury"
// (injured, not admitted to hospital) spans the TfNSW moderate and minor classes; the lower (minor) value is used.
// Where a road type has fewer than minCrashes in the study area, TfNSW Table 5.1 average $/mvkt is used instead.
export const CRASH = {
  years: [2019, 2021, 2022, 2023, 2024],
  matchDist: 20,                                                   // m, crash point to road centreline
  minCrashes: 10,
  costPerCrash: { 1: 9363016, 2: 610137, 3: 94120 },               // fatal / serious injury / other injury ($, urban)
  avgCostPerMvkt: { local: 105122, arterial: 76548, freeway: 23856 }, // TfNSW Table 5.1 urban, all crashes
};
// OSM road class -> TfNSW Table 5.1 road type
// Signed detour: links with a fatal, serious, pedestrian or cyclist injury crash on record cost this much more in the
// detour search, so the signed route avoids them where a comparable alternative exists (assumption).
export const CRASH_DETOUR_PENALTY = 1.6;
export const CRASH_ROAD_TYPE = cls => /^motorway/.test(cls) ? 'freeway' : /^(trunk|primary|secondary)/.test(cls) ? 'arterial' : 'local';

// ---------------------------------------------------------------- catalogue for the UI / report
const f = (v, d = 2) => Number(v).toFixed(d);
export const PARAMETERS = [
  ['Traffic', 'Link delay function', 'Akçelik time-dependent function, T = 1 h', '', 'akcelik', 'secondary'],
  ['Traffic', 'Freeway lane capacity', LINK_TYPES.freeway.capLane, 'veh/h/lane', 'mmdg', 'verified'],
  ['Traffic', 'Arterial / collector mid-block capacity', LINK_TYPES.arterial.capLane, 'pc/h/lane', 'agtm3', 'secondary'],
  ['Traffic', 'Local street capacity (high friction)', LINK_TYPES.local.capLane, 'veh/h/lane', 'akcelik', 'secondary'],
  ['Traffic', 'Akçelik J: freeway / ramp / arterial / collector / local', '0.1 / 0.2 / 0.4 / 0.8 / 1.6', '', 'akcelik', 'secondary'],
  ['Traffic', 'Default speed limit (no OSM tag)', '50 built-up / 100 freeway / 10 shared zone', 'km/h', 'roadrules', 'verified'],
  ['Traffic', 'Lanes per direction where OSM has no lanes tag', '3 freeway / 2 highway & arterial / 1 other', 'lanes', null, 'assumption'],
  ['Traffic', 'Intersection delay convention', 'Akçelik term once per approach to a 3+ road junction', '', null, 'assumption'],
  ['Traffic', 'Heavy vehicle share per link', 'Heavy vehicle AADT ÷ AADT', '%', 'dtp', 'verified'],
  ['Traffic', 'Off-peak / night / weekend demand', 'Hour share of AADT (e.g. 11:00 weekday 5.83%)', '%', 'scats', 'derived'],
  ['Work zone', 'Freeway lane closure capacity', 'HCM queue discharge rate', 'pc/h/ln', 'hcm', 'secondary'],
  ['Work zone', 'Urban lane closure capacity', 'Open lanes × mid-block capacity', 'pc/h/lane', 'agtm3', 'secondary'],
  ['Work zone', 'Stop/Slow shuttle max two-way volume by length', '800 (≤70 m) … 300 (≤800 m)', 'veh/h', 'qgttm', 'verified'],
  ['Work zone', 'Open lanes needed', '1 per 1,000 veh/h mid-block, 500 near intersections', 'veh/h/lane', 'qgttm', 'verified'],
  ['Work zone', 'Advance sign spacing D', '15 (≤55) / 45 (56–65) / = speed (≥66)', 'm', 'qgttm', 'verified'],
  ['Work zone', 'Merge taper length', 'speed × lateral shift ÷ 3.5 m', 'm', 'tn195', 'verified'],
  ['Work zone', 'Cone spacing', '4 (40 km/h) / 12 (60 km/h)', 'm', 'tn195', 'verified'],
  ['Work zone', 'Road safety barrier requirement', 'Consider for long-term works and excavations > 250 mm near traffic (Cl. 17)', '', 'viccode', 'verified'],
  ['Work zone', 'Barrier clearance to traffic lane', '0.3 (≤40) / 0.5 (41–80) / 1.0 (>80)', 'm', 'qgttm', 'verified'],
  ['Work zone', 'Lane width if not in DTP data', DEFAULT_LANE_WIDTH, 'm', null, 'assumption'],
  ['Work zone', 'Queue storage per vehicle', '7.0 light / 13.0 heavy', 'm', null, 'assumption'],
  ['Drivers', 'Drivers following navigation directions', INFO.nav * 100, '%', 'nav', 'verified'],
  ['Drivers', 'Extra diversion with VMS announcing blockage', `${INFO.vms * 100} (range 5–40)`, '%', 'vms', 'secondary'],
  ['Pedestrians', 'Walking speed', WALK_SPEED, 'm/s', 'walk', 'secondary'],
  ['Pedestrians', 'Businesses fronting the site', 'OpenStreetMap shops, cafés, restaurants, health and services within 35 m of the work zone (counted, not valued)', 'count', null, 'derived'],
  ['Pedestrians', 'Pedestrian volume', 'Nearest City of Melbourne sensor (else user input)', 'people/h', 'com', 'verified'],
  ['Public transport', 'Services per hour by route and direction', 'GTFS timetable', 'trips/h', 'gtfs', 'derived'],
  ['Public transport', 'Boardings per trip (tram / bus, weekday)', `${f(PT_LOAD.tram.weekday, 1)} / ${f(PT_LOAD.bus.weekday, 1)}`, 'pax', 'patron', 'derived'],
  ['Public transport', 'Share of passengers crossing the site', '1/3 (uniform trip ends)', '', null, 'assumption'],
  ['Public transport', 'Transfer penalty (different mode)', TRANSFER_PENALTY_MIN, 'min', 'tfnsw', 'verified'],
  ['Public transport', 'Walk / wait / transfer-wait multipliers', '1.5 / 1.4 / 1.5', '× IVT', 'tfnsw', 'verified'],
  ['Economics', 'Value of time: car / LCV / heavy', `${VTT.car} / ${VTT.lcv} / ${VTT.hcv}`, '$/veh-h', 'tfnsw', 'verified'],
  ['Economics', 'Value of time: PT passenger, person', VTT.person, '$/person-h', 'tfnsw', 'verified'],
  ['Economics', 'LCV share of light-vehicle travel', f(LCV_SHARE_OF_LIGHT * 100, 0), '%', 'tfnsw', 'derived'],
  ['Economics', 'Vehicle operating cost model', 'Stop-start A + B/V; free-flow C0 + C1V + C2V²', 'c/km', 'pv2', 'verified'],
  ['Economics', 'VOC index June 2013 → June 2024', f(VOC_INDEX_2013_2024, 3), '×', 'tfnsw', 'derived'],
  ['Environment', 'Fuel consumption model', 'Stop-start / free-flow, ATAP Table 36', 'L/100 km', 'pv2', 'verified'],
  ['Environment', 'CO₂-e per litre: petrol / diesel', `${f(CO2E_PER_L.petrol, 3)} / ${f(CO2E_PER_L.dieselHV, 3)}`, 'kg/L', 'nga', 'derived'],
  ['Environment', 'NOx / PM2.5 fleet average', `${FLEET_EF.nox} / ${FLEET_EF.pm25}`, 'g/vkm', 'npi', 'verified'],
  ['Environment', 'Air pollution cost: car / LCV / heavy', `${EXTERNAL_C_PER_VKM.air.car} / ${EXTERNAL_C_PER_VKM.air.lcv} / ${EXTERNAL_C_PER_VKM.air.hcv}`, 'c/vkm', 'tfnsw', 'verified'],
  ['Environment', 'Noise cost: car / LCV / heavy', `${f(EXTERNAL_C_PER_VKM.noise.car)} / ${f(EXTERNAL_C_PER_VKM.noise.lcv)} / ${f(EXTERNAL_C_PER_VKM.noise.hcv)}`, 'c/vkm', 'pv5', 'derived'],
  ['Environment', 'Carbon value (FY2026 central)', f(CARBON_PER_T, 0), '$/t CO₂-e', 'pv5', 'derived'],
  ['Model', 'Prior (seed) demand before calibration', 'Gateways 40% of cordon capacity, local zones 40% of gateway volume, gravity decay 2.5 km', '', null, 'assumption'],
  ['Model', 'Count quality check', 'Counts above lanes × 1,900 veh/h (saturation flow) are dropped: the matched link cannot carry them', '', 'hcm', 'derived'],
  ['Model', 'Calibration method', 'Path-based matrix estimation to DTP counts (5 rounds, damping 0.8)', '', null, 'assumption'],
  ['Work zone', 'Arrow board rule', 'Lane closure on roads with 2+ lanes per direction and ≥ 60 km/h', '', null, 'assumption'],
  ['Work zone', 'VMS placement', 'Arterial approaches 120–1,500 m upstream carrying ≥ 15% of work-zone traffic', '', null, 'assumption'],
  ['Work zone', 'DETOUR sign placement', 'At every turn > 35° along the signed detour, plus start and end', '', null, 'assumption'],
  ['Work zone', 'Barrier / fence unit length', '2.0 / 2.4 (editable per depot product)', 'm', null, 'assumption'],
  ['Microsimulation', 'Car-following (IDM): T / s0 / b', '1.0 s / 2 m / 1.5 m/s²', '', null, 'secondary'],
  ['Microsimulation', 'IDM acceleration a', '1.5 m/s², calibrated so queue discharge (1,870 veh/h/lane) matches the signal saturation flow', 'm/s²', null, 'derived'],
  ['Microsimulation', 'Lane changing (MOBIL): politeness / threshold / safe braking', '0.2 / 0.1 m/s² / 4 m/s²', '', null, 'secondary'],
  ['Microsimulation', 'Signal locations', 'DTP register: intersection sites (INT) control the nearest junction', '', 'signals', 'verified'],
  ['Microsimulation', 'Signal demand', 'SCATS site volume in the analysis hour, shared across approaches by modelled flow', 'veh/h', 'scats', 'derived'],
  ['Microsimulation', 'Signal timing: Webster cycle, saturation flow', '1900 pc/h/lane', '', 'hcm', 'secondary'],
  ['Microsimulation', 'Signal cycle range', '60–120 s (coordinated arterials; results insensitive within 60–120 s)', 's', null, 'assumption'],
  ['Microsimulation', 'Level of service, signalised intersection', 'A ≤ 10, B ≤ 20, C ≤ 35, D ≤ 55, E ≤ 80, F > 80 s/veh or DoS > 1', 's/veh', 'hcm', 'secondary'],
  ['Microsimulation', 'Critical headway, unsignalised minor approach', '6.5 s', 's', 'hcm', 'secondary'],
  ['Microsimulation', 'Do not enter a blocked intersection', 'Links < 30 m inside a junction entered only when clear beyond', '', 'roadrules', 'assumption'],
  ['Microsimulation', 'Warm-up / measured period / time step', '15 min / 60 min / 0.5 s', '', null, 'assumption'],
  ['Road safety', 'Crash history', 'Injury crashes within 20 m of the road, 2019 and 2021–2024', 'crashes', 'crash', 'verified'],
  ['Road safety', 'Crash rate by road type (freeway / arterial / local)', 'Observed crashes ÷ modelled vehicle-km, pooled over the study area', '$/mvkt', 'crash', 'derived'],
  ['Road safety', 'Cost per crash: fatal / serious / other injury', '9,363,016 / 610,137 / 94,120', '$ (June 2024)', 'tfnsw', 'verified'],
  ['Road safety', 'Fallback where a road type has < 10 crashes', 'TfNSW Table 5.1 urban: 105,122 local / 76,548 arterial / 23,856 freeway', '$/mvkt', 'tfnsw', 'verified'],
  ['Road safety', 'Years excluded', '2020 (lockdowns, −18% crashes) and 2025 (incomplete)', '', 'crash', 'derived'],
  ['Road safety', 'Signed detour avoids streets with serious / vulnerable road user crashes', `×${CRASH_DETOUR_PENALTY} cost on those links in the detour search`, '', null, 'assumption'],
  ['Road safety', 'Crash risk inside the work zone itself', 'Not valued: no Australian work zone crash factor', '', null, 'assumption'],
  ['Economics', 'Local business trade loss', 'No published standard, only if the user enters a deterrence rate', '', null, 'assumption'],
];
