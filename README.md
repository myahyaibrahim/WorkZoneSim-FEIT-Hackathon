# Work Zone Impact Simulator ,  Greater Melbourne

**Future Cities: Digital Tool for Temporary Infrastructure.**
This tool lets councils and contractors simulate a planned road closure or work zone before it goes on site. It uses the traffic equipment they actually have (barriers, signs, VMS boards, arrow boards, traffic controllers) and shows the knock-on effects on traffic, pedestrians and public transport.

## Run it

```
node server.js          # then open http://localhost:8090 (8080 is often taken by other local servers)
```
or double-click `start.bat` on Windows. It needs Node 18+ and an internet connection, because the data is fetched live. There is no build step and nothing to install.

## Workflow

| Step | What you do |
|---|---|
| **1 Site** | Pick one of six Melbourne examples, search an address (Nominatim), or click **Pick on map**. Set the study radius (0.8–1.8 km). |
| **2 Work zone** | Click **Add work zone**, then click the start and end of the section. The tool follows the street and adds the other carriageway on divided roads. Set the treatment (full closure, one direction, lane closure, Stop/Slow shuttle), lanes closed, work-zone speed, footpath closure side, analysis hour, duration and value of time. |
| **3 Equipment** | Enter depot stock. The plan places barrier lines, ROADWORK AHEAD / ROAD CLOSED / DETOUR / END signs, 40 km/h signs, arrow boards, traffic controllers, pedestrian fencing and VMS boards. VMS go on the approaches that carry the most work-zone traffic. Shortfalls are flagged, and items that can't be deployed show greyed out on the map. |
| **4 Results** | Extra vehicle-hours, delay per affected vehicle, rerouted traffic, new queues, and the streets that absorb the diverted traffic. Also pedestrian detours, bus diversions and skipped stops, tram interruptions with a replacement-bus fleet size, **intersection performance**, **road safety**, an **economic impact** breakdown, **environment & community** indicators, council and technical checks with recommendations, and model confidence. A sticky bar at the top links to each section and exports the TMP and TIA. The map plays the microsimulation: every vehicle, coloured by speed or by driver type (usual route, informed, re-routed at the closure), with live signal states, plus trams and buses running to the PTV timetable (GTFS shapes, scheduled speed and the timetable headway for the analysis hour; replacement buses shuttle when a tram is cut). |
| **5 Decide** | *Find the best option* tries every sensible treatment (as drawn, lane closure, one direction, Stop/Slow) in every time window (weekday AM, business hours, PM, weeknight, weekend). It checks each against published criteria and recommends the lowest-cost option that passes (Road Management Act 2004 Sch. 7 Cl. 5 and 14). *Apply* loads the option; saved options can be compared side by side. |

**Road safety.** DTP injury crashes are an input like the traffic counts. Each crash is snapped to the nearest road link (within 20 m). The tool reports the crash history on the work zone section and on every street that takes diverted traffic (fatal, serious, pedestrian, cyclist), flags diverted routes with a serious or vulnerable road user history in the compliance checks, and values the change in crash risk: observed crash cost per vehicle-km by road type (TfNSW EPV Table 5.2 costs per crash) times the change in vehicle-km. 2020 (lockdowns) and 2025 (incomplete) are excluded. The risk inside the work zone itself is not valued. Toggle *Crashes (DTP)* under Layers to see them on the map.

**Contractor flow (3 stages).**
1. **Input:** mark the work site as a *pinpoint* (one block: a pit, a crane lift) or a *road segment* (start and end snapped to the OSM network); the area loads around the first click. Set the start date, working days and daily window (day 09:30–15:30, night 20:00–05:00, 24/7 or custom), works noise, and priorities for the AI (lowest cost, keep trams running, avoid night works, fewest days, keep access, budget, free notes). No engineering settings are needed.
2. **Recommendation:** four strategies with the same total working hours: your hours with a lane closure (or one direction), night works with a full closure, a phased single-lane shuttle (or one direction at a time), and a weekend block. Each working hour is costed in its own analysis period. Each scenario is rated on four knock-on pillars: emergency services (extra congested travel time from OSM hospitals, ambulance, fire and police stations to the site), public transport, pedestrians and cyclists, and traffic and queues (thresholds in `js/scenarios.js`, assumptions). The comparison opens side by side. The **AI recommendation** (Gemini, through `server.js`) reads the contractor's priorities and all scenario results and returns the pick, the reasons, the steps before lodging, trade-offs and optional equipment changes; it never produces traffic numbers. A rule-based pick (hard limits, checks, high ratings, cost) is shown when the AI is not set up. *Advanced* keeps the engineering controls.
3. **Procurement:** an editable bill of materials (quantities and rates, hire days from the schedule, fixed fees), totals excluding and including GST, **Recalibrate** (re-runs the scenario with the edited quantities as the equipment on site), the quote document, the TMP and TIA, and *Submit to RPM Hire for quote*. The rates are **placeholders**, not RPM Hire prices, and the submission is a **demo** that is not sent anywhere.

**Checks the tool resolves itself.** Where the data allow, the plan carries the answer instead of leaving an item to check on site: advance warning signs that do not fit on a short approach block move back onto the streets feeding it; a PREPARE TO STOP sign goes before the end of every queue that reaches the previous intersection; the signed detour avoids streets with a fatal, serious, pedestrian or cyclist crash on record where an alternative exists (×1.6 search cost, an assumption); crash history on the section adds controls to the TMP; local access lists the side streets, laneways and driveways inside the closure (OpenStreetMap); a closed footpath gets a bypass design (width by street, length, barriers, kerb ramps); and night works are checked against the "Works noise" input. What remains to check are real judgements: detour capacity, peak-hour timing and routes with no safer alternative.

**Two council documents** are exported from the Results tab, in the City of Melbourne format guides (Code of Practice for Building, Construction and Works, Tables 15.8 and 15.9, via the CoM *Traffic Management Plans* page). The site's council is found from the LGA of nearby DTP crash records; the CoM guides and standard conditions apply in full inside the City of Melbourne and are used as a guide elsewhere (the documents say so).

**Traffic Management Plan** (Table 15.8):
- **Compliance index:** the council format guide items and the prescribed content of a TMP (Road Safety (Traffic Management) Regulations 2019 reg. 35; Worksite Code Cl. 11(4) and 15), each mapped to its section.
- **1. Works description:** contacts, site location plan (aerial), dates and duration of closures, detour routes and impacts for vehicles, public transport, pedestrians, cyclists and people with disabilities, heavy vehicles, speed limit.
- **2. Stakeholder engagement:** approvals and notices with latest dates (including the CoM standard-condition notices to occupiers and emergency services), and the impact rating from the CoM *Road closure considerations* (high / medium / low).
- **3. Traffic guidance scheme:** A4 TGS sheets, device arrangement and schedule, clear widths for pedestrians (CoM condition 17: 3.0 / 2.0 / 1.5 / 1.2 m by street) and cyclists (4.0 m shared lane), plant and after-hours arrangements.
- **4. Risk assessment and controls:** the TfNSW TCAWS TMP-01 checklist layout (boxes ticked only where the analysis assessed the item), technical and council checks with recommendations, other measures and the Cl. 15(4) matters.
- **5. Equipment** against depot stock; **6. Site copy and s99A declaration.**

**Traffic Impact Assessment** (CoM CTIA format, Table 15.9): 1 Introduction, 2 Locality (road use hierarchy, safety, amenity, access), 3 Staging, 4 Road use (existing conditions), 5 Impact (network, **signalised intersection performance: degree of saturation, delay, level of service (HCM 6 Exhibit 19-8) and queues, with and without works**, diverted streets, public transport, pedestrians, road safety, impact rating), 6 Mitigation (options and measures), 7 Implementation, 8 Emergencies, 9 Communication, 10 Appendices (TGS drawings; supplementary economic comparison, which the council format does not require).

Applicant details are entered under *Application details* in the Work zone tab, and anything missing is shown as a placeholder. Both documents are drafts: they must be reviewed, completed and signed by an appropriately trained and qualified person before use.

Other exports: the TTM plan as GeoJSON (closures, detours, devices with coordinates and stock status), link impacts as CSV, and the option comparison as CSV.

## Live data connections

| Source | Used for |
|---|---|
| OpenStreetMap via Overpass API | Roads (class, lanes, speed limits, one-ways, divided carriageways), footpaths, tram tracks, PTV bus/tram route relations, stops |
| Transport Victoria (DTP) *Traffic Volume* open data (ArcGIS) | AADT and AM/PM peak-hour counts, used to calibrate traffic demand |
| City of Melbourne *Pedestrian Counting System* | 90-day average hourly footfall at the nearest sensor (City of Melbourne only) |
| Transport Victoria *GTFS Schedule* (preprocessed to `data/pt_service.json` and `data/pt_shapes.json` by `data/build_pt_shapes.py`) | Services per hour by route and direction; route shapes and scheduled speed for the tram and bus animation |
| DTP *Victoria road crash data* (preprocessed to `data/crashes.json` by `data/build_crashes.py`) | Injury crashes 2019 and 2021–2024 in Greater Melbourne: crash history at the work site and on diverted routes, crash rates by road type, and the road safety cost line |
| Nominatim | Address search, limited to Greater Melbourne |

## How the simulation works

- **Network** (`js/network.js`): OSM ways are split at junctions and clipped to the study circle. Each directed edge gets capacity (lanes × per-lane capacity by road class), free-flow time and an Akçelik delay parameter. Where a road crosses the circle boundary, a gateway is created.
- **Demand** (`js/demand.js`): cordon gateways plus local activity zones feed a gravity model balanced with Furness. Path-based matrix estimation then scales each OD cell towards the DTP counts on the links its routes use. GEH and R² are reported.
- **Assignment** (`js/assign.js`): static user equilibrium by the Method of Successive Averages, using Akçelik time-dependent intersection delay.
- **Work zones** (`js/workzone.js`): closures remove edges. Lane closures and shuttles cut capacity, and the work zone always acts as a bottleneck. *Informed* drivers re-route at equilibrium. *Habitual* drivers keep their usual route and divert late at the last junction before the closure. The informed share (40–95%) depends on advance-sign coverage, how much work-zone traffic passes a placed VMS, and pre-notification. So a VMS shortfall shows up as worse traffic outcomes.
- **Equipment layout**: follows indicative AS 1742.3 practice: advance-warning distance by speed, taper lengths, barriers across the full road width at every closure entry, DETOUR signs at every turn of the signed detour.
- **Impacts** (`js/impacts.js`): pedestrian detours are measured by sampling walking trips on the OSM footpath graph. Bus routes are re-routed through the congested network, with skipped stops identified. Trams can't divert, so the tool sizes a replacement-bus fleet from the road path between the tram stops either side of the closure.

## Standards and sources

Every calculation parameter lives in [js/standards.js](js/standards.js). Each one carries its source and a status: **verified**, **derived**, **via supplement** (confirmed through an official supplement or report that reproduces the original table), or **assumption**. The simulation model, its methods and references are documented in [docs/METHODOLOGY.md](docs/METHODOLOGY.md); they are kept out of the app and the council report.

| Area | Basis |
|---|---|
| Link delay and capacity | Akçelik (1991) time-dependent function and J values; Austroads AGTM Part 3 Table 6.1 mid-block capacity; VicRoads Managed Motorway Design Guide (freeway MSFR) |
| Speed limits | Road Safety Road Rules 2017 (Vic) r.25 defaults where OSM has no tag |
| Demand by hour | DTP AM/PM peak-hour counts; other hours use AADT × hour share derived from DTP SCATS data (Aug 2026, 4,508 sites) |
| Heavy vehicles | DTP heavy vehicle AADT per link |
| Work-zone capacity | HCM 6th Ed. Ch. 10 (freeways); open lanes × AGTM mid-block capacity (urban roads); QGTTM Part 3 Table 5.4 (Stop/Slow limits); Table 2.4 (open lanes needed) |
| TTM layout | QGTTM Part 3 Table 2.2 (sign spacing D); TMR TN195 (taper length, cone spacing); Victorian Worksite Safety Code Cl. 17 (barriers) |
| Driver information | Starkey & Charlton 2020 (navigation use 64%); Ramsay & Luk 1997 via Erke et al. 2007 (VMS diversion +30%, range 5–40%) |
| Pedestrians | Austroads walking speed 1.2 m/s; City of Melbourne sensors, otherwise a user-entered count (nothing invented) |
| Public transport | PTV GTFS timetable (services per hour per route); DTP patronage ÷ GTFS trips (boardings per trip); ATAP transfer penalty and TfNSW wait multipliers |
| Economics | TfNSW Economic Parameter Values 2025.1 (time values, June 2024 AUD); ATAP PV2 Tables 35–36 (vehicle operating cost and fuel models) |
| Environment | NGA Factors 2025 (CO₂-e per litre); Smit 2014 NPI inventory (NOx, PM2.5); TfNSW / ATAP PV5 (air pollution, noise, carbon values) |

**No published standard exists** for lost trade at local businesses. It is only valued when the user enters a deterrence rate and an average spend.

**Stated modelling assumptions** are listed as such in the table:
- lanes where OSM has no tag;
- the per-junction delay convention;
- prior demand and calibration settings;
- VMS and DETOUR sign placement rules;
- queue space per vehicle;
- barrier unit length;
- the share of PT passengers crossing the site (1/3, from uniform trip ends).

## Limits

This is a strategic planning aid. It does not replace a Traffic Management Plan certified by a qualified designer.

- It simulates one representative hour; the cost for the whole works is that hour multiplied by the duration.
- Signal timings and turn restrictions are not modelled.
- Queue lengths are end-of-hour estimates if the overload persists.
- PT headways, loads and value of time are editable, indicative assumptions.
- DTP counts cover the declared arterial network only.
- The model fits best on suburban arterial corridors. In the dense CBD grid, counts are sparse, so the fit is weaker.
