# ADR 0003: Cancellation refunds across the original and upgrade payment intents

- **Status:** Accepted for implementation on 14 November 2026 by the repository
  owner ([#327, decision 7, option A](https://github.com/kafaat/ais-aviation-system/issues/327#issuecomment-6880288729)).
  The execution shape below (a parts table, newest collection first) was
  chosen by the integrating session as the option the owner was offered and
  accepted.
- **Date:** 15 November 2026, written against the branch
  `fix/refund-across-upgrade-intents`.
- **Deciders:** repository owner (policy); integrating session (execution
  shape).

## Context

An order-servicing upgrade can collect its fare difference on a second Stripe
payment intent, recorded as a `modification` payment receipt. Before this
change, a cancellation refund could draw only on the booking's original intent:

- `ordinary_booking_refunds` allowed one provider refund per cancellation; the
  booking id is its primary key, and the intent, operation id and refund id are
  each unique (migration 0068);
- a full-tier cancellation quoted on the whole invoice was refused with
  "Refund does not match the original collected balance";
- a partial cancellation was drawn from the original intent even when the
  upgrade intent still held money.

The owner decided that such a cancellation refunds from both intents, each up
to what it still holds.

## Decision

1. **A parts table under the existing cancellation row.**
   `ordinary_booking_refund_parts` (migration 0077) holds one row per refunded
   intent. Each part has its own operation id (`<operationId>:<intent>`, the
   provider idempotency key), amount, provider refund id, status, retry time
   and error code. The parent `ordinary_booking_refunds` row stays the
   cancellation record; it carries no provider refund id for a multi-intent
   cancellation.
2. **Newest collection first, for any amount.** While an applied
   `modification` receipt on another intent still holds money, every new
   cancellation, full or partial, and also after a later downgrade, draws from
   the most recent collection first, each intent up to what it holds, within
   the booking total. Single-intent bookings keep the previous path and the
   #346 downgrade cap.
3. **No part of 0.** An amount of 0 already means "cancelled with no refund" to
   several readers.
4. **One completion.** The booking is cancelled once, when every part has
   succeeded. It becomes `refunded` (coupons `R`) only when every collection is
   fully refunded.
5. **Failures are per part.** A provider error leaves the part retryable and
   never re-sends a part that succeeded. A part the provider refuses outright
   is terminal: the cancellation goes to reconciliation, the other part is
   still sent, and `createRefund` reports `failed` with the refused amount, as
   the single-intent path does.
6. **Webhooks by metadata.** Provider refunds are attributed to their part by
   our own refund metadata (booking id and operation id), with no provider
   contract change.
7. **Disputes per part (S-08, owner decision 6, #363).** Every part is held
   while a funding dispute on the booking has funds withdrawn; after a lost
   dispute the part on the lost intent settles by the chargeback; parts on
   other intents proceed; a part already sent with an unknown outcome goes to
   review.

## Alternatives considered

| Option                                                                      | Why not chosen                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Change the primary key of `ordinary_booking_refunds` to booking plus intent | Rewrites a table that already holds rows and every reader keyed by booking; larger migration risk |
| Store the parts as JSON inside the existing row                             | No per-part uniqueness, locking or retry state; fragile to query and audit                        |
| Keep refusing and refund manually                                           | Rejected by the owner (decision 7, option B)                                                      |

## Consequences

- Readers changed to read parts: settlement (per-part gate and a single
  completion step), the event inbox, refund statistics, dispute cover, the
  forensic completion check and its preflight SQL. Departure and DCS
  finalization are unchanged: the parent row of a multi-intent cancellation has
  no refund id, so a failed one always needs reconciliation.
- **Known limit (legacy replay).** A refund an older release made or queued
  on the original intent alone, or a full refund of that intent made at the
  provider, still settles through the single-intent rule. The booking becomes
  `cancelled` and `refunded`, as before. What changed: an applied upgrade on
  another intent that still holds money now goes to settlement review. Its
  receipt becomes `review_required`, with one
  `payment.settlement_review_required` event per upgrade intent.
  `listSettlementReviews` lists it, and `requestSettlementReviewRefund`
  refunds it in-app. The verified provider refund then marks it
  `review_refunded` and leaves the booking as it is. If departure blocks the
  release, the booking and its upgrade stay under departure reconciliation
  instead. Review lists what the upgrade still holds, which can include a
  cancellation fee kept on that intent, so the operator checks the booking's
  cancellation before refunding it. No money moves twice. What remains: bookings an older release left
  `refunded` with an `applied` upgrade before deploy are not changed.
  `scripts/sql/decision7-legacy-upgrade-refunds.sql` is a read-only query that
  lists them before deployment, for reconciliation.
- Verification: three fresh-context verifiers (fail, fail, pass) with two fix
  rounds, then integrator test hardening; the PR lists the evidence.
