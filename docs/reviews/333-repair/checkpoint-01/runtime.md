# Runtime integrity fixes — 2026-11-11

Workspace: `/workspace/scratch/a857cdae9651/ais-fixes`.
Read `CLAUDE.md`. No commit, push, deployment, provider call, or database migration execution.

## Implemented

- **AI-01**: briefing cache SHA-256 key contains principal, normalized flight/route/airline ID sets, date range, horizon, and configuration. Labels reflect requested period. Configuration copies are isolated from callers.
- **AI-02**: disabled agents are not invoked by briefing or direct kernel entry points; briefings distinguish disabled/unavailable summaries. Config changes re-key cached results. Max concurrency is enforced. Pricing summary no longer claims an executed active pricing agent. Timeout timers are cleared.
- **OPS-01**: active discovery includes scheduled and delayed flights with fresh telemetry; terminal states remain excluded.
- **OPS-02**: router and service share decimal/geographic/progress validation, before insertion. Invalid/nonfinite/empty values rejected; endpoints accepted.
- **BG-01**: reconciliation filters retryCount < 5, keeps exhausted rows unprocessed for review, scans deterministic ID keyset pages through a captured upper ID. A >100-row eligible backlog is reached despite exhausted earlier rows.
- **BG-02**: explicit retry delay zero preserved; negative/nonfinite delays rejected.
- **UTIL-01**: persistent baseline per favorite/flight/cabin, separate from alerts. First observation does not alert; above-threshold observations still update baseline. Favorite row lock serializes scans; alert and baseline write in same transaction. Merely recording an alert does not update lastAlertSent. Pending intents throttle repeated alerts. Favorite deletion removes observations transactionally.
- **UTIL-02**: atomic compare-and-set claims original SMS row only from failed/rejected state without provider receipt. Retry updates same logical message, including provider receipt and retry count. Concurrent/repeated claims cannot send twice. Pending/ambiguous outcome requires reconciliation, never blind resend. Network failure, missing provider SID, or HTTP 5xx remains unknown (`sms_logs.pending`, notification projection `queued`). Explicit provider rejection remains retryable. A crash after claim leaves pending safely. Historical pending records are not automatically retried/repaired.

## Schema decision and compatibility

Root authorized this additive schema change. Drizzle generated:

- `drizzle/0075_favorite_price_observations.sql`
- `drizzle/meta/0075_snapshot.json`
- appended journal entry in `drizzle/meta/_journal.json`
- `favoritePriceObservations` in `drizzle/schema.ts` (20 added lines only).

New table has ID, favoriteFlightId, flightId, cabinClass, price, observedAt; unique favorite/flight/cabin. No alteration/deletion/backfill of existing data, no monetary changes. Existing favorites begin monitoring at first subsequent scan. Migration must be deployed before new monitor code runs. Existing binaries ignore new table. Migration generation is not migration replay; native replay awaits CI.

## Evidence

1. Regressions written first; original five source files preserved under `/workspace/scratch/a857cdae9651/runtime-baseline/`. Baseline run used original sources then restored fixes in `finally`: **18 failed, 4 passed across 5 suites**. Every failure was a behavioral assertion, not import/compile failure. Log: `/workspace/scratch/a857cdae9651/runtime-red.log`.
2. Initial fixed regression run: **22 passed / 5 suites**.
3. Added direct-agent disable, concurrency, rollback and native acceptance cases. Final affected run including existing SMS production, analytics, background and migration-journal tests: **44 passed, 18 skipped; 9 suites passed, 2 skipped (11 total)**. Log: `/workspace/scratch/a857cdae9651/runtime-final-tests.log`.
4. Skips: existing DB-dependent favorites suite (16); new native MySQL suite (2). No local MySQL/docker available. Service boundary doubles are SQL-aware but are not proof of InnoDB locking or external provider acceptance.
5. New `server/__tests__/runtime-integrity-mysql.test.ts` restricts to explicitly disposable loopback `ais_*test`, clones migration-verified table structure into an isolated generated database, tests concurrent favorite observation/drop and SMS claims, cleans its owned DB. Identity agent added it to `production-gates.yml` native list; ordinary CI coverage discovers server tests. **NOT_RUN locally**.
6. ESLint for all changed service/router/test files: **PASS, no output** (`runtime-lint.log`). Prettier applied to owned files.
7. Local default-heap tsc failed OOM before diagnostics. Root's 6144MB central tsc found one error (notification status pending); corrected to queued in notification history while original SMS remains pending. Final project-wide check owned by root.

Tests run with `node node_modules/vitest/vitest.mjs run ... --maxWorkers=1`. The environment's pnpm wrapper attempted implicit install and refused no-TTY purge; direct installed CLI avoided mutation of central dependencies.

## Changed owned files

- server/services/intelligence/kernel.ts
- server/services/intelligence/kernel.review.test.ts
- server/services/flight-tracking.service.ts
- server/services/flight-tracking.validation.ts
- server/services/flight-tracking.review.test.ts
- server/routers/flight-tracking.router.ts
- server/services/queue-v2.service.ts
- server/services/queue-v2.review.test.ts
- server/services/favorites.service.ts
- server/services/favorites.baseline-review.test.ts
- server/services/sms.service.ts
- server/services/sms.retry-review.test.ts
- server/services/sms.production-boundary.test.ts
- server/**tests**/runtime-integrity-mysql.test.ts
- drizzle/schema.ts and generated 0075 migration/snapshot/journal.

Production-gates native selector was modified by the identity agent, not this agent. No unrelated files changed.
