# Transactional audit forward migration

PR #130 is integrated after #129 and #131, on the v1.22.0 main baseline
(`5002bcd78a8819b33977381f7ab38f17a45e9da6`). The owner confirmed on
2026-09-10 that this project exists only on GitHub and has not been deployed.
There is no production database whose history was rewritten or inspected here.

## Immutable history and reviewed scope

All main SQL, hashes, journal timestamps and snapshots from 0000 through
`0013_schema_reconciliation` remain unchanged. The unmerged, undeployed PR #130
fork of 0013 through 0018 was replaced by generated
`0014_transactional_audit_forward`, following main's 0013 timestamp and snapshot.
Old CI databases were disposable fixtures, not production migration evidence.
If any database is later found to have applied that former fork, stop and
reconcile its actual history separately; do not edit its journal to fit this one.

The generated DDL changes exactly seven tables: four new tables
(`load_plan_details`, `mfa_challenges`, `mfa_settings`, `payment_receipts`) and
additional columns/indexes in `bookings`, `outbox` and `refresh_tokens`.
The 88 tables already created by 0013 are not recreated. The preference defaults
already corrected by 0013 remain false without another corrective migration.

The two reviewed data statements from the old payment migration are preserved:
confirmed/completed paid bookings are marked as having reserved inventory, and
active wallets with positive balances are frozen pending funding review. No
balance or payment amount is rewritten. Collection-review receipt states remain
part of the final schema and settlement services.

## Adopting an unjournaled database

`db:baseline` still writes only the journal. Matching the final schema cannot
prove that a data migration ran, so adoption now refuses with
`BASELINE_DATA_REVIEW_REQUIRED` if an active positive-balance wallet or an
unmarked confirmed/completed paid booking remains. It does not freeze balances,
alter bookings or create a journal on this initial refusal.

An operator must review funding and inventory, and separately authorize any data
reconciliation. The wallet check is deliberately conservative for unjournaled
databases: even a claimed legitimate positive balance requires review because
its migration provenance cannot be established. After those conditions are
resolved, adoption can be retried. Keep application writers stopped throughout
inspection/adoption; the migration advisory lock does not stop application
writes, and the sequential reads are not a single atomic production snapshot.

The existing InnoDB engine check and all-or-nothing journal transaction are
retained. Data readiness is checked again before committing the journal.

## Evidence required before merge

Run both guarded history verification and the independent schema catalog audit.
CI must replay all migrations, test adoption refusal/retry and journal rollback,
upgrade a populated previous release, and prove the wallet/booking data changes
and preservation of original money fields. Keep the live MySQL/Redis transaction
suite, backup failure/isolated restore tests, both image scans and browser tests.

Before a first deployment, identify and classify the actual database and run the
guarded migration path. For an existing target, capture a durable backup and
prove restoration on a separate database before authorizing migration. MySQL DDL
can commit before a failure: reverting application Git commits does not revert
its database schema. Never automatically drop the four tables or rewrite the
journal as a rollback. Stop writes, inspect the failed step and choose a reviewed
forward repair or a verified database restoration using the actual backup.
