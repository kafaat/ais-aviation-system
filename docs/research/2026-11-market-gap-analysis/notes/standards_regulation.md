# Industry Standards and Regulatory Requirements for an Airline Booking / Ticketing / DCS Platform (2024–2026), with Saudi Arabia / GCC focus

Research date: 2 November 2026. Method: ~45 web searches; direct fetches of iata.org, gaca.gov.sa, eulisa.europa.eu, kslaw.com, clydeco.com, qanoniah.com and bakerdonelson.com were blocked by the session's network allowlist, so primary PDFs on those hosts are cited from search-result excerpts rather than full reads. Where a figure rests on a secondary source (law-firm note, trade press, vendor blog), this is flagged.

Compliance-tier legend used throughout:

- **MANDATORY** = legally binding on an airline operating in the named jurisdiction (KSA / EU / US), or an IATA Resolution binding on IATA members / BSP participants.
- **INDUSTRY-EXPECTED** = not law, but de facto required by interline partners, GDS/airports/handlers, acquirers, or auditors.
- **EMERGING** = standard or rule exists/announced but adoption is early or dates are still moving.

---

## Key Question 1 — IATA standards (NDC, ONE Order / Offers & Orders, e-ticket/EMD, BCBP, baggage, SSIM, settlement, Timatic, payments, One ID, fares)

### Takeaway

IATA retailing standards are moving from the PNR/ET/EMD triad to Offers & Orders (NDC 21.3/24.1 schemas, ONE Order as master record), with IATA's roadmap putting "leading airlines live with Orders" in 2026-27 and mainstream industrialisation around 2028-29; the operationally binding items for any airline today remain e-ticketing (Res. 722f/725f), BCBP (Res. 792 v8), baggage tracking (Res. 753) and Type B baggage/DCS messaging, with BIX (Baggage XML) and One ID as the emerging layer.

### Cited Findings

**NDC (New Distribution Capability) and schema versions**

- IATA's Q1 2025 newsletter describes NDC schema 24.1 as stressing stability and improving order integrity and data exchange for financial transactions; Iberia's developer documentation says its 24.1 API is based on the IATA 24.1 standard with Branded Fares — [IATA update Aug 2025](https://go.updates.iata.org/l/123902/2025-08-19/j55rp2); [NDC 24.1 documentation (Atlassian/transform)](https://transform.atlassian.net/wiki/spaces/NDCDOC/pages/6350012424/Version+24.1)
- Finnair in July 2025 published migration of its NDC system to version 21.3; a 2026 third-party analysis of 82 airlines reports Turkish Airlines' IATA-verified capabilities grew from 21 (schema 21.3) to 49 in 2026, many under schema 24.1 — [Tragento NDC trends 2024-2025](https://tragento.com/en/latest-news-and-trends-2024-2025-in-ndc-distribution/); [LinkedIn analysis (secondary)](https://tr.linkedin.com/in/ezgikeklik)
- IATA's older certification guide: the certification period of a schema version is 36 months from release, the validity period 48 months, and NDC certification per entity is valid for 12 months (pre-dates 24.1) — [IATA NDC Registration & Certification Program guide](https://www.iata.org/contentassets/a0767ce7996445a3bc4cacd812e37ce4/guide-ndc-registration-certification-program.pdf)
- Certification levels: Level 3 targets end-to-end NDC deployments covering both offer and order management (shopping, booking, payment, ticketing); Level 4 covers full service and change capability — [Ethiopian NDC docs](https://ndc-doc.ethiopianairlines.com/); [Oman Air Level 4 (schema 18.2)](https://www.traveldailynews.com/post/oman-air-achieves-iata-ndc-level-4-certification-and-expands-ndc-based-distribution-globally); [Etihad Level 4](https://www.etihad.com/en-az/news/etihad-airways-achieves-iata-level-4-ndc-certification)
- IATA replaced the Level 1-4 / NDC@Scale certification with the multilayered Airline Retailing Maturity (ARM) index (launched October 2021, intended to fully replace NDC and ONE Order certification after a one-year transition) — [Travel Weekly](https://www.travelweekly.com/Travel-News/Airline-News/IATA-replacing-current-NDC-certification-process); [Scribd copy of IATA NDC doc (secondary)](https://www.scribd.com/document/727146204/ndc). NOTE: airline press releases in 2024-2025 still use "Level 4" language, so terminology is mixed.
- IATA Airline Retailing Maturity capability docs define e.g. "Order Creation Without Tickets/EMDs [ORDCWT]" as a verifiable capability — [IATA ARM capability ORDCWT](https://retailing.iata.org/armi/docs/ORDCWT/)

**ONE Order / Offers & Orders / Modern Airline Retailing transition**

- IATA's June 2026 fact sheet describes ONE Order as an industry-led standard supporting the move to 100% Offers and Orders, says leading airlines are starting to shift from legacy PSS environments, and points to the Offers & Orders High-Level Industry Transition Roadmap — [IATA ONE Order fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet---one-order/)
- IATA published the first Modern Airline Retailing transition roadmap to 100% Offers and Orders in November 2024; it sets out readiness levels and timelines for value-chain stakeholders and "will evolve over time" — [IATA roadmap page](https://www.iata.org/en/publications/newsletters/airline-retailing-hub/modern-airline-retailing-industry-transition-roadmap/); [IATA retailing program](https://www.iata.org/en/programs/airline-distribution/retailing)
- An IATA 2025 presentation slide shows a phase labelled 2026-27 for "leading airlines live with Orders", with mainstream industrialisation around 2028-29 and later; Lufthansa Systems gives "100% Offers and Orders by ideally 2030" — [IATA presentation (S. Touraine, 2025)](https://www.iata.org/contentassets/06c4cf2ba09649008de86be7898af8fa/presentations-2025/beyond-the-slide-deck_sebastien-touraine.pdf); [Lufthansa Systems blog](https://lhsystems.com/blog-entry/why-airlines-should-engage-airline-retailing)
- IATA update August 2025: "the first legacy-free, native Order implementations are now live" — [IATA update Aug 2025](https://go.updates.iata.org/l/123902/2025-08-19/j55qrv)
- IATA best-practices document (cover dated October 2026): airlines can only be considered live with "Native Orders" when the Order serves as the master record for sales — [IATA MAR Offers & Orders transformation best practices](https://www.iata.org/contentassets/5f381dc8a61e4c8bb90a6323358f2218/mar-offers-orders-transformation-best-practices.pdf)
- The "pioneer airlines" language comes from an older IATA NDC/ONE Order brief that expected ONE Order to be tested with several pioneer airlines from 2021 — [IATA NDC in Focus: ONE Order](https://www.iata.org/contentassets/6de4dce5f38b45ce82b0db42acd23d1c/ndc-infocus-one-order.pdf)
- 2023 IATA Offers & Orders Forum: 120 participants, 32 airlines, 15 IT vendors — [IATA Offers and Orders Forum](https://www.iata.org/en/publications/newsletters/airline-retailing-hub/offers-and-orders-forum)

**E-ticketing and EMD (Resolutions 722f / 725f-g-h)**

- IATA PSCRM table of contents (40th ed., 2020): Resolution 722f "Ticket—Airline" and 725f "Electronic Miscellaneous Document—Airline" — [IATA PSCM table of contents](https://www.iata.org/contentassets/2bac7c9adb4b473d8f0f112b56f65452/pscm-table-of-contents.pdf)
- IATA FAQ: the EMD standard sits in the Resolution Manual under 725f, 725g and 725h; two types, EMD-A (associated to an e-ticket coupon) and EMD-S (standalone) — [IATA FAQ on EMD](https://portal.iata.org/faq/articles/en_US/FAQ/What-is-an-Electronic-Miscellaneous-Document-EMD-1415811054748); [Wikipedia EMD](https://en.wikipedia.org/wiki/Electronic_miscellaneous_document)
- A 2026 IATA page refers to the 46th edition (2026) of the Passenger Standards Conference Manual — [IATA Passenger Standards Conference Manual](https://www.iata.org/en/publications/store/passenger-standards-conference-manual/); [IATA Knowledge Hub: key changes in manuals](https://www.iata.org/en/publications/newsletters/iata-knowledge-hub/finance-retailing-distribution-key-changes-manuals/)

**Bar Coded Boarding Pass (BCBP, Resolution 792)**

- Resolution 792 version 7 and the BCBP Implementation Guide 7th edition were effective 1 June 2018; the guide "complements Resolution 792" — [IATA BCBP Implementation Guide v7 (2021 reissue)](https://Www.Iata.org/contentassets/1dccc9ed041b4f3bbdcf8ee8682e75c4/2021_03_02-bcbp-implementation-guide-version-7-.pdf)
- The PSCRM table of contents lists "792 Bar Coded Boarding Pass (BCBP) — Version 8"; a third-party page gives 1 June 2020 as v8 effective date (unverified against IATA) — [PSCM 41 ToC (Scribd)](https://www.scribd.com/document/566204914/ToC-From-PSCM-41-en-Web); [third-party compliance page](https://www.neura.market/directories/md-directory/evals-md-boardingpasskit-iata-compliance-monrh1ev)
- Scandit's parser documentation supports BCBP up to version 8 — [Scandit IATA BCBP](https://docs.scandit.com/data-capture-sdk/web/parser/iata-bcbp.html)

**Baggage: Resolution 753, Type B BSM/BPM (RP 1745), BIX / RP 1755**

- Resolution 753 came into effect June 2018 and requires member airlines to track baggage at a minimum of four core tracking points (acceptance, loading, transfer, arrival); IATA's Dec 2025 report counts 256 in-scope airlines, with 80.1% of members having defined an implementation plan by end-2025 (Africa-Middle East 92%, Europe 68.8%, Asia-Pacific 67.3%); airports "often control the infrastructure that generates the tracking data airlines depend on" — [IATA R753 implementation executive report 2025](https://www.iata.org/contentassets/cb691a38573642d0bbfd2ba380eaf04e/americas-focus-2025/documents/iata-r753-implementation-executive-report-2025.pdf); [IATA R753 implementation plan](https://www.iata.org/contentassets/5c4aa8b8b3b1432697d2bf3301450684/iata-resolution-753-implementation-plan_final.pdf)
- 2024 IATA survey of 155 airlines and 94 airports: 44% of airports fully implemented Res. 753; 75% have the capability — [Business Traveller, May 2024](https://www.businesstraveller.com/business-travel/2024/05/13/iata-industry-making-progress-to-reduce-baggage-mishandling/)
- IATA's BIX guidance: the RP 1745 (Type B BSM/BPM) messaging standards have been in use since 1985 and make integration hard; replacement is Baggage Information Exchange (BIX) on the Airline Industry Data Model (RP 1755), with message conversion 1745↔1755 during co-existence; industry spends >US$1.05bn/year on Type B baggage messaging — [IATA BIX guidance document](https://www.iata.org/contentassets/6bb095b194bc4ebf851ed73c83266c20/bix-guidance-document.pdf)
- May 2025: IATA launched a 10-year Global Baggage Roadmap (digital messaging, end-to-end tracking, automation) — [IATA press release 14 May 2025](https://www.iata.org/en/pressroom/2025-releases/2025-05-14-01/)
- May 2026: IATA launched the Baggage Community System (BCS) enabling exchange via both BIX and legacy Type B during transition, with a "BIX Ready" badge — [IATA release 20 May 2026](https://www.iata.org/contentassets/463655d8abc34f608d27efd2b235ef72/2026-05-20-01-es.pdf); [Cyprus Mail](https://cyprus-mail.com/2026/05/22/iata-launches-new-digital-platform-to-modernise-baggage-handling)

**Type B messaging generally (PNL/ADL/PRL, LDM, MVT, SSM/ASM)**

- IATA Type B whitepaper (v2.5, 2025): format dates to the 1960s, store-and-forward, four priority levels, 7-character ATA/IATA addressing — [IATA Type B messaging whitepaper v2.5](https://www.iata.org/contentassets/badbfd2d36a74f12b021c9dd899ecbad/type-b-messaging-whitepaper-v2.5.pdf)
- PNL = passenger name list, ADL = additions/deletions list (CHG/DEL/ADD) sent by the reservations system to the handling DCS — [AeroCRS PNL/ADL setup](https://support.aerocrs.com/hc/en-us/articles/4416056996369-PNL-ADL-setup)
- MVT messages are sent immediately after departure/arrival, delays as soon as known, all times UTC; LDM conveys final load information between stations/OCC — [KIU MVT docs](https://kiu.atlassian.net/wiki/spaces/KOD/pages/213090369/MAN_Movement+Message); [Evionica W&B messages](https://www.evionica.com/wb-knowledge-base/available-messages-and-documents)

**Interline settlement: SIS / IS-XML / ICH / BSP**

- SIS is IATA's e-invoicing platform (IS-IDEC/IS-XML or web submission) integrated with ICH/ACH; current invoice standard listed is MISC/UATP IS-XML Invoice Standard v4.4.2.0; joining SIS connects to 420+ airlines; SIS Release 1.22.6.0 communication dated June 2026 — [IATA SIS for airlines](https://www.iata.org/en/services/finance/sis/airlines/); [IATA SIS release 1.22.6.0](https://www.iata.org/globalassets/iata/services/financial-services/sis/ispg--release-notes/iata_sis_release_1.22.6.0_communication.pdf); [Benefits of IS-XML with SIS](https://Www.iata.org/contentassets/9b1d8d19a6244e4e8cb8c7d7ad3f45e5/benefits-of-using-is-xml-with-sis.pdf)
- BSP is IATA's service for settlement of ticket revenues between agents and carriers; ICH provides settlement for the industry — [IATA Financial Services fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-financial-services/)

**Travel documents (Timatic) and carrier liability**

- IATA/CAWG guidelines: the transporting carrier is responsible for immigration fines if a passenger is inadequately documented; Timatic AutoCheck provides go/no-go document decisions at check-in (IATA claims average US$0.60 saving per boarded passenger) — [IATA CAWG document check guidelines 2016](https://www.iata.org/contentassets/67e015cf3db1410392cd5b5bb5961a16/iata-cawg-guidelines-for-document-checks-and-carrier-liability_2016.pdf); [IATA Timatic AutoCheck](https://www.iata.org/en/services/compliance/timatic/autocheck/)

**Payments: IATA Pay**

- IATA Pay (account-to-account, launched 2022) is available in 30+ countries; a Standard Chartered announcement cites 28+ airlines using it and 50 more set to activate; funds settle next day; Outpayce integration (Philippine Airlines first) — [IATA/Outpayce press release](https://outpayce.com/en/resources/news/iata-and-outpayce-help-airlines-accept-account-to-account-payments); [Hanoi Times / Standard Chartered](https://hanoitimes.vn/standard-chartered-and-iata-partner-to-launch-iata-pay-in-vietnam.592284.html); critical view that A2A adoption is "strategic but slow" — [T2Impact blog Aug 2025](https://t2impact.blogspot.com/2025/08/account-to-account-payments-in-airline.html)

**One ID / digital identity**

- RP 1701o (Contactless Travel) effective October 2023, published June 2024; RP 1701p (Digitalization of Admissibility) effective September 2022; RP 1701q covers Biometric Handling; IATA One ID Certification assesses against these and the One ID Technical Implementation Guide — [IATA One ID fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-one-id); [IATA One ID Certification](https://www.iata.org/en/services/certification/operations-safety-security/one-id-certification/)
- April 2026: IATA One ID trial showed one digital identity working across borders, airlines and competing mobile wallets — [Biometric Update via Pulse](https://www.pulse.bot/transportation/news/iata-digital-id-trial-shows-interoperability-across-countries-wallets-and-biometrics-5cbf600a-a282-4ada-8de3-e7df8c7132a6/)

**Fares: ATPCO, continuous pricing**

- ATPCO Dual RBD Validation Implementation Guide v3.1 (March 2025) describes continuous pricing as selecting prices from a continuous range rather than pre-filed price points; ATPCO reports 30+ airlines on Optimized Pricing; Air France-KLM and Lufthansa Group introduced continuous pricing on select markets via NDC — [ATPCO Dual RBD implementation guide v3.1c](https://d3i59dyun0two3.cloudfront.net/wp-content/uploads/media/2025/01/19153053/dynamic-pricing-dual-rbd_implementation-guide_v3.1c.pdf); [Travel Market Report](https://travelmarketreport.com/articles/Airline-Dynamic-Pricing-Getting-Closer-to-Reality-Says-ATPCO); [ePlaneAI](https://www.eplaneai.com/news/airlines-to-increase-use-of-ai-in-setting-fares-by-2026)

**Dangerous Goods**

- IATA DGR 67th edition effective 1 January 2026 (valid to 31 Dec 2026); Addendum I effective same date (Shipper's Declaration 8.1, acceptance checklist 9.1.2/9.1.3); new Appendix H for changes not yet in force (expected 2027) — [IATA DGR 67 Addendum 1](https://www.iata.org/contentassets/90f8038b0eea42069554b2f4530f49ea/dgr-67-addendum-1---en---01-january-2026.pdf); [Expeditors](https://info.expeditors.com/newsflash/new-version-of-iata-dangerous-goods-regulations-released)

### Inferences

- Tiering: **Res. 722f e-ticket / 725f EMD** = MANDATORY for any IATA/BSP-participating airline (no paper tickets are settled); a self-built PSS must generate and store ET/EMD records (13-digit document numbers, coupon status lifecycle O/C/F/R/E/V, interline ET exchange via EDIFACT TKCREQ/TKCRES is the de-facto interline mechanism — the latter is industry knowledge, not sourced above).
- **BCBP Res. 792 v8** = INDUSTRY-EXPECTED to MANDATORY in practice: any boarding pass scanned by airport common-use gates/security must be IATA 2D (PDF417 / Aztec / QR) in the "M1" format; evidence = sample passes parsed by a v8-compliant parser and acceptance by the airport's CUPPS/CUSS/gate readers.
- **Res. 753** = MANDATORY for IATA members (an IATA Resolution); evidence = documented implementation plan filed with IATA, BSM/BPM or BIX exchange with handlers at the four points; Africa-Middle East plan coverage at 92% means a Saudi carrier will be expected to comply by hub airports (e.g., RUH, JED) and interline partners.
- **Type B BSM/BPM, PNL/ADL, LDM/MVT, SSM/ASM** = INDUSTRY-EXPECTED today (handlers, airports, OCCs consume Type B); **BIX / RP 1755** = EMERGING, with a 10-year roadmap from 2025; a new DCS should emit Type B now and be designed to map to the AIDM/BIX model.
- **NDC 21.3 or 24.1 and Offer/Order APIs** = INDUSTRY-EXPECTED for distribution via aggregators/TMCs; **ONE Order / native Orders as master record** = EMERGING (2026-27 leaders, 2028-29 mainstream). A self-built platform that already models an "Order" with items/services and a payment ledger is strategically aligned; one that models booking = PNR + separate e-ticket + EMD is "legacy" in IATA terms but still fully compliant.
- **SIS/IS-XML** is MANDATORY only if the airline joins ICH or has interline agreements settled via ICH; it is INDUSTRY-EXPECTED for any carrier with interline/codeshare. BSP participation is MANDATORY to sell via IATA-accredited agents.
- **Timatic / document checks** = INDUSTRY-EXPECTED globally and, since the August 2026 GACA circular (see Q2), effectively MANDATORY in KSA for a DCS to perform or integrate document verification before boarding.
- **One ID**, **IATA Pay**, **continuous pricing** = EMERGING; none is required for compliance.
- **IATA DGR 67th edition** = MANDATORY for carriage of dangerous goods; the software implication is modest (passenger DG declarations at check-in, acceptance checklist, operator variations) and annual edition updates.

### Gaps

- Could not retrieve the actual text of the November 2024 IATA Modern Airline Retailing roadmap (iata.org blocked); the 2026/2028/2030 milestones above come from one IATA slide and a vendor blog.
- Current IATA position on "NDC Level 1-4" vs ARM index is ambiguous: IATA pages describe the ARM index as the replacement, yet 2024-2025 airline press releases still cite "Level 4". Treat as terminology drift; confirm against IATA's ARM registry.
- No official IATA source found for the BCBP v8 effective date (1 June 2020 is from a third-party page). Could not confirm whether a v9 has been issued.
- No source stating a recent (2024-2026) change to Res. 722f/725f content; the 46th edition (2026) of the PSC Manual exists but its change list was not retrievable.
- SSIM (Standard Schedules Information Manual) and PNRGOV versions were only partially covered (see Q2 for PNRGOV); SSIM current edition not verified.
- No source gives the number of airlines live with ONE Order or native Orders as of 2026, beyond "first implementations live" (IATA, Aug 2025).
- Formal status of RP 1745 (withdrawn or not) not confirmed.

---

## Key Question 2 — Government passenger data (APIS / PNRGOV / PAXLST, Saudi API/PNR, US Secure Flight/APIS, EU PNR Directive, EES/ETIAS)

### Takeaway

Saudi Arabia runs an API/PNR regime via the National Passenger Security Center with GACA fining carriers for PNR non-compliance (Q1 2025), and in August 2026 GACA ordered carriers to verify entry/exit/transit documents before boarding; the EU's Entry/Exit System (live 12 Oct 2025, fully deployed 10 Apr 2026) made carrier-interface queries mandatory from 10 April 2026, with ETIAS checks expected from Q4 2026, and the US requires Secure Flight data (72h) plus APIS manifests. The message standards are UN/EDIFACT PAXLST (API) and PNRGOV (EDIFACT guide v21.1, XML v16.1), governed jointly by WCO/IATA/ICAO.

### Cited Findings

**Message standards**

- PNRGOV EDIFACT implementation guides exist in versions 11.1, 13.1, 18.1 and 21.1 (IATA-hosted); the PNRGOV XML implementation guide is v16.1 (subject to WCO API Contact Committee approval); the 13.1 cover credits the WCO/IATA/ICAO API Contact Committee — [PNRGOV EDIFACT guide 21.1](https://Www.Iata.org/contentassets/18a5fdb2dc144d619a8c10dc1472ae80/pnrgov-edifact-implementation-guide_21_1.pdf); [PNRGOV XML guide 16.1](https://www.iata.org/contentassets/18a5fdb2dc144d619a8c10dc1472ae80/pnrgov20xml20implementation20guide2016_1.pdf); [ICAO PNRGOV principles 13.1](https://www.icao.int:443/Security/FAL/Documents/2-PNRGOV-Principles_13-1version_FIRST.pdf)
- ICAO Annex 9: Amendment 28 (adopted by EU Council June 2020, applicable Feb 2021) replaced Standards 9.22–9.22.1 and RP 9.23 with new PNR SARPs 9.23–9.38; Standard 9.24 is the baseline for States to collect/use/protect PNR and requires the national framework to be consistent with all PNR standards; the obligation to establish an API system is cited as Standard 9.7 (2022 ICAO deck) or 9.8 (older deck), and the "Passenger Data Single Window" concept is in Standard 9.1 — [EU Council doc ST-5105-2021](https://data.consilium.europa.eu/doc/document/ST-5105-2021-INIT/en/pdf); [ICAO TRIP 2022 presentation](https://www2023.icao.int/Meetings/TRIP-Symposium-2022/Documents/Presentations/Day3/5.WATERMAN%20V1.0.pdf); [ICAO API legal framework (Hornek)](https://www2023.icao.int/Meetings/TRIP-Symposium-2019/PublishingImages/Pages/Presentations/HORNEKHORNEK%20Advance%20Passenger%20Information%20Legal%20Framework.pdf)

**Saudi Arabia**

- Saudi Arabia established the National Passenger Security Center as the national body for PNR data and ran "400 regular workshops with airlines operating in Saudi Arabia" on API/PNR operational and technical requirements — [ICAO A42 WP/128 (Saudi Arabia)](https://www.icao.int/sites/default/files/Meetings/a42/Documents/WP/wp_128_en.pdf)
- GACA Q1 2025 enforcement report: 147 violations including two cases against air carriers for non-compliance with the PNR system (with a competition case, SAR 15,000 total) — [GACA Q1 2025 fines](https://gaca.gov.sa/en/News/gaca-2025-q1-fines-3-8-million); [TTN](https://ttnworldwide.com/Article/384405/Saudi-GACA-reports-147-civil-aviation-violations-in-Q1)
- GACA enforcement reporting records 237 violations against air carriers for failing to ensure passengers had required documents / violating GACA instructions, fines over SAR 4.5 million (period unclear) — [GACA Q3 fines report](https://gaca.gov.sa/en/News/gaca-aviation-fines-q3-report)
- August 2026 GACA circular: all commercial and private carriers at Saudi airports must verify passengers' entry, exit and transit requirements for departure, destination and transit countries using official government sources, with precautions at the boarding point; no new document type created — [Gulf News, Aug 2026](https://gulfnews.com/world/gulf/saudi/saudi-arabia-orders-airlines-to-verify-passenger-travel-documents-before-boarding-1.500643092); [Zawya](https://www.zawya.com/en/business/saudis-gaca-orders-airlines-to-verify-required-transit-documents-before-boarding-458054); GACA Air Transport Facilitation circulars (Arabic PDFs) — [GACA circular 311](https://www.gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Circulars/Air-Transport-Facilitation-Circulars/311.pdf); [GACA circulars page](https://gaca.gov.sa/web/en-gb/page/circulars)

**United States**

- TSA Secure Flight final rule (28 Oct 2008, 73 FR 64018): SFPD (full name, DOB, gender, redress number) collected no later than 72 hours before departure or at booking if later; data submitted via a single DHS portal for Secure Flight and APIS; CBP APIS rule (Aug 2007) covers international manifests — [Federal Register Secure Flight](https://www.federalregister.gov/documents/2008/10/28/E8-25432/secure-flight-program); [govinfo text](https://www.govinfo.gov/content/pkg/FR-2008-10-28/html/E8-25432.htm)
- Airline implementation practice: data to TSA at 72h, bookings made 72–25h out sent at 25h, later bookings immediately (FlyerTalk Q&A, secondary) — [FlyerTalk](https://www.flyertalk.com/forum/11538129-post5.html)

**European Union — PNR Directive (EU) 2016/681**

- Article 12: PIUs retain PNR five years then delete; depersonalise after six months (mask name, address, contact, all payment information incl. billing address, frequent-flyer data); access to full data after six months requires judicial/other national authority approval — [legislation.gov.uk copy of Art. 12](https://www.legislation.gov.uk/eudr/2016/681/article/12/data.htm)
- CJEU Ligue des droits humains (C-817/19, 2022): generalised retention complies with "strict necessity" only during the initial six months; five-year retention only for targeted passengers; EDPB 2025 statement: retention of all PNR should not exceed an initial six months — [eucrim](https://eucrim.eu/news/cjeu-pnr-directive-valid-if-limited-to-the-strictly-necessary/); [EDPB statement 2025](https://www.edpb.europa.eu/news/news/2025/edpb-adopts-statement-implementation-pnr-directive_en)

**EU Entry/Exit System (EES) and ETIAS**

- EES began progressive operation 12 October 2025; all Schengen states deployed by 10 April 2026 (one carrier guide says 9 April); carriers must keep verifying passport stamps from 12 Oct 2025 until 6 Oct 2026 inclusive — [eu-LISA: EES fully deployed](https://www.eulisa.europa.eu/news-and-events/news/entryexit-system-fully-deployed-across-eu); [Greek Police carrier info pack](https://www.astynomia.gr/file/2025/09/Carrier-info-pack_en.pdf)
- Carrier Interface (CI) available voluntarily from 9 January 2026; obligation to query the CI from 10 April 2026 for air, sea and international coach carriers carrying third-country nationals with single/double-entry visas — [eu-LISA: carrier interface 9 Jan 2026](https://www.eulisa.europa.eu/news-and-events/news/carrier-interface-available-9-january-2026); [eu-LISA carriers](https://eulisa.europa.eu/activities/carriers)
- ETIAS: carriers must verify visa-exempt third-country nationals hold a valid ETIAS authorisation; launch given as "final quarter of 2026" (eu-LISA March 2026 summary) / "October 2026" (other source) — [eu-LISA advisory group summary 2026-03-12](https://www.eulisa.europa.eu/sites/default/files/documents/20260312-summary.pdf); [ERA EES updates](https://www.eraa.org/?p=5098)
- Emirates and Air Arabia issued Europe travel advisories about EES — [Gulf News](https://gulfnews.com/business/aviation/emirates-air-arabia-issue-travel-advisory-for-europe-1.500293094)

### Inferences

- For a Saudi-based carrier: **API (PAXLST) and PNR (PNRGOV) push to the National Passenger Security Center** = MANDATORY (enforced by GACA fines). The platform needs: PNRGOV EDIFACT (v21.1 recommended; confirm NPSC's accepted version) scheduled pushes (typical regime is multiple pushes e.g. 24h/pre-departure/post-departure — timing for KSA not confirmed), UN/EDIFACT PAXLST API with MRZ data captured at check-in (iAPIS "board/no-board" interactive flow if NPSC supports it — unconfirmed), and audit logs of transmissions and acknowledgements as evidence.
- **Travel-document verification at check-in/boarding** (Timatic-type rules engine or government source lookup) = MANDATORY in KSA since Aug 2026 circular; evidence = DCS check-in rule hits, document-check logs, agent override records.
- For flights to the US: **Secure Flight SFPD capture at booking (name/DOB/gender/redress), 72h transmission, APIS/iAPIS** = MANDATORY. For flights to the EU: **PNR push to national PIUs** = MANDATORY; **EES Carrier Interface OK/NOK query before boarding** = MANDATORY since 10 Apr 2026 for visa holders; **ETIAS query** = MANDATORY once ETIAS launches (expected Q4 2026 then a transition period) — EMERGING until then.
- Data-minimisation design implication: the PNR Directive and CJEU ruling mean the platform's PNR export should include only the 19 Annex I data elements and should not include free-text sensitive data; the airline's own retention of API/PNR copies should be justified separately.

### Gaps

- No public text of the Saudi Ministry of Interior / NPSC API-PNR technical specification (data fields, push timings, message versions, connectivity) was found; the Scribd "GACA circular" was unreadable. This is the single most important item to obtain directly from GACA/NPSC.
- Exact numbering of Annex 9 API Standard (9.7 vs 9.8) conflicts between ICAO decks; check the current Annex 9 edition.
- The EU PNR Directive's transfer timing (commonly 24–48h before departure plus at flight closure, Art. 8) was not confirmed by a source in this research.
- Secure Flight/APIS current (2025-2026) amendments were not found; the 2008 rule remains the reference.
- UK (Border Force API/PNR), GCC states other than KSA (UAE API, Qatar, Bahrain, Oman, Kuwait) were not researched.

---

## Key Question 3 — Passenger rights (EU261 reform, UK261, US DOT refunds and fee rules, Saudi GACA Customer Protection Regulation, GCC)

### Takeaway

GACA's Customer Protection Regulation in force since 20 November 2023 sets compensation partly as a percentage of ticket value (up to 150–200%), fixed SAR amounts (e.g., SAR 750 for >6h delay care; baggage up to ~SAR 6,568) and a 3-hour tarmac-delay disembarkation right; EU261 was amended in 2026 (political deal 15 June 2026, EP vote 7 July 2026, Council 13 July 2026) keeping the 3-hour threshold and €250–600 bands, applying from second half of 2027; UK261 pays £220/£350/£520 (£260 for 3–4h on >3,500 km); the US DOT automatic-refund rule (14 CFR 260) has been binding since 28 Oct 2024 and codified by the FAA Reauthorization Act 2024, while the DOT ancillary-fee transparency rule was vacated by the Fifth Circuit on 3 Feb 2026.

### Cited Findings

**Saudi Arabia — GACA Customer Protection Regulation (2023)**

- The new passenger protection guidelines took effect 20 November 2023 — [Gulf Business](https://gulfbusiness.com/en/2023/saudi-arabia/saudi-new-airline-compensation-rules-in-effect); [GACA announcement Aug 2023](https://gaca.gov.sa/web/en-gb/news/consumer-protection-regulations)
- Press coverage: compensation up to 150–200% of ticket value for delays/cancellations/denied boarding; Argaam's table lists up to 150% refund of ticket value for cancellation and 200% where the passenger is not allowed to board — [Gulf News Aug 2023](https://gulfnews.com/business/aviation/saudi-arabia-announces-new-airline-compensation-rules-up-to-200-of-airfare-for-delays-cancellations-1.1692855490178); [Argaam](https://www.argaam.com/en/article/articledetail/id/1665972)
- Delay >6 hours: meals, drinks, accommodation, transport, plus fixed compensation of SAR 750 (Argaam table) — [Argaam](https://www.argaam.com/en/article/articledetail/id/1665972)
- Baggage: up to SAR 6,568 for lost/damaged/delayed baggage (approx. 1,288 SDR Montreal Convention limit); delayed-baggage daily amounts conflict: SAR 740 first day + SAR 300/day up to 5 days (Gulf News) vs SAR 100 domestic / SAR 200 international per day for max 5 days (Argaam-hosted page) — [Travelobiz](https://travelobiz.com/?p=33043); [Gulf News](https://gulfnews.com/amp/story/world%2Fgulf%2Fsaudi%2Fnew-airline-compensation-rules-come-into-force-in-saudi-arabia-1.99504908); [Argaam](https://betapp.argaamcharts.com/en/article/articledetail/id/1665972)
- Tarmac delay >3 hours: passengers empowered to disembark and receive compensation — [Gulf Business](https://gulfbusiness.com/en/2023/saudi-arabia/saudi-new-airline-compensation-rules-in-effect)
- Disabled passengers to be compensated if airlines lack proper facilities — [Gulf News May 2023](https://gulfnews.com/world/gulf/saudi/saudi-arabia-disabled-passengers-to-be-compensated-if-airlines-do-not-have-proper-facilities-for-them-1.1683976312518)
- Older GACA "Know your rights" guide: carrier exempt from denied-boarding compensation if an alternative flight is provided within 2 hours of scheduled departure; 2017 regulation required written information of rights to denied-boarding passengers — [GACA Know your rights](https://gaca.gov.sa/-/media/Files/PDF/Content--Pages/Know-your-rights-En.pdf); Qatar Airways hosts the GACA regulation translation noting the Arabic text governs — [Qatar Airways GACA passenger rights PDF](https://qatarairways.com/content/dam/documents/legal/gaca-passenger-rights-protection.pdf)
- Full regulation text (English) is hosted on Qanoniah (not fetchable here) — [Qanoniah: Implementing Regulation for the Protection of Customer Rights](https://qanoniah.com/en/File/QNzgY5ZPxKo1gv27dyG3q6wpX-Implementing-Regulation-for-the-Protection-of-Customer-Rights)
- GACA enforcement: SAR 3.8M fines in Q1 2025 (147 violations), SAR 2.8M in Q2 2025 (87 violations) — [GACA Q1 2025](https://gaca.gov.sa/en/News/gaca-2025-q1-fines-3-8-million); [Argaam Q2 2025](https://www.argaam.com/en/article/articledetail/id/1826489)

**EU — Regulation 261/2004 and its 2026 amendment**

- Council adopted its first-reading position 29 Sept 2025; trilogues 15 Oct and 19 Nov 2025; the dispute was Parliament's single 3-hour threshold vs Council's 4h/6h by distance — [Council doc ST-15489-2025](https://data.consilium.europa.eu/doc/document/ST-15489-2025-INIT/en/pdf); [Travel Extra](https://www.travelextra.ie/member-states-have-diluted-the-original-proposal-and-introduced-more-complexity-eu261-confusion/)
- Parliament second-reading position 21 Jan 2026 upheld 3-hour threshold — [EP TA-10-2026-0009](https://data.europarl.europa.eu/distribution/doc/TA-10-2026-0009_en.pdf); [Aviación al Día](https://aviacionaldia.com/en/2026/01/european-parliament-upholds-three-hour-threshold-for-flight-delay-compensation.html)
- Political agreement 15 June 2026 (Conciliation); EP approved joint text 7 July 2026 (646–12–3); Council adopted 13 July 2026 regulation amending 261/2004 and 2027/97 — [CMS Law](https://cms.law/en/int/legal-updates/new-european-regulation-on-air-passenger-rights-what-impact-for-the-air-transport-sector); [EP TA-10-2026-0238](https://data.europarl.europa.eu/distribution/doc/TA-10-2026-0238_en.pdf); [LexisNexis 13 Jul 2026](https://www.lexisnexis.co.uk/legal/news/council-adopts-regulation-strengthening-eu-air-passenger-rights); [CAPA](https://centreforaviation.com/news/eu-parliament-approves-upgraded-air-passenger-rights-1365276)
- Content: maintains €250–600 compensation for delays over three hours; strengthens assistance, information, communication and rerouting duties; one source says application from second half of 2027 — [WAM](https://www.wam.ae/en/article/c13o6tz-european-parliament-approves-comprehensive-update); [Anadolu](https://www.aa.com.tr/en/europe/european-parliament-updates-air-travel-rights-for-first-time-since-2004/3967963); [SkyRefund (claims company)](https://skyrefund.com/en/blog/eu261-reform-2026). CONFLICT: AeroMorning described a deal with 4h/6h thresholds — [AeroMorning](https://aeromorning.com/en/eu261-reform-a-compromise-with-no-winners-in-europe/); the Parliament/Council sources above contradict this.
- An EUR-LEX OJ C item 2026/3701 appeared in results (content not retrieved) — [EUR-Lex C/2026/3701](https://eur-lex.europa.eu/eli/C/2026/3701/oj/eng/pdf)

**UK — UK261 (retained Reg. 261/2004 as amended by APR 2019)**

- Compensation £220 (≤1,500 km), £350 (1,500–3,500 km), £520 (>3,500 km), with £260 for >3,500 km arriving 3–4h late; converted from €250/400/600; CAA is the enforcement body — [legislation.gov.uk Art. 7](https://www.legislation.gov.uk/eur/2004/261/article/7/data.htm); [HFW UK261 briefing](https://HFW.COM/downloads/002691-HFW-UK261-Passenger-rights-after-the-Brexit-transition-period-Jan-2021.pdf); [AirHelp UK261](https://www.airhelp.co.uk/uk-261/)

**United States — DOT rules**

- "Refunds and Other Consumer Protections" final rule published 26 April 2024 (89 FR 32760, 2024-07177); compliance date for refund provisions 28 Oct 2024, confirmed by the 12 Aug 2024 amendment — [Federal Register 2024-07177](https://regulations.justia.com/regulations/fedreg/2024/04/26/2024-07177.html); [FR 12 Aug 2024 amendment](https://www.govinfo.gov/content/pkg/FR-2024-08-12/html/2024-17602.htm)
- 14 CFR 260.2: "prompt refund" = within 7 business days for credit card purchases, 20 calendar days for other payment methods; significant change includes >3h domestic / >6h international departure or arrival time change, different airport, added connection, downgrade; baggage fee refund when checked bag not delivered within 12 hours (domestic) of gate arrival and a Mishandled Baggage Report filed; ancillary fees refunded when service not provided — [14 CFR Part 260 (customsmobile copy)](https://www.customsmobile.com/regulations/title14_chapterII_part260); [Eckert Seamans](https://www.eckertseamans.com/legal-updates/dot-finalizes-two-key-new-consumer-protection-rulemakings); [Business Traveller](https://www.businesstraveller.com/news/dot-new-automatic-refunds-policy/)
- FAA Reauthorization Act signed 16 May 2024 codified the automatic refund rule — [Checkbook](https://www.checkbook.org/national/consumers-notebook/articles/Here-Is-What-Airlines-Must-Do-If-Your-Flight-Is-Canceled-or-Delayed-7739); March 2026 analysis: rule in effect, partially codified, partially under reconsideration; A4A asked DOT to rescind — [DWU Consulting](https://dwuconsulting.com/dwu-ai/dot-consumer-protection-rulemaking)
- "Enhancing Transparency of Airline Ancillary Service Fees" (89 FR 34620, 30 Apr 2024) stayed by the Fifth Circuit 29 July 2024 and reported vacated en banc 3 Feb 2026 (Airlines for America v. DOT, No. 24-60231) — single consultancy source — [Reed Smith](https://www.reedsmith.com/our-insights/blogs/viewpoints/102jfoz/fifth-circuit-stays-dot-rule-on-disclosure-of-ancillary-service-fees-when-booking/); [DWU Consulting](https://dwuconsulting.com/dwu-ai/dot-consumer-protection-rulemaking)
- US ACAA website rule (see Q4) also mandates WCAG 2.0 AA.

**PRM — Regulation (EC) 1107/2006**

- A PRM is "pre-notified" if needs are notified to carrier/agent/tour operator at least 48 hours before published departure (Art. 7); the carrier must transmit the information to the airport at least 36 hours before departure (Art. 6); assistance must still be attempted for non-pre-notified passengers; carriers may not refuse reservation or embarkation on grounds of disability — [legislation.gov.uk Art. 7](https://www.legislation.gov.uk/eur/2006/1107/article/7); [Aena Art. 6 summary](https://aena.es/en/airlines/operating-at-aena/commercial-and-operational-aspects/assistance-service-for-prm.html); [UK Parliament evidence](https://publications.parliament.uk/pa/cm201213/cmselect/cmtran/writev/disabledaccess/dat26.htm)
- UK CAA reports low pre-notification levels "often caused by systems and processes which make it difficult for PRM to pre-notify" — [UK Parliament evidence](https://publications.parliament.uk/pa/cm201213/cmselect/cmtran/writev/disabledaccess/dat26.htm)

### Inferences

- **GACA Customer Protection Regulation (eff. 20 Nov 2023)** = MANDATORY in KSA. Software must: compute compensation as % of ticket value (needs per-passenger fare base incl. taxes handling), fixed SAR care amounts by delay band (>6h), baggage compensation caps and per-day delay payments, denied-boarding 2-hour alternative-flight exemption, tarmac >3h disembarkation; generate written rights notices in Arabic (governing language) and English; keep a disruption/claims ledger as evidence for GACA inspections. Exact article text must be pulled from the official Arabic regulation since press figures conflict.
- **EU261 (current text)** = MANDATORY for flights departing EU or EU-carrier flights into EU; the **2026 amendment** = EMERGING/MANDATORY from ~H2 2027: the platform should parametrise delay thresholds, distance bands, rerouting deadlines and information/communication obligations rather than hard-code them.
- **UK261** = MANDATORY for UK departures / UK carriers to UK: distinct GBP bands and the £260 half-rate must be a separate rule set from EU261.
- **US DOT 14 CFR 260** = MANDATORY for US flights: the platform must detect "significant change" automatically (3h/6h, airport change, added connection, downgrade), auto-issue refunds to original form of payment within 7 business days (card) / 20 calendar days (other) without requiring a request, track bag-delivery time vs 12h/15h/30h thresholds, and refund unperformed ancillaries. Ancillary-fee display rule = NOT enforceable (vacated), but fee transparency remains INDUSTRY-EXPECTED.
- **EC 1107/2006 PRM** = MANDATORY in EU/UK; software needs SSR capture (WCHR/WCHS/WCHC/DEAF/BLND/DPNA/MAAS) at booking, 48h pre-notification timestamp, 36h transmission to airports (via PAL/CAL Type B or API), and must not block bookings on disability.

### Gaps

- Official GACA 2023 regulation text (article numbers, exact SAR amounts, definitions of "ticket value", notification deadlines, refund deadlines, record-keeping duties) could not be fetched; secondary sources conflict on delayed-baggage daily amounts and on whether 200% applies only to denied boarding.
- Official Journal publication reference and entry-into-force/application date for the 2026 EU261 amendment not confirmed (one source says H2 2027; an Austrian document mentions 16 Sept 2026).
- GCC-wide rules (UAE GCAA consumer protection, Qatar, Bahrain, Oman, Kuwait) were not covered.
- Fifth Circuit vacatur date/case number for the ancillary-fee rule rests on one consultancy source; verify on the court docket.
- No primary source retrieved for the DOT 3h/6h "significant change" thresholds beyond secondary coverage and a CFR mirror.

---

## Key Question 4 — Data protection, security, accessibility (Saudi PDPL, GDPR, PCI DSS 4.0.1, SOC 2, NIS2, NCA ECC-2:2024, CST cloud classes, WCAG 2.2 / EAA / ACAA)

### Takeaway

A Saudi airline platform must comply with PDPL (enforceable since 14 Sept 2024; 72-hour breach notification to SDAIA; cross-border Transfer Regulation amended 1 Sept 2024 with SDAIA risk-assessment guidelines Feb 2025), PCI DSS v4.0.1 (sole valid version since 31 Dec 2024, with 51 future-dated requirements including 6.4.3 script inventory and 11.6.1 payment-page change detection binding since 31 Mar 2025), and — if classed as critical infrastructure or hosting with Saudi cloud providers — NCA ECC-2:2024 (Oct 2024, 4 domains/108 controls) and CST Class C hosting; for EU-facing operations GDPR, NIS2 (air carriers are "essential entities", transposition due 17 Oct 2024) and the European Accessibility Act (applicable 28 June 2025 via EN 301 549; V4.1.1 aligns to WCAG 2.2 AA) apply, and in the US the ACAA rule mandates WCAG 2.0 AA for websites and kiosks.

### Cited Findings

**Saudi PDPL and Transfer Regulation**

- PDPL entered into force September 2023 with a one-year grace period; transition window closed 14 September 2024; January 2025 SDAIA committees reported 48 violation decisions — [Latham & Watkins](https://www.lw.com/en/insights/2023/12/Saudi-Arabias-data-protection-law-enters-into-force); [Clyde & Co](https://www.clydeco.com/en/insights/2024/09/saudi-arabia-s-personal-data-protection-law-become); [Al Tamimi](https://www.tamimi.com/news/observations-and-tips-on-data-issues-in-ksa/)
- Breach notification: controllers must notify SDAIA within 72 hours of becoming aware (Art. 24 of Implementing Regulations); late notice requires written justification; portal access limited to Iqama/National ID holders — [Baker McKenzie](https://insightplus.bakermckenzie.com/bm/data-technology/saudi-arabia-publishes-guidance-on-data-breach-notification); [Securiti](https://securiti.ai/saudi-arabia-personal-data-protection-law)
- Revised Regulation on Personal Data Transfer Outside the Kingdom (Art. 29 PDPL) in force on Official Gazette publication 1 September 2024; streamlined to align closer to GDPR mechanisms (adequacy, safeguards such as SCCs/BCRs, exemptions); approved-jurisdiction list not disclosed; SDAIA Risk Assessment Guidelines for transfers released February 2025 — [Securiti transfer regulation summary](https://securiti.ai/regulation-on-personal-data-transfer-outside-the-kingdom); [K&L Gates / King & Spalding article](https://www.kslaw.com/insights/articles/international-personal-data-transfers-under-saudi-arabias-data-protection-law); [Chambers risk-assessment guideline](https://chambers.com/articles/risk-assessment-guideline-for-transferring-personal-data-outside-ksa-key-updates); [DLA Piper](https://www.dlapiper.com/en/insights/publications/2024/02/saudi-arabias-new-personal-data-protection-law-in-force)
- SDAIA will issue DPO rules; DPO appointment required "under certain circumstances" — [Latham & Watkins](https://www.lw.com/en/insights/2023/12/Saudi-Arabias-data-protection-law-enters-into-force); [Multilaw KSA guide](https://www.multilaw.com/Multilaw/Data_Protection_Laws_Guide/DataProtection_Guide_SaudiArabia.aspx)

**Saudi NCA ECC-2:2024 and CST cloud classes**

- October 2024: NCA replaced ECC-1:2018 (5 domains, 29 subdomains, 114 controls) with ECC-2:2024 (4 domains, 28 subdomains, 108 controls); ICS/OT controls moved to OTCC; data-localisation controls transferred to NDMO/SDAIA; MFA requirements made more specific; applies to government entities and critical national infrastructure (incl. Saudi government entities abroad) — [Clyde & Co ECC-2](https://www.clydeco.com/en/insights/2025/01/saudi-arabia-essential-cybersecurity-controls); [Qualys blog](https://blog.qualys.com/product-tech/2025/05/05/bridging-the-gap-how-qualys-simplifies-nca-ecc-2024-compliance-for-businesses); [Axidian (vendor)](https://axidian.com/blog/nca-ecc-2024-compliance-saudi-arabia/)
- CST Cloud Computing Services Provisioning Regulations (replacing the 2018/2020 CCRF) use provider classes; Class C may handle public, confidential, secret and top-secret data across sectors; Class C requires Tier 3+ data centres and adherence to NCA Cloud Cybersecurity Controls (CCC, 2:2024 update focused on localisation); OCI and Huawei Cloud hold Class C — [Oracle OCI Class C](https://blogs.oracle.com/cloud-infrastructure/post/oci-achieves-cst-class-c-in-saudi-arabia); [Huawei Cloud KSA Class C FAQ](https://www.huaweicloud.com/intl/en-us/securecenter/compliance/compliance-center/ksa-classc.html); [Al Tamimi](https://turtl.tamimi.com/story/659faaaf5c8b5508162918de); [SecurityWall CCC](https://securitywall.co/blog/ccc-cloud-cybersecurity-controls-saudi-arabia)

**PCI DSS v4.0.1**

- v4.0.1 published 11 June 2024 as a limited revision (no new/deleted requirements); v4.0 retired 31 December 2024; v4.0.1 is the only valid version; future-dated requirements effective after 31 March 2025 — [PCI SSC blog: v4.0.1](https://blog.pcisecuritystandards.org/just-published-pci-dss-v4-0-1); [Mastercard PCI newsletter Nov 2024](https://www.mastercard.com/content/dam/public/mastercardcom/globalrisk/pdf/Semiannual_PCI_Newsletter_%28November-2024%29.pdf); [CSA](https://cloudsecurityalliance.org/articles/preparing-for-the-end-pci-4-0-retirement-in-december-2024)
- PCI SSC: 64 new requirements in v4, 51 future-dated (best practice until 31 Mar 2025, required thereafter); 6.4.3 (payment-page script inventory/authorisation/integrity) and 11.6.1 (change/tamper detection on payment pages) added to reduce e-skimming; SAQ A removed 6.4.3/11.6.1/12.3.1 but added an eligibility criterion about scripts; PCI SSC published "Payment Page Security and Preventing E-Skimming" supplement — [PCI SSC podcast on e-commerce requirements](https://blog.pcisecuritystandards.org/coffee-with-the-council-podcast-guidance-for-pci-dss-e-commerce-requirements-effective-after-31-march-2025); [Sikich on 6.4.3/11.6.1](https://www.sikich.com/insight/preparing-for-pci-dss-v4-0-1-requirements-6-4-3-and-11-6-1/); [usd AG future-dated](https://www.usd.de/en/?p=50772)
- No SAMA/Saudi Payments rule mandating PCI DSS for merchants was found; a Saudi consultancy says businesses must adhere to mada guidelines in addition to PCI DSS — [GRC360 (vendor)](https://grc360.odoo.com/pci-dss)

**GDPR enforcement relevant to airlines**

- Italy fined Emirates €180,000 (June 2026) over PRM health data retained seven years; Spain fined Aena €10M (Nov 2025) over biometric boarding DPIA; Spain fined Amadeus €14.4M for profiling PNR data without lawful basis; UK ICO BA breach (intended £183M, 2019) — [Captain Compliance on Emirates](https://captaincompliance.com/education/italy-fines-emirates-e180000-for-mishandling-passenger-health-data/); [Biometric Update on Aena](https://www.biometricupdate.com/202511/spanish-airport-operator-aena-fined-11m-over-biometric-boarding-program); [The Paypers on Amadeus](https://thepaypers.com/fraud-and-fincrime/news/spain-fines-amadeus-eur-144-million-over-traveller-profiling-pilot); [Digital Guardian on BA](https://www.digitalguardian.com/blog/airline-facing-record-breaking-229-million-gdpr-fine)

**NIS2**

- Air carriers are in Annex I point (2)(a) "sectors of high criticality" (essential entities); transposition deadline 17 Oct 2024; status varies by member state; IATA Nov 2025 paper criticises overlap with aviation-specific rules and advises jurisdiction-by-jurisdiction legal review; Luxembourg ILR had to list entities by 17 April 2025; fines up to €10M or 2% turnover (secondary) — [IATA NIS2 discussion paper Nov 2025](https://www.iata.org/contentassets/4c51b00fb25e4b60b38376a4935e278b/nis2-directive-discussionpaper-november-2025.pdf); [ENISA](https://www.enisa.europa.eu/node/19030); [ILR Luxembourg](https://www.ilr.lu/en/?p=32584); [Egis on NIS2 aviation](https://www.egis-group.com/all-insights/what-does-nis2-mean-for-the-aviation-industry)

**Accessibility**

- European Accessibility Act applies from 28 June 2025 to passenger air (and bus/rail/water) transport websites, apps, e-ticketing and kiosks (excluding urban/suburban/regional services); contracts signed before that date may run unchanged up to five years; harmonised standard EN 301 549 (V3.2.1 = WCAG 2.1 AA); ETSI/CEN/CENELEC published V4.1.1 aligning to WCAG 2.2 A/AA (reported Sept 2026) but OJ citation expected ~Oct 2026, not confirmed — [SGS on EAA](https://www.sgs.com/en/news/2025/09/safeguards-13925-european-accessibility-act-eaa-takes-effect-unifying-standards-across-the-eu); [Martijn Hols EAA analysis](https://hn.jakechampion.name/reader/https://martijnhols.nl/blog/the-european-accessibility-act-for-websites-and-apps); [DWT Sept 2026](https://www.dwt.com/insights/2026/09/european-accessibility-act-ict-standards-update); [Deque on EN 301 549 V4.1.1](https://www.deque.com/blog/en-301-549-v4-1-1-is-final-what-changed-what-it-means-and-what-you-should-do/); airline statements target WCAG 2.1 AA — [ITA Airways](https://www.ita-airways.com/it/en/legal/accessibility-statement); [Discover Airlines](https://www.discover-airlines.com/de/en/legal/accessibility-statement)
- US DOT ACAA rule (12 Nov 2013; 14 CFR 382.43): carrier primary websites must conform to WCAG 2.0 Level AA (core pages — reservations, check-in, flight status, FF accounts, contact — within two years of 12 Dec 2014; all pages within three years); kiosks installed after 12 Dec 2016 at airports ≥10,000 enplanements must meet accessibility design standards until ≥25% of kiosks comply; airlines must test accessibility and offer equivalent service — [DOT final rule PDF](https://www.transportation.gov/sites/dot.gov/files/docs/Kiosk-website-FR-final%20rule.pdf); [DOT kiosk fact sheet](https://www.transportation.gov/sites/dot.gov/files/docs/11-04-13%20Accessible%20Kiosks%20Fact%20Sheet.docx); [Proskauer](https://www.proskauer.com/alert/air-carrier-access-act-department-of-transportation-finalizes-new-rules)

### Inferences

- **PDPL** = MANDATORY for any controller processing Saudi residents' data: implement lawful-basis tracking and consent records, privacy notices (Arabic), 72-hour breach workflow, data-subject rights handling, retention schedules (note Italian regulator treated 7-year retention of PRM health data as excessive — a useful benchmark for SSR/medical data), a transfer register with risk assessments for any non-KSA hosting (e.g., Stripe, foreign cloud regions), and a DPO where criteria met. Evidence: RoPA, DPIAs, transfer risk assessments, SDAIA registration/notifications.
- **NCA ECC-2:2024** = MANDATORY only if the airline is designated a CNI/government-linked entity (national carriers typically are); otherwise INDUSTRY-EXPECTED, and CST Class C hosting is MANDATORY for hosting data classified secret/top secret (API/PNR security data may be classified by NPSC). Evidence: ECC gap assessment, MFA on all admin/remote access, logging, Saudi-region hosting.
- **PCI DSS v4.0.1** = MANDATORY via acquirer/card-brand contracts (not statute) for any card acceptance; with Stripe Checkout (redirect) the airline is typically SAQ A, but since 31 Mar 2025 SAQ A eligibility requires confirming no scripts on the merchant's pages can affect the payment page, and any self-hosted payment form (Stripe Elements in-page) brings 6.4.3 and 11.6.1 into scope (script inventory + authorisation + integrity, and tamper detection of payment-page HTTP headers/content). Evidence: AOC/SAQ, ASV scans quarterly, script inventory, CSP/SRI or tamper-detection reports, MFA into CDE (8.4.2), authenticated internal vulnerability scans (11.3.1.2).
- **GDPR** = MANDATORY for EU passengers/EU establishment; **NIS2** = MANDATORY for EU air carriers per national transposition (an EU-licensed carrier) and EMERGING for non-EU carriers with EU operations pending national designation; evidence: risk management measures, 24h/72h incident reporting to CSIRT, supply-chain controls.
- **SOC 2 / ISO 27001** = INDUSTRY-EXPECTED for a self-built platform offered to partners (no legal mandate found; not researched in depth).
- **Accessibility**: WCAG 2.0 AA = MANDATORY (US ACAA) for US-serving carriers; EN 301 549 / WCAG 2.1 AA = MANDATORY in EU since 28 June 2025 (moving to WCAG 2.2 AA once V4.1.1 is cited in the OJ — EMERGING); Saudi has no equivalent statutory web-accessibility rule found, but WCAG 2.2 AA is the sensible single target. Evidence: accessibility statement, audit report, RTL/Arabic support does not substitute for WCAG conformance.

### Gaps

- Official SDAIA texts (PDPL Implementing Regulations, Transfer Regulation 2024, DPO rules, national register of controllers) were not readable here; details rest on law-firm summaries. Whether SDAIA maintains a mandatory controller register was not confirmed.
- NCA ECC-2 scope for private airlines (vs. government/CNI) not confirmed from the NCA text; control counts (108 vs 110) differ across vendor sources.
- No SAMA/Saudi Payments primary document on PCI DSS or mada e-commerce security requirements found.
- ZATCA e-invoicing (Phase 2 integration waves continuing through wave 25, compliance 1 Feb 2027 for SAR 187,500+ turnover) is MANDATORY for Saudi VAT-registered sellers, but no airline/ticket-specific guidance (simplified tax invoice on e-tickets, QR code) was found — [EY wave 25](https://taxnews.ey.com/news/2026-1705-saudi-arabia-announces-25th-wave-of-phase-2-e-invoicing-integration); [ZATCA news](https://zatca.gov.sa/en/MediaCenter/News/Pages/news-1327.aspx).
- EN 301 549 V4.1.1 Official Journal citation status unresolved as of this research.
- SOC 2 expectations for airline IT vendors were not researched with sources.

---

## Key Question 5 — Operations standards (weight & balance / load sheet, DCS messaging, crew FTL, dangerous goods, PRM)

### Takeaway

Mass & balance documentation must reflect the actual loaded state and carry a signature or electronic equivalent (ICAO Annex 6 / EASA CAT.POL.MAB.105 with AMC on electronic signatures; US 14 CFR 121.693-697 requires signed load manifests retained ≥3 months); Saudi GACAR Part 117 (Version 3.0) sets flight-crew flight/duty limits in Tables A/B/C with FRMS under §117.7 (EASA ORO.FTL.205 caps basic FDP at 13h, 1h extension max twice in 7 days, min rest 12h/length of prior duty at home base); DCS must produce PNL/ADL, LDM and MVT Type B messages; the DGR 67th edition (1 Jan 2026) and EC 1107/2006 PRM 48h/36h rules complete the operational layer.

### Cited Findings

**Weight & balance / load sheet**

- EASA AMC1 CAT.POL.MAB.105(c) provides the means to comply with the required handwritten signature "or its equivalent" for mass and balance documentation (load sheets listed among documents that may require signature); GM1 CAT.POL.MAB.105(d): mass and balance documentation should reflect the actual loaded state — [EASA AMC/GM download 19914](https://easa.europa.eu/de/downloads/19914/en); [EASA AMC/GM Part-CAT 94187](https://easa.europa.eu/et/downloads/94187/en)
- EASA EFB rulemaking transposing ICAO Annex 6 Part I Amdt 38 / Part II Amdt 33 / Part III Amdt 19 proposed changes to CAT.POL.MAB.105(b)/(e) so operators specify EFB mass-and-balance procedures in the Operations Manual (adoption status not confirmed) — [EASA ED Decision 2019/008/R](https://easa.europa.eu/en/document-library/agency-decisions/ed-decision-2019008r); [EASA download 142229](https://www.easa.europa.eu/en/downloads/142229/en)
- US 14 CFR 121.693/121.695/121.697: load manifest must show aircraft weight, fuel/oil, cargo/baggage, passengers/crew, maximum allowable weight and evidence CG is within approved limits; prepared and signed by employees supervising loading; copies kept at least three months — [14 CFR 121.697](https://www.law.cornell.edu/cfr/text/14/121.697); [FAA HBAT 97-12](https://www.faa.gov/sites/faa.gov/files/2022-11/HBAT9712.pdf)
- Electronic W&B vendors generate LDM, loadsheet, NOTOC etc. as standard outputs — [Evionica messages list](https://www.evionica.com/wb-knowledge-base/available-messages-and-documents)

**Crew flight and duty limitations**

- GACAR Part 117 (Version 3.0) "Flight and Duty Limitations and Rest Requirements: Flight Crew Members" contains flight time limits (Table A), unaugmented FDP limits (Table B), augmented limits (Table C), FRMS under §117.7, §117.11 flight time limitations with a 30-minute Table B reduction in a specified situation; "consult the GACA website for current version" — [GACAR Part 117 PDF](https://gaca.gov.sa/-/media/Files/PDF/LawsAndRegulation/Aviation-Safety-and-Environmental-Sustainability/GACAR-Safety-Regulations/GACARS/Part_117.pdf)
- US 14 CFR Part 117 (model for GACAR) — [eCFR Part 117](https://law.cornell.edu/cfr/text/14/part-117)
- EASA ORO.FTL: operator assigns a home base; basic max daily FDP for acclimatised crew 13h reduced 30 min per sector from the third sector (max 2h reduction) (third-party summary); unknown acclimatisation 11:00 for 1–2 sectors; FDP may be extended up to 1h not more than twice in any 7 consecutive days; 16h cap applies only to FDPs without in-flight rest; minimum rest at home base at least as long as the preceding duty or 12h, whichever greater (UK CAA mirror); 2 local nights after ≥4 time-zone changes — [UK CAA regulatory library ORO.FTL.205](https://regulatorylibrary.caa.co.uk/965-2012/Content/Regs/05130_ORO.FTL.205_Flight_duty_period_FDP.htm); [EASA Easy Access Rules Air Ops](https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-air-operations?page=33); [EASA FAQ 47591](https://www.easa.europa.eu/en/faq/47591); [FL3XX KB (vendor)](https://fl3xx.com/kb/flight-time-limitations-ftl-maximum-flight-duty-period-fdp)

**DCS / operational messaging** — see Q1 findings (PNL/ADL, LDM, MVT Type B; BSM/BPM → BIX).

**Dangerous goods** — IATA DGR 67th edition effective 1 Jan 2026 (see Q1) — [IATA DGR 67 Addendum 1](https://www.iata.org/contentassets/90f8038b0eea42069554b2f4530f49ea/dgr-67-addendum-1---en---01-january-2026.pdf)

**PRM** — EC 1107/2006 48h pre-notification / 36h transmission (see Q3) — [legislation.gov.uk Art. 7](https://www.legislation.gov.uk/eur/2006/1107/article/7)

### Inferences

- **Weight & balance module** = MANDATORY content under GACA (GACAR Part 121 is modelled on FAA Part 121; Saudi-specific text not retrieved), EASA and FAA: it must use approved aircraft basic weights/CG envelopes, standard passenger/bag masses per operator approval, compute ZFW/TOW/LW vs structural and performance limits and CG/MAC, produce a loadsheet with a signature or approved electronic equivalent (named user, timestamp, immutable record), issue LDM/CPM to downline stations, and retain records (FAA: ≥3 months; GACAR period unverified). Last-minute changes (LMC) must be recorded.
- **Crew assignment module** = must implement the operator's applicable FTL (GACAR Part 117 tables for Saudi crews; EASA ORO.FTL for EU AOCs) as hard constraints: FDP by report time and sectors, augmented-crew limits, cumulative flight-time limits (28-day/365-day style), minimum rest and local-night rules, extension counters per 7 days, plus FRMS data if used. Evidence: rule-engine test cases against the regulator's tables, audit log of exceedances and discretion reports. Classify as MANDATORY (safety regulation) but note that a booking platform's "crew assignment" is only compliant if it enforces, not merely records, these limits.
- **DCS messaging (PNL/ADL to handlers, LDM/MVT, PAL/CAL for PRM, BSM/BPM)** = INDUSTRY-EXPECTED; without Type B connectivity (SITA/ARINC or an IP-based Type B gateway) a self-built DCS cannot operate at outstations with third-party handlers.
- **Dangerous goods** = MANDATORY: the passenger check-in flow must present the DG restrictions notice (DGR 9.5 passenger awareness — standard practice), capture battery/mobility-aid declarations, and the load module must handle NOTOC. Edition cycle requires annual rule updates.
- **PRM** = MANDATORY in EU/UK and under GACA's 2023 regulation (compensation if facilities lacking); SSR codes and 48h/36h timers are the technical requirement.

### Gaps

- GACAR Part 117 Table A/B/C numeric values and minimum rest rules could not be extracted (PDF blocked); the GACAR Part 121 load-manifest requirement (retention period, signature rules, electronic loadsheet acceptance) was not found at all — only the FAA analogue.
- EASA AMC1 CAT.POL.MAB.105(c) exact text on electronic signatures/electronic loadsheet conditions not retrieved; adoption status of the EFB-related amendment to CAT.POL.MAB.105 unconfirmed.
- IATA RP 1708/1707 (load/DCS message RPs), SSIM edition, and the AHM (Airport Handling Manual) chapters that define LDM/CPM/UCM formats were not located.
- No GACA-specific rule on EFB/electronic loadsheet approval was found.
