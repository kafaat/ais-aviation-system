# Sequential remediation of the 2026-09-09 audit

Base: `ef2a2dba476e51e2878fda5b88a86b5ac2f9ffa5` (1.20.26).
Branch: `fix/audit-ef2a2db-sequential`.

## Slice 1 — schema and runtime contracts

- F01: append migration 0013, with 89 new tables and the missing tenant/payment/auth columns. Preserve the 13 prior migrations. Register MFA settings in the declared schema and backfill previously nullable preference booleans before applying NOT NULL. Keep existing rows; duplicate favorites/reviews must be resolved before their unique constraints can be installed.
- Inventory correction: the initial regex counted 102 tables directly declared in schema.ts. Six more tables are re-exported from other schema modules. The effective base contains 108 tables; adding MFA brings the effective schema to 109. The live catalog verifier traverses all table exports.
- F01: test and E2E CI now use migrate, with a catalog comparison of actual tables, columns, types, nullability, auto-increment and index definitions. Remove the independent SQLAlchemy create_all writer. Empty and previous-release migration jobs both run the live verifier.
- F05: standalone job CLI entrypoints no longer execute inside an ESM bundle. BullMQ V2 uses legal names with an `ais` prefix; both queue layers share the Redis URL parser. The worker requires successful DB and Redis queries before announcing readiness.
- F10: optional Forge configuration no longer prevents API/worker startup. Compose orders writers after the migrator and updates the auth service and worker with the API. Kubernetes includes matching auth/worker deployments and CSRF configuration.
- F16: MySQL TLS verifies the server certificate; DB_SSL_CA_FILE supports a private CA. URL credentials are decoded.
- F17: readiness returns HTTP 503 when dependencies are unavailable, and 200 after recovery.

Validation: TypeScript and production build passed. Four focused tests passed (including real HTTP 503/200 behavior and the Redis URL contract). Running dist/index.js with unavailable synthetic services returned live=200 and ready=503. Running dist/worker.js no longer produced ESM or queue-name errors; it rejected the unavailable database instead.

Live MySQL/Docker are unavailable locally. Package installation failed on container UID/group restrictions; no restriction was disabled. SQL replay, nonempty upgrade preservation, image startup with live services and a real background job remain required before production acceptance. No local runtime failure due to missing services is treated as an application regression.

## Remaining slices

- F02/F06/F11: tenant boundaries, request limiting and authenticated offline data.
- F03/F08/F09/F12: MFA enforcement, shared session revocation, owner registration and refresh rotation.
- F04/F07/F15: funded wallet operations, canonical payment settlement and booking transactions/holds.
- F13/F14: image/supply-chain follow-up, honest operational capabilities and durable event handling.

Repository protection settings and production credentials are external to this source revision. They must be reported independently of source fixes.

## Slice 2 — tenant and request boundaries

- F02: `isAdmin` now means platform administration only. `airlineAdminProcedure` requires a matching assigned tenant. Airline booking reads filter by tenant; flight availability updates carry a tenant predicate. Unscoped audit/metrics, financial overrides and platform mutations reject airline admins. Unassigned resources no longer pass the default tenant assertion.
- F06: preserve Redis denial instead of deriving an allowed result from zero remaining quota. Redis errors reach the bounded fallback. Strict checks execute inside each tRPC procedure, including dotted paths, REST adapters and batch members. Network identity uses Express's explicitly configured trusted proxies; arbitrary forwarding headers are ignored.
- F11: API and unclassified dynamic responses use network-only/no-store. The new service-worker cache version removes old AIS caches on activation, and session cleanup requests private-cache removal. API response headers prohibit HTTP caching as well.

Validation: 92 tests in ten affected test files passed; TypeScript passed. Tests exercise actual HTTP 429 for dotted/batched procedures, both tenant rows under a generated SQL predicate, rejection before DB access, Redis denial propagation, and the real service-worker code refusing a previous user's cached response. Live multi-tenant DB/Redis and browser lifecycle verification remain part of acceptance.

## Slice 3 — authentication and shared session authority

- F03: verified passwords and OAuth identities receive a five-minute, five-attempt MFA challenge. Only successful, single-use TOTP/backup verification can mint a session. Challenges store a token hash; row locks protect challenge and backup-code consumption. Proof is bound to the exact enrollment. MFA setup changes revoke existing sessions and challenges. The browser completes the same challenge flow.
- F08: cookie and Bearer authentication consult a shared, revocable refresh-token family on every request, including current role/tenant/MFA state. Cookie tokens have explicit audience/issuer/purpose and a maximum 30-day lifetime. Logout, all-device logout and session revocation invalidate both transports. Old cookies and refresh records intentionally require login again.
- F09: public Python registration always creates role=user, including OWNER_EMAIL.
- F12: refresh rotation claims an unrevoked, unexpired record with an atomic conditional UPDATE before inserting its successor. Concurrent losers receive UNAUTHORIZED and do not mint tokens; the winning family remains usable. HMAC hashes protect refresh tokens at rest.
- Append migration 0014 (MFA challenges and session-family columns); do not edit previously applied migrations. Logout clears client query caches as well as stored tokens.

Validation: affected password/logout/type tests passed (22); the combined MFA/session, password and tenant regression suite passed (28). Real cookie/JWT cryptography under a deterministic DB adapter demonstrates shared revocation, denial without verified MFA, one refresh winner, challenge attempt persistence and consumed backup-code rejection. Python registration is executed under boundary doubles. TypeScript passes. These are not a substitute for MySQL lock/isolation and end-to-end OAuth/MFA acceptance on a configured environment.
