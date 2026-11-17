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
  refunds it in-app. That refund waits while a servicing refund on the
  booking is unfinished, because settlement ignores other refunds of an
  intent until its servicing refund succeeds. The verified provider refund
  then marks it `review_refunded` and leaves the booking as it is. An upgrade
  whose open or failed servicing refunds cover everything its intent still
  holds, such as the refund a flight cancellation plans for each intent, is
  left to them and not sent to settlement review. A partly covered upgrade is
  still sent there, and its review refund then refunds only what remains.
  If departure blocks the
  release, the booking and its upgrade stay under departure reconciliation
  instead. Review lists what the upgrade still holds, which can include a
  cancellation fee kept on that intent, so the operator checks the booking's
  cancellation before refunding it. No money moves twice. What remains: a
  booking can still be `refunded` with an `applied` upgrade that holds money.
  An older release left some before deploy. This change also leaves one while
  a covering servicing refund is open, and keeps it when that servicing
  refund fails, until an operator resolves the servicing refund as described
  in the next item. `scripts/sql/decision7-legacy-upgrade-refunds.sql` is a
  read-only query that lists all of them, for reconciliation.
- **Operator resolution of failed servicing refunds (issue #382).** Failed
  and `review_required` servicing refunds of both origins, exchange and
  flight cancellation, are listed and resolved in-app. Each action is an
  admin-only privileged mutation. It re-reads the provider outside any
  transaction: a retrieve of every refund id the request recorded, and the
  intent's refunds matched by `orderServiceRefundId`. It then decides under
  the booking lock, in the worker's lock order. No action creates a provider
  refund.
  - _List:_ `payments.servicingRefundReviews`
    (`GET /admin/payments/servicing-refunds`), newest first, limit 1 to 100.
    Each row has its origin, booking id and reference, intent, amount (minor
    units, SAR), error code, provider refund id, attempt, and request and
    creation times.
  - _Reconcile_ (`POST …/{requestId}/reconcile`) records what the provider
    holds through `recordVerifiedOrderRefund`: a success settles once, a
    pending refund goes back to the worker, and none found leaves the row
    unchanged with the answer `no_provider_refund`. A duplicate, a balance
    conflict or an unverifiable history stays `review_required`. A provider
    outage changes nothing.
  - _Retry_ (`POST …/retry`, naming the attempt reviewed) only follows a
    definitive provider failure (`failed`, `provider_refund_failed`). A
    `review_required` row with an uncertain outcome is never retried; its
    resolutions are reconcile or cancel. Retry is also refused in these
    cases:
    - the provider holds a refund for the request that has not failed;
    - the collection's other provider refunds differ from the saved base;
    - the receipt no longer holds the amount at that base;
    - a dispute holds or has taken the collection's funds. A retry clears the
      request time, so the row would re-enter the lost-dispute allocation.

    Under the lock, retry archives the refused refund in
    `order_service_refund_attempts`. That table accepts only `failed` or
    `canceled`, one row per attempt and per provider refund, so the schema
    allows a liability at most one refund that has not failed. Retry then
    queues attempt _n_+1. The worker sends it with the key
    `order-refund:<id>:a<n>` and an `attempt` metadata entry. A new key is
    needed because the provider replays a saved response for a key for 24
    hours. Attempt 1 keeps `order-refund:<id>` and its exact request.
    Concurrent retries give one attempt.

  - _Late events:_ an event for an archived attempt that failed, was
    canceled or is pending changes nothing, because those provider states
    are terminal. A success from an earlier attempt never settles from the
    event. The row goes to `review_required` (`earlier_attempt_succeeded`)
    with an event, and a queued attempt is not sent. Reconcile then reads
    that refund from the provider and settles it once, only if the live
    attempt was never requested and nothing else settled. Whatever the event
    order, a liability settles once.
  - _Cancel_ (`POST …/cancel`, naming the attempt and giving a reason of 10
    to 500 characters) applies to a `failed` or `review_required` row when
    the provider shows no refund for the request that has not failed. It is
    refused in three cases:
    - a row only partly covered by a lost dispute
      (`chargeback_partial_cover`);
    - a held or lost dispute on the collection;
    - a flight-cancellation refund whose job still counts it as planned.

    Cancel sets `cancelled` with `resolvedBy`, `resolvedAt` and
    `resolutionReason`, and writes an `audit_logs` row in the same
    transaction. A cancelled refund is closed everywhere it was counted as
    open: in `assertNoOrderRefundPending`, in the covering check above, in
    the settlement gate on its intent, and in the customer's exchange status,
    which shows `review`. On a refunded booking, an applied upgrade on that
    intent that still holds money goes to settlement review. There
    `listSettlementReviews` shows it and `requestSettlementReviewRefund`
    refunds it once.

  - _Follow-ups:_ a client screen (this change ships the API and OpenAPI
    only), and resolution of rows that stay with the dispute flow. A
    `review_required` flight-cancellation job is never recomputed, so the
    operations dashboard keeps listing a booking whose refunds an operator
    has since resolved.
- Verification: three fresh-context verifiers (fail, fail, pass) with two fix
  rounds, then integrator test hardening; the PR lists the evidence.
