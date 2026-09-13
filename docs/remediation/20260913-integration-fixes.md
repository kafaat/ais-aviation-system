# Integration remediation

Base: `c4638b1` (audit PR #147 merged). This work closes findings in the
[dated audit](../audits/20260912-integration-review.md); historical evidence remains unchanged.

## Patch 1 — CI and secret detection

- Gitleaks exceptions match complete synthetic secret values, never adjacent text.
- CI installs CLI 8.24.3 with its pinned archive checksum; no Node 20 compatibility override.
- The real scanner passes all eight policy controls. `check:scripts` covers every TypeScript script.

## Patch 2 — Passenger departure control

- Web, kiosk and seat-map check-in share one transaction and lock order.
- A confirmed paid reservation, a current itinerary segment, the 48h–1h check-in
  window, document clearance and a real seat in the booked cabin are required.
- Passenger/flight state lives in `seat_inventory`. `bookings.checkedIn` means
  **any** checked-in passenger/leg, protecting itinerary changes until all are offloaded.
  The old passenger seat field projects the primary leg only.
- Boarding tokens contain flight identity, document/itinerary fingerprints and a
  check-in nonce. Online verification rejects changed or revoked state. Signature
  validation alone is not boarding authorization and does not prove airport acceptance.
- Migration 0032 adds a nullable nonce. Historical checked-in seats require offload
  and re-check-in before issuing a new pass; no existing state is silently certified.
- Check-in displays real inventory and signed QR codes per leg. Booking creation
  persists optional physical seat selections with its invoice and passengers.
- Self-service only offers seats without an additional seat charge. Chargeable
  seat changes need a priced, settled ancillary entitlement before enabling them.

Validation: disposable MySQL/Redis regressions for R01/R02/R03/R04, secondary-leg
statistics, nonce revocation, cancellation, concurrent seat claims, check-in
windows and booking-seat persistence; six cryptographic unit tests passed.
No external provider or airport calls were made.

## Patch 3 — One inventory authority across channels

- Availability adjustments lock the flight, account for reserved itinerary legs,
  legacy allocations and all active holds, and record an event with the actor.
- Waitlist offers use expiring canonical holds. Decline/expiry release the hold;
  customer acceptance transfers it once to a pending booking. Only settlement
  decrements inventory. Both former waitlist writers use the same offer service.
- Group approval is a temporary allocation to an identified organizer, not proof
  of collection. The organizer enters every passenger and checks out against the
  approved invoice. A group cannot consume an existing customer's checkout hold.
- Scheduled cleanup releases group/waitlist allocations and physical seats from
  expired unpaid checkout holds. Failures remain visible to the scheduler.
- Migration 0033 adds nullable allocation links. Old offered waitlist rows and
  confirmed groups without links require an operator's inventory reconciliation;
  their inconsistent historical capacity writes cannot safely be inferred.

Validation: R06/R10/R11 plus repeated decline, expiration, hold reuse rejection,
waitlist-to-paid-booking handoff, group invoice settlement and physical-seat
expiration passed on disposable MySQL. The runner now covers ten scenarios.

## Patch 4 — Flight identity and atomic operational transitions

- Tracking by ID queries that flight directly even when its number is reused.
- Status, schedule, history, disruption identity and the outbox commit together.
  Repeated cancellation is idempotent; affected-booking membership includes all
  active itinerary legs and excludes superseded primary-flight references.
- Delay commands preserve planned duration unless a revised arrival is supplied.
  Invalid schedules roll back. Changed schedules/cancellations remove crew
  assignments and invalidate the saved tail schedule digest pending reassignment.
- Passenger disruption reads include secondary itinerary segments.

Validation: R05, R07/R08 (including an injected history-write failure), and R12
passed on MySQL; thirteen regression scenarios and six crypto tests pass.

## Patch 5 — Resumable refunds and independent event effects

- Flight cancellation captures durable booking jobs; each original Stripe payer
  receives a saved refund request. Provider acknowledgement, local cancellation,
  and completed refunds remain separate states. Unpaid cancellations are excluded
  from refund counts. Unknown outcomes reconcile provider history with stable keys.
- Split funding can be cancelled only when every remaining payer balance has its
  own cancellation request. Missing original collection evidence requires review.
- Each event consumer has its own durable receipt. Local effects and receipts
  commit together; external effects use fenced leases and stable provider keys.
  Email failure no longer prevents loyalty, notifications or external-bus delivery.
  Unregistered envelopes are archived without claiming domain handling.
- Booking miles and tier points converge on net posted funding. Partial/full
  refunds, repeated delivery and late confirmation cannot inflate awards. A refund
  after redemption can leave a negative balance; refunds are not redemptions.
- Migrations 0034/0035 preserve existing receipts and add cancellation jobs,
  booking accrual balances and consumer delivery receipts.

Validation: fifteen MySQL scenarios and six crypto tests pass. R09 covers two
original payers, timeout after provider success, restart/reconciliation and no
extra provider create or ledger write. R13 covers independent effects, partial and
full refunds, duplicate/reordered delivery and archive-only event semantics.
Provider calls in these tests are synthetic adapters, not live acceptance.

## Patch 6 — Itinerary documents and seat eligibility

- Ticket documents read the owned, paid itinerary under the same booking/flight
  locks used by departure control. One local ticket reference is persisted per
  passenger; secondary legs retain their own route, time and seat.
- Boarding PDFs embed the state-verified signed boarding token for the selected
  leg. The web projection is checked against the issued token before returning.
  Calendar downloads include every active leg with stable, escaped event IDs.
- Seat selection and seat changes require the selected leg's live hold or a
  funded reservation. Expired checkout holds cannot retain a physical seat.
- AIS receipt/reference numbers are described as local documents; they do not
  claim external airline ticket issuance or airport boarding acceptance.

## Patch 7 — Operational feasibility inside recovery

- Recovery proposals, approvals and execution share a snapshot containing the
  tail assignment, current maintenance release, rotation continuity, crew roster,
  qualifications, duty/rest checks, medical validity and approved rules.
- Stored source evidence is usable only while its separately registered
  authorization is current and scoped to the operator and tenant. Uploading a
  signed package cannot register its source or extend authorization.
- Operator locks serialize schedule, crew, tail and recovery writers. Changed or
  expired evidence rejects execution instead of silently carrying an old approval.
- Persisted recovery plans have an operator read path and retain execution
  receipts for duplicate requests.

## Patch 8 — Durable operations and the operator screen

- Migration 0036 adds observation batches and durable alerts. API response
  observations persist every ten seconds with deduplicated batch IDs; workers
  persist dependency checks and expose a Kubernetes liveness probe that rejects
  missing or stale readiness evidence. These are observations, not contractual SLA.
- `/admin/operations` exposes incomplete events with consumer receipts, pending
  cancellations, current sources, scheduler successes, runtime capability
  evidence, alerts, recovery review/approval/execution, signed evidence import,
  tail assignment, flight economics and premium experiment results.
- Reasoned event replay retains completed effects and records its actor. A
  cancellation can re-enter planning only before provider requests exist; existing
  financial requests require reconciliation. Both commands enforce tenant scope.
- Capability availability uses observed deployment evidence; unknown readiness
  stays nullable. Ownership is an explicit, separately accepted assignment.
- The topology and recovery runbook now describe MySQL, separate Redis roles,
  API/worker authorities and external acceptance requirements. No domain owner,
  on-call rota or provider certification is invented.

## Patch 9 — Regression gates and accounting concurrency

- Older mocks now model transaction boundaries and complete domain state.
  Source-text assertions for group/waitlist atomicity were replaced with rollback
  checks; tenant and passenger rejection also run against the actual router/MySQL.
- Redemption locks the loyalty account and requires a positive integer. Two
  simultaneous redemptions cannot spend one balance; a subsequent refund retains
  the negative net balance instead of making the spent miles free.
- CI runs the remediation acceptance in a separate empty database and retains its
  JSON evidence. The historical audit runner remains historical evidence; it is
  not used as a passing regression gate because it asserts the former defects.
- Asset budgets now measure the actual minified Vite outputs without bundling
  them again through webpack. The React/UI vendor and charts patterns match the
  configured chunks; the nonexistent separate UI chunk is covered by the existing
  300 kB vendor budget. Existing total/entry/vendor/chart limits are unchanged,
  and the application build job now enforces the size gate.

## Closure map

| Audit findings                                              | Implemented patches                                                | Executable evidence                                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A01–A04: departure, UI, eligibility, itinerary legs         | 2, 4, 6                                                            | R01–R04, C01–C03, R07/R08; signed token/PDF/calendar checks                                                                     |
| A05: capacity overrides                                     | 3                                                                  | R06                                                                                                                             |
| A06: waitlist release and handoff                           | 3                                                                  | R10, C04; rollback tests                                                                                                        |
| A07: group allocations                                      | 3, 9                                                               | R11, R17; rollback tests                                                                                                        |
| A08: resumable payer refunds                                | 5                                                                  | R09; flight cancellation service tests                                                                                          |
| A09–A11: flight identity, atomicity, schedule               | 4                                                                  | R05, R07/R08, R12                                                                                                               |
| A12: net loyalty after refunds                              | 5, 9                                                               | R13, R18                                                                                                                        |
| A13: independent event effects                              | 5, 8                                                               | R13, R16; delivery failure and replay tests                                                                                     |
| A14: secret scanning                                        | 1                                                                  | Eight real Gitleaks positive/negative controls                                                                                  |
| Missing feasibility, operations visibility, worker liveness | 7, 8                                                               | R15, R16; executable worker probe test                                                                                          |
| External adapters/acceptance and organizational ownership   | Acceptance interfaces, explicit blocked/unknown state and runbooks | Real provider, device and organizational acceptance remains required; see [prerequisites](../operations/provider-acceptance.md) |

Local validation on 2026-09-13: **1,920 passing tests, three pre-existing skips**;
the coverage gate passed without lowering thresholds (24% lines, 19.27% branches,
20.4% functions). The separate MySQL/Redis remediation runner passed **19
scenarios** and six cryptographic tests. Production API/worker/client builds
passed. The schema contains **37 committed migrations and 146 tables**.
All **16 migration replay scenarios**, the existing **44 live transaction
acceptance checks**, eight Gitleaks policy controls and 15 backup/worker probe
tests also passed. ESLint passed with zero warnings; TypeScript passed for the
application, acceptance runner and all scripts. No coverage or lint budget was relaxed.

The original twelve research patches were already present at the audit base;
these nine remediation patches close their integration defects and add missing
software connections. They do not establish representative forecast accuracy,
physical airport acceptance, external fulfillment contracts or operational sign-off.

## Patch 10 — Conserved loyalty credit and family transfers

- Migration 0037 adds credit lots and an initialization marker without rewriting
  historical balances. Each earned or bonus credit is partitioned into available,
  spent, expired and reversed miles. Spending consumes the earliest expiring lot.
- Expiration consumes only unused credit once. Refunding expired credit has no
  second balance debit; refunding already spent credit recovers other available
  credit before creating debt. New credits repay that debt before becoming spendable.
- Bonus grants, redemption, booking reconciliation, expiration and family transfers
  lock the same account. A family contribution writes the personal ledger, credit
  lots, member contribution, pooled balance and outbox event in one transaction.
  The family screen reads the stored contributed pool; groups with a nonzero pool
  cannot be deleted and silently discard that balance.
- Legacy adoption replays the original ledger and checks every recorded balance.
  An unexplained balance, repeated historical expiration or an unrecorded family
  deduction remains unchanged and requires reconciliation. The expiration job
  reports failure with the affected user identity while still processing other
  accounts; it no longer reports success after a storage or reconciliation error.

Validation: 14 loyalty unit tests, 22 disposable MySQL remediation scenarios and
six boarding-pass cryptographic tests passed. R19 covers spending, expiration,
refund replay and debt repayment; R20 covers concurrent family transfers/bonuses,
rollback and funded-group deletion; R21 covers valid and invalid legacy adoption.
The migrated schema has 38 migrations and 147 tables. See the [legacy reconciliation procedure](../operations/loyalty-reconciliation.md).
Full-suite results below are separate from this focused validation.
