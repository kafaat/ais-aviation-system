# Baggage entitlement Phase 0

Phase 0 prepares structured baggage data. Applying its migrations alone does
not change bag-drop allowance. The application integration is documented in
`baggage-entitlement.md` and activates only explicit, financially verified
items. It does not infer historical rights or approve a commercial scope policy.

## Data contract

- `ancillary_services.weightGrams` is the per-unit catalog definition.
- `booking_ancillaries.weightSnapshotGrams` is the total purchased weight after
  quantity is applied. Once funded, later catalog or quantity changes must not
  mutate this snapshot; a new servicing operation is required.
- `fundedAt` and `fundingReference` are written only by a completed financial or
  authorized no-charge path. Their mere presence is not verification; the
  reference must match that completed path in the same transaction.
- `segmentId` references the booking's own `booking_segments.id` when
  `scopeState=specific_segment`.
- Historical and ambiguous rows remain `scopeState=unresolved`. They grant no
  automatic extra allowance, but an unresolved prior purchase must route to
  operator review before automatic excess charging can proceed.
- `all_segments` is reserved and must not be written until **PENDING APPROVAL —
  F30** is resolved.

`BAG_20KG` and `BAG_30KG` receive reviewed catalog values of 20,000 and 30,000
grams. `BAG_SPORTS` stays undefined. No booking item is backfilled from its
name, code, current catalog row, booking payment status, or legacy metadata.

## Evidence boundary

Order servicing currently records a receipt before application and can route a
collected payment to review when application fails. Entitlement therefore
requires the matching modification to be completed as well as the matching
receipt. `confirmNoChargeService` is represented as `authorized_no_charge`, not
as a fabricated payment.

## Inventory

Run the two read-only queries against an authorized database:

```sh
mysql --defaults-extra-file=/secure/path/client.cnf ais < scripts/audit-baggage-matching.sql
mysql --defaults-extra-file=/secure/path/client.cnf ais < scripts/audit-baggage-summary.sql
```

Do not put database credentials in command arguments. The detailed report can
contain booking and passenger identifiers and must be handled as restricted
operational evidence.

The detail report separates `entitlementReasons` (structural eligibility
deficiencies), `catalogNotes` and `dataNotes`. A valid purchase snapshot remains
valid when the catalog weight is undefined. Rows with notes alone are included
so reconciliation does not hide such purchases. These arrays contain no null
entries. Empty eligibility reasons do not certify funding: the entitlement
authority still verifies the referenced financial path. Cancelled items,
unapproved all-segment scope, missing references and inconsistent segment scope
are explicitly classified. The SQL reports themselves never update rows.

`BAG-MYSQL-REPORT` in the guarded integration runner executes both actual SQL
files against synthetic MySQL rows and checks malformed metadata, catalog-only
notes, scope/funding/status defects, counts and unchanged purchase rows. Its
success must be established by CI; static source assertions are insufficient.

Catalog definitions already ship in journaled migration `0053`; moving that
applied migration into a manual script would alter migration history and is not
part of this follow-up. There is no historical purchase backfill.

## Roll forward and recovery

The schema migration is additive. If application rollout must be reverted,
restore the earlier application while retaining the nullable columns. Dropping
columns after writers begin using them destroys evidence and requires a
separate, reviewed archival migration; `DROP COLUMN` is not the routine
rollback.

Phase 0 is complete when migrations replay on an isolated MySQL database, the
schema snapshot matches, only the two catalog rows receive defined weights,
booking items remain unchanged, and both reports classify synthetic data
correctly. This does not activate extra baggage at bag drop.
