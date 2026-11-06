# DCS local readiness and external acceptance boundaries

This record describes the A3 remediation scope for CONS-03, OPS-06, UI-07,
INT-03 and INT-06. It does not assign an accepted source SHA, certify equipment,
or replace the forensic ledger's external acceptance requirements.

## Bag-return grants: CONS-03

`BagReturnGrants` is the administration consumer for
`dcsOperations.bagReturnGrants` and `dcsOperations.setBagReturnGrant`. The route
must use `ProtectedRoute` and the page's role guard, with navigation visible to
`admin`, `super_admin` and `airline_admin`. An `AdminRoute` wrapper would wrongly
exclude the scoped airline administrator. The API remains authoritative:
`airlineAdminProcedure` and the service enforce role and tenant scope.

The witness flight determines the tenant, carrier and departure station.
Creation requires eligible operations/administration staff in that tenant.
Revocation can remove an existing grant after the target staff member becomes
ineligible. Listing is paginated, restricts the grant scope, and withholds staff
details that no longer belong to the current tenant.

The current grant model has an `enabled` flag and no expiry column. Access lasts
until revoked; the UI states that lifetime explicitly. It does not present a
client-only expiry that the server would ignore. Expired sessions and changed
role/tenant authority still fail through the normal middleware and service.

Retries of an unchanged command retain their idempotency key. After success or
replay, the UI rereads current grants instead of treating the original receipt
as proof that access is still enabled. The handover service checks the current
grant before replay, so a prior successful return command cannot bypass later
revocation. A stale open departure desk refreshes permissions after a rejected
handover; the return and registration components have distinct React keys so
removing the former does not leave its controls in the DOM.

`BagReturnGrants.test.tsx` exercises the real React component, browser tRPC
serialization, authorization middleware and grant services with a relational
storage double. `DcsDesk.test.tsx` exercises the stale-open handover response
through the real browser client with substituted HTTP responses. Existing
`dcs-operations.test.ts` covers authoritative handover revocation and replay.
These are separate layers of evidence, not native concurrency or a physical
baggage handover.

## Seat remapping: OPS-06

The [protected-state remap policy](dcs-remap-policy.md) resolves the engineering
distinction between an incompatible remap and a compatible remap that retains
an operational block. The runtime remap rules are unchanged. The old blanket
refusal wording is retained in the ledger and is not reported as literally
satisfied. Actual carrier/station policy approval is not inferred from a local
layout being active or from a software test.

## Printing, scanners and custody: UI-07 / INT-03

| Evidence available locally                                                                                                                                                                                      | Limit of that evidence                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `KioskBagTag.test.tsx`: same-version revalidation, stale-document refusal, real barcode rendering, print-dialog failure, explicit unconfirmed output, two-minute privacy cleanup and abandoned request handling | `window.print` is substituted. This does not establish physical paper output, readable margins or a scanner result.                                                |
| Existing `e2e/vrs-kiosk-tags.spec.ts`                                                                                                                                                                           | Browser coverage must be executed and attributed separately. File presence is not a result, and a browser print preview is not a physical print.                   |
| `scripts/acceptance/kiosk-printer.ts` and the station procedure in `provider-acceptance.md`                                                                                                                     | A diagnostic label and text comparison support a field test. They do not supply printer telemetry, authenticate a scanner observation or certify production stock. |
| Local baggage identity, signed device evidence, duplicate/replay and closeout checks                                                                                                                            | Software authority is separate from a witnessed carrier/station/handler workflow and its custody records.                                                          |

External acceptance still requires an identified station, carrier, printer and
independent scanner; device/firmware/driver and stock details; the source and
request identity; UTC times; witnessed output and margins; matching barcode and
bag/passenger/sector identity; and retained failure, timeout/retry and custody
closeout observations. Use the existing
[station field procedure](provider-acceptance.md#station-printer-and-scanner-field-check)
and [baggage acceptance boundary](baggage-r753-acceptance.md). Missing equipment
or unexecuted field checks remain blocked or not run. No such physical receipt
was produced by this remediation.

## Load plans: INT-06

The legacy DCS load calculation and approval paths remain explicit development
simulations. `requireDemoCapability` refuses them in production even when the
demo flag is set. Controlled aircraft require the separate load-sheet workflow
and dispatch acceptance. No approved aircraft profile or production dispatch
authority is supplied here.

The bounded local correction addresses stale simulation readiness:

- Plan creation and approval/finalization take the same flight lock.
- Approval/finalization selects the latest calculation, with the row ID as a
  deterministic tie-breaker for equal timestamps.
- The transaction recomputes passenger and baggage aggregates for the current
  sector manifest and checks the current aircraft limits. Changed totals or
  limits require a new calculation; an old `withinLimits` flag is insufficient.
- Repeated successful state transitions preserve the original actor and time.
  A finalized plan cannot be changed back to approved.
- Persisted whole-kilogram fields accept only finite, nonnegative whole
  kilograms, and malformed stored cargo cannot be approved.

`dcs-load-plan-readiness.test.ts` executes production aggregate queries and
transactions against the SQLite relational fixture. It covers late passenger
and baggage changes, stale finalization, changed limits, reissue, timestamp
ties, current-sector membership, replay metadata and the production gate.
The controlled-sheet and simulation-boundary suites provide separate evidence
for edition/aircraft changes, limits and production refusal. SQLite records
lock statements but does not establish MySQL lock contention or native
concurrency. No new native concurrency receipt is claimed for this correction.

Production acceptance still needs the approved aircraft/tail/profile and
weight assumptions, accepted source data and revisions, actual passenger and
baggage change scenarios, native concurrency evidence, reissue behavior and
the accountable operating authority's acceptance for the station and aircraft.
The simulator's `approved` or `finalized` status does not close those conditions.
