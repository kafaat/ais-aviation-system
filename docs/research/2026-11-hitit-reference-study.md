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
