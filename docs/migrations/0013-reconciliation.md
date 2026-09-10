# Schema reconciliation after 0012

This change reconciles the committed MySQL migration history with the application's
complete Drizzle exports. It continues issue #116; it does not certify the schema
of any existing production database or implement the separate #111 ticket/seat
uniqueness change.

## Measured scope

- Previous release: v1.20.26, commit ef2a2dba476e51e2878fda5b88a86b5ac2f9ffa5.
- 0000 through 0012 SQL files and snapshots remain byte-for-byte unchanged.
- 0012 contains 20 tables and 253 columns.
- Current exports contain 108 tables and 1,450 columns: 102 literal declarations
  in schema.ts plus six re-exports from chat-schema.ts. The original text scan
  missed those six tables. The reconciliation creates 88 tables.
- The generated reconciliation also adds columns/indexes to existing tables,
  widens the payment-method enum, tightens legacy nullable fields, and makes the
  existing favorite-route and flight-review indexes unique.
- SQL and 0013_snapshot.json were generated together using locked Drizzle Kit
  0.31.10. Three generated MODIFY COLUMN clauses were corrected to retain
  DEFAULT false (wheelchairAssistance, extraLegroom, smsNotifications); this
  serializer version omits false defaults in those clauses. The live database
  verifier requires the defaults recorded in the snapshot.

## One deployment path

CI test setup, E2E setup, the migrator image and Kubernetes migration commands now
all invoke `pnpm db:migrate` or its identical Node entrypoint. They no longer
initialize the acceptance database with schema push. Keep `db:push` for disposable
local prototyping only; it is not a release migration path.

The migrator obtains a database-specific MySQL advisory lock, verifies that the
stored journal is an exact prefix of the committed SQL hashes and timestamps,
and compares physical tables, column types/nullability/defaults/auto-increment/
on-update behavior, primary keys, index column order and uniqueness with that
prefix's snapshot. Unrecognized views, generated columns, expression/prefix/
invisible indexes and foreign/check constraints fail closed instead of being
silently ignored. Extending the schema to those features requires extending the
verifier too. Charset/collation defaults are not specified by this schema contract.

Before the first DDL statement it rejects NULL values incompatible with new
NOT NULL constraints and duplicate groups incompatible with new unique indexes.
MySQL's multiple-NULL unique-index semantics are preserved. It never deletes or
repairs customer data. After applying SQL it verifies both the journal and the
physical target schema. Re-running a fully applied migration is a no-op.

MySQL DDL is not transactional. Use a maintenance window with application writes
quiesced for a production upgrade; the advisory lock serializes migrators, not
application writers. A failed or partially applied migration fails subsequent
preflight rather than being silently retried/adopted.

## Operator procedure

Use the candidate's migrator image and a database account with metadata read
access for the first two steps. Do not put credentials in a report or commit.

1. Back up the database and retain the previous release and current journal.
2. Run `node --import tsx scripts/db/migrate.ts preflight` with DATABASE_URL set.
   This reads schema/journal and aggregate conflict counts; it does not execute
   DDL or change journal rows.
3. If MIGRATION_DATABASE_DRIFT or MIGRATION_HISTORY_MISMATCH appears, stop.
   Inventory the existing objects against the last applied snapshot and 0013.
   Databases previously provisioned by push or legacy SQL must be reconciled from
   their actual state. Do not mark 0013 applied, rewrite old hashes, or blindly
   execute the CREATE TABLE statements over those objects. No production
   inventory was available while preparing this change.
4. If NULL/unique conflicts appear, resolve them through a separately reviewed
   data repair, then repeat preflight. No automatic deduplication is provided.
5. With application writes stopped and a successful preflight, run
   `node --import tsx scripts/db/migrate.ts migrate`, followed by
   `node --import tsx scripts/db/migrate.ts verify` before restarting writers.

The deployed images contain no npm/npx or pnpm installers. The migrator retains
local tsx and Drizzle, and its offline image check loads the guarded entrypoint
and verifies all schema exports. In a development checkout, the equivalent
`pnpm db:preflight`, `pnpm db:migrate` and `pnpm db:verify` shortcuts remain available.
Both final images must pass the HIGH/CRITICAL Trivy gate in pull requests and
the publishing workflow. Security reports are retained with Docker build evidence.

## Verification and future migrations

Production Gates runs both empty-database replay and previous-release upgrade,
then checks the physical MySQL schema. `drizzle-kit check` alone does not check a
live database. `pnpm db:test-migrations` creates and removes its own randomly named
CI database to prove row preservation, duplicate/NULL refusal before DDL,
unjournaled-table rejection, hash rejection, locking, idempotency and detection of
physical column loss. Never run this fixture against a production MySQL service.

The unit guard uses Drizzle's serializer to compare the complete exported schema
with the latest snapshot, including columns, indexes and constraints.

For a future narrow change, declare the exact affected tables before generation:

```sh
pnpm db:generate --name=operational_uniqueness --tables=passengers,seat_inventory
```

Generation refuses unexpected table changes before writing migration artifacts.
Review generated SQL, retain historical bytes, then repeat all live replay gates.
Issue #116 remains open for production-state classification and the subsequent
separate uniqueness migration.
