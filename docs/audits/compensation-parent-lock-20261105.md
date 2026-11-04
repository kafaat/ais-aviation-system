# Compensation claim authority follow-up

Scope: the active claim creation, review and read/report paths in
`server/services/compensation.service.ts`, with transaction-aware membership
resolution in `server/services/booking-flight-membership.service.ts`.
Baseline: `e9189312c49775c3a298019270ec7490340cf62e`.

## Reproduced defect and bounded fix

Before the fix, claim creation checked booking ownership, segment membership
and passenger membership with ordinary reads, then inserted outside a
transaction. The new executing relational test demonstrated that a failed final
claim read left one committed claim despite rejecting the request. A second
test demonstrated that the ownership and member queries ran outside a
transaction and did not take the booking parent lock.

The initial run on unchanged production code produced **2 failures and 33
passes** in `server/services/compensation.service.test.ts`. The failed tests were
`files an unpriced review on an owned historical cancelled booking while holding
its parent lock` and `rolls back an inserted claim when its final read fails`.

Creation now uses one transaction and acquires `FOR UPDATE` on the owned
booking before resolving segments, passengers or inserting the claim. The
optional transaction argument to `resolveClaimFlight` keeps every operation on
the same connection. Read-only eligibility callers retain ordinary reads.
Failures roll back the inserted claim. The service preserves the existing
historical cancelled/soft-deleted booking and nullable-passenger contracts;
filing still creates an unpriced `under_review` claim.

The lock order matches `purgeDeletedBookings`: claim first means purge must wait
and then inspect the committed claim; purge first means the subsequent locking
ownership read cannot find its deleted booking. This closes this writer's
participation gap. It is not a claim that every booking writer, operational
reference or legal retention obligation has been audited.

## Executing local evidence

Pinned runtime: Node **22.23.4**, using the repository's existing dependencies.

- **35** mutation/eligibility tests cover owned and foreign bookings, unrelated
  flights/passengers, multi-segment and group selection, historical claims,
  rollback, reviewable/resolved states, evidence requirements, existing invalid
  amount rules, denial reasons, and unavailable storage.
- **7** read/report tests execute production predicates and aggregates against
  stored rows: user and booking ownership, absent/orphaned records, parameterized
  filters, pagination, zero versus unassessed amounts, approved/paid liability,
  date-bounded statistics, and database unavailability.
- Existing GACA review tests and booking deletion tests remain passing.

`authorityRelationalFixture` executes production Drizzle SQL on SQLite. It
records and removes MySQL locking clauses; it does **not** simulate native
locks. The read tests locally adapt mysql2's raw `[rows, fields]` result protocol
and provide a UTC calendar-day `DATEDIFF` function. No canned claim rowsets
replace predicates or aggregates. This establishes relational behavior, not
full MySQL dialect, driver or concurrency parity.

A focused V8 run of the 42 new local tests plus the existing 17 GACA tests
passes **59 tests**. With inclusion restricted to the two changed production
files, it measures:

| File                                   |      Covered lines |   Covered branches | Covered functions |
| -------------------------------------- | -----------------: | -----------------: | ----------------: |
| `compensation.service.ts`              | 135 / 229 (58.95%) | 159 / 260 (61.15%) |  16 / 24 (66.66%) |
| `booking-flight-membership.service.ts` |   16 / 26 (61.53%) |   16 / 22 (72.72%) |       2 / 4 (50%) |

These are focused local measurements, not a new repository-wide percentage or
a remote Codecov result. No coverage threshold, exclusion, dependency or
business policy changed. The legacy standalone tariff calculators and rule
maintenance paths remain outside this follow-up.

## Required native MySQL evidence

`server/__tests__/compensation-purge-mysql.test.ts` defines three cases for the
required MySQL matrix:

1. Pause actual claim creation immediately before insert, start purge on a
   second connection, observe a real booking lock waiter, then commit the claim
   and assert that purge preserves booking, passenger and claim.
2. Pause actual purge immediately before passenger deletion, start a claim on a
   second connection, observe its booking lock wait, then commit purge and
   require `NOT_FOUND` with no orphan claim.
3. Fail the native final claim read, verify rollback, then successfully purge
   the now-unreferenced booking to establish release of the parent lock.

The contention tests query `performance_schema.data_lock_waits` joined to
`data_locks`, restricted to the random test-owned schema and the bookings table.
They do not infer locks from a timer alone. Gates control scheduling at the
driver query boundary; ownership, transactions, statements and locks execute
on MySQL. Each pending operation is released and settled during cleanup.

The suite requires `AIS_DISPOSABLE_DATABASE=true`, `NODE_ENV=test`, and an
explicit loopback `mysql:` source database matching `ais_*test`. It copies
migration-verified table structures into a random owned schema, copies no
source rows, preserves strict SQL mode, and drops only its owned schema.
`CREATE TABLE ... LIKE` intentionally omits foreign keys so the race is prevented
by the service protocol, not an incidental FK.

No local MySQL server or Docker runtime was available. **The three native cases
were collected but skipped locally; no native pass or native red/green result
is claimed here.** They must execute in the registered required MySQL matrix
before this audit can be treated as native concurrency acceptance. Local
rollback red/green evidence does not substitute for that gate.
