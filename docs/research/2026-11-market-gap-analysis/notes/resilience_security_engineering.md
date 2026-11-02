# Resilience, Security and Engineering Practices of Production-Grade Airline/Travel Platforms (2022–2026)

Scope note for the report writer: this file benchmarks a self-built Node/TypeScript platform (Express + tRPC, MySQL/TiDB via Drizzle, Redis/BullMQ workers, Stripe, Docker on Railway) against industry expectations. Research method: web search summaries only. In this session every external host (crowdstrike.com, wikipedia.org, docs.stripe.com, easa.europa.eu, iata.org, sita.aero, acronis.com, usenix.org and all news sites tried) failed DNS resolution for WebFetch, and the shared web-search budget was exhausted before the final planned queries. Consequently (a) every finding below rests on search-result summaries rather than full-page reads, (b) several planned items (BA 2017/2019/2023, Ryanair app outages, US DOT ACAA website rule, OWASP Top 10 2025, airline DR RPO/RTO disclosures, Google SRE SLO guidance, expand/contract migration references, Arabic RTL quality reports, Stripe's own webhook docs, the CrowdStrike RCA PDF) could not be sourced and are listed under Gaps instead of being cited from memory. Each "Inference" is phrased as a checkable engineering expectation for the code/ops review.

---

## Key Question 1 — Major airline IT incidents 2022–2026: root causes and post-mortem lessons (dependencies, change management, failover, manual fallback, communication)

### Takeaway

The dominant failure modes in the period were not exotic: a single under-capacity legacy system that could not absorb a surge of changes (Southwest, Dec 2022), an un-staged third-party software update (CrowdStrike/Delta, Jul 2024; United, Sep 2023), a single hardware failure in a primary data centre with no transparent failover (Alaska, Jul and Oct 2025), a single "hub" system whose outage cascaded to dependent systems (United Unimatic, Aug 2025), and breaches via third-party customer-service/contact-centre platforms rather than the airline's core (Qantas, Air France-KLM, 2025) or via a shared passenger-processing vendor (Collins MUSE, Sep 2025). Regulators penalised the customer-facing consequences (refunds, communication), not the technical root cause.

### Cited Findings

**Southwest Airlines, 22–30 Dec 2022 (crew scheduling / SkySolver)**

- The US DOT announced a $140M penalty on 18 Dec 2023 for roughly 17,000 cancellations during the 2022 holidays; a DOT audit found Southwest fell short of refund obligations; $35M was a direct fine, the rest offset by compensation efforts — [ITPro](https://itpro.com/technology/southwest-airlines-hit-with-record-breaking-penalty-for-2022-it-meltdown); [FlightGlobal](https://flightglobal.com/strategy/southwest-hit-with-140m-penalty-for-end-of-2022-network-meltdown/156239.article); [NerdWallet](https://www.nerdwallet.com/article/travel/southwest-faces-140-million-penalty-for-2022-holiday-meltdown)
- DOT later waived the last $11M installment, crediting improved operations — [AirlineGeeks](https://airlinegeeks.com/?p=98895); [View from the Wing](https://viewfromthewing.com/?p=239902)
- The crew-scheduling optimiser SkySolver (GE Digital) is used by other US airlines too; DOT also probed whether an unrealistic schedule preceded the meltdown — [Travel Weekly](https://www.travelweekly.com/Travel-News/Airline-News/DOT-investigating-Southwest-Airlines-scheduling)
- At the 9 Feb 2023 Senate Commerce hearing, COO Andrew Watterson described the scheduling system as the final failure in a chain, saying the volume of changes "overwhelmed our Crew Scheduling processes and technology"; pilot union leaders testified they had warned about the system repeatedly, including after a smaller October 2021 crisis; Southwest pushed a crew-scheduling software update live the day after the hearing after several rounds of testing — [Spokesman-Review](https://spokesman.com/stories/2023/feb/09/we-messed-up-in-holiday-travel-meltdown-southwest-); [ADN/AP](https://adn.com/nation-world/2023/02/09/senators-grill-southwest-airlines-over-holiday-meltdown); [KSL](https://www.ksl.com/article/50575686)
- Cost estimates vary: >$750M including refunds in one account, ~$1.2B across Q4 2022/early 2023 in another — [NPR transcript](https://www.npr.org/transcripts/1219906471); [Wikipedia summary](https://wikipedia.com/wiki/2022_Southwest_Airlines_flight_delays)

**Delta Air Lines / CrowdStrike, 19–24 Jul 2024**

- Delta CEO Ed Bastian said on 31 Jul 2024 the outage cost up to $500M in five days; >5,000 flights cancelled; the crew-tracking system (pairing pilots/flight attendants with flights) was the critical casualty; Delta said it had to manually reset 40,000 servers — [NPR](https://www.npr.org/2024/07/31/nx-s1-5058652/delta-crowdstrike-outage-500-million-dollars); [Business Traveller](https://www.businesstraveller.com/news/delta-faces-loss-crowdstrike-outage/)
- DOT opened an investigation into Delta's response (not the technical cause) — [NPR](https://www.npr.org/2024/07/31/nx-s1-5058652/delta-crowdstrike-outage-500-million-dollars)
- Microsoft's counsel (Aug 2024) asserted Delta refused free help, that its crew-tracking system ran on other vendors' platforms (e.g., IBM), that Nadella's 24 Jul email went unanswered, and that Delta "apparently has not modernized its IT infrastructure" unlike competitors who recovered faster; CrowdStrike's counsel said Delta refused onsite assistance — [heise](https://heise.de/en/news/Microsoft-and-CrowdStrike-counter-Delta-s-claims-for-damages-with-accusations-9826356.html); [AJC](https://www.ajc.com/news/business/microsoft-fires-back-in-response-to-deltas-legal-threats-after-outage/2NBGMXKPKJDILKZUZ7PSDQWWEM); [TechRadar](https://www.techradar.com/pro/microsoft-hits-back-at-delta-says-airline-refused-help-following-crowdstrike-outage-and-even-ignored-an-email-from-satya-nadella-himself)
- A June 2026 aggregator report says DOT closed its probe without major fines, with CrowdStrike litigation and passenger class actions unresolved — this is a low-authority secondary source and should be verified — [Pulse.bot](https://www.pulse.bot/transportation/news/delta-off-the-hook-avoids-major-fines-as-dot-ends-2-year-probe-into-2024-crowdstrike-chaos-83598e7c-037d-43a5-94b3-49d3402586a3/)

**Alaska Airlines, 20 Jul 2025 and 23 Oct 2025 (data-centre hardware)**

- Jul 20 2025: "a critical piece of hardware at its data centers, manufactured by a third-party, experienced an unexpected failure", impacting several key systems; ~3-hour ground stop (approx. 8–11 pm PT); not a hack; vendor replacing hardware; >200 cancellations / >15,000 passengers per one report, >400 cancellations per another — [Spokesman-Review](https://www.spokesman.com/stories/2025/jul/21/alaska-airlines-says-hardware-failure-led-to-it-ou); [Neowin](https://www.neowin.net/amp/alaska-airlines-tells-us-why-more-than-400-of-its-flights-were-cancelled-after-an-it-outage/); [GovTech](https://www.govtech.com/transportation/hardware-failure-it-outage-grounded-alaska-airlines-planes)
- Oct 23 2025: outage from ~3:30 pm PT, systemwide ground stop for Alaska and Horizon lasting nearly eight hours, attributed to "a hardware failure at Alaska's primary data center", not a cybersecurity incident; >49,000 travellers affected per one report — [Free Malaysia Today/AFP](https://www.freemalaysiatoday.com/category/world/2025/10/24/alaska-airlines-grounds-entire-fleet-over-it-outage); [Ground News](https://ground.news/article/alaska-airlines-resumes-operations-after-an-it-outage-grounded-its-flights-for-hours_4ec269); [KIRO 7](https://www.kiro7.com/news/local/alaska-airlines-grounds-all-mainline-flights-nationwide-faa-says/VW4X75B7SZED5MQMY6SCQE57GE/)
- No published root-cause analysis beyond the airline's statements was found — [search summary of above sources]
- Context: in April 2024 Alaska grounded its fleet over an issue in the system that calculates aircraft weight and balance — [AccuWeather](https://www.accuweather.com/en/travel/united-airlines-technical-issue/1803186)

**United Airlines, 5 Sep 2023 (software update) and 6 Aug 2025 (Unimatic)**

- 5 Sep 2023: a software update triggered a glitch that halted departures nationwide for a little over an hour; not a cybersecurity issue; >350 flights delayed (13% of schedule) — [Fortune](https://fortune.com/2023/09/06/united-airlines-halt-all-flight-departures-nationwide-software-update); [NBC News](https://www.nbcnews.com/news/us-news/united-airlines-requests-nationwide-ground-stop-faa-says-rcna103470); [Inquirer](https://www.inquirer.com/business/united-airlines-flights-delayed-canceled-equipment-outage-20230905.html)
- 6 Aug 2025: failure in "Unimatic", which "houses flight information that is fed to other systems including those that calculate weight and balance and track flight times"; FAA ground stops at ORD, DEN, EWR, SFO, IAH; >1,000 flights delayed, dozens to hundreds cancelled; cause not disclosed — [NBC Chicago](https://www.nbcchicago.com/news/local/what-happened-with-united-airlines-a-look-at-the-situation-that-grounded-flights/3805989/?amp=1); [AccuWeather](https://www.accuweather.com/en/travel/united-airlines-technical-issue/1803186); [WECT/CNN](https://www.wect.com/2025/08/07/united-airlines-grounds-flights-due-technology-issue-reports-say)

**Collins Aerospace (RTX) MUSE ransomware, 19–22+ Sep 2025 (shared vendor)**

- MUSE common-use passenger processing software compromised just before midnight Fri 19 Sep 2025; Heathrow, Brussels, Berlin, Dublin, Cork affected; ENISA confirmed a third-party ransomware incident — [Computing](https://www.computing.co.uk/news/2025/security/ransomware-attack-behind-widespread-airport-disruptions-eu-agency-says); [TechRepublic](https://www.techrepublic.com/article/news-eu-airport-ransomware/); [Claims Journal/Bloomberg](https://www.claimsjournal.com/news/national/2025/09/22/333088.htm)
- Brussels asked airlines to cancel 140 of 276 outbound flights on Monday 22 Sep because Collins could not deliver a new secure version of MUSE; Heathrow estimated >1,000 computers could be affected and that Collins' rebuild found the attackers still present; airlines at Dublin, Brussels and Berlin continued with manual boarding workarounds — [Verdict](https://www.verdict.co.uk/airport-cybersecurity-breach-ransomware/); [Acronis TRU](https://www.acronis.com/en-us/tru/posts/arincs-common-use-passenger-processing-system-muse-disruption-impacts-flights-across-europe/)
- HardBit ransomware named in some reports; sold via affiliate programme; not officially confirmed — [Security Affairs](https://securityaffairs.com/?p=182440); [BlackFog](https://www.blackfog.com/ransomware-on-collins-aerospace/)
- Etihad reported longer check-in times, Emirates said operations not significantly impacted during the European airport cyberattack — [Gulf News](https://gulfnews.com/business/aviation/etihad-emirates-update-uae-travellers-as-cyberattack-hits-europe-airports-1.500276852)

**Qantas, disclosed Jul 2025 (third-party contact-centre platform)**

- Qantas detected unusual activity on a third-party platform used by one of its contact centres; up to 6M customers' names, emails, DOBs, phone numbers and frequent-flyer details exposed; no financial data; Qantas did not attribute the attack — [Cybersecurity Dive](https://www.cybersecuritydive.com/news/qantas-customer-data-stolen-cyberattack/752204/); [Infosecurity Magazine](https://www.infosecurity-magazine.com/news/qantas-significant-contact-center/); [Malwarebytes](https://www.malwarebytes.com/de/blog/news/2025/07/qantas-breach-affects-6-million-people-significant-amount-of-data-likely-taken)
- The FBI issued an alert days earlier that Scattered Spider had shifted to the airline industry; the Salesforce-platform vector appears only in lower-profile outlets and is unconfirmed; an Oct 2025 leak of ~153 GB by "Scattered LAPSUS$ Hunters" is reported by secondary sources — [CPO Magazine](https://www.cpomagazine.com/?p=39325); [TechNadu](https://www.technadu.com/?p=611396); [Security Affairs](https://securityaffairs.com/179557/cyber-crime/qantas-confirms-customer-data-breach-amid-scattered-spider-attacks.html)

**Hawaiian Airlines and WestJet, Jun 2025 (Scattered Spider campaign)**

- FBI public warning 21 Jun 2025 that Scattered Spider was actively targeting aviation; the group steals data for extortion and often deploys ransomware; methods are social engineering and known-vulnerability exploitation; Hawaiian disclosed an incident while flights operated as scheduled; WestJet said a cyberattack disrupted internal systems and access to its app and website; Axios sources said Scattered Spider was "likely" behind WestJet, SecurityWeek said attribution for Hawaiian was unclear — [SecurityWeek](https://www.securityweek.com/hawaiian-airlines-hacked-as-aviation-sector-warned-of-scattered-spider-attacks/); [Axios](https://www.axios.com/2025/06/27/aviation-transportation-sector-cyberattacks-scattered-spider); [NBC News](https://www.nbcnews.com/tech/security/american-airlines-targeted-cyberattacks-westjet-hawaii-rcna215645); [CyberScoop](https://cyberscoop.com/scattered-spider-aviation-hawaiian-airlines-cyberattack/)

**Air France-KLM, identified 6 Aug 2025 (third-party customer-service platform)**

- Breach identified 6 Aug 2025 at an unnamed third-party customer-service platform; exposed names, contact details, service-request email subject lines, Flying Blue numbers and (KLM) tier level; no passwords/payment data; number affected undisclosed; CPO Magazine says it bears hallmarks of the ShinyHunters vishing campaign against Salesforce-based service systems (unconfirmed) — [Skift](https://skift.com/2025/08/08/air-france-klm-confirm-data-breach-at-third-party-platform/); [Dark Reading](https://www.darkreading.com/cyberattacks-data-breaches/air-france-klm-data-breach); [SecurityWeek](https://www.securityweek.com/air-france-klm-say-hackers-accessed-customer-data/); [CPO Magazine](https://www.cpomagazine.com/?p=39585)

**Gulf Air, 24 Nov 2023**

- Data breach targeting IT systems potentially compromised email and customer database; flight operations and critical systems "unaffected" — [Shafaq](https://shafaq.com/en/World/Gulf-air-reports-cybersecurity-breach-on-November-24-2023); [TechRadar](https://techradar.com/pro/security/gulf-air-hit-with-data-breach-customer-data-possibly-affected)

**GCC carriers in the CrowdStrike outage, 19 Jul 2024**

- flynas said operations were hit, Etihad warned of limited delays, Jazeera Airways (Kuwait) disrupted; flydubai and Air Arabia unaffected; agencies found no cyber-incident — [Arab News](https://www.arabnews.com/node/2552406/amp); [Gulf Business](https://gulfbusiness.com/?p=291805); [Gulf News](https://gulfnews.com/business/aviation/uae-airlines-dubai-airports-mofa-telecoms-authority-responds-to-microsoft-outages-1.1721381281112)

**Navitaire / Amadeus shared-PSS outages (India, Europe)**

- 3 Dec 2025: IndiGo, SpiceJet, Akasa, Air India Express check-in hit by a third-party outage linked by Business Today to a Microsoft problem; resolved within hours — [Business Today](https://www.businesstoday.in/latest/corporate/story/global-microsoft-outage-leads-to-check-in-chaos-at-airports-flight-delays-across-india-504753-2025-12-03)
- 19 Feb 2026: Navitaire outage in two windows (06:45–07:28 and 08:10–08:25 local) hit IndiGo, Akasa, SpiceJet and Air India Express in India, APAC and parts of Europe; airlines fell back to manual check-in causing long queues at Delhi/Mumbai; Air India (separate platform) largely unaffected; a secondary source attributes it to a planned-maintenance issue — [AirHelp](https://www.airhelp.com/en/flight-disruptions/navitaire-outage-check-in-delays-delhi-mumbai-20022026/); [Aviation Business News](https://www.aviationbusinessnews.com/low-cost/planned-maintenance-issue-caused-navitaire-outage/); [TechStory](https://techstory.in/navitaire-outage-disrupts-airline-operations-in-india-and-europe-check-ins-hit-at-delhi-airport/)
- Historical Amadeus Altea "network issue" (undated in results; >130 airlines on Altea) also blocked fare queries/bookings for agencies on Sabre and Travelport connecting to affected airlines; attributed to technical failure during upgrades at the Erding data centre — [PhocusWire](https://www.phocuswire.com/Amadeus-outage-hit-other-GDSs-as-airline-systems-crashed); [PhocusWire (Erding)](https://www.phocuswire.com/Amadeus-outage-caused-by-technical-failure-during-upgrades-at-Erding-data-centre)

### Inferences (checkable engineering expectations derived from the incidents)

- E1 — Surge capacity of the "recovery path": Southwest failed when the volume of _changes_ (rebooking, crew re-pairing) exceeded system capacity. Check: the platform's rebooking/disruption/IROPS flows and queue workers are load-tested at a multiple of normal change rates, not just normal search/booking rates; BullMQ queues have backpressure, concurrency limits and dead-letter queues; the DB has capacity headroom monitored under disruption scenarios.
- E2 — No un-staged third-party/first-party updates to production: CrowdStrike (Delta) and United's Sep 2023 update both show a single simultaneous rollout breaking everything. Check: Railway deploys are staged (canary or at least staging → production with health gates), dependency updates are pinned and reviewed (lockfile committed, Renovate/Dependabot with CI), and a documented, tested rollback exists for both app and worker images.
- E3 — Recoverability within hours, by design: Delta's days-long recovery (manual reset of 40,000 machines) contrasted with competitors' faster recovery. Check: documented runbooks for full restore of API, worker, Redis and MySQL/TiDB; recovery is rehearsed (restore-from-backup drill with measured time); state that cannot be rebuilt from DB (e.g., Redis-only holds) is identified.
- E4 — Eliminate single hardware/single-datacentre dependencies or make failover automatic and tested: Alaska had two multi-hour ground stops from "a hardware failure at its primary data center". Check: DB has replication/HA (TiDB multi-replica or MySQL replica) with tested promotion; Redis persistence/replication or acceptance that its loss is safe; Railway service region/redundancy and health checks defined; a tested failover exercise log exists.
- E5 — Map hub dependencies and degrade gracefully: United's Unimatic outage cascaded into weight-and-balance and flight-time systems. Check: a dependency map exists for the platform (auth-service, Stripe, email/SMS, Redis, DB); each dependency has a timeout, retry budget, circuit breaker and a defined degraded mode (e.g., search works read-only when payments are down; auth-service outage does not take down public flight search).
- E6 — Manual/offline fallback for customer-facing operations: airlines at Brussels/Berlin/Dublin ran boarding manually for days during the MUSE outage; Indian carriers fell back to manual check-in. Check: the platform can export manifests/passenger lists and e-tickets (PDF/CSV) for offline use; admin DCS/boarding pages have an offline-capable or printable path; a documented "paper mode" procedure exists.
- E7 — Third-party customer-service and contact-centre tooling is in-scope for security: Qantas and AF-KLM were breached via vendors, not core PSS. Check: inventory of every SaaS/vendor holding PII (support desk, email provider, analytics, AI chat vendor); least-privilege API tokens; data minimisation in what is synced to vendors; vendor breach notification clauses; export/deletion capability.
- E8 — Help-desk and account-recovery hardening against social engineering: Scattered Spider's technique set is social engineering of help desks/MFA resets. Check: admin/agent password and MFA reset requires strong identity verification and is logged; privileged roles (admin, super_admin, travel agent) require MFA (the platform has MFA/TOTP — verify enforcement, not just availability); session invalidation on credential change.
- E9 — Communication and refunds are what regulators fine: DOT's $140M Southwest penalty was about refunds and customer treatment. Check: automated refund processing paths exist and are measurable (time-to-refund), customer notifications on delay/cancellation are queued with retry and audit trail, and a status page / mass-notification mechanism exists for outages.
- E10 — Shared-vendor outages affect the whole ecosystem: Amadeus/Navitaire outages took down check-in for many carriers at once. Check: for every external integration (payment, email, maps, GDS/NDC if any) there is an explicit outage playbook and the UI shows honest degraded status rather than generic 500s.

### Gaps

- British Airways 2017 (power/data-centre), 2019 and 2023 outages: not researched before search budget ran out; no citation available.
- Ryanair app/website outages 2024–2025: no results obtained.
- American Airlines ground stops 2023–2025: the United query returned no AA incident; not independently searched.
- Saudi carriers (Saudia, flyadeal): no incident reporting found in the one GCC query; absence of evidence, not evidence of absence.
- CrowdStrike's own RCA (channel file 291 details, staged-deployment commitments): PDF host blocked; not cited.
- Official outcome of DOT's Delta investigation: only a low-authority aggregator claims closure in June 2026; unverified.
- Formal Senate Commerce Committee report on Southwest: only hearing coverage found, no committee report document.
- Collins/MUSE: UK NCA arrest, exact recovery date, and HardBit confirmation not verified (acronis/techrepublic hosts blocked).

---

## Key Question 2 — What regulators and standards require/recommend for aviation IT resilience (NIS2, EASA Part-IS, TSA, Saudi NCA ECC, IATA, ISO 27001/22301, SOC 2)

### Takeaway

Between 2023 and 2026 aviation moved from voluntary cyber guidance to binding management-system obligations: NIS2 classifies air carriers/airports/ATC as essential entities with 24h/72h/1-month incident reporting; EASA Part-IS requires an operating ISMS (aligned with ISO 27001 but aviation-specific) from 16 Oct 2025 / 22 Feb 2026; TSA's March 2023 emergency amendment mandated segmentation, access control, continuous monitoring and patching plans for US airports/airlines; Saudi NCA ECC-2:2024 is the national baseline for critical infrastructure. SITA data shows cybersecurity is the top IT investment priority for most airlines.

### Cited Findings

**EU NIS2 (Directive 2022/2555)**

- Air transport (commercial carriers, airports, ATC) is in the "essential" category — [NCSC Ireland NIS2 Guide](https://www.ncsc.gov.ie/pdfs/NCSC_NIS2_Guide.pdf)
- Reporting cadence for significant incidents: early warning within 24h of awareness (stating whether malicious activity is suspected), notification within 72h (severity, IoCs, initial impact), final report within one month — [SOTA developer guide](https://sota.io/blog/eu-nis2-article-23-incident-reporting-24h-72h-developer-guide); [Presencis Art. 23](https://presencis.com/regulations/nis2/article-23/)
- NIS2 gives no business-hours exemption; airlines need out-of-hours detection and an on-call path to the national authority — [openstatus guide](https://www.openstatus.dev/guides/nis2-incident-reporting-requirements.md)
- Reporting modalities and authorities differ by member state (national transposition) — [NISDUC 2022 presentation](https://encavibs.uni.lu/wp-content/uploads/sites/158/2022/05/NISDUC-2022-NIS1_to_NIS2.pdf)
- IATA published a NIS2 discussion paper in November 2025 (content not retrievable in this session) — [IATA PDF](https://www.iata.org/contentassets/4c51b00fb25e4b60b38376a4935e278b/nis2-directive-discussionpaper-november-2025.pdf)

**EASA Part-IS (Delegated Reg. (EU) 2022/1645 and Implementing Reg. (EU) 2023/203)**

- Applicability: 16 Oct 2025 for organisations under 2022/1645 (e.g., Part-21 POA/DOA); 22 Feb 2026 for 2023/203 including air operators of complex motor-powered aircraft (Part-ORO); 27 Mar 2031 for ground handling at EASA-certified airports — [ILT (Dutch CAA)](https://english.ilent.nl/caa-nl/aviation-safety/part-is); [Jones Day, Feb 2026](https://www.jonesday.com/en/insights/2026/02/civil-aviation-cybersecurity-easa-partis-sets-new-information-security-obligations); [Sofema](https://sassofia.com/wp-content/uploads/2025/11/EASA-ISMS-for-Part-21-J-Part-21-G_R1.pdf)
- EASA expects the ISMS to exist and be working from 22 Feb 2026 (no blanket declaration), with an additional 18 months to reach "Operational/Effective" levels of the PSOE maturity model — [EASA FAQ](https://easa.europa.eu/en/the-agency/faqs/applicability-0); [Ops Group](https://ops.group/blog/?p=29660)
- EASA states ISMS requirements are "in most parts consistent and aligned with ISO/IEC 27001" but with aviation-specific provisions — [EASA news](https://www.easa.europa.eu/en/newsroom-and-events/news/part-regulation-published-completing-regulatory-framework-cyber-resilient); [Centraleyes](https://www.centraleyes.com/easa-part-is/)

**US TSA Emergency Amendment (Mar 2023)**

- TSA-regulated airports and aircraft operators must submit an approved implementation plan covering: network segmentation so OT can keep operating if IT is compromised (and vice versa), access control, continuous monitoring and detection, and timely patching of critical cyber systems; followed a January 2023 directive after the CommuteAir incident — [Industrial Cyber](https://industrialcyber.co/news/network-segmentation-takes-center-stage-in-new-tsa-cybersecurity-amendment-for-airport-aircraft-operators/); [Cybersecurity Dive](https://www.cybersecuritydive.com/news/tsa-cybersecurity-requirements-airlines-airports/644450/); [The Record](https://therecord.media/tsa-emergency-cyber-order-airports)
- Enforcement details were "hazy" at issuance and coordinated directly with stakeholders — [Dark Reading](https://www.darkreading.com/ics-ot-security/tsa-issues-urgent-directive-aviation-cyber-resilient)

**Saudi NCA Essential Cybersecurity Controls ECC-2:2024**

- NCA's official controls page lists ECC 2-2024 as the updated national framework; it applies to government entities and critical infrastructure operators — [NCA controls list](https://nca.gov.sa/en/regulatory-documents/controls-list/ecc); [Clyde & Co, Jan 2025](https://www.clydeco.com/en/insights/2025/01/saudi-arabia-essential-cybersecurity-controls)
- Control counts reported inconsistently: 108 main controls / 92 sub-controls (NCA document per one source) vs 110/90 vs "cut from 114 to 108" — [Secure.com](https://www.secure.com/blog/cybersecurity/ecc-2-2024-gap-assessment); [Axidian](https://axidian.com/blog/nca-ecc-2024-compliance-saudi-arabia/); [Wattlecorp](https://www.wattlecorp.com/saudi-businesses-nca-ecc-update)

**Industry investment signals (SITA)**

- SITA 2024 Air Transport IT Insights (published Feb 2025): 66% of airlines and 73% of airports name cybersecurity a top-three focus; airlines projected to spend ~$37B and airports ~$9B on IT over two years — [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/security/airports-and-airlines-identify-cybersecurity-as-top-it-investment.html); [ITIJ](https://www.itij.com/latest/news/aviation-industry-doubles-down-cybersecurity)
- SITA 2024 North America Airline IT Insights: 77% of NA airlines rank cybersecurity in their top-three 2025 IT priorities, 45% rank it first — [SITA PDF](https://www.sita.aero/globalassets/docs/surveys--reports/2024-sita-north-america-airline-it-insights.pdf); [Cybersecurity Dive](https://www.cybersecuritydive.com/news/airline-north-america-investments-cyber-ai/747253/)
- SITA 2025 Air Transport IT Insights (released ~Apr 2026): record $50.8B tech spend in 2025, airlines $36B (3.6% of revenue); poor data flow between systems/partners is the common bottleneck — [SecurityBrief AU](https://securitybrief.com.au/story/sita-says-fragmented-data-hinders-aviation-tech-spend); [Passenger Terminal Today](https://www.passengerterminaltoday.com/news/it-software/sita-report-highlights-data-coordination-as-key-barrier-to-aviation-it-investment.html)

**ENISA**

- ENISA Transport Threat Landscape (Mar 2023, covering Jan 2021–Oct 2022): ransomware share of transport incidents rose from 13% (2021) to 25% (2022); aviation's most prominent threats were data-related, plus ransomware and malware; hacktivist DDoS against European airports/railways/transport authorities; no reliable reports of cyberattacks affecting transport safety — [ENISA report](https://enisa.europa.eu/publications/enisa-transport-threat-landscape/@@download/fullReport); [Industrial Cyber](https://industrialcyber.co/transport/enisa-reports-ransomware-attacks-most-prominent-threat-against-transport-sector-as-attacks-by-hacktivists-rise/)
- ENISA Threat Landscape 2026 (Sep 2026, covering 2025) exists but its sectoral findings were not readable in this session — [ENISA TL 2026 PDF](https://www.enisa.europa.eu/sites/default/files/2026-09/ENISA%20Threat%20Landscape%202026_Final.pdf)

### Inferences (checkable expectations)

- R1 — Incident response must support 24h/72h/30-day reporting: Check that the platform has (a) centralised, tamper-evident security logging (auth events, admin actions, payment webhooks) retained long enough to reconstruct an incident, (b) alerting that pages a human 24/7, (c) an incident runbook with a severity scale and a template for regulator/customer notification. Even if the operator is outside the EU, partners (EU airports, GDS, corporate clients) will ask for this.
- R2 — An ISMS, not just controls: Part-IS/ISO 27001 expect a risk register, asset inventory, documented policies, incident detection/response/reporting, supplier management and continuous improvement. Check that the repo/ops has: asset and data inventory, a risk register, change-management policy (PR review + CI gates), backup policy with tested restores, access-review cadence for admin roles.
- R3 — Segmentation and least privilege: TSA's core demands translate for a Railway deployment to: DB/Redis reachable only from app/worker services (private networking, no public TCP proxies), separate credentials per service (API vs worker vs auth-service), secrets in Railway variables not in images, read-only DB users for analytics.
- R4 — Continuous monitoring and patching: Check for dependency vulnerability scanning in CI (npm audit/Trivy/Dependabot), container image scanning, a defined SLA to patch critical CVEs, and runtime monitoring of error rates and auth anomalies.
- R5 — Saudi deployments should map controls to NCA ECC-2:2024 domains (governance, defence, resilience, third-party/cloud) and to PDPL for passenger PII; the review should note that no GACA-specific cyber regulation was found in this research (see Gaps).
- R6 — Partner due-diligence readiness: because 66–77% of airlines prioritise cybersecurity, any B2B partner (corporate accounts, travel agents, airports) will likely request a security questionnaire/SOC 2-style evidence. Check that evidence (policies, pen-test report, MFA enforcement, encryption at rest/in transit, backup proofs) can be produced.

### Gaps

- Saudi GACA aviation-specific cybersecurity requirements and NCA CCC (Critical Systems Cybersecurity Controls) applicability to airlines: no source found.
- IATA Aviation Cyber Security roadmap/position papers: not retrieved (iata.org blocked).
- ISO 22301 (business continuity) and SOC 2 expectations from airline partners: no airline-specific source found; left as an inference only.
- NIS2 Article 21 risk-management measure list and management-liability provisions: only summarised by vendor guides; directive text not read.
- Whether a non-EU airline selling to EU customers via a web platform falls under NIS2 (IATA's Nov 2025 paper reportedly covers this) — unread.
- ENISA 2025/2026 aviation-specific statistics — not extracted.

---

## Key Question 3 — Engineering patterns with evidence: inventory consistency, payments correctness, sagas, time zones, DR, chaos, peak load, feature flags, migrations, observability, bot defence, secrets/supply chain

### Takeaway

Evidence in this area came mostly from practitioner write-ups rather than airline primary sources, but the patterns are consistent: seat holds are time-boxed (10–15 min TTL) and claimed with conditional updates or Redis NX locks; payment webhooks are treated as at-least-once and unordered, so handlers dedupe on event ID, acknowledge fast, process asynchronously and reconcile against the provider's Events API; cross-service booking+payment uses outbox + saga with explicit compensation and idempotency keys; large travel platforms (Booking.com) run formal disaster-recovery testing programmes. The loyalty-account-takeover threat is well documented (Alaska Mileage Plan drains, Nov 2025; >50% YoY ATO growth reported by Ravelin).

### Cited Findings

**Seat/inventory holds and overbooking**

- Common design: a hold with TTL of roughly 10–15 minutes for flights; expiry enforced either by a sweeper (e.g., every minute) or checked at read time via a held_until timestamp; a per-row TTL is not a standard relational feature so a worker must enforce it — [TechInterview LLD Airline Reservation](https://www.techinterview.org/post/3233472320/lld-airline-reservation/); [TechInterview Booking/Reservation LLD](https://www.techinterview.org/post/3233473163/lld-booking-reservation-system/)
- Redis key SET with NX + expiry so only one user can claim a seat and abandonment auto-releases — [ResumeLens](https://www.resumelens.org/blog/system-design/designing-a-ticket-booking-system-to-prevent-overselling)
- Optimistic claim via conditional UPDATE (set to held only where still available; zero rows updated means already claimed) or version column; pessimistic/Redis locks for hot flights or multi-seat atomic holds — [TechInterview Ticketing LLD](https://www.techinterview.org/post/3233473808/lld-ticketing-system-design/); [DEV: Designing an Airline Reservation System](https://dev.to/matt_frank_usa/designing-an-airline-reservation-system-157k)
- Overbooking handled as a policy (e.g., up to 110% capacity, resolved at check-in) and tracked per inventory class; seat inventory requires strong consistency while display data can be eventually consistent — [TechInterview Ticketmaster design](https://www.techinterview.org/post/3233474396/system-design-design-ticketmaster-event-ticketing-seat-selection-virtual-queue-flash-sale-inventory-dynamic-pricing/); [Spawn08 event booking](https://spawn08.github.io/system-design-interview/software_system_design/event_booking/)

**Payment webhooks (Stripe) and exactly-once effects**

- Providers deliver webhooks at-least-once; duplicates and out-of-order arrival are the baseline to design for — [Hookdeck: Webhooks at Scale](https://hookdeck.com/blog/webhooks-at-scale)
- Stripe event IDs (evt\_...) are stable across retries; record them in a processed-events table with insert-on-conflict-do-nothing before any side effect — [Inquir: Idempotency](https://inquir.org/blog/idempotency-making-webhooks-and-jobs-safe-to-retry); [Alex Cloudstar: Stripe Webhooks in Production](https://www.alexcloudstar.com/blog/stripe-webhooks-production-2026/)
- Guard against stale events by only overwriting when the incoming event is newer; re-fetch the current object from the API instead of trusting the payload so the DB converges regardless of order — [Hookdeck](https://hookdeck.com/blog/webhooks-at-scale); [DEV: Webhook best practices](https://dev.to/henry_hang/webhook-best-practices-retry-logic-idempotency-and-error-handling-27i3)
- Acknowledge with 2xx quickly and process asynchronously (queue-first) to avoid timeouts and retry storms; reconcile using the provider's Events API rather than full re-fetches — [Hookcap](https://hookcap.dev/blog/webhook-best-practices-retry-idempotency-error-handling); [viaSocket](https://viasocket.com/blog/webhook-retries-and-idempotency-building-reliable-delivery-into-your-integration-layer)

**Outbox and saga for booking + payment**

- Outbox: write the event to an outbox table in the same DB transaction as the business change; a relay publishes and deletes — [TechInterview: Distributed Transactions](https://techinterview.org/system-design-distributed-transactions/)
- "Exactly-once" effects come from idempotent consumers (unique event IDs + dedup), not the transport; at-least-once delivery is acceptable with idempotent consumers — [DEV: Event-driven booking systems](https://dev.to/airtruffle/event-driven-microservices-for-booking-systems-managing-distributed-transactions-at-scale-4pai)
- Saga: if payment fails, orchestrator calls compensation to release the inventory hold and refund any pre-authorisation; some compensations are semantic/best-effort (e.g., apology email) so irreversible steps should be last; use idempotency_key = saga_id + step_name stored with the result to stop a retried charge applying twice — [DEV: Saga patterns in travel](https://dev.to/airtruffle/event-driven-microservices-for-booking-systems-saga-patterns-and-eventual-consistency-in-travel-5g9i); [Distributed transactions guide](https://dingjiu1989-hue.github.io/en/tech/distributed-transactions-guide)

**Disaster recovery / chaos at travel platforms**

- Booking.com presented "Disaster Recovery Testing at Booking.com" at USENIX SREcon22 EMEA (Oct 2022): an established programme to test the impact of disasters and the recovery mechanisms in place — [USENIX](https://usenix.org/conference/srecon22emea/presentation/fouquet)
- Booking Holdings Romania has a team whose remit is "Booking.com's chaos engineering platform ... to maximize service reliability through resilience testing" — [DevTalks speaker profile](https://www.devtalks.ro/speakers/732-sorin-mihailescu)
- Expedia has presented "Expedia's journey toward site resiliency" (InfoQ slides; year not shown) — [SlideShare/InfoQ](https://es.slideshare.net/InfoQ/expedias-journey-toward-site-resiliency)

**Loyalty account takeover, credential stuffing and bots**

- Alaska Mileage Plan members had miles drained after account takeovers, typically redeemed for resale/gift cards; Ravelin survey: travel companies report >50% rise in ATO attacks over the past year and expect the pace to continue; loyalty currencies are "worth billions" — [Anchorage Daily News, 29 Nov 2025](https://www.adn.com/alaska-news/aviation/2025/11/29/they-were-saving-up-alaska-air-miles-then-their-accounts-got-drained/)
- Credential stuffing via bots, phishing/typosquat domains, MFA bypass, and redemption within minutes of access are the described playbook; defences include re-verifying at login and on password/contact changes, device/booking/payment signals, MFA and behavioural analytics (vendor sources) — [myNetWatchman](https://mynetwatchman.com/blog/stolen-miles-account-takeover-travel/); [ICT Security Magazine](https://www.ictsecuritymagazine.com/notizie/furto-miglia-cybercrime/)

### Inferences (checkable expectations for the Node/tRPC/Drizzle/BullMQ/Stripe platform)

- P1 — Seat hold lifecycle: bookings in `pending` must carry an explicit expiry (10–15 min typical); a BullMQ delayed job or sweeper releases expired holds and inventory; `flights.availableSeats` decrements use a conditional UPDATE (`WHERE availableSeats >= n`) or row lock inside a transaction, never read-then-write; a DB-level invariant (CHECK/unique index or non-negative constraint) is the backstop; multi-passenger bookings hold atomically.
- P2 — Webhook handler contract: verify Stripe signature; insert `stripe_event_id` into a unique-keyed processed-events table first (ignore on conflict); return 2xx fast and enqueue processing; handle `checkout.session.completed`, `payment_intent.succeeded/failed`, `charge.refunded` idempotently; never trust payload amounts over a server-side re-fetch of the PaymentIntent; log and alert on handler failures; a dead-letter queue exists.
- P3 — Reconciliation job: a scheduled worker compares Stripe PaymentIntents/Charges (via Events or list API) against `payments` rows for the last N hours and flags mismatches (paid-in-Stripe but pending-in-DB, or refunded-in-Stripe but paid-in-DB); split-payment shares are included.
- P4 — Idempotency keys on outbound Stripe calls: every PaymentIntent/Checkout/Refund creation passes an idempotency key derived from booking/share ID so retries never double-charge or double-refund.
- P5 — Booking saga: the state machine `pending → confirmed → completed/cancelled` has explicit compensation (release seats, void voucher/credit usage, reverse loyalty accrual) for payment failure/expiry, and e-ticket generation/email are the last, retryable steps; side effects (emails, notifications) go through an outbox or a queue written in the same transaction scope, not fire-and-forget after commit.
- P6 — Time-zone correctness: flight `departureTime/arrivalTime` stored as UTC instants plus airport IANA zone (or as local time + zone) and rendered in airport-local time; tests cover DST transitions and overnight arrivals (no source retrieved in this session — see Gaps — but the expectation is standard).
- P7 — DR evidence: a written RPO/RTO target for the booking DB; automated backups with restore tests; replication for MySQL/TiDB; Redis treated as cache/queue with job data recoverable; at least one tabletop or real failover drill per year (Booking.com-style programme scaled down).
- P8 — Peak handling: load tests of search and checkout at sale-event multiples; rate limiting per IP/user/session on search, login, voucher validation and payment endpoints; queue-based throttling for e-ticket/email bursts.
- P9 — Bot and ATO defence for loyalty/accounts: MFA offered and enforced for admins; login rate limiting plus credential-stuffing detection (failed-login velocity, new-device notification); step-up verification before redeeming miles/credits or changing email/phone; audit log of redemptions; CAPTCHA/WAF/CDN bot rules on search and login; monitor scraping of fare search.
- P10 — Safe schema changes: migrations are expand/contract (add nullable column → backfill → switch reads → drop) and never run destructive DDL in the same deploy as the code that depends on it; `drizzle/migrations` applied before new code is live, with rollback plan (no source retrieved — see Gaps).
- P11 — Observability: structured request logs with correlation IDs across tRPC → services → BullMQ jobs; metrics for search latency, booking success rate, webhook lag, queue depth; SLOs for search/booking availability and latency with alerting on burn rate (SRE guidance not retrieved — see Gaps).
- P12 — Secrets and supply chain: no secrets in repo or images; Railway variables per environment; lockfile pinned; CI runs `npm audit`/Trivy on dependencies and images; SBOM generated for releases (SLSA/Trivy sources not retrieved — see Gaps).

### Gaps

- Stripe's official webhook documentation (retry schedule, ordering, signature tolerance window) could not be fetched; findings rely on third-party guides. Recommend the writer cite docs.stripe.com/webhooks directly if accessible.
- microservices.io (Chris Richardson) outbox/saga canonical pages did not appear in results; patterns are cited from practitioner blogs.
- Airline-published RPO/RTO targets or multi-region active-active case studies (AWS/Google Cloud): not found before budget exhausted.
- Chaos engineering at Skyscanner/Expedia 2023–2024 talks: not found; only an undated Expedia resiliency deck and a 2022 Booking.com DR-testing talk.
- Time-zone/DST incidents in airlines, feature-flag practice, expand/contract migration references, OpenTelemetry/SLO guidance, OWASP Top 10 2025 and ASVS, SBOM/SLSA: planned queries were not executed (budget). These expectations (P6, P10–P12) are stated as standard practice but lack a citation in this file.
- Independent (non-vendor) statistics on airline bot/scraping volumes and ATO losses: none found; Ravelin figure is a vendor survey.

---

## Key Question 4 — AI in airline customer servicing 2024–2026: deployments, failures, expected guardrails, EU AI Act obligations

### Takeaway

The Air Canada ruling (Moffatt v. Air Canada, 2024 BCCRT 149, 14 Feb 2024) established that an airline is liable for what its chatbot says exactly as for any page on its website, and that pointing to a contradicting policy page is not a defence. Since 2 Aug 2026 the EU AI Act Article 50 requires any chatbot to disclose that the user is interacting with AI (penalties up to EUR 15M or 3% turnover), while high-risk Annex III obligations were pushed to Dec 2027. Industry deployments (Korean Air, American, Air India) emphasise citation/grounding and human escalation; consumer willingness to let AI modify bookings unsupervised is very low (2% in one 2025 survey).

### Cited Findings

- Moffatt v. Air Canada: Jake Moffatt booked in Nov 2022 after the website chatbot said he could claim bereavement fares retroactively; the BC Civil Resolution Tribunal (decision 14 Feb 2024, member Christopher Rivers) rejected Air Canada's "remarkable" argument that the chatbot was a separate entity responsible for its own actions, held the airline failed to take reasonable care to ensure the chatbot was accurate, and said the airline is responsible for all information on its website whether static page or chatbot; Air Canada said it would comply — [CTV News BC](https://bc.ctvnews.ca/air-canada-s-chatbot-gave-a-b-c-man-the-wrong-information-now-the-airline-has-to-pay-for-the-mistake-1.6769454); [Law360 Canada](https://www.law360.ca/ca/articles/1804075); [Mondaq](https://www.mondaq.com/canada/new-technology/1427926/airline-ordered-to-compensate-a-bc-man-because-its-chatbot-provided-inaccurate-information); [CBS News](https://www.cbsnews.com/news/aircanada-chatbot-discount-customer)
- Damages reported inconsistently: ~C$483 overcharge + fees/interest, C$650.88 damages + C$125 fees + C$36.14 interest, or C$812.02 total — [Global News](https://globalnews.ca/news/10297307/air-canada-chatbot-error-bc-ruling); [Daily Hive](https://dailyhive.com/canada/air-canada-chatbot-decision); [Manatt](https://manatt.com/insights/newsletters/advertising-law/ai-gone-wild-airline-has-to-honor-a-refund-policy)
- EU AI Act Article 50 transparency duties (tell users they are interacting with AI; label AI-generated content) became enforceable 2 Aug 2026 and apply to bots already in use; Annex III high-risk obligations deferred to 2 Dec 2027 via the Digital Omnibus; penalties up to EUR 15M or 3% of worldwide turnover — [CEPIS](https://cepis.org/eu-ai-act-transparency-rules-enter-into-force/); [Silicon Canals](https://siliconcanals.com/the-eus-ai-act-starts-requiring-chatbot-and-deepfake-labels-on-august-2-while-its-tougher-rules-on-hiring-biometrics-and-migration-are-pushed-back-to-december-2027/); [Matheson](https://www.matheson.com/insights/eu-ai-act-transparency-rules-are-now-live-are-you-ready/); [Malwarebytes](https://www.malwarebytes.com/blog/news/2026/08/the-ai-act-kicks-into-action-forces-companies-to-be-clear-about-ai-bots)
- A customer-service bot that answers FAQs, tracks orders or hands off to a human is "very likely limited-risk" under the Act, so transparency is the main duty — [Law & More](https://lawandmore.eu/blog/is-your-chatbot-ready-for-the-eu-ai-act-a-compliance-checklist-for-dutch-businesses)
- Korean Air launched a generative AI chatbot across web and app with a focus on citations and a verification database to address accuracy because answers can affect fees — [AltexSoft](https://www.altexsoft.com/travel-industry-news/korean-air-launches-generative-ai-chatbot-across-web-and-app/)
- Industry practice: simple repetitive queries are automated; complex cases (multi-city rebooking in a storm) go to humans with AI assist; deployed agentic systems remain policy-controlled with human handoff for exceptions — [Level AI](https://thelevel.ai/blog/ai-in-airline-contact-centers-use-cases-benefits-and-best-practices); [ePlaneAI](https://www.eplaneai.com/ar/news/agentic-ai-could-transform-airline-operations)
- 2025 travel study: only 2% of consumers currently willing to let AI make and modify bookings without human oversight — [MacMyths summary](https://macmyths.com/how-agentic-ai-is-changing-airlines-and-your-next-trip/)
- American Airlines reportedly introduced a generative-AI rebooking system with real-time alerts; Air India's chatbot reportedly has a 93% containment rate (benchmark blog, unverified) — [ePlaneAI](https://www.eplaneai.com/news/airlines-introduce-ai-rebooking-systems-to-cut-call-center-wait-times-in-2026); [DEV listicle](https://dev.to/hoe_shilee_b3aa96e0da49e/best-5-ai-support-agents-for-airlines-in-2026-2fpf)
- North American airlines are prioritising both cybersecurity and AI in IT investment (SITA 2024 NA report) — [PhocusWire](https://www.phocuswire.com/sita-it-investment-north-america-airlines-ai-cybersecurity)

### Inferences (checkable expectations for the platform's `/ai-chat` assistant)

- A1 — Grounding: fare rules, refund/change policies, baggage allowances and voucher terms given by the assistant must come from the platform's own policy data (retrieval over versioned policy records), with the source policy shown/linked; the model must not free-generate policy text (Moffatt).
- A2 — Transactional guardrails: the assistant must not confirm bookings, refunds, rebookings or credit redemptions without a deterministic server-side action with the same validation as the tRPC mutation, and ideally explicit user confirmation; anything it "promises" must be enforceable by the system.
- A3 — Disclosure: a persistent, clear "you are chatting with an AI assistant" label in AR and EN at conversation start (EU AI Act Art. 50 from 2 Aug 2026).
- A4 — Human handoff: an always-available escalation path to a human/contact channel, triggered automatically on low confidence, complaint, disruption or refund disputes.
- A5 — Audit log: every assistant conversation and tool call is stored with timestamps, the policy versions cited, and the user ID so disputes (like Moffatt's) can be reconstructed; retention aligned with PDPL/GDPR.
- A6 — Evaluation: a regression test set of policy questions (bereavement, refund windows, change fees, baggage) run before each prompt/model change, with a "no fabricated fare rules" acceptance criterion.
- A7 — Data protection: PII sent to the LLM vendor is minimised; the vendor is in the third-party inventory (ties to E7).

### Gaps

- Primary text of 2024 BCCRT 149 not read; exact damages unverified.
- Official Commission Article 50 guidelines and Official Journal text not read; timelines rest on law-firm/vendor commentary.
- Specific guardrail disclosures from United, Delta, Lufthansa, Emirates or Saudia for their AI assistants: none found.
- No source found on AI-assistant failures in aviation after Moffatt (e.g., hallucinated compensation under EU261) — absence may reflect search limits.

---

## Key Question 5 — Accessibility and UX quality expectations (WCAG 2.2, EU Accessibility Act 2025, US ACAA rule), mobile/PWA, Arabic RTL quality

### Takeaway

The European Accessibility Act applied from 28 Jun 2025 to airline websites, apps, e-ticketing, check-in machines and real-time travel information; national regulators (e.g., Ireland's IAA) enforce it for air passenger transport services. The commonly cited technical baseline is EN 301 549, which incorporates WCAG 2.1 AA; one source disputes that the EAA names a standard at all. Nothing on WCAG 2.2, the US DOT/ACAA website rule, PWA adoption or Arabic RTL quality was obtained in this session.

### Cited Findings

- The EAA took effect 28 Jun 2025 and covers, for air transport, websites and mobile apps of transport service providers, electronic ticketing and check-in machines, real-time travel information services and self-service terminals — [accessible.org: EAA and transportation](https://accessible.org/eaa-transportation-services/); [European Disability Forum](https://www.edf-feph.org/eu-accessibility-act/); [Bird & Bird](https://twobirds.com/en/insights/2024/global/european-accessibility-act)
- EN 301 549 is the harmonised standard referenced for the EAA and incorporates WCAG 2.1 Level AA as the core baseline for websites/apps — [TestParty EAA guide](https://testparty.ai/blog/european-accessibility-act-guide); contradicted by [accessible.org](https://accessible.org/eaa-transportation-services/), which says the EAA does not reference a specific standard and focuses on functional needs
- In Ireland the IAA is responsible for ensuring air passenger transport services comply with EAA accessibility requirements — [IAA: Airline digital accessibility](https://www.iaa.ie/consumer-protection/airline-digital-accessibility)
- ACI Europe has published material on the EAA for airports — [ACI Europe attachment](https://aci-europe.org/component/attachments/attachments.html?id=3452)

### Inferences (checkable expectations)

- X1 — Target at least WCAG 2.1 AA (EN 301 549) across the React/Tailwind/shadcn client, with automated checks (axe/Lighthouse) in CI and manual screen-reader passes on search → passenger details → payment → e-ticket, since these are the EAA-scoped "electronic ticketing" flows.
- X2 — The platform's existing accessibility tooling, dark mode, cookie consent and PWA (listed in CLAUDE.md Phase 4) should be verified for real conformance (keyboard navigation, focus order, contrast, form error announcements, alt text on boarding pass/QR), not just presence.
- X3 — Real-time information (gate changes, delays, GateChangeAlert) must be accessible (live regions, not colour-only) because real-time travel information is explicitly in EAA scope.
- X4 — Arabic RTL: although no sourced evidence was obtained, the AR/EN i18n in this platform should be checked for mirrored layouts, bidi handling of flight numbers/PNRs/times inside Arabic text, numeral formatting, date/time locale, and RTL-safe components from shadcn/Radix (noted as unsourced expectation).

### Gaps

- WCAG 2.2 (published Oct 2023) and whether any aviation regulator has adopted it: not searched before budget exhausted.
- US DOT ACAA website/kiosk accessibility rule (14 CFR Part 382, WCAG 2.0 AA requirement for airline websites and kiosks): search not executed; no citation available.
- Airline mobile-first/PWA adoption statistics (e.g., SITA passenger IT insights): not retrieved.
- Arabic RTL quality issues reported for Gulf airline apps: search not executed; no evidence either way.
- EAA transition periods for existing services/contracts (reported elsewhere as up to 2030 for some services) not verified here.
