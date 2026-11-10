# Hitit as an engineering reference for AIS (10 November 2026)

Applied reading of Hitit's public material (Crane PAX, ALM, SP, DCS, RA, OCC;
Oxygen for offers and orders; Elektrum for payment orchestration; the Pegasus
case study; IATA ARM) against the AIS state measured in the
[improvement plan](../architecture/improvement-plan-2026-11.md) and the review
backlog (#333). Vendor pages prove that a capability is described and its
conceptual scope; they prove nothing about its implementation quality or its
activation at any customer, and nothing here is a performance or security
comparison. AIS reference: `main@6889760` for the review findings, later
commits for the plan.

The decision this study supports: AIS's priority is the integrity of passenger,
segment, money and fulfilment identity first, then scheduling and sales
offices, then orders and partners. New modules built on inconsistent data
multiply defects instead of removing them.

## 1. Component comparison and the decision it drives

| Domain                      | What Hitit describes                                          | AIS baseline (review evidence)                                                                          | Improvement decision                                                                                                   | Pri     |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------- |
| Reservations, pricing (PAX) | Sales channels; internal pricing or ATPCO/TTBS sources        | PRC-01: fare lines bound by index after a reordered passenger list                                      | Bind price components to passenger and segment identity; snapshot taxes and policy at sale; external fare source later | P0      |
| Distribution (NDC)          | Oxygen puts offers and orders at the centre of channels       | DIST-01 outbound-only offer echoing `returnDate`; DIST-02 one stale flight fails the day's search       | Explicit round-trip contract and itinerary tests before widening channels                                              | P0      |
| Allotments (ALM)            | Allotted inventory, contracts, invoicing                      | Group inventory locks exist; a base, not a gap                                                          | Add allotment contract, release date, credit ceiling, settlement; never a second inventory                             | P1      |
| Scheduling (SP)             | Schedule versions, feasibility against aircraft and stations  | No season schedule; flights created one by one                                                          | Season template, exceptions, draft/approved/published versions, retryable diff publication                             | P1      |
| Disruptions (OCC)           | Connection analysis, operational data, departure updates      | IROPS-01 connections matched by purchaser, not passenger and segment; bounded recovery execution exists | Fix passenger identity first; impact per segment, service and money; keep reissue state visible                        | P0 → P2 |
| Airport (DCS)               | Check-in, ancillaries, airport integrations and devices       | Device and signing capabilities exist; DCS-01 separates status write from history                       | One transaction for status and audit; device and version matrix; disconnect and duplicate tests                        | P0/P1   |
| Accounting (RA)             | Coupons, taxes, allocation, settlements, GL                   | BSP-01 scope bypass on explicit ids; SVC-01 revenue on first flight only                                | Pin currency, period, country and segment scope before widening reports                                                | P0      |
| Offers and orders (Oxygen)  | Modular, coexisting with PSS; product, fulfilment, settlement | NDC names and order JSON do not prove an OrderItem lifecycle; ADR 0001 incomplete                       | Gradual bridge: stable identifiers and shadow reconciliation, then one channel; one source of truth per field          | P1/P2   |
| Payments (Elektrum)         | Orchestration across institutions, banks, providers           | Wallet has settlement controls; refund notifications and statistics need correction (FIN-01..03)        | Payment-attempt ledger with explicit `unknown`; no fallback charge before the first is settled; refund to original     | P0 → P2 |
| Partners, non-air services  | Pegasus case: phased add-ons from external suppliers          | No complete external supplier cycle proven; local ancillaries with financial controls                   | One supplier, one cancellation contract, inventory, hold and proven compensation; no open marketplace first            | P2      |
| Intelligence                | Personalisation claims prove no decision safety               | AI-01 cache ignores scope; AI-02 disable does not stop agents                                           | Fix isolation and the kill switch; explainable suggestions with policy version; shadow pricing first                   | P0/P2   |
| Data and continuity         | Security and continuity disclosures without test receipts     | Tenant exit export and full recovery unproven; retention refusal on deletion exists                     | Linked export with manifest and digests and re-import; independent restore with measured time and loss                 | P1      |

## 2. Six journeys to design end to end

Design targets for AIS inspired by the published domains, not claims about
Hitit's internals. Each journey keeps a service state and a money state per
order item with its history; a repeated delivery event never recreates revenue.

1. **Offer to recognised revenue.** Search → time-bound offer → passenger,
   segment and service binding → accepted price version → inventory hold →
   payment confirmation → issue or deliver → revenue entry on the right event.
2. **Season to sellable flights.** Operating template, weekdays, validity →
   station exceptions → conflict check → approved version → diff publication.
   A change to a sold flight produces an affected-bookings list and a handling
   plan, never a silent edit.
3. **Allotment to release and invoice.** Distributor contract → quantity,
   flights, period → reservation from shared inventory → sale or release at the
   deadline → commission and debt settlement, on the existing inventory locks.
4. **Disruption to a usable journey.** Trusted operational event → affected
   passenger and segments → constrained alternatives → authorised approval →
   rebooking → reissue → services and baggage re-linked → notification.
   `awaiting_ticket_reissue` stays visible until completed.
5. **Unknown payment to resolution.** Request with a stable idempotency key →
   timeout → `unknown` → provider status query and matching → proven success or
   failure. No fallback charge on a timeout; each attempt carries the provider
   id and its key, linked once to the original obligation.
6. **Revenue to period close.** Sale with attributable components → delivery or
   cancellation per segment → entries and adjustments → provider and agent
   matching → exception review → close. Equal amounts never prove a match when
   currency, period or country differ; correcting a closed period produces an
   audited adjustment.

## 3. Engineering pattern

| Decision                | Why                                                                                         | Limit                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Stable identifiers      | `passengerRef`, `segmentRef`, `orderItemRef` instead of array indexes or purchaser identity | Compatible contract and migration; no history rewrite without audit            |
| Immutable snapshots     | Price, tax, policy, currency and product are stored at sale                                 | Approved financial rules; no YER or new currency activated by this work (#319) |
| Transactions and outbox | State change and event record agree; notification follows proof                             | Build on the existing outbox; consumers tolerate repeated delivery             |
| Separated states        | order, payment, fulfilment, accounting so one success never implies the others              | Allowed transitions, timing and source per event                               |
| Capability matrix       | provider × operation × currency × version × environment × evidence                          | Unproven capability is never shown as ready                                    |
| Gradual bridge          | Shadow reads and comparison before switching a channel's writes                             | One source of truth per field; defined stop and rollback switches              |
| Context isolation       | Cache by tenant, authorization, flight, date and policy version                             | Isolation and authorization tests before any smart personalisation             |
| Exception ledger        | Pending states shown with cause, owner and resolution action                                | No `pending` hidden inside a `completed` total                                 |

No decomposition into microservices because a vendor shows many modules:
domain boundaries, contracts and transactions come first; extracting a service
needs a measured load, deployment or isolation reason.

## 4. Acceptance scenarios H-01 to H-24, mapped to the plan

Proposed, not run. Where an S-scenario in the plan already covers the case, the
H entry is a cross-reference, not a new test.

| ID   | Case                                                     | Invariant                                                                    | Maps to                             |
| ---- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| H-01 | Adult/child/infant order swapped, with repeated types    | Each component stays with its passenger; a correct total alone is not enough | S-29, PRC-01                        |
| H-02 | Round trip requested, return unavailable                 | Outbound alone is never presented as a complete trip                         | DIST-01                             |
| H-03 | Departed flight among valid ones on the same day         | One bad candidate does not drop the day's valid results                      | DIST-02                             |
| H-04 | Same offer consumed by two concurrent bookings           | One result; no double inventory or money                                     | S-01 (#331)                         |
| H-05 | Cancel one service for one passenger on one segment      | Others' services and segments untouched                                      | S-10; OrderItem (module 5/ADR 0001) |
| H-06 | Supplier stock exhausted after payment                   | Explicit partial state and traceable compensation; no delivery promise       | Partners wave (section 1)           |
| H-07 | Service delivery event redelivered                       | One delivery and one accounting recognition                                  | Existing outbox tests               |
| H-08 | Fare-rule version changes after sale                     | Exchange uses the original policy or an authorised documented amendment      | S-09                                |
| H-09 | Provider timeout after the charge                        | `unknown`, then query and match; no automatic second-provider charge         | New: payment-attempt ledger         |
| H-10 | Webhook arrives during reconciliation                    | One ledger entry, consistent final state                                     | S-06 (#332)                         |
| H-11 | Refund `pending` or `failed`                             | No final success message; statistics separate from completed                 | FIN-01, FIN-02                      |
| H-12 | Settlement ids from another country, currency or period  | Refused before any write even when amounts match                             | BSP-01                              |
| H-13 | Season edited with live bookings                         | Specific diffs, notice, re-protection; no erased historical version          | Module 1                            |
| H-14 | Same schedule published twice after an interruption      | No duplicate flights                                                         | Module 1                            |
| H-15 | Allotment release and last-seat sale at the same instant | Aircraft capacity preserved; no unauthorised oversell                        | S-04; allotment module              |
| H-16 | Midnight and local-time change                           | Station dates, UTC and connection constraints consistent                     | Module 1; UI-02                     |
| H-17 | Boarding, then the event write fails                     | Both committed or both rolled back; retry safe                               | DCS-01, S-15                        |
| H-18 | Boarding pass scanned by two readers                     | One boarding; clear answer to the second                                     | S-15                                |
| H-19 | One purchaser, passengers on different flights           | Connection chosen for the intended passenger only                            | IROPS-01                            |
| H-20 | APIS revalidation fails after an old success             | No stale validity implying current acceptance                                | INT-01                              |
| H-21 | Multi-segment booking with one segment cancelled         | Correct revenue per segment; totals without duplication                      | SVC-01, S-09                        |
| H-22 | Two briefings for two flights or tenants                 | No cache context leak; no out-of-scope result                                | AI-01                               |
| H-23 | Agent disabled, then a late request                      | No new invocation; in-flight policy explicit                                 | AI-02                               |
| H-24 | Restore, then tenant export and balance rebuild          | Record, relation, total and known-gap counts match                           | S-19, S-22                          |

Receipt for every scenario: commit, environment versions, synthetic data,
test path, expected and actual, transaction and event identifiers, a negative
check proving the test detects the defect, and the cleanup result. Money and
inventory tests run on real MySQL at the operational isolation level.

## 5. Device simulation and the operator attestation

A simulator for barcode readers, boarding-pass and bag-tag printers, a DCS
provider and disconnects (duplicate, late and corrupt reads; cut after write,
before reply) is useful for protocol and application acceptance and for CI. It
proves nothing about physical printing, scan accuracy, driver compatibility or
the airport environment. Acceptance line: contract simulator → real device with
pinned version → third-party environment → witnessed operational run; each
layer accepted separately. For #103 the attestation template already exists;
this study only restates its evidence structure and makes no claim about its
status.

## 6. Waves without duplicating work

| Wave                      | Work                                                                                                 | Exit gate                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A, data correctness       | Re-verify and fix PRC/DIST/BSP/SVC/DCS/FIN/IROPS/APIS/AI on the current head (#333)                  | Negative test per defect, real integration for inventory and money, regression review        |
| B, shared building blocks | Sales and issuing offices; season schedule; order-item identity; capability matrix; exception ledger | Connected internal journeys; reports reconcile by office and segment                         |
| C, limited transition     | One channel on the order model, or one supplier; shadow reads before switching writes                | Balances, inventory and history agree old vs new; rollback rehearsed                         |
| D, proven expansion       | Advanced allotments, partners, operational control, measured optimisation                            | Impact and failure-rate measurements; external acceptance where required; known running cost |

Coordination stays on #327 and #333; finance and currency decisions on #319,
report sources on #280, ownership on #279.

## 7. What we do not know about Hitit: due-diligence questions

Evidence requests for any vendor evaluation, none sent and none answered:
API and event versions and deprecation schedule; idempotency scope, key
retention and changed-payload replays; unknown, late and out-of-order payment
outcomes; refund to the original transaction and instrument, partial and mixed
cases; the OrderItem model for passenger, segment, service and tax, and the
sold snapshot; multi-supplier rollback and operator-required states; the
product/version/customer matrix and contractual features; tenant isolation,
support access and retention; full export of history, tickets, coupons,
ledger, audit and attachments in a rebuildable form; latest restore test with
measured RTO and RPO; devices, drivers, CUPPS/CUSS versions actually tested and
by whom; the workload behind performance claims; security audit scope and
dates; full cost including minimums, per-passenger and per-channel fees, data,
support, change and exit; migration proof of balances, inventory and history
with a point of no return and a rollback plan.

## 8. Metrics that should steer investment

Internal baselines first: unresolved reconciliation differences, prevented
double charges, time to resolve `unknown`, partial-fulfilment rate, disruption
handling time, revenue attribution errors, schedule publication time, real
restore success. Targets are set with the owner against a baseline; no savings
or return-on-investment figure without data. A single score such as "AIS covers
70% of Hitit" is not justified: there is no agreed requirement list, weighting
or production-level proof per capability. Each capability is rated separately:
documented, present in code, tested internally, accepted externally, or
operated and monitored.

## Addendum, 11 November 2026: deeper five-agent review

A second pass over Hitit's public material (ADS, Audit, Cost Accounting, BPI,
DCS Mobile, DCS, PAX, the 2025 annual and sustainability reports, the
governance report, the 6 November 2026 update, the PIA migration and crew
announcements, the T2RL 2026 summary, Weight and Balance, the 2019 IBM
continuity release, the website cookie policy, RA). Eighteen further
observations and sixteen further scenarios. All scenarios are PROPOSED and
NOT_RUN; the current AIS head was not re-examined for this addendum, so every
"AIS check point" is a question for the code until proven. Absence of public
documentation is recorded as NOT_PUBLIC_IN_SEARCH, never as a vendor defect.

### Further observations R-01 to R-18

| ID   | Domain                           | Published evidence, in short                                                                                    | Limit                                                                                    | Proposed AIS decision                                                                                                 |
| ---- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| R-01 | ADS as an extra layer            | Corporate travel policies and approvals, post-sale fulfilment, sub-agency networks and commissions              | A described feature proves no delegation contract or multi-party integrity               | Audit airline → consolidator → agency → sub-agency → office; separate booking owner from issuing authority            |
| R-02 | Financial assurance              | Audit links sales, taxes and BSP; compares collection account, commission and settlement period; abuse patterns | Vendor description; no published detection error rates                                   | Financial exception ledger: expected gross, fees and net against bank credit; anomalies go to review, not penalty     |
| R-03 | Cost basis                       | Cost Accounting separates actual, contractual and allocated; accruals linked to invoices and operations         | No dashboard value is a final cost by default                                            | `cost_line` with contract version, segment, validity and state estimated/accrued/invoiced/reconciled                  |
| R-04 | Indicators need an action        | BPI aggregates revenue, load and yield from several sources with collaboration permissions                      | Public page only; older details not generalised to every version                         | A warning becomes a state with owner, evidence, data freshness, action and outcome                                    |
| R-05 | Mobile airport agent             | DCS Mobile: role and flight permissions, MRZ scan, Zebra printers, live sync, SIM fallback                      | Not proof of offline operation; no accepted model and version list                       | One command contract for phone and counter; print state separate from issuance; network switch and revoked-role tests |
| R-06 | Airport document coexistence     | Tickets and orders together, Pectab editor, disruption vouchers, self bag drop                                  | A compatibility logo proves no device or airport acceptance                              | Delivery reference binds coupon or OrderItem; a hotel voucher has its own issue, use and cancel lifecycle             |
| R-07 | PAX as supplier                  | Supplier role for catalogues, OMS and channels; Interline EMD                                                   | No published timeout, rollback or bilateral acceptance contract                          | Adapter interface for inventory and issuance; carrier pair × operation × document × version matrix                    |
| R-08 | Allotments, migration, retention | ALM/PAX inventory sharing and ticket invoicing; migrated-booking notices; PNR purge                             | Purge and retention details insufficient; not read as automatic deletion                 | Allotment test contract → cancel → release; no duplicate import on re-notification; archive separate from erase       |
| R-09 | Product maturity timing          | 6 Nov 2026: Elektrum to market, module migration "largely complete", ADS supplier integrations ongoing          | Catalogue wider than each partner's acceptance; first transaction is not full acceptance | Independent capability state per provider, currency, operation and version                                            |
| R-10 | Operational history              | Historical replay, ACARS/OTP, permit-change tracking; Crew Recovery live in 2025, other items planned           | Plans are not deliveries; no event contract or conflict rules published                  | `event_time`, `received_at`, source and revision; rebuild what was known at decision time                             |
| R-11 | Assurance naming                 | Governance report says SOC 1 Type 2, sustainability report says SOC 2 Type 2; both cite ISAE 3402               | A description difference, not a security flaw                                            | Request the original report, system, period and exceptions; no inherited acceptance from a general certificate        |
| R-12 | Technical contracts              | No current public OpenAPI/WSDL with errors, idempotency and timeouts found                                      | NOT_PUBLIC_IN_SEARCH; third-party confidential material excluded                         | Integration gate: schema, auth, errors, version, idempotency, retry, timeout, sandbox, evidence                       |
| R-13 | Historical continuity            | 2019 cloud backup for an existing centre; later periodic exercises disclosed                                    | No inference of active-active, RTO/RPO or current provider                               | Restore covering DB, messages, keys and attachments, with late financial events and post-return matching              |
| R-14 | Migration includes people        | PIA: future bookings intake, GDS loss before cutover, training, printers, integrations                          | A hosted customer testimonial, not an independent receipt                                | Export/re-import test, alternate channel, airport-agent support; cutover and rollback with events in the window       |
| R-15 | Acceptance per module            | PIA crew module live in 2025 after a 2018 relationship                                                          | A customer name proves no full-suite operation                                           | customer × module × version × environment × date; DCS success raises no other module's state                          |
| R-16 | Coexistence is pragmatic         | T2RL 2026 summary: offers-and-orders shift is early; share data too thin for trends                             | Independent but summary-only; no product ranking                                         | One journey on the order model with a clear source of truth, matching, shadow and rollback                            |
| R-17 | Load documents                   | Weight and Balance: load documents, messages, passenger and baggage integration                                 | Calculation correctness and aircraft-type acceptance not proven by the page              | Data adapter with versions and approval; a bag change after an approved loadsheet opens a new review                  |
| R-18 | Privacy policy limits            | Website cookie policy defines no PSS passenger-data processing contract or exit export                          | Contracts not provable from public search; not evidence of absence                       | Separate site policy from an operational DPA; linked export, explained retention, support-access permissions          |

### Four journeys to trace in the code

1. **Sub-agent to post-sale service**: office user → agency delegation →
   commission scope and corporate policy → approved offer → issuance →
   involuntary change → partial refund. At each step check actor, tenant,
   office, agency and issuer, with the delegation and policy snapshot kept.
   An API key alone does not prove authority over every booking.
2. **Sale to bank net to profitability**: price and tax components → financial
   obligation → payment attempt → provider collection → bank credit after fees
   → settlement → segment revenue → accrued or actual cost. Every figure
   carries currency, basis and time; a profitability view mixing final revenue
   with estimated cost says so.
3. **Operational decision to approved document**: sourced, timed event →
   state as known → proposal → approval → flight, permit or service change →
   new approved document. A late event never erases what an earlier decision
   relied on; doubt is shown to the operator.
4. **Migration to continued operation**: inventory of future bookings,
   documents and balances → snapshot → delta log during transfer → relation
   and total checks → write switch → monitoring and support period → bounded
   rollback test. Includes user training, printers and the agent channel.

### Scenarios H-25 to H-40

Complements H-01 to H-24. H-30 refines the reader scenario toward printing;
H-39 refines recovery toward a late financial event. Merge with existing #327
scenarios before writing tests.

| ID   | Topic                                    | Trigger                                                                   | Pass condition                                                                        | AIS check point                                  |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| H-25 | Sub-agent out of scope                   | Read or edit a sister agency's booking while a user moves between offices | Refused without leakage; authority from a live commercial relation, not the key alone | corporate / travelAgent, then offices (module 2) |
| H-26 | Expired corporate approval               | Price approved, then reprice or passenger change before issuance          | Re-approval where policy requires; no old approval on new content                     | corporate approvals                              |
| H-27 | Bank net matching                        | Gross 100, commission 2, bank credit 97                                   | Gap of 1 visible and unclosed; currency, period and account match                     | settlement / ledger (BSP-01, REC-01)             |
| H-28 | Invoice after accrual                    | Cost accrued, then partial or final invoice and a duplicate message       | Accrual cleared without doubling expense; contract history kept                       | cost accounting (needs inventory)                |
| H-29 | Booking abuse vs legitimate behaviour    | Family rebooks after a disruption vs automated churn                      | No automatic financial claim; evidence, review and false-positive measurement         | revenue assurance (needs inventory)              |
| H-30 | Print succeeded, reply lost              | Printer executes, acknowledgement is cut                                  | Bag-tag identity stable; recorded reprint, no new bag                                 | DCS / baggage (S-16, DCS-01)                     |
| H-31 | Network switch with revoked role         | Wi-Fi to SIM while the agent's flight role expires                        | Previous command resolved by query; new commands refused; no phantom success          | DCS / mobile (S-15)                              |
| H-32 | Disruption service voucher               | Hotel voucher replaced, then the old one is presented                     | Single use per policy; replacement history and beneficiary link                       | disruptions / ancillary                          |
| H-33 | Permit after a schedule change           | Flight change published after an old permit was accepted                  | Revised request linked to the original; no duplicate independent permit               | schedule / OCC (module 1)                        |
| H-34 | Operational decision and a late event    | New correction, then an old ACARS arrives                                 | Current view correct while what was known at the first decision is kept               | operations / tracking (OPS-01)                   |
| H-35 | Migrated booking and change notice       | Booking imported twice, then its time changes                             | Old reference kept, one notice; no replay of historical messages                      | migration / notifications                        |
| H-36 | Channel cut during migration             | Snapshot, then sales on an alternate channel before the switch            | Delta applied without loss or duplicate; inventory, coupons and balances match        | distribution / export (S-19)                     |
| H-37 | Expiring or narrowed acceptance evidence | Report scope changes or a device acceptance expires                       | Flagged for re-verification; no inherited acceptance for another service              | CAP-01 / #103 after reading them                 |
| H-38 | Schema upgrade with an old key           | Same idempotency key after a contract upgrade with different content      | Conflict refused; original outcome preserved                                          | API / idempotency                                |
| H-39 | Restore, then an old webhook             | DB back to T0, then an event from T1 already processed is redelivered     | No duplicate per the restore and matching log; unresolved gaps shown                  | payments / ledger (S-06, S-22)                   |
| H-40 | Bag after approved loadsheet             | Load change after the approved document                                   | New version needs approval; no silent edit of the previous document                   | Weight and Balance (deferred integration)        |

A mock success never closes a money or inventory case: real database at the
operational isolation level, concurrency and event replay, commit, contract
version, provider and environment recorded, and a negative test proving the
invariant fails when the defect is reintroduced.

### AIS tracing map before any new build

| Pri | Area                                    | What the reviewer looks for                                          | Closing evidence                                                              |
| --- | --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A   | corporate / travelAgent / permissions   | Organisation, agency, office relations; source of post-sale approval | Read current call paths; isolation test between two agencies (AGT-01, S-28)   |
| A   | settlement / financial_ledger / refunds | Amount, currency, account, period and net-of-fees attribution        | Provider, bank and ledger matching; BSP-01 and REC-01 fixes                   |
| A   | DCS / baggage / outbox                  | One transaction for state and history; document identity; reprint    | Fault injection then retry (DCS-01); print proven on a separate device (S-16) |
| B   | operations / tracking / schedules       | Time source, correction, permit version and decision                 | Out-of-order event replay with a rebuildable history (OPS-01)                 |
| B   | reporting / seat economics              | Indicator basis, cost basis, source freshness, segment attribution   | Known-answer datasets; SVC-01 fix                                             |
| B   | API adapters / capabilities             | Contract version, provider acceptance scope, currencies and devices  | Refuse an unaccepted capability; re-verify on version change                  |
| B   | export / retention / migration          | Complete relations, history, delta and due messages                  | Independent import; balances, counters and links reconcile (S-19)             |
| C   | cost / revenue assurance / suppliers    | Existing modules before proposing new ones                           | Proven inventory; smallest connected slice if the gap is confirmed            |

### Device simulation and the operator attestation, refined

| Evidence             | Required fields                                                            | What it alone does not prove                       |
| -------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Simulation test      | commit, contract, seed, expected/actual, negative control                  | Physical compatibility                             |
| Device test          | manufacturer, model, firmware, OS, driver, connectivity, read/print result | Another airport's or version's acceptance          |
| External integration | party, environment, schema, message, acknowledgement, dates                | Acceptance of the party's other functions          |
| Operator attestation | operator identity and authority, scope, date, evidence and exceptions      | Untested items or any regulatory licence not named |

SIM fallback is an alternate channel, not offline operation; total loss of
connectivity needs its own operating policy.

### Corrections and limits of this addendum

- ADS is added to the ecosystem map; the first study's three-layer view was a
  summary, not an inventory.
- Hitit's total transaction volumes are not attributed to the recent Elektrum
  product; product and period differ.
- The SOC 1 / SOC 2 naming difference calls for the original documents, not a
  judgement on system security. A limited-assurance sustainability report does
  not turn its technical descriptions into independent security tests.
- Stack information retrieved by one agent from a T2RL page did not reproduce
  on central re-verification and was excluded from architectural conclusions.
- Similar-named sources (an unrelated Electrum documentation site, Crane
  Worldwide Logistics) and a third-party document marked confidential were
  excluded.
- The Blue Air case during the pandemic pause is not a cutover-under-load
  benchmark and was not used as one.

### Evidence requests that would settle the next comparison

Sub-agency delegation and booking ownership, change, issuance and commission
documentation; provider, bank, commission and matching statement samples with
a partial-refund and a failed-settlement payload; cost-contract templates with
validity and invoice-to-accrual settlement; API and event schemas, versions,
timeout and idempotency errors and retry rules; a real device matrix with
acceptance lab, driver and printer versions and acknowledgement codes; a
migration and exit package covering future bookings, coupons, ledger, audit,
delta and rollback; original assurance reports with scope, period and
exceptions, and a real DR receipt with measured figures; a customer × module ×
version table separating announced from operated and accepted. None of these
was sent to Hitit; the current phase needs no purchase or subscription, only
requirements that can be proven and a check of what exists first.
