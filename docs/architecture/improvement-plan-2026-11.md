# AIS improvement plan, November 2026

Purpose: strengthen the product by measuring it against one end-to-end airline
journey, naming the weaknesses and missing scenarios the measurement exposes,
planning the modules that are absent, and giving each open external gap a
concrete closing path. Written against `main@6889760` (v1.39.3) on
2026-11-11 from a read-only sweep of the test, acceptance and script suites.

Three levels are kept apart throughout, as in every AIS acceptance record:
**documented** (a feature is described), **implemented** (code and automated
evidence exist on the current source) and **accepted** (an external party,
device or operator has confirmed it). Only the third closes a gap. Passing CI,
the count of modules or screens, and the 171 staging checks do not by
themselves prove that AIS can run an airline.

Earlier plans remain as history: [competitive roadmap](../COMPETITIVE_ANALYSIS_ROADMAP.md)
(February 2026 scores), [SaaS gap analysis](../AIRLINE_SAAS_GAP_ANALYSIS.md)
(October 2026 tenancy model), [improvements plan](../improvements/IMPROVEMENTS_PLAN.md)
(September 2026). Where they disagree with this document, this document is
current; it supersedes their roadmaps but not their recorded decisions.

## 1. Journey benchmark: evidence and gaps per stage

The benchmark is the sixteen-stage journey from the November research
comparison, extended with platform stages. "Evidence" names existing
automated cases (exact test or case names); "Gap" is a scenario that no
automated evidence covers today. Priority: P0 blocks operation or money, P1
blocks a credible airline acceptance, P2 improves confidence.

| #   | Stage                      | Strongest existing evidence                                                                                                                                                                                                                          | Verified gap                                                                                                                                                                                                                                  | Pri |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 1   | Flight creation            | `operations-inventory-mysql.test.ts` "allows exactly one competing allocation to hold the last physical seat"; `rbd-inventory.test.ts` "exposes the flight bucket net of active holds and rejects an oversell"                                       | **No schedule exists.** `admin.createFlight` creates one dated flight; there is no season schedule, operating days, equipment or SSIM import, and no test that a created flight's availability equals capacity or that a duplicate is refused | P1  |
| 2   | Price quote                | `retail-offer.test.ts` "preserves the quoted fare and consumes it with the durable receipt"; `fare-rules-acceptance-mysql.test.ts` "makes availability and comparison agree with actual rounded quotes…"                                             | Two bookings spending the same offer concurrently on native MySQL; an offer expiring between lock and payment; display `get` total vs `createOffer` total for identical inputs                                                                | P0  |
| 3   | Last-seat booking          | `verify-transaction-boundaries.ts` "the last seat cannot be held twice", "last-seat contention preserves both collections and one reservation"; `inventory-hold-concurrency.ts`                                                                      | More than two contenders; a multi-segment itinerary losing the last seat on its second leg; a hold expiring at the moment another buyer takes the seat; contention through the real HTTP path                                                 | P1  |
| 4   | Payment                    | `stripe-redelivery-dedupe.test.ts` "settles once for the same event id…"; `stripe-paid-webhook-mysql.test.ts` "deduplicates an actual concurrent paid event insert…"; `payment-settlement-boundary.test.ts` "refunds a duplicate collection…"        | Webhook racing the reconciliation job on the same payment intent on native MySQL; lost checkout or charge response only mocked; hosted Checkout completion and real webhook delivery remain provider-sandbox work (see provider acceptance)   | P0  |
| 5   | Ticket issuance            | `ticket-coupons.test.ts` "issues local coupons in itinerary order… replays without duplicates"; `booking-confirmation-mysql.test.ts` "replays an identical provider request after acceptance is lost without a second email or ticket issue"         | Two concurrent first reads of the same passenger's ticket on native MySQL (duplicate number or coupon); ticket not linked to a payment record; refund or chargeback after issuance does not void coupons under test                           | P0  |
| 6   | Ancillaries                | `scoped-ancillary-sale.ts`; `baggage-entitlement.test.ts` "isolates passenger and segment scopes"; `seat-exchange.test.ts` "preserves a funded fee through a same-seat exchange…"                                                                    | EMD lifecycle never exercised (only refusals); refunding one seat or bag while keeping the flight goes to manual review, no positive path                                                                                                     | P1  |
| 7   | Exchange / reissue         | `exchange-journey-acceptance.test.ts` "(i) coupon lifecycle across the exchange and the accountant's trace"; `paid-sector-exchange.ts`; `ticket-revalidation-acceptance-mysql.test.ts`                                                               | **Tax difference is not modelled**: only fare difference; fare down with tax up (and the reverse); refund of unused taxes; partner-issued amendments only refused                                                                             | P0  |
| 8   | Refund                     | `ordinary-refund-mysql.test.ts` "completes delayed partial success once despite reordered and duplicate events"; `split-refunds.ts` "concurrent refund webhooks conserve payer amounts…"; `internal-refund-boundary.test.ts` rejects wrong currency  | No positive path for a booking paid partly by card and partly by wallet or credit (only refused); partial refund for one passenger on a split-paid booking                                                                                    | P1  |
| 9   | Disruption / IROPS         | `r2-reaccommodation.ts` "the advisory seats real passengers on real availability"; `reaccommodation-boundary.test.ts` "names everyone it cannot seat instead of dropping them"; `compensation.service.test.ts`                                       | Reaccommodation is advisory only: nothing moves a passenger after cancellation carrying seat, bag entitlement, coupon and compensation; a move is refused when paid extras exist; EU261 distance tiers not computed under test; no interline  | P1  |
| 10  | Vouchers, credits, loyalty | `loyalty-allocation-lifecycle.test.ts` "offsets the original allocation exactly once on fully funded refund…"; `booking-checkout-boundary.test.ts` "replays the discount once and freezes it for checkout"                                           | Refund and exchange services never touch vouchers: no reversal of a voucher or its use count on cancellation, no split of a voucher discount on partial refund; miles claw-back after cash refund untested; bookings paid partly with miles   | P1  |
| 11  | Check-in and APIS          | `dcs-operations.test.ts` "opening the gate cannot override %s eligibility"; `apis-seats-acceptance-mysql.test.ts` "refuses actual authority submission and leaves no submitted state"; `apis-paxlst.test.ts`                                         | APIS stops at a local draft (authority transport is external); no international check-in against a real document or visa verdict on MySQL; check-in opening too early untested                                                                | P1  |
| 12  | Bag tag and custody        | `baggage-custody.test.ts` "follows acceptance, loading, arrival and transfer across all itinerary legs"; `kiosk-baggage-reprint.test.ts`; `kiosk-printer.ts` manual label/scan                                                                       | No printer acknowledgement exists by design; the independent scan result of `kiosk-printer.ts` is recorded nowhere in the system; tracking points fed by service calls, not scanner or baggage messages                                       | P1  |
| 13  | Boarding and deplaning     | `dcs-operations.test.ts` "validates JWT and BCBP against the exact row and revokes stale seat nonces"; `bcbp-scan-admission.test.ts`; `apis-seats-acceptance-mysql.test.ts` "refuses a stale boarding sequence after a concurrent undo…"             | **No gate boarding-read endpoint**: boarding is a staff action, the only BCBP scan admission is at bag drop; two readers scanning one pass at once, wrong gate, and gate read feeding boarding are untested                                   | P0  |
| 14  | Station devices            | `simulation-boundaries.test.ts` "rejects $name before reading or changing state"; `handler-station-fixture-boundary.test.ts`; `hardening-journeys.spec.ts` "kiosk API has no registered devices…"                                                    | No test calls `registerDevice` or a heartbeat; scale weight is caller-supplied; biometric and load planning production-gated with no browser evidence                                                                                         | P2  |
| 15  | Post-flight and accounting | `coupon-month-close.ts` COUPON-CLOSE-01; `monthly-financial-mysql.test.ts`; `bsp-settlement-service.test.ts` "matches ledger, RET, HOT and bank credit per document and blocks until dispositioned"                                                  | Re-closing an already closed period; late HOT or bank correction after close; breakage never posted to the liability ledger (policy-only); RET transmission gate closed, no link specification                                                | P1  |
| 16  | Recovery                   | Production Gates "Restore the deployment backup on an isolated MySQL server", "Verify original data survived the upgrade"; `backup-restore-smoke.py` "corrupt backup is rejected before writing any target tables"                                   | Disaster recovery and multi-region are demo-only (`requireDemoCapability`, in-memory); no failover, RTO/RPO, point-in-time recovery or migration down path is exercised                                                                       | P1  |
| 17  | Exit and data ownership    | `audit-gap-closure.ts` "F06/F07: concurrent export workers publish one owner-only artifact containing every booking"; `vrs-report-exports.spec.ts` tenant isolation of CSV, Excel and PDF                                                            | **No whole-tenant exit export**; no export includes tickets, coupons, ledger entries or audit logs; no totals reconciliation                                                                                                                  | P1  |
| 18  | Tenancy and authorization  | `tenant-rate-boundary.test.ts` "scopes airline booking reads and rejects absent tenant context before DB access"; `role-authority-boundary.test.ts` "matches the real procedure gates for %s"; `test_all_auth_routes_require_the_service_credential` | No router-wide audit of protection level (96 router files, 152 `publicProcedure` uses); cross-tenant tests cover selected routers; no test that every privileged mutation writes an audit log                                                 | P0  |
| 19  | Observability and SLA      | `health-readiness.test.ts` "keeps readiness fail-closed…"; `runtime-contract.test.ts` "returns HTTP 503 on dependency failure and 200 after recovery"; `analytics-evidence.test.ts` "never synthesizes uptime"                                       | `sla-monitoring.service.ts` has no direct tests and loses alerts on restart; no alert rules; nothing proves a breached threshold reaches on-call                                                                                              | P2  |

## 2. Weaknesses the benchmark exposes

1. **Money paths are tested for single and paired contention, not for the
   shapes a sale actually takes.** Offer double-spend, ticket double-issue
   and webhook-versus-reconciliation races lack native MySQL cases.
2. **Taxes are a display estimate.** Exchange and refund logic reason about
   fare and total only; a real reissue needs tax lines with their own refund
   rules.
3. **The airport day ends at the counter.** Boarding has no gate read; APIS
   and printers stop at local artefacts; the manual printer check leaves no
   system record.
4. **Recovery is a story, not a drill.** Backup and restore are gated and
   tested; failover, RTO and point-in-time recovery are not exercised.
5. **The tenant cannot leave with its data.** Exports are per user or per
   report; tickets, coupons, ledger and audit are in none of them.
6. **Authorization is proven by sample, not by sweep.** Protection levels
   and audit writes are checked for chosen routers only.
7. **Commercial planning is absent.** Flights are keyed in one by one; there
   is no schedule, season or equipment model, which also blocks several
   catalog reports.
8. **Reporting is blocked by one missing entity.** About ten partial or
   blocked reports share the same cause: no authoritative sales or issuing
   office; six more need accepted GDS receipts, three interline evidence.
9. **Governance has owners by role only.** All five service-ownership
   domains have null owner, on-call and acceptance evidence; the ledger's two
   partial rows and the multi-currency plan wait on named people.

## 3. Modules to plan

Ranked by how many stages and reports each unblocks. Each needs the usual
AIS record: scope, owner role, acceptance matrix, native tests, then
documentation. None is authorised for code by this plan.

| Rank | Module                             | Unblocks                                                                                            | Shape                                                                                                                                                  |
| ---- | ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Season schedule to dated flights   | Stage 1; reports on flight groups and configuration; realistic inventory fixtures                   | Schedule (carrier, number, route, operating days, period, equipment, cabin config) → generated dated flights with RBD buckets; change propagation      |
| 2    | Sales and issuing office entity    | About ten catalog reports (agent details, offices, remittances, sales by office, refunds by office) | Tenant-owned office with immutable attribution on sale and issue events; credit account optional later                                                 |
| 3    | Gate boarding read                 | Stage 13                                                                                            | Scanned BCBP or QR read at a named gate feeding the boarding state machine; duplicate and wrong-gate refusal; two-reader race on one pass              |
| 4    | Tenant exit export                 | Stage 17; evaluation gate "data ownership"                                                          | One authenticated job producing bookings, passengers, tickets and coupons, ledger, payments and audit with totals that reconcile to the ledger         |
| 5    | Tax lines on exchange and refund   | Stage 7 and 8; revenue accounting correctness                                                       | Per-segment tax components on the quote, carried through reissue, with refundable and non-refundable classes                                           |
| 6    | Executed reaccommodation           | Stage 9                                                                                             | From advisory to transaction: move passenger, seat, entitlement, coupon and compensation record; refuse or route extras explicitly instead of blocking |
| 7    | Voucher and miles reversal         | Stage 10                                                                                            | Reversal rules on cancellation, partial refund and exchange; claw-back through the event inbox                                                         |
| 8    | Mixed-funding refunds              | Stage 8                                                                                             | Positive path for card plus wallet or credit, per payer and per instrument                                                                             |
| 9    | Ticketing time limits and queues   | Catalog reports 50 and 65                                                                           | Commercial time limit distinct from inventory hold expiry; reservation queue membership                                                                |
| 10   | Alerting rules and durable SLA     | Stage 19                                                                                            | Persisted observations and alert state; rule set checked in; on-call delivery proven, not described                                                    |
| 11   | Multi-currency (approved priority) | Decision D6; see [multi-currency-scope.md](multi-currency-scope.md)                                 | Waves 1 to 3 of that record; nothing here changes its gates                                                                                            |

## 4. Scenario backlog

Each scenario is a professional acceptance case to add to the native MySQL
suites or acceptance scripts. "Internal" means it needs no external party and
can be implemented now; "External" needs a provider, device or authority.

| ID   | Scenario                                                                                     | Assertion                                                                                              | Kind     | Pri |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- | --- |
| S-01 | Two bookings consume the same retail offer concurrently on native MySQL                      | Exactly one durable receipt; the loser gets a refusal; inventory unchanged for the loser               | Internal | P0  |
| S-02 | Offer expires between lock and payment                                                       | Payment refused or re-quoted; no collection against an expired quote                                   | Internal | P0  |
| S-03 | Display quote equals purchasable offer for identical inputs                                  | `priceQuote.get` total equals `createOffer` total, taxes included                                      | Internal | P1  |
| S-04 | Three or more contenders for the last seat, including a multi-segment itinerary              | One winner; the multi-segment loser holds nothing on either leg                                        | Internal | P1  |
| S-05 | Hold expiry concurrent with a new buyer                                                      | Seat sold once; expired hold releases exactly once                                                     | Internal | P1  |
| S-06 | Paid webhook races the reconciliation job on one payment intent                              | One settlement, one ledger entry, idempotent second writer                                             | Internal | P0  |
| S-07 | Two concurrent first reads of a passenger's ticket                                           | One ticket number, one coupon set                                                                      | Internal | P0  |
| S-08 | Refund or chargeback after issuance                                                          | Coupons voided or flagged; document state consistent with ledger                                       | Internal | P0  |
| S-09 | Exchange with fare down and tax up, and the reverse                                          | Tax lines carried; refundable tax returned to the original payer; non-refundable retained and reported | Internal | P0  |
| S-10 | Partial refund of one seat or bag keeping the flight                                         | Entitlement reduced; fee rules applied; one ledger delta                                               | Internal | P1  |
| S-11 | Cancellation of a voucher-discounted booking                                                 | Voucher use reversed per policy; discount split on partial refund                                      | Internal | P1  |
| S-12 | Miles claw-back after a cash refund through the inbox                                        | Liability ledger offsets once; replay is idempotent                                                    | Internal | P1  |
| S-13 | Executed reaccommodation carrying seat, entitlement, coupon and compensation                 | New flight holds the passenger; old coupon exchanged; compensation record preserved                    | Internal | P1  |
| S-14 | Check-in opens too early and closes on time                                                  | Both edges refused or accepted per policy on MySQL                                                     | Internal | P1  |
| S-15 | Gate read: duplicate pass at two readers, wrong gate, revoked check-in                       | One boarding; refusals carry reasons; no state change on refusal                                       | Internal | P0  |
| S-16 | Printer field check result recorded                                                          | `kiosk-printer.ts` writes a value-free receipt (asset ids, times, match result) attachable to #279     | Internal | P1  |
| S-17 | Re-close of a closed month; late HOT correction                                              | Second close refused or produces an adjustment period; correction posts an adjustment, never a rewrite | Internal | P1  |
| S-18 | Breakage posted to the liability ledger                                                      | Policy result becomes a ledger entry with period and reversal path                                     | Internal | P1  |
| S-19 | Tenant exit export reconciles to the ledger                                                  | Exported totals equal ledger totals; other tenants absent; audit rows included                         | Internal | P1  |
| S-20 | Router sweep: every procedure's protection level and tenant scope                            | Generated inventory compared to an approved allowlist; a new public procedure fails the test           | Internal | P0  |
| S-21 | Every privileged mutation writes an audit log                                                | Sweep over admin and finance procedures on MySQL                                                       | Internal | P0  |
| S-22 | Restore drill with measured RTO and RPO; migration down path                                 | Observed numbers recorded in the operations docs; no demo flag                                         | External | P1  |
| S-23 | SLA breach reaches on-call                                                                   | Durable alert state; delivery receipt from the configured channel                                      | External | P2  |
| S-24 | APIS acknowledgement and rejection from the authority                                        | Fixtures from the authority; transport accepted                                                        | External | P1  |
| S-25 | Hosted Checkout completion, 3DS, signed webhook delivery, chargeback in the provider sandbox | Per [provider acceptance](../operations/provider-acceptance.md)                                        | External | P0  |
| S-26 | Device registration and heartbeat; scale, printer and scanner acknowledgements               | Authenticated device events correlated to AIS requests                                                 | External | P1  |

## 5. Closing paths for the open external gaps

These gaps need a person or a party outside the repository. The plan reduces
the friction to the minimum that still keeps the evidence honest.

**Operator attestation (#103).** The template in
[staging-secret-attestation.md](../operations/staging-secret-attestation.md)
has seven value-free checks. Next action: a read-only verification script the
operator runs inside the Railway environment that prints only booleans and
lengths (same-value pairing by in-memory comparison, length and character
class of the token, `DEBUG` effective value, absence of the November-2
variable names), never a value, hash or reference. The operator pastes that
output into the template with name, role and time. Checks 6 and 7 are already
produced by `ais-acceptance` and the auth log. The issue closes on the filed
attestation, not on the script.

**Hardware acceptance (UI-07 on #279).** The field procedure and
`scripts/acceptance/kiosk-printer.ts` exist; what is missing is the receipt
(S-16) and a named station. Next action: add the `record` output to the
script, then one station visit by airport operations or the DCS provider with
the Honeywell procedure. The ledger row moves on the receipt.

**Report sources (CAP-01 and #280).** Classify the 99 `product_scope` values
first (decision 3). Then attack the shared causes rather than the rows: the
sales and issuing office entity (module 2) unblocks about ten reports at once;
GDS receipts (six reports) and interline evidence (three) remain external
until a contracted provider exists. Keep availability at 36/35/28 until each
acceptance passes.

**Finance decisions (G1, G3, G4 on #319).** The proposals are written in
[multi-currency-scope.md](multi-currency-scope.md), section 6. Next action: a
single decision session with the finance officer and product owner that
records approve or amend per row, names the people for the roles in that
record's section 4, and states the YER reference-rate policy. ADR 0002 is
adopted or amended in the same session.

**Ownership.** Fill `docs/architecture/service-ownership.json` for the five
domains; `generate-service-catalog.ts --check` verifies the catalog, and the
production rollout refuses to start without assignments.

## 6. What to borrow from the references, and how

From the November research comparison (Openfront Airline under MIT; Videcom,
Hitit, Navitaire, Amadeus, IBS, Radixx, amelia from vendor documentation):

- **Openfront**: separation of booking state, payment state and ticket
  issuance; one ticket per passenger and one coupon per segment (AIS already
  has this); station-bound permissions; manual payment recorded by one user
  and approved by another. Borrow the approval split for internal funding and
  manual payments. Verify in isolation first: its deployment docs and current
  tree disagree (worker command, outbox migration), so nothing is copied
  without running it.
- **Videcom**: the direct functional yardstick for reservations, distribution
  and DCS screens; use it to review the staff desk and the check-in flow.
- **Hitit Crane**: the map of a whole airline (PSS, DCS, weight and balance,
  operations and crew, revenue and cost accounting, cargo); use it to draw the
  boundary of what AIS owns versus integrates.
- **Navitaire and IBS iFly**: ancillary-first selling and Offers and Orders;
  use them to shape module 5 (tax lines) and the order record of truth already
  proposed in ADR 0001.
- **NetLine, Lido, AMOS**: integration targets, not features to rebuild, if
  operations and maintenance enter scope.

Standards that gate claims: IATA NDC and ONE Order (a table named `orders` or
an XML endpoint proves neither), IATA baggage tracking (four points, exchanged
with partners), airport and DCS device specifications, APIS authority
specifications, and the payment-gateway and bank contracts per currency.

## 7. Evaluation gates

Weights from the research comparison, used to rank waves, never to pass a
reject gate:

| Axis                                            | Weight |
| ----------------------------------------------- | ------ |
| End-to-end journey and transaction correctness  | 25%    |
| Integration and acceptance by parties and sites | 20%    |
| Security, isolation and audit                   | 15%    |
| Reliability, recovery and operations            | 15%    |
| Customisation, data ownership and exit          | 10%    |
| Five-year total cost                            | 10%    |
| Staff and passenger experience, Arabic          | 5%     |

Reject gates, independent of any score: loss of money, oversell, cross-tenant
data exposure, or a mandatory integration without acceptance.

## 8. Execution order

1. **Wave A, money and authorization (internal, now).** S-01, S-02, S-06,
   S-07, S-08, S-20, S-21. Pure test work on the current source; each lands as
   its own PR with native MySQL evidence. Any failure found becomes a fix PR
   with the test that caught it.
2. **Wave B, airport day and servicing (internal).** S-15 with module 3,
   S-09 with module 5, S-10 to S-14, S-16. Module 3 and module 5 need a scope
   record first.
3. **Wave C, planning, reporting and exit (internal).** Module 1, module 2,
   module 4 with S-19, S-17, S-18, S-03 to S-05.
4. **Wave D, external (owners and parties).** Attestation, printer receipt,
   restore drill (S-22), provider sandbox (S-25), APIS fixtures (S-24), device
   acknowledgements (S-26), finance decisions and ownership.

Waves A to C do not wait for wave D; wave D does not wait for code. Every
scenario that lands is recorded by its test name in the acceptance ledger with
the CI run that executed it, and nothing is promoted on a green CI alone.
