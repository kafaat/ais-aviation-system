# Airline Operational Systems Alongside a Booking Platform (DCS, Biometrics, W&B, Crew, IROPS, Baggage, A-CDM) — State of the Art 2024–2026

Research date: 2026-11-02. Method: ~30 web searches; primary-source fetches to sita.aero, amadeus.com and regulatorylibrary.caa.co.uk were refused by the session's network allow-list, so several SITA/Amadeus/EASA facts below are taken from search-engine summaries of press coverage rather than the original PDFs. Each such case is flagged in Gaps.

---

## Key Question 1 — Departure Control Systems (DCS): what leading products provide and self-service trends

### Takeaway

A credible DCS is a "Customer Management + Flight Management" pair (check-in/boarding on one side, weight & balance / load control on the other), runs multi-airline for ground handlers, interlines via standard AIRIMP/Type-B messaging, and is increasingly consumed through self-service channels (web/mobile/kiosk/eGate) and biometric tokens. Passengers' self-service and digital-ID appetite is high (58% prefer biometric check-in to staffed desks; 79% ready to use phone-based digital ID), and electronic bag tags grew from 28% to 35% of passengers in one year.

### Cited Findings

**Vendor products**

- Amadeus describes its ground-handler DCS as having two key components: "Customer Management, to handle your front office, check-in and boarding activities, and Flight Management, to handle weight and balance ensuring a safe and quick aircraft turnaround." — [Amadeus Altéa DC for Ground Handlers](https://amadeus.com/en/airports/products/altea-dc-for-ground-handlers-customer-management)
- Over 125 global ground handling firms use Amadeus Altéa Departure Control for Ground Handlers; Skyserv (Greece) migrated 37 airports / 150 airlines to it in a three-month timescale (report dated April 2026). — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/technology/skyserv-adopts-amadeus-dcs-for-37-greek-airports.html); [Amadeus press release](https://amadeus.com/en/newsroom/press-releases/amadeus-partners-skyserv-implement-modern-technology-handling-customers-flights)
- Amadeus markets the ground-handler product as one connection replacing multiple airline DCS links ("connect to all your airline customers, instead of having multiple DCS connections"). — [Amadeus](https://amadeus.com/en/portfolio.airports.solutions-for-ground-handlers)
- A third-party catalogue lists Altéa DCS as running on Amadeus private cloud, sustaining 500+ TPS per airline and interlining with Sabre, TravelSky and Navitaire via AIRIMP (secondary listing; treat as unverified). — [Aviation Souk listing](https://www.aviationsouk.com/products/amadeus-altea-dcs/)
- Navitaire GoNow (Amadeus company) is a self-service application letting passengers "check bags and print bag tags, select seats, buy and pay for ancillary offers, print boarding passes and more"; it is "closely integrated with New Skies reservations suite", offers "turnkey self-service channels without API development", and supports biometric boarding and self-tagging. Navitaire Navigate uses airport eGates for self-service boarding. — [Navitaire GoNow](https://www.navitaire.com/gonow-day-departure); [GoNow brochure](https://www.navitaire.com:443/downloads/GoNow%20Day-of-Departure%20Brochure.pdf); [Navitaire Navigate](https://navitaire.com/navigate)
- SabreSonic Check-In includes "advanced departure control system capabilities such as re-accommodation and automated fee collection, plus a CUSS-compliant self-service kiosk application, Web check-in and boarding automation" (2005-era release). In 2024 Sabre partnered with BAGTAG so SabreSonic customers can implement electronic bag tags. — [Breaking Travel News](https://www.breakingtravelnews.com/news/article/btn40007493/); [TravelMole](https://www.travelmole.com/news/sabre-and-bagtag-partner-to-speed-up-check-in)
- Hitit's Crane DCS has served airports in 160 countries (2025 year-end results); Hitit completed migration of its payment orchestration platform (HPO) to the cloud by mid-2026 and reports H1-2026 revenue of USD 23.0m (+16%). Hitit described ongoing multi-cloud pilots in 2023. — [Hitit 2025 year-end presentation](https://www.hitit.com/themes/hitit/documents/2026-02/2025-year-end-results-presentation.pdf); [Hitit H1-2026 results](https://hitit.com/themes/hitit/documents/2026-08/hitit-30.06.2026-results-presentation.pdf); [Hitit 2023 results](https://hitit.com/themes/hitit/documents/2023-june-results-presentation.pdf)
- SITA Horizon includes departure control services "which manage the passenger at the airport" (Iraqi Airways deployment). In September 2025 SITA launched SITA Connect Fly, a managed connectivity service integrated with SITA common-use check-in, self-service systems and SITA Flex. — [Travel Daily News](https://www.traveldailynews.com/aviation/sita-technology-brings-iraqui-airwaysto-new-beginnings/); [Creamer Media](https://newsletter.en.creamermedia.com/article/new-passenger-handling-managed-connectivity-service-for-airlines-launched-2025-09-08)
- IATA runs a training course "Aircraft Weights Engineering for DCSs: Trimsheet Design & X565 Data", confirming that trimsheet design and AHM 565 data loading are a recognised DCS competency. — [IATA training](https://www.iata.org/en/training/courses/aircraft-weight-engineering/goc047veen02/en/)

**Self-service and passenger trends (2024–2025)**

- SITA Passenger IT Insights 2025 (16th edition, 7,500+ passengers in 25 countries): 58% prefer biometric check-in over staffed desks; 62% prefer biometric checkpoints to traditional border counters; 79% ready to use phone-based digital IDs (up from 74% in 2024); 66% willing to pay for the service; kiosk/eGate use at identity control rose to 39% (+4 pts); mobile booking +5 pts, bag collection +6 pts YoY. — [Biometric Update (Oct 2025)](https://www.biometricupdate.com/202510/sita-global-survey-reveals-passengers-want-digitalized-travel-with-digital-ids); [ITWeb](https://www.itweb.co.za/article/first-time-flyers-digital-natives-fuel-change-in-air-travel/JN1gPvOAaNBMjL6m)
- IATA Global Passenger Survey 2025: 50% of passengers had used biometrics at some point in their trip (46% in 2024); most common at security (44%), exit immigration (41%), entry immigration (35%); electronic bag tags increased from 28% (2024) to 35% (2025); airline apps chosen by 19% of passengers (16% in 2024); 54% want to deal directly with airlines. — [IATA press release 2025-11-05](https://www.iata.org/en/pressroom/2025-releases/2025-11-05-02/); [Creamer Media](https://newsletter.en.creamermedia.com/article/iata-reports-that-global-airline-passengers-increasingly-using-digital-and-biometric-systems-2025-11-05); [Aeromorning](https://aeromorning.com/en/iatas-2025-global-passenger-survey-reveals-mobile-and-digital-id-as-the-future-of-travel/)
- SITA Air Transport IT Insights 2024 (published Feb 2025): over 50% of airports plan biometric solutions for check-in and baggage drop by 2026; 70% of airlines aim to implement biometric ID management in the same period; 74% of airlines and 72% of airports forecast IT spend increases over two years; 90% of airlines have adopted data platforms. — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/technology/sitas-new-it-insights-report-shows-a-focus-on-cybersecurity.html); [Runway Girl Network](https://runwaygirlnetwork.com/2025/02/cybersecurity-as-it-spend-climbs/)
- SITA Air Transport IT Insights 2025: industry IT spend US$50.8bn in 2025 (airlines US$36bn = 3.6% of revenue; airports US$14.8bn = 7.3%); 63% of airlines use AI in operations control "to coordinate decisions across aircraft assignment, crew availability and disruption recovery"; only 17% use AI to monitor turnaround in real time; generative AI is the top investment priority. — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/it-software/sita-report-highlights-data-coordination-as-key-barrier-to-aviation-it-investment.html); [Biometric Update (Apr 2026)](https://www.biometricupdate.com/202604/sita-urges-digital-identity-ai-coordination-as-aviation-faces-significant-pressures)
- SITA North America IT Insights: biometric-enabled passenger flows already in place at 53% of airlines; 53% plan to focus IT resources on biometrics/digital identity. — [Biometric Update (May 2025)](https://www.biometricupdate.com/202505/biometrics-investment-targets-pain-points-at-airports-with-self-service-options-sita)
- Europe: 66% of airlines offer automated bag drop and another 16% plan to by 2027 (SITA Baggage IT Insights 2025 coverage). — [Travolution](https://www.travolution.com/news/advanced-tech-sees-europes-mishandled-bag-rate-drop-a-quarter/)
- Taipei Songshan selected SITA Smart Path biometric kiosks that let passengers link ID to facial biometric to secure boarding passes. — [SITA press release](https://www.sita.aero/pressroom/news-releases/taipei-songshan-airport-reimagines-check-in-experience-with-sita/)

### Inferences

- A platform claiming "DCS" must at minimum show: (a) passenger acceptance against the PNL/ADL passenger list with document/APIS capture, (b) seat map control with blocking/regrade, (c) baggage acceptance producing bag tag numbers (10-digit IATA licence plate) and BSM messages, (d) boarding control with BP scanning and gate no-shows/offload, (e) flight close-out producing load-control outputs and standard Type-B messages (PNL/ADL, PTM, PSM, BSM, LDM, CPM, UCM, MVT). The vendor material consistently frames DCS as two halves (customer management + flight/load management); a product with only check-in and no load control is half a DCS by that definition.
- Self-service is now the default channel: with half of passengers using biometrics and 35% using electronic bag tags, a credible DCS must expose web/mobile check-in, kiosk (CUSS) and self bag drop (CUSS/CUPPS style) integration and a biometric token path, not treat them as optional add-ons.
- The 63% "AI in operations control" figure (SITA 2025) sets a market expectation that an ops suite has at least recommendation-level AI in disruption handling, while the 17% real-time turnaround figure shows that turnaround monitoring AI is still a differentiator rather than table stakes.

### Gaps

- Exact split of check-in channel usage (web vs mobile vs kiosk vs counter) from SITA Passenger IT Insights 2025 or IATA GPS 2025 was not found in accessible coverage; the primary SITA PDF (sita.aero) was unreachable from this session.
- No 2024–2026 documentation found for Ink Aviation's DCS or for a formal "cloud Altéa DCS" migration announcement; only third-party catalogue claims.
- Sabre DCS detail is largely 2005–2014 era; no 2024–2026 Sabre DCS roadmap found.

---

## Key Question 2 — Biometrics and digital identity (One ID, ICAO DTC, KSA, Emirates, CBP TVS, EU EES, vendor stack, privacy norms)

### Takeaway

Biometric single-token journeys are moving from pilots to production: IATA One ID trials cut touchpoint processing by ~40%, the EU EES went live 12 Oct 2025 (3-year biometric retention), US CBP retains US-citizen photos ≤12 hours but non-citizen images up to 75 years, and Saudi airports installed 152 e-gates with SITA Smart Path and an IDEMIA–Matarat digital-identity partnership. Amadeus is consolidating the vendor stack (Vision-Box €320m in 2024; Idemia Public Security €1.2bn pending, close expected mid-2027).

### Cited Findings

**Standards and trials**

- IATA One ID "works in conjunction with ICAO's Digital Travel Credential"; the DTC is a digital representation of passport chip data. — [IATA presentation](https://www.iata.org/en/iata-repository/pressroom/presentations/opportunities-in-digital-identity)
- A One ID pilot in Asia cut processing time at key touchpoints by 40%. — [Biometric Update (Feb 2025)](https://www.biometricupdate.com/202502/iata-one-id-biometrics-trial-cuts-airport-processing-times-by-40)
- IATA has run several cross-border trials demonstrating digital identity interoperability across countries, wallets and biometrics (2025). — [Biometric Update (Aug 2025)](https://www.biometricupdate.com/202508/cross-border-seamless-travel-is-closer-than-you-think-but-data-rules-need-to-catch-up); [IATA Knowledge Hub](https://www.iata.org/en/publications/newsletters/iata-knowledge-hub/powering-the-future-of-contactless-travel/)
- Macau launched One ID (Jan 2026 coverage). — [Biometric Update (Jan 2026)](https://www.biometricupdate.com/202601/digital-identitys-role-in-iatas-ecosystem-grows-with-ndc-macaus-one-id-launch)
- Conflicting/unverified: a LinkedIn post claims DTC "entered production in March 2026 with 107 countries"; not confirmed by ICAO/IATA sources; an aggregator says DTC is still awaiting widespread government endorsement. — [LinkedIn post](https://pt.linkedin.com/in/tomasaccs); [Pulse.bot](https://www.pulse.bot/transportation/news/aviation-industry-ready-for-contactless-travel-as-global-rollout-accelerates-dafd4ef0-25c7-4108-9302-b707bea9805c/)
- Narita (2021) used NEC facial recognition with Amadeus/ICM kiosks and bag drops under the IATA One ID standard — the model deployment for "face as token" at security and boarding. — [AviationPros](https://www.aviationpros.com/airport-business/airport-infrastructure-operations/press-release/21218430/amadeus-airport-it-americas-inc-narita-airport-amadeus-and-nec-introduce-japans-first-end-to-end-biometric-boarding-process)

**Saudi Arabia**

- SDAIA installed 152 automated e-gates across Riyadh, Jeddah, Dammam and Madinah airports (April 2025), built with the General Directorate of Passports and Matarat Holding; the gates check visa, biometric and airline databases. — [Arab News](https://www.arabnews.com/node/2593237); [Megaproject](https://megaproject.com/news/airport/e-gate-rollout-expanded-to-improve-airport-border-control-in-saudi-arabia)
- Jeddah KAIA added 70 e-gates for ~175,000 passengers/day. — [Gulf News](https://gulfnews.com/world/gulf/saudi/saudi-arabia-70-e-gates-launched-at-jeddah-airport-to-speed-up-travel-for-175000-passengers-daily-1.500049956)
- Riyadh KKIA Terminals 3 and 4 were first in KSA with biometric e-passport scanners. — [Gulf News](https://gulfnews.com/world/gulf/saudi/saudi-arabia-launches-e-gates-at-king-khalid-international-airport-in-riyadh-1.101994514)
- SITA built biometric self-service at KKIA and ran the kingdom's first fully biometric journey at NEOM Bay using Smart Path; SITA systems operate at Jeddah, Dammam and Riyadh; Matarat signed an MoU with SITA to accelerate digitalisation. — [Airport World](https://airport-world.com/?p=1022919); [Times Aerospace](https://www.timesaerospace.aero/news/technology/sita-and-matarat-to-fast-track-airport-digitalisation-in-saudi-arabia)
- December 2025: Matarat Holding and IDEMIA Public Security partnership to develop biometric and digital identity options for passenger processing. — [Biometric Update (Dec 2025)](https://www.biometricupdate.com/202512/idemia-ps-matarat-holding-drive-biometric-powered-airport-transformation-in-ksa)

**Emirates / Dubai**

- Emirates' biometric path at DXB T3 uses facial and iris recognition at check-in, lounge and boarding gates, initially for First/Business (older report; current status not reconfirmed). — [Gulf News](https://gulfnews.com/amp/uae/transport/emirates-to-roll-out-biometric-check-in-boarding-1.2295291)

**US CBP TVS**

- CBP privacy policy (effective April 2025): US-citizen photos retained no more than 12 hours after identity verification, only for continuity of operations; the Simplified Arrival PIA says a citizen's photo is not retained once matched. Non-citizen photos are enrolled in DHS IDENT (coverage says up to 75 years) under the rule effective 26 Dec 2025. Historical: retention was cut from 14 days to 12 hours. 53m+ travellers had used facial comparison (undated CBP figure). — [CBP testimony](https://www.cbp.gov/about/congressional-resources/testimony/statement-record-assessing-cbps-use-facial-recognition-technology); [CBP PIA (Feb 2025)](https://cbp.gov/sites/default/files/2025-02/pta_cbp_-_simplified_arrival_redacted.pdf); [Biometric Update (Oct 2025)](https://www.biometricupdate.com/202510/dhs-expands-biometric-entry-exit-program-cbp-to-photograph-all-noncitizens-at-u-s-borders); [The Register](https://theregister.com/2025/10/29/us_foreigner_facial_scans/)

**EU EES**

- EES launched 12 October 2025 with a six-month progressive rollout; records facial image + fingerprints of non-EU travellers, replacing stamps; biometrics stored for three years; first trip enrols, later trips auto-record; congestion at CDG/AMS/FRA led to discretionary pauses of biometric capture; ETIAS expected late 2026. — [Gulf News (advisory)](https://gulfnews.com/business/tourism/uae-issues-travel-advisory-on-new-eu-entryexit-system-effective-october-12-1.500302756); [Gulf News (queues)](https://gulfnews.com/business/tourism/travelling-from-uae-to-europe-how-new-schengen-system-can-affect-your-next-trip-1.500532740); [Dubai Eye](https://www.dubaieye1038.com/news/international/eu-begins-gradual-rollout-of-digital-border-system)

**Vendor consolidation**

- Amadeus acquired Vision-Box (Jan 2024, €320m) and announced acquisition of Idemia Public Security (€1.2bn, close expected mid-2027) to build an "end-to-end biometric travel platform". — [Phocuswire](https://www.phocuswire.com/news/technology/amadeus-acquires-idemia-biometrics-identity-technology); [International Airport Review](https://www.internationalairportreview.com/amadeus-acquisition-strengthens-biometric-travel-technology-across-airports-and-borders/2135438.article); [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/biometrics/amadeus-acquires-biometrics-solution-provider-vision-box.html)
- NEC biometric walkthrough gates coming to three of Japan's largest airports (2025). — [Biometric Update](https://www.biometricupdate.com/202206/airport-biometrics-from-vision-box-idemia-veridos-and-materna-hit-the-tarmac)

### Inferences

- "Biometric boarding" in a platform is only credible if it models: enrolment with explicit consent, a per-journey token bound to the booking/boarding pass, a 1:N or 1:1 match step against a gallery scoped to the flight, a configurable retention/purge policy (the CBP ≤12h for citizens and EES 3 years are the two reference norms), an opt-out/manual fallback path (EES itself falls back to stamping under congestion), and an audit trail. Storing raw face images indefinitely on the booking record would fail a privacy review against either norm.
- Airline-side biometric systems do not usually own the matching engine: they integrate to an airport/common-use provider (SITA Smart Path, Amadeus/Vision-Box, NEC, Idemia) or a government service (CBP TVS). A platform should expose integration points (template/match API, result callbacks) rather than claim its own recognition engine.
- For KSA specifically, the realistic integration targets are Matarat/SITA Smart Path at RUH/JED/DMM and the SDAIA/GDP e-gate programme; Saudi national digital ID acceptance at gates was not confirmed in sources.

### Gaps

- No official ICAO/IATA statement of DTC production status or country count found; one LinkedIn claim conflicts with cautious aggregators.
- Saudia/SAL-specific digital ID programme details were not found.
- No 2025 CBP TVS volume statistics located (only an undated 53m figure).
- Current (2025) status of Emirates' biometric path was not reconfirmed.

---

## Key Question 3 — Weight & balance / load control: electronic loadsheets, CLC, vendors, required calculations, limits

### Takeaway

Modern load control is centralized (CLC centres such as Lufthansa's Global Load Control in Cape Town/Brno/Istanbul), exception-based and automated (Smart4Aviation Smart LOAD; easyJet signed Dec 2025 to move to centralized highly automated load control), with electronic loadsheets pushed to ramp (RampMobile) and cockpit (CockpitMobile) and aircraft data loaded from the operator's IATA AHM 560/565 datasets. The calculation chain a reviewer can check is DOW/DOI → ZFW/ZFW index → TOW → LAW with %MAC from a type-specific index formula and LMC within limits.

### Cited Findings

**Vendors and deployment models**

- Lufthansa Systems NetLine/Load supports "centralized or decentralized load control approach", is "offered preferably as a hosted cloud solution", and is part of the IOCC platform; RampMobile lets ramp agents update W&B from the apron (paperless); CockpitMobile lets pilots review fuel figures and approve loadsheets. — [LH Systems NetLine/Load](https://www.lhsystems.com/product-brands/netline/netlineload); [Product info PDF (Feb 2025)](https://cdn.lhsystems.com/2025-02/2025_02_Product_information_NetLine_Load.pdf); [RampMobile](https://lhsystems.com/solutions/ground-operations-solutions/load-control/netlineload-rampmobile); [CockpitMobile](https://www.lhsystems.com/solutions/pilot-applications/netlineload-cockpitmobile)
- Global Load Control (Lufthansa Group) operates centres in Cape Town, Brno and Istanbul; Lufthansa cited moving to remote centralized load control and electronic loadsheets as in the airline's interest. — [Wikipedia: Global Load Control](https://en.wikipedia.org/wiki/Global_Load_Control)
- Smart4Aviation Smart LOAD is "an exception-based weight and balance and load-planning system" that "fully automates and optimizes load planning, engaging agents only when there are economic or loading irregularities", supporting centralized and decentralized models; customers include Air Canada, Delta, Air France, Iberia, Qantas, easyJet, Alaska. easyJet signed 15 Dec 2025 for Smart LOAD as "a key milestone in easyJet's journey towards centralized, highly automated load control", targeting fuel savings, OTP and reduced turnaround. — [Aircraft IT (easyJet)](https://www.aircraftit.com/news/smart4aviation-to-deliver-weight-balance-and-load-planning-solution-for-easyjet); [Aircraft IT vendor page](https://aircraftit.com/vendors/smart4aviation/s4a-smart-load); [AWS blog](https://aws.amazon.com/blogs/industries/how-smart4aviation-and-aws-modernize-operations-of-leading-airlines)
- Jeppesen Weight and Balance supports "centralized or decentralized load control, primary/secondary, or both" and works "with or without internet access"; partner Flyware (since 2003) supplies eLoadsheet and Powerloader. — [Jeppesen](https://ww2.jeppesen.com/?p=1067); [Flyware](https://flyware.net/about-us/)
- Evionica launched free W&B software for airlines to standardize load control across ground-handling networks. — [AFM](https://afm.aero/evionica-launches-free-weight-and-balance-software-for-airlines-to-standardize-load-control-across-ground-handling-networks)
- Qantas was first to roll out the Amadeus next-generation load control system (Altéa Flight Management lineage). — [Asia Travel Tips](https://www.asiatraveltips.com/news07/257-LoadControlSystem.shtml)

**Calculations and data**

- AHM 560 is described as the IATA data-exchange manual for check-in and load control, where carriers and handling agents agree semi-permanent data feeding the loadsheet; it is "possible to calculate loadsheet with all pre-calculated data presented in AHM 560". — [Atlantic Airways AHM](https://atlanticairways.com/media/1642/ahm-rcg.pdf)
- Airline AHM 560 documents give %MAC as: %MAC = C × (I − K) / W + (Ref.Sta. − LEMAC) / MAC × 100, where I = index, W = actual weight, Ref.Sta. = reference station, LEMAC = leading edge of mean aerodynamic chord; A321 example constants K = 50, C = 1000, Ref.Sta. 17.250 m. Constants are type/operator specific. — [AHM 560 A321 (Scribd)](https://www.scribd.com/document/435843394/AHM-560-Airbus-A321-fleet)
- ZFW = basic/dry operating weight + payload; loadsheets may show Basic Index, Dry Operating Index, Deadload Index and Deadload MAC. — [Weight and Balance notes (Scribd)](https://www.scribd.com/document/586909702/WEIGHT-AND-BALANCE)
- Trim sheets set stabiliser trim; an A320 empirical table targets TO CG around 29% MAC; load-and-trim sheets carry LMC limitations alongside ZFW/TOW limits. — [A320 LTS (Scribd)](https://www.scribd.com/document/683039590/A320-LTS-Rev-6-13-02-26); [LTS notes](https://www.scribd.com/document/681497167/LTS-1)
- IATA offers "Aircraft Weights Engineering for DCSs: Trimsheet Design & X565 Data" training (AHM 565 is the electronic aircraft W&B data standard). — [IATA training](https://www.iata.org/training-GOC047VEEN02)

### Inferences

- For a code review, a W&B module should implement and expose: DOW + DOI (per registration, per configuration/pantry code); ZFW = DOW + traffic load (pax by standard weights per cabin/zone × seat-row index + baggage/cargo/mail per hold compartment with compartment arm/index); TOW = ZFW + take-off fuel (block fuel − taxi fuel), fuel index from tank-loading tables; LAW = TOW − trip fuel; checks against MZFW, MTOW (structural and performance-limited RTOW), MLAW; CG as index → %MAC via the AHM 560 formula with type constants; forward/aft CG envelope at ZFW, TOW and LAW; stabiliser trim from TOW CG; underload = min(MZFW − ZFW, MTOW − TOW, MLAW − LAW); LMC (last-minute change) accumulation with a per-type LMC limit beyond which a new loadsheet is required; loadsheet/LDM/CPM message output and an edition/version number with sign-off identity. These are the fields airline-specific AHM 560/565 datasets provide; a module that hard-codes a single aircraft envelope or omits LMC/underload is not credible.
- Market direction is "exception-based automation plus centralized control": a platform aiming at airlines should support one load controller supervising many flights with auto-generated loadsheets and alerts, not one-agent-per-flight manual entry.

### Gaps

- Regulatory text (EASA CAT.POL.MAB.100/105, FAA 14 CFR 121.693/AC 120-27) was not fetched; limits above are inferred from airline documents rather than quoted regulation.
- No independent performance or pricing evaluations of NetLine/Load, Smart LOAD or Jeppesen W&B found; all are vendor claims.
- SITA load-control product status (2024–2026) not found.

---

## Key Question 4 — Crew management: rostering/pairing optimisation, FTL engines, fatigue, disruption recovery

### Takeaway

Crew suites (Jeppesen Crew, Lufthansa Systems NetLine/Crew, Sabre Crew Manager + Recovery Manager Crew, IBS iFlight, AIMS, Leon, Merlot) pair optimisation with a legality engine over EASA ORO.FTL / FAA Part 117 rules and increasingly a bio-mathematical fatigue model (Boeing Alertness Model in Jeppesen). Hard numbers a credible module must enforce include 900 flight hours per calendar year, 1,000 per 12 months, 100 per 28 days, the FDP table by report time and sectors (13 h basic max for acclimatised crew, 11:00/10:30/10:00 for unknown acclimatisation at 1–2/3/4 sectors), extension ≤1 h max twice in 7 days, and minimum rest at least as long as preceding duty with a 12-h floor at home base.

### Cited Findings

- ORO.FTL.210 limits: 100 hours of flight time in any 28 consecutive days, 900 hours in any calendar year, 1,000 hours in any 12 consecutive calendar months. — [UK CAA regulatory library ORO.FTL.210](https://regulatorylibrary.caa.co.uk/965-2012/Content/Regs/05140_ORO.FTL.210_Flight_times_and_duty_periods.htm)
- Maximum basic FDP for acclimatised crew is 13 hours, extendable by 1 hour no more than twice in any 7 consecutive days; the table is applied using reference time at the point of departure (ORO.FTL.205(b)(1) Table 1). — [PPRuNe summary](https://www.pprune.org/questions/printthread-605701-easa-flight-time-limitations.html) (secondary)
- Unknown-acclimatisation FDP limits: 11:00 (1–2 sectors), 10:30 (3 sectors), 10:00 (4 sectors). — [EASA FDTL quick reference (Scribd)](https://www.scribd.com/document/499151557/FDTL-QUICK-REFERRAL-EASA) (secondary)
- EASA minimum rest: 12 hours or length of preceding duty, whichever is greater (comparison article; an alternative "10 consecutive hours" figure appears to be the FAA Part 117 rule). — [Rotate Pilot: EASA vs FAA](https://rotatepilot.com/blog/pilot-fatigue-rules-easa-vs-faa)
- Rosters must be published at least 14 days in advance under EASA Subpart FTL (UK CAA audit guidance). — [UK CAA publication](https://caa.co.uk/publication/download/15063)
- Operators seeking derogation from standard minimum rest must apply FRM principles (CS FTL.1.235). — [CWA EASA FTL summary](https://cwalocals.org/system/files/2023-08/easa_ftl.docx.pdf)
- Jeppesen's fatigue functionality is built on the Boeing Alertness Model (BAM), integrated in Jeppesen Crew Management, CrewAlert and the Crew Fatigue Assessment Service; Finnair was first to fly crew schedules built with Jeppesen FRM; Air Nostrum chose Jeppesen Crew Pairing, Rostering and BAM. — [ATC Network (Finnair)](https://atc-network.com/atc-news/finnair-becomes-first-operator-to-fly-crew-schedules-constructed-using-jeppesn-fatigue-risk-management-functionality); [Jeppesen CrewAlert](https://news.jeppesen.com/news-room/jeppesen-introduces-crewalert-pro-ipad-manage-fatigue-risk-airline-crew/)
- Klemets (Jeppesen) 2025 study: revised EASA FTLs reduced long-haul fatigue risk "at a substantial efficiency cost" while short-haul changes were "counterproductive" (+3.2% fatigue risk, −0.6% crew efficiency); 2023 slides gave an overall Subpart Q→EASA FTL change of −7.8% risk, −7.0% crew efficiency (vendor-authored). — [Sleep Science abstract (Thieme)](https://www.thieme-connect.de/products/ejournals/abstract/10.1055/s-0045-1812697); [ATC Network](https://www.atc-network.com/atc-news/jeppesen-fatigue-risk-management-study-quantifies-the-effectivness-of-flight-and-duty-time-regulations)
- Sabre: Recovery Manager Crew (crew disruption management) integrated with Crew Manager at JetBlue; Garuda selected Movement Manager, Recovery Manager Ops and Crew Manager from the AirCentre Enterprise Operations portfolio. — [Travel Daily News (JetBlue)](https://www.traveldailynews.com/regional-news/sabre-aircentre-crew-manager-to-help-jetblue-manage-crew-resources/); [eTurboNews (Garuda)](https://eturbonews.com/?p=146289)
- Lufthansa Group/SWISS–Google decision support (INFORMS Interfaces 2025): the disruption-recovery problem "has three component subproblems: aircraft, passengers, and crew. Historically, the industry has solved these problems in isolation." — [INFORMS Interfaces](https://pubsonline.informs.org/doi/abs/10.1287/inte.2025.0296)
- Air India pilots objected to a new Jeppesen-built roster (2023), illustrating that roster quality/acceptance is a live operational issue. — [Aviation A2Z](https://aviationa2z.com/index.php/2023/08/29/air-india-pilots-unhappy-with-a-new-us-jeppesen-roster/)

### Inferences

- A "crew assignment" module is credible only if every assignment passes a legality check that encodes at least: cumulative flight-time windows (28-day/calendar-year/12-month), cumulative duty windows (7/14/28 days — values not quoted here, see Gaps), FDP by report time and sector count, FDP extensions (count per 7 days), minimum rest ≥ max(12 h at home base / 10 h away, preceding duty), weekly rest/days off, acclimatisation state, standby/split-duty rules, plus qualifications (type rating, recency, licence/medical/passport/visa validity), base/seniority and union rules. Vendor suites treat fatigue (BAM/SAFTE-FAST style) as an additional score, so a module should at least record report/release times in local and UTC and the WOCL overlap to make FRM possible later.
- Pairing (trip construction) and rostering (assigning pairings to individuals) are distinct optimisation problems in all major suites; a single "assign crew to flight" table without pairings/duty periods will not map to how airlines operate.

### Gaps

- Exact ORO.FTL.205 Table 1 values by report-time band and sector, ORO.FTL.210 duty-hour limits (7/14/28 days) and ORO.FTL.235 text could not be verified: UK CAA/EASA primary pages were unreachable (network allow-list) and only secondary summaries were found.
- No product documentation found describing how Jeppesen/LH Systems/IBS encode FTL rules in their optimisers, nor 2024–2026 measured outcomes (e.g., crew cost % saved) for AIMS, Leon, Merlot.aero or IBS iFlight Crew.

---

## Key Question 5 — IROPS / disruption management: products, research, outcomes, duty-of-care automation

### Takeaway

Production disruption systems split into airline-side recovery (NetLine/Ops++ with aiOCC reinforcement-learning recommendations; Sabre Recovery Manager Ops/Crew; Lufthansa–Google decision support) and passenger re-accommodation (Amadeus Passenger Recovery: Air Canada ~90% of disrupted passengers re-accommodated automatically in ~10 minutes, 1m+/year; SWISS 100-passenger cancellation from 3–4 hours to 2–3 minutes). Research (Cadarso & Vaze 2023, Wu et al. 2024 review, AIRS.ACR 2025) pushes integrated aircraft+crew+passenger recovery. The revised EU261 (Regulation (EU) 2026/2202) keeps duty of care (hotel when overnight; 3-night cap under extraordinary circumstances) and regulates vouchers, which is what hotel/meal automation must satisfy.

### Cited Findings

**Products and reported outcomes**

- Air Canada re-accommodates 1m+ passengers/year with Amadeus Passenger Recovery; roughly 90% of passengers are re-accommodated automatically; average rebooking ~10 minutes from cancellation notice; previously, rebooking onto another airline was a 25-step airport process. — [Amadeus blog (Air Canada)](https://amadeus.com/en/blog/articles/how-amadeus-helps-air-canada-rebook-disrupted-passengers-in-just-10-minutes); [Air Canada case study PDF](https://amadeus.com/content/dam/amadeuswebevo/documents/resources/case-studies/air-canada/air-canada-case-study.pdf); [Aviation A2Z (Oct 2024)](https://aviationa2z.com/index.php/2024/10/21/air-canada-ai-tech-to-reduce-12-hours-flight-distuption)
- SWISS handled ~150,000 disrupted-passenger rebookings/year; a 100-passenger cancellation that took 3–4 hours now takes 2–3 minutes; integrated with Altéa to automate re-forecasting, rebooking and notifications. — [Amadeus SWISS case study](https://amadeus.com/en/resources/case-study/swiss-disruption-management)
- Amadeus Self Re-accommodation lets passengers choose alternatives themselves (Air France case). — [Amadeus Self Re-accommodation](https://amadeus.com/en/portfolio/airlines/amadeus-self-re-accommodation); [Air France case study](https://amadeus.com/en/resources/case-study/case-study-how-air-france-empowers-passengers-in-times-of-disruption)
- Third-party 2026 comparison: Passenger Recovery is "mature and proven" but works natively mainly for Altéa-stack airlines. — [HappyRobot comparison](https://www.happyrobot.ai/hub/best-ai-automation-software-for-flight-ops-and-rebooking)
- Lufthansa Systems NetLine/Ops++ aiOCC: "first AI-powered Operations Control assistant", reinforcement learning, translates multi-source information into recommendations; "the decision always remains with the operations controller"; Eurowings launch customer; EL AL contracted NetLine/Ops++ (2024). — [LH Systems aiOCC](https://lhsystems.com/solutions/ai-other-services/netlineops-aiocc); [Press release (Feb 2024)](https://cdn.lhsystems.com/2024-02/PressNews_Smart-Operations-Control-Assistant_NetLineOps_aiOCC.pdf); [EL AL press](https://cdn.lhsystems.com/2024-04/PressNews_EL_AL_Operations_Control.pdf)
- Sabre Recovery Manager Ops: "optimize aircraft utilization and assist with re-positioning of aircraft and back-filling flights"; Air China and China Eastern went live (March 2021); sold within AirCentre Enterprise Operations alongside Movement Manager. — [Sabre](https://your.sabre.com/inthistogether/restart_efficient_ops); [ChinaTravelNews](https://www.chinatravelnews.com/article/print/143788)
- Lufthansa Group/SWISS–Google: five-year collaboration (from 2019) on schedule-recovery decision support, published in INFORMS Interfaces 2025. — [INFORMS](https://pubsonline.informs.org/doi/abs/10.1287/inte.2025.0296)
- SITA 2025: 63% of airlines use AI in operations control for aircraft/crew/disruption coordination. — [Biometric Update (Apr 2026)](https://www.biometricupdate.com/202604/sita-urges-digital-identity-ai-coordination-as-aviation-faces-significant-pressures)

**Research**

- Cadarso & Vaze, Transportation Science 57(3) 2023, "Passenger-Centric Integrated Airline Schedule and Aircraft Recovery": embeds a passenger response model in integrated recovery of schedules, aircraft and itineraries; "even a rough model of passenger disruption behavior yields real benefits over ignoring it". — [INFORMS](https://pubsonline.informs.org/doi/fpi/10.1287/trsc.2022.1174)
- Wu et al. (arXiv Jan 2024) review of passenger-oriented airline recovery identifies directions: dynamic/real-time recovery, human factors, robust scheduling combined with recovery. — [arXiv 2401.04866](https://arxiv.org/abs/2401.04866v2)
- Rodrigues et al. (arXiv Nov 2025) AIRS.ACR: solver-based day-of-operations recovery for OCCs using a time-space network. — [arXiv 2510.26831](https://www.arxiv.org/pdf/2510.26831)
- Lu et al. (Operations Management Research 2025): recovery accounting for passenger transfer and cancellation costs. — [IDEAS/RePEc](https://ideas.repec.org/a/hin/jnlmpe/9523610.html)

**Duty of care / EU261**

- Regulation (EU) 2026/2202: hotel accommodation remains available where an overnight stay is required, with a three-night cap where disruption is caused by extraordinary circumstances; vouchers remain permissible "only on tightly regulated terms and any unused balance must ultimately be returned to the passenger". — [Burges Salmon](https://www.burges-salmon.com/articles/102o4ut/evolution-delivered-what-regulation-eu-2026-2202-means-for-eu261-reform)
- Council working-party comments (Jan 2025): Ireland supports encouraging airlines to automate care and claims handling but says digital tools must not be mandatory; member states cited passengers receiving food vouchers only after the flight departed and vouchers unusable because shops were closed. — [Council document WK 318/2025 ADD 1](https://data.consilium.europa.eu/doc/document/WK-318-2025-ADD-1/en/pdf)
- Status conflict: a June 2025 law-firm note treated the reforms as proposals under negotiation while 2026 commentary treats them as adopted. — [Stephenson Harwood (June 2025)](https://www.stephensonharwood.com/media/l52lgfbi/final-version_airspeed-read-the-future-of-flight-disruption_-proposed-reforms-to-passenger-rights-june-2025.pdf); [AirHelp](https://www.airhelp.com/en-int/blog/what-ec261-reform-means-for-you/)

### Inferences

- A credible "IROPS command centre" needs three linked solvers or at least three linked workflows (aircraft/schedule, crew, passengers) and a human-in-the-loop recommendation model (every production vendor keeps the controller as decider). Benchmarks to compare against: automated re-accommodation ≥90% of affected passengers and minutes-not-hours cycle time (Air Canada, SWISS figures), with interline/OAL options rather than own-metal only.
- Hotel/meal/voucher automation should be rule-driven by delay duration, overnight requirement, extraordinary-circumstance flag and the 3-night cap, issue vouchers digitally before departure of the disrupted flight, and track unused balances for refund — these are the exact failure modes the Council paper and the 2026 regulation address.
- Passenger-centric research consistently shows value in modelling passenger itineraries (connections, missed-connection cost) rather than flights alone; a platform whose disruption model has no itinerary/connection graph is behind the research frontier by several years.

### Gaps

- No independent (non-vendor) 2024–2026 measurements of rebooking automation rates or EU261 exposure reduction found; all outcome figures are Amadeus/airline self-reported.
- No sources found on Air Black Box, Hopper-for-airlines or Ryanair's in-house disruption tooling; no MIT ICAT / Georgia Tech / TU Delft / Eurocontrol-SESAR / NASA passenger-centric recovery publications surfaced in the 2024–2026 window beyond the academic papers listed.
- Primary text of Regulation (EU) 2026/2202 (Official Journal) was not checked; compensation thresholds/amounts under the revised rule are not quoted here.

---

## Key Question 6 — Baggage: Resolution 753, tracking, WorldTracer, mishandling rates 2023–2025

### Takeaway

Mishandled-bag rates fell to 6.3 per 1,000 in 2024 and 4.9 per 1,000 in 2025 (−23%), yet cost rose to US$6.3bn in 2025 as SITA re-based the per-bag cost to US$260; transfer bags remain the top cause (39%). Resolution 753 (in force June 2018) mandates tracking at acceptance, loading, transfer and arrival; by end-2025 80.1% of in-scope IATA airlines had implementation plans, and 44% of airports (2024 survey) had fully implemented it.

### Cited Findings

- SITA Baggage IT Insights 2025 (2024 data): 6.3 mishandled bags per 1,000 passengers (6.9 prior year), ~33.4m bags, 67% improvement since 2007; Europe 12.3/1,000 (15.7 in 2022), Middle East & Africa 6.02, North/South America 5.5 each, Asia-Pacific 3.1; industry spent ~US$5bn tracing lost luggage. — [SITA press release](https://www.sita.aero/pressroom/news-releases/more-air-passengers-than-ever-with-one-of-the-lowest-rates-of-mishandled-baggage-thanks-to-tech-investments/); [Aviacionline](https://www.aviacionline.com/english/commercial-aviation/report-airlines-are-losing-fewer-bags-than-ever-as-mishandled-rate-hits-record-low_a6a46b6e08f397eeb8e442c95); [Runway Girl Network](https://runwaygirlnetwork.com/2025/06/europe-cuts-mishandled-baggage/); [BusinessDay](https://www.businessday.co.za/bd/companies/transport-and-tourism/2025-06-29-global-airlines-shell-out-5bn-to-trace-lost-luggage/)
- SITA Baggage IT Insights 2026 (2025 data): rate fell 23% to 4.9 per 1,000; ~24m bags; cost US$6.3bn at US$260 per bag (replacing the US$150 benchmark); delayed bags ≈70% of cost, averaging US$245 (US$170 operational + US$75 compensation); transfer baggage 39% of cases (41% prior year); WorldTracer + Apple Find My integration cut permanently lost bags by 90% in year one and shortened delayed-bag recovery time by 26%. — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/baggage/mishandled-bag-rates-fell-by-23-in-2025-yet-still-cost-industry-us6-3bn.html); [Travel Daily News](https://www.traveldailynews.com/aviation/baggage-mishandling-drops-23-as-digital-technology-transforms-airport-operations/); [SITA 2026 report PDF](https://www.sita.aero/globalassets/docs/surveys--reports/sita_2026_it_baggage_report_digital.pdf)
- Resolution 753 came into effect June 2018 and requires tracking at four points (acceptance, loading, transfer, arrival); 2024 survey of 155 airlines and 94 airports: 44% of airports fully implemented, 41% in progress. — [Travel Extra](https://www.travelextra.ie/four-point-resolution-753-baggage-tracking-installed-by-44pc-of-worlds-airports-iata/); [Business Traveller](https://www.businesstraveller.com/business-travel/2024/05/13/iata-industry-making-progress-to-reduce-baggage-mishandling/)
- IATA R753 Annual Report 2025 (Dec 2025): 80.1% of 256 in-scope member airlines have a defined implementation plan; no dynamic real-time global compliance tracker exists; 75.3% of airlines would use one. — [IATA R753 Implementation Executive Report 2025](https://www.iata.org/contentassets/cb691a38573642d0bbfd2ba380eaf04e/americas-focus-2025/documents/iata-r753-implementation-executive-report-2025.pdf)
- Emirates received Resolution 753 certification for Dubai baggage operations; Qatar Airways reported as first airline to achieve 753 compliance at Hamad. — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/baggage/emirates-receives-resolution-753-certification-for-dubai-airport-baggage-operations.html); [Travel Daily News](https://www.traveldailynews.com/aviation/qatar-airways-achieves-compliance-with-iata-resolution-753-certification/)
- IATA RFID programme page (baggage RFID inlays as the recommended tracking technology). — [IATA RFID](https://www.iata.org/en/programs/ops-infra/baggage/rfid/)
- 66% of European airlines offer automated bag drop, 16% more plan to by 2027. — [Travolution](https://www.travolution.com/news/advanced-tech-sees-europes-mishandled-bag-rate-drop-a-quarter/)

### Inferences

- A baggage module claiming "Resolution 753 tracking" must record at least four timestamped scan events per bag (accepted, loaded [per flight/ULD/compartment], transferred [inbound→outbound custody], delivered/arrived) keyed by the 10-digit bag tag licence plate, exchange them via BSM/BPM-style messages or an API with the handler/airport BRS, and reconcile loaded bags against the passenger boarded list (no bag flies without its passenger unless rush-tagged). Mishandling KPIs should be expressed per 1,000 passengers to match SITA benchmarks (4.9 global in 2025; ~6 for MEA in 2024).
- Transfer handling (39% of mishandling) is where minimum-connection-time and inbound-scan logic matter most; a module without a transfer custody event misses the main cause.

### Gaps

- Primary SITA Baggage IT Insights 2025 PDF could not be fetched (host blocked); figures come from press coverage.
- Regional 753 compliance percentages in the IATA 2025 report (e.g., ~92% Asia-East, ~91.7% Americas) appeared only in a garbled excerpt and are unverified.
- No current pricing/feature detail found for SITA Bag Journey or third-party BRS vendors (e.g., Brock, Amadeus BRS).

---

## Key Question 7 — Credible operational data integrations (ACARS/OOOI, ADS-B tracking APIs, weather, A-CDM)

### Takeaway

Publicly integrable feeds exist for flight tracking (FlightAware AeroAPI pull API, ~2-week history, per-query pricing from ~US$0.002; Firehose streaming for airline scale) and weather (aviationweather.gov Data API, redeveloped 2025, JSON/GeoJSON METAR/TAF, 15-day history, anonymous access). A-CDM integration centres on TOBT (handler-owned readiness estimate) and TSAT (ATC-issued start-up time) with up to 16 milestones per flight; Germany's six A-CDM airports exceeded 2019 TOBT accuracy in 2025 and Australia's four majors went live in 2025.

### Cited Findings

- FlightAware AeroAPI: query-based pull API for real-time tracking and recent history, ~two-week lookback, pricing per query from about US$0.002; Firehose is push streaming with history to 2009 "aimed at enterprise and airline-scale software"; METAR/TAF listed as an airport weather data type; suggested uses include scheduling integrations, post-flight analysis and FIDS. — [FlightAware APIs](https://zh-tw.flightaware.com/commercial/data)
- aviationweather.gov Data API: machine-to-machine access with OpenAPI spec; e.g. `api/data/metar?ids=<ICAO>&format=json`; METAR in raw/JSON/GeoJSON/CSV/XML, TAF in raw/JSON/GeoJSON/XML; HTTP 204 for valid request with no data; ~15 days of history; API redeveloped in 2025 (old `/cgi-bin/data/metar.php` paths replaced by `/api/data/metar`, some JSON fields removed); anonymous requests supported per third-party listings. — [aviationweather.gov Data API](https://aviationweather.gov/data/api/); [Testbed upcoming changes](https://testbed.aviationweather.gov/help/upcoming/); [API Evangelist listing](https://providers.apievangelist.com/providers/aviationweather/)
- A-CDM: airlines/handlers monitor up to 16 milestones per flight to produce reliable TOBT; a SESAR2020 project with AENA aimed to reduce milestones to ~7 and automate TOBT. — [Eurocontrol](https://www.eurocontrol.int/news/automating-elements-cdm-regional-airports); [International Airport Review](https://www.internationalairportreview.com/news/63995/eurocontrol-acdm-concept-regional-airport)
- TOBT is the forecast of "aircraft ready" and the ground handler is responsible for input; TSAT is derived from TOBT and AO/GH confirm TOBT quality before TSAT issue. — [Hamburg Airport A-CDM CSA tool data](https://www.hamburg-airport.de/resource/blob/2054/ad168888c0ca0c404e337d4a3fd201ba/acdm-csa-tool-data.pdf); [ICAO MID A-CDM milestones (2023)](https://www.icao.int/MID/Documents/2023/ACDM/PPT_5%20-%20ACDM%20Milestones%20approach.pdf)
- Germany 2025 A-CDM KPI report: all six A-CDM airports achieved TOBT performance levels that in some cases significantly exceeded the 2019 pre-crisis benchmark. — [Munich Airport A-CDM KPI report 2025](https://www.munich-airport.com/_b/0000000000000043130519bb6a983155/acdm-ger-kpi-jahresbericht-2025en.pdf)
- Australia A-CDM go-lives 2025: Brisbane 19 Mar, Perth 12 Jun, Sydney 7 Aug, Melbourne 4 Sep. — [Airservices Australia AIP SUP](https://www.airservicesaustralia.com/aip/current/sup/s25-h182.pdf)
- Amadeus Altéa interlines with Sabre, TravelSky and Navitaire via AIRIMP (third-party listing). — [Aviation Souk](https://www.aviationsouk.com/products/amadeus-altea-dcs/)

### Inferences

- A credible ops platform should ingest: (1) a flight-tracking feed (AeroAPI/Firehose or ADS-B equivalent) for actual OUT/OFF/ON/IN or estimated times when ACARS is unavailable; (2) METAR/TAF for origin/destination/alternates from aviationweather.gov (free) with 204 handling and 2025 path changes; (3) A-CDM fields (EOBT, TOBT, TSAT, TTOT, ASAT, AOBT) with TOBT update responsibility assigned to the handler role and milestone events; (4) standard Type-B message in/out (MVT, LDM, PTM, BSM) for interline and handler exchange. Hard-coding scheduled times as actuals, or lacking a TOBT/TSAT concept, would be visible gaps to an airline reviewer.

### Gaps

- No sources on ACARS/OOOI data provision (e.g., via SITA/Collins datalink or FlightAware OOOI) were found; the OOOI query returned only weather material.
- Flightradar24 commercial API terms and NOTAM API sources (FAA NOTAM API / ICAO) were not researched within budget.
- Eurocontrol's current A-CDM Implementation Manual edition was not fetched; milestone definitions come from 2018–2023 airport/ICAO material.

---

## Key Question 8 — What a platform claiming DCS, W&B, load planning, crew assignment, IROPS, biometric boarding, kiosks and bag drop should contain to be credible

### Takeaway

Credibility to an airline reviewer comes from (a) matching the vendor decomposition (Customer Management vs Flight/Load Management; aircraft vs crew vs passenger recovery; pairing vs rostering vs legality), (b) implementing the named calculations and rule limits above with type-specific data rather than fixed constants, (c) exposing the standard messages/integration points (Type-B, CUSS/CUPPS, biometric match APIs, A-CDM fields, weather/tracking feeds), and (d) reporting against industry KPIs (bags/1,000, % auto-reaccommodation, minutes to rebook, TOBT accuracy).

### Cited Findings

- Vendors frame DCS as check-in/boarding plus weight & balance ("Customer Management" + "Flight Management"). — [Amadeus](https://amadeus.com/en/airports/products/altea-dc-for-ground-handlers-customer-management)
- Industry recovery is converging on integrated aircraft + passenger + crew recovery after decades of isolated solving. — [INFORMS Interfaces 2025](https://pubsonline.informs.org/doi/abs/10.1287/inte.2025.0296)
- Reference outcome benchmarks: ~90% automatic re-accommodation, ~10-minute rebooking (Air Canada); 2–3 minutes for a 100-passenger cancellation (SWISS). — [Amadeus Air Canada](https://amadeus.com/en/blog/articles/how-amadeus-helps-air-canada-rebook-disrupted-passengers-in-just-10-minutes); [Amadeus SWISS](https://amadeus.com/en/resources/case-study/swiss-disruption-management)
- Reference baggage benchmark: 4.9 mishandled bags per 1,000 passengers (2025), transfer 39% of cases. — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/baggage/mishandled-bag-rates-fell-by-23-in-2025-yet-still-cost-industry-us6-3bn.html)
- Reference biometric privacy norms: CBP ≤12 h retention for US citizens; EES 3-year retention; consent/opt-out emphasised by member states for digital tools. — [CBP testimony](https://www.cbp.gov/about/congressional-resources/testimony/statement-record-assessing-cbps-use-facial-recognition-technology); [Gulf News EES](https://gulfnews.com/business/tourism/uae-issues-travel-advisory-on-new-eu-entryexit-system-effective-october-12-1.500302756); [Council WK 318/2025](https://data.consilium.europa.eu/doc/document/WK-318-2025-ADD-1/en/pdf)
- Reference crew limits: 900 h/calendar year, 1,000 h/12 months, 100 h/28 days; 13 h basic FDP (acclimatised), +1 h extension max twice/7 days; 14-day roster publication. — [UK CAA ORO.FTL.210](https://regulatorylibrary.caa.co.uk/965-2012/Content/Regs/05140_ORO.FTL.210_Flight_times_and_duty_periods.htm); [PPRuNe](https://www.pprune.org/questions/printthread-605701-easa-flight-time-limitations.html); [UK CAA](https://caa.co.uk/publication/download/15063)
- Reference W&B formula: %MAC = C(I−K)/W + (RefSta−LEMAC)/MAC×100 with per-type constants from AHM 560/565. — [AHM 560 A321 (Scribd)](https://www.scribd.com/document/435843394/AHM-560-Airbus-A321-fleet)

### Inferences (review checklist derived from the findings above)

- **DCS**: flight open/close lifecycle; passenger acceptance with document (APIS) capture and PNL/ADL handling; seat map with blocking/regrade; bag tag licence-plate generation and BSM out; boarding-pass barcode (BCBP) issue and scan; gate offload/no-show; close-out generating passenger/bag counts to load control; standard messages (PTM/PSM/MVT/LDM/CPM). Self-service: web/mobile check-in, kiosk and self bag drop flows that reuse the same acceptance service.
- **W&B / load planning**: per-registration DOW/DOI; standard pax weights by cabin/zone; hold compartments with arm/index and max weights; ZFW/TOW/LAW with index→%MAC; envelope checks at all three weights against MZFW/MTOW(RTOW)/MLAW; underload; stabiliser trim; LMC with limit; loadsheet versioning and sign-off; LDM/CPM output; exception-based automation with controller review.
- **Crew assignment**: pairings/duties distinct from flights; legality engine implementing the FTL limits listed; qualification/recency/expiry checks; acclimatisation and WOCL data captured for FRM; roster publication lead time; recovery (reserve/standby call-out) path.
- **IROPS command centre**: live flight status ingestion (tracking + A-CDM TOBT/TSAT + METAR/TAF); affected-itinerary graph (connections, not just flights); re-accommodation with ranking (own-metal then OAL), automatic notification, self-service choice; duty-of-care automation (hotel when overnight, 3-night cap under extraordinary circumstances, digital meal vouchers issued before departure, unused-balance refund); EU261 eligibility/exposure tracking; human-in-the-loop approvals and audit; KPIs (% auto-reaccommodated, time-to-rebook, EU261 exposure).
- **Biometric boarding / kiosks / bag drop**: consent capture, token lifecycle bound to boarding pass, flight-scoped gallery, retention/purge policy configurable to ≤12 h or 3 years style norms, opt-out fallback, integration adapters for SITA Smart Path / Amadeus-Vision-Box / NEC / Idemia / CBP TVS rather than a home-built recogniser; kiosk/bag-drop flows reuse DCS acceptance and bag-tag services and emit 753 "accepted" events.
- **Baggage**: four 753 events per bag, transfer custody event, bag-to-passenger reconciliation at close-out, WorldTracer-style PIR/tracing hooks, KPI per 1,000 passengers.

### Gaps

- No single public "airline buyer checklist" source for ops modules was found; this checklist is synthesised from vendor decompositions, regulatory limits and KPIs cited above.
- Regulatory primary texts (EASA ORO.FTL tables, CAT.POL.MAB, FAA Part 117/121.693, Regulation (EU) 2026/2202 OJ text) were not fetched due to the session's network allow-list; any reviewer using this checklist should verify exact numeric limits against those texts.
