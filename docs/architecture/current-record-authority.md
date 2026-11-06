# Current record authority and the Order transition

## Scope and decision boundary

This document describes the implemented AIS authority model reviewed at
`50a3114ec49d2bf43a4933f54b7eba43de086888`, with the subsequent forensic fixes
recorded in the remediation branch. It does not approve ADR-0001 or migrate a
reader to a new commercial source. That ADR remains Proposed until the
commercial owner accepts its model, reconciliation and rollback criteria.

## Authority by fact

| Fact                                                                                   | Authoritative persisted source                                                              | Owning implementation and rule                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated identity, role and tenant                                                | `users`, current sessions/revocation and account-access state                               | `server/_core/context.ts`, `server/_core/sdk.ts`, `server/services/mobile-auth-v2.service.ts`, `server/services/account-lock.service.ts`; derive authorization from current database identity, not a submitted role or stale token claim. |
| Booking ownership and commercial commitment                                            | `bookings`, `passengers`, `booking_segments`, invoice components and their persisted prices | `server/services/booking-invoice.service.ts`, `server/services/booking-settlement.service.ts`; owner and tenant must agree at the transactional boundary.                                                                                 |
| Money collected by a provider                                                          | Verified `payment_receipts` bound to the persisted purchase and provider intent             | `server/services/payment-settlement.service.ts`; a checkout redirect or submitted provider reference is not settlement.                                                                                                                   |
| Financial movements                                                                    | Append-only `financial_ledger`, with source event/receipt identifiers                       | Settlement, refund and dispute services; provider collections, internal funding and reversals have distinct provenance. A booking status is not a substitute for cash evidence.                                                           |
| Spendable wallet funds                                                                 | Locked `wallets` balance with `wallet_transactions` and provider-funding reconciliation     | `server/services/wallet.service.ts`, refund/dispute reconciliation; concurrent spend and loss of funding must serialize on the same wallet.                                                                                               |
| Requested cancellation and completed refund                                            | Persisted cancellation/refund workflow plus verified cumulative refund receipt              | `server/services/refunds.service.ts`, `server/services/payment-settlement.service.ts`; requesting a refund, receiving provider confirmation and releasing travel resources are distinct transitions.                                      |
| Capacity and seat association                                                          | `flights`, segment reservation state, inventory holds and `seat_inventory`                  | `server/services/inventory-capacity.service.ts`, `server/services/seat-map.service.ts`; authorize against the current locked booking/passenger association.                                                                               |
| Travel and baggage custody                                                             | Passenger-flight DCS state, signed command receipts and custody events                      | Departure-control, DCS-operations and baggage-custody services; local documents and counters do not prove external device acceptance.                                                                                                     |
| NDC representation                                                                     | `ndc_orders` linked to `bookings`, with NDC state-machine rules                             | `server/services/ndc.service.ts`, `server/services/ndc-order-state.ts`; today the booking is created first. The NDC row is not an independent commercial authority.                                                                       |
| External ticket/EMD, authority delivery, fiscal clearance and operational load release | Accepted provider, authority or authorized operator receipts, when available                | Existing capability gates remain closed where this evidence is absent. A synthetic ID, a draft or a configured credential is not an authoritative receipt.                                                                                |

## Reconciliation available now

`scripts/ci/forensic-data-audit.ts` provides read-only findings over current
sources. Its checks include NDC/booking state disagreement, invoice and segment
allocation inconsistency, owner/tenant mismatch, collected funds requiring
review, and terminal bookings retaining resources. Run it only against an
authorized database and retain its source revision, query outcomes and bounded
record identifiers. It reports differences; it does not repair history or
rewrite an authoritative fact.

The forensic refund, dispute and seat fixes add behavioral acceptance at the
transactions that change those facts. Passing those tests closes the measured
defect; it does not establish an Order migration or a full period of reconciled
commercial operation.

## ADR-0001 execution prerequisites

1. Record the actual commercial decider and the accepted ADR revision. Keep
   operating ownership distinct from a repository reviewer.
2. Agree item identity, currency/unit semantics, version transitions, passenger
   and segment ownership, refund allocation and delivery authority.
3. Introduce shadow items and versions behind a disabled read switch in a
   separate reviewed schema change. Preserve current authoritative writes.
4. Produce comparisons with duplicate, delayed, failed, partial and concurrent
   changes. Report every unexplained difference; never fill an unknown value
   with a guessed allocation or manufacture historical events.
5. Meet the ADR's full-period acceptance requirement, exercise rollback, and
   only then authorize the next reader/writer transition.

**SSOT-01 remains open for the accepted architecture and migration.** The
current-source authority is now explicit; this document is not evidence that
`order_items`, `order_versions`, a shadow writer or a production comparison
period have been delivered.
