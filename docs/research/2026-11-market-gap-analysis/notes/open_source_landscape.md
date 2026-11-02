# Open-Source & Community Landscape for Airline Reservation / Ticketing / DCS / Ops Software (research as of 2026-11-02)

Method note: GitHub star counts and "last updated" dates below were read directly from github.com repository and topic pages on 2026-11-02 (the GitHub REST API was blocked in this session, so exact last-commit timestamps are often unavailable; where a GitHub Topics page showed a "last updated" date it is recorded). Several primary sources were unreachable from this session (duffel.com, news.ycombinator.com, flyertalk.com, medium.com, code.kiwi.com, docs.bullmq.io, docs.stripe.com, airtechzone.iata.org, reddit) and the web-search budget was exhausted mid-task; those limits are called out in the Gaps sections. Facts taken only from search-engine snippets are flagged "(snippet)".

---

## Key Question 1 — Which open-source airline/travel reservation systems exist beyond student projects, and what do the best of them implement?

### Takeaway

There is no maintained, production-grade open-source PSS (inventory + fares + PNR + e-ticket + DCS). The GitHub "airline-reservation-system / airline-booking / flight-booking" topics are overwhelmingly coursework (single-digit to ~50 stars, demo payments, no tests). The handful worth studying are: AWS's archived serverless airline-booking reference (2.3k stars, Step Functions booking saga + Stripe), TelivityAI/otaip (TypeScript agent/pipeline platform that models the full airline retailing lifecycle incl. ATPCO fare categories, EMD, ADM/BSP), adamf/jetway (Go messaging gateway + PNR store implementing Type B/AIRIMP, PADIS EDIFACT, NDC, SSIM, PAXLST, MVT, PNL/ADL, BSM), and MalharSarwate's Spring Boot/React demo which, despite 0 stars, has the most honest "what is missing for production" list and uses seat holds, idempotency keys, Testcontainers and Playwright.

### Cited Findings

**Topic-page census (GitHub, 2026-11-02)**

- `airline-reservation-system` topic, top by stars: TelivityAI/otaip 46 stars (TypeScript, updated Oct 23 2026); hi676sweet/online-booking-system-java 12 (Java Servlets/JSP); siMobin/airline-reservation-system 11 (PHP); aakashdhakal/SkyPass 8 (Java console); everything else ≤5 stars; 20 repos listed in total — [GitHub topic: airline-reservation-system](https://github.com/topics/airline-reservation-system?o=desc&s=stars)
- `airline-booking` topic (103 repos): aws-samples/aws-serverless-airline-booking 2.3k stars (updated Aug 9 2024); adamhwang/ita-matrix-powertools 86; SyedMuhammadFaheem/AirOpsManager 49 (JavaScript, Aug 11 2026); TelivityAI/otaip 46; nejlasahin/airline-reservation-system 29 (Java, JSP/Servlets/MySQL, 2021); MadhushiWelikala/flight-reservation-system 25 (university project, 2018); ghulamghousdev/Reservation-System 24 (C# WinForms, 2021) — [GitHub topic: airline-booking](https://github.com/topics/airline-booking?o=desc&s=stars)
- `flight-booking` topic (144 repos): dominated in 2026 by AI-agent "skills" — tourmind-com/Tourmind-Booking-Skills 2.4k stars (Python, agent skills for TourMind API), flightclaw/agents 78 (hosted MCP server + skill), atlas-doc/atlas-flight-booking-skill 15; plus sunspikes/php-amadeus 73 (PHP Amadeus client, last update Jan 2018) and small Java/JavaFX course projects (youssef-amazzal/Skynet 20, FlyXpert 14) — [GitHub topic: flight-booking](https://github.com/topics/flight-booking?o=desc&s=stars)
- `ndc` topic (62 repos, few about IATA NDC): TelivityAI/otaip 46; spacetab-io/s7-golang-sdk 10 (Go NDC connector for S7 Airlines Agent API, last update Feb 2020); windingtree/glider-aggregator 7 (JS, NDC + OTA-XML forwarding, Jan 2023); damadov/iata-ndc-java-api 4; jinahya/iata-ndc-bind-2133-javax 3 (JAXB bindings); chrisstina/ndc-json2xml 3 (TypeScript, May 2024) — [GitHub topic: ndc](https://github.com/topics/ndc?o=desc&s=stars)
- A general web search for production-ready open-source airline reservation systems found none; most results are student/demo projects, and the one that discusses production explicitly says it is not ready (snippet) — [search summary; see MalharSarwate below](https://github.com/MalharSarwate/Airline-Reservation-Systemm)

**Projects worth studying**

- **aws-samples/aws-serverless-airline-booking** — 2.3k stars, 1.3k forks, MIT-0. Vue/Quasar + Amplify front end; AppSync GraphQL as API hub; DynamoDB; Cognito JWTs with per-type AppSync authorization; **Step Functions orchestrates the booking workflow** (payment collection and refund run inside the workflow); SNS between Booking and Loyalty; Stripe via a Serverless Application Repository app; Python core, Loyalty in TypeScript. Implements catalog search, booking create/list, payment authorize/collect/refund, loyalty points/tiers. README: "This project is no longer being worked on" — a "point in time reference"; old code lives on an `archive` branch — [GitHub](https://github.com/aws-samples/aws-serverless-airline-booking)
- **TelivityAI/otaip (Open Travel AI Platform)** — 46 stars, 16 forks, Apache-2.0, TypeScript strict, Node 24+, pnpm workspaces (16 packages), Vitest, Zod 4. Models the booking lifecycle as typed agents with "pipeline contracts" to stop LLM orchestration from producing invalid bookings. Airline scope claimed: availability/schedules/connections/fare shopping; pricing incl. **fare rules (ATPCO categories), fare construction, tax calculation, offer building**; GDS/NDC routing, PNR building, order management, payment; ticketing (issuance, **EMD**, void); exchange (changes, reissue, involuntary rebooking); refunds + **ADM handling**; reconciliation (**BSP/ARC settlement**, commissions). Adapters: Amadeus, Sabre, Navitaire, TripPro/Mondee, Duffel (NDC), HAIP (hotels). Caveats: pre-1.0 (0.6.x); README says money-path use only once a separate production-readiness doc is satisfied; agent counts inconsistent (77 vs 75); 3,342 tests self-reported; `exactOptionalPropertyTypes` disabled; demo needs an Anthropic API key — [GitHub](https://github.com/TelivityAI/otaip)
- **adamf/jetway** — Go, MIT, 16 stars, 4 forks, 170 commits. "Open-source airline and GDS reservation messaging gateway" that receives carrier messages, decodes them, keeps PNRs and replies. Implements: Type B / AIRIMP teletype over SITA/ARINC (partial profile — AIRIMP is a paid IATA publication the author does not own); UN/EDIFACT PADIS (ISO 9735) with PAOREQ/PAORES and CONTRL; NDC order messages over HTTP mapped onto the same record store; MATIP (RFC 2351), SSIM/ASM, AFTN, ICAO ATS, ACARS OOOI, **PAXLST, MVT, PNL/ADL, BSM/BPM/BUM**, ADEXP. Application features: ticketing, cross-carrier cancellation, PNR split, seat inventory, fare structures, settlement/proration files, departure control. Ingress: HTTPS with mTLS, framed TCP, file drop. Caveats: AIRIMP and some PADIS layers not conformant; AIRIMP divide message missing; field-level encryption at rest "not yet implemented", no erasure workflow — README says do not use production passenger data; in-memory store for demos only; ephemeral locator secret flagged as a blocker; not affiliated with IATA/A4A/SITA/ARINC — [GitHub](https://github.com/adamf/jetway); listed in [lucianosrp/open-source-aviation](https://github.com/lucianosrp/open-source-aviation)
- **MalharSarwate/Airline-Reservation-Systemm** — 0 stars, 8 commits, no license shown. Java 21 / Spring Boot 3 / Spring Security JWT / Flyway / JPA / PostgreSQL; React 18 + TypeScript + Vite + Zustand with lazily loaded 3D cabin. Implements search (origin, destination, date, travellers, cabin, sort, pagination), **accessible 2D seat map + 3D cabin fallback, seat holds, group-hold planner**, booking up to six travellers with baggage/meals, **8-character PNR, idempotency keys**, simulated payments (mock approve/decline/refund), PDF e-ticket (not valid for travel), admin (aircraft, flights, fares, seat blocking, bookings). Tests: JUnit real-database suite (7 scenarios, Testcontainers), Playwright E2E (registration→cancellation, mock decline, ticket download, mobile). README "what is missing": HTTPS, rate limiting, reverse proxy for API/SSE; email verification/account recovery; production secret store and monitoring; shared event broker for multi-instance SSE (events are process-local); only direct one-way flights (no multi-city/connections); real payment/refund integration; real airline inventory; full multilingual PDF typography (unsupported chars render as `?`) — [GitHub](https://github.com/MalharSarwate/Airline-Reservation-Systemm)
- **SyedMuhammadFaheem/AirOpsManager** — 49 stars, 26 forks, 46 commits, license not shown. React 18 + React Router v5 + Tailwind; Express with Helmet, CORS, express-rate-limit, express-validator, bcryptjs; JWT in HttpOnly cookies; MySQL 8 raw SQL (topics say PostgreSQL — conflict). Admin: flights, airplanes, airports, schedules, clients, tickets, bookings; customer: search, book, boarding pass, reviews; login rate-limiting (5 attempts → 429). No automated test command found (an `e2e` folder exists); README publishes seeded admin/customer passwords; began as a university database project — [GitHub](https://github.com/SyedMuhammadFaheem/AirOpsManager-AirlinesManagementSystem)
- **rodrigobdz/airline-reservation-system** — 8 stars, MIT, Node/hapi/Mongoose microservices with api-gateway, AVA tests; **archived Nov 6 2019**, 29 commits, WIP — [GitHub](https://github.com/rodrigobdz/airline-reservation-system)
- **windingtree/glider-aggregator** — 7 stars, GPL-3.0, Node 10/12 + TypeScript, Redis/MongoDB/Elasticsearch, Mocha/Newman tests, 532 commits, 20 open PRs; forwards Winding Tree marketplace shopping/booking requests to airlines/hotels via NDC and OTA-XML; hosted at production.b2b.glider.travel; airlines not named — [GitHub](https://github.com/windingtree/glider-aggregator)

**Vendor SDKs & sample apps (usable from Node)**

- **amadeus4dev/amadeus-node** — 227 stars, 79 forks, MIT, "tested using Node LTS"; **archived by owner Jul 17 2026 (read-only)**. Covers Flight Offers Search (GET/POST), Flight Offers Price, Flight Create Orders, order retrieve/cancel, SeatMaps, Flight Availabilities, Branded Fares Upsell, Flight Choice Prediction, On-Demand Flight Status, Check-in Links, airline/airport lookups, plus hotels/transfers/analytics — [GitHub](https://github.com/amadeus4dev/amadeus-node)
- **amadeus4dev/amadeus-code-examples** — 115 stars, also **archived Jul 17 2026**; Node/Java/Python/Swift/cURL examples for flight_offers_search/v2, flight_offers_price, flight_create_orders, flight_order_management, branded_fares_upsell, seatmaps/v1, on_demand_flight_status, flight_checkin_links, flight_delay_prediction, airline_routes, airport_routes, etc. — [GitHub](https://github.com/amadeus4dev/amadeus-code-examples)
- **duffelhq/duffel-api-javascript** (`@duffel/api`) — 60 stars, 29 forks, MIT, TypeScript, Node ≥ 18.16.0, 1,711 commits, updated Nov 2 2026, semantic-release — [GitHub](https://github.com/duffelhq/duffel-api-javascript). Duffel's Python and Ruby SDKs are **archived (Sep 2024)**; **duffelhq/duffel-components** (22 stars, TypeScript) ships `DuffelAncillaries` (seats + bags), `DuffelCardForm`, and `createThreeDSecureSession` as React component, HTML custom element, or CDN script, requiring a Duffel API token and CSP allow-listing of assets.duffel.com — [Duffel org](https://github.com/duffelhq); [duffel-components](https://github.com/duffelhq/duffel-components)
- **sunspikes/php-amadeus** — 73 stars, PHP client for Amadeus (Web Services era), last updated Jan 2018 — [GitHub topic](https://github.com/topics/flight-booking?o=desc&s=stars)

**Agent-era "booking skills"** (not reservation systems, but the fastest-growing category in 2026): Tourmind-Booking-Skills 2.4k stars (hotel+flight rate comparison and reservation management via the TourMind API), flightclaw/agents 78 (search/price tracking/booking via hosted MCP server) — [GitHub topic: flight-booking](https://github.com/topics/flight-booking?o=desc&s=stars)

### Inferences

- The only places where genuine airline-industry message plumbing (AIRIMP, PADIS, PNL/ADL, BSM, SSIM) exists in open source are jetway (Go) and, as abstractions, otaip (TypeScript). Both are single-maintainer, pre-production, and should be mined for domain model/vocabulary rather than imported as dependencies.
- The AWS sample is the best open illustration of a booking **saga** (reserve → collect payment → confirm, with compensating refund) even though its stack (AppSync/Step Functions) is not portable to an Express/tRPC monolith; the state-machine shape is.
- otaip's scope list (fare construction, EMD, ADM, BSP reconciliation, involuntary rebooking) is a useful checklist of what a "complete" airline retailing platform covers and what this repo's phases 2–4 still lack in depth.
- Amadeus archiving its Node SDK and examples (Jul 2026) means a TypeScript platform integrating Amadeus Self-Service should budget for maintaining its own thin client; Duffel's JS SDK is the only vendor SDK among those checked that is still actively released.

### Gaps

- Exact last-commit dates for most repos could not be read (GitHub API blocked; repo pages omit dates). Dates given are from topic pages only.
- Could not verify AirOpsManager's or MalharSarwate's licenses (not shown on page).
- "OpenReservation/.github" (snippet) could not be inspected.
- No Odoo/ERPNext travel modules, Java/Spring "airline-ticketing" projects beyond coursework, or Kiwi Tequila/Skyscanner sample apps were reached before the search budget ran out.
- Did not find an open-source departure-control (DCS) system beyond jetway's partial DCS features.

---

## Key Question 2 — Which open-source / open-data components exist for the building blocks a TypeScript/Node airline platform needs?

### Takeaway

Reference data (OurAirports, OpenFlights, lxndrblz/Airports, timezone-boundary-builder → `geo-tz`), BCBP (`bcbp` npm, TypeScript, v6, tests), Apple/Google Wallet passes (`passkit-generator` 1.3k★ MIT, `@walletpass/pass-js` 742★ AGPL, `passlet` for both wallets), queues (BullMQ 9.6k★) and ledgers (TigerBeetle 17.3k★ with `tigerbeetle-node`; Medici 361★ Mongo-only; Formance 1.5k★ Go service) are all adoptable from Node 22. Gaps that must be hand-built or bought: NDC clients (all open ones are tiny/stale; IATA schemas are not on GitHub), SSIM parsing (only PHP/Rust/Python — no npm), PAXLST (only generic EDIFACT parsers in Python/PHP/npm, none PAXLST-aware; EdiFabric is commercial), Type B (only an MVT/MVA/DIV parser in Python), seat maps (no maintained React airline seat-map lib), W&B (hobbyist GA tools only), crew rostering (OR-Tools CP-SAT examples, no airline-specific repo), and transactional outbox for Node (only immature packages).

### Cited Findings

**Airport / airline / aircraft reference data with time zones**

- **davidmegginson/ourairports-data** — 526 stars, Unlicense (public domain), **updated daily** from ourairports.com; files: airports.csv, runways.csv, airport-frequencies.csv, countries.csv, regions.csv, navaids.csv, airport-comments.csv; maintainer asks for no PRs (next dump overwrites) — edit on ourairports.com instead — [GitHub](https://github.com/davidmegginson/ourairports-data). The open-source-aviation list reports ~78K+ airports (metadata table 86,330 rows) — [open-source-aviation](https://github.com/lucianosrp/open-source-aviation)
- **jpatokal/openflights** — 1.7k stars, 458 forks, code AGPL-3.0, 810 open issues; README: "this codebase is an unholy mess", most from 2008, tests "woefully incomplete". Data: airports.dat, airports-extended.dat, airlines.dat (IATA/ICAO codes, callsigns), routes.dat (last updated 2017); `.dat` files have no header row; list marks OpenFlights "unmaintained since 2019" — [GitHub](https://github.com/jpatokal/openflights); [open-source-aviation](https://github.com/lucianosrp/open-source-aviation)
- OpenFlights-derived npm wrappers carry both a numeric UTC offset (`timezone`, e.g. 5.5 for India), an Olson `tz` name (e.g. "America/Los_Angeles") and a `dst` code (E/A/S/O/Z/N/U): **dmnsgn/airports-data** (`airports-data`, 2 stars, 9 commits, MIT, `--dynamic` refetch) — [GitHub](https://github.com/dmnsgn/airports-data); also `fetch-airport-data` and `openflights-cached` (snippet) — [npm search](https://www.npmjs.com/package/airports-data)
- **lxndrblz/Airports** — 243 stars, 110 commits, data CC BY-SA 4.0, CSV (airports.csv, citycodes.csv) with IATA, ICAO, time zone, name, city code, ISO country, elevation, lat/lon; dump of travelhackingtool.com database; 21 open issues; time-zone format and airport count not stated — [GitHub](https://github.com/lxndrblz/Airports)
- **ip2location/ip2location-iata-icao** — 271 stars, IATA↔ICAO pairing with country/region (updated Oct 27 2026); **BesrourMS/Airlines** — 52 stars, JSON of airline IATA codes — [GitHub topic: iata](https://github.com/topics/iata?o=desc&s=stars)
- **evansiroky/timezone-boundary-builder** — 1.1k stars, code MIT, **data ODbL**, builds shapefiles/GeoJSON of world tz boundaries (one `tzid` each) from OpenStreetMap in several variants (comprehensive / same-since-1970 / same-since-now, with or without oceans); image filenames reference a "2026f" release — [GitHub](https://github.com/evansiroky/timezone-boundary-builder)
- **evansiroky/node-geo-tz** (`geo-tz`) — 456 stars, MIT; `find(lat, lon)` → `['America/Los_Angeles']`; entry points `geo-tz` (alike since 1970, default), `geo-tz/all`, `geo-tz/now`; reads data from disk (not for browsers; set `GEO_TZ_DATA_PATH` after bundling); ocean coords return `Etc/GMT*`; "stay on the latest version because timezone data changes" — [GitHub](https://github.com/evansiroky/node-geo-tz)
- aviowiki free export ~32K structured airport records (free_airports.json.zip) — [open-source-aviation](https://github.com/lucianosrp/open-source-aviation)

**Schedules (SSIM)**

- **wcagreen/rusty-ssim** — 3 stars, MIT, Rust CLI + Python bindings (`pip install rustyssim`, Python 3.10+), parses SSIM record types 2 (carrier), 3 (flight leg), 4 (segment) into Polars DataFrames / CSV / Parquet, parallel + batch processing, `cargo test` and `pytest` — [GitHub](https://github.com/wcagreen/rusty-ssim)
- **rok/ssim** — 5 stars, GPL-3.0, Python (`ssim.read`, `ssim.expand_slots`, pandas), fork of ramonvanschaik/ssim, "under active development" (alpha); bug reports go to Schiphol-Hub/ssim — [GitHub](https://github.com/rok/ssim)
- **ezzaze/ssim-parser** — PHP 8.2+, MIT, 2.0.0 on Packagist (snippet) — [GitHub](https://github.com/ezzaze/ssim-parser)
- jetway includes SSIM/ASM parsing in Go — [GitHub](https://github.com/adamf/jetway)
- No npm SSIM parser was found.

**Fare rules (ATPCO)**

- Only otaip claims ATPCO category modelling (fare rules, fare construction, taxes) — [GitHub](https://github.com/TelivityAI/otaip). No standalone open-source ATPCO parser was found before the search budget ran out.

**NDC / ONE Order tooling**

- IATA's AirTechZone offers an NDC/ONE Order Message Viewer "designed for" NDC 18.2+ AirShoppingRS, OfferPriceRS, OrderViewRS, states it "does not provide any validation", and says its conversion tools can be downloaded from GitHub (URL not surfaced); official schemas are behind IATA's download page / developer.iata.org (snippet; site unreachable from this session) — [airtechzone tools](https://airtechzone.iata.org/api/tools); [developer.iata.org](https://developer.iata.org)
- **chrisstina/ndc-json2xml** — 3 stars, MIT, TypeScript/JS, converts NDC JSON → NDC XML for versions 16.2, 17.1, 17.2, 18.1, 18.2, 19.1, 19.2 (version string like `"182"`); wrapper of code originally by @airtechzone; minimal docs, no releases — [GitHub](https://github.com/chrisstina/ndc-json2xml)
- **open-ndc/ndc-js-sdk** (fork of okev/ndc-js-sdk; published as `ndc-client`) — 3 stars, 80 commits, Travis-era CI, README example only shows `AirShopping`, NDC version unstated, README install paths point at `iata-ndc/ndc-js-sdk` — [GitHub](https://github.com/open-ndc/ndc-js-sdk); npm `ndc-client` 0.1.5, 8 weekly downloads, non-standard "IATA" license (snippet) — [npm](https://npmjs.com/package/ndc-client). The `github.com/iata-ndc` org URL returned 404 on 2026-11-02.
- **iata-ndc/ndc-java-sdk** — host-agnostic Java SDK; "at the moment only available builders are AirShoppingRQBuilder and SeatAvailabilityRQBuilder" (snippet) — [GitHub](https://github.com/open-ndc/ndc-java-sdk)
- **jinahya/iata-ndc-bind-2133-javax** — 3 stars, JAXB binding classes for NDC 21.3 — [GitHub topic: ndc](https://github.com/topics/ndc?o=desc&s=stars)

**BCBP (boarding-pass barcode) encoding/decoding**

- **georgesmith46/bcbp** (`bcbp` on npm) — 64 stars, 14 forks, 989 commits, MIT, TypeScript sources, Jest tests; supports **BCBP version 6** and any number of legs; API `encode(bcbp: BarcodedBoardingPass) => string`, `decode(bcbp: string, referenceYear?: number)`; topic page shows last update Sep 1 2026 — [GitHub](https://github.com/georgesmith46/bcbp); [topic: iata](https://github.com/topics/iata?o=desc&s=stars); npm 6.0.2, ~1,251 weekly downloads (snippet) — [npm](https://npmjs.com/package/bcbp)
- Python `bcbp` on PyPI (decode/encode, v1.0, formerly "hattr"), much smaller (snippet) — [PyPI](https://pypi.org/project/bcbp); Node-RED wrapper mlfunston/node-red-contrib-iata-bcbp (GPL-3.0) (snippet) — [GitHub](https://www.github.com/mlfunston/node-red-contrib-iata-bcbp)
- None of these render the PDF417/Aztec/QR image; they work at the string level.

**Boarding pass PDF / Apple Wallet / Google Wallet**

- **alexandercerutti/passkit-generator** — 1.3k stars, 146 forks, 1,186 commits, MIT, "the easiest way to generate custom Apple Wallet passes in Node.js"; v3 current (v2 kept for reference); models must use `.pass` folder extension; icon required; manifest/signature generated at runtime; certificates via OpenSSL guide; sample pass.json has `"boardingPass": {}` — [GitHub](https://github.com/alexandercerutti/passkit-generator)
- **walletpass/pass-js** (`@walletpass/pass-js`) — 742 stars, 86 forks, 1,294 commits, **AGPL-3.0-or-later**, written in TypeScript, supports localizations, NFC, web-service push updates; examples use GATE/SEAT/FLIGHT fields; release-please + provenance publishing, 2026 copyright — [GitHub](https://github.com/walletpass/pass-js)
- **oscartrevio/passlet** — 14 stars, 471 commits, MIT, zero dependencies, Node 20.19+/22.12+; single `boardingPass()` method maps to Apple "Boarding pass" and Google "Flight/transit" types; has v3 and v4 upgrade guides (API churn) — [GitHub](https://github.com/oscartrevio/passlet). Design point from the search: Apple wants a signed `.pkpass` archive while Google wants a JWT backed by a REST API with different field names/layouts (snippet) — [passlet FAQ](https://github.com/oscartrevio/passlet/wiki/FAQ)
- `passkit-node-sdk` is an SDK for the hosted PassKit.io service, not standalone (snippet) — [npm](https://www.npmjs.com/package/passkit-node-sdk)

**PAXLST / EDIFACT / PNRGOV**

- **nerdocs/pydifact** (Python) — 190 stars, 54 forks, 627 commits, MIT; parses/serialises UN/EDIFACT interchanges, validates segments and UNB against specs, tolerates non-conformant input with warnings; **no UNG/UNE functional groups**, "API is not stable yet"; no message-directory (PAXLST) support mentioned — [GitHub](https://github.com/nerdocs/pydifact)
- `edifactlib` (PyPI, 0.2.0) has directories D.21A–D.24A only, under active development (snippet) — [PyPI](https://pypi.org/project/edifactlib/); `edifact-parser` (npm, generic, built on `edi`) (snippet) — [npm](https://www.npmjs.com/package/edifact-parser); Chemaclass/edifact-parser (PHP) (snippet) — [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2FChemaclass%2Fedifact-parser)
- **EdiFabric/EDIFACT.NET** — 110 stars, C#/.NET 6/4.8 (and .NET 8–10 targets); examples only, "AS IS"; the underlying EdiFabric library is **commercial** (NuGet, serial key; Community tier non-production, 250 ops/day after 14 days). IATA coverage shown: **PNRGOV** (PADIS); PAXLST listed under US Customs — [GitHub](https://github.com/EdiFabric/EDIFACT.NET)
- jetway (Go) implements PAXLST and PADIS PAOREQ/PAORES/CONTRL — [GitHub](https://github.com/adamf/jetway)
- No PAXLST-specific open-source library in any language was found.

**Type B / movement messages**

- **mvt-parser** (PyPI 1.0.0, released Apr 3 2026, MIT, Python 3.9+, source noredgaras/mvt_parser_lib) parses MVT, MVA, DIV with COR/REV flags; fields: flight header, registration, actual/estimated times (AD/AA/ED/EA/on-block/take-off), delay codes and durations, pax/infants, routing/diversion, take-off fuel/weight, ZFW, multi-leg lines, supplementary info — [PyPI](https://pypi.org/project/mvt-parser/)
- jetway covers MVT, PNL/ADL, BSM/BPM/BUM, AFTN, ACARS OOOI — [GitHub](https://github.com/adamf/jetway)
- No maintained general-purpose SITA Type B parser was found.

**Seat map rendering**

- **shorif2000/react-seatmap** (fork of gcedo/react-seatmap) — 1 star, MIT, 52 commits, 14 open PRs, usage shows legacy `React.render`; rows as arrays with `null` aisles, `isReserved`, `maxReservableSeats`, callbacks, `seatWidth` — [GitHub](https://github.com/shorif2000/react-seatmap); npm `react-seatmap` page returned 403 to this session.
- `@seatmaps.com/react-lib` and `@jaganax/seat-chart-reactjs` exist (snippet, venue-oriented) — [yarn](https://classic.yarnpkg.com/en/package/@seatmaps.com/react-lib)
- Duffel's `DuffelAncillaries` component renders seat selection from Duffel seat-map data (requires Duffel) — [GitHub](https://github.com/duffelhq/duffel-components). Duffel's blog "Falsehoods about seat maps" says the team examined hundreds of real seat maps before designing its Seat Map API (snippet; duffel.com unreachable) — [Duffel blog](https://duffel.com/blog/falsehoods-about-seat-maps)
- MalharSarwate's demo ships an accessible 2D seat map with a 3D cabin fallback — [GitHub](https://github.com/MalharSarwate/Airline-Reservation-Systemm)

**Weight & balance / load sheet**

- **CAP-CalebNewville/tipping-point (TippingPoint)** — 0 stars, PHP 8 + SQLite (MySQL migration), v2.0.4; multiple CG envelopes (Normal/Utility/Restricted), MLW and weight checks, lb/kg & gal/L, multi-aircraft admin; **general aviation** (clubs, schools, FBOs), no airline scope, no tests mentioned, "professional-grade accuracy" unsubstantiated — [GitHub](https://github.com/CAP-CalebNewville/tipping-point)
- Other hits are single-type GA tools: ddemski/WeightAndBalance (C172), N129BZ/zodiacwb, theTisch21/erau-wb, johnberroa/weight_and_balance (C172S/Breezer PDF) (snippets) — [GitHub](https://github.com/ddemski/WeightAndBalance)
- awesome-flying's W&B section lists only a paid iOS app (Gyronimo) — [awesome-flying](https://github.com/bauidch/awesome-flying)
- No open-source airline (transport-category) load sheet / LIR calculator was found.

**Crew rostering / optimisation**

- Google OR-Tools (Apache-2.0; C++ with Python/C#/Java wrappers; CP-SAT supports integer vars, boolean logic, intervals, all-different, no-overlap, cumulative) (snippet) — [or-tools](https://github.com/google/or-tools). The `shift_scheduling_sat.py` example models 8 employees × 21 days × {off, morning, afternoon, night} with hard rules (one assignment/day, fixed shifts, run-length limits, forbidden night→morning), soft sequence and weekly-sum penalties, penalised transitions, and per-shift coverage demands — structurally analogous to crew rest/duty rules — [or-tools example](https://github.com/google/or-tools/blob/stable/examples/python/shift_scheduling_sat.py)
- No airline-specific crew pairing/rostering repository on OR-Tools was found (search did not surface one).

**IROPS / disruption optimisation research code**

- Not reached: the search for aircraft-recovery/disruption code was blocked by the exhausted search budget. (Gap.)

**Double-entry ledgers for payments**

- **TigerBeetle** — 17.3k stars, Apache-2.0, "the financial transactions database designed for mission critical safety and performance"; only two data types (accounts, transfers) — [GitHub](https://github.com/tigerbeetle/tigerbeetle). Node client `tigerbeetle-node` (install `--save-exact`), Node 18+, Linux 5.6+ for production; `createAccounts`/`createTransfers` batch APIs (default max batch 8189); **two-phase transfers** via `pending` flag then `post_pending_transfer`/`void_pending_transfer` (fits seat-hold/payment-authorisation semantics); `linked` flag for all-or-nothing chains; `imported` events for history; client retries indefinitely with no per-request timeout so IDs must be used for idempotent retries; BigInt for 64-bit fields; query APIs marked preview — [Node client README](https://github.com/tigerbeetle/tigerbeetle/tree/main/src/clients/node)
- **flash-oss/medici** — 361 stars, 102 forks, MIT, Node + Mongoose (MongoDB ≥4.0; replica set/sessions for transactions), TypeScript types since v5, Mongoose v9 support in 7.3; books, colon-separated sub-accounts, metadata filters, voiding by offsetting entries, optional balance snapshots. Caveats: cached balances can be stale up to 24h (48h when voiding with original date); README warns against `readConcern: "majority"` in production (negative balances, missing credits during failover) and recommends `"local"`; preventing negative balances needs a transaction plus `writelockAccounts`; `.balance()` not paginated; 8-digit default precision — [GitHub](https://github.com/flash-oss/medici)
- **formancehq/ledger (v3)** — 1.5k stars, 222 forks, Go 1.27+, "programmable open source core ledger for fintech", Numscript scripting, embedded Pebble storage per node, REST/gRPC/CLI, ops guide + Kubernetes docs; no TypeScript SDK or license shown on page; `docs/drafts` marked experimental — [GitHub](https://github.com/formancehq/ledger)

**Idempotency / outbox / queues for Node**

- **BullMQ** — 9.6k stars, 743 forks, MIT, "based on Redis or PostgreSQL" (README tagline still says Redis-based — conflict); features table lists atomic ops, persistence, debouncing/throttling (deduplication), rate limiter, FlowProducer parent/child flows, priorities, delayed/repeatable jobs, sandboxed workers; groups, batches, group rate limits are BullMQ-Pro; node-redis adapter needs `redis` ≥5.0.0; Valkey Glide adapter available; Dragonfly compatible; **no exactly-once claim** — [GitHub](https://github.com/taskforcesh/bullmq) (docs.bullmq.io unreachable from this session)
- `atomic-saga` 1.0.2 bundles saga + transactional outbox (polling publisher) + Express idempotency middleware, but its docs read as generated/promotional (snippet) — [unpkg](https://cdn.jsdelivr.net/npm/atomic-saga@1.0.2/README.md); `pg-node-outbox` 1.0.0 is "work in progress", disclaims exactly-once, Node 18+/PostgreSQL 13+ (snippet) — [pkgstats](https://www.pkgstats.com/pkg:pg-node-outbox); GitHub `transactional-inbox` topic lists TypeScript Postgres outbox/inbox projects incl. logical-replication based ones, last updated May 2024 (snippet) — [topic](https://github.com/topics/transactional-inbox)
- Stripe idempotency-key documentation could not be fetched (docs.stripe.com blocked). (Gap.)

**Flight tracking / open ADS-B**

- derhuerst/flightradar24-client 67 stars (JS, Sep 2024); OpenSky Network free ADS-B/Mode S research data; ADS-B Exchange sample data/freemium APIs; AVWX-Engine for METAR/TAF parsing — [topic: iata](https://github.com/topics/iata?o=desc&s=stars); [open-source-aviation](https://github.com/lucianosrp/open-source-aviation); [awesome-flying](https://github.com/bauidch/awesome-flying)

### Inferences

- For a Node 22 platform the "green" adoptable set is: `bcbp` (TS, tested), `passkit-generator` (MIT) or `passlet` (both wallets, MIT, but tiny community), `geo-tz` + a daily OurAirports import job (Unlicense) for airport/time-zone truth, BullMQ (already in this repo) for jobs, and TigerBeetle via `tigerbeetle-node` if a separate ledger service is acceptable (its two-phase pending transfers map directly onto payment authorisation/hold-then-capture). `@walletpass/pass-js` is AGPL, which matters for a proprietary SaaS.
- OpenFlights `tz` strings are convenient but the dataset is stale (routes 2017, airports partly unmaintained); the robust pattern is OurAirports lat/lon → `geo-tz` lookup → IANA zone, cached per airport, with a scheduled re-run when tzdata updates.
- SSIM, PAXLST, Type B and NDC have **no credible npm libraries**; a TypeScript platform will either write fixed-width/EDIFACT parsers itself (jetway's Go code and rusty-ssim's record-type model are good references) or call a Python/Rust sidecar (rustyssim, pydifact, mvt-parser).
- No open seat-map component understands airline realities (multi-deck, exit rows, bassinet, blocked/infant restrictions, paid zones); Duffel's component does but is tied to Duffel data. Expect to own the seat-map renderer.

### Gaps

- IATA's official GitHub repository for the NDC/ONE Order converters was referenced by AirTechZone but its URL was not found (site unreachable).
- No ATPCO fare-rule parser, no airline-grade W&B/LIR tool, no IROPS/aircraft-recovery research code, no airline crew-pairing repo were located within the available tool budget.
- react-seatmap npm metadata (downloads, publish date) blocked by HTTP 403.
- BullMQ deduplication specifics (dedup ids, TTL modes) and Stripe idempotency-key retention could not be confirmed from primary docs (hosts blocked).
- Formance license and TypeScript SDK availability not visible on the repo page.

---

## Key Question 3 — What have engineers written about building airline systems (hard problems and solutions)?

### Takeaway

Primary engineering-blog sources (duffel.com/blog, code.kiwi.com, Skyscanner/Hopper on Medium, Ryanair Labs, Lufthansa Systems) were unreachable from this session and the search budget ran out, so this section is thin. What was captured: Kiwi.com describes flight data as changing at ~40,000 entries/second with "no global identifier of a flight" (flights identified by segments) and cheapest-connection search as NP-hard; Hopper's forecasting rests on trillions of historical prices plus ~300B prices/month; AWS's Datalex case describes strangler-style migration from n-tier to Spring Boot microservices with a routing proxy; the AWS serverless sample encodes booking as a Step Functions saga; Duffel documents that seat maps are full of "falsehoods"; and the one HN thread found frames the industry on 1960s TPF mainframes with Sabre's 2024 outage as the cost of failure.

### Cited Findings

- Kiwi.com (Brno/Moscow Python meetup deck "Refactoring database storage at Kiwi.com"): "the ultimate problem with flight data is that they are changing", ~40,000 flight entries processed per second, "there is no global identifier of a flight, so flights are identified by their segments" (snippet) — [Speaker Deck](https://speakerdeck.com/moscowdjango/refactoring-database-storage-at-kiwi-dot-com)
- Kiwi.com cheapest-connection search is described as a real-world NP-hard optimisation where exact methods struggle as instances grow, so heuristics are favoured (2019 ICCCEEE listing, snippet) — [HHU catalogue](https://katalog.ulb.hhu.de/Record/9947597097506443); Kiwi's Nomad multi-city product is built on its routing system and framed as TSP (snippet) — [code.kiwi.com on Medium](https://medium.com/code-kiwi-com/kiwi-com-nomad-the-synergy-between-science-technology-and-creativity-777b883a5f09)
- Kiwi.com CEO: every carrier has "a different website, API, different processes for managing post-booking services, ancillary services etc." which the company must accommodate (snippet) — [Medium interview](https://medium.com/goingglobal/were-a-content-and-customer-service-company-not-a-marketing-one-6ec2975e9ed); Kiwi's "Booking Backend" is described as its customer-facing order-management system (job listing, snippet) — [Lever](https://jobs.eu.lever.co/kiwi/b48b4096-cc30-42aa-b724-6dbfae55d1d0)
- Hopper: database of "trillions of historic prices from the past decade" plus "an active feed of about 300 billion prices a month"; forecasts blend historical prices, demand and other signals; 95% accuracy is a company claim (Harvard D3 case, snippet) — [Harvard D3](https://d3.harvard.edu/platform-digit/submission/hopper-using-ai-to-plan-your-next-vacation/); Hopper moved its data platform from Hadoop to Spark when adding instant booking (snippet) — [PhocusWire](https://www.phocuswire.com/Hopper-the-cheap-flights-app-adds-instant-booking-shifts-platform-from-Hadoop-to-Spark); Hopper's "AI in travel" series models price as a preference distribution (preferred point + spread) (snippet) — [Life at Hopper](https://medium.com/life-at-hopper/ai-in-travel-part-3-representing-preference-distributions-c35b307fb25c)
- Duffel, "Falsehoods about seat maps": the team investigated hundreds of real seat maps and several display systems while designing its Seat Map API (snippet; page unreachable) — [Duffel blog](https://duffel.com/blog/falsehoods-about-seat-maps)
- AWS Architecture Blog on Datalex (airline retailing platform): moved from n-tier to Spring Boot microservices, using a proxy to route traffic between old and new components so migration proceeds incrementally; a compatible runtime let existing code run on modern tech with minimal changes (snippet) — [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/accelerating-airline-retailing-innovation-how-datalex-modernized-with-aws-experience-based-acceleration-and-agentic-ai/)
- AWS serverless airline sample: booking workflow as a Step Functions state machine with payment collection and refund steps inside it, SNS fan-out to loyalty, per-type AppSync authorisation — [GitHub](https://github.com/aws-samples/aws-serverless-airline-booking)
- AWS re:Invent airline material found is mostly 2021–2023 (United: 100+ apps migrated since 2019; Delta Bedrock customer-service tool at re:Invent 2023; Aeroméxico 80% of systems to cloud in four years) (snippets) — [AWS United case](https://aws.amazon.com/solutions/case-studies/united-airlines-2021-reinvent-video); [AWS Aeroméxico](https://aws.amazon.com/solutions/case-studies/aeromexico-modernization/)
- Deloitte 2026 case study: a US airline's legacy PSS "handles bookings, check-in, and bag handling" and the transformation was started "without downtime" (snippet) — [Deloitte PDF](https://www.deloitte.com/content/dam/assets-zone3/us/en/docs/about/2026/us-deloitte-case-study-modernizing-an-airline-without-disrupting-the-journey.pdf)
- Hacker News thread (70 points, 31 comments, via mirror) on "The Problem That Built an Industry": GDS/PSS lineage from Sabre 1964 (American + IBM, ACP/TPF) with Amadeus as the exception (Bull mainframes, later Unix); commenters ask how long LCCs took to integrate with legacy GDSs and lament Google shelving a Sabre replacement; Sabre's 2024 outage cited as the cost of failure (snippet; HN unreachable) — [article](https://ajitem.com/blog/iron-core-part-1-the-problem-that-built-an-industry); [HN mirror](https://astro-hacker-news.pages.dev/47730712)
- Generic system-design write-ups (not airline-company sources) converge on: seat holds with 5–15 min TTL released together on expiry/payment failure; strong consistency for seat inventory; multi-seat holds inside a single SQL transaction (snippets) — [dev.to](https://dev.to/matt_frank_usa/designing-an-airline-reservation-system-157k); [techinterview.org](https://www.techinterview.org/post/3233472320/lld-airline-reservation/)
- TigerBeetle's client guidance embodies two patterns relevant to payments reconciliation: use client-generated IDs so indefinite retries are idempotent, and model holds as pending transfers that are later posted or voided — [TigerBeetle Node client](https://github.com/tigerbeetle/tigerbeetle/tree/main/src/clients/node)
- Medici's README documents the read-consistency trap: stale reads under `readConcern: "majority"` produced negative balances/missing credits during failovers, and preventing negative balances requires an explicit per-account write lock inside a transaction — [medici](https://github.com/flash-oss/medici)

### Inferences

- The recurring themes across the sources that were reachable are: (1) flight/fare data is high-velocity and lacks a stable natural key, so caches must be segment-keyed and short-lived; (2) booking must be an explicit multi-step workflow with compensation (saga), not a single request; (3) holds/authorisations are two-phase and need TTL plus idempotent retry; (4) ledger reads must be strongly consistent or you will show wrong balances; (5) carrier heterogeneity (APIs, post-booking rules) is the dominant integration cost — which is why aggregators (Duffel, Kiwi, otaip) build adapter layers.
- The archival of Amadeus SDKs and the rise of agent "booking skills" in 2026 suggest distribution is shifting toward NDC/aggregator APIs and agentic channels; the platform's own API will increasingly be consumed by machines, raising the bar on idempotency and schema stability.

### Gaps

- Could not read Duffel, Kiwi.com, Skyscanner, Hopper, Ryanair Labs, Lufthansa Systems or IndiGo engineering posts directly (hosts blocked / search budget exhausted). Specific published solutions for PNR locking, fare caching TTLs, schedule-change propagation and payments reconciliation at these companies remain unsourced.
- No 2024–2025 re:Invent or QCon airline-PSS session transcript was located.

---

## Key Question 4 — What do aviation/IT forums report as recurring user-facing failures of booking systems?

### Takeaway

Only search-engine snippets of FlyerTalk/FlightAware threads were reachable (flyertalk.com, HN and Reddit are blocked from this session). They point to four recurring failure classes: duplicate bookings/charges after a website error followed by a retry; "double charge" confusion where the second amount is actually taxes/fees on seats; time-zone/date bugs (bookings made from UTC+ zones landing on the wrong date; durations shown wrong because only local times are published; APIs returning UTC while sites show local time); and ancillaries re-charged during rebooking (Ryanair refund case).

### Cited Findings

- FlyerTalk: a booking failed with an error twice on the website, then succeeded in the app — afterwards there were two bookings in the account (duplicate reservation after retry) (snippet) — [FlyerTalk post](https://www.flyertalk.com/forum/27342757-post7.html)
- FlyerTalk "Double charging for seat selection?": a 2015 check-in page asked for payment again for seats already bought ($10/seat/segment); a reply says the apparent double charge was actually extra taxes (snippet) — [FlyerTalk post](https://www.flyertalk.com/forum/24730918-post2.html)
- FlyerTalk United thread "Charged twice for same flight — common?" — replies centre on credit vs debit card protection (snippet) — [FlyerTalk thread](https://www.flyertalk.com/forum/united-airlines-mileageplus/1951893-charged-twice-same-flight-common-2.html); 2025 thread on double charges for in-flight food across two reservations (snippet) — [FlyerTalk post](https://www.flyertalk.com/forum/36840549-post4.html)
- Ryanair passengers were charged twice for seats and bags when rebooking; airline said any double-charged customer would be refunded (snippet) — [BreakingNews.ie](https://www.breakingnews.ie/business/ryanair-passengers-told-to-pay-twice-for-extras-when-re-booking-806601.html)
- FlyerTalk: Alaska Airlines' site assigned the wrong date for bookings made from time zones a day ahead of US Pacific; poster had to buy a new ticket and got no compensation ("The IT issue essentially gives incorrect booking dates to the one you've selected") (snippet) — [FlyerTalk post](https://www.flyertalk.com/forum/33489565-post1.html)
- FlyerTalk: United website showed incorrect travel time around DST changes; "local departure and arrival times are published, so duration requires timezone math" (snippet) — [FlyerTalk thread](https://www.flyertalk.com/forum/united-airlines-mileageplus/1496405-united-website-showing-incorrect-travel-time-time-zone-time-change-issues.html)
- FlightAware forums: AA.com shows departure 13:50 while the API returns 12:50; FlightXML returns epoch UTC only, not local timestamps; another user saw all times in their own zone (MDT) regardless of airport until logging out; Cancún time-zone change caused departure-time errors (snippets) — [FlightAware: local date issue](https://discussions.flightaware.com/t/flightaware-api-v3-local-date-issue/61998); [Cancun timezone](https://discussions.flightaware.com/t/cancun-timezone-changes-and-departure-time-error/16549); [Time zone issue](https://discussions.flightaware.com/t/time-zone-issue/10515)
- OneMileAtATime community: $846.81 checked-bag charge on an award ticket "due to glitch" (snippet) — [OMAAT](https://onemileatatime.com/community/other-airlines/846-81-checked-bag-charge-on-award-ticket-due-to-glitch/)
- Older but relevant: Delta mistake-fare tickets cancelled "due to no ticket number" — bookings existing without an issued e-ticket (snippet) — [Eye of the Flyer](https://eyeoftheflyer.com/2013/12/28/was-your-delta-mistake-fare-ticket-canceled-due-to-no-ticket-number-it-is-not-too-late-by-all-reports/)
- HN thread context: Sabre's 2024 outage cited as an example of how costly a PSS failure can be (snippet) — [HN mirror](https://astro-hacker-news.pages.dev/47730712)

### Inferences

- Each forum failure maps to a concrete engineering control: duplicate bookings ⇒ client-supplied idempotency keys on `bookings.create` and dedup on (user, flight, passengers) within a window; "double charge" confusion ⇒ itemised price breakdown that distinguishes base/ancillary/tax and shows what was already paid; wrong-date bookings ⇒ never derive travel dates from the client's clock — treat search/booking dates as airport-local calendar dates and store IANA zones per airport; DST duration errors ⇒ compute durations from UTC instants, not local wall-clock subtraction; rebooking re-charges ⇒ carry paid ancillaries (EMDs) across exchanges; "no ticket number" ⇒ expose ticketing state separately from PNR state and alert on confirmed-but-unticketed bookings.

### Gaps

- Could not open FlyerTalk, HN, Reddit (r/aviation, r/flying), airliners.net, PPRuNe or Stack Overflow threads directly; findings are snippet-level and anecdotal.
- No sourced forum material on name-change/typo rules, seat-map display errors specifically, lost PNRs, or accessibility (screen-reader) failures of airline sites — the search for those was blocked by the exhausted budget.

---

## Key Question 5 — What patterns distinguish demo-grade "airline reservation system" projects from production-grade systems?

### Takeaway

Across the ~25 repositories inspected, demo projects are recognisable by simulated payments, process-local state, seeded default credentials, direct-flight-only models, no idempotency, and no tests, whereas the few credible references (AWS sample, otaip, jetway, MalharSarwate's own gap list, TigerBeetle/Medici docs) converge on an explicit booking workflow with compensation, idempotency keys, TTL'd holds, strongly consistent ledgers, message-standard conformance (BCBP, PADIS, Type B), and honest production-readiness documentation.

### Cited Findings (evidence base)

- Demo markers observed: "Payments are simulated"; e-tickets "not valid for travel"; events "process-local" with no shared broker; only direct one-way flights; HTTPS/rate limiting/secret store/monitoring absent — [MalharSarwate README](https://github.com/MalharSarwate/Airline-Reservation-Systemm). Seeded admin/customer passwords published in README; no automated test command; free-tier cold starts of 30–50 s; stack metadata inconsistent (MySQL vs PostgreSQL) — [AirOpsManager](https://github.com/SyedMuhammadFaheem/AirOpsManager-AirlinesManagementSystem). Archived WIP microservices with 29 commits — [rodrigobdz](https://github.com/rodrigobdz/airline-reservation-system). Console/WinForms/JSP coursework dominating the topic pages — [topic: airline-booking](https://github.com/topics/airline-booking?o=desc&s=stars)
- Production-leaning markers observed: seat holds + group-hold planner + idempotency keys + Testcontainers DB tests + Playwright E2E — [MalharSarwate](https://github.com/MalharSarwate/Airline-Reservation-Systemm); Step Functions saga with payment collect/refund steps, per-type authorisation, loyalty decoupled via SNS — [AWS sample](https://github.com/aws-samples/aws-serverless-airline-booking); typed pipeline contracts to prevent invalid bookings, explicit EMD/ADM/BSP/involuntary-rebooking stages, a separate production-readiness checklist gating "money-path" use — [otaip](https://github.com/TelivityAI/otaip); mTLS ingress, peer identity from certificates, explicit refusal to handle production passenger data until encryption-at-rest and erasure workflows exist — [jetway](https://github.com/adamf/jetway); two-phase (pending/post/void) transfers, linked all-or-nothing batches, client-generated IDs for idempotent retry — [TigerBeetle Node client](https://github.com/tigerbeetle/tigerbeetle/tree/main/src/clients/node); documented read-concern and locking caveats for balances — [medici](https://github.com/flash-oss/medici); BCBP v6 encoder with Jest tests and `referenceYear` handling for date fields — [bcbp](https://github.com/georgesmith46/bcbp); daily-refreshed reference data with an upstream edit workflow instead of PRs — [ourairports-data](https://github.com/davidmegginson/ourairports-data); tz boundaries versioned with tzdata releases and advice to stay current — [node-geo-tz](https://github.com/evansiroky/node-geo-tz)

### Inferences (the distinguishing patterns)

1. **Booking as a workflow, not a request**: pending → hold/authorise → ticket → confirm, with compensating actions (release hold, refund) and a durable state machine or queue-backed saga (AWS sample; BullMQ flows).
2. **Idempotency everywhere money or inventory moves**: client-supplied idempotency keys on create-booking and payment calls; deduplicated job IDs; retries safe by construction (MalharSarwate, TigerBeetle, BullMQ dedup).
3. **Inventory holds with TTL and atomic release**, and strong consistency on seat/RBD counts (generic design posts; MalharSarwate seat holds).
4. **Separate PNR state from ticketing state and payment state**; alert on confirmed-but-unticketed or paid-but-unconfirmed (Delta "no ticket number" case; otaip ticketing/EMD stages).
5. **Double-entry ledger for payments, refunds, credits and vouchers** with hold/post/void semantics rather than mutable `amountPaid` columns (TigerBeetle, Medici, Formance).
6. **Time handled as airport-local date + IANA zone + UTC instant**, with reference data refreshed on a schedule (OurAirports + geo-tz; FlyerTalk/FlightAware failures).
7. **Standards conformance at the edges**: BCBP v6 for boarding passes, wallet passes signed per platform, PADIS/Type B/PNL-ADL/BSM when talking to airports and governments (bcbp, passkit-generator/passlet, jetway).
8. **Operational hardening documented and enforced**: mTLS/JWT in HttpOnly cookies, rate limiting, secrets management, encryption at rest, erasure workflows, multi-instance-safe eventing — and a written production-readiness gate (jetway, otaip, MalharSarwate's gap list, AirOpsManager's anti-pattern of shipping default passwords).
9. **Real tests against real infrastructure** (Testcontainers DB suites, Playwright journeys covering decline/cancel paths) rather than mocked happy paths.
10. **Carrier/partner heterogeneity isolated behind adapters** (otaip adapters for Amadeus/Sabre/Navitaire/Duffel; glider-aggregator NDC/OTA-XML; Kiwi's statement that every carrier differs).

### Gaps

- These patterns are synthesised from READMEs and library docs; no single authoritative "production airline system checklist" source was found.
- Accessibility (WCAG) and multilingual (AR/EN) production patterns for airline UIs were not sourced beyond MalharSarwate's "accessible 2D seat map" and its multilingual-PDF limitation.
