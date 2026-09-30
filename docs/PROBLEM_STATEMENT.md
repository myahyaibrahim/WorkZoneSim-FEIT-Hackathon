# Problem Statement: Temporary Infrastructure in Greater Melbourne

**Future Cities challenge · Digital tool for temporary infrastructure**

> Councils and contractors plan road closures and work zones with limited ability to foresee their knock-on effects on surrounding traffic, pedestrians and public transport. The challenge asks for a digital tool that simulates the impact of a planned road closure or work zone before it is deployed on site, using typical traffic equipment (barriers, signage, VMS boards).

---

## 1. The problem

Every road closure in Melbourne is approved one site at a time.
- **What the plan must show:** the traffic management plan a council or DTP receives must show signs, cones and provision for pedestrians and public transport.
- **What it does not have to show:** where the diverted traffic will go.
- **Short works get no assessment at all:** works shorter than four weeks need no traffic impact assessment.

So network effects, interrupted tram and bus services, and depot equipment shortfalls are found on the day the works start. By then each fix costs up to five more business days of approvals, and it puts workers back beside live traffic.

---

## 2. How big it is in Melbourne

| Evidence | Source |
|---|---|
| Road congestion and public transport crowding cost Melbourne **about $5.4 billion in 2016** | Infrastructure Australia (2019), *Urban Transport Crowding and Congestion: 6. Melbourne and Geelong*, PDF p. 5 |
| Road congestion alone is forecast to cost Melbourne **about $10.1 billion a year by 2031** | Same report, PDF p. 13 |
| Avoidable social cost of congestion in Melbourne: **about $4.6 billion (2015)**, rising to **$7.6–10.2 billion by 2030** (2010 prices) | BITRE (2015), Information Sheet 74, Tables 4a/4b |
| Planned disruptions to the public transport network **increased steadily** (July 2021 to January 2024) | Victorian Auditor-General's Office (2025), *Managing Disruptions Affecting Victoria's Public Transport Network* |
| Big Build works caused **21% of planned disruptions but 46% of network occupation time**; they averaged **26.5 hours, against 8 hours** for other works | Same VAGO report |
| The VAGO audit covered public transport disruptions but **not road works and road occupations** affecting trams and buses | Same VAGO report |
| Being struck by moving vehicles or plant is **the most common hazard** in traffic management work | WorkSafe Victoria, safety alert *Traffic management worker killed, another seriously injured* |

---

## 3. Where the current process falls short

### What the rules require

| Requirement in Melbourne | Source |
|---|---|
| A traffic management plan must cover the activity and its duration, the location, a risk assessment, the traffic control devices, any speed reduction, and provision for public transport, other traffic, pedestrians, cyclists and people with disabilities. **It does not require an analysis of where diverted traffic goes.** | Road Safety (Traffic Management) Regulations 2019 reg. 35, restated in the Code of Practice for Worksite Safety: Traffic Management (Vic Gazette S280, 2023) Cl. 15 |
| A Construction Traffic Impact Assessment is required only for works of **4 weeks or more** | City of Melbourne, *Traffic Management Plans* |
| Council consent takes **up to 15 business days**; each amendment **up to 5 business days**; stakeholders must be notified **at least 5 business days** before works | City of Melbourne, *Consent for works (road works)* |
| On arterial roads, the coordinating road authority has **up to 20 business days** to decide | VicRoads, *A Guide to Working in the Road Reserve* (2020), Flow Chart 2 |

### The gaps this leaves

1. **Short works are not assessed for network effects.** For any closure under 4 weeks (an overnight resurfacing, a weekend tram track job, a crane lift), no one tests where the traffic goes or which local streets take it.
2. **Public transport impact is found late.** Tram and bus routes cut by a closure are handled through notices. Nothing in the plan quantifies the effect.
3. **Equipment is only reconciled on the day.** Nothing in the process checks the drawn layout against the barriers, signs, VMS boards and traffic controllers the depot actually has.
4. **Every correction is slow.** A plan that turns out wrong goes back for amendment: up to 5 business days each time.
5. **Changing a layout on site is the most dangerous time to change it.**

---

## 4. Who is affected

| Stakeholder | Pain today |
|---|---|
| Council and DTP traffic engineers | Approve plans without a network view; deal with complaints afterwards |
| Contractors and traffic management companies | Redraw plans by hand for each option; find equipment shortfalls on site |
| DTP, Yarra Trams, bus operators | Learn about road occupations that cut routes too late to plan replacements well |
| Drivers and freight | Unplanned delay, late diversions, queues |
| Pedestrians and local businesses | Footpath detours and lost passing trade |
| Road workers | Exposure to traffic while layouts are fixed on site |

---

## 5. Root cause

The information needed to foresee a closure's impact already exists as open Victorian data:
- the road network;
- Transport Victoria traffic counts and heavy vehicle shares;
- the DTP traffic signal register and SCATS volumes;
- PTV timetables;
- City of Melbourne pedestrian counts.

The rules for laying out a work zone are also set out in the Victorian Worksite Safety Code. What is missing is a tool that **joins all of this at planning time**. None of it is currently connected to the depot's equipment list.

---

## 6. What the tool does about it

| Gap | Work Zone Impact Simulator |
|---|---|
| Short works not assessed | Simulates every closure, however short, across the surrounding network. Uses a calibrated traffic model plus a microsimulation of every vehicle. |
| PT impact found late | Identifies interrupted tram and bus routes and sizes replacement buses from the PTV timetable |
| Equipment reconciled on the day | Lays out barriers, signs, VMS and controllers to the Code and checks them against depot stock |
| Slow corrections | Runs a scenario in seconds; recommends the lowest-cost option that passes the checks |
| Paperwork rebuilt by hand | Drafts the traffic management plan in the structure of reg. 35 / Code Cl. 15, with a site drawing and approval dates |

---

## 7. Evidence from the tool (model estimates, Melbourne sites)

- **Sydney Road, Brunswick. Full closure Union St to Glenlyon Rd, weekday AM peak, 48 hours:**
  - **Diverted traffic:** about 4,800 vehicles per hour change route.
  - **Public transport:** tram 19 is interrupted.
  - **Cost:** about $610,000 in total economic cost.
  - **Better option:** the tool's recommended option is one direction closed on weeknights, at about $162,000, and it passes every check.
- **Collins Street, CBD. Full closure Swanston St to Elizabeth St:**
  - **Public transport:** four tram routes interrupted (11, 12, 48, 109).
  - **Pedestrians:** 1,142 people per hour pass the site (City of Melbourne sensor).
  - **Equipment:** one VMS board short of what the depot holds.

---

## 8. References

1. Infrastructure Australia (2019). *Urban Transport Crowding and Congestion: 6. Melbourne and Geelong*. https://www.infrastructureaustralia.gov.au/sites/default/files/2019-08/Urban%20Transport%20Crowding%20and%20Congestion%20-%206.%20Melbourne%20and%20Geelong.pdf
2. BITRE (2015). *Traffic and congestion cost trends for Australian capital cities*, Information Sheet 74. https://www.bitre.gov.au/sites/default/files/is_074.pdf
3. Victorian Auditor-General's Office (2025). *Managing Disruptions Affecting Victoria's Public Transport Network*. https://www.audit.vic.gov.au/report/managing-disruptions-affecting-victorias-public-transport-network
4. WorkSafe Victoria. *Traffic management worker killed, another seriously injured* (safety alert). https://www.worksafe.vic.gov.au/safety-alerts/traffic-management-worker-killed-another-seriously-injured
5. Victorian Government (2023). *Code of Practice for Worksite Safety: Traffic Management*, Gazette S280. https://www.gazette.vic.gov.au/gazette/Gazettes2023/GG2023S280.pdf
6. City of Melbourne. *Traffic Management Plans*. https://www.melbourne.vic.gov.au/traffic-management-plans
7. City of Melbourne. *Consent for works (road works)*. https://www.melbourne.vic.gov.au/consent-works-road-works
8. VicRoads (2020). *A Guide to Working in the Road Reserve*. https://www.vicroads.vic.gov.au/-/media/files/documents/business-and-industry/workingwithinroadreserve/working-within-road-reserve---web-doc-upd_jan-2020.ashx

*Not published for Victoria:* the number of road occupation applications refused or sent back for amendment. A request to the City of Melbourne or DTP (or an FOI application) would provide it.
