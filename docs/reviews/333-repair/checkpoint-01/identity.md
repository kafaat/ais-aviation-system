# Identity, privacy, loyalty and waitlist fixes

Baseline: `603a59f6` (isolated negative-control worktree). Main work directory: `/workspace/scratch/a857cdae9651/ais-fixes`.

## Changes

- **SEC-01** `account-lock.service.ts`: IP block uses unique-key no-op upsert followed by locking read and conditional update within one transaction. Reuses inactive/expired rows, clears unlock metadata on reactivation, preserves stronger permanent/later active blocks. Rejects non-positive/non-finite durations. Expiry check is read-only, preventing stale auto-unblock from deleting a concurrent renewal. SEC-02 admission middleware left untouched. No schema changes or IP spelling migration.
- **PRIV-01** `saved-passengers.service.ts`: all mutation paths serialize on authoritative `users` row; ownership read, default clear/set, insert/delete, fallback default and readback occur in the same transaction. Nonempty collections retain a default. Existing native service fixture now inserts/deletes a real synthetic user instead of assuming a nonexistent user ID.
- **PRIV-02** `user-preferences.service.ts`: atomic unique-user upsert updates supplied fields only, preserving disjoint changes, false/null and omitted fields.
- **LOY-01** `loyalty.service.ts`, `routers/loyalty.ts`: positive safe recipient ID; lock/check authoritative user before account creation or miles posting; scoped tenant mismatch returns NOT_FOUND without writes. Router supplies trusted context tenant. Null/undefined tenant remains existing platform/internal unscoped convention. Account creation and posting share the transaction; TRPC errors retain their codes.
- **GRP-01** `waitlist.service.ts`: serialize admission with existing flight lock/READ COMMITTED inventory transaction; both waiting and offered block duplicate admission. Priority allocated within the same transaction. Cancelled historical entries permit readmission.

## Validation

- New unit regression suites: `identity-integrity.test.ts` (15), `ip-preferences-integrity.test.ts` (10): **25 passed** on final source.
- Affected regression selection: **88 passed, 0 failed, 36 skipped**, 7 passed files and 3 skipped files. Selection includes new suites, account-lock, waitlist, waitlist inventory atomicity, loyalty service/balance, saved-passengers/preferences service and new native suite.
- **Native NOT_RUN**: 9 new tests in `server/__tests__/identity-integrity-mysql.test.ts`; explicit disposable loopback database guard. No mysqld/docker available. Remaining 27 skipped are existing DB service tests. Skips are not acceptance success.
- Native suite creates a unique empty schema, copies table definitions from migrated `ais_*test` schema only, never copies source data, and drops its own schema. Covers concurrency, trigger-injected rollback, IP lifecycle, valid/invalid bonus recipients, lot conservation and offered waitlist duplicate.
- Added native suite to `.github/workflows/production-gates.yml` after `auth-session-mysql.test.ts`, with root authorization and coordination with workflow owner.
- Negative control: identical final 25 new tests on isolated baseline **22 failed / 3 passed**. Failures expose cleared default after injected failure, orphan/cross-tenant grants, duplicate offered waitlist, duplicate-key IP lifecycle and first preferences saves. JSON receipt `/workspace/scratch/a857cdae9651/identity-negative-control.json`.
- Targeted ESLint `--max-warnings 0`: PASS. `git diff --check` on owned scope: PASS. Source syntax stripped successfully before dependency install.
- Central root owns full TypeScript check; no competing tsc launched here. No commit/push.

## Caveats

Relational doubles verify control flow, persistence/rollback and unique-key patch semantics; they do not prove native MySQL locks. Native concurrency remains pending execution in CI/disposable DB. No production actions, secrets, migrations, financial-policy changes, or operator acceptance claims.
