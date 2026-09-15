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
