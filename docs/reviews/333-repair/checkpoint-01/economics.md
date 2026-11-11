# BSP / flight economics / search fixes checkpoint

Implemented in ais-fixes, no commits or schema changes by this worker.

- BSP-01: explicit HOT IDs must exist and match country/closing period; selected HOT lines must match specification currency. Explicit bank IDs must exist and match country/currency/value period. Invalid scope fails before reconciliation writes.
- BSP-R1: only transmitted/accepted RET files provide reported evidence; generated drafts no longer override reported lines. RET lines in foreign currency excluded.
- SVC-01: discovers bookings through sector rows as well as legacy flight header. Uses persisted segmentAmount allocations; conserves fixed processing cost with largest-remainder apportionment. Missing/nonconserving allocations fail closed. Cancelled sectors excluded. Legacy single-flight path unchanged.
- UI-01: alert action opens canonical home search form with origin/destination, allowing real date selection.
- UI-02: departure filter uses the same airport-local time zone as the displayed departure.
- UI-03: direct-only search suppresses unsupported stop options; selected unsupported-only stops return zero results.

Regression files: server/**tests**/bsp-settlement-service.test.ts; server/**tests**/flight-economics-attribution.test.ts; client/src/lib/search-review.test.ts; client/src/components/**tests**/AdvancedFilters.test.tsx.

Tests authored before corresponding implementation where feasible; execution awaits centrally installed dependencies. At checkpoint node_modules/.bin/vitest absent. Required command after installation:

pnpm exec vitest run server/**tests**/bsp-settlement-service.test.ts server/**tests**/flight-economics-attribution.test.ts server/services/seat-economics.service.test.ts client/src/lib/search-review.test.ts client/src/components/**tests**/AdvancedFilters.test.tsx client/src/lib/flight-time.test.ts client/src/lib/return-to.test.ts

Then format owned files, lint them and run project pnpm check centrally.

Limits: relational-memory tests do not prove real MySQL locking or external BSP/operator acceptance. Sector allocation uses stored segment invoice values (current multi-city writer persists these); older null allocations intentionally require reconciliation. SAR policy unchanged. Accepted RET status is trusted as transmission evidence. No owner approvals or external acceptance fabricated.

## Validation completed

Dependencies became available. `pnpm exec vitest ...` could not run because the environment's pnpm wrapper attempted an install and rejected a non-TTY module purge. Used installed binaries directly (no reinstall):

- `./node_modules/.bin/vitest run server/__tests__/bsp-settlement-service.test.ts server/__tests__/flight-economics-attribution.test.ts server/services/seat-economics.service.test.ts client/src/lib/search-review.test.ts client/src/components/__tests__/AdvancedFilters.test.tsx client/src/lib/flight-time.test.ts client/src/lib/return-to.test.ts`: **7 files, 115 tests passed**.
- `./node_modules/.bin/prettier --write` on all 11 owned code/test files: passed.
- `./node_modules/.bin/eslint` on all 11 owned files with `--max-warnings 0`: passed.
- `git diff --check` on owned tracked files: passed before formatting.
- Full-project type check delegated to coordinator to avoid duplicated concurrent runs.

Existing BSP tests that intentionally match RET evidence now explicitly seed transmitted status before reconciliation; separate regression proves generated draft RET remains excluded. New scope tests cover nonexistent IDs, wrong country, wrong bank value date, wrong HOT closing period, and foreign-currency bank/HOT evidence. No real-DB or external BSP acceptance claimed.

## Second assignment: release/operations QA

Reviewed k8s-release-set.py, deploy-k8s-set.sh, previous-release.sh, backup-restore-smoke.py, both workflows, and prune-branches.sh.

Added `scripts/ci/test_release_safety.py` with 10 mocked tests: partial apply state persisted before mutation, private snapshot, restoration/removal of old/new resources, stripping server-owned fields, rejection of unsupported kinds/foreign namespaces before mutation, continued rollback after individual error, background manifest kind compatibility, previous release excludes candidate commit and prerelease tags, leased branch deletion, dry-run safety, archive/open-PR protections, second fresh PR recheck, checksum failure before MySQL, disposable guard before Docker.

Hardened prune-branches.sh with fresh PR and head/archive reads immediately before leased push. Test simulates a PR opening after initial inspection and proves no push occurs. Head CAS remains enforced at server. GitHub does not offer a transaction combining PR state/archive ref and head deletion; a final post-read race remains, so archive protection and operational serialization remain necessary.

Validation: new suite 10/10 passes; bash -n on deploy/previous/prune passes; git diff --check passes. Full scripts/ci discovery ran 61 tests: 58 passed, 2 skipped (Docker Compose absent), 1 failed because required nginx binary absent. Missing-nginx gate was left intact. Existing workflow discovery automatically includes new test module. No real kubectl, Docker restore, or Git branch deletion executed by new tests.

Review confirms background.yaml currently only Deployment/Service; release-set whitelist covers these. Previous release job fetches full history, resolves annotated tag commit, and worktree uses selected SHA. Workflow rollback checks the mutation output set before actual apply. Production serializes deployment without cancelling in-progress runs. These are local mock/inspection results, not cluster acceptance, production data rollback, or PVC/RPO/RTO certification.

At coordinator request, added S-01 retail-offer-concurrency-mysql.test.ts and S-06 stripe-reconciliation-race-mysql.test.ts to Production Gates' explicit native service-boundary run; coordinated with identity-integrity worker. Real MySQL execution remains CI-dependent.
