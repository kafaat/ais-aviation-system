# Executing coverage for active authorities — 4 November 2026

## Scope and baseline

The verified full-suite coverage for main
`e80d8790fba2a30e3164322e0fe40ed5a62bb553` recorded 4,472 passing tests in
355 files and 48.45% line coverage. Three active services had no executed
lines in that receipt:

| Active authority               | Baseline executed lines | Production consumers                                                          |
| ------------------------------ | ----------------------: | ----------------------------------------------------------------------------- |
| `crew-rule.service.ts`         |                 0 / 119 | Crew assignment, DCS, recovery feasibility and aviation integration ingestion |
| `soft-delete.service.ts`       |                  0 / 45 | Authorized booking deletion, restoration and cleanup router                   |
| `consent-authority.service.ts` |                  0 / 21 | Privacy preferences and authenticated cookie consent                          |

These paths were selected for operational eligibility, destructive-write and
privacy consistency risks. The 161 zero-line files in the baseline are not
all active services. This work does not change coverage thresholds, includes,
exclusions or required CI gates. It does not infer a new whole-repository
coverage percentage from a focused test run.

## Defects reproduced and changes

### Booking deletion and restoration

The previous purge selected eligible bookings, deleted their passengers, then
independently deleted every booking matching the current date predicate.
Two executing SQL cases demonstrated the consequences:

- A restrictive reference rejected booking deletion after its passenger had
  already been deleted. The booking and referencing row survived, but the
  passenger did not.
- An eligibility change after batch selection made an additional booking match
  the final broad predicate. That unselected booking was deleted while its
  passenger remained outside the selected passenger set.

Purge now selects and locks the eligible booking IDs in a transaction, orders
those locks by booking ID, checks the retained financial/document authorities
described below, and uses the remaining exact IDs for both deletes. A rejected
booking delete rolls back the passenger changes. The result reports actual
affected booking rows. The service also enforces the router's integer range of
30–365 days for internal callers. The default remains 90 days and the cutoff
is strict. Financial eligibility narrows which old records may be purged; it
does not shorten the retention period or authorize financial-history deletion.

Soft deletion checks ownership and cancellation while holding the booking row
lock through the update. Restoration uses the same transaction/row-lock
protocol. The existing administrative override remains unchanged.

The initial valid red run had **11 failures and 3 passes**. After the transaction
changes, all original **14 deletion tests passed**, including retained
recent/restored/cutoff bookings, invalid retention inputs, owner rejection,
administrative restoration, listing and unavailable storage.

#### Existing financial and document evidence

The restrictive reference in the rollback test is an explicit fixture
constraint. It establishes rollback after a genuine SQL rejection; it does not
establish that the production catalog protects financial records with foreign
keys. Reviewing [the canonical schema](../../drizzle/schema.ts) and active
money/document writers exposed a second gap: an old soft-deleted booking could
still be physically removed while committed financial or document evidence
remained linked to it.

An additional **41 executing regressions failed against the transaction-fixed,
unguarded service**, while the original 14 passed. They independently require
retention for each of 30 explicit authority tables, six passenger-owned
references whose booking field disagrees, four inline booking payment markers,
and a legacy passenger ticket number. All **55 deletion tests now pass**.
The mixed-batch cases also prove that retaining one protected booking does not
block deletion of a genuinely unreferenced eligible booking.

The explicit guard in
[soft-delete.service.ts](../../server/services/soft-delete.service.ts) checks
this bounded set before deleting any passengers or bookings:

| Authority group                    | Retained tables                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Payments and cash ledger           | `payments`, `payment_receipts`, `payment_history`, `payment_splits`, `financial_ledger`                                          |
| Refund intent and reconciliation   | `booking_refund_plans`, `booking_refund_items`, `order_service_refunds`                                                          |
| Credits and internal funding       | `user_credits`, `credit_usage`, `voucher_usage`, `wallet_transactions`                                                           |
| Loyalty balance/liability evidence | `miles_transactions`, `booking_loyalty_accruals`, `loyalty_credit_lots`, `loyalty_contract_liability_events`                     |
| Corporate and agency attribution   | `agency_credit_obligations`, `corporate_bookings`, `agent_bookings`                                                              |
| Servicing and priced invoices      | `booking_modifications`, `booking_checkout_requests`, `retail_offers`                                                            |
| Fare lines and documents           | `booking_fare_components`, `booking_ancillaries`, `zatca_invoice_drafts`, `ticket_coupons`, `electronic_misc_docs`, `ndc_orders` |
| Compensation and hotel obligations | `compensation_claims`, `emergency_hotel_bookings`                                                                                |

All use `bookingId` except `retail_offers`, which uses `consumedBookingId`.
`booking_fare_components`, `booking_ancillaries`, `ticket_coupons`,
`electronic_misc_docs`, `compensation_claims` and `emergency_hotel_bookings`
also protect the booking through an owned `passengerId`, even when the stored
booking reference disagrees. Reference status and tenant inconsistencies never
make these rows eligible for deletion.

Legacy evidence can exist without a newer authority row. The guard also
preserves bookings with `paymentStatus` of `paid` or `refunded`, a non-null
`stripePaymentIntentId` or `stripeCheckoutSessionId`, or a passenger with a
non-null `ticketNumber`.

The booking rows are locked first. Each correlated authority and passenger
lookup then uses its own `FOR UPDATE` current read inside the same transaction.
This matters because MySQL does not propagate an outer locking clause to nested
queries; see [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).
An absent required table or failed query rejects and rolls back the operation;
there is no fallback that deletes unverified candidates.

This is a conservative eligibility guard for existing evidence, not a complete
referential-integrity or legal-retention policy. It deletes none of the listed
sources, changes no financial statuses and introduces no cascades.

### Crew eligibility

Comparisons such as `invalidDate < dutyEnd` return false. A malformed medical
expiry or pilot licence expiry could therefore pass the existing checks and
produce `compliant: true`. The two malformed-expiry cases reproduced this
against the real service and date-decoding boundary; **20 other crew cases
already passed**.

The service now requires a finite expiry timestamp before comparing it with
the duty end. Existing medical/licence diagnostics and role-specific rules
remain unchanged. Both individual and batch assessments reject the malformed
evidence, and assignment creates neither a row nor an event for it.

All **22 crew tests pass**. They also execute policy scope filtering,
ambiguity and revoked-source rejection, bounded policy history, complete duty
bounds, missing historical duty evidence, multi-leg duty deduplication,
assignment locking/duplicate rejection, event-failure rollback, and signed
profile ingestion/replay identity. The source registry, signatures and people
are synthetic fixtures. No operator or provider is contacted. Assignment
eligibility still explicitly leaves dispatch acceptance separate.

### Consent authority

The existing transactional authority required no production change. Seven
executing cases verify that preferences, changed-field history and the cookie
revision commit together; another user's revision or a stale revision cannot
authorize a write; initialization uses default opt-out values; only permitted
preference fields are writable; and failure of the final revision insert rolls
back both new and existing users' earlier changes. The user lock precedes the
consent lock. Missing users and unavailable storage produce no partial records.

## Verification and fixture limits

The combined focused command passed **107 tests across five files**, including
84 new authority cases and 23 existing recovery-policy/soft-delete filtering
regressions:

```sh
node node_modules/vitest/vitest.mjs run --project server \
  server/services/crew-rule.service.test.ts \
  server/services/consent-authority.service.test.ts \
  server/services/soft-delete.service.test.ts \
  server/__tests__/recovery-solver.test.ts \
  server/__tests__/new-features/soft-delete-filtering.test.ts \
  --maxWorkers=1
```

The three separately collected cases in
[booking-purge-mysql.test.ts](../../server/__tests__/booking-purge-mysql.test.ts)
are explicitly skipped locally because this workspace has no enabled disposable
MySQL target. They must execute in the native CI matrix. The suite requires
`AIS_DISPOSABLE_DATABASE=true`, `NODE_ENV=test` and a loopback `mysql:` URL whose
database matches `ais_*test`. It creates a randomly named owned schema, copies
only the required migrated table definitions and removes only its owned schema.
It preserves strict SQL mode and copies no source rows.

The native cases exercise the production service with actual MySQL transactions
and nested locking queries: committed payment/ledger/credit/coupon/invoice/offer
rows retain their owners while an unreferenced record is purged; legacy inline
markers retain their owners without new receipt rows; and a further restrictive
reference outside the explicit guard causes both booking and passenger changes
to roll back. The table-copy mechanism preserves native columns/defaults/indexes
but not foreign keys. A separately declared restrictive foreign key is used
only for the rollback case. This suite does not claim to reproduce all
application tables or cross-connection writer scheduling.

The owned relational fixture executes production Drizzle-generated queries
against SQLite. It runs real transactions and predicates, uses a real
restrictive reference for the rollback case, and uses a trigger to reproduce a
change in batch eligibility. It records `FOR UPDATE` and transaction placement,
then removes MySQL's lock clauses for SQLite execution. It adapts the known
null-safe operator, consent upsert, column defaults, JSON decoding and timestamp
encoding boundaries. Early fixture attempts exposed date/JSON driver adapter
differences; those were corrected before the reported red proofs were collected.

**These tests establish behavior and emitted locking protocol, not MySQL lock
scheduling, native schema parity or certification.** The fixture rejects nested
transactions rather than pretending to simulate concurrent MySQL connections.
No native MySQL acceptance, full CI result or whole-suite coverage increase is
claimed by this document. Integrated application/scripts/E2E TypeScript and the
complete required CI suite are the coordinator's remaining validation gates.

Affected-file ESLint with `--max-warnings 0`, Prettier verification and
`git diff --check` passed. The broader active paths identified in the baseline,
including electronic ticket rendering, gates and rebooking, remain candidates
for separate behavior-driven coverage work.

## Remaining retention and coverage gaps

- **Non-cooperating live writer:**
  [compensation.service.ts](../../server/services/compensation.service.ts)
  resolves claim ownership/passenger membership using plain reads before
  inserting a claim. It does not hold the booking lock. The guard cannot promise
  universal race-safe referential integrity: such a writer could insert after
  a purge commits. Locking an absent child-index range alone does not solve a
  later insert. Standard settlement/refund/dispute, wallet/corporate payment,
  credit use, loyalty and ticket/servicing paths use the parent lock, but this
  patch does not redesign every writer or assert concurrency beyond that shared
  protocol. The optional linked `addCredit` helper is also unfenced, but the
  current vouchers router does not pass a booking ID; it is not counted here as
  a demonstrated live linked-credit race.
- **Reference-model boundary:** general operational records (including DCS,
  APIS, baggage and audit/log history), indirect segment relationships, JSON
  references, future tables and legal retention requirements need their own
  policy review. The explicit set above is intentionally financial/document
  focused. Its coverage does not certify every possible booking/passenger link.
- **Query cost:** `payment_receipts.bookingId`, `miles_transactions.bookingId`
  and `loyalty_credit_lots.bookingId` have no dedicated booking lookup index in
  the reviewed schema. A fixed 30-source set is not a latency bound on a large
  history. Index/query-plan and purge batching work remains separate; this
  patch introduces no schema migration.
- **Validation still required:** the three native MySQL cases, integrated
  TypeScript, required CI and fresh complete coverage evidence remain the
  coordinator's gates. Local pass counts do not establish native row-lock
  scheduling or a new repository-wide coverage percentage. Other active
  zero-executed services remain in the coverage backlog.
