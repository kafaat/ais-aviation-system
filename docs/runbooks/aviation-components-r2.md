# Aviation components — R2 implementation

Base: `90e540037dc45221d5b1d77b4a78cfff87db1532` (v1.25.0).
Implements the follow-up study _AIS Additional Components and Gap Solutions_,
13 September 2026. R2 numbers are separate from the original twelve research
patches. Booking, payments, inventory, and the transactional outbox remain the
authorities. Optional integrations do not establish provider acceptance.

| Patch | Scope                                               | Evidence / status                           |
| ----- | --------------------------------------------------- | ------------------------------------------- |
| R2-01 | Persisted wallet account scope for dispute evidence | Implemented; 11 dispute boundary tests pass |
| R2-02 | Resume publication of an existing release tag       | Implemented; 11 recovery tests pass         |
| R2-03 | Atomic gate allocation and conflict prevention      | Implemented; 11 unit and 5 MySQL cases pass |
| R2-04 | Provider-confirmed emergency hotel fulfillment      | Pending                                     |
| R2-05 | Versioned event contracts                           | Pending                                     |
| R2-06 | Provider/API contract laboratory                    | Pending                                     |
| R2-07 | Transport fault acceptance                          | Pending                                     |
| R2-08 | Trace context and data lineage                      | Pending                                     |
| R2-09 | On-call delivery and acknowledgement                | Pending                                     |
| R2-10 | Aviation weather source adapter                     | Pending                                     |
| R2-11 | Advisory optimization and simulation pilot          | Pending                                     |
| R2-12 | ONE Record cargo exchange pilot                     | Pending                                     |

No person, on-call rotation, production database, or provider acceptance is
inferred from local tests. Each patch records its tested scope below.

## R2-01 — dispute account scope

Wallet disputes resolve tenant scope from the persisted user account. Missing
accounts and changed receipt ownership roll back; an explicitly public account
retains `null`. Booking disputes retain the booking's tenant. The focused
`payment-dispute-boundary` suite passes 11 cases, including public and tenant
wallets and the missing-account rollback. These are transaction-double tests;
they do not claim live provider acceptance.

## R2-02 — immutable release publication

The release workflow reuses an already pushed version commit/tag only after
checking its exact parent, version, and absence of code changes. Publication
reads the release by tag before creating it. A retry after an HTTP 500 uses the
same commit; an existing release is preserved. Release mutations are serialized.

For an older tag whose GitHub release is missing, dispatch **Release Automation**
with `resume_tag=vX.Y.Z` and `resume_commit=<full tag commit SHA>`. This path only
publishes that existing, verified tag; it does not bump a version or dispatch a
deployment. Leave these two inputs empty for the normal release flow. Never
move a tag to make recovery pass. The original inert-release-commit guard stays
in the normal flow, and recovery verifies the same boundary independently.

Tests create real temporary Git histories and simulate release API failures,
existing releases, altered packages/code, unrelated sources, and remote tag
drift. No release was published by the local test.

## R2-03 — gate resource authority

`gate-allocation.service.ts` is the allocation writer. Assignment, switch,
release, status changes, and compatibility changes lock the flight (when
applicable), gates in increasing ID order, then assignments. Writes and outbox
receipts share a transaction. The flight-state authority invalidates a gate
reservation when its schedule changes or the flight closes. Gate-change
notifications now use the durable inbox and a consumer receipt.

Migration 0038 only adds columns to `airport_gates` and `gate_assignments`.
Legacy reservations with no occupancy window conservatively block conflicting
allocations until explicitly released and reviewed. Legacy free-text capacity
is not converted into an aircraft approval. Admin Gate Management provides the
exact aircraft identifiers and operator approval reference; active reservations
must be released before changing that policy. Approval references are excluded
from public response contracts.

Reservations are half-open intervals. The default planning interval is two
hours before through two hours after departure; an assignment may supply an
explicit interval covering departure and boarding, capped at 24 hours. This is
a conservative software default, not a measured airport turnaround policy.

Validation: 11 gate boundary cases; a fresh MySQL 8 / Redis acceptance run
completed 50 checks with zero skips, including five R2 cases for competing
flights, adjacent intervals, rollback, canonical schedule invalidation, and
exactly one durable passenger notification. Main and scripts type checks passed;
acceptance configuration also passed. Provider calls: zero.
