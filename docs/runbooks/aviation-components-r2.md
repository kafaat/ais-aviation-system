# Aviation components — R2 implementation

Base: `90e540037dc45221d5b1d77b4a78cfff87db1532` (v1.25.0).
Implements the follow-up study _AIS Additional Components and Gap Solutions_,
13 September 2026. R2 numbers are separate from the original twelve research
patches. Booking, payments, inventory, and the transactional outbox remain the
authorities. Optional integrations do not establish provider acceptance.

| Patch | Scope                                               | Evidence / status                                       |
| ----- | --------------------------------------------------- | ------------------------------------------------------- |
| R2-01 | Persisted wallet account scope for dispute evidence | Implemented; 11 dispute boundary tests pass             |
| R2-02 | Resume publication of an existing release tag       | Implemented; 11 recovery tests pass                     |
| R2-03 | Atomic gate allocation and conflict prevention      | Implemented; 11 unit and 5 MySQL cases pass             |
| R2-04 | Provider-confirmed emergency hotel fulfillment      | Implemented; 23 unit and 3 MySQL cases pass             |
| R2-05 | Versioned event contracts                           | Implemented; 65 focused checks and AsyncAPI validation  |
| R2-06 | Provider/API contract laboratory                    | Implemented; real REST and Microcks CI passed           |
| R2-07 | Transport fault acceptance                          | Implemented; TCP fault lab reaches and passes its cases |
| R2-08 | Trace context and data lineage                      | Implemented; 29 unit and 7 MySQL acceptance cases pass  |
| R2-09 | On-call delivery and acknowledgement                | Implemented; 20 unit and 6 MySQL acceptance cases pass  |
| R2-10 | Aviation weather source adapter                     | Implemented; 35 unit and 7 MySQL acceptance cases pass  |
| R2-11 | Advisory optimization and simulation pilot          | Assignment implemented; simulation not started          |
| R2-12 | ONE Record cargo exchange pilot                     | Not started; no cargo domain, no counterparty           |

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
not live supplier acceptance. Microcks and REST both passed in GitHub Actions run 34762907838 on PR #151.
The local environment has no Docker; CI supplies the actual container evidence.

Sources: [Schemathesis stateful testing](https://schemathesis.readthedocs.io/en/latest/guides/stateful-testing/),
[Microcks import](https://microcks.io/documentation/guides/usage/importing-content/),
[OpenAPI fixture conventions](https://microcks.io/documentation/references/artifacts/openapi-conventions/).

## R2-07 — real transport faults and process recovery

Run the existing 53-case MySQL/Redis transaction acceptance on a fresh disposable
database, then `python scripts/contracts/run_faults.py --report <file>`. The
Linux CI job starts digest-pinned Toxiproxy 2.12.0 via Testcontainers; a local
`--toxiproxy-binary` option runs the same verified version without Docker.
Control, receiver and proxy bind only to loopback. No supplier is involved.

Four additional cases exercise the real outbox claim/acknowledgement code and
durable notification consumer across TCP outage, 1-second downstream latency
with a 200-ms sender deadline, SIGKILL after consumer acknowledgement but before
publisher acknowledgement, and recovery in a fresh worker process. The test
advances only its fixture's persisted lease clock to avoid waiting five minutes;
production lease durations are unchanged. An obsolete lease cannot publish.
Three successful transport deliveries produce exactly one notification and
consumer receipt. SHA-256 snapshots of booking, flight capacity, payment and
refund records, wallet balances/transactions and inventory locks stay identical.

Local evidence: baseline 53 passed with zero skips, followed by all four real
Toxiproxy/process cases. This is transport replay evidence, not a simulation of a
new charge or a database commit-response loss. Those financial transaction
boundaries remain covered by the preceding acceptance suite. A missing runtime
fails the dedicated CI job; it does not convert these cases into passing skips.
Sources: [Toxiproxy](https://github.com/Shopify/toxiproxy),
[Testcontainers Python](https://github.com/testcontainers/testcontainers-python).

## Review fixes — six blocking defects found in R2-01…R2-07

Applied on top of `0edab63` after the code review of PR #151. Each fix carries a
regression case that fails without it. No behaviour outside the six defects was
changed, and the remaining review findings are left to the patch authors.

| Defect                                                                                                                                                                                                  | Fix                                                                                                                                                | Regression case                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R2-07 CI job aborted before its first case: `with_network_mode` does not exist in the pinned Testcontainers 4.15.0                                                                                      | `with_kwargs(network_mode="host")`, plus an explicit assertion so a missing API fails loudly rather than skipping the lab                          | The `TCP Faults and Worker Recovery` job now reaches its cases at all                     |
| `invalidateGateAssignments` read the flight's reservations without a lock, so a reservation committed after the caller pinned its snapshot was invisible and silently not invalidated                   | Locking read                                                                                                                                       | `R2 gates: a reservation committed after the canonical snapshot is still invalidated`     |
| Same read, non-empty stale snapshot: the cancel hit current rows while the gate re-sync hit stale ones, stranding a gate on `occupied` with no reservation and naming the wrong gate in `gate.released` | Same fix                                                                                                                                           | Same case                                                                                 |
| Every pre-migration hotel reservation became permanently uncancellable through both the API and the admin screen                                                                                        | `reserved`, `checked_in` and `no_show` are cancellable again when the row carries no provider state at all; `checked_out` stays refused, as before | `R2 hotels: legacy stays cancellable and a repeat after cancellation opens a new request` |
| A same-day or over-30-night hotel _search_ returned HTTP 500 because the strict stay validator was reused for a browsing estimate                                                                       | Separate lenient `estimateNights` for search; `nightsBetween` stays strict where the value becomes a provider commitment                           | `estimates a browsing stay without turning a hotel search into an error`                  |
| Repeating an identical stay after its cancellation returned the cancelled row, and the UI reported it as a recorded booking                                                                             | Terminal rows no longer satisfy the idempotency lookup; the repeat opens the next attempt slot, and each slot stays individually idempotent        | Same hotel acceptance case                                                                |

One change was attempted and reverted: a locking read in `allocateGate`. It is
unnecessary, because `lockFlight` runs first and acquires no snapshot, and it is
harmful, because `FOR UPDATE` over an empty `flightId` range gap-locks and
deadlocks two concurrent allocations for different flights. The existing
acceptance case `concurrent competing flights allocate exactly once` caught it.
The comment there now records why that read must stay plain and must stay second.

Local validation: **55 acceptance checks passed with zero skips and zero provider
calls** on disposable MySQL 8.0.46 and Redis, up from 53. The full unit suite,
all three TypeScript configurations, zero-warning ESLint, Prettier, Gitleaks, the
service catalog check and the event contract check all pass. Removing the gate
fix alone makes its new acceptance case fail, which is how it was verified.

No workflow in this repository triggers on a pull request whose base is not
`main`, so this branch's evidence is local only.

## Review follow-up — the five remaining non-blocking findings

Applied on top of the merge of PR #152. These are the review findings that were
not merge-blocking; the sixth, the blanket OpenAPI error statuses, is left as
recorded because narrowing it correctly needs the real status set of each
procedure and would otherwise break the contract lab.

| Finding                                                                                                                                                                                   | Fix                                                                                                                                  | Regression case                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A provider account or approval mismatch threw inside the claim transaction, so it rolled back with no lease and no backoff and the scheduled task failed on that row every minute forever | The claim reports a blocked row; the backoff and the redacted reason are committed outside the transaction, then the error is raised | `refuses a different provider account and records the block with a backoff`, `blocks an unreadable stored request without a hot retry loop` |
| An unreadable stored `providerRequest` had the same shape                                                                                                                                 | Parsed with `safeParse` and reported the same way                                                                                    | Same                                                                                                                                        |
| The worker page had no ordering, so rows that can never resolve could hold all 25 slots and starve new bookings                                                                           | Ordered by `providerNextAttemptAt` ascending; MySQL sorts NULL first, so a never-attempted booking always leads                      | Empirically confirmed NULL-first ordering on MySQL 8.0.46; combined with the backoff above, blocked rows now rotate                         |
| `assignTransportation` blocked only `cancelled` and `no_show`, so transport could be attached to a stay that was never booked or is being undone                                          | Also refuses `rejected`, `outcome_unknown`, `cancellation_pending` and `cancellation_unknown`                                        | `R2 hotels: unreconciled stays refuse transport and stay visible in the tiles`                                                              |
| `sandbox_confirmed` was in none of the active, pending or cancelled buckets, so those rows vanished from all three tiles while still counting toward the total                            | Counted as outstanding, since a sandbox confirmation is not a real reservation                                                       | Same case                                                                                                                                   |
| The gate router hardcoded `platformAdmin: true`, leaving the tenant check in `lockFlight` dead on every production path                                                                   | Derived from `isAdmin(ctx.user.role)`; unchanged for the platform roles that reach these procedures today                            | Existing gate acceptance and boundary suites                                                                                                |
| The `prerelease` dispatch input no longer reached the release object on the custom-version path, which never receives the `-rc` suffix                                                    | Passed explicitly to the publisher, with the tag suffix kept as the fallback for push-triggered releases                             | `carries the operator's prerelease choice into release publication`                                                                         |

Local validation: **56 acceptance checks passed with zero skips and zero
provider calls**, up from 55. Zero-warning ESLint, Prettier, Gitleaks, and all
three TypeScript configurations pass. As with PR #152, no workflow triggers on a
pull request whose base is not `main`, so this branch's evidence is local only.

## R2-10 — aviation weather source adapter

Migration 0041 adds two tables. `airport_weather_stations` records which ICAO
station reports for an airport, with the operator who recorded it and the
reference they verified it against. IATA and ICAO are unrelated code spaces, so
this mapping is only ever recorded, never derived from an airport's IATA code,
and one ICAO identifier cannot be mapped to two airports. `weather_observations`
stores bulletins with the text as published beside the derived classification,
so any stored category can be re-derived and audited against the bulletin the
station actually issued.

`shared/aviation-weather.ts` holds the decoding and classification as pure
functions. Flight category follows the published FAA ceiling and visibility
boundaries and takes the more restrictive of the two. Three distinctions are
kept deliberately, because collapsing any of them would invent a condition:

- A sky with only few and scattered layers has **no ceiling**, which is not the
  same as a high one.
- An obscured or broken layer reported without a base has an **unmeasured**
  ceiling. That yields no category at all — not the unrestricted one.
- A missing visibility yields no category either.

`server/integrations/aviation-weather.ts` reads the Aviation Weather Center data
API. METAR is an observation and is classified; TAF is a forecast, is stored as
its bulletin text with its issue time, and never receives an observed category.
A field that is present but undecodable rejects the whole report rather than
being nulled, so provider schema drift fails loudly instead of turning into
quietly missing weather. A response describing a station nobody requested is
refused. Requests are bounded to 20 stations, 15 seconds and 2 MB.

Configure `AVIATION_WEATHER_MODE=disabled|sandbox|live`, default disabled, so an
unconfigured deployment fetches nothing. `live` additionally requires
`AVIATION_WEATHER_SOURCE_REFERENCE`: the AWC API is a public service with no
contract or availability commitment to this system, so an operator records which
source they accepted before its bulletins are stored, and that reference is kept
on every stored row. `sandbox` requires `AVIATION_WEATHER_BASE_URL`, because a
sandbox silently pointing at the real service would not be one.

The advisory reports origin and destination coverage as one of four states:
`station_unmapped`, `no_observation`, `stale_observation` or `classified`. An
expired bulletin keeps its text on screen — an operator reading "two hours old"
is better served than one shown nothing — but yields no category and no
concerns. **Missing coverage never produces a weather alert**: an alert saying
the weather is bad when the truth is that no bulletin exists would be a
fabricated observation. Freshness budgets are 90 minutes for a METAR, one issue
cycle plus margin, and 480 minutes for a TAF.

This closes a specific gap: `OperationalAlert` already accepted a `weather`
type that nothing in the system could emit, and the operations agent returned an
empty alert list. `weatherAlertsFrom` is now that producer. Every alert it emits
carries "Advisory only: confirm against the operator's dispatch weather source
before acting". Nothing here changes a flight, booking, gate, inventory row or
payment, and none of it is a dispatch authority.

Evidence: 35 unit and decoder cases, and 7 cases in the live MySQL acceptance
run, which went from 56 to **63 checks with zero skips and zero provider calls**.
The acceptance path proves what the in-memory double cannot — the unique index
behind the duplicate check, `decimal(5,2)` and `timestamp` round-tripping, and
the advisory through real SQL. Removing the unmeasured-ceiling distinction alone
makes two cases fail, which is how that rule was verified. **No request reached
the Aviation Weather Center**; every bulletin in the tests is a local fixture,
and the response schema still needs verification against live responses before
production trust.

## Review follow-up — the blanket OpenAPI error statuses

This was the one review finding from PR #151 left open, recorded as needing the
real status set of each procedure. It is now closed in three parts, each
verifiable rather than asserted.

**Transport statuses are derived, not assumed.** `createRestMiddleware` and the
middleware mounted beside it in `_core/index.ts` establish exactly three
statuses that any REST operation can return: 400, because every route parses
its input with Zod and rejects a non-object query or body before that; 429,
because `createUserRateLimitMiddleware({ scope: "api" })` covers the whole of
`/api/rest`; and 500, because any non-`TRPCError` throw is reported as
INTERNAL_SERVER_ERROR. 401 and 403 continue to come from the generator for
protected routes. Documenting 429 everywhere turns out to be correct — that one
was not padding.

**415 is now documented only where it can occur.** The transport checks the
content type only for methods that read a body, so a GET or DELETE can never
return it. This dropped 415 from all 232 operations to the 122 that use a body,
with no declaration needed from anyone.

**A procedure can declare its own domain statuses.** `errorStatuses` in a
procedure's meta names the statuses it can actually return; the document then
carries the transport statuses plus exactly those, and the generator's default
404 is pruned. Without the pruning the declaration would be decorative. A
procedure that declares nothing keeps the previous permissive domain set, but
every one of those responses is now marked `x-status-undeclared`, so a reader
can tell an allowance from a claim. That is the honest intermediate state:
nothing is silently asserted any more, and owners can declare their procedures
incrementally.

The four notification paths are declared, because the contract laboratory
validates their real responses: `notifications.markAsRead` returns 404 when the
row is absent or owned by another user, and `list`, `unreadCount` and
`markAllAsRead` raise no domain rejection at all. Their documented sets went
from twelve statuses each to six or seven.

Evidence: the REST contract laboratory passes 4 items against the real host with
zero provider calls. Removing the `[404]` declaration from `markAsRead` makes
the lab fail with `UndefinedStatusCode: Undocumented HTTP status code, Received:
404`, which is how the declarations were verified — by HTTP conformance against
a running host, not by reading the code. A new `rest-boundary` case locks the
415 method rule, the pruning and the undeclared marking.

## R2-09 — on-call delivery and acknowledgement

Alert evaluation already existed: `refreshOperationalAlerts` wrote transitions
into `operations_alerts` every minute. Nothing carried one to a person. An
alert sat in that table until somebody happened to open the dashboard, and the
`acknowledgedBy` column had no delivery to acknowledge. Migration 0042 adds the
delivery leg and its receipts.

Three facts are kept separate throughout, because conflating them is the easy
mistake here:

1. **The alert is active** — evaluation said so.
2. **The provider accepted a page** — a delivery receipt. This is _not_ proof
   that a person was reached; nothing in this system can observe that, and the
   status label says so in both languages.
3. **An operator acknowledged it in this system** — the only acknowledgement
   that can honestly be recorded.

`alert_dispatches` holds one row per raise or close, with a `dedupKey` that is
stable per incident and shared by a raise and its matching close. The provider
correlates them by that key, which is also what makes retrying safe: GoAlert
folds a repeat of one key into the incident it already has, so re-sending after
a lost response cannot page anyone twice. That property is asserted against the
provider (`dedupes`) rather than assumed, so a future adapter without it cannot
quietly inherit the retry path — it would need operator reconciliation instead,
as the hotel worker does.

The delivery worker follows the discipline the hotel worker earned: the row
becomes `outcome_unknown` **before** the request, so a crash mid-flight leaves
evidence that a send may have happened rather than a row that looks untouched;
a fenced lease stops two workers delivering the same page; failures take an
exponential backoff capped at thirty minutes instead of a per-minute hot loop
against a provider that is already down; and the page is ordered
oldest-attempt-first, NULL first, so rows stuck behind a long backoff never
starve a fresh alert. After six attempts a dispatch is marked `failed` and kept
— a page nobody can deliver is itself an operational fact — and the scheduled
task raises so an operator sees it.

The alert transition and its dispatch share one transaction: an alert cannot
become active without a queued page, and a rolled-back transition leaves no page
behind. Acknowledging an alert also queues the close, so an operator already
handling it is not paged again by the rotation. A close is never queued without
a raise to close, since a bare close would tell the provider about an incident
nobody opened.

Configure `ONCALL_MODE=disabled|sandbox|live`, default disabled. An
unconfigured deployment pages nobody, and the dashboard then shows an active
alert with no dispatch — the honest picture, not a fabricated receipt. `live`
requires `ONCALL_ACCEPTANCE_REFERENCE`: a rotation that has never been
exercised is not an on-call capability. The provider token travels in an
`Authorization` header, never a query string that proxies and access logs would
capture, and provider errors are never echoed into stored text because they can
quote the request back, credential included.

Evidence: 20 unit and adapter cases, and 6 cases in the live MySQL acceptance
run, which went from 63 to **69 checks with zero skips and zero provider calls**.
The acceptance path establishes the identity index, the transaction coupling,
and real row locks fencing two concurrent workers — removing the lease check
alone makes that case fail, which is how it was verified. **No request reached
an on-call provider and no person was paged**; every send in the tests is a
local double. Who is on call, what the rotation is, and whether anyone answers
remain the provider's business and deployment work.

## R2-08 — trace context and data lineage

### Trace context

Migrations 0043 add `traceId` and `spanId` to both `outbox` and `event_inbox`.
The gap closed is causal: a domain event carried no link to the request that
produced it, so an event that misbehaved could not be traced back to its cause,
and the whole background half of the system was uncorrelated.

`shared/trace-context.ts` implements the W3C `traceparent` header exactly as
specified, dependency-free. **This is not an OpenTelemetry installation**: no
spans are sampled, batched, timed or exported to a collector. The wire format is
the standard one, so adding an SDK later is compatible with everything stored,
but nothing here should be read as claiming distributed tracing is deployed.

Malformed, all-zero, repeated and future-version headers are all treated as
absent and a fresh trace is started, so a hostile or unreadable header can
never be adopted as a trace identity. An inbound trace is continued under a new
span — reusing the caller's span id would merge two spans. The upstream
`sampled` decision is preserved as received; this system is not the sampling
authority.

The context travels in an `AsyncLocalStorage` rather than through every
signature. There are dozens of call sites between an HTTP handler and
`recordEvent`; threading a parameter through all of them would be a large
refactor to move one string, and any site that forgot to forward it would
silently lose the correlation. The store is correct across awaits and cannot
leak between concurrent requests, which a module-level variable could not
promise — there is a test for exactly that.

Three entry points establish a context: the Express middleware (which also
echoes `traceresponse`, safe to return because trace ids are random and carry
no user, tenant or payload data), the cron tick, and the outbox relay. The
relay is the interesting one: each event is delivered **inside the trace of the
request that produced it**, under a new span, so an event recorded by a
consumer continues the original causal chain rather than joining the relay
tick's trace. Where no trace exists, the columns stay null and the ambient
context is used as-is; nothing fabricates an identifier, because a made-up one
would correlate unrelated work.

### Data lineage

Migration 0044 adds `lineage_events`, holding OpenLineage run events in the
specification's own shape, so a later transport can ship exactly what was
recorded. **Nothing is transmitted today** and no lineage backend is configured
or claimed.

The warehouse export job emits START, then COMPLETE with the output's row
count, byte size and sha256 — the same checksum stored on the export row, so a
lineage record can actually verify the bytes served — or FAIL with a bounded
error facet. The run id is derived from the export row rather than random, so a
retried export is the _same_ logical run instead of appearing as several
unrelated ones, and the identity index makes a repeated emission a no-op. A run
with a START and no terminal event is reported as `running`, never as complete.

`EXPORT_INPUT_TABLES` lists the tables each export actually reads, taken from
the queries themselves — including the revenue export, whose inputs are
`bookings` and `financial_ledger` because it reads through `getFinancialDays`,
not a revenue table (there is none). An inaccurate input list is worse than no
lineage graph, because it would be believed. Emission never fails its caller: a
correct export must not be reported as failed because its lineage row could not
be written, and the miss is logged so the gap is visible rather than silent.

Evidence: 29 unit cases (21 trace, 8 lineage) and 7 cases in the live MySQL
acceptance run, which went from 69 to **76 checks with zero skips and zero
provider calls**, completing in about six seconds across three consecutive
runs. The lineage acceptance runs a real export and checks the recorded inputs,
the output checksum against the stored one, and the trace linkage. Making the
run id random alone makes that case fail, which is how it was verified.

## R2-11 — advisory reaccommodation assignment

The system already ranked disrupted passengers by priority, which answers "who
first". It never answered "who on which flight". With several alternatives of
differing capacity and arrival time, walking the ranked list and taking the
best free seat is not the same as an optimal assignment, and it is measurably
worse — the boundary suite carries an instance where greedy costs 19% more, and
that instance was **found by searching the instance space**, not constructed to
flatter the optimiser. Its mechanism is worth stating: greedy lets the
top-priority business passenger take a scarce early _economy_ seat at the
downgrade penalty, displacing an economy passenger into a flight five hours
later; the optimum leaves the business passenger in business on the later
flight and frees the early seat.

`shared/reaccommodation.ts` computes an exact minimum-cost assignment
(Jonker–Volgenant shortest augmenting path with potentials). Exact rather than
heuristic because the output is shown to an operator as _the_ recommendation: a
heuristic that is usually good would make "why was this passenger left behind"
unanswerable. **Optimality is verified against exhaustive search** over 120
random instances, half of them with forbidden pairings — that oracle is
exponential and therefore only usable on tiny matrices, which is exactly what
makes it trustworthy.

Three refusals are deliberate:

- **It never writes.** The service module contains no insert, update or delete
  and calls nothing that writes. The acceptance run asserts every seat counter
  and row count is byte-identical before and after, which is what makes the
  advisory safe to run against live data.
- **It never upgrades.** Moving a passenger into a higher cabin is a revenue
  decision, and an optimiser has no authority to make one. An economy passenger
  facing only business seats is reported as unassigned instead.
- **It never silently drops anyone.** Every passenger appears in the result.
  When seats run out, the unassigned are named with the objective's own penalty
  for leaving them out.

The objective is declared in one exported constant — priority weight, downgrade
penalty, unassigned penalty — and travels with every plan, so an operator can
disagree with the weights rather than reverse-engineer them. An earlier
alternative is priced as zero delay, never as a bonus: a negative cost would
let the optimum chase early arrivals at the expense of everything else.
Availability is read from the inventory authority without taking a hold, and
the code says so: between the advisory and any action a seat may be sold.

Evidence: 13 unit cases including the optimality proof, and 3 cases in the live
MySQL acceptance run, which went from 76 to **79 checks with zero skips and
zero provider calls**.

**Not included**: the simulation half of this package. A SimPy-class
discrete-event model of turnaround or gate contention would need a validated
arrival/service distribution to be worth anything, and there is no measured
operational data here to fit one to. A simulation calibrated on invented
distributions would produce confident numbers about nothing, so it is left
undone rather than approximated.

## R2-12 — ONE Record cargo exchange: not started, and why

This package is deliberately not implemented. Two findings, both checkable:

**There is no cargo domain to expose.** A search of the schema and services for
cargo, shipment, waybill, AWB and consignment finds cargo only as an aggregate
_weight_: `cargoZones` and `cargoDistribution` on the weight-and-balance
tables, and `totalCargoWeight` in the DCS load calculation. There are no
shipments, pieces, waybills, parties or cargo bookings anywhere. Building a
ONE Record server would therefore mean first inventing an entire cargo booking
domain — greenfield product work, not the closure of a gap.

**A pilot needs a counterparty.** ONE Record's value is linked-data exchange
between an airline, a forwarder and a ground handler, each publishing Logistics
Objects at stable URIs and subscribing to each other's. Standing up the
endpoints alone would produce an interface serving objects about nothing, and
no local test could establish that any party accepted it.

That is exactly the failure this study warns about — an interface or a database
row is not a completed service — and the same pattern already present in this
repository: two `OpenWeather` entries sat in the Data API allowlist with no
caller, and `flight_tracking` carried temperature and wind columns with no
source, until R2-10 replaced them with a real adapter.

What R2-12 would need before it is worth starting: a cargo domain with real
shipments, and a named counterparty willing to exchange against a sandbox.
Both are product and commercial decisions, not engineering ones.
