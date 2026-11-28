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
- [x] Install the exact locked package manager/dependencies without changing the lock.
- [x] Record baseline build, types, regression and runtime outcomes; preserve original failures.
- [x] Extract file, module, route, field, configuration and test inventories with stable identifiers.
- [x] Build requirements, traceability, compatibility, journey, defect and readiness registers with explicit review status.

## Task 2: tenant isolation in financial reads and writes (security worker)

**Files:** `server/routers/payment-history.ts`, `server/services/payment-history.service.ts`, `server/routers/vouchers.ts`, `server/services/voucher.service.ts`; meaningful focused/native tests discovered beside existing tests.

**Interfaces:** Consume the authenticated user's current tenant through the existing tRPC context and invoice/booking authority. Preserve the public response contract and intentional legacy-null policy; return only authorized rows and reject unauthorized writes before replay or settlement.

- [x] Reproduce former-tenant payment-history exposure and voucher/credit write access using distinct tenant fixtures.
- [x] Add failing regression tests covering positive access, moved-user rejection, pagination/statistics consistency and zero-write negative cases.
- [x] Apply the smallest tenant predicate/parameter propagation correction across affected callers.
- [x] Run focused and actual MySQL tests, record baseline red and corrected green results.
- [x] Independently review source, compatibility, legacy behavior and financial side effects.

## Task 3: passenger field integrity and payer recovery (frontend worker)

**Files:** `client/src/pages/BookingPage.tsx`, `client/src/components/SavedPassengerSelect.tsx` as necessary, `client/src/pages/PayYourShare.tsx`, corresponding component tests and AR/EN messages only where necessary.

**Interfaces:** Preserve `passportExpiry` through saved passenger -> form -> booking request and saved-passenger mutation. Preserve server-side validation authority. Distinguish query error from a successfully returned missing/cancelled payment invitation and allow retry.

- [x] Prove expiry loss and transport-error misclassification with failing behavioral component tests.
- [x] Correct mappings and recovery UI without weakening date or payment validation.
- [x] Verify empty/expired/future document semantics and both languages; record input/output field links.
- [x] Run component checks and real rendered UI journey when local runtime is available.
- [x] Independently review all consumers and error paths.

## Task 4: deployment configuration and worker compatibility (operations worker)

**Files:** `docker-compose.prod.yml`; focused operational configuration test under `scripts/ci/`; audit notes.

**Interfaces:** Production-lite queue Redis must provide `maxmemory-policy noeviction`, as enforced in `server/worker.ts` and already configured in the full production manifest.

- [x] Preserve evidence showing that documented lite settings cause the worker's startup guard to reject Redis.
- [x] Add meaningful configuration regression against both production manifests and worker invariant.
- [x] Align the lite policy without relaxing the worker guard.
- [x] Verify config syntax and targeted tests; disclose whether Docker/runtime behavior was executed.
- [x] Independently review backlog durability and adjacent deployment controls.

## Task 5: reconcile, review, verify and deliver (root plus independent reviewer)

- [x] Integrate reviewed task commits into the audit branch, without rewriting unrelated work.
- [ ] Rerun required checks against the combined state; native DB, real UI, external integration and deployment remain separate labels.
- [ ] Produce all 21 requested register categories, index, reproducible commands, raw-result hashes and precise blockers.
- [x] Prepare a reviewable pull request with source-bound evidence, remaining risks and no unsupported readiness claim.
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

## Execution checkpoint and expanded scope

The initial task scopes expanded after source tracing found the same purchaser
boundary in creation, replay, split delivery, ticket and boarding issuance,
corporate credit, NDC, rebooking, paid servicing, seats, check-in, queues, holds,
groups, compensation, loyalty, passenger services, baggage and itinerary reads.
Each worker used a separate worktree. An independent review produced five
additional correction requests; their fixes were reviewed at local commit
`d1af7867d944ba4afcfa5f9587d3ab425a421bf9`.

The public draft is [PR #407](https://github.com/kafaat/ais-aviation-system/pull/407).
It preserves the individual changes. GitHub App publication recreates each
commit with the exact same tree; every remote commit records its original local
commit and verified tree. Commit identifiers therefore differ, while the
recorded content equality is checked before the branch advances.

### Completed verification at the recorded checkpoint

- At local `d1af786`, nine static gates passed, including all three TypeScript
  projects, zero-warning ESLint and catalog/contract consistency checks. The
  build passed. The client regression passed 1,062 cases across 90 files.
- The same source passed 94 Chromium cases with actual local MySQL 8.0.46,
  Redis 8.0.2 and the FastAPI identity service, plus a separate three-case logout
  run. Browser accounts were registered through the test setup, staff roles
  were assigned by SQL, and UI login preceded session reuse. These setup
  shortcuts do not prove registration or administrative role-assignment UI.
- The saved-passport journey used visible fields and actual booking submission,
  then compared the persisted expiry and pending invoice in MySQL. Broader
  provider scenarios used explicitly synthetic fixtures.
- Migration replay and correct/incorrect Node-to-FastAPI service credentials
  passed. Production-mode HTTP probes passed with a loopback balance-response
  fixture. This is not live payment-provider acceptance.
- Independent native worker batches are retained separately: security 165
  cases followed by 63 overlapping final wrapper cases; servicing 10 and 11
  cases; passenger services 20 native plus 59 component cases in its combined
  batch. These counts must not be summed as unique coverage.

### Followup verification in progress

- The full server regression runs on frozen local `d991ce7`; its outcome must
  be read from the completed receipt, not inferred from progress logs.
- CI run `46085278511`, job `140793326048`, failed because locked Prettier
  changed only `server/__tests__/booking-checkout-boundary.test.ts`. Local
  `2055ba5` / published `91dc2a5` repairs formatting without changing assertions.
  The next CI run is a separate result; skipped downstream jobs in the original
  run are not passes.
- Explicit-route AI search, assistant-history masking, and the UI-to-booking
  passenger/cabin handoff receive focused regression and integrated browser
  verification before stronger claims. No live-model quality claim is made.
- Final inventory regeneration, final source/CI reconciliation, the searchable
  deliverable index, and final evidence manifest remain root-owned closure
  tasks. Earlier worker receipts retain their original commits and limitations.

### Remaining business and environment boundaries

- Chat concurrency quota, ordering and partial-failure policy are unresolved.
  A controlled provider probe reproduced 102 transcript rows with stored count
  100 after two calls starting at count 98, and a lost context update. This is
  an open defect, not a closed audit observation.
- The migrated native schema has no foreign keys or CHECK constraints. That
  catalog fact does not establish existing corruption. Production data and
  deletion/history semantics are needed before targeted constraints.
- Broad manual semantic review of every discovered field/API, all browsers and
  physical devices, live carriers/payment/mail providers, deployed identities,
  production load, operator RPO/RTO and disaster recovery remain separate
  acceptance boundaries. No blanket readiness percentage is assigned.
