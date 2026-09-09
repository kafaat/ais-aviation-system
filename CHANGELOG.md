# Changelog

## What's Changed in v1.20.23

### Bug Fixes

- fix(tenant): scope my bookings queries (2f2fef9)

### Maintenance

- chore(ci): apply tenant my-bookings scope slice (3739de3)
- chore(ci): fix tenant slice applicator (201cdd2)

### Other Changes

- Merge pull request #125 from kafaat/fix/tenant-mybookings-scope-20260909 (13de499)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.22...v1.20.23

---

## What's Changed in v1.20.22

### Bug Fixes

- fix(auth): add authenticated route guard (bade7bd)
- fix(auth): protect account-scoped client routes (ca6f3c4)

### Maintenance

- ci(tmp): apply protected route wrappers (a76ad7d)
- chore(ci): remove temporary route applicator (cb4ba36)

### Other Changes

- test(auth): guard account route protection (6f868ba)
- Merge pull request #124 from kafaat/fix/protected-user-routes-20260909 (5db2661)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.21...v1.20.22

---

## What's Changed in v1.20.21

### Bug Fixes

- fix(pwa): keep one service worker authority (3a4aa9f)
- fix(pwa): reference shipped manifest assets (e6ca5fe)

### Other Changes

- test(pwa): guard single service worker authority (802ad86)
- Merge pull request #123 from kafaat/fix/pwa-single-authority-20260909 (7c6945c)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.20...v1.20.21

---

## What's Changed in v1.20.20

### Bug Fixes

- fix(ci): enforce public health probe topology (25ef77e)
- fix(ci): align topology guard with current deployment contract (d9f899d)

### Other Changes

- Merge pull request #121 from kafaat/fix/health-topology-20260909 (19cb2f3)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.19...v1.20.20

---

## What's Changed in v1.20.19

### Bug Fixes

- fix(tenancy): bind booking writes and cancellation to tenant (6daa109)
- fix(tenancy): enforce booking tenant boundary and passenger ownership (1f0560c)

### Maintenance

- ci(production): fail closed on deployment verification (40a20b5)
- ci: format PR120 with repository prettier (86728f1)
- ci(tenancy): retrigger checks after bot formatting (b537482)
- ci(tenancy): establish authoritative verification head (ef2ad42)

### Other Changes

- test(ci): guard production deployment fail-closed contract (7c5727e)
- style(ci): format production deployment contract test (f730cea)
- Merge pull request #119 from kafaat/fix/production-ci-fail-closed-20260908 (759f987)
- test(tenancy): guard booking tenant boundary (3d6acc3)
- style(tenancy): format booking boundary slice (4f9aba0)
- test(tenancy): retrigger booking boundary gates (fe75ed2)
- Merge pull request #120 from kafaat/fix/booking-tenant-boundary-20260908 (2fa2826)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.18...v1.20.19

---

## What's Changed in v1.20.18

### Bug Fixes

- fix(release): skip unconfigured deployment dispatch (adcd5c5)

### Maintenance

- chore(ci): stage release trigger fix (33aae5c)
- chore(ci): remove release trigger helper (29f10eb)

### Other Changes

- test(release): guard optional deployment dispatch (dcec42f)
- Merge pull request #117 from kafaat/fix/release-deployment-trigger-20260908 (7b3993c)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.17...v1.20.18

---

## What's Changed in v1.20.17

### Bug Fixes

- fix(migrations): make Drizzle journal authoritative (b7fdf60)
- fix(ci): align Docker smoke with authoritative migration root (1c5a4d6)

### Maintenance

- chore(migrations): preserve legacy migration archive bytes (e2ea30a)
- chore(ci): temporarily format PR115 with pinned Prettier (11af8e6)
- chore(ci): remove temporary PR115 formatter (1bef350)

### Other Changes

- style(migrations): format journal parity guard (7dd3775)
- style(migrations): apply pinned Prettier output (7f7feac)
- Merge pull request #115 from kafaat/fix/migration-journal-parity-20260908 (ba645d9)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.16...v1.20.17

---

## What's Changed in v1.20.16

### Bug Fixes

- fix(tenancy): make tenant query scope strict by default (8cf5ec3)

### Maintenance

- ci(migrations): test previous-release upgrades (f8b60c8)
- ci: fail closed and pin external actions (#109) (97cf0ae)

### Other Changes

- Merge pull request #108 from kafaat/fix/migration-upgrade-parity-20260908 (4cdb6b4)
- test(tenancy): cover strict default and legacy compatibility (b646734)
- Merge pull request #110 from kafaat/fix/tenant-strict-default-20260908 (719667f)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.15...v1.20.16

---

## What's Changed in v1.20.15

### Bug Fixes

- fix(inventory): make waitlist offers atomic (5dace59)

### Maintenance

- ci: apply waitlist inventory atomicity (2aa2452)
- chore(ci): remove temporary waitlist applicator (490eba4)

### Other Changes

- Merge pull request #107 from kafaat/fix/waitlist-inventory-atomicity-20260908 (51c8323)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.14...v1.20.15

---

## What's Changed in v1.20.14

### Bug Fixes

- fix(inventory): make agent booking creation atomic (#106) (36c05c1)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.13...v1.20.14

---

## What's Changed in v1.20.13

### Bug Fixes

- fix(inventory): make group booking approval atomic (1e96ad2)

### Maintenance

- ci: apply group booking inventory atomicity (4e1ab0c)
- chore(ci): remove temporary group booking applicator (5b24fce)

### Other Changes

- Merge pull request #105 from kafaat/fix/group-booking-inventory-atomicity-20260908 (ce98c4e)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.12...v1.20.13

---

## What's Changed in v1.20.12

### Bug Fixes

- fix(inventory): fail closed on Stripe seat oversell (8e643a1)

### Maintenance

- ci: apply Stripe inventory oversell guard (9ef9bf0)
- chore(ci): remove temporary Stripe inventory applicator (6e43220)

### Other Changes

- Merge pull request #104 from kafaat/fix/stripe-inventory-oversell-guard-20260908 (4aa57b5)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.11...v1.20.12

---

## What's Changed in v1.20.11

### Bug Fixes

- fix(refunds): make local reconciliation atomic (#102) (b01469d)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.10...v1.20.11

---

## What's Changed in v1.20.10

### Bug Fixes

- fix(webhooks): consolidate stripe processing on one authority (#101) (3f54f29)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.9...v1.20.10

---

## What's Changed in v1.20.9

### Bug Fixes

- fix(webhooks): sanitize Stripe signature verification failures (e13056a)

### Maintenance

- ci: apply reviewed legacy webhook salvage (fda7eb6)
- ci: narrow legacy salvage to signature error boundary (ed63362)
- chore: remove temporary legacy salvage workflow (ee3ff57)

### Other Changes

- Merge pull request #100 from kafaat/fix/legacy-salvage-stripe-webhook-20260907 (e8bbed0)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.8...v1.20.9

---

## What's Changed in v1.20.8

### Bug Fixes

- fix(auth): fail closed on weak or missing JWT signing secret (f1f9501)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.7...v1.20.8

---

## What's Changed in v1.20.7

### Bug Fixes

- fix(refunds): bind refund detail reads to authenticated owner (519b35d)
- fix(refunds): pass authenticated actor into detail lookup (ffaec51)

### Maintenance

- chore: apply scoped refund detail authority fix (77cdf76)
- chore: remove failed temporary refund fix workflow (ca7a6a5)

### Other Changes

- test(refunds): guard refund detail ownership boundary (6c7cc09)
- style(refunds): format refund authority regression guard (d214228)
- style(refunds): format refund detail authority service (91b79f7)
- style(refunds): match repository prettier output (41c1824)
- test(refunds): simplify refund detail authority guard (78a9938)
- style(refunds): wrap authority assertion for prettier (3eebd6f)
- Merge pull request #98 from kafaat/fix/refund-detail-ownership-20260907 (49f8076)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.6...v1.20.7

---

## What's Changed in v1.20.6

### Bug Fixes

- fix(refunds): enforce cumulative refund accounting and idempotency (64ec639)
- fix(refunds): recover provider-success retries before balance guard (1704786)

### Maintenance

- chore: add one-shot refund formatter (0c14996)
- chore: remove one-shot refund formatter (ab45388)

### Other Changes

- test(refunds): cover cumulative balance and provider idempotency (1e2e898)
- style(refunds): apply repository prettier (59fec15)
- Merge pull request #96 from kafaat/fix/refund-cumulative-idempotency-20260907 (9f01703)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.5...v1.20.6

---

## What's Changed in v1.20.5

### Bug Fixes

- fix(payments): derive modification checkout amount server-side (24b8bd6)
- fix(client): stop sending modification payment amount (4f5dc25)

### Maintenance

- ci: format self-service security slice once (a2f01a2)
- ci: remove one-time self-service formatter (272825d)

### Other Changes

- security: add scoped self-service capability tokens (b8b53e6)
- security: bind kiosk actions to authenticated capability (9a49d94)
- security: require signed admission and session scopes for bag drop (ae8f0cd)
- test: prove self-service capability isolation (706744e)
- test: lock kiosk and bag-drop authority boundaries (aff70c6)
- style: format bag-drop security boundary (0ccc150)
- style: format self-service boundary tests (284368b)
- style: format self-service capability service (dac7a28)
- style: apply repository formatter to bag-drop boundary (618ad91)
- Merge pull request #94 from kafaat/fix/self-service-capability-boundary-20260907 (a0f06a2)
- test: lock modification checkout price authority (9952049)
- Merge pull request #95 from kafaat/fix/modification-checkout-authority-20260907 (ebdaa7b)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.4...v1.20.5

---

## What's Changed in v1.20.4

### Bug Fixes

- fix(prod): use public liveness probe for container health (32f37fa)
- fix(prod): align compose healthcheck with public liveness probe (5a7ae44)
- fix(prod): use public liveness probe on all API replicas (e1d33d0)

### Maintenance

- ci: add hard production readiness gates (b770c24)

### Other Changes

- style(prod): preserve Prettier formatting for health probe change (91dd4e8)
- test(prod): guard all production healthcheck surfaces (237664e)
- Merge pull request #93 from kafaat/fix/main-production-gates-20260907 (3ad6f86)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.3...v1.20.4

---

## What's Changed in v1.20.3

### Bug Fixes

- fix(security): close auth and financial authority bypasses with regression tests (08f166b)
- fix(security): route booking checkout through provider and format tests (4cbe6a9)

### Maintenance

- build(deps): update dependencies, fix post-deploy CI gate and changelog formatting (#91) (5788af7)

### Other Changes

- test(security): remove one-off preflight and keep regression mocks warning-free (3a49594)
- Merge pull request #92 from kafaat/fix/ais-security-boundaries-20260907 (73f6636)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.2...v1.20.3

---

## What's Changed in v1.20.2

### Bug Fixes

- fix(build): pin pnpm and verify production-only Docker images (7ba8942)
- fix(build): compile frontend in production mode after installing build tools (6b9026d)
- fix(build): resolve PR90 Dockerfile conflict with main v1.20.1 (c91752c)

### Other Changes

- test(build): supply isolated webhook settings for production boot smoke (ce9f3c1)
- style: format build regression test and generated release changelog (923ed90)
- test(docker): consolidate pinning and runtime checks from PR89 (647be14)
- test(docker): distinguish production peers from root development dependencies (be922c7)
- Merge pull request #90 from kafaat/fix/ais-docker-pnpm-20260906 (cd050ce)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.1...v1.20.2

---

## What's Changed in v1.20.1

### Bug Fixes

- fix(docker): pin pnpm from manifest and validate production images before merge (d1903c9)

### Other Changes

- style: format generated v1.20.0 changelog without weakening CI (a6dc74a)
- Merge pull request #89 from kafaat/fix/docker-pnpm-pinning-20260906 (32e6769)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.20.0...v1.20.1

---

## What's Changed in v1.20.0

### Features

- feat(revenue+ai): per-seat economics + AI cost attribution & decision overrides (198cdbc)
- feat(saas): multi-tenancy foundation (Phase 0) + seat-economics/AI-cost dashboard (846e7d3)
- feat(saas): tenant-scope core tables + migration-aware query helpers (Phase 0 step 2) (f4d553d)
- feat(pricing): customer-facing price quote (reference gap-fill) + mapping doc (17384b0)
- feat(boarding-pass): cryptographically signed, offline-verifiable boarding pass (aaf99cd)
- feat(events): transactional outbox — event-driven foundation (Phase 1) (57a1340)
- feat: implement the safe, infra-free batch of remaining gaps (8c9c426)
- feat(ndc): formal ONE Order state machine + lifecycle domain events (6ba7de6)
- feat(events): emit transactional outbox events on payment, refund & ticketing (1f8d311)

### Bug Fixes

- fix(security): enforce tenant isolation on ID-based endpoints + sync docs (1eb6c6e)
- fix(seed): add canonical db:seed script and fix node→tsx invocation (eabb582)
- fix(review): address Copilot findings on outbox, AI usage, price quote, seat economics (acf350b)
- fix(worker): start cron jobs (outbox relay, lock cleanup) in the worker process (1c4f59f)

### Code Refactoring

- refactor(resilience): protect auth-service client with the circuit breaker + tests (bcf57a5)

### Documentation

- docs: add Airline SaaS gap analysis & phased architecture proposal (93318fe)
- docs: add AI agent operations & development ideas (inspired by PilotDeck) (231c090)
- docs: add full-project gap audit (security, data, airline domain, FE/testing/CI) (c399a4f)
- docs: fix markdown escaping of table names in gap audit (0d56d6a)

### Maintenance

- ci: run E2E seed script with tsx so the schema import resolves (93463a3)
- chore: merge main (#80 E2E hardening) into project-exploration branch (16bf543)
- chore: merge main (#80 E2E hardening) into project-exploration branch (aeaa677)
- ci: upgrade semantic PR action to node24-compatible version (d826442)

### Other Changes

- style: apply prettier formatting to CHANGELOG.md (bacb343)
- test(e2e): fix Playwright strict-mode violations in visibility probes (#80) (6e59a32)
- test(ci): run stable e2e smoke coverage in github actions (1adc221)
- test(ci): add dedicated playwright smoke script (a46574e)
- Merge pull request #87 from kafaat/copilot/fix-github-actions-job (dc5c656)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.19.1...v1.20.0

---

## What's Changed in v1.19.1

### Bug Fixes

- fix: critical bug fixes and comprehensive type safety improvements (1fb5014)
- fix: comprehensive review - service bugs, type safety, docs update (a8f4b1e)
- fix: comprehensive service audit - transactions, validation, performance (2880c00)
- fix(lint): resolve remaining require-await warnings (1b6246f)
- fix: deep audit and fix all server/services/ (34 files, 50+ bugs) (8c2d841)
- fix(ci): add Playwright globalTimeout and reduce E2E job timeout (4bd72c1)
- fix(e2e): resolve strict mode violation on password field selector (0d432eb)
- fix(e2e): resolve login button strict mode violation (3 elements) (1fc64e6)
- fix(ci): add auth service to E2E job for login support (3806c46)
- fix(tests): resolve all 19 failing test files (0 failures now) (4d1c5c8)
- fix(e2e): seed test users before E2E tests to fix login timeouts (0008a50)

### Other Changes

- merge: resolve CHANGELOG.md conflict with main (9c83bdb)
- Merge pull request #73 from kafaat/claude/fix-gaps-and-bugs-Tzdte (2e46df2)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.19.0...v1.19.1

---

## What's Changed in v1.19.0

### Critical Security Fixes

- **fix(compensation):** Fix 4 SQL injection vulnerabilities — replaced raw string interpolation with parameterized Drizzle queries
- **fix(wallet):** Fix financial race conditions — switched to SQL-level arithmetic inside transactions to prevent lost updates
- **fix(mobile-auth-v2):** Fix token refresh race condition — wrapped verify-revoke-create flow in database transaction

### Critical Bug Fixes

- **fix(webhooks):** Remove duplicate seat deduction from `payment_intent.succeeded` handler - previously both `checkout.session.completed` and `payment_intent.succeeded` deducted seats, causing flight availability to go negative in race conditions
- **fix(refunds):** Add seat restoration when full refund is processed - neither the webhook handler nor the refund service was restoring seats back to flight availability on full refund/cancellation
- **fix(bookings):** Make `cancelBooking` atomic with database transaction - booking status update and seat restoration were separate DB calls, risking partial failure
- **fix(payments):** Target specific payment record by `transactionId` instead of updating all payment records for a booking via `bookingId`
- **fix(rebooking):** Wrap multi-step rebooking (booking + passengers + ancillaries + seat update) in single database transaction to prevent partial failures and orphan records
- **fix(rebooking):** Fix ancillary pricing copied as 0 during rebooking - now preserves original unit/total prices
- **fix(disruption):** Wrap flight disruption creation in transaction to prevent race conditions between concurrent disruption reports
- **fix(kiosk):** Fix seat assignment race condition - seat availability check and assignment now wrapped in transaction
- **fix(split-payment):** Fix markSplitPaid race condition - split status update, all-paid check, and booking confirmation now atomic in single transaction

### Transaction Safety (14+ services)

- Wrapped multi-step operations in database transactions: irops, crew-assignment, emergency-hotel, eticket, multi-city, price-lock, travel-scenarios, stripe-webhook, idempotency-v2

### Bug Fixes

- **fix(ancillary):** Replace plain `Error` throws with proper `TRPCError` in ancillary services (12 instances)
- **fix(loyalty):** Fix race condition in `processExpiredMiles` - wrap each account's mile expiration in a database transaction with fresh balance reads and SQL-level arithmetic
- **fix(notification):** Replace 9 plain `Error` throws with `TRPCError`, add null check on insert result
- **fix(disruption):** Replace plain `Error` with `TRPCError`, add input validation (type, delayMinutes, newDepartureTime)
- **fix(cancellation-fees):** Add input validation for totalAmount and departureTime, handle unconfirmed bookings
- **fix(dcs):** Add try-catch around 3 JSON.parse calls (cargoZones, cargoDistribution, warnings) with safe fallbacks
- **fix(kiosk):** Add try-catch around JSON.parse for applicableCabinClasses with safe fallback
- **fix(types):** Replace 30+ `any` types with proper types in core infrastructure (errors.ts, correlation.ts, idempotency.service.ts, audit.service.ts, storage.ts)
- **fix(types):** Fix non-null assertions across 15+ service files with proper null checks
- 75+ plain `Error` → `TRPCError` replacements across 20+ service files
- JSON.parse safety with try-catch in 7 files (weight-balance, codeshare, apis, db-optimizer, queue, queue-v2, dcs)

### Performance

- **perf(db):** Fix N+1 query in `getBookingsByUserId` - reduced from N+1 queries to exactly 2 queries using batch passenger fetch with `inArray`

### Features

- **feat(intelligence):** Add Intelligence Kernel (AAIP) - multi-agent autonomous platform with Economics, Fraud, and Operations agents, AI Gateway, and tRPC router with 9 endpoints

### Maintenance

- **refactor:** Fix all `require-await` lint warnings (correlation.ts, intelligence router/kernel, fare-rules, load-planning, notification helpers, stripe-webhook-v2)
- **refactor:** Reduce ESLint warnings from 835 to 233 (0 errors)
- **test:** All 755 tests passing, full build verified (dist/index.js + dist/worker.js)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.18.0...v1.19.0

---

## What's Changed in v1.18.0

### Features

- feat: activate remaining Phase 4 features with admin pages, navigation, and operations guide (8df652d)

### Bug Fixes

- fix(ci): add pre-commit hook and auto-format to prevent recurring Prettier failures (bb7d7fe)

### Other Changes

- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (f92512a)
- Merge pull request #70 from kafaat/claude/implement-todo-zrBPj (2c97729)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.17.0...v1.18.0

---

## What's Changed in v1.17.0

### Features

- feat: implement TODO items - payment history, soft delete, security, timeouts, i18n emails (7eb36c5)
- feat: add Arabic translations for Phase 4 pages and improve UI styling (8c0d604)

### Bug Fixes

- fix: complete SLA Dashboard translation updates from background agent (c9d3bbb)
- fix: finalize SLA Dashboard i18n translation updates (2a4903f)
- fix: format SLADashboard and RevenueAccounting with Prettier (47e1525)
- fix(ci): resolve dependency-review error and breaking-changes false positives (bce4e0b)
- fix(lint): resolve 10 lint warnings across client components (4ec4877)

### Maintenance

- ci: retrigger CI pipeline (67f1d38)

### Other Changes

- test: add comprehensive tests for new features (68 tests) (4c2b8b5)
- Fix skip-nav links visible in RTL mode & add flights table docs (2168eff)
- Merge branch 'main' into claude/implement-todo-zrBPj (ab2e0b3)
- style: format CHANGELOG.md with Prettier (d62052e)
- Merge pull request #69 from kafaat/claude/implement-todo-zrBPj (8df6e72)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.16.0...v1.17.0

---

## What's Changed in v1.16.0

### Features

- feat: implement TODO features - flight preview, smart suggestions, form validation, loading states (6762fb7)

### Other Changes

- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (a2977c7)
- style: format CHANGELOG.md after merge from main (1e2a2fb)
- Merge pull request #68 from kafaat/claude/implement-todo-zrBPj (c370d25)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.15.0...v1.16.0

---

## What's Changed in v1.15.0

### Features

- feat: add phase 5 schema and competitive analysis roadmap (462c42f)
- feat: add ndc, gds, and codeshare/interline services (b9632f8)
- feat: add emd, fare rules, and seat map services (8896512)
- feat: add phase 5 routers for ndc, gds, codeshare, interline, emd, fares, seats (4013618)
- feat: add i18n keys for phase 5 aviation modules (en/ar) (fa84b59)

### Other Changes

- style: fix prettier formatting for fare-rules and gds services (65054ec)
- frontend running successfully (95079c1)
- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (8871df5)
- style: format CHANGELOG.md after merge from main (91422e5)
- Merge pull request #67 from kafaat/claude/implement-todo-zrBPj (9caf74c)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.14.0...v1.15.0

---

## What's Changed in v1.14.0

### Features

- feat: add multi-provider payment gateway with local and regional providers (3d8d588)

### Other Changes

- Add analytics date filters/export, account lockout security, and i18n (965cd7c)
- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (7ac0857)
- Fix Prettier formatting for CHANGELOG.md after merge from main (f267a5f)
- Merge pull request #66 from kafaat/claude/implement-todo-zrBPj (c7d9d99)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.13.0...v1.14.0

---

## What's Changed in v1.13.0

### Features

- feat: close competitive gaps with 22 new feature modules (40946f8)

### Bug Fixes

- fix: resolve ESLint errors and format CHANGELOG.md (814b80b)

### Documentation

- docs: update documentation for Phase 4 competitive gap features (1001d1a)

### Other Changes

- Merge remote-tracking branch 'origin/main' into claude/implement-todo-zrBPj (37fba0d)
- Merge pull request #65 from kafaat/claude/implement-todo-zrBPj (9041964)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.12.0...v1.13.0

---

## What's Changed in v1.12.0

### Features

- feat: add live flight tracking, inventory locking, overbooking management, and quick rebooking (dc4981b)
- feat: add admin overbooking management page and fix unused imports (3f0310c)

### Bug Fixes

- fix: rewrite CHANGELOG.md with consistent format and fix version-bump script (f5da47f)
- fix: close critical integration gaps for inventory, rebooking, and overbooking (97399fd)

### Documentation

- docs: add comprehensive system comparison analysis (AR/EN) (0a2f08a)

### Other Changes

- style: apply prettier formatting to OverbookingManagement (2dbc1eb)
- Merge pull request #64 from kafaat/claude/implement-todo-zrBPj (fa25bf1)

**Full Changelog**: https://github.com/kafaat/ais-aviation-system/compare/v1.11.0...v1.12.0

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.11.0] - 2026-02-08

### Added

- Sanaa, Aden, and Muscat destinations with airlines and flights (0be56d6)
- Aircraft type models to seed data: A320, A330, A350, B727, B737, B777, B787 (9c26281)
- SeatMap displays aircraft-specific seat layouts (8b47507)
- SeatMap component integrated into booking flow (bad4715)

### Documentation

- Update documentation for new destinations and currencies (cf01410)

**Full Changelog**: [v1.10.1...v1.11.0](https://github.com/kafaat/ais-aviation-system/compare/v1.10.1...v1.11.0)

---

## [1.10.1] - 2026-02-08

### Fixed

- Improve accessibility across all major pages — WCAG compliance (3d7e966)
- Add kubeconfig validation to prevent deploy failures (1fb1a88)
- Auth service not registered (9668b04)

**Full Changelog**: [v1.10.0...v1.10.1](https://github.com/kafaat/ais-aviation-system/compare/v1.10.0...v1.10.1)

---

## [1.10.0] - 2026-02-08

### Added

- FastAPI auth service with password-based authentication (c525250)
  - New `auth-service/` microservice (FastAPI + SQLAlchemy + bcrypt)
  - User registration, login, and password verification endpoints
  - Auth service client for Node.js backend communication
  - Docker Compose integration for all environments
  - Updated Login page with email/password form alongside OAuth

### Fixed

- Resolve non-DB E2E test failures (87d2f90)
- Resolve login 404 by fixing CSP, service worker, and PWA config (d3da166)

### Security

- Upgrade python-jose 3.3.0 → 3.4.0 (CVE-2024-33663, CVE-2024-33664)
- Upgrade python-multipart 0.0.20 → 0.0.22 (CVE-2026-24486)
- Upgrade cryptography 44.0.0 → 44.0.1 (CVE-2024-12797)

**Full Changelog**: [v1.9.0...v1.10.0](https://github.com/kafaat/ais-aviation-system/compare/v1.9.0...v1.10.0)

---

## [1.9.0] - 2026-02-08

### Added

- AI dynamic pricing system with ML demand forecasting, customer segmentation, revenue optimization, and A/B testing (afbe66f)

### Fixed

- Integrate AI pricing with booking flow and add comprehensive tests (57195da)
- Add E2E test support with data-testid attributes and dev login form (953a4b3)

**Full Changelog**: [v1.8.4...v1.9.0](https://github.com/kafaat/ais-aviation-system/compare/v1.8.4...v1.9.0)

---

## [1.8.4] - 2026-02-08

### Fixed

- Address security vulnerabilities and race conditions (bdf1e8e)
- UI fixes — icons, RTL support, accessibility, and dead links (7c11bad)
- Resolve CI lint warnings and Docker build failure (e135804)
- Deep UI audit — critical bugs, RTL, accessibility, and cleanup (9369970)
- Resolve 5 critical middleware bugs found in deep review (96ef1a5)
- Comprehensive backend review — 28 files, security and correctness fixes (ebd4b1e)
- Phase 2 — architecture, integration, and infrastructure deep review (49 files) (9b7bb52)
- Remove stale patchedDependencies from lockfile (2084105)
- Resolve 8 failing test cases across 4 test files (df7b0b8)
- Fix duplicate 'db' variable declaration in flight-status test (e33e840)

**Full Changelog**: [v1.8.3...v1.8.4](https://github.com/kafaat/ais-aviation-system/compare/v1.8.3...v1.8.4)

---

## [1.8.3] - 2026-02-07

### Fixed

- Login button now navigates to dedicated /login page (a6a9475)

**Full Changelog**: [v1.8.2...v1.8.3](https://github.com/kafaat/ais-aviation-system/compare/v1.8.2...v1.8.3)

---

## [1.8.2] - 2026-02-07

### Fixed

- Prevent crash when VITE_OAUTH_PORTAL_URL is not configured (4244894)

### Documentation

- Comprehensive documentation update for all sessions and phases (27b16ac)

**Full Changelog**: [v1.8.1...v1.8.2](https://github.com/kafaat/ais-aviation-system/compare/v1.8.1...v1.8.2)

---

## [1.8.1] - 2026-02-07

### Fixed

- Mock loyalty tests and add missing env vars documentation (ad11c89)
- Prevent Sentry crash with invalid/placeholder DSN values (2de0629)

**Full Changelog**: [v1.8.0...v1.8.1](https://github.com/kafaat/ais-aviation-system/compare/v1.8.0...v1.8.1)

---

## [1.8.0] - 2026-02-07

### Added

- Comprehensive admin, notifications, email, error handling, and security improvements (c039ce9)
- Background job worker (`server/worker.ts` → `dist/worker.js`)
- Inventory lock conversion after payment confirmation
- Price alerts notification delivery (in-app + email)
- Docker `.dockerignore` for optimized builds
- `.env.prod.example` with Docker-specific URLs
- HEALTHCHECK in Dockerfile.prod
- Redis service in docker-compose.prod.yml
- Admin sidebar links for Baggage, Corporate, Travel Agents
- 7 new routes: /baggage, /admin/baggage, /admin/corporate, /admin/travel-agents, /corporate, /corporate/bookings
- 78+ i18n translation keys (Arabic analytics, cancel/modify booking dialogs)
- Queue service: cancellation, refund, and push notification delivery
- Carbon offset calculation with DB-backed airport coordinates

### Fixed

- Seats now deducted from flight availability after Stripe payment
- AccessibilityProvider missing in App.tsx (Home page crash)
- Vite dev server config not resolving (defineConfig function spread)
- `throw new Error()` replaced with `TRPCError` in bookings router
- Currency default changed from USD to SAR in payment service
- E-ticket generation blocked for cancelled/pending bookings
- Group bookings always using economy price (cabinClass now passed)
- Corporate credit calculation Math.abs bug
- Waitlist seat deduction on offer to prevent overbooking
- Travel agent monthly booking limit enforcement
- Split payment server-side amount and expiry validation
- AI chat date comparison (eq → lt) for archiving old conversations
- AI guardrails returning safe:true for warning severity
- Rebooking status eligibility check (only confirmed/pending)
- Stripe webhook path mismatch in nginx.conf
- Disruption queries optimized with SQL WHERE IN
- BaggageStatus.tsx wrong useAuth import source
- JoinWaitlistDialog not passing notification preferences
- DCS aircraft seat validation (totalSeats >= economy + business)

### Changed

- Build script now produces both dist/index.js and dist/worker.js
- `allowNonAppliedPatches` updated to `allowUnusedPatches` in pnpm config
- CI pipeline: build job no longer depends on E2E tests
- family-pool.service imports from main schema.ts instead of loyalty-schema.ts
- AIChatBox demo code corrected: trpc.ai.chat → trpc.aiChat.sendMessage

### Removed

- 4 duplicate schema files (loyalty-schema, flight-status-history-schema, inventory-locks-schema, modification-schema)

**Full Changelog**: [v1.7.2...v1.8.0](https://github.com/kafaat/ais-aviation-system/compare/v1.7.2...v1.8.0)

---

## [1.7.2] - 2026-02-07

### Fixed

- Critical frontend issues — missing providers, routes, and navigation (1f2e14e)
- Critical Phase 1 & 2 bugs — seat deduction, pricing, validation (a01b959)
- Consolidate schema imports and fix demo code router name (7659fdd)
- Phase 3 bugs + Docker configuration fixes (d348b22)
- Worker entry point, inventory locks, price alerts, and prettier (93b7789)
- Complete all remaining issues with i18n, todos, and documentation (9a49d52)
- Replace hardcoded strings with i18n, fix TODOs in MultiCity and email worker (3ff81ff)

### Refactored

- Remove duplicate schema files in favor of main schema.ts (279f443)

**Full Changelog**: [v1.7.1...v1.7.2](https://github.com/kafaat/ais-aviation-system/compare/v1.7.1...v1.7.2)

---

## [1.7.1] - 2026-02-06

### Fixed

- CI pipeline and project issues (b0e7be8)
- Resolve vite config function before spreading in dev server (a6e5ace)

**Full Changelog**: [v1.7.0...v1.7.1](https://github.com/kafaat/ais-aviation-system/compare/v1.7.0...v1.7.1)

---

## [1.7.0] - 2026-02-06

### Added

- Phase 5: AI guardrails, chat UX, and production enhancements (5cda54a)

### Fixed

- Add shamefully-hoist for pnpm to fix E2E server startup (4d4bdf2)
- Use dynamic imports for trpc-openapi to prevent server crash at startup (4ead878)
- Wrap OpenAPI document generation in try/catch (92bf803)
- Make E2E tests non-blocking and wrap OpenAPI middleware in try/catch (474c2ec)

**Full Changelog**: [v1.6.0...v1.7.0](https://github.com/kafaat/ais-aviation-system/compare/v1.6.0...v1.7.0)

---

## [1.6.0] - 2026-02-06

### Added

- Rebooking from previous booking feature (5b73f4b)
- 6 travel scenarios: pricing, validation, auto check-in, sharing, carbon, travel docs (86391d0)
- Phase 3 DCS — Departure Control System (29b11b2)
- Phase 4: payment history and soft delete for bookings (f9d94b8)

### Fixed

- Resolve 5 pre-existing test failures in CI (5f4079d)
- Resolve CI failures: vouchers reserved word and idempotency null check (47e7bf3)
- Rewrite idempotency to check-first approach for MySQL NULL handling (f4bc165)
- Change OAuth server URL from manus.space to localhost (475dafc)

**Full Changelog**: [v1.4.0...v1.6.0](https://github.com/kafaat/ais-aviation-system/compare/v1.4.0...v1.6.0)

---

## [1.4.0] - 2026-02-06

### Added

- Interactive seat map integration into check-in (bb708fb)
- Price lock, meal pre-order, and family mile pooling features (ad8c5e1)
- Digital wallet, enhanced price calendar, and disruption hub (8a448ea)

### Fixed

- Improve test mocks to work without database connection (434ba94)
- Add default value of 1 for numberOfPassengers in bookings table (6b282b7)
- Correct stripeEvents column names in critical-paths tests (0e11ca8)

**Full Changelog**: [v1.3.3...v1.4.0](https://github.com/kafaat/ais-aviation-system/compare/v1.3.3...v1.4.0)

---

## [1.3.3] - 2026-02-05

### Fixed

- Resolve 41 lint warnings across client and server (0708071)
- Update critical-paths.test.ts to use correct schema (a7048f1)
- Update CodeQL to v4 and fix coverage thresholds (4278905)

**Full Changelog**: [v1.3.2...v1.3.3](https://github.com/kafaat/ais-aviation-system/compare/v1.3.2...v1.3.3)

---

## [1.3.2] - 2026-02-05

### Fixed

- Add booking ownership verification to ancillary service endpoints (2181b21)
- Align test fixtures with current database schema (e967302)
- Remove non-existent password field from test user inserts (dba030b)

**Full Changelog**: [v1.3.1...v1.3.2](https://github.com/kafaat/ais-aviation-system/compare/v1.3.1...v1.3.2)

---

## [1.3.1] - 2026-02-05

### Fixed

- Resolve lint errors: duplicate imports and prefer-const (1317f22)
- Resolve gitleaks commit range error in CI (17c1a5d)
- Add --force flag to db:push for non-interactive CI (253dd66)
- Resolve test failures in CI (7d0fc45)

### Documentation

- Update CLAUDE.md with Phase 2 features documentation (9bc474c)

**Full Changelog**: [v1.3.0...v1.3.1](https://github.com/kafaat/ais-aviation-system/compare/v1.3.0...v1.3.1)

---

## [1.3.0] - 2026-02-05

### Added

- Phase 2 components, services, and TypeScript fixes (505ceae)
- Voucher/credits system and Phase 2 features (041ccec)
- Gate management UI and translations (5ee327a)

**Full Changelog**: [v1.2.0...v1.3.0](https://github.com/kafaat/ais-aviation-system/compare/v1.2.0...v1.3.0)

---

## [1.2.0] - 2026-02-05

### Added

- Phase 2 features: advanced aviation system capabilities (ac7ce89)

**Full Changelog**: [v1.1.1...v1.2.0](https://github.com/kafaat/ais-aviation-system/compare/v1.1.1...v1.2.0)

---

## [1.1.1] - 2026-02-05

### Fixed

- Handle repository-dispatch permission issue gracefully (2c3fe3c)
- Resolve duplicate import errors in MyBookings and SearchResults (248c94c)
- Make dependency review optional when Dependency Graph is disabled (f14c385)
- Update lockfile and fix breaking changes check script (6134101)

**Full Changelog**: [v1.1.0...v1.1.1](https://github.com/kafaat/ais-aviation-system/compare/v1.1.0...v1.1.1)

---

## [1.1.0] - 2026-02-05

### Added

- Production-ready improvements: security, monitoring, and testing (e953154)
- Comprehensive CLAUDE.md for AI assistant guidelines (a8e87b6)
- AI chat booking system and enhanced features (804f546)
- Reports dashboard, price calendar, SMS service, loyalty admin (91688a5)
- Favorites, check-in reminders, search history (944814b)
- Advanced features: lazy loading, accessibility, PWA, WebSocket (4dbd34d)

### Fixed

- Update wouter version and fix pnpm lockfile (955aa36)
- Fix TypeScript errors in Stripe services (8495681)
- Fix all 55 TypeScript errors in the codebase (e91b108)

**Full Changelog**: [v1.0.0...v1.1.0](https://github.com/kafaat/ais-aviation-system/compare/v1.1.0-beta...v1.1.0)

---

## [1.0.0] - 2025-10-01

### Added

- Flight search by route and date
- Complete booking flow from search to payment
- Stripe checkout and webhooks integration
- OAuth user authentication
- Admin dashboard for flight and booking management
- Online check-in with seat selection
- React 19 + TypeScript frontend
- Express + tRPC backend
- MySQL/TiDB with Drizzle ORM
- Tailwind CSS + shadcn/ui
- Vite build system
