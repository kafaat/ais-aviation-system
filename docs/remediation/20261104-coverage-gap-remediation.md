# Coverage gap remediation — 4 November 2026

This change follows the 38 findings identified in `test-coverage(2).zip` and is
reviewed in [PR #268](https://github.com/kafaat/ais-aviation-system/pull/268).
The work adds executable evidence at the boundaries named by the audit and fixes
defects reproduced by those tests. A test added to this change is accepted only
when its required job succeeds on the revision being reviewed.

## Scope and original evidence

The supplied archive has SHA-256
`ef038e676c228c39f65ac4bf6906ec0231b9848f0b57174a0de1674187906452`.
Its coverage timestamp is `2026-11-04T12:52:07.091Z`. JSON, LCOV and Cobertura
agreed for all 802 source files: 17,990 of 41,204 lines, 18,824 of 43,687
statements, 3,959 of 9,703 functions and 14,391 of 35,777 branches executed.
The archive did not contain a commit identity, invocation, exit status or test
results. Those measurements therefore describe that archive, not a proven
baseline commit for the current branch.

Implementation started from main commit
`538a577923175a84eecc3a7bf0994e508b083ec0`. Six implementation workstreams covered
authentication, finance, passenger UI, operations, reports, and process/worker
lifecycle. They used separate worktrees and shared reviewed commits through the
integration branch. The available concurrency was three workers plus the
coordinator; six workers ran in overlapping waves. The coordinator handled the
payment API/webhook boundaries, fare engine, SPA entry/error recovery, evidence
manifest, integration review and CI failures.

Coverage thresholds, coverage exclusions and report availability flags were not
relaxed. A source file with no production callers is not promoted to a current
production incident merely because its counters are zero.

## Product behavior corrected

- **Refresh replay:** revocation commits before `UNAUTHORIZED` is returned. A
  concurrent loser revokes the whole affected family, including the sole newly
  inserted successor. Another device's family remains usable. The existing live
  acceptance test now verifies both sides of that policy. See
  [session recovery](../operations/auth-session-recovery.md) for client behavior.
- **MFA migration and mutation:** a successful legacy-secret migration returns
  the persisted ciphertext in the session proof. Enable/disable consumes the
  TOTP step, validates the enrollment, changes state and revokes sessions in one
  transaction. Backup-code regeneration and challenge completion use coherent
  enrollment checks and lock order; an obsolete supplied proof cannot issue a
  session after its enrollment changes.
- **Internal refunds:** an existing refund ledger entry must belong to the
  booking's actual user. An inconsistent entry cannot authorize a replay.
- **Logout:** the observed `auth.me` query becomes anonymous while private
  queries, mutations and persisted private data are cleared. Mounted observers
  no longer retain the removed user's identity.
- **Share payment:** cancelled and expired shares settle into terminal UI.
  Polling is limited to a valid active pending verification, and a success URL
  alone never proves payment.
- **Inventory allocation:** a partial hold, its compatibility alias and the
  remaining waitlist request share one transaction. Failed waitlist persistence
  cannot leave reserved capacity behind.
- **Kiosk and station state:** timeout/finish clears the kiosk mutation observer
  and invalidates outstanding requests. Role changes invalidate a reviewed
  station proposal along with other identity changes.
- **Exports:** the requesting user, role, tenant, report and filters own an
  export. A late result from an abandoned context cannot download a file or
  block a new context's export.
- **Multi-city quotes:** an incomplete longer itinerary cannot display a cached
  total from a shorter itinerary. Continuation was already blocked; the fix also
  makes the displayed quote follow the complete current selection.
- **Process resources:** the API drains HTTP and cleanup steps, then awaits the
  actual pool closure. Duplicate signals share one drain. Cleanup failures and
  deadlines produce failure rather than a success log. Pool closure is shared
  and propagates driver failures; failed managed-pool construction cannot create
  an untracked fallback pool.
- **Notification delivery:** a tenant-scoped event must also read a flight in
  that scope. Queued emails pass a stable per-job/content provider idempotency
  key through every supported template, including generic and refund messages.
  Retry bodies with fallback dates use enqueue time rather than a new clock
  value on each attempt.
- **Training pages:** fractional identifiers are rejected, fractional weights
  are preserved, incomplete/negative inputs do not submit, failed plan reads
  remain errors, and displayed calculation results belong to the current input.
  Generated load sheets and their success notices belong to the submitted flight.
  The existing training-only capability boundary remains enforced.

## Finding-to-test mapping

Paths below are relative to the repository root. They identify executable
evidence and the specific limit of that evidence. Existing acceptance journeys
are reused where they already exercise the requested production behavior.

### Backend findings

| Finding                            | Executable evidence and scope                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01 — Refresh replay revocation  | `auth-session-regression.test.ts` reproduces rollback, and `auth-session-mysql.test.ts` exercises real session rotation, concurrency, rollback and independent families. `scripts/verify-transaction-boundaries.ts` verifies committed family revocation against live MySQL/Redis.                            |
| BE-02 — MFA encryption and actions | `auth-session-regression.test.ts`, `session-mfa-boundary.test.ts` and `auth-session-mysql.test.ts` cover migration, enrollment identity, TOTP/challenge consumption, action rollback, invalidation and concurrent actions. Native cases distinguish SQL locking from the controlled transaction adapter.      |
| BE-03 — Internal refunds           | `internal-refund-boundary.test.ts` executes all three internal tenders and rejection paths. `financial-authority-mysql.test.ts` verifies real refund conservation, idempotency, competing requests and trigger-induced outbox rollback.                                                                       |
| BE-04 — Agency credit              | `financial-authority-mysql.test.ts` exercises actual approved terms, exact limits, competing reservations, changed debtor/terms and dispute restrictions. Existing `e2e/agency-credit.spec.ts` covers the browser/API path.                                                                                   |
| BE-05 — Ticket revalidation        | Existing `e2e/local-ticket-revalidation.spec.ts` covers the real preview/commit journey, missing evidence, changed fare terms, foreign owner, changed coupon state and lost-response replay. This is browser/native acceptance, not coverage inferred from the servicing service's aggregate percentage.      |
| BE-06 — Fare engine                | `fare-rules-engine.test.ts` executes pricing composition, passenger adjustments, booking-rule rejection/acceptance and change-fee tiers. Its explicitly selected rule rows do not independently prove database rule filtering.                                                                                |
| BE-07 — Stripe receipt             | `webhooks/stripe-redelivery-dedupe.test.ts` exercises competing claims and rollback. `webhooks/stripe-signature-http.test.ts` uses real loopback HTTP, raw bytes and the Stripe SDK's signature verifier. Native/API-process checks supplement these controlled settlement boundaries.                        |
| BE-08 — Authentication chain       | `auth-service-http.test.ts` exercises the actual HTTP client and malformed/failed provider responses. `auth-session-mysql.test.ts` runs the REST/cookie/Bearer/session/MFA chain with native persistence and a controlled password HTTP service. Existing browser CI starts the real Python password service. |
| BE-09 — Seat economics authority   | `seat-economics-tenant-boundary.test.ts` invokes the actual router/middleware and scoped economics calculation. Source-text assertions were replaced by executing authorization and result behavior.                                                                                                          |
| BE-10 — Wallet/split API           | `payment-router-authority.test.ts` executes router schemas, identity forwarding, actual access-control helpers and ownership rejection with no downstream side effects. Financial persistence remains the responsibility of the separate native suites.                                                       |

Backend test files in this table are under `server/__tests__/` unless a full
repository-relative path is shown.

### Operations findings

| Finding                                  | Executable evidence and scope                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-01 — Report API                      | `server/__tests__/standard-report-router.test.ts` invokes all ten endpoints through actual middleware and schemas, including tenant/role rejection, projection, serializers, checksums and invalid output rejection. Source readers and saved-report persistence are substituted at their stated boundaries.                                                  |
| OPS-02 — Schedule recovery               | `server/__tests__/standard-report-schedules-mysql.test.ts` executes deletion, stale occurrence claims, competing leases, revoked/deleted/suspended owners, competing delivery claims and database outages. An expired `sending` receipt becomes `unknown` without an automatic resend; failed authority reads preserve due work for recovery.                 |
| OPS-03 — APIS documents                  | Existing `scripts/acceptance/forensic.ts`, `aviation-research.ts` and `r2-reaccommodation.ts`, plus `client/src/pages/__tests__/apis-journeys.test.tsx`, exercise local document collection, verification, retrieval and authorization. They do not establish a destination authority's receipt or approval.                                                  |
| OPS-04 — Manifest/baggage reconciliation | Existing `scripts/acceptance/dcs-counter-lifecycle.ts` and `r2-reaccommodation.ts` exercise departure membership, baggage registration and reconciliation, including a boarded passenger absent from the current manifest.                                                                                                                                    |
| OPS-05 — Seats/boarding                  | Existing `e2e/fixtures/family-check-in.ts`, `scripts/acceptance/scoped-ancillary-sale.ts`, `integration-remediation.ts` and `r2-reaccommodation.ts` execute seat selection and boarding-pass/reconciliation behavior. Device and carrier acceptance remain separate.                                                                                          |
| OPS-06 — Station decisions               | `client/src/components/__tests__/DcsStationActions.test.tsx` exercises reviewed actions, failures, stale identity/role state and retries. Existing `scripts/acceptance/dcs-counter-lifecycle.ts` provides native remapping, downgrade, dismissal and replay/rollback evidence.                                                                                |
| OPS-07 — Inventory promises              | `server/__tests__/inventory-allocation-boundary.test.ts` reproduces the partial-allocation failure. `operations-inventory-mysql.test.ts` verifies holds/aliases, capacity accounting, tenant boundaries, trigger rollback and final-seat contention against native SQL. Existing inventory concurrency acceptance remains enabled.                            |
| OPS-08 — Local BSP persistence           | `server/__tests__/bsp-local-evidence-persistence.test.ts` executes relational persistence through an explicit SQLite syntax/JSON adapter. Existing `scripts/acceptance/bsp-local-evidence.ts` supplies native stage/import/reconciliation and competing-stage acceptance. External settlement is not inferred.                                                |
| OPS-09 — Cron, leases and drain          | `server/services/cron.service.test.ts`, `server/__tests__/scheduled-task-lifecycle.test.ts` and `worker-shutdown.test.ts` execute callbacks, lease renewal/loss, task completion and real worker entry wiring. Their controlled Redis/BullMQ boundaries are supplemented by the native acceptance and transport-fault jobs.                                   |
| OPS-10 — Flight/email delivery           | `server/__tests__/flight-event-delivery.test.ts`, `flight-delivery-mysql.test.ts`, `email-worker.test.ts` and `email-worker-provider.test.ts` exercise tenant selection, durable receipts, partial failures, lease exclusion, retry data and actual email templates. Provider HTTP is controlled; provider acceptance is not claimed.                         |
| OPS-11 — API startup/readiness           | `server/__tests__/api-process-mysql.test.ts` targets the actual API child process with owned database transport faults and local provider responses. `health-isolated-stripe.integration.test.ts` exercises detailed readiness policy, redaction and recovery. Production Docker validation separately boots the built runtime image and probes its liveness. |
| SRC-API-SHUTDOWN — False closure log     | `server/__tests__/api-shutdown-wiring.test.ts` executes both signal registrations; `api-shutdown.test.ts` includes real in-flight loopback HTTP drain and cleanup/deadline failures; `database-pool-shutdown.test.ts` verifies actual pool lifecycle ownership and failure propagation.                                                                       |

### Client findings

| Finding                                   | Executable evidence and scope                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 — Logout cleanup                    | `client/src/_core/hooks/useAuth.test.tsx` uses real React Query observers, mutations and in-flight requests to prove identity/private-cache cleanup on success and failure.                                                                                                                                                                                                                                                                               |
| UI-02 — Booking alternatives              | `client/src/pages/__tests__/BookingPageSeatRoster.test.tsx` executes seat roster and booking changes through actual hooks. Existing required browser journeys cover search, authentication, quote, booking and checkout with native data.                                                                                                                                                                                                                 |
| UI-03 — Multi-city search                 | Existing `e2e/multi-city-fare.spec.ts` proves named-fare selection, passenger types, ordered handoff, stale-class rejection and a successful retried booking with actual holds. Complementary `MultiCityResults` interaction tests exercise search/quote/input states.                                                                                                                                                                                    |
| UI-04 — Pay share                         | `client/src/pages/__tests__/PayYourShare.test.tsx` exercises loading, payment, cancellation, refund/error states and timer-driven polling through actual hooks.                                                                                                                                                                                                                                                                                           |
| UI-C01 — Cancelled share on success URL   | The same suite reproduces the terminal-state ordering and polling defects, including null/expired results and no payment inferred from the URL.                                                                                                                                                                                                                                                                                                           |
| UI-05 — Booking modification/cancellation | `client/src/components/__tests__/BookingServiceDialogs.test.tsx` exercises actual dialog hooks, state, errors and callbacks. Native/browser servicing suites independently verify persisted business effects.                                                                                                                                                                                                                                             |
| UI-06 — Station/load/weight UI            | `DcsStationActions.test.tsx`, `LoadPlanningInteractions.test.tsx` and `WeightBalanceInteractions.test.tsx` cover station decisions, plan creation/optimization/validation/finalization, layout/ULDs, numeric input, results, limits/history and capability refusal. The load/weight pages remain training simulations.                                                                                                                                    |
| UI-07 — Kiosk privacy/print               | `client/src/pages/__tests__/KioskBagTag.test.tsx` reproduces timeout and late-response state leaks. Existing `e2e/vrs-kiosk-tags.spec.ts` uses real routes/native data with only browser printing substituted. Physical output is unverified.                                                                                                                                                                                                             |
| UI-08 — Export interaction                | `client/src/components/__tests__/ExportReportButton.test.tsx` executes all report/format selections, actual `downloadFile`, retry and identity/filter/unmount races. Synthetic PDF/XLSX bytes prove transport/encoding rather than document generation.                                                                                                                                                                                                   |
| UI-09 — Refund dashboard                  | `client/src/pages/admin/__tests__/RefundsDashboardInteractions.test.tsx` exercises queue pagination/filter reset, selected detail, resume mutations, all five refreshed reads, failures, polling cancellation and retry controls.                                                                                                                                                                                                                         |
| UI-10 — Bootstrap/error recovery          | `client/src/__tests__/main-bootstrap.test.tsx` executes the actual entry module with real Query/Mutation caches and auth-navigation helper, including return paths, auth-loop prevention, language/direction and isolated embed selection. `ErrorBoundary.test.tsx` executes render errors, retry, details and feedback. Existing browser CI verifies the built entry and selected lazy routes; it does not establish exhaustive coverage of every route. |
| UI-11 — MFA verification UI               | `client/src/components/__tests__/MFAVerify.test.tsx` executes the actual hooks, backup-code selection, rejection and successful completion. Native authentication tests establish server state effects.                                                                                                                                                                                                                                                   |
| UI-12 — Standard reports failures         | `client/src/pages/admin/__tests__/StandardReports.test.tsx` exercises invalid inputs, preview/export/save/pause/delete/download failures, generating/ready identity reuse and late save/download isolation.                                                                                                                                                                                                                                               |
| UI-M01 — Coverage attribution anomaly     | Real ErrorBoundary tests now execute the return statement and recovery behavior. A focused V8 report still attributes different counts to `getDerivedStateFromError` and its return statement. Behavioral coverage does not establish that the provider's attribution anomaly has been corrected.                                                                                                                                                         |

The short UI test names above live under the named component/page's
`__tests__` directory. Their shared `client/src/test/trpc-fixture.tsx` runs real
tRPC hooks, React Query and SuperJSON over an intercepted HTTP boundary. These
tests do not claim to execute a payment provider or replace native acceptance.

### Evidence and capability findings

| Finding                             | Resolution and remaining limit                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| META-01 — Unidentified coverage run | `scripts/ci/run-coverage-evidence.mjs` records the actual checked-out commit/tree, dirty state, exact command, runtime/provider versions, configuration/package/lock hashes, CI identity, timestamps, child result, JSON/JUnit counts and artifact hashes. Each attempt owns a fresh directory. Missing/inconsistent artifacts cannot produce a successful wrapper result. `scripts/ci/test_coverage_evidence.py` exercises success, child failure, missing results and interruption. |
| CAP-01 — Catalog versus capability  | The audited catalog's 99 definitions were 36 available, 35 partial and 28 blocked. Every nonblocked definition had local dispatch, but that is not acceptance of every result or an external source. Availability flags and explicit refusal remain unchanged. Individual partial/blocked reports need their missing authoritative source or acceptance receipt before promotion.                                                                                                     |

## Reading the acceptance evidence

The authoritative result is the latest CI run for the PR revision, not the sum
of focused worker runs. Focused suites overlap, and the same native cases run on
both MySQL versions. Do not count those repetitions as distinct tests. A skipped,
cancelled or not-started job is not a passing job.

`CI/CD Pipeline` preserves a `test-coverage` artifact containing one fresh
`run-*` directory per attempt. Read its `execution-manifest.json` together with
`vitest-results.json`, `junit.xml` and `coverage/coverage-summary.json`. Check the
recorded source tree and artifact hashes before comparing results. A pull request
checkout may be GitHub's tested merge commit, which differs from the source
branch head; both the checked-out source and CI metadata are retained.

The wrapper preserves the runner's failed exit and interruption status. It does
not turn a successful coverage-file write into proof of a passing test suite.
The original coverage provider, include/exclude scope and thresholds remain in
the copied configuration. Fresh measurements can be compared descriptively with
the archive, but the archive's absent source identity prevents an exact
same-revision causal claim about every percentage point.

`Production Gates` runs the named native suites on both MySQL 8.0 and 9.7 before
the existing transaction/integration/restore acceptance. New native fixtures
require test mode, disposable-database opt-in and a loopback `_test` source. They
create randomly named owned schemas and clean up only those schemas. Where
`CREATE TABLE ... LIKE` is used, migrated types/defaults/indexes are exercised;
foreign keys are verified independently by the migration/catalog gates, since
MySQL does not copy them with that statement.

Other required evidence includes the real browser journeys, Docker runtime and
migrator validation, REST/provider-contract laboratory, and injected transport
faults/worker recovery. The process and provider boundaries used by each suite
must remain visible when reporting a result.

## Acceptance still outside this change

- External APIS/authority acknowledgement, BSP settlement, physical bag-tag
  printing and carrier/device certification require their own receipts.
- Training load/weight calculations do not become approved operational dispatch
  calculations because UI tests pass.
- A local Stripe signature or controlled provider HTTP response is not a live
  payment, refund or delivery acceptance. A stable email idempotency key relies
  on the selected provider's documented behavior and retention window.
- V8's ErrorBoundary function/statement attribution remains a measurement issue;
  no thresholds, exclusions or provider changes conceal it.
- Selected browser routes and negative cases do not imply exhaustive testing of
  every screen, every report input or every possible concurrency schedule.
- An accepted PR revision does not establish that it has been merged or deployed.

## Reproduction

Use the repository's declared package manager and a clean checkout. These are
the ordinary quality commands; the workflows provide the owned MySQL/Redis
services and the explicit disposable-database environment for native tests.

```bash
pnpm exec prettier --check .
pnpm lint:ci
pnpm check
pnpm check:scripts
pnpm exec tsc -p tsconfig.e2e.json --noEmit
node scripts/ci/run-coverage-evidence.mjs
python3 -m unittest discover -s scripts/ci -p 'test_*.py' -v
```

Running native files without their required environment deliberately skips them.
Use the workflow job and its exact invocation to reproduce native acceptance;
never substitute an application's database for a disposable fixture.
