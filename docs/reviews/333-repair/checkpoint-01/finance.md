# Finance repair result — REC-01, FIN-01/02/03

Date: 2026-11-11. Workspace: `/workspace/scratch/a857cdae9651/ais-fixes`.
Assigned base: `603a59f`, branch `fix/review-333-sequential`.
No commit, push, schema change, provider call, secret change or currency/policy change was performed by this agent.

## Implemented

- **REC-01:** reconciliation delegates verified capture to `settleVerifiedPayment`, the same transaction owner used by signed webhooks. `recordReceipt` adopts a matching pending/failed Stripe attempt instead of inserting another completed payment. Identity, amount, currency, provider and uniqueness are checked under the booking owner lock. Conflicting attempts roll back; a repeat receipt is a no-op. The native race fixture now requires exactly one receipt, payment and ledger charge, and includes ordinary refund after reconciliation alone.
- **FIN-01:** refund statistics combine ordinary cancellation requests with split refund items. Ordinary currency/purpose are resolved through their unique payment receipt (`SAR`, `booking`). Pending/requires-action remain pending; failed/review-required remain review. Settled totals remain ledger-only, without counting a succeeded command again.
- **FIN-02:** removed unconditional refund-success email, notification and metric emission from request submission. Routers audit `REFUND_INITIATED`, not completion. The verified ordinary refund success transition writes `booking.ordinary_refund_completed` transactionally. Local event delivery checks booking/tenant/refund identity and verified success, then writes one notification and completion audit using consumer receipts. Email uses the existing fenced external delivery mechanism and a stable `ordinary-refund:<refundId>` idempotency key. Pending/failed/requires-action never emit completion. Added payload contract and round-trip/required-identity regression.
- **FIN-03:** payment statistics sum posted SAR refund/partial-refund ledger deltas instead of summing only fully-refunded payment rows. User scope remains booking-purchaser scope, including split contributions, consistent with existing history ownership. Existing full-refund count and gross completed amount meanings are retained.

## Evidence

1. Negative control: saved only owned source changes, temporarily restored their HEAD versions, ran the new regressions, and restored fixes in a Python `finally` block. Result: **14 failed / 133 passed**, 7 files. Failures include 2 payment rows instead of 1, refund total 0 instead of 3500, false `REFUND_COMPLETED`, missing durable completion, and missing delivery handling. Log: `/workspace/scratch/a857cdae9651/finance-red.log`. Some old mock tests fail structurally when extra query/delegation is absent; the separate SQL-row and boundary tests provide behavioral assertions.
2. Final targeted run: **323 passed / 4 skipped**, 17 passed files and 1 skipped native file. Log: `/workspace/scratch/a857cdae9651/finance-final.log`.
3. ESLint on 19 owned source/test files: clean. Log: `/workspace/scratch/a857cdae9651/finance-lint.log`.
4. Prettier applied to changed owned files; `git diff --check` clean for owned source paths.
5. A duplicate local tsc was stopped in favor of the parent's central type check. No independent typecheck PASS is claimed here.

Final test command:

```sh
node_modules/.bin/vitest run \
 server/__tests__/payment-settlement-boundary.test.ts \
 server/__tests__/ordinary-refund-boundary.test.ts \
 server/services/payment-history-reporting.test.ts \
 server/__tests__/ordinary-refund-delivery.test.ts \
 server/routers/refunds.security.test.ts \
 server/__tests__/refund-reporting-boundary.test.ts \
 server/services/stripe/stripe-reconciliation.service.test.ts \
 server/__tests__/refund-stats-projection.test.ts \
 server/__tests__/stripe-reconciliation-race-mysql.test.ts \
 server/__tests__/domain-events.test.ts \
 server/__tests__/split-refund-boundary.test.ts \
 server/__tests__/ordinary-refund-departure.test.ts \
 server/services/refunds.security.test.ts \
 server/services/refunds.atomicity.test.ts \
 server/__tests__/event-producer-inventory.test.ts \
 server/__tests__/audit-authorities.test.ts \
 server/services/outbox.service.test.ts \
 server/jobs/reconciliation.job.test.ts
```

## Limits and follow-up

- Native MySQL is unavailable here. The four tightened race/refund cases are **SKIPPED / NOT_RUN**, not acceptance evidence. Run them with disposable database flags on the supported native lab before claiming native concurrency acceptance.
- Portable tests use actual service code plus the existing transaction-memory boundary double, and actual Drizzle-generated SQL over SQLite rows for refund projections. They do not prove MySQL locking/isolation or provider delivery.
- No attempt to repair legacy already-paid bookings lacking receipts, or historical duplicated payment rows. The existing legacy guard remains; those records need a separately reviewed provider reconciliation/backfill procedure rather than fabricated money history.
- Existing asynchronous email infrastructure/provider idempotency is reused; live email/provider acceptance was not run. Pending provider outcomes are not converted to completion for convenience.
- Retained-cancellation-fee reporting remains its prior split-plan projection; this task fixes request queues and posted refund amounts only.
- The removed request-time `trackRefundIssued` counter is not replaced with a potentially duplicate in-transaction external metric. Posted ledger and the durable completion event are the accounting/completion evidence.

## New test files

- `server/__tests__/ordinary-refund-delivery.test.ts`
- `server/__tests__/refund-stats-projection.test.ts`

Other edits are confined to the assigned settlement, reconciliation, ordinary refunds, refund statistics/history, refunds router, and the explicitly granted event-inbox/domain-event contract files and their tests.
