# AIS private staging runtime completion

Observed source: `5c5863bb406bfdb94a5b816e240f06d301d2999d`.
Project: `ais-aviation-staging` (`d0425f39-b1dc-4cf3-b7d9-0aab68d6ae9b`).
Railway's environment is named `production`; this name is not production
acceptance. The project is a staging copy. The operator subsequently authorized
and created the public web domain `ais-web-production.up.railway.app` on port 3000;
MySQL, Redis and the authentication service remain private.

## Authentication

`ais-auth` uses the existing `/auth-service` Docker build context and listens on
port 8000. Its database URL references `MySQL.MYSQL_URL`; its JWT key references
`ais-web.JWT_SECRET` and its application ID references `ais-web.VITE_APP_ID`.
No secret values are stored here. Drizzle remains the only schema migration owner.

The web service's configured `AUTH_SERVICE_URL` is
`http://${{ais-auth.RAILWAY_PRIVATE_DOMAIN}}:8000`.
The operator redeployed auth (`be91f5db-0257-4f46-99d6-45a262b26e12`)
and web (`8e5920c9-e6bd-4b48-b9e7-698b69af8b77`) at the source above.
HTTP probes through the public web domain demonstrated registration, login,
matching authenticated identity, a Secure session cookie, logout, anonymous
identity after logout and rejection of an incorrect password with HTTP 401.
Web logs confirmed the internal auth URL. These are API probes, not browser
rendering or full booking acceptance. No payment or provider operation was made.

The web page and liveness endpoint returned HTTP 200; `health.ready` returned 503. The current readiness implementation includes Stripe key-format validation
alongside DB and Redis. Staging has synthetic payment configuration: do not
replace it with a plausible-looking fake key or weaken readiness to get green.
The precise failing dependency still needs authenticated operational evidence.

## Worker deployment remains blocked

The existing worker starts reconciliation, refund processing and other scheduled
jobs. A synthetic Stripe key does not prevent outbound requests. Do not deploy
the worker as a staging smoke shortcut before establishing an approved isolated
provider boundary. The automatic approval reviewer rejected worker creation and
web redeployment in the environment named `production` before the operator's
manual redeployment. Worker creation remains blocked. No alternate tool or
indirect execution may be used to bypass those rejections.

### The isolated provider boundary now exists in code; deployment still awaits approval

The block above names its prerequisite: an approved isolated provider boundary.
The boundary is now a configured, testable property of the worker process
rather than a hope about which variables happen to be set
(`server/_core/provider-boundary.ts`, `server/services/stripe/client-factory.ts`,
tests in `server/__tests__/provider-boundary.test.ts`):

- `AIS_PROVIDER_BOUNDARY=open` is the default and changes nothing for
  production or development.
- `AIS_PROVIDER_BOUNDARY=isolated` makes the worker **refuse to start** when
  any variable could reach a live provider: a `sk_live_`/`rk_live_` Stripe key,
  a Resend, Twilio, OpenAI or Sentry credential, `SMS_PROVIDER=twilio`, an
  `OUTBOX_PUBLISH_URL` or OTLP endpoint outside loopback or
  `*.railway.internal`, a Hotelbeds, weather or on-call mode of `live`, or any
  alternative-payment-provider credential. The refusal names providers and
  variable names, never values.
- A Stripe **test** key is allowed to exist under isolation but no client is
  ever constructed against `api.stripe.com`: all three former constructors now
  go through one factory, which under isolation only builds a client pointed at
  `STRIPE_MOCK_HOST` (a `stripe-mock` instance) and otherwise throws before any
  request. A job that reaches for Stripe therefore fails closed and its durable
  retry machinery records the failure; nothing leaves the environment.

What this does not do: it does not deploy the worker. Worker creation in this
environment was rejected by the approval reviewer and that rejection stands
until an operator lifts it. When they do, the intended configuration is
`AIS_PROVIDER_BOUNDARY=isolated`, `STRIPE_MOCK_HOST` pointing at a private
`stripe-mock` service, `SMS_PROVIDER=mock`, no Resend/OpenAI/Sentry credentials,
and the startup log line `Worker process starting...` carrying a
`providerBoundary` report whose findings are all `absent`, `mock`, `blocked` or
`sandbox`.

## Required runtime evidence

- Complete readiness diagnosis; registration/login and invalid-password API
  probes have passed, but browser and booking acceptance remain outstanding.
- Worker isolation from live providers, then dependency readiness and a fresh
  persisted heartbeat. Process startup is insufficient.
- A synthetic booking journey, with internal funding only and no live provider calls.
- Migration completion before serving a changed schema; independent concurrent
  autodeployments do not prove deployment ordering.
- Keep auth/database services private; public exposure is limited to the web domain.

## Baggage verification

`node scripts/ci/check-baggage-mutations.mjs` archives the committed HEAD into a
temporary directory, requires a passing unmodified baseline, and applies six
mutations independently (M1-M4 plus separate weighing and confirmation M5 guards).
Test collection errors and skipped tests are not kills.
The source checkout is never mutated. The timestamp test deliberately retains a
valid receipt reference while removing only `fundedAt`.

This evidence does not replace custody hardware acceptance, F30 scope decisions
or E01-E11. The follow-up adds six MySQL scenarios to the guarded integration
runner and a scoped read-only presentation in MyBookings, the on-screen boarding
pass and the operations console. CI execution of those new MySQL scenarios must
be confirmed separately. Downloaded ticket PDFs are not covered by this UI change.

### Local verification, 2026-09-15

The five targeted suites (entitlement, Phase 0 contract, durable operations,
order servicing and custody) passed 35 tests with zero failures or skips.
The mutation baseline passed 20 tests; each mutation retained all 20 tests and
was detected by assertions: M1 (1 failure), M2 (2), M3 (1), M4 (1),
M5a weighing (2), M5b confirmation (1). These intentional failures are mutation
evidence, not failures of the unmodified application. Formatting and targeted
ESLint checks also passed. CI confirmation remains separate.

### Consumer and MySQL follow-up

The owner/tenant-scoped read path strips financial references and returns each
passenger/segment allowance and warning codes. MyBookings, the on-screen boarding
pass and bag-drop operations consume it. Read errors remain visible rather than
falling back to a cabin allowance. Cancelled bookings have no active presentation.
The five targeted suites passed 44 tests, zero failures and zero skips locally.
Six new `BAG-MYSQL-*` checks are wired into the existing guarded disposable MySQL
runner. Local execution is blocked by the unavailable MySQL server and container
package-manager permissions; do not label these six checks passed until CI does.

## Acceptance runner inside the environment

Observed source: `857d138e71a845b986934a2c8befb5c1be39695a` on
`claude/railway-acceptance-runner`, branched from `main` at v1.30.1.

`pnpm test:acceptance:railway` (`scripts/ci/railway-acceptance.ts`) runs the
repository's live MySQL/Redis acceptance suite _inside_ the Railway environment,
against the environment's own MySQL and Redis services. Until now the suite had
only ever run against a laptop or a CI container; this is the first evidence
about the deployed dependencies themselves. The service `ais-acceptance`
(`a929f4a9-2e31-4c2f-b2c5-df0f042b053a`) is a one-shot process: Railpack build,
start command `pnpm test:acceptance:railway`, restart policy `NEVER`, no public
domain, no volume. Re-running it is a redeploy.

Its boundaries are enforced in code, not by convention, because each one is a
line the staging runbook already draws:

- **It is not the worker.** It starts no cron and imports nothing from
  `server/worker.ts`. The worker stays blocked until provider boundaries are
  isolated; this runner does not touch that decision, and the suite it runs is
  the one proven to make zero provider calls.
- **It is not a tenant of the application database.** It receives the MySQL
  service's own URL (`${{MySQL.MYSQL_URL}}`), creates a disposable
  `ais_acceptance_test` database on that server, and drops it in `finally`. It
  refuses to run if the disposable name equals the application's database, and
  the suite independently refuses any database not ending in `_test`.
- **It does not share the application's Redis keyspace.** It uses logical
  database index 9 — index 0, which the application uses, is refused — and
  flushes only that index before and after.
- **It carries no credentials into the suite.** The suite is spawned with a
  replacement environment of exactly the five variables CI passes it
  (`NODE_ENV`, `AIS_DISPOSABLE_DATABASE`, `DATABASE_URL`, `REDIS_URL`, a random
  `JWT_SECRET`) plus `PATH` and `HOME`. No Stripe, Hotelbeds, weather or on-call
  key exists in the service's variables, and none can reach the child.
- **It applies the migration journal first, then verifies it** against the
  declared schema, before the suite runs. That is the ordering the runbook
  asked to prove ("migration completion before serving a changed schema").

Connection strings are never printed. Hosts, ports, server versions and
round-trip latencies are, and one `RAILWAY_ACCEPTANCE_SUMMARY` line carries the
machine-readable result.

This runner does **not** replace browser or booking acceptance, provider
acceptance (E01–E11), or the worker's own readiness. It proves that the deployed
MySQL and Redis accept the full migration journal and the transactional
boundary suite, from inside the private network.

### Runs on the environment, 21 September 2026

Three consecutive runs of the runner against the environment's own services,
each from a fresh Railpack build of the branch, agreed on every fact below.

| Fact                                                           | Value                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| MySQL reached over the private network                         | `mysql.railway.internal:3306`, **MySQL 9.7.2**, 3–5 ms round trip               |
| Redis reached over the private network                         | `redis.railway.internal:6379`, **Redis 8.2.9**, 1–2 ms, logical database 9      |
| Migration journal (50 migrations) applied to an empty database | 18–22 s, then `verify` confirmed the journal matches the declared schema        |
| Acceptance checks passed before the first failure              | **116 of 127**, zero skipped, zero provider calls                               |
| First failing check                                            | `R2 lineage: a real export records its declared inputs and its output checksum` |
| Disposable database dropped afterwards                         | yes, every run                                                                  |

Two things were learned that are not about the application's behaviour:

- **The platform drops logs above 500 lines/second per replica.** Under
  `NODE_ENV=test` the application logger defaults to `debug` and writes a line
  per pool checkout; the first run lost over nine thousand messages, the
  assertion text among them, and the first deployment showed no runtime log at
  all. The runner now passes `LOG_LEVEL=warn` to the suite and pauses four
  seconds after its summary so a one-shot container's last lines are shipped.
- **CI and local development run MySQL 8.0; the environment runs MySQL 9.7.**
  The 116 passing checks are the first evidence that the journal and the
  transactional boundaries hold on the deployed server version. The one
  failure is version-specific and reproducible: the `customers` warehouse
  export's aggregate query is rejected by 9.7.2 and accepted by 8.0.46, while
  the `flights` export in the forensic check passes on both. The failed export
  row recorded only Drizzle's `Failed query: <sql>` text, not the server's
  reason. The failure path now appends the driver code and `sqlMessage`, and
  keeps only the statement line: Drizzle's message also carries the bound
  parameter values, which the export row had been storing verbatim.

These runs are evidence about the deployed MySQL and Redis and about the
migration journal. They are not browser or booking acceptance, not provider
acceptance, and not a statement about the worker, which remains blocked.

### Root cause of the one failing check, and the web service seen from inside

The fourth run carried two additions and both paid off.

**The failing check has one cause: MySQL 9.7.2 has removed `MD5()`.** The
customers warehouse export pseudonymised user ids with
`MD5(CAST(users.id AS CHAR))`; the server answered
`ER_SP_DOES_NOT_EXIST: FUNCTION ais_acceptance_test.MD5 does not exist`. CI and
local development run MySQL 8.0, which still has the function, so no gate in
the repository could have found this; the environment did. A search of every
SQL statement in the codebase for functions MySQL 9 removed or deprecated found
this single use. The digest now runs in Node over the same input; it is
byte-identical to MySQL's output (verified for several ids against 8.0.46), so
downstream joins on the pseudonym hold. Whether MD5 of a small integer is a
strong pseudonym is a pre-existing question for the data owner, not decided
here.

**`ais-web` is serving.** Probed over the private network at
`http://ais-web.railway.internal:3000`, with no authentication and no data
beyond the health contract:

| Endpoint                 | Result                        | Meaning                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/rest/health/live`  | 200 `{"alive":true}` in 73 ms | The web process is up and answering after the 19 September MySQL redeploy. Its last log lines had been `ECONNREFUSED`; this is the first positive evidence since.                                                       |
| `/api/rest/health/ready` | 503 `SERVICE_UNAVAILABLE`     | Unchanged from the earlier finding. Readiness includes the Stripe key-format check, and staging has synthetic payment configuration; the runbook's instruction not to weaken readiness or plant a plausible key stands. |
| `/api/rest/health`       | 401 `UNAUTHORIZED`            | Correct: the detailed per-dependency check is `adminProcedure` by design. The precise failing dependency therefore still needs an authenticated read, as recorded above.                                                |

The liveness result is evidence that the process serves requests, not that
every pool connection is healthy; the 116 passing acceptance checks against the
same MySQL server are the evidence for the server side.

### Fifth run: the full suite passes inside the environment

With the customers export hashing in Node, the fifth run
(`c9bb111e-957d-43ba-89fe-8f5aeaeeacb0`, source `ac04d5f`) completed:

| Fact                                                        | Value                                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Acceptance checks                                           | **127 of 127**, zero skipped, zero provider calls                                                        |
| Server                                                      | MySQL 9.7.2 at `mysql.railway.internal`, Redis 8.2.9 at `redis.railway.internal`                         |
| Migration journal applied and verified on an empty database | 17.5 s + 1.3 s                                                                                           |
| Suite duration                                              | 17.8 s                                                                                                   |
| Web liveness / readiness over the private network           | 200 / 503, as in the fourth run                                                                          |
| Exit code                                                   | 0; the deployment stayed `SUCCESS` (a non-zero exit shows as `CRASHED` under the `NEVER` restart policy) |

This is the first time the repository's transactional acceptance suite has
passed against the server versions the environment actually runs. The
`ais-acceptance` service tracked the runner's branch until that branch reached
`main` (pull request #166, squash commit `5d23f3f`). It was then pointed at
`main`, and its first `main`-sourced deployment
(`fd6f327e-37e5-4007-8a4d-68214f7c835d`) passed 127 of 127 with zero provider
calls on the same MySQL 9.7.2 and Redis 8.2.9, with the web liveness, readiness
and detailed-health results unchanged (200, 503, 401). From here on every push
to `main` re-proves the journal and the boundaries against the deployed
servers; re-running it at any time is a redeploy of the service.

### The repository's gate now runs the environment's MySQL version too

The MD5 finding showed a gap: every repository gate ran `mysql:8.0` while the
environment runs 9.7. The `Migration Replay and Live Transaction Acceptance`
job in `production-gates.yml` is now a two-leg matrix over `mysql:8.0` and
`mysql:9.7` with `fail-fast: false`. The 8.0 leg keeps its exact job name, which
`.github/main-ruleset.json` requires as a status check; the 9.7 leg is named
`… (MySQL 9.7)` and uploads its own `live-transaction-acceptance-mysql-9.7`
artifact. The backup-restore smoke receives the image it should expect through
`MYSQL_SERVICE_IMAGE` instead of assuming 8.0. After the 9.7 leg passed on four
consecutive `main` heads (`5d23f3f`, `5a5c818`, `d48a5c7` and this change), its
context was added to the prepared policy in `.github/main-ruleset.json` beside
the 8.0 leg.

One fact about that policy must not be lost: it is prepared, not enforced.
Read through the public API on 21 September 2026, `main` reports
`protected: false` and `rules/branches/main` returns an empty list. Every
merge so far has therefore waited for green checks by discipline, not by
GitHub refusing a red one. Activating the policy is the operator step
described in `docs/runbooks/project-hardening.md`: it needs repository
administration access and a release workflow that no longer pushes version
commits straight to `main`, and nothing here pretends to have done either.

Sources consulted for the version facts (all public):

- MySQL 9.4.0 release notes: `MD5()`, `SHA()`/`SHA1()` and related hashing
  functions deprecated; MySQL 9.6.0 release notes: moved out of the server into
  the Legacy Hashing component (dev.mysql.com/doc/relnotes/mysql/9.4/en/ and
  /9.6/en/).
- Docker Hub `mysql` tags: `9.7` is the current LTS line, aliased `lts` and
  `9`; `8.0` is the previous line
  (hub.docker.com/\_/mysql).
- Railway log limits: 500 log lines per second per replica, excess dropped
  (docs.railway.com/observability/logs).
- Stripe Node SDK configuration: `host`, `port` and `protocol` options and the
  `stripe-mock` server used here for the isolated client
  (github.com/stripe/stripe-node, github.com/stripe/stripe-mock).
