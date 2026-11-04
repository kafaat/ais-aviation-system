# Resilience and capability follow-up — 4 November 2026

## Baseline and ownership

This follow-up starts from merged main
`e80d8790fba2a30e3164322e0fe40ed5a62bb553` after PRs #268 and #269.
The verified baseline has 4,472 passing unit/integration tests in 355 files,
62 first-attempt Chromium passes, and successful native acceptance on MySQL
8.0 and 9.7. These are baseline receipts, not acceptance of the changes below.

Six workstreams use isolated worktrees and one integration branch. The
execution environment allows three workers plus the coordinator at once;
the six workers therefore run in overlapping waves. Only the coordinator
publishes the integrated pull request.

| Workstream       | Implementation scope                                                                                                                | Required evidence                                                                                                                              | State       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Cache recovery   | Durable completion of namespace invalidation across Redis outages and writer restart; generation capture through asynchronous fills | Controlled lost-invalidation reproduction, native Redis/MySQL recovery, prefix isolation, stale-fill rejection                                 | Implemented |
| Request limits   | Bounded post-readiness transport failure; atomic quota operation and conservative local fallback accounting                         | Actual ioredis/RESP fault tests, no delayed command replay, quota retained across failure                                                      | Implemented |
| Privacy shutdown | Independent deadline for the owned one-shot privacy process, including a blocked event loop                                         | Real subprocess failure cases for unresponsive SQL and blocked log transport; nonzero deadline exit; retained successful drain/redaction cases | Implemented |
| Reports          | Complete behavior supported by authoritative current records; retain explicit missing source and acceptance boundaries              | Executing report regressions, ownership and financial invariants, current catalog inventory and concrete remaining dependencies                | Implemented |
| Coverage         | Prioritize exercised production entry points among uncovered paths; repair defects reproduced by added tests                        | Behavior regressions, negative and cross-owner cases, current-source coverage without changing exclusions or thresholds                        | Implemented |
| CI compatibility | Review Codecov and Slack action migrations separately from application runtime selection                                            | Pinned upstream manifests and compatibility review; workflow/input/gate validation; no notification sends during verification                  | Implemented |

## Integration rules

- Preserve existing work, source identity, failed attempts and exact-source receipts.
- Reserve migration `0067` for durable cache generations; coordinate any other
  schema change before implementation.
- Do not promote a partial or blocked report without its missing authoritative
  source or acceptance evidence. External APIS, GDS, interline, BSP, payment and
  physical-device acceptance cannot be manufactured from local fixtures.
- Keep failure exits, authorization, provider boundaries, timeouts and required
  CI gates meaningful. A cancelled or skipped case is not a passing case.
- Keep deployed Railway configuration, branch protection and release proposals
  outside this implementation scope. The existing v1.37.0 release PR is separate.

## Delivered behavior and local evidence

| Workstream                | Delivered result                                                                                                                                                                                                                                                         | Focused local evidence                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cache recovery            | Migration 0067 stores prefix-scoped global/namespace generations in MySQL. Failed authority reads bypass both caches. Production read/fill pairs retain their captured generation. `clearAll` distinguishes durable versioned invalidation from unconfirmed raw cleanup. | 63 passing cases, including two owned native Redis/TCP-partition cases. Three real MySQL/multiprocess cases require CI.                                                                                                                    |
| Request limits            | Atomic Redis increment/expiry, a 250 ms request-command deadline, no offline/resend queue, and conservative per-process quota continuity. Independent review also corrected a stale library socket timer and an indefinitely extending quota window.                     | Final integrated run: 55 passing cases in five files, including four native Redis cases and actual ioredis transport recovery. Independent read-only review closed both follow-up findings.                                                |
| Privacy shutdown          | A pure Node supervisor bounds its owned one-shot child, including synchronous logger stalls. Deadline/cancellation remains failure; normal work still drains its pool and logger before natural success.                                                                 | 56 passing cases in six files, including 21 privacy subprocess cases and the existing API/pool/logger guards.                                                                                                                              |
| Reports                   | Nullable legacy children inherit only their owning booking; explicit tenant/passenger/flight conflicts are excluded before source limits and financial aggregation, including global views.                                                                              | 93 passing cases in seven executed files; adversarial 10,005-row sources preserve valid totals and exports. One additional case is in the existing native finance suite.                                                                   |
| Active authority coverage | Transactional booking deletion/restoration; exact-ID atomic purge with an explicit 30-source financial/document guard and legacy markers; invalid crew expiry rejection; executing consent revision/rollback/allowlist coverage.                                         | Final integrated run: 107 passing cases in five files. Three new native MySQL purge cases require CI. No coverage threshold or exclusion changed.                                                                                          |
| CI compatibility          | Full SHA pins for Slack v4 and composite Codecov v7; preserved payloads, failure semantics and application Node selection. Required jobs provision a pinned owned Redis binary and execute the new native suites.                                                        | 11 workflows pass actionlint and exact allowed-change YAML comparison; nine existing workflow guards pass; eight official Slack bundle cases pass against an isolated local HTTP fixture; fresh pinned Redis build and refusal cases pass. |

The coordinator also ran the combined shutdown/rate-limit group (101 passes)
and cache/tenant group (67 passes) before the rate-limit follow-up, then reran
the final rate-limit group above. These are overlapping verification attempts,
not additive test-count or whole-suite coverage claims. Native Redis was built
from official Redis 7.4.5 commit
`7e0f53393290f7c1f35596117b67748efad16580` and every local test server was owned,
loopback-only and disposable.

The generated service catalog includes the new active generation authority and
the changed purge reads. Migration/snapshot parity was checked without changing
any previous migration. The schema has 181 application tables, or 182 including
the migration journal table.

Detailed evidence, commands and boundaries are in:

- [Durable cache recovery](../CACHE_RECOVERY_2026-11-04.md).
- [Rate-limit recovery](../audits/rate-limit-recovery-20261104.md).
- [Privacy subprocess shutdown](../audits/privacy-worker-shutdown-20261104.md).
- [Report source and acceptance ledger](20261104-report-source-acceptance-ledger.md).
- [Active authority coverage and retained references](../audits/critical-authorities-coverage-20261104.md).
- [Action runtime migration and compatibility](../audits/actions-node24-migration-20261104.md).

## Integrated acceptance gates

The full application, operational scripts, E2E and acceptance TypeScript checks
passed on the integrated implementation. The coordinator also checks affected
source/test files with zero-warning ESLint, formatting, generated catalogs,
migration/snapshot parity and the final publication diff. Local execution has
no native MySQL server; a skipped native case is not a pass.

Both required MySQL 8.0/9.7 jobs explicitly select the cache recovery, native
Redis quota/cache and booking-purge suites. The full coverage job includes them
too. Missing native Redis provisioning fails the required job instead of
silently skipping its six native Redis cases. Existing API-process SIGTERM,
transaction acceptance, backup/restore, browser and security gates remain in
place. Required CI must pass against the published commit/tested merge tree;
its source-bound artifacts and run links are the final acceptance record, not
the local counts in this document.

## Remaining boundaries and follow-up work

- **Reports:** availability remains 99 definitions: 36 available, 35 partial and
  28 blocked. The separate 63-entry ledger names each missing source and its
  acceptance condition. Ten blocked definitions directly require external
  acceptance; eighteen require other missing source/business models. No local
  fixture grants provider, issuer, accounting or physical-device acceptance.
- **Administrative rate reset:** the pre-existing `resetRateLimit` path can
  clear local state and report success without a confirmed shared Redis delete.
  This patch fixes request accounting, not a reliable distributed administrative
  reset. A follow-up must define that contract and test missing acknowledgements
  and multiple instances before claiming a successful shared reset.
- **Purge concurrency and scope:** the explicit guard preserves existing
  financial/document evidence. The live compensation claim writer does not use
  the shared booking-lock protocol, and general operational/JSON references are
  outside the guard. A complete retention/reference model needs those writers
  and sources addressed; this change introduces no cascade or legal policy.
- **Purge cost:** three guarded sources lack a dedicated booking lookup index.
  Query-plan, index and batching work remains necessary before claiming a
  production latency bound for large histories.
- **Cache and quota scope:** namespace invalidation is durable after its
  acknowledged SQL update; source mutation plus invalidation is not made atomic.
  Raw price-calendar/session helpers retain their separate best-effort contract.
  Redis-outage quota continuity is per process, not a global disconnected quota.
- **Coverage:** the newly tested active services are three selected risk paths.
  Other active zero-executed paths, including ticket rendering, gates and
  rebooking, remain in the backlog. A new whole-repository coverage percentage
  requires the complete source-bound CI receipt.

## Concurrent work

During integration, the separate security PR #270 appeared at
`bee99028ee59053b54f5fdb758d59fd41ba4e25a`. Its changed paths were reviewed and a
read-only three-way merge check found no textual conflict with this work. It
changes dependency manifests, so a future main update requires checking the
actual combined source/dependency tree. Its work is not duplicated here. The
existing v1.37.0 release PR #262 remains separate. No Railway configuration or
branch-protection setting is changed by this follow-up.
