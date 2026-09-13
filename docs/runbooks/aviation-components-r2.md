# Aviation components — R2 implementation

Base: `90e540037dc45221d5b1d77b4a78cfff87db1532` (v1.25.0).
Implements the follow-up study _AIS Additional Components and Gap Solutions_,
13 September 2026. R2 numbers are separate from the original twelve research
patches. Booking, payments, inventory, and the transactional outbox remain the
authorities. Optional integrations do not establish provider acceptance.

| Patch | Scope                                               | Evidence / status                                      |
| ----- | --------------------------------------------------- | ------------------------------------------------------ |
| R2-01 | Persisted wallet account scope for dispute evidence | Implemented; 11 dispute boundary tests pass            |
| R2-02 | Resume publication of an existing release tag       | Implemented; 11 recovery tests pass                    |
| R2-03 | Atomic gate allocation and conflict prevention      | Implemented; 11 unit and 5 MySQL cases pass            |
| R2-04 | Provider-confirmed emergency hotel fulfillment      | Implemented; 23 unit and 3 MySQL cases pass            |
| R2-05 | Versioned event contracts                           | Implemented; 65 focused checks and AsyncAPI validation |
| R2-06 | Provider/API contract laboratory                    | Implemented; real REST passed; Microcks awaits CI      |
| R2-07 | Transport fault acceptance                          | Pending                                                |
| R2-08 | Trace context and data lineage                      | Pending                                                |
| R2-09 | On-call delivery and acknowledgement                | Pending                                                |
| R2-10 | Aviation weather source adapter                     | Pending                                                |
| R2-11 | Advisory optimization and simulation pilot          | Pending                                                |
| R2-12 | ONE Record cargo exchange pilot                     | Pending                                                |

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

## R2-04 — hotel requests and supplier receipts

Migration 0039 extends the existing hotel booking authority with request identity,
approved quote, provider receipt and fenced delivery lease. Existing `reserved`
rows stay visibly unverified; their local EH numbers are never adopted as supplier
confirmations. New requests bind the booking, passenger, tenant and current flight
membership, validate date direction, and serialize idempotent commands. They start
as `requested`, without a confirmation number. Passenger payments are unaffected.

The Hotel Management panel records an accommodation request, retrieves a Hotelbeds
CheckRate quote, displays the exact room/board/dates, procurement amount, terms and
cancellation policies, and requires explicit operator approval. The operator must
supply a rate key from their authorized supplier search and a verified hotel/room
mapping reference. Availability search and supplier content mapping are prerequisites,
not an inferred mapping from local hotel names. The bounded adapter supports one
adult, one room, RO/BB board, net-model SAR rates; it rejects commissionable,
mandatory-selling-price, resident, package, card-required and foreign-currency rates.
The quoted net procurement cost does not erase local incidentals described in the
supplier terms. Transport remains a separately requested service.

The `hotelFulfillment` worker persists `outcome_unknown` **before** its first booking
POST. Retries query the same client reference and then verify booking detail; even
an empty lookup never authorizes another POST. A pre-send crash can therefore
require an operator/provider reconciliation. Cancellation uses a fee simulation,
a separately approved maximum fee, and persists `cancellation_unknown` before
DELETE. Simulation is never a cancellation acknowledgement. A lost write response
is reconciled by reading; writes are not automatically repeated. Increasing a
cancellation ceiling requires another explicit admin command and is refused while
a provider operation holds the lease. Provider account changes fail closed.

Configure `HOTELBEDS_MODE=disabled|sandbox|live`, `HOTELBEDS_API_KEY` and
`HOTELBEDS_SECRET`. Live mode additionally requires `HOTELBEDS_ACCEPTANCE_REFERENCE`.
Keep the same supplier account while requests are unresolved. Default is disabled.
Sandbox receipts produce `sandbox_confirmed`, explicitly not a property reservation,
and are excluded from actual SAR expense totals. Live totals derive from persisted
supplier receipts, including actual cancellation fees. The former synthetic hotel,
booking and cost fallbacks are removed from the admin page.

Source contracts: [Hotelbeds workflow](https://developer.hotelbeds.com/documentation/hotels/booking-api/workflow/),
[pricing models](https://developer.hotelbeds.com/documentation/hotels/knowledge-base/pricing-models/),
and the [OpenAPI file linked by Hotelbeds' own reference page](https://bitbucket.org/ApiPortalHotelbeds/apitude-openapi/raw/master/OpenAPI-Hotel-BookingAPI-3.0.yaml).
The linked API 1.0 schema calls CheckRate's hotel field `hotels`; the adapter also
accepts the singular `hotel` envelope and rejects an ambiguous double envelope.
Schemas and responses still need verification against the contracted account.

Evidence: 23 unit/HTTP-boundary cases and a real MySQL/Redis acceptance run with
53 checks, zero skips, including three hotel cases. Fake supplier replies exercise
ambiguous outcomes and concurrent claims; **no live supplier calls were made**.
Property voucher certification, account-specific pricing, legacy manual receipts,
local fees and actual transport acceptance remain deployment/operator work.

## R2-05 — versioned event envelopes

Migration 0040 gives both outbox and inbox a persisted `schemaVersion`, defaulting
to 1 for legacy rows. Producers normalize JSON and validate before inserting.
Consumers reject unsupported versions before effects and compare the version as
part of the stored receipt identity. Ten booking-confirmation, gate and hotel
event types have explicit additive v1 payload contracts. Other legacy event types
retain a clearly labelled JSON-object envelope contract; their domain payloads
are not claimed to be fully typed.

Set `OUTBOX_MESSAGE_FORMAT=cloudevents` only when the receiver is ready. The default
`legacy` format preserves existing integrations. The existing authenticated
`/api/events/inbox` accepts both formats, validates source/tenant/subject/schema
consistency and the idempotency header, and routes to the same durable consumer.
CloudEvents exports exclude retry counts, lease tokens and database diagnostics.
Its stable source and ID identify retries; the occurrence time comes from the
persisted outbox row. A public event omits the tenant extension rather than
sending a null extension value. This is an AIS-controlled receiver, not permission
for arbitrary third parties to issue booking or payment events.

`docs/architecture/domain-events.asyncapi.json` is generated from the runtime
contracts. Run `node --import tsx scripts/generate-event-contracts.ts` after a
reviewed additive v1 change; `--check` is required in Production Gates. A breaking
payload change needs a new supported version and producer/consumer migration.
The same workflow now type-checks **all scripts**, alongside acceptance.

Validation: 65 focused tests including a real HTTP structured-mode request,
unsupported-version and metadata rejection, and producer/consumer regressions;
53 real MySQL/Redis checks, zero skips. The generated document passes the official
AsyncAPI 3.0 JSON schema using jsonschema 4.26.0. No external broker is required.
Sources: [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md),
[structured JSON](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md),
[AsyncAPI 3.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0).

## R2-06 — executable contract laboratory

`python scripts/contracts/run.py all --report <directory>` runs Schemathesis
4.27.0 against the real published REST middleware, database-backed mobile sessions
and a fresh disposable MySQL database, then starts a digest-pinned Microcks 1.13.2
container through Testcontainers 4.15.0. Install the isolated, pinned Python
requirements in `scripts/contracts/requirements.txt`. The database must be empty,
loopback, named `ais_*_test`, and explicitly marked disposable. No provider keys
are needed. Missing Docker fails the requested Microcks phase; it never counts as
a passing or skipped acceptance. Component Labs runs both phases on pull requests.

The REST phase has 35 generated positive and 35 generated negative cases, plus
eight state-machine examples of read/replay/read-all/unread-count and cross-user
isolation. It exercises only four published notification paths. Authentication
uses explicit valid, absent and invalid bearer fixtures; random cookie syntax is
not the target. Negative generation covers declared query parameters; unknown
query keys are separately verified as ignored, matching the existing Zod and
OpenAPI query semantics. No unexported tRPC procedure is claimed covered.

This found and fixed fractional pagination causing MySQL HTTP 500, the generated
error schema rejecting real Zod issue metadata, and missing documented resource
not-found responses. All four local REST groups pass against real MySQL/Redis.
Microcks imports bounded synthetic provider examples and tests the real Hotelbeds
adapter over HTTP: quote, booking, lookup, cancellation simulation/acknowledgement,
foreign currency and wrong reference. Its fixture HTTP override exists only in
the laboratory; production supplier hosts remain fixed. These are wire fixtures,
not live supplier acceptance. Local Microcks execution awaits Docker/CI.

Sources: [Schemathesis stateful testing](https://schemathesis.readthedocs.io/en/latest/guides/stateful-testing/),
[Microcks import](https://microcks.io/documentation/guides/usage/importing-content/),
[OpenAPI fixture conventions](https://microcks.io/documentation/references/artifacts/openapi-conventions/).
