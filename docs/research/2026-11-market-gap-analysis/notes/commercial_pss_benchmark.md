# Commercial PSS and Airline Retailing Platform Benchmark (2024–2026)

Research date: 2 November 2026. Purpose: a factual benchmark of leading Passenger Service Systems (PSS) and airline retailing platforms against which the self-built AIS Aviation System can be gap-analysed.

Method and limits: this research was done with web search only. Direct page fetches to amadeus.com, sabre.com, t2rl.com, iata.org/airlines.iata.org, phocuswire.com, prnewswire.com, finance.yahoo.com and modernairlineretailing.com were blocked by the session's network allow-list (DNS resolution refused), so vendor module lists below rest on search snippets, trade press and secondary trackers rather than on the vendors' own product pages. Items marked **[vendor marketing]** come from vendor press releases or vendor blogs; items marked **[pre-2024]** are older than the requested window but are included because nothing newer was found. **[secondary]** marks aggregator or tracker sites.

---

## Key Question 1: What modules and capabilities do the leading PSS / retailing platforms offer? (Feature matrix)

### Takeaway

The market has split into two layers: a legacy PNR/e-ticket PSS core (Amadeus Altéa, SabreSonic, Navitaire New Skies, Hitit Crane PAX, IBS iFly RES, SITA Horizon, Radixx Res, etc.) and a new "offer and order" retailing layer sold as modular, cloud-native, AI-labelled products (Amadeus Nevio, SabreMosaic, Navitaire Stratos, Accelya FLX ONE, Hitit Oxygen, FLYR). Only a handful of airlines (Finnair, Saudia, Riyadh Air) were running native Orders in production by late 2025; everyone else runs the legacy core with retailing modules bolted on.

### Cited Findings — vendor by vendor

**Amadeus (Altéa PSS + Nevio retailing)**

- Nevio was unveiled in October 2023 and is "the technology, including NDC capabilities, that Amadeus offers airlines to help them transition to the world of offers and orders and ultimately settlement and delivery" — [Travolution](https://www.travolution.com/news/travel-sectors/air/air-france-klm-becomes-fourth-carrier-customer-of-amadeuss-nevio-solution/) **[trade press]**
- Nevio is described as "a next-generation modular platform" of "AI-native modular solutions"; the first module Lufthansa Group takes is **Delivery Management**, which "works alongside Amadeus Nevio Offer and Order Management"; reports also mention a "digital Journey Pass" and fulfilment tracking — [TTG Asia](https://www.ttgasia.com/2026/01/14/lufthansa-group-selects-amadeus-nevio-to-transform-airline-retailing/); [Skift](https://skift.com/2026/01/07/amadeus-nevio-lufthansa-deal-airline-retail/) **[trade press reporting vendor claims]**
- Nevio "smart bridging" converts Altéa booking records (PNR + e-ticket) into single Order records while the airline keeps running Altéa; Saudia claims to be "the first carrier to convert every PNR and e-ticket into a single Order" — [Amadeus press release](https://amadeus.com/en/newsroom/press-releases/saudia-orders-nevio-accelerate-guest-centric-travel) **[vendor marketing]**; [Aviation Business News](https://www.aviationbusinessnews.com/industry-news/saudia-completes-transition-from-altea-pss-to-nevio-modern-retailing-platform)
- Amadeus "passengers boarded" metric counts airlines using "at least the Amadeus Altéa Reservation and Inventory modules or Navitaire New Skies" — i.e., the Altéa suite is modular (Reservation, Inventory, Departure Control) — [Amadeus FY2025 press release](https://amadeus.com/en/newsroom/press-releases/amadeus-fy-2025-results-revenue-growth)
- Altéa footprint cited in outage coverage: "used by 125 airlines and handles seat inventory, ticketing, boarding and departure control" — [VisaVerge](https://www.visaverge.com/news/amadeus-glitch-triggers-45-minute-airport-check-in-slowdown-worldwide/) **[secondary]**
- Etihad's Altéa deal covered "the full Amadeus Altéa PSS suite, covering web booking, revenue management, and passenger servicing" — [Amadeus press release](https://amadeus.com/en/newsroom/press-releases/etihad-airways-amadeus-next-generation-travel-technology) **[vendor marketing]**
- Amadeus sells Revenue Management separately to Navitaire airlines: IndiGo adopted "Amadeus Segment Revenue Management Flex", fed from its Navitaire New Skies PSS — [Amadeus press release](https://amadeus.com/en/newsroom/press-releases/indigo-selects-amadeus-revenue-management-system) **[vendor marketing]**

**Navitaire (Amadeus) — New Skies PSS + Stratos retailing (LCC/hybrid focus)**

- Ryanair's renewed contract "includes Navitaire's cloud-based New Skies®, Digital Platform, GoNow Agent Day-of-Departure and Travel Commerce ancillary sales solutions" — [Navitaire](https://www.navitaire.com/news-ryanair-navitaire-partnership.aspx) **[vendor marketing]**
- Volotea became "First Navitaire New Skies Airline Operating in the Cloud" (January 2022) — [BusinessWire](https://www.businesswire.com/news/home/20220112005963/en/Volotea-Becomes-First-Navitaire-New-Skies-Airline-Operating-in-the-Cloud) **[pre-2024; vendor marketing]**
- FLYONE's Q1-2025 expansion added "revenue-management, digital-experience and integration capabilities" — [Aviation Tech Radar](https://aviationtechradar.com/providers/navitaire/) **[secondary tracker]**
- Navitaire Stratos (announced with TUI as launch customer on 16 Dec 2025) is "a retailing portfolio for low-cost and hybrid carriers... built on a flexible, cloud-native technology stack and aligns with IATA's Offer and Order standards"; goals cited: "more relevant offers, better conversion, and smarter upsell and cross-sell, including partner content" — [Amadeus press release](https://amadeus.com/en/newsroom/press-releases/navitaire-tui-airline-shape-next-generation-airline-retailing) **[vendor marketing]**; [Travolution](https://www.travolution.com/news/travel-sectors/air/tui-becomes-first-airline-to-sign-up-for-navitaires-next-gen-airline-solution-stratos/) noted "it has taken Navitaire more than a year to name a Stratos launch customer"
- Volotea is adopting Stratos for "AI-orchestrated retailing" — [Travolution](https://www.travolution.com/news/travel-sectors/air/volotea-adopts-navitaires-stratos-for-ai-orchestrated-retailing/)

**Sabre — SabreSonic PSS + SabreMosaic retailing**

- SabreMosaic was announced at T2RLEngage 2024 in London with Virgin Australia as launch customer; Virgin Australia "will continue to rely on SabreSonic PSS and related solutions as it moves toward an Offer and Order environment" — [Sabre investor release](https://investors.sabre.com/news-releases/news-release-details/virgin-australia-partners-sabre-pioneer-modern-airline-retailing) **[vendor marketing]**; [T2RL First View](https://www.t2rl.com/first-views/sabre-announces-its-mosaic-launch-customer/)
- Named Mosaic modules found in coverage: **Air Price IQ** and **Ancillary IQ** (Air Serbia, Virgin Australia) — [ePlaneAI](https://www.eplaneai.com/es/news/sabremosaic-and-the-transformation-of-airline-retailing) **[secondary]**; **Concierge IQ** (generative-AI chat on web, mobile and WhatsApp; Virgin Australia first) — [QuantisNow / Sabre release](https://www.quantisnow.com/insight/sabre-introduces-game-changing-concierge-iq-solution-for-airlines-generative-ai-powered-6288105); **Continuous Revenue Optimizer (CRO)**, "an AI-driven revenue engine for airlines" launched October 2025 — [Yahoo Finance](https://finance.yahoo.com/news/sabre-corporation-launches-ai-driven-104309395.html); **SabreMosaic Travel Marketplace** (NDC aggregation: five tech providers connected in Jan 2026 to access NDC content from 42 airlines) — [MarketChameleon / Sabre release](https://marketchameleon.com/PressReleases/i/2234729/SABR/five-leading-travel-technology-providers-choose-sabremosaic)
- Avelo Airlines became "first LCC to adopt SabreMosaic" (Ancillary IQ) via its Radixx relationship — [QuantisNow](https://quantisnow.com/insight/avelo-airlines-extends-partnership-with-sabre's-radixx®-and-becomes-first-lcc-to-adopt-sabremosaic™-6037758)
- Sabre said it had "over 10 airlines deployed on Mosaic with either proof of concepts or full blown product launches" — [Aviation Business News](https://www.aviationbusinessnews.com/industry-news/t2rlengage-airline-investment-in-modern-retailing-is-taking-off-says-sabre) **[vendor statement]**
- In 2025 Sabre "launched the industry's first agentic APIs and MCP server for travel" and in early March 2026 "unveiled Sabre Mosaic, a unified, AI-first, cloud-based platform" (repositioning of the 2024 product) — [InsiderMonkey Q4-2025 transcript](https://www.insidermonkey.com/blog/sabre-corporation-nasdaqsabr-q4-2025-earnings-call-transcript-1699053/); [Yahoo Finance](https://finance.yahoo.com/news/sabre-sabr-120-2-launching-051054281.html)
- Sabre's AI roadmap for 2026 cites "AI-driven intelligent caching combining predictive models, unified application programming interface and quota-aware shopping" to stabilise look-to-book — [India Outbound](https://indiaoutbound.info/trade-news/agentic-ai-to-lead-transformation-of-airline-retailing-in-2026-sabre/) **[vendor statement]**
- SabreSonic renewals: WestJet renewed its SabreSonic PSS agreement in February 2026 — [Sabre investor release](https://investors.sabre.com/news-releases/news-release-details/sabre-and-westjet-airlines-extend-technology-partnership)

**Radixx (Sabre) Res — LCC PSS**

- Vietravel Airlines renewed its Radixx PSS with Sabre for five more years (June 2025) — [Aviation News Online](https://www.aviationnews-online.com/article/vietravel-airlines-inks-five-year-renewal-of-radixx-passenger-service-system-with-sabre)
- Radixx customers can consume Mosaic modules (Avelo / Ancillary IQ, above).

**Hitit — Crane PAX PSS, Crane IBE, Crane ADS, Crane RM, Oxygen retailing**

- Hitit states "Serving 73 Airlines Across 6 Continents" (June 2025) — [Hitit](https://www.hitit.com/news?page=16) **[vendor marketing]**
- Products named in 2025–2026 wins: Crane PAX + Crane IBE (Basra Airlines, Feb 2026), Crane ADS (Pegasus, Turkish Airlines, AJet) — [Hitit](https://hitit.com/news-updates/basra-airlines-takes-hitits-crane-solutions); [Hitit](https://hitit.com/news-updates/hitit-talks/welcoming-2025-goal-strong-and-sustainable-growth) **[vendor marketing]**
- Hitit "introduced Oxygen as its modern airline retailing platform"; older material uses the "Crane OOMS" name — [modernairlineretailing.com directory](https://www.modernairlineretailing.com/airline-retailing-systems.html) **[secondary]**
- Hitit charges per boarded passenger ("fees per boarded passenger, like Hitit charges") — [AltexSoft](https://www.altexsoft.com/blog/airline-reservation-systems-passenger-service-systems/) **[secondary]**

**IBS Software — iFly RES, iFly RMS, iFly Loyalty**

- iFly RES is IBS's PSS; one directory says "IBS states NDC and One Order certification" — [modernairlineretailing.com](https://www.modernairlineretailing.com/airline-retailing-systems.html) **[secondary]**; IBS product page — [IBS](https://www.ibsplc.com/product/airline-passenger-solutions) **[vendor marketing]**
- 2025 iFly RES activity: Fuji Dream Airlines renewed; SkyUp Airlines implemented iFly RES — [AppsRunTheWorld](https://www.appsruntheworld.com/customers-database/products/view/ibs-software-ifly-res-pss) **[secondary tracker]**

**SITA — Horizon Passenger Management and Distribution**

- Horizon scope at Camair-Co: "reservations, ticketing, pricing and departure control, as well as a loyalty programme and business intelligence" — [African Aerospace](https://www.africanaerospace.aero/cam-air-implements-sita-s-pss-technology.html) **[pre-2024, ~2016]**
- Other named Horizon users: Air Senegal, Air Seoul (2016), Sky Prime Aviation Services (Saudi VIP operator) — [Aviation Week](https://aviationweek.com/aerospace/emerging-technologies/sky-prime-aviation-services-deploying-sitas-next-gen-pss); [AppsRunTheWorld](https://www.appsruntheworld.com/customers-database/products/view/sita-horizon) **[pre-2024; secondary]**
- SITA's (undated) claim: "100 airlines and ground handlers around the globe have used Horizon to board more than 123 million passengers and check in 158 million travelers each year" — [Zawya / SITA release](https://www.zawya.com/en/press-release/sita-unveils-next-gen-passenger-services-system-bd684cmy) **[pre-2024; vendor marketing]**
- SITA's 2025 announcements were connectivity, not PSS: SITA Connect Fly (Sept 2025, DCS-to-workstation secure connectivity) and SITA Managed Satellites (May 2025, 130+ countries) — [Military Aerospace](https://www.militaryaerospace.com/commercial-aerospace/news/55314624/sita-launches-new-secure-connectivity-service-for-faster-airline-passenger-handling); [Runway Girl Network](https://runwaygirlnetwork.com/2025/05/press-release-new-sita-satellite-connectivity-keeps-airports-online/)

**Accelya — FLX ONE (passenger retailing + cargo)**

- FLX ONE Cargo launched April 2025 as "an Open, AI-Driven, Cloud-Native Platform"; in January 2026 Accelya unified cargo and passenger technology on FLX ONE with new leadership — [Accelya](https://w3.accelya.com/resources/press-releases/accelya-unifies-cargo-and-passenger-technology-on-flx-one/); [Air Cargo News](https://www.aircargonews.net/technology/2025/04/accelya-launches-ai-driven-flx-one-cargo-platform/) **[vendor marketing]**
- Accelya claims to power "over 200 airlines"; its FLX Revenue Management page cites integrations with "more than 28 reservation systems" — [Accelya](https://w3.accelya.com/products/flx-revenue-management/) **[vendor marketing]**

**TPConnects**

- Positioned as an NDC/airline retailing platform rather than a full PSS; it connected to the SabreMosaic Travel Marketplace in Jan 2026 — [IIO Outlook](https://iioutlook.com/vendors/aviation) **[secondary]**; [MarketChameleon / Sabre](https://marketchameleon.com/PressReleases/i/2234729/SABR/five-leading-travel-technology-providers-choose-sabremosaic)

**Videcom (VRS), AeroCRS, KIU**

- Videcom: "open architecture that emulates mainframe functionality", aimed at "regional and independent carriers" / "small network carriers" — [Guideflow](https://www.guideflow.com/blog/airline-reservation-software); [T2RL vendor page](https://www.t2rl.net/vendor/detail1.asp?ID=44) **[secondary]**
- AeroCRS 9 Oct 2025 release notes: API changes adding flight date/origin/destination to check-in, seat and ancillary blocks, and a "cancel one leg" feature for round-trip bookings — [AeroCRS support](https://support.aerocrs.com/hc/en-us/articles/30902935010333-9-Oct-2025-Release-Notes) (primary, but a product changelog, not a module list)
- KIU: "cloud product from an Argentina-based vendor" — [Spherical Insights](https://www.sphericalinsights.com/blogs/top-20-companies-in-global-passenger-service-system-market-industry-intelligence-report-by-spherical-insights-2026-2035) **[secondary, low quality]**

**FLYR (Riyadh Air's platform) — not in the original list but now a reference architecture**

- FLYR Offer & Order platform "built on standards developed by the International Air Transport Association under its ONE Order initiative", "developed in collaboration with IBM"; modules: "a shopping cart, dynamic offers, a marketplace, unified order servicing, and a Legacy Translator"; "GDS integrations are already live through the Legacy Translator" — [FLYR](https://flyr.com/resource-hub/flyr-powers-riyadh-airs-debut-as-worlds-first-full-service-airline-built-for-modern-retailing/); [Travel Daily News](https://www.traveldailynews.com/aviation/riyadh-air-launches-with-flyr-offer-order-platform/) **[vendor marketing]**

**Travelport (distribution, not PSS)**

- Travelport+ with "AI-driven Content Curation Layer (CCL) and Content Optimizer" surfaces NDC and EDIFACT offers side by side; 2024–2025 NDC content deals: China Eastern (Jan 2025), Air India (Q4 2024), Lufthansa Group, TAP, BA, United, Delta — [Travelport](https://www.travelport.com/press-release/travelport-secures-ndc-content-from-china-eastern-airlines-with-new-multi-source-content-deal) **[vendor marketing]**; [Travolution](https://www.travolution.com/news/travel-sectors/air/travelport-delivers-british-airways-ndc-content-on-travelport)

**Mercator / dnata (Emirates)**

- Emirates' reservation system MARS and airport system MACS were built by Mercator, the Emirates Group IT arm; MARS "covers booking management, schedule and seat inventory control, fare formulation and ticketing" — [Breaking Travel News](https://www.breakingtravelnews.com/news/article/btn20040629145422540/) **[pre-2024, 2004]**. No 2024–2026 source on Emirates' current PSS was found.

### Feature matrix (evidence-based; "Y" = found in a 2024–2026 source; "Y\*" = vendor claim only; "—" = no evidence found in this research, not necessarily absent)

| Capability                                   | Amadeus Altéa + Nevio                 | Sabre SabreSonic + Mosaic                           | Navitaire New Skies + Stratos   | Hitit Crane / Oxygen | IBS iFly                       | SITA Horizon | Accelya FLX ONE                   | FLYR (Riyadh Air)       | Radixx Res             |
| -------------------------------------------- | ------------------------------------- | --------------------------------------------------- | ------------------------------- | -------------------- | ------------------------------ | ------------ | --------------------------------- | ----------------------- | ---------------------- |
| Legacy PNR/ET PSS core (res, inventory, DCS) | Y                                     | Y                                                   | Y                               | Y                    | Y                              | Y (pre-2024) | — (not a PSS)                     | — (native orders)       | Y                      |
| Native Offer/Order management                | Y (Finnair May 2025, Saudia Jul 2025) | Y\* (Virgin Australia path; Ethiopian "first step") | Y\* (Stratos, no go-live found) | Y\* (Oxygen)         | Y\* (ONE Order cert claim)     | —            | Y\*                               | Y (live 8 Oct 2025)     | —                      |
| Legacy-to-order bridging (PNR→Order)         | Y ("smart bridging")                  | —                                                   | —                               | —                    | —                              | —            | —                                 | Y ("Legacy Translator") | —                      |
| Continuous / dynamic pricing (AI)            | — (not evidenced here)                | Y (Air Price IQ, CRO Oct 2025)                      | Y\* ("AI-orchestrated")         | —                    | —                              | —            | Y\*                               | Y\* ("dynamic offers")  | via Mosaic             |
| Ancillary / bundle optimisation              | —                                     | Y (Ancillary IQ)                                    | Y (Travel Commerce)             | —                    | —                              | —            | —                                 | Y\* (cart, marketplace) | Y (Avelo/Ancillary IQ) |
| Delivery management / journey pass           | Y (Lufthansa first module)            | —                                                   | Y (GoNow day-of-departure)      | —                    | —                              | —            | —                                 | —                       | —                      |
| Generative-AI servicing assistant            | Y\* ("AI-native")                     | Y (Concierge IQ)                                    | —                               | —                    | —                              | —            | —                                 | —                       | —                      |
| Agentic APIs / MCP                           | —                                     | Y (2025)                                            | —                               | —                    | —                              | —            | —                                 | —                       | —                      |
| NDC distribution / marketplace               | Y (distributes Riyadh Air NDC)        | Y (Travel Marketplace, 42 airlines)                 | —                               | —                    | Y\*                            | —            | —                                 | —                       | —                      |
| Revenue management (separate module)         | Y (Segment RM Flex)                   | Y (CRO)                                             | via Amadeus RM                  | Y (Crane RM)         | Y (iFly RMS)                   | —            | Y (FLX RM, 28 PSS integrations\*) | —                       | —                      |
| Loyalty                                      | — (not evidenced)                     | —                                                   | —                               | —                    | Y\* (iFly Loyalty, unverified) | Y (pre-2024) | —                                 | —                       | —                      |
| Cargo on same platform                       | —                                     | —                                                   | —                               | —                    | —                              | —            | Y (Jan 2026)                      | —                       | —                      |
| Cloud deployment                             | Y\*                                   | Y (Google Cloud, per T2RL/Sabre)                    | Y (Volotea first in cloud 2022) | Y\*                  | —                              | —            | Y\*                               | Y\*                     | —                      |
| Per-passenger-boarded commercial model       | Y (revenue per PB reported)           | Y (PB reported)                                     | Y (within Amadeus PB)           | Y (per-PB fees)      | —                              | —            | —                                 | —                       | —                      |

### Gap-analysis checklist (capability inventory a self-built platform should be scored against)

Derived from the capabilities vendors and IATA describe in the sources above; each line cites where the capability is evidenced as a market expectation.

1. Shopping & offers: branded fares/bundles, ancillary catalogue and pricing, dynamic/continuous pricing engine, AI offer assembly — [Future Travel Experience](https://www.futuretravelexperience.com/2026/02/top-ancillary-retailing-trends-to-watch-in-2026/); [Yahoo/Sabre CRO](https://finance.yahoo.com/news/sabre-corporation-launches-ai-driven-104309395.html)
2. Order management: single Order record replacing PNR+ET+EMD; Order ID exposed to customers alongside profile ID — [IATA ONE Order fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-one-order); [BTN (Lufthansa Order ID)](https://www.businesstravelnews.com/Distribution/Lufthansa-to-Adopt-Amadeus-Offer-and-Order-Products)
3. Legacy coexistence: translator/bridging so GDS/EDIFACT partners and interline still work — [FLYR](https://flyr.com/resource-hub/flyr-powers-riyadh-airs-debut-as-worlds-first-full-service-airline-built-for-modern-retailing/); [Amadeus/Saudia](https://amadeus.com/en/newsroom/press-releases/saudia-orders-nevio-accelerate-guest-centric-travel)
4. Delivery: check-in, boarding, bag, day-of-departure agent tools, fulfilment tracking — [TTG Asia](https://www.ttgasia.com/2026/01/14/lufthansa-group-selects-amadeus-nevio-to-transform-airline-retailing/); [Navitaire](https://www.navitaire.com/news-ryanair-navitaire-partnership.aspx)
5. Settlement / payment orchestration (part of IATA's Offer-Order-Settle-Deliver scope) — [T2RL OOSD status report](https://www.t2rl.net/insight/display?ID=816) (title only; paywalled)
6. Servicing: unified order servicing for voluntary changes; generative-AI chat on web/app/WhatsApp — [QuantisNow/Sabre Concierge IQ](https://www.quantisnow.com/insight/sabre-introduces-game-changing-concierge-iq-solution-for-airlines-generative-ai-powered-6288105)
7. Revenue management integrated with PSS data feed — [Amadeus/IndiGo](https://amadeus.com/en/newsroom/press-releases/indigo-selects-amadeus-revenue-management-system)
8. Distribution: NDC API (two-thirds of airlines have started NDC), GDS/EDIFACT, marketplace/aggregator connectivity, agentic-AI/LLM shopping endpoints — [PhocusWire (Accelya/Atmosphere)](https://www.phocuswire.com/ndc-offer-order-accelya-report); [modernairlineretailing.com](https://www.modernairlineretailing.com/blog/2026-10-08-chatgpt-flight-search-agentic-ai-airline-retailing.html)
9. Look-to-book protection: caching, quota-aware shopping — [India Outbound/Sabre](https://indiaoutbound.info/trade-news/agentic-ai-to-lead-transformation-of-airline-retailing-in-2026-sabre/)
10. Loyalty and BI as PSS-adjacent modules — [African Aerospace (SITA Horizon)](https://www.africanaerospace.aero/cam-air-implements-sita-s-pss-technology.html) **[pre-2024]**
11. Operational resilience: manual fallback for check-in/boarding, independence from single third-party dependencies, crew-system resilience (see Key Question 3).

### Inferences

- Every major vendor is marketing "AI-native/AI-first" and "modular", but the only production evidence of native Orders in 2025 is Finnair (May 2025), Saudia (July 2025) and Riyadh Air (Oct 2025). A gap analysis should distinguish "has an Orders data model" from "has retired PNR/ET/EMD".
- Vendors are decomposing the PSS into independently sellable modules (Delivery Management, CRO, Ancillary IQ, Concierge IQ, RM). A self-built platform should be assessed per module, not as one monolith.
- DCS detail (weight & balance, load control, APIS/PNRGOV) was almost absent from 2024–2026 vendor announcements; the news cycle is dominated by retailing, which suggests DCS is treated as mature commodity functionality.

### Gaps

- No 2024–2026 source listed the full module catalogue of Altéa, SabreSonic, New Skies, Crane, iFly, Horizon, Radixx, Videcom, AeroCRS or KIU; vendor product pages could not be fetched (network allow-list). The matrix therefore under-reports mature DCS, W&B, interline, APIS/PNRGOV and revenue-accounting capabilities.
- No independent (non-vendor) functional benchmark or scoring of these platforms was found; the modernairlineretailing.com comparison could not be fetched and its scoring appears to be the author's own.
- No public per-transaction price lists were found for any vendor (see Key Question 2 for the commercial-model proxies that were found).
- Mercator/dnata's current product status and Emirates' current PSS: no 2024–2026 sources found.

---

## Key Question 2: What did airlines actually migrate to in 2024–2026, and why? (incl. Gulf/Saudi angle and commercial models)

### Takeaway

2024–2026 migrations are overwhelmingly "add a retailing layer on top of the incumbent PSS" (Nevio on Altéa, Mosaic on SabreSonic/Radixx, Stratos on New Skies) rather than PSS switches; the exceptions are greenfield Riyadh Air (FLYR, native Offer & Order) and small carriers moving to Hitit/IBS/Navitaire. Saudi Arabia is now the most visible Orders test-bed (Saudia on Nevio, Riyadh Air on FLYR with Sabre CRO and Amadeus GDS distribution, flyadeal on Navitaire).

### Cited Findings — migrations and selections

**Amadeus Nevio customers**

- Finnair (launch customer), British Airways, Saudia, Air France-KLM (Feb 2025, "fourth carrier customer", moving from Altéa to Nevio "for native order capabilities"), Lufthansa Group (Jan 2026, nine airlines incl. Lufthansa, SWISS, Austrian, Brussels; "largest Nevio deal so far") — [Travolution](https://www.travolution.com/news/travel-sectors/air/air-france-klm-becomes-fourth-carrier-customer-of-amadeuss-nevio-solution/); [Air France-KLM newsroom](https://www.airfranceklm.com/en/newsroom/air-france-klm-partners-amadeus-accelerate-modern-airline-retailing-transformation); [Skift](https://skift.com/2026/01/07/amadeus-nevio-lufthansa-deal-airline-retail/); [PhocusWire](https://www.phocuswire.com/lufthansa-amadeus-partner-ai-native-retailing-solution-nevio)
- Lufthansa "will take a phased approach and will decide later which airlines and shopping channels go live for Orders, and when"; its Order ID "is being rolled out gradually and sits alongside Travel ID" — [Travolution](https://www.travolution.com/en/article/lufthansa-group-becomes-amadeuss-next-customer-of-nevio-solution); [BTN](https://www.businesstravelnews.com/Distribution/Lufthansa-to-Adopt-Amadeus-Offer-and-Order-Products)
- Finnair: "On 5 May 2025, Finnair announced a native order—a non-legacy, single, fully digital order—made through its website... followed... in September 2025 by introducing a ready-made ancillary package" — [IATA Airlines magazine](https://airlines.iata.org/2025/12/18/progress-journey-100-offers-and-orders)
- Saudia went live on Nevio Order Management on 16 July 2025 while staying on Altéa, using smart bridging; "one of the first large-scale deployments" — [Aviation Business News](https://www.aviationbusinessnews.com/industry-news/saudia-completes-transition-from-altea-pss-to-nevio-modern-retailing-platform); [Times Aerospace](https://www.timesaerospace.aero/news/technology/saudia-moves-to-orders-with-amadeus-nevio); [Amadeus](https://amadeus.com/en/newsroom/press-releases/saudia-orders-nevio-accelerate-guest-centric-travel)

**Sabre Mosaic / SabreSonic / Radixx**

- Virgin Australia (launch customer, 2024; keeps SabreSonic); Ethiopian Airlines ("first step toward offer-order transformation", 2025); Air Serbia (Air Price IQ, Ancillary IQ, Aug 2025 **[secondary]**); Avelo (first LCC, via Radixx); Riyadh Air (CRO launch partner); WestJet (SabreSonic renewal Feb 2026); Vietravel (Radixx renewal June 2025) — [Sabre](https://investors.sabre.com/news-releases/news-release-details/virgin-australia-partners-sabre-pioneer-modern-airline-retailing); [PR Newswire](https://www.prnewswire.com/news-releases/ethiopian-airlines-takes-first-step-toward-offer-order-transformation-with-sabremosaic-airline-retailing-302607223.html); [ePlaneAI](https://www.eplaneai.com/es/news/sabremosaic-and-the-transformation-of-airline-retailing); [Aviation Business News](https://www.aviationbusinessnews.com/industry-news/t2rlengage-airline-investment-in-modern-retailing-is-taking-off-says-sabre); [Sabre/WestJet](https://investors.sabre.com/news-releases/news-release-details/sabre-and-westjet-airlines-extend-technology-partnership); [Aviation News Online](https://www.aviationnews-online.com/article/vietravel-airlines-inks-five-year-renewal-of-radixx-passenger-service-system-with-sabre)
- Sabre introduced SabreMosaic to the MENA market via a regional event — [Rihlat Travel News](https://rihlattravelnews.com/technology/sabre-introduces-sabremosaic-to-mena-aviation-industry) **[trade press]**

**Navitaire (LCC/hybrid)**

- Jazeera Airways (Kuwait) migrated to the newest New Skies version in May 2025 in a "100-day" migration — [Navitaire](https://www.navitaire.com/news-jazeera-airways-migration.aspx) **[vendor marketing]**
- Ryanair renewed after 25 years; FLYONE and Aeroitalia expanded scope (2025); TUI chose Stratos (Dec 2025); Volotea adopting Stratos; Allegiant selected Navitaire (Aug 2022); Akasa Air, Air Premia, Green Africa listed as customers — [Navitaire](https://www.navitaire.com/news-ryanair-navitaire-partnership.aspx); [Aviation Tech Radar](https://aviationtechradar.com/products/navitaire-new-skies/) **[secondary]**
- Wizz Air: only a 2010 renewal (Open Skies → New Skies) was found; no 2024–2026 contract news — [PhocusWire](https://www.phocuswire.com/Navitaire-renews-pact-with-eastern-European-carrier-Wizz-Air) **[pre-2024]**
- IndiGo runs Navitaire New Skies and added Amadeus Segment RM Flex (approx. early 2025) — [Amadeus](https://amadeus.com/en/newsroom/press-releases/indigo-selects-amadeus-revenue-management-system)

**Hitit / IBS / SITA / others**

- Hitit 2025–2026 wins: TezJet (Jan 2025), Drukair (Mar 2025), Air Montenegro live (Apr 2025), SkyAlps (Apr 2025), Basra Airlines (Feb 2026), FlyGabon (Feb 2026); "Q4 2024 became the most successful quarter in Hitit's history, in terms of new business wins" — [Hitit](https://hitit.com/news-updates/hitit-talks/welcoming-druk-air-skyalps-and-air-montenegro-hitit-ecosystem); [Hitit](https://hitit.com/news-updates/basra-airlines-takes-hitits-crane-solutions) **[vendor marketing]**
- Hitit migrated PIA in "five months instead of an industry-standard of approximately eighteen months", with "no flights canceled" — [Hitit blog](https://hitit.com/news-updates/blog/three-pillars-switching-it-provider-during-and-after-pss-migration-process) **[vendor marketing]**
- IBS iFly RES: Fuji Dream renewal and SkyUp implementation (2025) — [AppsRunTheWorld](https://www.appsruntheworld.com/customers-database/products/view/ibs-software-ifly-res-pss) **[secondary]**
- SITA Horizon: no 2024–2026 airline selection found; Saudi VIP operator Sky Prime is a Horizon user (undated) — [Aviation Week](https://aviationweek.com/aerospace/emerging-technologies/sky-prime-aviation-services-deploying-sitas-next-gen-pss)

**Gulf / Saudi carriers**

- **Riyadh Air**: FLYR partnership announced 9 Oct 2024; "first native transaction went live on October 8, 2025"; first commercial flight Riyadh–London Heathrow 26 Oct 2025, initially for Riyadh Air and PIF employees only; described as "the first full-service carrier to operate on a fully native Offer and Order-based technology" and "the world's first native ONE Order network carrier" — [FLYR](https://flyr.com/resource-hub/flyr-powers-riyadh-airs-debut-as-worlds-first-full-service-airline-built-for-modern-retailing/); [Al Arabiya](https://english.alarabiya.net/News/saudi-arabia/2025/10/26/riyadh-air-s-first-flight-touches-down-at-london-s-heathrow); [IATA Airlines magazine](https://airlines.iata.org/2025/12/18/progress-journey-100-offers-and-orders); [Wikipedia](https://en.wikipedia.org/wiki/Riyadh_Air) **[secondary]**
- Riyadh Air signed a global distribution agreement with Amadeus (Aug 2025) to reach agencies in 190+ countries and distribute its NDC content — [Amadeus](https://amadeus.com/en/newsroom/press-releases/riyadh-air-signs-global-distribution-agreement-with-amadeus); [Arab News](https://www.arabnews.com/node/2611004/business-economy)
- Riyadh Air is launch partner for SabreMosaic Continuous Revenue Optimizer — [Aviation Business News](https://www.aviationbusinessnews.com/industry-news/t2rlengage-airline-investment-in-modern-retailing-is-taking-off-says-sabre)
- A revenue-management commentator notes Riyadh Air found offer and order "a much slower burn" than a traditional systems migration — [RevMan Substack](https://revman.substack.com/p/riyadh-airs-shareholders-may-not) **[opinion]**
- FLYR has opened a regional HQ in Saudi Arabia after a two-year presence — [FLYR](https://flyr.com/resource-hub/flyr-expands-two-year-presence-and-major-investment-in-saudi-arabia-with-regional-headquarters/) **[vendor marketing]**
- **Saudia**: Altéa PSS + Nevio Orders (above). **flyadeal** (Saudia Group LCC): renewed Navitaire Airline Platform incl. New Skies (~2022) — [Navitaire](https://www.navitaire.com/news-flyadeal-renews-partnership.aspx) **[pre-2024]**. **flynas**: only a 2024 Amadeus full-content distribution renewal found, not a PSS contract — [Aviation Week](https://aviationweek.com/air-transport/airports-networks/flynas-renews-partnership-agreement-amadeus)
- **Etihad**: cut over from Sabre to Amadeus Altéa on 8 March 2023 ("largest IT project the airline has undertaken in the last decade, with more than 100 IT processes moved over, and over 6,000 colleagues trained"; online check-in returned 12 March) — [Etihad](https://www.etihad.com/en/news/as-it-enters-its-20th-year-etihad-airways-celebrates-completion-of-major-system-transition-to-amadeus-with-flash-sale); [Aviation Week](https://aviationweek.com/aerospace/emerging-technologies/etihad-airways-completes-system-transition-amadeus) **[pre-2024]**
- **Qatar Airways**: Altéa suite (2014 extension) — [Gulf Daily Mail](https://gulfdailymail.com/amadeus-and-qatar-airways-extend-partnership/) **[pre-2024; no newer source found]**
- **Air Arabia**: developed its own LCC reservation system "AccelAero" via the ISA joint venture (2006) and selected SITA Horizon passenger management for airport services (2016); an "October 2026 group-level distribution agreement with Amadeus" headline was seen but not retrievable — [Reuters Events](https://reutersevents.com/travel/node/31535); [Aviation Week](https://aviationweek.com/air-transport/airports-networks/air-arabia-selects-sita-passenger-management-system); [Amadeus airlines page](https://amadeus.com/en/airlines/overview) **[pre-2024; current PSS unverified]**
- **Jazeera Airways** (Kuwait): New Skies, May 2025 (above).
- Saudi Aviation Strategy targets 330 million passengers/year and 250+ destinations by 2030 and 4.5 million tonnes of cargo; GACA reported 140.9 million passengers in 2025 (+9%) — [GACA](https://www.gaca.gov.sa/en/Saudi-Aviation-Strategy); [Vision2030.ai](https://vision2030.ai/sectors/logistics/aviation/) **[secondary for the 2025 figure]**

**Other notable moves (context)**

- Air India moved from a SITA-run PSS to Amadeus (2023), with Sabre unsuccessfully litigating the selection; Vistara is listed as absorbed into Air India on Altéa — [Simple Flying](https://simpleflying.com/air-india-amadeus-passenger-service-system/); [ajitem.com](https://ajitem.com/blog/iron-core-part-1-the-problem-that-built-an-industry/) **[pre-2024; secondary]**

**Commercial models and market size**

- Amadeus FY2025: Air IT Solutions revenue ~€2.3bn (+6.4%), "driven by a 3.8% increase in passengers boarded and a 4.7% expansion in revenue per passenger boarded at constant currency"; passengers boarded 2.249 billion — [Amadeus](https://amadeus.com/en/newsroom/press-releases/amadeus-fy-2025-results-revenue-growth). (Implied Air IT revenue per PB ≈ €1.0; this is an arithmetic inference, not a published price.)
- Sabre FY2025: revenue $2.8bn (+1%), normalized adjusted EBITDA $536M (+10%); Hospitality Solutions sold July 2025 for $1.1bn; nine-month 2025 passengers boarded 519.4 million (+1%) — [Sabre Q3 release](https://investors.sabre.com/static-files/354222eb-fa30-4167-80a7-1ef86b586643); [InsiderMonkey](https://www.insidermonkey.com/blog/sabre-corporation-nasdaqsabr-q4-2025-earnings-call-transcript-1699053/)
- Per-boarded-passenger fees (Hitit) and SaaS/subscription models "shift expenses into operating budgets"; migrating to a new PSS "can take several years and cost millions of dollars" — [AltexSoft](https://www.altexsoft.com/blog/airline-reservation-systems-passenger-service-systems/) **[secondary]**
- New-entrant Farel prices "one fee per boarded passenger covers full platform access - every module, every release, 24/7 support" and criticises legacy contracts that "bill separately for modules, change orders, and GDS pass-throughs" — [Farel](https://farel.io/pricing/) **[vendor marketing]**
- T2RL tracks 1,138 active airlines boarding 4.987 billion passengers (2025 snapshot); measures PSS share "in passengers boarded"; the five largest PSS providers by volume it reconciles are Amadeus, Sabre, TravelSky, Sirena-Travel and Hitit (Navitaire counted inside Amadeus) — [T2RL](https://www.t2rl.net/airline/marketshare); [T2RL](https://www.t2rl.net/reports/) (percentages paywalled)

### Inferences

- "Why" airlines moved: the stated motive in every 2025–2026 announcement is modular Orders capability and retailing revenue (AF-KLM, Lufthansa, Saudia, TUI), not cost; IATA's DG also said modularity outranks revenue uplift as the priority.
- The Gulf is split by business model: FSCs on Altéa (Saudia, Etihad, Qatar) with Saudia first into Nevio Orders; LCCs on Navitaire (flyadeal, Jazeera); Riyadh Air alone on a greenfield native-Orders stack, mixing vendors (FLYR core, Sabre CRO, Amadeus distribution). A Saudi-targeted self-built platform is therefore benchmarked against Nevio/Altéa and FLYR, not against legacy-only PSS.
- The commercial baseline for incumbents is roughly €1 of IT revenue per boarded passenger (Amadeus), rising 4–5% a year; a self-built system's TCO per boarded passenger is the right comparison metric.

### Gaps

- No 2024–2026 confirmation of the PSS used by Emirates, Qatar Airways, Air Arabia, Wizz Air or flynas (flynas is widely understood to be on Navitaire, but no source in this research confirmed it).
- T2RL's vendor market-share percentages for 2024/2025 are paywalled and were not retrievable.
- No public price lists or contract values for any PSS; Nevio/Mosaic deal values were not disclosed (AF-KLM described only as "multi-million").
- Ethiopian's Mosaic release could not be fetched (prnewswire blocked), so which modules it bought is unknown.

---

## Key Question 3: Documented pain points, outages and cutover failures, and the lessons drawn

### Takeaway

The costliest 2022–2026 failures were in in-house or adjacent operational systems (Southwest crew scheduling, Delta crew tracking after CrowdStrike), not in the PSS itself; PSS outages (Amadeus Altéa Dec 2025, Oct 2026) were short but global because one vendor serves 125+ airlines. Regulators penalised customer-service failures (refunds, notifications) rather than the technology failure, and IATA/analyst reporting shows Offers-and-Orders adoption is well behind the vision.

### Cited Findings

**Southwest Airlines, December 2022 (in-house crew system)**

- ~16,700 flights cancelled over the last 10 days of December 2022, >2 million passengers affected; crew-reassignment tool SkySolver "was overwhelmed by the scale of weather-induced tasks and broke down, forcing schedulers to sort through records manually"; Southwest relied on "two proprietary and internally-maintained software programs, SkySolver and Crew Web Access" — [Wikipedia](https://wikipedia.com/wiki/2022_Southwest_Airlines_flight_delays) **[secondary]**; [ITPro](https://www.itpro.com/technology/southwest-airlines-hit-with-record-breaking-penalty-for-2022-it-meltdown)
- DOT penalty of $140 million (Dec 2023), "30 times larger than any previous DOT civil penalty": $35M cash, $90M in future-passenger compensation vouchers, $33M credit for Rapid Rewards points issued; DOT findings concerned customer-service failures (status updates, refunds), not the outage itself; DOT later waived the final $11M instalment — [NerdWallet](https://www.nerdwallet.com/article/travel/southwest-faces-140-million-penalty-for-2022-holiday-meltdown); [AFAR](https://www.afar.com/magazine/southwest-airlines-fined-for-2022-holiday-travel-meltdown); [AirlineGeeks](https://airlinegeeks.com/?p=98895) **[pre-2024 event]**

**Delta Air Lines, July 2024 (CrowdStrike update → crew tracking)**

- About 7,000 flight cancellations over five days; Delta's SEC filing cited ~$380M lost revenue and ~$170M expense; "massive backlog in the airline's crew tracking system, with incomplete and inconsistent data that required several days to resolve"; 40,000 servers manually reset — [NPR](https://www.npr.org/2024/07/31/nx-s1-5058652/delta-crowdstrike-outage-500-million-dollars); [Flying Magazine](https://flyingmag.com/business/it-outage-cost-delta-air-lines-500-million); [AJC](https://ajc.com/news/business/delta-attorney-fires-off-another-letter-to-crowdstrike-attorney-in-dispute/4FDPBUTCIRE5PJQE374K5Y3BJM)
- Delta sued CrowdStrike in Georgia state court (Oct 2024) claiming >$500M; CrowdStrike counter-sued and argued "any liability by CrowdStrike is contractually capped at an amount in the single-digit millions" and that Delta's outdated IT worsened recovery — [Wikipedia](https://en.wikipedia.org/wiki/Delta_Air_Lines_v._Crowdstrike) **[secondary]**; [Business Standard](https://www.business-standard.com/world-news/crowdstrike-rejects-delta-air-lines-claims-for-july-19-flight-disruptions-124080500193_1.html); [complaint PDF](https://cdn.arstechnica.net/wp-content/uploads/2024/10/CrowdStrike-v-Delta-Complaint-10-25-24.pdf)
- DOT closed its two-year probe in 2026 without penalties, finding Delta provided prompt refunds and baggage/disability support — [Simple Flying](https://simpleflying.com/delta-avoids-fines-dot-probe-2024-crowdstrike-chaos/); [Cybernews](https://cybernews.com/news/delta-penalties-crowdstrike-outage/)
- The same 19 July 2024 Microsoft/CrowdStrike event disrupted Air India, Akasa Air, Vistara and other Indian carriers' booking systems — [Malay Mail](https://www.malaymail.com/amp/news/world/2024/07/19/technical-challenges-five-indian-airlines-report-extensive-it-disruptions-to-booking-systems/144304)

**Amadeus Altéa outages (PSS-level, multi-airline)**

- December 2025: a network fault in Altéa "froze check-in systems for about 45 minutes at major airports worldwide"; Altéa described as used by 125 airlines for inventory, ticketing, boarding and DCS — [VisaVerge](https://www.visaverge.com/news/amadeus-glitch-triggers-45-minute-airport-check-in-slowdown-worldwide/); [Madhyamam](https://madhyamamonline.com/world/amadeus-software-glitch-triggers-45-minute-airport-check-in-slowdown-1473543) **[secondary]**
- 9 October 2026: Southwest Airlines moved to manual bag checks and boarding network-wide after an Amadeus outage, with 1,500+ delays; Amadeus attributed it to "an unidentified third-party technology provider" — [DeepArrival](https://deeparrival.com/news/southwest-manual-boarding-system-outage-october-2026/) **[single secondary report; verify]**
- Historical pattern: a global Altéa outage in September 2017 hit check-in at Heathrow, Gatwick, Changi, Frankfurt, CDG, Reagan ("more than 130 airlines"); earlier multi-day GDS disruptions forced manual ticketing — [Quartz](https://qz.com/1089524/amadeus-altea-system-airport-check-in-delays-in-gatwick-heathrow-changi-frankfurt-reagan-charles-de-gaulle); [Travel Market Report](https://www.travelmarketreport.com/articles/%20%20%20%20/international/articles/amadeus-service-disruption-hits-agencies-travelers) **[pre-2024]**

**Sabre outages and migration-related incidents**

- Sabre has had multi-airline "system issue" outages (2012: ~45 minutes affecting all Sabre airlines/agencies; 2019 check-in problems at several US carriers); IEEE noted Virgin's move to Sabre "caused problems" shortly before a large outage — [IEEE Spectrum](https://spectrum.ieee.org/it-hiccups-of-the-week-sabre-outage-hit-flights-worldwide); [TechCrunch](https://techcrunch.com/2019/03/26/us-airlines-computer-issues) **[pre-2024]**

**Cutover practice**

- Etihad's Sabre→Altéa cutover (8 March 2023) took online check-in offline for four days (restored 12 March) and ancillaries until 13 March — [Etihad](https://www.etihad.com/en/news/as-it-enters-its-20th-year-etihad-airways-celebrates-completion-of-major-system-transition-to-amadeus-with-flash-sale) **[pre-2024]**
- Malaysia Airlines cut over to Altéa at midnight 11 June 2017 — [CAPA](https://centreforaviation.com/analysis/reports/malaysia-airlines-to-grow-partnerships-increase-codeshare-traffic-following-cutover-to-amadeus-pss-349825) **[pre-2024]**
- Hitit's PIA migration: five-month timeline vs ~18-month norm, loss of a GDS weeks before cutover, "no flights canceled" — [Hitit](https://hitit.com/news-updates/blog/three-pillars-switching-it-provider-during-and-after-pss-migration-process) **[vendor marketing]**
- Navitaire/Jazeera: "100-day migration from testing to go-live" to the newest New Skies — [Navitaire](https://www.navitaire.com/news-jazeera-airways-migration.aspx) **[vendor marketing]**
- A modernisation vendor argues "no maintenance window can absorb a multi-day cutover", favouring incremental/parallel-run migration, and that high-profile failures "originated in custom-built operations software rather than commercial PSS platforms" — [LegacyLeap](https://www.legacyleap.ai/blog/airline-legacy-system-modernization/) **[vendor marketing]**

**Adoption pain points (Offers & Orders)**

- Atmosphere Research / Accelya (April 2025): "only 27% of airlines have taken 'substantive steps' with offer and order transformation... 53% of airlines haven't developed or started an offer and order strategy"; two-thirds have started NDC — [PhocusWire](https://www.phocuswire.com/ndc-offer-order-accelya-report)
- Roland Berger (Nov 2025) describes ONE Order adoption as "slower than hoped" due to "structural, operational, and ecosystem challenges" — [Roland Berger](https://www.rolandberger.com/en/Insights/Publications/Airline-order-and-offer-management.html)
- Amadeus reportedly found "the hardest part of moving to Offers and Orders is often the interoperability between airlines, sellers, airports, finance and servicing systems" — [modernairlineretailing.com](https://www.modernairlineretailing.com/blog/2026-10-08-chatgpt-flight-search-agentic-ai-airline-retailing.html) **[secondary]**
- IATA readiness data cited: "only around a quarter of airlines expect to fully implement Offer & Order capabilities by 2027 or 2028" — [Airlinergs](https://airlinergs.com/riyadh-air-and-flyr-launch-the-worlds-first-offer-order-network-airline/) **[secondary]**

### Inferences

- Lessons for a self-built platform: (1) crew/ops systems need the same resilience engineering as the PSS — both headline meltdowns were crew-system backlogs; (2) design for manual fallback at check-in/boarding and for degraded-mode operation when a third-party dependency (security agent, network provider, cloud) fails; (3) regulators judge the customer-service response (refund speed, notifications, rebooking) — so disruption-servicing automation is risk mitigation, not just a feature; (4) PSS cutovers are planned as 4–6 day degraded-service windows even when successful (Etihad), and vendors now market 100-day/5-month migrations as differentiators.
- Vendor concentration (Altéa at 125+ airlines) turns a 45-minute fault into a worldwide event; a self-built single-airline platform avoids this correlated risk but loses the vendor's operational maturity.

### Gaps

- No 2024–2026 PSS cutover was found that failed outright; the only documented friction is multi-day feature blackout during successful cutovers. A search for post-mortems on Air India's SITA→Amadeus migration or on Riyadh Air's "slower burn" produced no independent analysis.
- The October 2026 Southwest/Amadeus incident rests on a single secondary report and should be verified against primary coverage.
- No vendor-published post-incident reviews (RCA documents) were found for any Amadeus or Sabre outage.
- Delta v. CrowdStrike litigation outcome: still pending in the sources found; no final judgement located.

---

## Key Question 4: Architectural patterns vendors describe, and what remains legacy

### Takeaway

Vendors converge on the same vocabulary: modular, cloud-native, API-first Offer/Order/Settle/Deliver services with AI pricing and generative-AI servicing, coexisting with the legacy PNR/e-ticket/EMD/EDIFACT core via bridging or translation layers. IATA expects some airlines to be fully on Offers & Orders across all domains only by 2030, so dual-running is the architecture of record for the rest of the decade.

### Cited Findings

- IATA (Dec 2025): as of October 2025 "seven full-scope airline contracts and 48 airline pilots and Proof of Concepts underway"; a multivendor demo in Geneva on 1 Oct 2025 had "more than 20 IT providers... demonstrating eight collaborative solutions across the five domains"; IATA's Head of Airline Commercial Systems "expects some airlines fully operating with Offers & Orders across the five business domains by 2030"; IATA's Director General said "the higher priority for most airlines is modularity" — [IATA Airlines magazine](https://airlines.iata.org/2025/12/18/progress-journey-100-offers-and-orders); [IATA Airlines magazine (modularity)](https://airlines.iata.org/2025/11/05/offer-and-order-enablement-through-modularity-0)
- "Most airlines are expected to transition to Offers and Orders in the 2028-2029 timeframe, with widespread adoption unlikely to occur before 2030" — [Technology's Legal Edge](https://www.technologyslegaledge.com/2025/09/navigating-the-complex-pathway-to-modern-airline-retailing-and-offer-and-order-management/) **[law-firm commentary]**
- IATA ONE Order aims "to replace PNRs, EMDs, and e-tickets with one record"; the Airline Retailing Maturity (ARM) index registry publishes validated NDC/ONE Order capabilities — [IATA ONE Order fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-one-order); [AltexSoft](https://www.altexsoft.com/blog/iata-one-order-for-the-airlines/)
- Amadeus Nevio: "AI-native modular solutions", Offer + Order + Delivery Management, smart bridging of Altéa PNR/ET into Orders, phased per-airline/per-channel go-live — [TTG Asia](https://www.ttgasia.com/2026/01/14/lufthansa-group-selects-amadeus-nevio-to-transform-airline-retailing/); [Amadeus/Saudia](https://amadeus.com/en/newsroom/press-releases/saudia-orders-nevio-accelerate-guest-centric-travel)
- Sabre Mosaic: "unified, AI-first, cloud-based platform"; "modular AI-native"; "agentic APIs and MCP server"; CRO as AI revenue engine; Travel Marketplace as NDC aggregation layer; T2RL/Sabre coverage ties Mosaic to Google Cloud — [Yahoo Finance](https://finance.yahoo.com/news/sabre-sabr-120-2-launching-051054281.html); [InsiderMonkey](https://www.insidermonkey.com/blog/sabre-corporation-nasdaqsabr-q4-2025-earnings-call-transcript-1699053/); [T2RL](https://www.t2rl.com/first-views/sabre-announces-its-mosaic-launch-customer/)
- Navitaire Stratos: "flexible, cloud-native technology stack and aligns with IATA's Offer and Order standards"; New Skies itself runs in the cloud (Volotea 2022) — [Amadeus](https://amadeus.com/en/newsroom/press-releases/navitaire-tui-airline-shape-next-generation-airline-retailing); [BusinessWire](https://www.businesswire.com/news/home/20220112005963/en/Volotea-Becomes-First-Navitaire-New-Skies-Airline-Operating-in-the-Cloud)
- Accelya FLX ONE: "Open, AI-Driven, Cloud-Native Platform" spanning passenger and cargo — [Accelya](https://w3.accelya.com/resources/press-releases/accelya-launches-flx-one-cargo-platform/)
- FLYR: native ONE Order data model, IBM collaboration, "integrates multiple technology providers into a single operating environment", Legacy Translator for GDS/EDIFACT partners, cart-based order creation "capturing every item in the journey within a single record" — [FLYR](https://flyr.com/resource-hub/offer-order-built-right-designed-to-deliver/); [Travel Daily News](https://www.traveldailynews.com/aviation/riyadh-air-launches-with-flyr-offer-order-platform/)
- Travelport: AI "Content Curation Layer" normalising NDC and EDIFACT content side by side — [Travelport](https://www.travelport.com/press-release/travelport-secures-ndc-content-from-china-eastern-airlines-with-new-multi-source-content-deal)
- United noted most NDC implementations still issue tickets on "neutral ticket stock" (i.e., e-ticket legacy persists under NDC) — [Travel News (SA)](https://www.travelnews.co.za/article/ba-ua-ndc-soon-live-travelport?page=4)
- "Searching for a fare, confirming a live offer and creating an airline order remain different technical and commercial events" (with Southwest's Oct 2026 ChatGPT flight search cited) — [modernairlineretailing.com](https://www.modernairlineretailing.com/blog/2026-10-08-chatgpt-flight-search-agentic-ai-airline-retailing.html) **[secondary]**
- Sabre expects NDC "to be folded into unified shopping, booking and servicing environments rather than run as a separate channel" — [PR Newswire / Sabre](https://www.prnewswire.com/news-releases/from-content-complexity-to-connected-retailing-7-transformations-redefining-travel-in-2026--led-by-the-rise-of-agentic-ai-302634980.html) **[vendor]**

### Inferences

- The reference architecture for 2026 is: Offer engine (dynamic pricing + ancillary bundling, AI) → Order store (single record) → Delivery (DCS/journey) → Settlement; plus a translation layer to PNR/ET/EMD/EDIFACT for GDS, interline and airports. A self-built platform's data model should be scored on whether its "booking" is an Order (items, prices, payments, delivery status) or a PNR clone.
- Agentic/LLM channels (MCP servers, ChatGPT shopping) are the newest distribution surface; vendors are already defending look-to-book ratios with caching and quota controls.
- "Cloud-native" is asserted by all; only Navitaire (Volotea) and Sabre (Google Cloud per T2RL) have specific public evidence in this research.

### Gaps

- IATA's five business domains were referenced but not named in retrievable text (the T2RL report title suggests Offer, Order, Settle, Deliver plus one more); the IATA page could not be fetched.
- No vendor architecture document (API reference, event model, hyperscaler choice for Nevio/Stratos/FLX ONE) could be fetched; claims of microservices/event-driven design are unverified marketing.
- No source quantified how much of Nevio/Mosaic traffic is still PNR-based vs native Orders.

---

## Key Question 5: What analysts say is table stakes vs. differentiator for 2026

### Takeaway

Analysts and surveys treat NDC connectivity, basic ancillary merchandising, cloud/data foundations and cybersecurity as table stakes; differentiators are native Orders, AI-driven continuous pricing and offer assembly, generative/agentic AI servicing and shopping, and data coordination across operations. No analyst explicitly published a "table stakes vs differentiators" list; the framing below is inferred from their statements.

### Cited Findings

- NDC "has moved from a differentiator to an expected standard, with two-thirds of airlines implementing the standard" — [PR Newswire / Sabre](https://www.prnewswire.com/news-releases/from-content-complexity-to-connected-retailing-7-transformations-redefining-travel-in-2026--led-by-the-rise-of-agentic-ai-302634980.html) **[vendor]**; corroborated by Atmosphere/Accelya's two-thirds figure — [PhocusWire](https://www.phocuswire.com/ndc-offer-order-accelya-report)
- SITA Air Transport IT Insights 2025: airlines spent ~$36bn on IT in 2025 (3.6% of revenue; PhocusWire reports "just under 6%" — conflicting), airports $14.8bn; generative AI/LLMs are the top investment priority for 79% of airlines; 63% already use AI in operations control; 83% call data-driven decision-making a strategic priority; 49% cite data integration/consistency as the main barrier; 46% are upgrading flight-ops systems for real-time data — [SITA](https://www.sita.aero/about-us/pressroom/news-releases/sita-research-finds-aviations-record-technology-investment-hinges-on-one-thing-data-coordination/); [SITA report page](https://www.sita.aero/resources/surveys-reports/air-transport-it-insights-2025/); [Travolution](https://www.travolution.com/en/article/sita-says-record-tech-spend-hinges-on-data-coordination); [PhocusWire](https://www.phocuswire.com/news/technology/sita-airline-it-sights-2025)
- SITA 2024 report: $37bn airline IT spend; top focus "cybersecurity, data analysis and passenger management"; North American airlines prioritising cybersecurity and AI — [PhocusWire](https://www.phocuswire.com/sita-airline-it-insights-2024); [BusinessWire](https://www.businesswire.com/news/home/20250505604805/en/SITA-Report-Reveals-North-American-Airlines-Prioritizing-Cybersecurity-and-AI-as-IT-Investments-Surge)
- McKinsey State of Aviation (May 2025): "latent opportunity at more than $45 billion across the full airline retail value chain"; consumer survey of 7,000: 33% cite price as top booking criterion, ease of booking 20%, brand trust 20%; airlines moving "beyond rigid fare families toward dynamic, segment-tailored offers are best positioned" — [McKinsey](https://www.mckinsey.com/~/media/mckinsey/industries/travel/our%20insights/the%20state%20of%20aviation%202025/the-state-of-aviation-2025-vf.pdf); [OAG summary](https://www.oag.com/airline-pricing-shopping-data)
- Earlier McKinsey/IATA baseline (2019): "up to $40 billion in new value annually by 2030 (equivalent to 4 percent of current industry revenues)", with new offer development the largest lever; PRM described as "a transitional differentiator" — [McKinsey](https://www.mckinsey.com/industries/travel/our-insights/airline-retailing-the-value-at-stake); [PhocusWire](https://www.phocuswire.com/airline-retailing-value) **[pre-2024]**
- IATA: modularity is airlines' top priority in moving to 100% Offers & Orders — [IATA Airlines magazine](https://airlines.iata.org/2025/11/05/offer-and-order-enablement-through-modularity-0)
- Future Travel Experience 2026 trend list: AI, hyper-personalisation, data, human-centric service; Icelandair expects "true offer- and order-based retailing, where AI dynamically assembles and prices bundles" — [FTE](https://www.futuretravelexperience.com/2026/02/top-ancillary-retailing-trends-to-watch-in-2026/)
- Agentic AI: "2026 is the year of agentic retailing in air travel, where AI assistants shop and book on behalf of travellers" (Threedot); SimpliFlying's CEO argues agentic AI "will fundamentally reshape airline distribution, determining which carriers reach travellers first" — [Travel and Tour World](https://www.travelandtourworld.com/news/article/the-future-of-travel-retailing-7-trends-to-watch-as-2025-ends-and-2026-begins/); [FTE](https://www.futuretravelexperience.com/2026/06/simpliflying-founder-ceo-discusses-how-agentic-ai-will-reshape-airline-retailing-and-determine-which-offers-reach-travellers/) **[opinion]**
- Roland Berger (Nov 2025) on order/offer management: adoption slower than hoped; structural and ecosystem challenges — [Roland Berger](https://www.rolandberger.com/en/Insights/Publications/Airline-order-and-offer-management.html)
- ATPCO Elevate session frames "NDC, offers, and orders in 2025 and beyond" as the state of retailing — [ATPCO](https://www.elevate.atpco.net/sessions/the-state-of-airline-retailing-ndc-offers-and-orders-in-2025-and-beyond) (agenda only)

### Inferences

- **Table stakes (2026)**: NDC API with servicing; branded fares and ancillary catalogue; mobile/web self-service incl. check-in; data platform with consistent operational data; cybersecurity controls; cloud hosting; per-passenger scalable cost model.
- **Differentiators (2026)**: native Order record and Order ID; AI continuous pricing and offer assembly (CRO/Air Price IQ class); generative-AI servicing across web/app/WhatsApp; agentic/MCP shopping endpoints with look-to-book protection; delivery/journey tracking; cross-domain data coordination (SITA's 49% barrier); fast, low-risk migration/coexistence tooling.
- For a Saudi-market platform, the differentiator bar is set locally by Saudia (Nevio Orders) and Riyadh Air (native ONE Order), which is higher than the global median where 53% of airlines have no O&O strategy.

### Gaps

- No Gartner, CAPA or T2RL analyst report text was retrievable (paywalled or domain-blocked); T2RL Engage 2025 conference summaries were not found (search returned unrelated "Engage" events).
- No Accenture or BCG 2024–2026 airline retailing paper surfaced in the searches run.
- SITA's airline IT spend as % of revenue conflicts between sources (3.6% vs ~6%); the primary report PDF was not fetched.
- The current count of ONE Order-capable airlines in IATA's ARM registry was not retrievable; the only proxy is an AltexSoft datasheet covering 82 NDC airlines (34 self-confirmed).
