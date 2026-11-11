# Operations fixes — local execution receipt

- Base: `603a59f6` in `/workspace/scratch/a857cdae9651/ais-fixes`.
- Scope: DCS-01, INT-01, GRP-02, IROPS-01 only; no schema change, commit, push or provider call.
- Instructions: read `CLAUDE.md`; dependencies supplied by the parent agent's central install.

## Changes

1. `server/services/baggage.service.ts`: wrap `updateBaggageStatus`, `reportLostBaggage` and `markBaggageFound` reads, optimistic writes, tracking inserts and returned reads in one transaction. Preserve the existing `heldBag` status/handback predicates. A failed tracking insert now rolls back all item fields so retry can perform the command once.
2. `server/services/apis.service.ts`: failed validation now persists `status='complete'` and clears `validated_at` while holding the existing document row lock. Historical `submitted_at` and submission evidence remain untouched; no claim of revoking an external submission.
3. `server/services/special-services.service.ts`: extract the existing request eligibility policy for reuse by administrative activation. Single and bulk transitions are transactional; booking locks are acquired in sorted order, current service rows are locked, and activating pending/confirmed rechecks passenger, active sector, flight, legacy EXST prohibition and same passenger/service-type/sector uniqueness. Passenger reads are locking reads to avoid stale snapshots after waiting for a booking lock. Bulk IDs are deduplicated and return actual affected row counts; a conflict rolls back the entire batch.
4. `server/services/irops.service.ts`: connections use noncancelled `bookingSegments` on the same booking and subsequent segment order, not the purchaser's `userId` or header flight. The query returns each booking's own passengers. Cross-booking or legacy single-flight connections without a persisted itinerary relation are deliberately not inferred by name/passport/purchaser.

## Added regression tests

- `server/services/baggage-tracking-atomicity.test.ts`: 6 cases — rollback/retry for all three mutations and preserved signed handback guards.
- `server/services/apis-revalidation-state.test.ts`: 3 cases — expiry after success, invalid existing document, preserved historical submission evidence.
- `server/services/special-services-activation.test.ts`: 9 cases — replacement conflict for pending/confirmed, atomic competing bulk activation, distinct actual count, self-confirmation, closed sector, departed flight, ambiguous legacy sector, separate passengers.
- `server/services/irops-connection-identity.test.ts`: 4 cases — unrelated same purchaser, correct booking-specific passengers, earlier sector exclusion, no inferred legacy connection.

## Validation

- Before production edits: **18 failed / 4 passed**, 22 cases, 4 files. Failures reproduced the expected original behaviour, not import/setup failures. Log: `/workspace/scratch/a857cdae9651/operations-red.log`.
- After edits: **22 passed**, 4 files. Log: `/workspace/scratch/a857cdae9651/operations-green.log`.
- Affected regressions: **62 passed**, 10 files (the four new suites plus EXST, baggage custody/closeout, IROPS durable, PAXLST and PNRGOV). Log: `/workspace/scratch/a857cdae9651/operations-regression.log`.
- After the final locking-read adjustment: SSR activation + existing EXST suites **11 passed**.
- ESLint for the four changed services and four new test files: clean.
- Prettier check for those eight files: passed.
- Full TypeScript check coordinated by parent; not independently duplicated while other agents edit.

## Evidence limits and remaining acceptance

These tests invoke the real services with database boundary doubles. Baggage/SSR use the repository's transaction-memory helper with rollback and SQL predicates; it does not simulate native MySQL lock contention. APIS uses a narrowly scoped raw-SQL fixture. IROPS uses a relational query boundary fixture and checks booking identity selection, not a live database.

Native MySQL rollback/locking/concurrent request-vs-reactivation and live provider/device acceptance were not run by this worker. Redis connection warnings appeared during existing router regressions; all selected tests passed, and no Redis acceptance is claimed. The IROPS legacy/cross-booking limitation is intentional because the current schema provides no trusted cross-booking passenger relation. No current operational certification is implied.
