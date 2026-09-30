# Simulation model and methods

**Two-level model: macroscopic user-equilibrium assignment for demand and routes, and a microscopic simulation of every vehicle (IDM car-following, MOBIL lane changing).**

Demand comes from a doubly constrained gravity model calibrated to traffic counts and is assigned at Wardrop user equilibrium (MSA, Akçelik link delay) to give route sets for normal conditions and for the work zone. The same demand is then run through a microscopic simulation: each vehicle departs by a Poisson process, follows its route with the Intelligent Driver Model, changes lanes with MOBIL, obeys fixed-time Webster signals and gives way at unsignalised junctions. Habitual drivers re-route with Dijkstra at the last junction before the closure.

Each component of the simulation, the established method it uses and its reference:

### Road network: Directed node-link graph

OpenStreetMap ways split at junctions; each directed link carries length, lanes, speed limit, capacity and a delay parameter.

`G = (N, A); link a: length, lanes, capacity Q_a, J_a`

*Standard network representation (Sheffi 1985, ch. 1)*

### Trip distribution: Doubly constrained gravity model, Furness balancing

Trips between cordon gateways and local activity zones in proportion to productions, attractions and a distance function; rows and columns balanced iteratively.

`T_ij = A_i B_j O_i D_j f(d_ij), with A_i, B_j found by iterative proportional fitting`

*Wilson (1970); Furness (1965); Ortúzar & Willumsen (2011) ch. 5*

### Demand calibration: Count-based OD matrix adjustment (simplified, multiplicative)

Each OD cell is scaled by the damped geometric mean of observed ÷ modelled flow on the counted links its routes use, over five assign-and-adjust rounds. This is a simplified form of matrix estimation from counts, not the full maximum-entropy ME2 method.

`T_q ← T_q · exp(0.8 · mean over counted links l on q's paths of ln(c_l / v_l))`

*Van Zuylen & Willumsen (1980); Spiess (1990)*

### Route choice: Deterministic user equilibrium (Wardrop's first principle)

No driver can reduce travel time by changing route: all used routes between an origin and destination have equal, minimum time.

`Σ_a ∫_0^{v_a} t_a(x) dx → min, subject to flow conservation`

*Wardrop (1952); Beckmann, McGuire & Winsten (1956); Sheffi (1985) ch. 3*

### Equilibrium solver: Method of Successive Averages (MSA)

All-or-nothing loads on current shortest paths are averaged with step 1/k over 14 iterations; the relative gap is reported as the convergence measure.

`v^{k+1} = v^k + (y^k − v^k) / k;  gap = (Σ v t − Σ T·SP) / Σ v t`

*Sheffi (1985) ch. 12; Boyce, Ralevic-Dekic & Bar-Gera (2004)*

### Shortest paths: Dijkstra's algorithm (binary heap)

Minimum-time paths from every zone for the assignment, detours, bus diversions and walking routes.

`label-setting shortest path tree`

*Dijkstra (1959)*

### Link delay: Akçelik time-dependent volume-delay function

Travel time rises with volume/capacity and stays finite above capacity, representing queueing over the analysis hour.

`t = t0 + 0.25 T [ (x − 1) + √((x − 1)² + 8 J x / (Q T)) ],  x = v / Q`

*Akçelik (1991)*

### Car-following (micro): Intelligent Driver Model (IDM)

Each vehicle accelerates towards the speed limit and brakes for the vehicle ahead, a stop line at red, a give-way line or the end of a closed lane. The maximum acceleration a is calibrated so that a standing queue discharges at the saturation flow used to time the signals.

`dv/dt = a [1 − (v/v0)^4 − (s*(v,Δv)/s)²],  s* = s0 + vT + vΔv / (2√(ab))`

*Treiber, Hennecke & Helbing (2000); Treiber & Kesting (2013)*

### Lane changing (micro): MOBIL (minimising overall braking induced by lane changes)

Discretionary lane changes when the gain outweighs the imposed braking; mandatory merges out of lanes closed by the work zone.

`ã_c − a_c + p (ã_n − a_n + ã_o − a_o) > Δa_th,  ã_n ≥ −b_safe`

*Kesting, Treiber & Helbing (2007)*

### Signals (micro): Fixed-time control, Webster cycle and green split

DTP signal sites run two-phase plans; cycle (bounded to 60–120 s) and greens from the critical flow ratios; nodes of one junction share one controller.

`C0 = (1.5 L + 5) / (1 − Y),  g_i = (C − L) y_i / Y`

*Webster (1958); saturation flow HCM 6th ed.*

### Unsignalised junctions (micro): Priority by road hierarchy with gap acceptance

Minor approaches enter when no conflicting priority vehicle arrives within the critical headway; drivers do not enter a blocked intersection.

`t_arrival ≥ t_c = 6.5 s`

*HCM 6th ed. Ch. 20; Road Safety Road Rules 2017 (Vic) r.128*

### Work zone capacity: HCM work zone queue discharge rate; AGTM mid-block capacity

Freeway lane closures use the HCM queue discharge model; urban lane closures use open lanes × mid-block capacity; Stop/Slow uses the QGTTM volume limit.

`QDR = 2093 − 154 LCSI − 194 f_Br − 179 f_AT + 9 f_LAT − 59 f_DN`

*TRB HCM 6th Ed. (2016) Ch. 10; Austroads AGTM Part 3; QGTTM Part 3 Table 5.4*

### Response to the closure: Two-class driver information model with en-route diversion

Informed drivers re-route in the equilibrium; habitual drivers keep their usual path and divert at the last junction before the closure. The informed share combines navigation use and VMS diversion evidence.

`p_informed = 1 − (1 − p_nav)(1 − p_VMS × coverage)`

*Erke, Sagberg & Hagman (2007); Starkey & Charlton (2020)*

### Queues: Deterministic (input-output) queueing

Where demand exceeds capacity, the queue grows at the excess rate over the hour; length uses queue space per vehicle.

`N(T) = (v − Q) · T;  length = N · spacing / lanes`

*May (1990) ch. 11*

### Calibration fit: GEH statistic

Modelled against observed counts per link; the common target is GEH < 5 on more than 85% of counted links.

`GEH = √( 2 (M − C)² / (M + C) )`

*UK DfT TAG Unit M3.1 (Highway Assignment Modelling)*

### Pedestrians: Shortest-path detour on the footpath network

Sampled walking trips around the site are routed before and after the footpath closure; the difference is the detour.

`detour = SP_after − SP_before; time = detour / 1.2 m/s`

*Dijkstra (1959); Austroads walking speed via Truong et al. (2018)*

### Public transport: Timetable-based service impact

Services per hour from GTFS; passengers per trip from patronage; trams cannot divert, so a replacement fleet is sized as round-trip time ÷ headway.

`buses = ⌈2 t_bus / h⌉;  crossing share = 2p(1 − p), mean 1/3`

*Ceder (2007) (fleet size = cycle time ÷ headway); ATAP transfer penalty (TfNSW EPV 2025)*

### Emissions and costs: ATAP speed-dependent VOC and fuel models; NGA factors

Per link: fuel and vehicle operating cost from average speed; CO₂-e from fuel; externalities per vehicle-km.

`c = A + B / V (V < 60 km/h);  c = C0 + C1 V + C2 V² (V ≥ 60)`

*ATAP PV2 (2016) Tables 35–36; NGA Factors 2025; ATAP PV5 (2024)*

### Road safety: Observed crash rate × change in exposure

DTP injury crashes are snapped to the nearest road link; crash cost per vehicle-km is pooled by road type over the study area and applied to the change in vehicle-km caused by the works.

`ΔC = Σ_type (Σ crashes × cost_sev ÷ vkm_type) · Δvkm_type;  vkm = flow ÷ hour share × 365 × years × length`

*Austroads (2010) AP-T152-10 crash rates; TfNSW EPV 2025.1 Tables 5.1–5.2*

## Simplifications

- Routes are fixed from the equilibrium (plus en-route re-routing of habitual drivers); the microsimulation does not iterate to a dynamic user equilibrium.
- Signals use two-phase fixed-time Webster plans, not the actual SCATS timings (not published); turn lanes and turning conflicts inside junctions are simplified. Short links inside a junction (< 30 m) are crossed in one move and only when there is room beyond (Road Rules r.128), so queues form on the approaches, not inside the junction.
- Lane counts come from OpenStreetMap, which can under-represent flared approaches; the app reports microsimulated flows against Transport Victoria counts.
- Road safety values the change in crash exposure on the network; the crash risk inside the work zone itself is not valued, because there is no Australian work zone crash modification factor.

## References

1. Austroads (2010). Road Safety Engineering Risk Assessment Part 7: Crash Rates Database, AP-T152-10 (as reproduced in TfNSW EPV 2025.1 Tables 5.3–5.4).
2. Akçelik, R. (1991). Travel time functions for transport planning purposes: Davidson's function, its time-dependent form and an alternative travel time function. Australian Road Research 21(3), 49–59.
3. Beckmann, M., McGuire, C.B. & Winsten, C.B. (1956). Studies in the Economics of Transportation. Yale University Press.
4. Boyce, D., Ralevic-Dekic, B. & Bar-Gera, H. (2004). Convergence of traffic assignments: how much is enough? Journal of Transportation Engineering 130(1), 49–55.
5. Ceder, A. (2007). Public Transit Planning and Operation: Theory, Modelling and Practice. Elsevier.
6. Dijkstra, E.W. (1959). A note on two problems in connexion with graphs. Numerische Mathematik 1, 269–271.
7. Erke, A., Sagberg, F. & Hagman, R. (2007). Effects of route guidance variable message signs (VMS) on driver behaviour. Transportation Research Part F 10(6), 447–457.
8. Furness, K.P. (1965). Time function iteration. Traffic Engineering and Control 7(7), 458–460.
9. May, A.D. (1990). Traffic Flow Fundamentals. Prentice Hall.
10. Ortúzar, J. de D. & Willumsen, L.G. (2011). Modelling Transport, 4th ed. Wiley.
11. Sheffi, Y. (1985). Urban Transportation Networks: Equilibrium Analysis with Mathematical Programming Methods. Prentice-Hall.
12. Spiess, H. (1990). A gradient approach for the O-D matrix adjustment problem. Centre de recherche sur les transports, Université de Montréal, Publication 693.
13. Starkey, N.J. & Charlton, S.G. (2020). Frontiers in Sustainable Cities 2:39, doi:10.3389/frsc.2020.00039.
14. Transportation Research Board (2016). Highway Capacity Manual, 6th ed., Chapter 10.
15. Truong, L.T. et al. (2018). Walking speeds for timing of pedestrian walk and clearance intervals. ATRF 2018.
16. UK Department for Transport. TAG Unit M3.1: Highway Assignment Modelling.
17. Treiber, M., Hennecke, A. & Helbing, D. (2000). Congested traffic states in empirical observations and microscopic simulations. Physical Review E 62(2), 1805–1824.
18. Treiber, M. & Kesting, A. (2013). Traffic Flow Dynamics: Data, Models and Simulation. Springer.
19. Kesting, A., Treiber, M. & Helbing, D. (2007). General lane-changing model MOBIL for car-following models. Transportation Research Record 1999, 86–94.
20. Webster, F.V. (1958). Traffic Signal Settings. Road Research Technical Paper No. 39, HMSO, London.
21. Van Zuylen, H.J. & Willumsen, L.G. (1980). The most likely trip matrix estimated from traffic counts. Transportation Research Part B 14(3), 281–293.
22. Wardrop, J.G. (1952). Some theoretical aspects of road traffic research. Proceedings of the Institution of Civil Engineers, Part II, 1(3), 325–378.
23. Wilson, A.G. (1970). Entropy in Urban and Regional Modelling. Pion.

Parameter values, with their published sources, are listed in the README section *Standards and sources* and in [js/standards.js](../js/standards.js).
