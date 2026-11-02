# Airline Commercial Systems 2024–2026: Payments & Fraud, Refunds/Compensation, Loyalty, Ancillaries & Pricing, Revenue Accounting & Settlement, Corporate/Agency Distribution

Research notes to benchmark a self-built airline platform (Stripe Checkout, internal wallet/credits/vouchers, split payments, miles-based loyalty, corporate accounts, agent portal).

Method note: ~40 web searches were run (Nov 2026). Direct page fetches to iata.org, ideaworkscompany.com, transportation.gov, riskified.com, forter.com, burges-salmon.com and financialit.net were blocked by the session's network allow-list, so figures below come from search-result extracts of those pages plus secondary trade press. The shared web-search budget ran out before the last batch of queries (EU261 Art. 8 refund mechanics, dynamic award pricing adoption, ATPCO TTBS tax engine, Stripe travel-specific features, SAMA PSP licensing, group-booking norms, agency commission models); those are listed under Gaps. Vendor press releases are flagged as such.

---

## 1. Payments: orchestration, local methods (Saudi/GCC), 3DS2/SCA, tokenisation, A2A, fraud, PCI, async payments, reconciliation, refund rules, split payments

### Takeaway

Leading airlines in 2024–2026 have moved from a single PSP to a payment-orchestration layer (CellPoint Digital, Outpayce Xchange, Sabre/CellPoint, Checkout.com, Adyen) that routes across acquirers, adds network tokens, travel-enriched 3DS2 data, account-to-account (IATA Pay) and BNPL, and reconciles sales to settlement automatically. Fraud is managed by specialist ML vendors (Riskified, Forter) and the dominant failure mode is non-fraud ("service") chargebacks and last-minute booking fraud. A Stripe-Checkout-only stack is PCI-light (SAQ A) but lacks orchestration, travel-specific 3DS data, and automated settlement reconciliation unless built.

### Cited Findings

**Payment orchestration vendors and 2025 deals**

- CellPoint Digital launched a new payment orchestration platform "purpose-built for airlines, travel companies and their customers" on 18 Feb 2025 — [The Paypers](https://thepaypers.com/payments-general/cellpoint-digital-launches-payment-platform-for-the-travel-industry--1272381)
- Southwest Airlines expanded its CellPoint Digital partnership in March 2025; the unified payment system was slated to launch late 2025 — [The Paypers](https://thepaypers.com/payments-general/cellpoint-digital-expands-payment-orchestration-for-airlines--1272919)
- Sabre and CellPoint Digital signed an agreement in April 2025 to bring CellPoint's orchestration into Sabre's airline platform, aimed at better payment solutions, UX and lower cost — [Sabre Investor Relations](https://investors.sabre.com/node/18941)
- Oman Air reported (Sept 2025) increased conversion rates and sales via CellPoint's platform; Virgin Atlantic, La Compagnie (Mar 2024), GOL and Air Europa are other CellPoint airline customers — [FF News](https://ffnews.com/news/oman-air-modernizes-passenger-booking-and-payment-experiences-with-cellpoint-digital); [IBS Intelligence](https://ibsintelligence.com/ibsi-news/cellpoint-digital-appointed-by-virgin-atlantic-and-holidays-as-payment-partner)
- CellPoint partnered with Checkout.com for payment optimisation (2025) — [The Paypers](https://thepaypers.com/payments-general/cellpoint-digital-partners-with-checkoutcom-for-payment-optimisation--1273101)
- In Sept 2025 CellPoint launched "One Source Orchestration (OSO)", described as the first payment-optimisation platform built for Offer-Order-Settle-Deliver (OOSD) retailing — [FF News](https://ffnews.com/newsarticle/paytech/cellpoint-digital-launches-one-source-orchestration-the-first-payment-optimization-platform-to-meet-the-demand-of-oosd-retailing-models)
- Outpayce (Amadeus) launched the Xchange Payments Platform, a payments marketplace for travel, in April 2025 — [eCommerceNews AU](https://ecommercenews.com.au/story/amadeus-unveils-new-payment-marketplace-for-airlines)
- Outpayce launched an automated reconciliation system for airlines in June 2025 that matches sales to payments received — [Financial IT](https://financialit.net/node/65721)
- Outpayce's "Retailing Ready" airport-payments report (Feb 2025, with Worldline/Opinium) found outdated airport payment systems frustrate 54% of travellers and that airlines are "rarely in complete control of payments at the terminal" — [FF News](https://ffnews.com/newsarticle/paytech/outdated-airport-payments-jeopardize-airline-retailing-ambitions-finds-new-outpayce-report)
- Outpayce study (Mar 2025): over 70% of travellers prioritise payment security over discounts — [CFOtech UK (Outpayce tag)](https://cfotech.co.uk/tag/outpayce)
- Outpayce integrated UnionPay into airline booking channels (2026) — [Pulse](https://www.pulse.bot/transportation/news/amadeus-links-unionpay-payments-to-airline-booking-channels-afca6294-70d5-4537-9e57-0a73c07c436d)

**3DS2 / network tokens / authorisation uplift**

- Outpayce's "3DS 2 Travel" sends over 100 data elements, many unique to travel (itinerary, passenger data), to improve issuer risk assessment and frictionless-flow rates — [Outpayce](https://outpayce.com/en/products/merchant-services/3ds2-travel); [Outpayce 3DS2 Travel PDF](https://outpayce.com/content/dam/outpayce-2025/legal/documents/3ds-2-travel.pdf)
- Outpayce's 2026 tokenisation report says airlines are a key focus for tokenisation because of fraud and breach risk — [Outpayce tokenization report](https://outpayce.com/content/dam/outpayce-2025/resources/research/2026/outpayce-tokenization-report.pdf)
- Network-token authorisation uplift: Visa ~4.6–4.7% CNP; Mastercard ~2.1% (most-cited figures) — [Solidgate](https://solidgate.com/blog/network-tokenization-authorization-rates/)
- Adyen reports an average 3% authorisation uplift from network tokenisation and 2bn+ active network tokens (2,200% growth since 2020); its token/PAN optimiser adds ~1% more — [Adyen press release](https://www.adyen.com/en_AU/press-and-media/adyen-has-issued-over-two-billion-active-network-tokens)
- Checkout.com reports 2–3% uplift for most merchants; a separate 2025 figure claims 10.3 percentage points on tokenised vs PAN transactions (outlier) — [Checkout.com](https://www.checkout.com/blog/network-tokens-why-your-2024-payment-strategy-needs-them)
- Caveat from practitioners: uplift "is real, but not automatic" — depends on data quality submitted with token + cryptogram — [IXOPAY](https://www.ixopay.com/blog/the-truth-about-network-tokens-key-insights-from-industry-experts)
- I found no Stripe-published airline-specific authorisation or 3DS2 figures.

**Account-to-account / IATA Pay**

- IATA Pay is available in over 36 countries with 60+ airlines; IATA claims it cuts payment-processing cost by up to 99% vs cards — [IATA Payment Services fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-payment-services/)
- IATA Pay launched in 2022; airlines receive funds the next day — [Travel Daily News](https://www.traveldailynews.com/aviation/iata-and-outpayce-help-airlines-accept-account-to-account-payments/); [FSTech](https://www.fstech.co.uk/fst/Iata_introduces_account_to_account_payment_feature_for_airlines.php)
- IATA and Outpayce partnered (Sept 2024) so airlines can accept IATA Pay via Xchange; Philippine Airlines was the first to implement it; Outpayce cites 30+ countries (vs IATA's 36+) — [Outpayce press release](https://outpayce.com/en/resources/news/iata-and-outpayce-help-airlines-accept-account-to-account-payments); [eCommerceNews AU](https://ecommercenews.com.au/story/iata-outpayce-partner-to-enable-global-account-payments)
- Early UK Open Banking IATA Pay pilot involved Cathay Pacific, SAS and Emirates — [Travel News SA](https://www.travelnews.co.za/article/new-iata-payment-method-successful?page=6)

**Fraud and chargebacks**

- Forter (3 July 2025): in travel, and airlines especially, non-fraud chargebacks run ~50% higher than fraud chargebacks by dollar value, while by count fraud disputes are ~60% of total; a small number of airlines/airports account for most of a merchant's non-fraud chargebacks — [Forter](https://www.forter.com/?p=16326)
- Riskified: flight bookings were ~14% riskier YoY in 2024; fraud peaked July 2025 with elevated volume in Oct–Nov; last-minute airline bookings were 2.3x riskier than other bookings throughout 2025; May 2026 saw a 32% YoY rise in fraud levels — [Riskified Travel Risk Rundown](https://www.riskified.com/lp/travel-risk-rundown/view/)
- Riskified's 2022-based analysis flagged July–August as the months most likely to push an airline's card-network chargeback ratio over monitoring thresholds — [Riskified](https://www.riskified.com/?p=81284)
- Riskified and Outpayce partnered (2026) on airline fraud prevention/chargeback resilience — [The Paypers](https://thepaypers.com/fraud-and-fincrime/news/riskified-and-outpayce-partner-on-airline-fraud-prevention); Riskified also has a strategic partnership with IATA — [Travel Daily News](https://www.traveldailynews.com/associations/riskified-and-iata-announce-new-strategic-partnership/)
- Mastercard (2025): 46% of chargebacks in travel & hospitality are fraudulent — highest of any industry — and the sector has the highest average chargeback amount ($120) — [Mastercard](https://b2b.mastercard.com/news-and-insights/blog/what-s-the-true-cost-of-a-chargeback-in-2025)
- Travel/hospitality chargeback rate benchmark commonly cited at 0.89% of transactions — [Clearly Payments](https://www.clearlypayments.com/blog/chargeback-rate-by-industry-and-business-type/); a 2026 page gives a 0.8–1.5% range for travel — [chargebackcost](https://chargebackcost.pages.dev/travel-chargeback-rate) (unverified sourcing)
- Justt: 35% of merchants exceed a 0.9% chargeback-to-transaction ratio — [The Paypers](https://thepaypers.com/digital-identity-security-online-fraud/justt-merchants-face-growing-revenue-loss-from-chargebacks--1264650)
- Older RSA/Juniper figure: airlines were the sector most affected by online fraud at 46% of fraudulent transactions — [Security Magazine](https://www.securitymagazine.com/articles/98527-scars-of-covid-19-pandemic-leave-airlines-vulnerable-to-payment-fraud)
- Visa VAMP (replacing VDMP/VFMP): single ratio combining TC40 fraud + TC15 disputes; thresholds revised in May 2025 — initial "excessive" threshold raised from 1.5% to 2.2%, dropping to 1.5% from 1 April 2026; minimum triggering count raised from 1,000 to 1,500 disputes/TC40s — [Chargeback Gurus](https://www.chargebackgurus.com/blog/visa-announces-even-more-vamp-changes); [emerchantpay](https://www.emerchantpay.com/amp/insights/visas-new-vamp-rules-2025-what-merchants-need-to-know); [Acquired.com VAMP FAQ](https://docs.acquired.com/docs/vamp-frequently-asked-questions)

**PCI DSS 4.0 with hosted checkout**

- New SAQ A eligibility criterion for iframe/hosted checkout: either implement 6.4.3 (script inventory/integrity) and 11.6.1 (payment-page change detection) on the page hosting the iframe, or obtain written confirmation from the PSP that its embedded solution includes script-attack protections — [TrustedSec](https://trustedsec.com/blog/the-hidden-trap-in-the-pci-dss-saq-a-changes); [Hyperproof](https://hyperproof.io/?p=33329)
- Sources conflict on whether 6.4.3/11.6.1 remain binding for SAQ A: Clover says merchants embedding an iframe on their own domain remain responsible — [Clover docs](https://docs.clover.com/dev/docs/pci-dss-v40-requirements-643-and-1161); Findstack says PCI SSC removed them from SAQ A effective 31 Mar 2025 (still required under SAQ D) — [Findstack](https://findstack.com/resources/pci-compliant-hosting). PCI SSC released an information supplement on 10 Mar 2025; the relevant FAQ applies to v4.0.1 (effective April 2025) — [TrustedSec](https://trustedsec.com/blog/the-hidden-trap-in-the-pci-dss-saq-a-changes)

**Split / group payments in market**

- Air Europa (Jan 2025) enabled split payment on its website using Hands In; reported >€1.6m incremental revenue from group trips and 87.8% conversion when the lead booker pays with the first card — [The Paypers](https://thepaypers.com/payments/news/air-europa-supports-split-payments-for-users-buying-tickets-online); [FF News (PayTech Magazine interview)](https://ffnews.com/newsarticle/exclusive-skys-the-limit-yago-casasnovas-air-europa-in-the-paytech-magazine/); [Aviación al Día](https://aviacionaldia.com/en/2025/01/air-europa-allows-split-payment-for-tickets-on-its-website.html)
- Hands In partnered with Outpayce to bring split payments to Xchange airlines — [The Paypers](https://thepaypers.com/payments/news/hands-in-and-outpayce-partner-to-bring-split-payments-to-airlines); and with UATP on a split-funding service that consolidates contributors' payments so the airline sees one payment — [Digital Transactions](https://www.digitaltransactions.net/uatp-teams-with-hands-in-on-a-split-funding-service-for-travel/); and with Trust My Group — [Aviation Business News](https://www.aviationbusinessnews.com/industry-news/trust-my-group-and-hands-in-strike-agreement-to-bring-split-payments-to-airlines/)
- Hands In/Ethoca data: >40% of airline payment declines stem from insufficient funds (a core rationale for split pay) — [Airline Tech Podcast](https://www.buzzsprout.com/2604709/episodes/18974154-ep-2-how-hands-in-drives-revenue-growth-for-airlines-through-split-payments-with-garth-lund-and-sam-flynn)
- Jetstar "FareShare" (AU/NZ) splits a booking into groups; each group gets 48 hours to pay — [Karryon](https://karryon.com.au/?p=153736)
- Air Tahiti Nui and Air Tahiti offer multi-party payment where companions are emailed and pay their share within a set window — [Air Tahiti Nui](https://au.airtahitinui.com/split-payment); [Air Tahiti](https://airtahiti.com/en/multi-party-payment)
- I found no KLM or Transavia split-pay product in the results.

### Inferences

- The market pattern is "orchestrator + specialist fraud + A2A/BNPL/local wallets + automated settlement reconciliation." A Stripe-Checkout-only design covers acceptance and PCI scope reduction, but to match peers it needs: (a) travel-enriched 3DS2 data (itinerary, PNR, pax) passed through `payment_method_options.card.three_d_secure`/metadata equivalents; (b) network tokens on saved cards; (c) a reconciliation job matching Stripe payouts/balance-transaction reports to internal bookings daily (Outpayce productised exactly this in 2025); (d) a chargeback programme separating fraud from service disputes, since service disputes dominate airline dollar losses.
- Split payment is a proven conversion lever (Air Europa 87.8% conversion, >€1.6m incremental) but market products hold the booking for a fixed window (e.g., 48 h) and consolidate into a single settlement — design the internal split-pay model with an expiry/TTL, partial-funding state, and single-ledger consolidation.
- Given the VAMP 1.5% combined fraud+dispute threshold (from Apr 2026) and travel benchmark ~0.9%, an airline should instrument chargeback ratio per card brand monthly and treat July–August/holiday peaks as high-risk windows.
- Last-minute bookings (2.3x riskier) and insufficient-funds declines (>40% of declines) are two distinct problems: route the former to step-up (3DS challenge/manual review), and the latter to retry/alternate-method/split-pay prompts.

### Gaps

- No Stripe-published airline/travel benchmark figures (authorisation rate, 3DS frictionless rate, Adaptive Pricing/multi-currency uptake) were found; the Stripe-specific search was not executed before the search budget ran out.
- No authoritative 2025 airline-only chargeback rate (only travel-sector ~0.89% and vendor claims).
- Idempotency and async/pending-payment handling norms (e.g., SADAD/bank-transfer pending states, webhooks ordering) were not covered by any source found; these are engineering patterns rather than published benchmarks.
- Multi-currency pricing/DCC rules for airlines and the exact PCI SSC SAQ A v4.0.1 wording were not retrieved (official PCI/IATA pages blocked).

---

## 2. Saudi / GCC payment specifics (mada, Apple Pay, STC Pay, Tabby/Tamara BNPL, SADAD, SAMA licensing)

### Takeaway

Saudi airlines (flynas, Saudia) accept a wide local mix — mada, Apple Pay, STC Pay/STC Bank, SADAD, Tabby and Tamara BNPL, KNET (Kuwait), PayPal — and BNPL has become SAMA-licensed consumer finance (Tamara Mar 2025, Tabby Nov 2025). mada e-commerce is large and growing ~26%/yr (SAR 197bn, 1.13bn transactions in 2024), and e-payments are 79% (2024) of retail transactions. A Saudi-market platform that only offers international cards via Stripe is missing the dominant local rails.

### Cited Findings

- flynas's payment-methods page lists: Tamara, Tabby, SADAD, Credit Shell, Mada, PayPal, Apple Pay, STC Bank, Vouchers, Installment, Credit Cards, KNET, Madfu — [flynas payment methods](https://www.flynas.com/en/payment-methods/)
- flynas added mada debit cards online and at booking centres in 2018 — [flynas](https://www.flynas.com/en/media-center/news-updates/1013-mada-debit-cards/); was first Saudi carrier to offer Apple Pay — [flynas Apple Pay](https://www.flynas.com/en/apple-pay); signed an STC Pay agreement for new payment solutions — [flynas](https://flynas.com/en/media-center/news-updates/agreement-with-stc-pay)
- flynas–Tabby partnership (Aug 2023): pay for tickets in 4 monthly payments; available in KSA, Kuwait, Qatar, UAE, Bahrain — [flynas](https://www.flynas.com/en-ae/media-center/news-updates/tabby); [flynas Tabby page](https://flynas.com/en-ae/tabby)
- flynas–Tamara partnership (Dec 2023): 4 interest-free payments — [flynas](https://www.flynas.com/en/media-center/news-updates/tamara/)
- SAMA licensed Tamara Finance for consumer finance and BNPL (reported Mar 2025), bringing licensed finance companies to 65 — [Arab News](https://www.arabnews.pk/node/2592375); [Sharikat Mubasher](https://sharikatmubasher.com/media-hub/news/21472234/tamara-finance-gets-nod-to-provide-consumer-finance-bnpl-services?lang=en)
- SAMA licensed Tabby Finance for BNPL in Nov 2025 (68 licensed finance companies); Tabby had earlier received a SAMA permit — [Sharikat Mubasher](https://en.sharikatmubasher.com/media-hub/news/21516597/tabby-finance-secures-sama-license-for-bnpl-services); [Arab News](https://www.arabnews.pk/node/2344021/business-economy)
- SAMA later licensed Daftar Technologies for BNPL, raising finance firms to 76 — [Arab News](https://www.arabnews.com/node/2649862/amp)
- Saudi finance-company lending surged to ~$26bn in 2024 — [Arab News](https://www.arabnews.pk/node/2597737)
- mada e-commerce sales reached SR197.42bn ($52.64bn) in 2024, +25.82% YoY; transactions +28.86% to ~1.13bn; December 2024 alone 105.73m transactions (+30.47%). Figures exclude Visa/Mastercard credit cards — [Arab News](https://www.arabnews.com/node/2589350/business-economy)
- Electronic payments were 79% of Saudi retail transactions in 2024 (up from 70% in 2023), per SAMA — [Arab News](https://www.arabnews.pk/node/2597120); non-cash transactions rose to 12.6bn from 10.8bn in 2023 — [Gulf Base](https://gulfbase.com/news/e-payments-account-for-79-of-saudi-retail-transactions-in-2024-sama/207491)
- Saudi fintech firms reached 261 by end-2024 — [Arab News](https://www.arabnews.pk/node/2597120)
- Saudia AlFursan introduced a "Cash + Miles" payment option for rewards — [NewsHub Asia](https://www.newshubasia.com/living/saudias-alfursan-introduces-cash-miles-payment-option-for-loyalty-programme-rewards-members)
- Riyadh Air chose Loyalty Juggernaut (GRAVTY) for its digital loyalty programme, announced 7 May 2025 at ATM Dubai, to launch before first passenger service — [Kyodo PR Wire](https://kyodonewsprwire.jp/release/202505088452)

### Inferences

- For a Saudi-first platform, mada (debit) is the baseline rail; most Saudi consumers' primary card is mada, and mada e-commerce is growing ~26–29%/yr. Stripe's mada support in KSA must be verified directly; if unavailable, a local PSP/orchestrator (e.g., Checkout.com, HyperPay, Moyasar, Tap, PayTabs — not researched here) is needed alongside Stripe.
- BNPL via Tabby/Tamara is now a licensed, regulated product in KSA; both already integrate with flynas, so a competitive KSA airline checkout is expected to offer "pay in 4."
- SADAD/bank-transfer and "Credit Shell" (airline wallet) on flynas's list validate the internal wallet/credits model as a market norm — but note these are asynchronous payment methods needing pending-state handling.

### Gaps

- No mada-specific airline acceptance statistics or SAMA PSP-licensing requirements for merchants/gateways were retrieved (the SAMA PSP search was not executed due to budget).
- A "2025 e-payments at 85%" SAMA figure and "77% of Saudi consumers use BNPL" (Tabby report) appeared in search summaries but without a traceable URL; treat as unverified.
- Saudia's and flynas's live payment-method pages should be checked directly for current availability by country.

---

## 3. Loyalty: platforms, earning models, miles as currency, IFRS 15/breakage, fraud, partner/co-brand economics, Gulf examples

### Takeaway

Airline loyalty programmes are now valued at tens of billions (SkyMiles $31bn, AAdvantage $26.7bn, MileagePlus $25.3bn, Avios $10.3bn in On Point Loyalty's 2026 ranking) and co-brand remuneration is a core P&L line (Delta/Amex $8.2bn in 2025, ~14% of revenue). Modern programmes run on SaaS loyalty platforms (IBS iFly Loyalty, Loyalty Juggernaut GRAVTY, Comarch, Amadeus), have shifted to revenue-based earning (BA April 2025), use cash+miles and activity-based expiry (24 months), and account for miles as a separate IFRS 15 performance obligation with breakage estimated from historical redemption. Account takeover is the dominant loyalty fraud vector (+50% YoY in travel per Ravelin).

### Cited Findings

**Programme economics and valuations**

- On Point Loyalty Top 100 (published ~30–31 Mar 2026, analysing 170+ airlines with 50+ variables): Delta SkyMiles >$31bn; AAdvantage ~$26.7bn; MileagePlus ~$25.3bn; IAG Avios ~$10.3bn (4th, most valuable outside US; doubled from $5.1bn in 2020) — [PR Newswire](https://tools.prnewswire.com/en-us/live/20823/release/20260330EN22071); [IAG Loyalty](https://www.iagloyalty.com/news-insights/iags-loyalty-programmes-ranked-as-worlds-most-valuable-outside-of-the-us-surpassing-10bn-valuation)
- Qantas Frequent Flyer valued at US$7bn (A$10.1bn); Aeroplan ~US$7.38bn (8th) — [Executive Traveller](https://www.executivetraveller.com/news/qantas-frequent-flyer-valuation); [Travel Market Report](https://www.travelmarketreport.com/canada/air/articles/delta-skymiles-is-worlds-most-valuable-airline-loyalty-program-aeroplan-ranks-8th)
- Delta: American Express remuneration grew 11% to $8.2bn in 2025 (from $7.4bn in FY2024), with double-digit co-brand spend growth every quarter and >1m new cardholders for the 4th consecutive year; management targets $10bn; roughly one-third of active SkyMiles members hold a Delta Amex — [Delta Q4/FY2025 release via QuantisNow](https://quantisnow.com/insight/delta-air-lines-announces-december-quarter-and-full-year-2025-6347232); [Panabee](https://www.panabee.com/news/delta-air-lines-earnings-2025-annual); [AltexSoft](https://www.altexsoft.com/travel-industry-news/premium-strategy-works-deltas-2025-revenue-hits-63b/)
- Amex remuneration is ~14% of Delta's adjusted operating revenue and ~1.4x adjusted operating income; 2026 guidance: high-single-digit growth (Fortune) vs ~$9bn/+10% (Payments Dive) — [Fortune](https://fortune.com/2026/01/13/delta-earnings-guidance-main-cabin-not-growing-wealthy-affluent-k-shaped-economy/); [Payments Dive](https://www.paymentsdive.com/news/amex-delta-card-spending-soars/825180/)
- Analysis of Delta disclosures implies Amex pays ~3.8 cents per dollar charged on co-brand cards — [View from the Wing](https://viewfromthewing.com/amex-pays-delta-3-8-cents-per-dollar-charged-why-banks-pay-more-for-miles-than-you-do/)

**Earning / expiry / redemption models**

- British Airways Executive Club moved to full revenue-based earning on 1 April 2025 (rebranded "The British Airways Club") — [AwardWallet](https://awardwallet.com/news/british-airways-club/program-changes/)
- Saudia AlFursan: domestic earning by fare code — "Basic" fares (L,Q,T,N,V) earn 60% of miles flown, "Saver" (U) 35%; Silver/Gold earn tier bonuses on base miles (i.e., distance × fare-class, not revenue-based) — [Saudia](https://prod.dcloud.saudia.com/loyalty-program/about-alfursan-program/alfursan-miles/earning-miles/from-flights)
- AlFursan miles now stay valid as long as the member earns or redeems once in 24 months (previously expired 3 years after earning) — [Saudia expiry policy](https://prod.dcloud.saudia.com/pages/loyalty-program/about-alfursan-program/faqs-terms-and-conditions/expiry-policy); upgraded programme launched with SkyTeam alignment — [Breaking Travel News](https://www.breakingtravelnews.com/news/article/saudia-launches-an-upgraded-version-of-alfursan-loyalty-program-with-the-sl/)
- AlFursan offers Cash + Miles redemption — [NewsHub Asia](https://www.newshubasia.com/living/saudias-alfursan-introduces-cash-miles-payment-option-for-loyalty-programme-rewards-members)
- Emirates revised Skywards miles expiry policy (effective following year) — [Khaleej Times](https://www.khaleejtimes.com/business/emirates-airline-revises-skywards-miles-expiry-policy-from-next-year?amp=1); Skywards passed 27m members at its 20-year mark — [Aviation Week](https://aviationweek.com/air-transport/safety-ops-regulation/emirates-skywards-hits-20-year-mark-over-27-million-members)
- flynas relaunched "nasmiles" with new incentives (cardless programme, one account per person) and allows Mobily "Neqaty" telecom points to transfer into nasmiles — [flynas](https://www.flynas.com/en/media-center/news-updates/loyalty-program-nasmiles); [flynas–Mobily](https://www.flynas.com/en/media-center/news-updates/flynas-signs-a-partnership-agreement-with-mobily-allows-transfer-of-neqaty-points-to-nasmiles/)
- American Airlines: mileage credits expire after 24 months of inactivity (10-K disclosure) — [SEC filing](https://www.sec.gov/Archives/edgar/data/4515/000000620124000048/R50.htm)

**IFRS 15 / ASC 606 accounting**

- Loyalty points granting a material right are a separate performance obligation; part of each ticket's transaction price is deferred (relative stand-alone selling price) until redemption or expiry — [Acadifi](https://acadifi.com/community/loyalty-program-deferred-revenue-ifrs-15-transaction-price-allocation); [RevenueHub ASC 606 airline issues](https://www.revenuehub.org/common-asc-606-issues-airline-entities)
- Breakage: expected unredeemed points may be recognised in proportion to redemptions if reliably estimable; otherwise on expiry; KPMG notes breakage is recognised only when the chance of use becomes remote — [KPMG transport revenue leaflet](https://assets.kpmg.com/content/dam/kpmg/pdf/2015/06/revenue-leaflet-transport.pdf)
- Southwest 10-K: changes to breakage estimates affect revenue prospectively; loyalty liability roll-forward shows "amounts deferred associated with points awarded" and "revenue recognized from points redeemed" — [SEC filing](https://www.sec.gov/Archives/edgar/data/92380/000009238025000024/R15.htm)
- Actuaries (Australia) describe airline loyalty liability modelling as an actuarial problem (redemption curves, breakage) — [Actuaries Institute](https://www.actuaries.asn.au/research-analysis/miles-of-possibilities-actuaries-taking-flight-in-loyalty-programmes)

**Loyalty platforms (vendors) 2024–2025**

- IBS Software iFly Loyalty wins: LifeMiles (Avianca) seven-year contract replacing in-house platform — [Travel Daily News](https://www.traveldailynews.com/post/lifemiles-inks-seven-year-contract-with-ibs-software); LATAM Group migrating off legacy data centres — [Intelligent CIO](https://www.intelligentcio.com/latam/?p=2027); Gulf Air Falconflyer (multi-programme single platform) — [Travel Daily News](https://www.traveldailynews.com/regional-news/gulf-air-to-transform-falconflyer-programme-with-ibs-softwares-ifly-loyalty/); Bamboo Airways (1.6m members) — [GBP](https://gbp.com.sg/stories/bamboo-airways-opts-for-ibs-softwares-next-gen-ifly-loyalty-platform/)
- Loyalty Juggernaut (GRAVTY): Air Serbia five-year deal (Nov 2025; programme debut planned Mar 2026) — [AAP/Cision](https://prod-ss.aap.com.au/aapreleases/cision20251110ae19934); Riyadh Air (May 2025) — [Kyodo PR Wire](https://kyodonewsprwire.jp/release/202505088452); named Strong Performer in Forrester Wave Loyalty Platforms Q4 2025; clients include WestJet, Emirates, Viva Aerobus — [AAP/Cision](https://www.aap.com.au/aapreleases/cision20251210ae43350)
- No 2025 Comarch or Amadeus Loyalty airline wins surfaced in results (search not exhaustive).

**Loyalty fraud**

- Ravelin survey: travel companies saw >50% rise in account-takeover attacks over 12 months — [Mastercard Insights](https://www.mastercard.com/us/en/news-and-trends/Insights/2024/fighting-loyalty-fraud-essential.html)
- Widely repeated but untraceable: airlines lose ~3% of loyalty points value to fraud; ATOs up 30–40% from bot attacks — [Fraud.net](https://www.fraud.net/glossary/loyalty-program-fraud) (no primary citation)
- Only "hard" public number found by one researcher: 3% of Australian loyalty members were ATO victims — [Travolution guest post](https://www.travolution.com/articles/114583/guest-post-miles-cost-more-than-you-think)
- 2025 cases: Lufthansa Miles & More member lost 383K miles (30 Sept 2025) and airline initially refused restoration — [One Mile at a Time](https://onemileatatime.com/insights/lufthansa-miles-stolen); Alaska Mileage Plan accounts drained (Nov 2025) — [Anchorage Daily News](https://www.adn.com/alaska-news/aviation/2025/11/29/they-were-saving-up-alaska-air-miles-then-their-accounts-got-drained/)
- Airline loyalty fraud specifics (ATO, redemption fraud, partner earn abuse) — [The Paypers expert view](https://thepaypers.com/fraud-and-fincrime/expert-views/loyalty-fraud-in-the-airline-industry-key-insights-and-specificities)

### Inferences

- A minimal miles module must support: (1) revenue- or fare-class-based earn tables with tier multipliers; (2) activity-based expiry (24 months is now the Gulf/US norm); (3) cash+miles and ancillary redemption; (4) a ledger that records deferred revenue per mile at stand-alone selling price and a breakage estimate recognised proportionally — i.e., mile issuance must create a contract liability, not just a points balance.
- Partner earn/burn (telco points transfer à la nasmiles–Mobily, bank co-brand) is where programme value comes from (Delta ~14% of revenue from Amex alone); the platform needs a partner-accrual API and partner billing/settlement.
- Loyalty ATO is the top fraud risk: require step-up auth (MFA, device binding) on redemption, profile change, and email/phone change; alert on balance drains; keep a mile-restoration workflow.

### Gaps

- No deferred-revenue/contract-liability figures for Skywards, AlFursan, Privilege Club (annual-report PDFs not fetched); no member counts for AlFursan/nasmiles (only 2017 AlFursan: +850k new members).
- Dynamic award pricing adoption rates and ancillary-earn norms were not researched before the search budget ended.
- Comarch/Amadeus Loyalty/Points.com 2024–2025 airline references not found.

---

## 4. Ancillaries, merchandising and dynamic/continuous pricing

### Takeaway

Global airline ancillary revenue hit a record $148.4bn in 2024 (~15% of revenue, 61 airlines tracked) and grew 13.4% in 2025 among comparable carriers — nearly twice the growth of total revenue — with top ancillary champions near $90–100 per passenger. Pricing is shifting from static fare classes to AI continuous pricing (Delta/Fetcherr targeting 20% of domestic network by end-2025; Fetcherr raised $90m) within ATPCO's optimised/adjusted/continuous framework, and the first native Offers & Orders bookings went live in 2025 (Finnair/Amadeus Nevio).

### Cited Findings

- IdeaWorksCompany global estimate: ancillary revenue reached $148.4bn in 2024 (in 2025 US$) — [IdeaWorks Press Release 197 (Nov 2025)](https://ideaworkscompany.com/wp-content/uploads/2025/11/Press-Release-197-Global-Estimate-2025.pdf); "broke records… surpassing $148bn" — [Business Travel News](https://www.businesstravelnews.com/Transportation/Air/Airlines-Set-Ancillary-Records-Lean-Into-New-Revenue-Streams)
- 2025 Yearbook (CarTrawler) covers 61 airlines' 2024 results — [IdeaWorks store](https://ideaworkscompany.com/store/2025-yearbook-of-ancillary-revenue-for-2024-financial-year/)
- Secondary summary of the 2025 yearbook: ancillary = 14.9% of total airline revenue in 2024 (vs 9.1% in 2016); top per-passenger: Norse Atlantic $100.40, Jet2.com $89.99, Breeze $89.82 — [DWU Consulting](https://dwuconsulting.com/dwu-ai/airline-ancillary-revenue) (not verified against the yearbook)
- 2024 Yearbook (2023 data): Jet2.com $95.83 per passenger, a global record at the time — [IdeaWorks](https://ideaworkscompany.com/2024-cartrawler-yearbook-of-ancillary-revenue-report/); average ancillary revenue per passenger up 39% since 2019 — [Travel Daily News](https://www.traveldailynews.com/post/average-ancillary-revenue-per-passenger-jumps-39-since-2019)
- 2026 Yearbook (now "SeatMaps.com Yearbook", 19th edition, 63 airlines, 2025 data): among 58 comparable airlines, ancillary revenue +13.4% vs total revenue +7.2%; per-passenger ancillary +10.7% — [IdeaWorks](https://ideaworkscompany.com/2026-seatmaps-com-yearbook-of-ancillary-revenue-by-ideaworkscompany-report/); [CAPA](https://centreforaviation.com/analysis/reports/ancillary-revenue-is-no-longer-ancillary-to-the-airline-business-754588); [PhocusWire](https://www.phocuswire.com/news/distribution/airlines-ancillary-revenue-grows-twice-fast-overall-revenue)
- ATPCO dynamic pricing tiers: optimized (30+ airlines adopted), adjusted, continuous (fully personalised offers within min/max ranges) — [Travel Market Report](https://www.travelmarketreport.com/articles/Airline-Dynamic-Pricing-Getting-Closer-to-Reality-Says-ATPCO); [BTN interview with ATPCO](https://www.businesstravelnews.com/Interviews/ATPCO-Hits-the-Accelerator-on-Airline-Dynamic-Pricing); ATPCO CEO forecast that 2025 would be the fastest acceleration toward dynamic offers — [ATPCO](https://atpco.net/press/6)
- Fetcherr raised $90m (June 2024); customers include WestJet, Viva Aerobus, Virgin Atlantic, Royal Air Maroc, Azul; vendor claims up to 9% revenue uplift; partnered with ATPCO for fare data — [TechCrunch](https://techcrunch.com/2024/06/26/fetcherr-lands-90m-to-get-airlines-on-board-with-dynamic-pricing); [PhocusWire](https://www.phocuswire.com/travel-pricing-startup-fetcherr-to-leverage-atpco-fare-data)
- Delta (July 2025, President Glen Hauenstein): ~3% of domestic network priced by Fetcherr AI, goal ~20% by end-2025 (from 1% at Nov 2024 Investor Day); multi-year aim to eliminate static pricing; political backlash (Sen. Gallego: "predatory pricing") — [AirlineGeeks](https://airlinegeeks.com/2025/07/16/delta-expanding-use-of-ai-to-set-ticket-prices/); [Thrifty Traveler](https://thriftytraveler.com/news/airlines/delta-ai-fare-pricing); [Constellation Research](https://www.constellationr.com/insights/news/delta-starting-scale-its-ai-driven-dynamic-pricing-system)
- Secondary (Spanish) source citing OAG: ~260 airlines (~80% of IATA members) used some form of dynamic pricing in 2025 — [Ecosistema Startup](https://ecosistemastartup.com/?p=94506) (unverified)
- Finnair created the world's first "native order" on Finnair.com in May 2025 using Amadeus Nevio; Nov 2025 agreement adds "smart bridging" to migrate gradually off Altéa PSS — [Future Travel Experience](https://www.futuretravelexperience.com/2025/05/finnair-and-amadeus-deliver-worlds-first-airline-native-orders-a-new-era-of-fully-connected-travel/); [The Paypers](https://thepaypers.com/payments/news/finnair-develops-native-order-booking-system-enabled-by-amadeus)
- Roland Berger (Nov 2025): BA, Finnair, Lufthansa, Air France, TAP taking first Offers & Orders steps; mature standards/first production orders/interline expected 2026–2028; Accelya 2025 survey: 72% of airlines recognise O&O importance, only 27% have begun transformation — [Roland Berger](https://www.rolandberger.com/en/Insights/Publications/Airline-order-and-offer-management.html)
- PROS white paper on Offer & Order roadmap to 2025 and beyond — [PROS](https://pros.com/learn/white-papers/offer-order-looking-2025-beyond)

### Inferences

- Benchmarks for a self-built platform: target ancillary share ≥15% of revenue (global avg) and track ancillary revenue per passenger; LCC/hybrid "ancillary champions" are at $90–100/pax. Bags and seats remain the core; bundles/branded fares and co-brand are the next layers.
- A pricing engine should at minimum support ATPCO-style "adjusted" pricing (rule-based adjustments on filed fares) and expose a price-point API so continuous pricing (ML model output within min/max bands) can be plugged in later; log every offer with its context for WTP modelling and for regulatory transparency (the Delta backlash shows personalised pricing is a reputational risk).
- Model the data layer as Offers and Orders (one Order holding flights + ancillaries + payments + loyalty), not PNR + separate EMD-like records; this is the direction of the industry and of payment orchestration (CellPoint OSO).

### Gaps

- Could not open the IdeaWorks yearbook; per-passenger figures by carrier type (traditional vs LCC vs champs) and the 14.9% share are from a secondary source.
- No data retrieved on bag/seat pricing dynamics, bundle attach rates, or WTP model benchmarks (PROS/FLYR/Sabre/Amadeus AI pricing results); FLYR search results were polluted by the defunct Norwegian airline "Flyr".
- No verified 2025 count of airlines on ATPCO continuous pricing.

---

## 5. Revenue accounting and settlement (RA systems, proration, SIS/ICH, BSP/NewGen ISS, reconciliation)

### Takeaway

Industry settlement runs through IATA plumbing: SIS processed 1.94m interline/supplier invoices worth >$89bn in 2025 (+18%), the ICH cleared $66bn with 99.9999% settlement success, and BSP agency sales are governed by NewGen ISS (three accreditation tiers, Remittance Holding Capacity caps, IATA EasyPay). Passenger RA systems (Accelya REVERA/APEX proration, Hitit Crane RA, WNS SmartPro) handle sales capture, proration, flown-revenue recognition, interline billing, outdating (unused-ticket liability) and refunds; airlines increasingly add automated PSP reconciliation (Outpayce 2025) because card settlement reports do not match sales one-to-one.

### Cited Findings

- IATA SIS processed >1.94m interline and supplier invoices in 2025 (+18% vs 2024) with combined value >USD 89bn; 497 airline participants and 2,411 other entities — [IATA Financial Services fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-financial-services/)
- IATA Clearing House processed USD 66.01bn in billing transactions in 2025 with a 99.9999% settlement success rate; CNY added as 8th settlement currency — [IATA Financial Services fact sheet](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-financial-services/)
- BSP is IATA's system for settling ticket revenue between agents and carriers; SIS e-invoicing lists BSP as a use case for faster clearance via ICH/ACH — [IATA SIS webinar Jan 2025](https://www.iata.org/globalassets/iata/services/financial-services/sis/media/sis_webinar_01_2025_sis-integration-with-your-systems.pdf); [IATA SIS for airlines](https://www.iata.org/en/services/finance/sis/airlines/)
- IATA "Rejection Reduction Best Practices" for interline billing (reducing SIS rejections) — [IATA PDF](https://www.iata.org/contentassets/3c9d2e2266c74c77be3301f32aa0997e/rejection-reduction-best-practices.pdf)
- NewGen ISS: three accreditation models — GoStandard (cash sales allowed), GoLite (EasyPay/customer-card only), GoGlobal (multi-BSP); risk-based cash conditions — [IATA NGISS overview](https://www.iata.org/contentassets/aa1af9700ee94258b18a9b773c01b0e2/ngiss-overview.pdf); [PhocusWire](https://www.phocuswire.com/IATA-adopts-three-tier-agency-accreditation-and-a-threshold-for-cash-sales)
- Remittance Holding Capacity (RHC) = cap on outstanding BSP cash sales, computed from risk status, historical BSP cash turnover and remittance frequency; agents at cap may continue via EasyPay or customer card, or remit early — [Travel News SA](https://www.travelnews.co.za/article/newgen-iss-deadline-looms?page=1)
- IATA EasyPay is a voluntary pay-as-you-go e-wallet that lowers financial-security requirements and lets agents issue outside their RHC — [IATA NGISS overview](https://www.iata.org/contentassets/aa1af9700ee94258b18a9b773c01b0e2/ngiss-overview.pdf)
- BSP remittance frequency changes (monthly → weekly/fortnightly on NewGen rollout; market-specific) — [IATA: recent changes to BSP remittance rules](https://www.iata.org/contentassets/2e17a392af2549e688bf04aa8065a05b/recent-changes-to-bsp-remittance-rules.pdf); [Travel News SA](https://www.travelnews.co.za/article/newgen-iss-deadline-looms?page=1)
- Accelya Revenue Accounting covers Sales, Flown, Interline, Proration, Outdating and core accounting plus Memo, Refunds and Payments management — [Accelya](https://w3.accelya.com/products/accelya-revenue-accounting/)
- Accelya Proration (APEX) is used by 70+ airlines, is the engine behind ATPCO RASS, and claims >99% proration success; REVERA Interline is a standalone SOA interline product on APEX — [Accelya Proration](https://w3.accelya.com/products/accelya-proration/); [Accelya RA](https://w3.accelya.com/accelya-revenue-accounting)
- Hitit Crane RA: end-to-end passenger RA with automated proration engine, compliant with specified RET and HOT file versions — [Crane RA](https://crane.aero/solutions-services/accounting/revenue-accounting); [Hitit RA](https://hitit.com/solutions-and-services/accounting/revenue-accounting)
- WNS SmartPro: batch proration of TCN, e-ticket, BSP, ARC and direct-sales files; online handling of invalid/erroneous tickets — [WNS](https://www.wns.com/industries/travel-leisure/airlines/smartpro)
- Outpayce launched an automated reconciliation system (June 2025) matching sales to payments received — [Financial IT](https://financialit.net/node/65721)
- IATA offers Revenue Accounting & Control training (reference for RA process scope) — [IATA training](https://www.iata.org/en/training/pages/revenue-accounting-control/)

### Inferences

- A self-built RA layer needs, at minimum: (1) a sales ledger per coupon/ancillary with tax/fee breakdown; (2) a "flown" event that recognises revenue at coupon use (IFRS 15 point-in-time at flight), moving unflown coupons into an unearned-revenue liability; (3) an "outdating" job that releases expired/unused ticket liability as breakage per policy and jurisdiction; (4) refund/memo handling tied back to original coupons; (5) daily matching of Stripe balance transactions/payouts (and any local PSP) to bookings with an exceptions queue — the gap Outpayce productised in 2025.
- If the platform ever sells through IATA agencies, BSP/HOT-file ingestion and RHC-aware credit handling for agents become mandatory; the internal "agent credit" model should mirror RHC semantics (cap, remittance cycle, early remit, card fallback).
- Interline/proration is irrelevant for a single-carrier point-to-point platform but becomes a hard requirement if codeshare/interline is added — buy (Accelya/APEX) rather than build.

### Gaps

- No source retrieved on exact BSP settlement cycle lengths by region for 2025, HOT file structure, unused-ticket liability norms, or ATPCO/IATA TTBS tax engine (the TTBS search was not executed).
- IBS iFly RA and Mercator RAPID did not appear in results.
- IFRS 15 recognition-at-flight-date norms for tickets (as opposed to loyalty) were not separately sourced; the KPMG transport leaflet is pre-adoption (2015).

---

## 6. Corporate and agency distribution (NDC, TMCs, corporate booking tools, accreditation, groups, waitlists)

### Takeaway

NDC is now mainstream in leisure/OTA channels and accelerating in corporate: Air France-KLM's corporate NDC share went from 10% to 27% in 2025, BCD's NDC bookings via Accelya-connected airlines quadrupled, and Lufthansa Group is pushing toward an all-NDC future — but TMC NDC share still trails leisure by ~10 points (1 in 5 OTA bookings vs ~1 in 17 TMC bookings in 2024). Agency credit is governed by IATA NewGen ISS (RHC caps, EasyPay). Group-booking and waitlist/standby norms could not be researched before the search budget ran out.

### Cited Findings

- Accelya data: corporate NDC bookings jumped 168%; BCD Travel's growth rate in NDC bookings via Accelya-connected airlines quadrupled YoY — [Travolution](https://www.travolution.com/news/travel-sectors/corporate-travel/corporate-ndc-bookings-jump-168-finds-accelya-data/)
- Air France-KLM corporate-segment NDC adoption rose from 10% to 27% in 2025 — [Déplacements Pros](https://www.deplacementspros.com/transport/ndc-air-france-triple-son-taux-dadoption-en-un-an)
- Garner "Unlocking NDC" (Mar 2025): TMC NDC bookings trail leisure channels by 10 percentage points; in 2024 ~1 in 5 OTA bookings were NDC vs ~1 in 17 TMC bookings — [BTN Data Drop](https://www.businesstravelnews.com/BTN-Next/Data-Drop/2025-March)
- ARC TMC NDC Adoption Barometer tracks settled NDC transactions by agency type (leisure agencies 16% of settled NDC transactions in 2025) — [ARC](https://www2.arccorp.com/articles-trends/the-latest/tmc-ndc-adoption-barometer)
- Lufthansa Group reports clear uptick in corporate NDC adoption as more TMCs deploy compatible solutions — [Travel Weekly AU](https://travelweekly.com.au/lufthansa-closes-in-on-all-ndc-future-as-corporate-adoption-accelerates/)
- Traxo: non-TMC (direct/leakage) corporate airline bookings rose from 19% to 31% since January, attributed to NDC-driven direct booking — [Travolution](https://travolution.com/news/travel-sectors/air/ndc-adoption-drives-surge-in-direct-airline-bookings-says-traxo)
- Unverified vendor blog: NDC ~24% of indirect airline ticket sales globally as of Q1 2026 (vs 11% in 2023), attributed to IATA — [Travel Code](https://travel-code.com/az/news/ndc-corporate-travel-guide) (not found in IATA primary source)
- Agency accreditation and credit: NewGen ISS GoStandard/GoLite/GoGlobal; RHC caps; EasyPay wallet (see Section 5) — [IATA NGISS overview](https://www.iata.org/contentassets/aa1af9700ee94258b18a9b773c01b0e2/ngiss-overview.pdf)
- Accelya 2025 survey via Roland Berger: 72% of airlines recognise Offers & Orders importance; 27% have started — [Roland Berger](https://www.rolandberger.com/en/Insights/Publications/Airline-order-and-offer-management.html)

### Inferences

- An agent portal competing with market norms should expose an NDC-style API (AirShopping/OfferPrice/OrderCreate/OrderChange equivalents) so TMCs and OBTs can consume it, in addition to a web portal; direct corporate booking is growing (Traxo 19%→31%), so a corporate self-booking tool with policy, approval and central billing is a real channel.
- Agency credit should be modelled like IATA's RHC: a per-agency outstanding-cash cap with remittance cycle, auto-switch to card/wallet when at cap, and risk-tiered limits.

### Gaps

- Group-booking workflow norms (minimum group size, deposit %, name-list deadlines, materialisation rules), waitlist and standby practices, agency commission/net-fare/GDS-surcharge models, and corporate booking tool comparisons were not researched (search budget exhausted).
- No verified IATA-level global NDC share for TMCs.

---

## 7. Refunds and involuntary compensation (US DOT 2024 rule, EU261/UK261 reform, vouchers vs cash, care automation)

### Takeaway

Since 28 Oct 2024 US airlines must issue automatic refunds to the original form of payment within 7 business days (card) / 20 calendar days (other) for cancellations, significant changes and undelivered ancillaries, codified by the 2024 FAA Reauthorization Act. The EU261 reform reached political agreement in June 2026 (Parliament approval 7 July 2026, application expected late 2027): the 3-hour threshold and €250/400/600 amounts survive, with new airline duties to send claim documentation within 96 hours and stronger rerouting/care obligations; airlines argued automated compensation is unworkable for multi-leg/extraordinary cases. Care (hotel/meal) automation is spreading via vendor IROPS tools, but duty-of-care cases are still routinely handed to humans.

### Cited Findings

**US DOT**

- Final rule effective 28 Oct 2024: automatic refunds when a flight is cancelled or significantly changed and the passenger does not accept the alternative; refunds within 7 business days (credit card) or 20 calendar days (other methods); covers ancillary fees (seat, Wi-Fi) when not delivered — [One Mile at a Time](https://onemileatatime.com/news/dot-airline-ticket-refund-rules/); [TripIt](https://www.tripit.com/web/blog/travel-tips/DOT-new-rule-airlines); [ABC7](https://abc7.com/post/us-airlines-required-automatically-refund-significantly-changed-canceled-flight/15483534/)
- The FAA Reauthorization Act (signed 2024) codified the automatic refund rule into law — [Consumers' Checkbook](https://www.checkbook.org/national/consumers-notebook/articles/Here-Is-What-Airlines-Must-Do-If-Your-Flight-Is-Canceled-or-Delayed-7739) (single source; verify against statute)
- Legal summary of the two DOT consumer-protection rulemakings (refunds; ancillary fee transparency) — [Eckert Seamans](https://www.eckertseamans.com/?p=23721)
- Airlines for America stated it supports the automatic refund rule — [Washington Times](https://m.washingtontimes.com/news/2024/oct/29/transportation-department-requires-airlines-immedi/)

**EU261 reform**

- Council political agreement 5 June 2025: compensation claim forms to be automated; narrower grounds for denying reimbursement; more airline responsibility for rerouting and accommodation — [CAPA](https://centreforaviation.com/news/european-transport-ministers-reach-agreement-on-proposal-for-passenger-rights-reform-1320410); [Stephenson Harwood briefing, June 2025](https://www.stephensonharwood.com/media/l52lgfbi/final-version_airspeed-read-the-future-of-flight-disruption_-proposed-reforms-to-passenger-rights-june-2025.pdf)
- Analyses of the Council's (longer-threshold) approach: 60–70% of currently eligible passengers would have lost compensation rights — [Irish Times](https://www.irishtimes.com/business/2025/06/06/airline-passengers-face-longer-delay-times-before-compensation-kicks-in/)
- IATA argued extraordinary circumstances, multi-leg journeys and rebookings make blanket automation unworkable; industry warned reform could double costs — [IATA opinion](https://www.iata.org/en/pressroom/opinions/europe-cant-afford-the-european-parliaments-gold-plated-wish-list-for-eu261/); [Aviation24.be](https://www.aviation24.be/airlines/airline-industry-warns-eu261-reform-could-double-costs-and-threaten-airfare-affordability/)
- Political agreement between Parliament and Council reached ~12–15 June 2026; retains 3-hour delay threshold and €250–€600 distance-based amounts — [CAPA](https://centreforaviation.com/news/eu-reaches-agreement-on-eu261-passenger-rights-regulation-revisions-1362892); [Burges Salmon](https://www.burges-salmon.com/articles/102n2zj/eu261-reform-evolution-not-revolution); [CMS Law](https://cms.law/en/aut/legal-updates/new-european-regulation-on-air-passenger-rights-what-impact-for-the-air-transport-sector); [FIA Region I](https://www.fiaregion1.com/eu-agreement-on-air-passenger-rights-preserves-core-consumer-protections/); APRA view that reform "preserves framework but lacks meaningful change" — [CAPA](https://centreforaviation.com/news/apra-eu261-reform-preserves-framework-but-lacks-meaningful-change-1362959)
- Outlier: AeroMorning reported 4-hour (short-haul)/6-hour (long-haul) thresholds — conflicts with other sources — [AeroMorning](https://aeromorning.com/en/eu261-reform-a-compromise-with-no-winners-in-europe/)
- Claims-industry summaries: airlines must send passengers documents enabling a claim within 96 hours; claim window 9 months; Parliament approved 646–12 on 7 July 2026; rules expected to apply from late 2027 — [Flight-Delayed](https://www.flight-delayed.com/en/blog/2026/06/16/eu-passenger-rights-reform-2026); [SkyRefund](https://skyrefund.com/en/blog/eu261-reform-2026); [AirAdvisor](https://airadvisor.com/en/blog/new-eu261-rules) (secondary; verify against EP/Council releases)
- Hidden hand-baggage fee crackdown included in the June 2026 deal — [Freaking Nomads](https://freakingnomads.com/news/eu-reaches-air-passenger-rights-reform-deal-2026/)

**Care / IROPS automation**

- Sabre IROPS Reaccommodation markets lower rebooking and compensation costs (hotels, ground transport, meal vouchers); Aerolíneas Argentinas cited as user — [Sabre](https://sabre.com/?p=20192)
- IGT case study: conversational rebooking for an East Asian LCC cut call volumes 20–30% during IROPs (vendor) — [IGT Solutions PDF](https://www.igtsolutions.com/wp-content/uploads/2025/09/CaseStudy_RebookingAutomation.pdf)
- American Airlines' gen-AI rebooking tool reportedly helped >200,000 travellers during East Coast storms (Aug 2025, secondary via OAG) — [ePlaneAI](https://www.eplaneai.com/news/airlines-introduce-ai-rebooking-systems-to-cut-call-center-wait-times-in-2026)
- Practitioner guidance: automate structured rebooking; hand off multi-carrier/interline itineraries and any duty-of-care (overnight hotel) case to humans — [Dreamix](https://dreamix.eu/insights/irops-without-chaos-resilient-airline-ops/)
- Switchfly: automated re-accommodation with ~500k-property hotel inventory (vendor) — [Switchfly](https://switchfly.com/blog/disrupting-travel-disruptions-and-helping-stranded-passengers)

### Inferences

- Design the refund engine around "original form of payment within statutory SLA": card refunds via Stripe within 7 business days (US) — EU Art. 8 is 7 days (not re-verified here); vouchers/credits may only substitute for cash with explicit passenger consent (US rule; EU reform narrows denial grounds). Internal wallet/credit must therefore be opt-in, never the default refund path for involuntary cases.
- Build a rules engine keyed on jurisdiction (departure/arrival country, carrier nationality), disruption type, delay hours, distance band, and cause (extraordinary vs controllable) that outputs: refund due Y/N, compensation amount, care entitlements (meals after X hours, hotel if overnight), rerouting options; log the 96-hour notification obligation for EU flights from 2027.
- Treat refund SLA breaches as a KPI (days-to-refund, % auto-refunded without claim) since US DOT and the EU reform both penalise slow/manual processing.

### Gaps

- EU261 Article 8 (7-day refund) and voucher-consent text, UK261 post-Brexit divergence, Canada APPR and GCC/Saudi GACA passenger-rights rules were not sourced (search budget exhausted; GACA not researched).
- No production examples with hard numbers of airlines auto-paying EU261 compensation without a claim.
- The 96-hour/9-month figures and 7 July 2026 vote come from claims-industry sites, not EP/Council releases.

---

## 8. Consolidated benchmark table (for the report writer)

| Metric                                          | Value                                                                  | Date             | Source                                                                                                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global ancillary revenue                        | $148.4bn                                                               | 2024             | [IdeaWorks PR 197](https://ideaworkscompany.com/wp-content/uploads/2025/11/Press-Release-197-Global-Estimate-2025.pdf)                                                                                                      |
| Ancillary share of revenue                      | ~14.9% (secondary)                                                     | 2024             | [DWU](https://dwuconsulting.com/dwu-ai/airline-ancillary-revenue)                                                                                                                                                           |
| Ancillary growth vs total revenue (58 airlines) | +13.4% vs +7.2%                                                        | 2025             | [IdeaWorks 2026](https://ideaworkscompany.com/2026-seatmaps-com-yearbook-of-ancillary-revenue-by-ideaworkscompany-report/)                                                                                                  |
| Top ancillary per pax                           | Norse $100.40; Jet2 $89.99; Breeze $89.82 (secondary)                  | 2024             | [DWU](https://dwuconsulting.com/dwu-ai/airline-ancillary-revenue)                                                                                                                                                           |
| Travel chargeback rate benchmark                | ~0.89%                                                                 | 2025             | [Clearly Payments](https://www.clearlypayments.com/blog/chargeback-rate-by-industry-and-business-type/)                                                                                                                     |
| Visa VAMP excessive threshold                   | 2.2% → 1.5% from 1 Apr 2026                                            | 2025–26          | [Chargeback Gurus](https://www.chargebackgurus.com/blog/visa-announces-even-more-vamp-changes)                                                                                                                              |
| Travel chargebacks that are fraud (Mastercard)  | 46%; avg $120                                                          | 2025             | [Mastercard](https://b2b.mastercard.com/news-and-insights/blog/what-s-the-true-cost-of-a-chargeback-in-2025)                                                                                                                |
| Airline non-fraud vs fraud CB ($)               | non-fraud ~1.5x fraud; fraud ~60% by count                             | Jul 2025         | [Forter](https://www.forter.com/?p=16326)                                                                                                                                                                                   |
| Last-minute booking risk                        | 2.3x                                                                   | 2025             | [Riskified](https://www.riskified.com/lp/travel-risk-rundown/view/)                                                                                                                                                         |
| Network-token auth uplift                       | Visa ~4.6%; MC ~2.1%; Adyen avg 3%                                     | 2023–25          | [Solidgate](https://solidgate.com/blog/network-tokenization-authorization-rates/); [Adyen](https://www.adyen.com/en_AU/press-and-media/adyen-has-issued-over-two-billion-active-network-tokens)                             |
| IATA Pay reach / cost                           | 36+ countries, 60+ airlines; up to 99% cheaper than cards; T+1         | 2025             | [IATA](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-payment-services/)                                                                                                                     |
| Airline declines from insufficient funds        | >40%                                                                   | 2025             | [Hands In podcast](https://www.buzzsprout.com/2604709/episodes/18974154-ep-2-how-hands-in-drives-revenue-growth-for-airlines-through-split-payments-with-garth-lund-and-sam-flynn)                                          |
| Split-pay conversion (Air Europa)               | 87.8%; >€1.6m incremental                                              | 2025             | [FF News](https://ffnews.com/newsarticle/exclusive-skys-the-limit-yago-casasnovas-air-europa-in-the-paytech-magazine/)                                                                                                      |
| mada e-commerce                                 | SR197.4bn, 1.13bn txns, +26%/+29%                                      | 2024             | [Arab News](https://www.arabnews.com/node/2589350/business-economy)                                                                                                                                                         |
| KSA e-payments share of retail                  | 79%                                                                    | 2024             | [Arab News](https://www.arabnews.pk/node/2597120)                                                                                                                                                                           |
| Delta Amex remuneration                         | $8.2bn (+11%), ~14% of revenue                                         | 2025             | [Delta FY2025](https://quantisnow.com/insight/delta-air-lines-announces-december-quarter-and-full-year-2025-6347232)                                                                                                        |
| Loyalty programme valuations                    | SkyMiles $31bn; AAdvantage $26.7bn; MileagePlus $25.3bn; Avios $10.3bn | Mar 2026         | [On Point Loyalty via PRN](https://tools.prnewswire.com/en-us/live/20823/release/20260330EN22071)                                                                                                                           |
| Loyalty ATO growth (travel)                     | >50% YoY                                                               | 2024             | [Mastercard/Ravelin](https://www.mastercard.com/us/en/news-and-trends/Insights/2024/fighting-loyalty-fraud-essential.html)                                                                                                  |
| Miles expiry norm                               | 24 months inactivity (AA, AlFursan)                                    | 2024–25          | [SEC AA](https://www.sec.gov/Archives/edgar/data/4515/000000620124000048/R50.htm); [Saudia](https://prod.dcloud.saudia.com/pages/loyalty-program/about-alfursan-program/faqs-terms-and-conditions/expiry-policy)            |
| SIS volume                                      | 1.94m invoices, >$89bn, 497 airlines                                   | 2025             | [IATA](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-financial-services/)                                                                                                                   |
| ICH clearing                                    | $66.01bn; 99.9999% success                                             | 2025             | [IATA](https://www.iata.org/en/iata-repository/pressroom/fact-sheets/fact-sheet-iata-financial-services/)                                                                                                                   |
| Corporate NDC share (AF-KLM)                    | 10% → 27%                                                              | 2025             | [Déplacements Pros](https://www.deplacementspros.com/transport/ndc-air-france-triple-son-taux-dadoption-en-un-an)                                                                                                           |
| NDC share OTA vs TMC                            | ~1 in 5 vs ~1 in 17                                                    | 2024             | [BTN/Garner](https://www.businesstravelnews.com/BTN-Next/Data-Drop/2025-March)                                                                                                                                              |
| US refund SLA                                   | 7 business days (card) / 20 calendar days (other)                      | from 28 Oct 2024 | [OMAAT](https://onemileatatime.com/news/dot-airline-ticket-refund-rules/)                                                                                                                                                   |
| EU261 reform                                    | 3h threshold, €250–600 kept; docs within 96h; apply ~late 2027         | Jun–Jul 2026     | [CAPA](https://centreforaviation.com/news/eu-reaches-agreement-on-eu261-passenger-rights-regulation-revisions-1362892); [Flight-Delayed](https://www.flight-delayed.com/en/blog/2026/06/16/eu-passenger-rights-reform-2026) |
| Delta AI pricing coverage                       | 1% (Nov 2024) → 3% (Jul 2025) → 20% target (end-2025)                  | 2025             | [AirlineGeeks](https://airlinegeeks.com/2025/07/16/delta-expanding-use-of-ai-to-set-ticket-prices/)                                                                                                                         |
| Airlines with ATPCO optimized pricing           | 30+                                                                    | 2024–25          | [Travel Market Report](https://www.travelmarketreport.com/articles/Airline-Dynamic-Pricing-Getting-Closer-to-Reality-Says-ATPCO)                                                                                            |
| O&O readiness (Accelya)                         | 72% see importance; 27% started                                        | 2025             | [Roland Berger](https://www.rolandberger.com/en/Insights/Publications/Airline-order-and-offer-management.html)                                                                                                              |
