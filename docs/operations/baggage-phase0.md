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
