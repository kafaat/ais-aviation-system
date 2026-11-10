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

### Hardening variables set, 2 November 2026

After the worker deployment the operator asked for the remaining hardening
work to be done. The web service's start-up log had been printing two
`[security]` warnings (`TRUSTED_PROXIES is not set`, `METRICS_TOKEN is not
set`). Four variables were set on the environment, values generated at random
and never written into this repository:

| Variable                      | Where                               | Effect                                                                                                                             |
| ----------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SERVICE_TOKEN`          | `ais-auth`; `ais-web` references it | The auth service now rejects any caller without the `X-Auth-Service-Token` header; the Node client sends it                        |
| `TRUSTED_PROXIES=uniquelocal` | `ais-web`                           | Rate limits key on the client address behind Railway's edge instead of one shared bucket                                           |
| `METRICS_TOKEN`               | `ais-web`                           | `/api/metrics` answers 401 without the scraper's bearer token                                                                      |
| `MFA_ENCRYPTION_KEY`          | `ais-web`                           | New TOTP material is encrypted under a key independent of `JWT_SECRET`; legacy material is re-encrypted on its next successful use |

Both services redeployed (`ais-web` `8bebae3c-dcb2-47ad-8ccc-e534d456d946`,
`ais-auth` `99497630-bfca-46a8-806c-84e04d399bf4`, SUCCESS) and the two
`[security]` lines no longer appear in the web start-up log. The service-token
handshake has not yet been exercised by a login after the change; a
misconfiguration would show in the auth log as `401 Service credential
required` on the next registration or login. The auth log also showed, on every
start, a trapped `AttributeError: module 'bcrypt' has no attribute '__about__'`
from passlib 1.7.4 probing bcrypt 4.2.1; the service now calls bcrypt directly
and the traceback is gone with the next deployment.

The web page and liveness endpoint returned HTTP 200; `health.ready` returned 503. The current readiness implementation includes Stripe key-format validation
alongside DB and Redis. Staging has synthetic payment configuration: do not
replace it with a plausible-looking fake key or weaken readiness to get green.
The precise failing dependency still needs authenticated operational evidence.

### The service credential becomes mandatory, 7 November 2026

Until this change the auth service enforced `AUTH_SERVICE_TOKEN` only when the
variable happened to be set, and the Node client sent the header only when it
happened to have one (issue #304). Both sides now fail closed: the auth service
refuses to start outside `DEBUG` without an explicit value of at least 32
characters that is not a placeholder, answers 503 to every password route when
no value is configured, and the web process refuses to start in production
under the same rules. Compose requires the variable at interpolation time.

Staging activation plan (variables only, no values in this repository):

1. `ais-auth` and `ais-web` already carry `AUTH_SERVICE_TOKEN` (names verified
   read-only on 7 November; the connected API redacts values, reference
   expressions and `DEBUG`). **Historical evidence, not a current proof:** the
   auth service enforces the header whenever its variable is set, and on
   3 November 09:36–09:37 UTC, after both variables were set on 2 November, it
   answered `POST /auth/verify-password` and `POST /auth/register` with 200 to
   a caller on the private network. `ais-web` is the only service in the
   environment besides `ais-auth` that carries the variable name
   (`ais-acceptance` and `ais-worker` do not), so on that date an internal
   caller presented a credential the service accepted. The caller's identity
   is not recorded, and current web/auth parity remains unproven: nothing here
   shows the values are unchanged today, the current length or entropy, or the
   value of `DEBUG`.
   The deployment history of both services from 5 November to 7 November
   lists only commit-triggered deployments from `main`, which is consistent
   with no variable edits in that window but is not a proof either.
   **Pre-merge gate (operator, out of band, no values in GitHub or chat):**
   confirm in the Railway dashboard that both values are identical, random and
   at least 32 printable ASCII characters, or set one fresh `openssl rand -hex
32` value on both services in a single change; and confirm `DEBUG` on
   `ais-auth` is absent or `false`, because the start-up refusal applies only
   outside `DEBUG` mode (runtime enforcement applies in every mode).
2. Merge; Railway redeploys both services from `main`. The auth start-up log
   must show Uvicorn serving without a `ValidationError` naming
   `AUTH_SERVICE_TOKEN`; the web start-up log must not show `[security]
AUTH_SERVICE_TOKEN`.
3. Evidence of the handshake on the merged commit: one registration or login
   through the web service returns 200 in the auth log, and an anonymous
   `POST /auth/login` against the private auth URL returns 401
   `Service credential required.` `ais-worker` does not call the auth service
   and needs no copy. Only this post-deploy observation proves current parity.
   Since the acceptance runner's login journey (`scripts/ci/railway-login-journey.ts`)
   this observation is produced on every deployment: `ais-acceptance` registers
   a synthetic account through the deployed web's `auth.register`, logs it in
   with `auth.login`, presents the issued bearer token to `auth.me`, revokes
   the session with `auth.logout`, removes exactly that account's rows, and
   records statuses only (no identity, password or token) under `login` in
   `RAILWAY_ACCEPTANCE_SUMMARY`. A refused handshake fails the run. The 8
   November one-shot probe (#307, receipt in #103) remains the record of the
   first such proof; it does not need to be re-run.
   Because `ais-acceptance` and `ais-web` roll out from the same commit at the
   same moment, the runner first waits up to two minutes for the web replica
   to answer `/api/rest/health/live` (`scripts/ci/railway-web-wait.ts`) and
   records the wait under `webWait`. On 10 November 2026 the run on
   `3786c7b` probed the web about one second after its container started,
   every request failed with `fetch failed`, and the deployment was recorded
   as crashed although all 171 checks passed; the wait removes that race
   without passing an unreachable web.

Diagnosis and recovery if a service fails to start after the merge. First
read the failing service's deploy log and classify the cause; do not change a
secret on the assumption that the secret is at fault.

| Signal in the deploy log                                                            | Cause                                           | Recovery                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Auth: `ValidationError` whose message names `AUTH_SERVICE_TOKEN`                    | Missing, blank, placeholder, short or non-ASCII | Set a valid value on both services in one change and redeploy both                            |
| Web: `[security] AUTH_SERVICE_TOKEN ...` in `Server startup failed`                 | Same, on the web side                           | Same                                                                                          |
| Auth: `ValidationError` naming `DATABASE_URL` or `JWT_SECRET`                       | Unrelated variable (#303 rules)                 | Fix that variable; not caused by this change                                                  |
| Build failure, image pull failure, health-check timeout without a `ValidationError` | Code or deployment configuration                | Repair the configuration or roll forward with a corrected image; see the rollback rules below |
| Both services start, but logins fail and the auth log shows 401 on verify-password  | Values differ between the services              | Set one value on both services in a single change and redeploy both                           |

Rollback rules. Neither kind of rollback is automatically safe:

- A **source rollback** (reverting the merge on `main`) restores the fail-open
  code on both sides and is never an acceptable recovery for this change.
- A **platform rollback** of `ais-auth` to its previous Railway deployment is
  unsafe whenever `AUTH_SERVICE_TOKEN` is missing, blank or otherwise refused
  on that service, which is exactly the first failure row above: the previous
  auth build (`main@3a34fb6`, `require_service_token` returns early when the
  variable is empty) would serve the password routes to anonymous callers.
  While the variable is being repaired the credentialed endpoints stay
  unavailable; that is the intended fail-closed state, not an outage to work
  around. A platform rollback of `ais-auth` may be used only for a code or
  deployment fault when the variable on that service is already confirmed
  present and valid, and it must be followed by the same negative and positive
  checks as step 3: anonymous and wrong-credential `POST /auth/login` on the
  private network return 401, and one Node → FastAPI login returns 200.
- A platform rollback of `ais-web` alone does not re-open the auth service,
  but the previous web build omits the header when its variable is empty, so
  it must also be followed by the step 3 checks.

The staging secrets generated in the 2 November session were visible in that
session's transcript and must be rotated before any production use, as
recorded above.

## Worker deployment: blocked until 2 November 2026, then deployed under isolation

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

That rejection stood until the operator lifted it on 2 November 2026. The
intended configuration was `AIS_PROVIDER_BOUNDARY=isolated`, `STRIPE_MOCK_HOST`
pointing at a private `stripe-mock` service, `SMS_PROVIDER=mock`, no
Resend/OpenAI/Sentry credentials, and the startup log line
`Worker process starting...` carrying a `providerBoundary` report whose findings
are all `absent`, `mock`, `blocked` or `sandbox`. The section below records
what was deployed and what the logs showed.

### Worker deployed under isolation, 2 November 2026

The operator raised the Railway plan limit, approved creation of an isolated
worker in writing, and committed the staged environment patch from the
dashboard (the tool-side commit asked for confirmation and timed out; nothing
was applied until the operator acted). Two services were created in one
non-destructive patch, both in `asia-southeast1-eqsg3a` beside MySQL and Redis:

| Service       | Id                                     | Configuration                                                                                                                                                                  |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ais-worker`  | `36b7cace-cafa-4c53-87e5-e46bda08c43e` | Source `kafaat/ais-aviation-system` on `main`, `Dockerfile.prod`, start command `node dist/worker.js`, restart policy `ON_FAILURE` (10 retries), one replica, no public domain |
| `stripe-mock` | `48294f1d-ac8f-40af-be34-c1ef64340246` | Image `stripe/stripe-mock:latest` (0.206.0 at deploy), private endpoint `stripe-mock`, listening on `[::]:12111`, restart policy `ALWAYS`, no public domain                    |

The worker's variables are `AIS_PROVIDER_BOUNDARY=isolated`,
`STRIPE_MOCK_HOST=http://stripe-mock.railway.internal:12111`,
`SMS_PROVIDER=mock`, `NODE_ENV=production`, `FRONTEND_URL` set to the public web
domain, and references (`${{ais-web.<NAME>}}`, no copied values) for
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SELF_SERVICE_CAPABILITY_SECRET`,
`CSRF_SECRET`, `AUTH_SERVICE_URL`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `LOG_FORMAT`. No Resend,
OpenAI, Sentry, Twilio or built-in Forge credential exists on the service. In
production the `mock` SMS name resolves to the unavailable provider, so SMS
fails closed; the boundary reports it as `mock`.

First deployment `36b568cd-4599-443a-a7b4-75000999e193`, built from `main` at
`6792543`, reached `SUCCESS`, and its deploy log showed in order:

- `Worker process starting...` with `providerBoundary.boundary = isolated` and
  every finding allowed: stripe `mock` (client redirected to `STRIPE_MOCK_HOST`),
  sms `mock`, and resend, openai, sentry, outbox-receiver, otel-collector,
  hotelbeds, weather, oncall and alternative-payment-providers all `absent`.
  The four integrations (hotelbeds, weather, oncall, tracing) reported
  `disabled`, not `invalid`.
- Database pool initialised, Redis connected, queues initialised, the
  mandatory queue workers (email, webhook retry, scheduled) and V2 workers
  started, daily reconciliation and cleanup jobs registered, cron jobs started.
  The production-only check that the queue Redis runs
  `maxmemory-policy noeviction` passed, since a failure would have refused
  start-up.
- `Worker dependencies and mandatory consumers are ready` at 19:11:36 UTC,
  after which the readiness file and the ten-second dependency heartbeat run.
- Over the following ten minutes: the five-minute `cleanup` schedule ran twice
  (`seat-holds cleanup completed`), no `Worker readiness lost`, no error line,
  one running replica and zero crashes.

The service autodeploys from `main`; the next push (`7fb642c`, release
v1.33.3) started a new deployment immediately.

What this does **not** prove, stated as what remains: the persisted heartbeat
rows in the operational-observations table were not read (that needs an
authenticated read, as with readiness); no job has yet exercised the
`stripe-mock` client path; and browser, booking and provider acceptance are
unchanged from the sections below.

## Required runtime evidence

- Complete readiness diagnosis; registration/login and invalid-password API
  probes have passed, but browser and booking acceptance remain outstanding.
- Worker isolation from live providers and dependency readiness are observed
  in the deploy log above; a fresh persisted heartbeat still needs an
  authenticated read. Process startup alone is insufficient.
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
  `server/worker.ts`. The worker was blocked until provider boundaries were
  isolated and now runs as its own service (see above); this runner does not
  touch that decision, and the suite it runs is the one proven to make zero
  provider calls.
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
acceptance, and not a statement about the worker, which was blocked at the
time (it was deployed under isolation on 2 November 2026, recorded above).
Stated as what remains rather than what passed: an end-to-end booking journey
through the deployed web application, provider acceptance for every external
domain listed in `provider-acceptance.md`, delivery of each purchased service
(not only its sale and refund), and worker readiness with a persisted
heartbeat. A later `main` head is not covered by an earlier run; the summary
line of each deployment names the commit it ran against.

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

Until 2 October 2026 that policy was prepared, not enforced: read through the
public API on 21 September, `main` reported `protected: false` and
`rules/branches/main` was empty, so every merge up to then waited for green
checks by discipline, not by GitHub refusing a red one. The release workflow
was first changed to propose version commits as pull requests and publish
from the merged commit, so the policy could be enforced without a bypass.
On 2 October 2026 the administrator activated it through the
`Apply Main Protection` workflow; `main` now reports `protected: true` with
both migration-replay legs among the twelve required checks
(`docs/runbooks/project-hardening.md` records the run and the read-back).

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
