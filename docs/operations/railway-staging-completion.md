# AIS private staging runtime completion

Observed source: `5c5863bb406bfdb94a5b816e240f06d301d2999d`.
Project: `ais-aviation-staging` (`d0425f39-b1dc-4cf3-b7d9-0aab68d6ae9b`).
Railway's environment is named `production`; this name is not production
acceptance. The project is a private staging copy with no public application domain.

## Authentication

`ais-auth` uses the existing `/auth-service` Docker build context and listens on
port 8000. Its database URL references `MySQL.MYSQL_URL`; its JWT key references
`ais-web.JWT_SECRET` and its application ID references `ais-web.VITE_APP_ID`.
No secret values are stored here. Drizzle remains the only schema migration owner.

The web service's configured `AUTH_SERVICE_URL` is
`http://${{ais-auth.RAILWAY_PRIVATE_DOMAIN}}:8000`.
The configuration change still requires an authorized web redeployment and a
successful private network probe. Auth process startup alone does not establish
database health, registration, login, or end-to-end browser acceptance.

Deployment `9d88af6f-4c90-43a7-a713-8519d7b0b8ac` reached process startup.
The `/auth/health` database-readiness check is now configured, but activating it
requires a redeployment. Automatic approval review also rejected that auth
redeployment because the environment is named `production`; database readiness
therefore remains unverified.

## Worker deployment remains blocked

The existing worker starts reconciliation, refund processing and other scheduled
jobs. A synthetic Stripe key does not prevent outbound requests. Do not deploy
the worker as a staging smoke shortcut before establishing an approved isolated
provider boundary. The automatic approval reviewer rejected worker creation and
web redeployment in the environment named `production`. No alternate tool or
indirect execution may be used to bypass those rejections.

## Required runtime evidence

- Authorized web redeployment with the private auth URL, followed by auth health,
  registration/login and invalid-password probes using synthetic accounts.
- Worker isolation from live providers, then dependency readiness and a fresh
  persisted heartbeat. Process startup is insufficient.
- A synthetic booking journey, with internal funding only and no live provider calls.
- Migration completion before serving a changed schema; independent concurrent
  autodeployments do not prove deployment ordering.
- A separate explicit decision before creating a public application domain.

## Baggage verification

`node scripts/ci/check-baggage-mutations.mjs` archives the committed HEAD into a
temporary directory, requires a passing unmodified baseline, and applies six
mutations independently (M1-M4 plus separate weighing and confirmation M5 guards).
Test collection errors and skipped tests are not kills.
The source checkout is never mutated. The timestamp test deliberately retains a
valid receipt reference while removing only `fundedAt`.

This evidence does not replace MySQL-backed baggage scenarios, consumer UI
verification, custody hardware acceptance, F30 scope decisions or E01-E11.

### Local verification, 2026-09-15

The five targeted suites (entitlement, Phase 0 contract, durable operations,
order servicing and custody) passed 35 tests with zero failures or skips.
The mutation baseline passed 20 tests; each mutation retained all 20 tests and
was detected by assertions: M1 (1 failure), M2 (2), M3 (1), M4 (1),
M5a weighing (2), M5b confirmation (1). These intentional failures are mutation
evidence, not failures of the unmodified application. Formatting and targeted
ESLint checks also passed. CI confirmation remains separate.
