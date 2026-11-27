# AIS source audit and correction implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with independently owned worktrees and root integration. The user explicitly authorized parallel audit and execution. Continue reversible authorized work without another approval round.

**Goal:** Establish a source-bound system inventory and requirements/evidence registers, repair substantiated high-risk defects, and distinguish verified behavior from remaining operational acceptance.

**Architecture:** Preserve the existing React/tRPC service architecture, Drizzle MySQL authority, FastAPI identity service, and BullMQ worker. Use small corrections at the established ownership boundaries, isolated MySQL/Redis resources and independent review. Do not change financial policy or enable external capabilities.

**Tech Stack:** Node 24.22.3 in this workspace; repository pnpm 10.34.5; TypeScript 5.9.3; React 19; tRPC 11; MySQL; Redis; FastAPI; Vitest and Playwright.

**Spec:** User's 39-section Master Execution Prompt, received 28 November 2026 Asia/Aden; repository `CLAUDE.md`, ADRs, implementation contracts and capability catalog.

## Global Constraints

- Preserve existing user changes and unrelated work.
- Do not fabricate requirements, APIs, results, evidence, or completion claims.
- Do not weaken validation, security, business invariants, or tests to obtain passing results.
- Preserve financial history and auditability.
- Do not perform destructive tests, load tests, fault injection, real payments, or external notifications in production without explicit authorization.
- Use the actual target database engine for engine-specific claims.
- Keep implementation and verification status separate.
- No deployment, external provider operation or multi-currency activation is included in this branch.
- Keep baseline evidence bound to `97f5fbf3375102fff420a2e8f404bd2e9f742fbf`, tree `6976885d83a53fbe366ce7422d866f451560fbfe`; record any later source separately.

## Review Focus

1. A user moved between tenants must not read or mutate former-tenant bookings through financial convenience endpoints.
2. Absent, invalid and expired travel-document fields must retain their meanings across saved-passenger selection, form updates, request validation and persistence.
3. A dependency failure must remain distinguishable from a valid negative business result in payment UI.
4. Production Compose settings must satisfy the worker's runtime invariants and preserve queued jobs.
5. Native tests, UI interaction and integration receipts must state their exact setup and must not turn mocks, skipped tests or prior commits into current acceptance.

## Task 1: baseline, reproducible setup and evidence registers (root)

- [x] Fetch current main and open requests; preserve current code in a new audit branch.
- [x] Read repository guidance and architecture/capability acceptance boundaries.
- [ ] Install the exact locked package manager/dependencies without changing the lock.
- [ ] Record baseline build, types, regression and runtime outcomes; preserve original failures.
- [ ] Extract file, module, route, field, configuration and test inventories with stable identifiers.
- [ ] Build requirements, traceability, compatibility, journey, defect and readiness registers with explicit review status.

## Task 2: tenant isolation in financial reads and writes (security worker)

**Files:** `server/routers/payment-history.ts`, `server/services/payment-history.service.ts`, `server/routers/vouchers.ts`, `server/services/voucher.service.ts`; meaningful focused/native tests discovered beside existing tests.

**Interfaces:** Consume the authenticated user's current tenant through the existing tRPC context and invoice/booking authority. Preserve the public response contract and intentional legacy-null policy; return only authorized rows and reject unauthorized writes before replay or settlement.

- [ ] Reproduce former-tenant payment-history exposure and voucher/credit write access using distinct tenant fixtures.
- [ ] Add failing regression tests covering positive access, moved-user rejection, pagination/statistics consistency and zero-write negative cases.
- [ ] Apply the smallest tenant predicate/parameter propagation correction across affected callers.
- [ ] Run focused and actual MySQL tests, record baseline red and corrected green results.
- [ ] Independently review source, compatibility, legacy behavior and financial side effects.

## Task 3: passenger field integrity and payer recovery (frontend worker)

**Files:** `client/src/pages/BookingPage.tsx`, `client/src/components/SavedPassengerSelect.tsx` as necessary, `client/src/pages/PayYourShare.tsx`, corresponding component tests and AR/EN messages only where necessary.

**Interfaces:** Preserve `passportExpiry` through saved passenger -> form -> booking request and saved-passenger mutation. Preserve server-side validation authority. Distinguish query error from a successfully returned missing/cancelled payment invitation and allow retry.

- [ ] Prove expiry loss and transport-error misclassification with failing behavioral component tests.
- [ ] Correct mappings and recovery UI without weakening date or payment validation.
- [ ] Verify empty/expired/future document semantics and both languages; record input/output field links.
- [ ] Run component checks and real rendered UI journey when local runtime is available.
- [ ] Independently review all consumers and error paths.

## Task 4: deployment configuration and worker compatibility (operations worker)

**Files:** `docker-compose.prod.yml`; focused operational configuration test under `scripts/ci/`; audit notes.

**Interfaces:** Production-lite queue Redis must provide `maxmemory-policy noeviction`, as enforced in `server/worker.ts` and already configured in the full production manifest.

- [ ] Preserve evidence showing that documented lite settings cause the worker's startup guard to reject Redis.
- [ ] Add meaningful configuration regression against both production manifests and worker invariant.
- [ ] Align the lite policy without relaxing the worker guard.
- [ ] Verify config syntax and targeted tests; disclose whether Docker/runtime behavior was executed.
- [ ] Independently review backlog durability and adjacent deployment controls.

## Task 5: reconcile, review, verify and deliver (root plus independent reviewer)

- [ ] Integrate reviewed task commits into the audit branch, without rewriting unrelated work.
- [ ] Rerun required checks against the combined state; native DB, real UI, external integration and deployment remain separate labels.
- [ ] Produce all 21 requested register categories, index, reproducible commands, raw-result hashes and precise blockers.
- [ ] Prepare a reviewable pull request with source-bound evidence, remaining risks and no unsupported readiness claim.
- [ ] Re-read remote main and CI before final status; preserve a durable checkpoint if any gate is blocked.

## Preflight conflict scan and decisions

| Tasks         | Shared interface                         | Ruling                                                                                                                   |
| ------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1 / 2 / 3 / 4 | Locked toolchain and baseline            | Root owns installation and immutable baseline. Workers inspect first; separate worktrees own edits.                      |
| 2 / 3         | Authenticated request and booking fields | Separate files. Financial tenant changes retain response shapes; frontend uses existing date contract. Root checks both. |
| 2 / 4         | MySQL/Redis test infrastructure          | Root provisions resources; databases must be explicitly test-owned and isolated. No shared destructive hooks.            |
| 3 / 4         | Application runtime                      | Frontend tests use owned local endpoints. Configuration change does not alter app contracts.                             |
| 5 / all       | Final tree and evidence                  | Root integrates once, records tested tree, and runs combined verification. Worker claims require review.                 |
| 1             | Inventory vs verification                | Automated discovery is not manual review or behavioral acceptance. Every register records this distinction.              |
| 2             | Financial history                        | Reject outside-tenant operations without deleting or transferring historical records.                                    |
| 3             | Saved document privacy                   | Retain existing opt-in persistence and clear absent document fields when switching passengers.                           |
| 4             | Redis memory                             | Prefer queue integrity; leave existing noeviction runtime guard intact.                                                  |
| 5             | Release status                           | A PR or green unit suite does not establish production or carrier acceptance.                                            |

## Decisions and unresolved scope

- Ruling: use the user's explicit parallel-execution authorization with separate ownership rather than request another plan/worktree approval.
- Ruling: keep publication/deployment and business-owned multi-currency/carrier/device acceptance outside this corrective branch; record their existing acceptance requirements.
- The full audit is an evidence program. Unreviewed inventory rows remain unreviewed; counts and closure gates will use explicit denominators.
