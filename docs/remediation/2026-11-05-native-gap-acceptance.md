# Native gap acceptance follow-up — 5 November 2026

## Decision and source identity

This follow-up assesses all **38 original workbook findings**. The corrected
source's CI evidence now supports **34 verified findings: 33 functional
findings plus META-01**. The functional group consists of the 25 candidates
identified in the [previous acceptance follow-up](2026-11-05-gap-acceptance-followup.md)
and eight findings whose missing acceptance is supplied by this wave.
**Four findings remain partial:** OPS-06, UI-05, UI-07 and CAP-01. Their
original unmet conditions are preserved below.

| Assessment group                   | Findings | Meaning                                                                                                                                   |
| ---------------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Previous functional group verified |       25 | Twelve baseline findings and thirteen from the preceding follow-up, accepted with current-source CI; earlier evidence remains historical. |
| New functional group verified      |        8 | SRC-API-SHUTDOWN, BE-05, BE-07, BE-10, OPS-04, OPS-08, OPS-09 and OPS-11.                                                                 |
| Evidence metadata verified         |        1 | META-01: source-bound manifest, exclusion inventory and matching unit/native/browser evidence accepted.                                   |
| Original acceptance still partial  |        4 | OPS-06, UI-05, UI-07 and CAP-01 have the specific remaining conditions below.                                                             |
| Total                              |       38 | 34 verified findings on the accepted source and four partial findings; these are not test-case counts.                                    |

**Implementation revision: `7fe9fd9aab69d2f5ce35f39d06732b72e933a091`.**

The implementation revision is published on
`codex/native-gap-acceptance-20261105`, based on main
`d68881c2128267cee31c7ebbca4a4e3eaeff5b14`. It includes application changes,
acceptance tests, CI wiring and the coverage scope inventory tool. The
accepted run used PR head `ce45adf957fdcb4ef63671a1e04067efecd9164c` and
**actual synthetic merge `9929de4d1d246f748c467eecbf49ce6f452d60c5`, tree
`4e7b369dc2330a3e61c36cb91b62f4ab98a6c547`**. The execution manifest records
the tested commit and tree. Native job evidence and all three original
Playwright reports identify the same tested commit; the Git commit record
independently binds it to that tree.

The [closure ledger](coverage-closure-ledger.json) preserves the original 38
acceptance texts and priorities. Verified rows bind their accepted source and
run to the evidence above; the four partial rows retain their unmet original
criteria. This documentation update is written **after acceptance of that
source**. It changes no application code, tests or configuration. It does not
claim that a later documentation commit was already executed by these runs:
required checks on the resulting new PR head must still pass before merge.

## Evidence conventions and limits

Evidence strings beginning with `ais-evidence/` are relative to the retained
audit workspace, outside the repository checkout. They identify local
handoffs, reports, source hashes and cleanup receipts; they are **not hosted
CI links**. The original criteria and audit inputs remain in
`gap-audit-20261105/original-gap-workbook-rows.json` and
`gap-audit-20261105/backend-ops-original-acceptance-audit.json`. The previous
follow-up retains the earlier 25 candidates' detailed evidence and failed
attempts.

Native attempts used owned loopback MySQL 8.0.46 and Redis with Node 22.23.4.
Browser evidence uses Chromium, the built application and the owned auth
service. Several isolated database suites use `CREATE TABLE LIKE`: native
types, defaults and indexes are preserved, but foreign keys are not copied.
Migration and foreign-key acceptance therefore remain separate CI gates.
Controlled SQL barriers, explicit driver faults, local provider transport and
component HTTP fixtures are identified below rather than described as natural
outages or external provider acceptance.

Counts belong to their individual attempts. Shared suites, targeted reruns,
repeated scenarios and related unit cases overlap and must not be summed into
a new whole-repository result. Failed harness assertions remain retained and
classified; they are not relabeled as production defects.

## Accepted corrected-source CI

The following completed runs all identify actual checkout
`9929de4d1d246f748c467eecbf49ce6f452d60c5`. Artifact ZIP digests were matched
to GitHub's published digests before inspection; original reports are retained.

| Scope                       | Accepted result                                                                                                                                                      | Hosted evidence                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full Vitest and V8 coverage | **5,297/5,297 passed in 386 test files**, zero failed/pending/todo; both Vitest and evidence wrapper exited 0.                                                       | [CI/CD run 42035532674](https://github.com/kafaat/ais-aviation-system/actions/runs/42035532674), [Run Tests job](https://github.com/kafaat/ais-aviation-system/actions/runs/42035532674/job/127274550600) |
| Native service matrix       | **402/402 passed in 21 files on each of MySQL 8.0 and 9.7**, zero failed/pending/todo. These are repeated executions of the same matrix, not 804 distinct tests.     | [Production Gates run 42035533321](https://github.com/kafaat/ais-aviation-system/actions/runs/42035533321)                                                                                                |
| Chromium profiles           | **85 main + 3 isolated logout + 4 UI05 = 92 passed**, zero unexpected/flaky/skipped; all 92 passed on their first attempt.                                           | [E2E job 127278735764](https://github.com/kafaat/ais-aviation-system/actions/runs/42035532674/job/127278735764)                                                                                           |
| Component labs              | Four REST cases and Microcks contracts passed; four actual TCP/worker fault checks passed over the 171-check live baseline. That baseline overlaps Production Gates. | [Aviation Component Labs run 42035532794](https://github.com/kafaat/ais-aviation-system/actions/runs/42035532794)                                                                                         |

Both native matrix legs include the 49 ticket-revalidation cases, 109
available-report cases, seven wallet crossings, three worker-process cases,
three signed paid-webhook cases, 14 booking-confirmation cases and 16 API
process cases. Their separate integration report records PASS with 42 observations,
including the four controlled BSP import races; live acceptance has 171
passing checks with no skips. Backup/restore passed seven checks over 182
tables with matching before/after snapshot digests in each leg. These related
scopes are reported separately and are not added to the 5,297-test count.

The accepted coverage bundle preserves the strict **eleven-artifact manifest**
and a separate source inventory. All recorded hashes verified; the unchanged
parser recomputed the three partition files and reconciled their counters
with the global summary. No invalid or negative hit count remains. The
corrected retention conditional records `[4, 3]`, and the following seat
conditional records `[7, 0]`, matching the reproduced execution distribution.

The inventory records **805 eligible and measured files**, split into 495
server, 288 client and 22 shared files. Of 1,212 files matching the configured
includes, **407 are excluded with recorded reasons**; 613 other tracked files
fall outside those includes. Source commit/tree/config hashes are bound to
the inventory, and verification reports no missing or unexpected measured
files. META-01 is accepted on this evidence. The historical PR284 count of
394 exclusions below remains historical and is not substituted for 407.

Coverage artifact `13419615153` has ZIP SHA-256
`4327470e2f08001d16464247c17be3228c12f363965d6851d326d34b4ea1cae9`.
Browser artifact `13420600013` has ZIP SHA-256
`59bae6ec29b9f1b4df33487ea3461cfe8c1d9ac8b3541515055f280c1a07dd97`.
Each of the three Playwright JSON reports independently records
`metadata.ci.commitHash` and `metadata.gitCommit.hash` equal to the accepted
synthetic merge. UI05 also retains four financial-operation attachments; its
DCS-closed refusal attachment is explicitly not nonrefundable-fare acceptance.

The final review handoffs, including per-file hashes and provider/fault
boundaries, are:

- `ais-evidence/pr285-ci-artifacts/coverage/run-42035532674/handoff.json`
- `ais-evidence/pr285-ci-artifacts/native/run-42035533321/handoff.json`
- `ais-evidence/pr285-ci-artifacts/native/run-42035532794/handoff.json`
- `ais-evidence/pr285-ci-artifacts/browser/run-42035532674/handoff.json`

Coverage and browser container cleanup completed successfully. This acceptance
does not relabel the earlier failed coverage attempt below, certify external
providers or satisfy the four original conditions that remain partial.

## First integrated CI attempt and coverage correction

[PR285's first integrated attempt](https://github.com/kafaat/ais-aviation-system/actions/runs/42031524440)
tested synthetic merge `ba5d9b9bb663e9a296d4817b17cf506828836304`, tree
`8714c61bc456095af0c8be81f5fcab47b03cbdf5`, from head
`7339b201946109f09124912ca682206c76f62da9`. The execution manifest records a
clean source and **5,297/5,297 passing tests in 386 files**, with no pending or
todo cases. Vitest exited 0, but the evidence wrapper exited 1 with
`LCOV_INVALID_NUMBER`: the producer emitted `BRDA:908,108,1,-3` for
`server/services/order-servicing.service.ts`. The original Istanbul JSON also
contains `[7, -3]`; this was not an artifact edit or a failed application test.

That attempt remains **failed**. Its seven base artifacts are retained without
alteration; the three partition files, partition manifest and inventory
sidecar were not produced. Browser and application-build jobs did not run
because they depend on the failed test job. The coverage ZIP is artifact
`13416678525`, SHA-256
`3ad33fb98e977595eddfcce48f3517d5e989e7fc3c26cd394b6b743995004936`.

The separate [native gates](https://github.com/kafaat/ais-aviation-system/actions/runs/42031524583)
passed **402/402 in 21 files on each of MySQL 8.0 and 9.7**, including all 49
revalidation cases, 109 report cases, seven wallet crossings, three worker
cases, three signed webhook HTTP cases, 14 mail cases and 16 API process cases.
These results do not turn the failed coverage attempt into accepted evidence.

A minimal TypeScript reproduction using the installed Vitest 4.1.12/V8
reproduced the same `[7, -3]`. An independent raw `node:inspector` capture
identified the underlying ranges; all raw V8 counts were nonnegative. After a short-circuited `Boolean(revalidation) || await exchange()` expression,
V8's continuation range counted four awaits while the following conditional
body counted all seven invocations. The mapper subtracted those ranges for
the implicit else. An explicit `let` plus conditional assignment preserves
the four exchange calls, seven subsequent transfer calls, short-circuit
behavior and results while producing nonnegative counts.

The published correction applies that explicit control flow and makes evidence
rejection codes and the manifest path visible in the CI log. It keeps the
coverage provider, configuration and parser unchanged, and preserves the
original failed artifacts. The [LCOV format contract](https://github.com/linux-test-project/lcov/blob/master/docs/man/geninfo.rst)
rejects negative hit counts; accepting signed values or clamping the original
record would not establish correct measurement. Local reproduction evidence is
retained under `ais-evidence/coverage-negative-repro/`.

A targeted native run on the corrected source passed **49/49 revalidation
cases**, with no pending or todo cases. Its V8 report contained no invalid or
negative hits across 805 sources; the unchanged partition validator accepted
495 server, 288 client and 22 shared records and reconciled the summary.
The process still exited 1 because this selected-file run cannot meet the
unchanged full-project and per-file coverage floors. It is targeted behavior
and measurement evidence, not a passing full-coverage gate. Cleanup receipt
`ais-evidence/runtime/20261105T131738507452Z/receipt.json` records MySQL and Redis
exit 0. That targeted attempt did not close the full-coverage gate; the later
complete CI and inventory acceptance is recorded above.

## All 38 findings mapped

`B`, `F` and `N` retain the provenance of the 33 now-verified functional
findings: baseline audit, preceding follow-up and this native wave,
respectively. `M` is the verified META-01 record. **All B/F/N/M rows are
verified at the accepted source above; P rows remain partial.** Repository
paths identify acceptance entry points; historical attempts and controlled
boundaries remain distinguished in the accompanying evidence.

| ID               | Group | Acceptance mapping or remaining condition                                                                                                                     |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01            | B     | Refresh-token replay, durable session revocation and transaction refusal: `auth-session-mysql.test.ts`, `auth-session-regression.test.ts`.                    |
| BE-02            | B     | MFA secret migration and current session evidence: `auth-session-mysql.test.ts`, `session-mfa-boundary.test.ts`.                                              |
| UI-C01           | F     | Unpaid share cancellation, no refund item and terminal provider return: `PayYourShare.test.tsx`, `e2e/payer-terminal-acceptance.spec.ts`.                     |
| SRC-API-SHUTDOWN | N     | Actual signals, unused/existing pool, close faults and deadline; final observation drain. Details below.                                                      |
| META-01          | M     | Final source/run/provider/config manifest, strict artifact hashes and the 805-measured/407-excluded inventory verified with matching native/browser evidence. |
| BE-03            | B     | Internal-funding refunds and conservation: `internal-refund-boundary.test.ts`, `financial-authority-mysql.test.ts`.                                           |
| BE-04            | B     | Agency credit authority, limits, native funding and browser journey: `financial-authority-mysql.test.ts`, `e2e/agency-credit.spec.ts`.                        |
| BE-05            | N     | Native revalidation refusal, late evidence, timezone/DST boundaries and invariant replay. Details below.                                                      |
| BE-06            | F     | Fare applicability, arithmetic, malformed rules and full UTC date-only endpoints: `fare-rules-engine.test.ts`, `fare-rules-acceptance-mysql.test.ts`.         |
| BE-07            | N     | Signed paid HTTP races/redelivery and current-data confirmation with repeatable local PDF bytes. Details below.                                               |
| BE-08            | B     | Actual auth-client/provider boundary and native session lifecycle: `auth-service-http.test.ts`, `auth-session-mysql.test.ts`.                                 |
| BE-09            | B     | Booking-economics role and tenant entry checks: `seat-economics-tenant-boundary.test.ts`.                                                                     |
| BE-10            | N     | Wallet payment crossing refund/top-up, native rollback and replay; existing payment/split router acceptance retained. Details below.                          |
| OPS-01           | B     | Report router contracts, role/tenant scope and saved-run lifecycle: router, native schedules and `e2e/standard-reports.spec.ts`.                              |
| OPS-02           | B     | Scheduled-run fencing, uncertain delivery, owner changes and deletion: `standard-report-schedules-mysql.test.ts`.                                             |
| OPS-03           | F     | APIS document validation/update races, mixed-sector draft and explicit submission refusal: `apis-seats-acceptance-mysql.test.ts`.                             |
| OPS-04           | N     | Concurrent refund/manifest snapshot and actual manifest/closeout route scope. Details below.                                                                  |
| OPS-05           | F     | Repeat seat initialization, signed document changes, ownership and tenant binding: `apis-seats-acceptance-mysql.test.ts`.                                     |
| OPS-06           | P     | Native remap/downgrade acceptance added; blanket operational-block refusal conflicts with the preserved compatible-remap policy.                              |
| OPS-07           | B     | Capacity, holds, promises and native concurrency/rollback: `operations-inventory-mysql.test.ts` and acceptance scripts.                                       |
| OPS-08           | N     | Concurrent immutable HOT/bank imports and local-evidence reconciliation. Details below.                                                                       |
| OPS-09           | N     | Actual worker minute tick, renewal, fencing, shutdown and persisted report receipt. Details below.                                                            |
| OPS-11           | N     | Actual API liveness/readiness, dependency recovery, raw body, transport limits and quotas. Details below.                                                     |
| UI-01            | F     | Logout/private-state cleanup and safe return paths: hook tests plus isolated logout/recovery browser phases.                                                  |
| UI-02            | F     | Retry identity, roster reindexing and wallet/split invoice handoff: roster tests and `e2e/booking-dialog-acceptance.spec.ts`.                                 |
| UI-03            | B     | Multi-city search and transition: `MultiCityResults.test.tsx`, `e2e/multi-city-fare.spec.ts`.                                                                 |
| UI-04            | F     | Payer state/return matrix, failed checkout retry and terminal polling: component and native payer browser tests.                                              |
| UI-05            | P     | Paid servicing and cash/split cancellation receipts now exercised; original nonrefundable-fare cancellation remains missing.                                  |
| UI-06            | F     | Station, equipment, loading and weight interactions: the 66-case actual-component UI group. No dispatch-approval criterion is added.                          |
| UI-07            | P     | Kiosk privacy/version/browser behavior exists; actual target-printer barcode, margins and physical output remain unaccepted.                                  |
| UI-08            | B     | Legacy CSV/Excel/PDF content and failure/context handling: `ExportReportButton.test.tsx`, `e2e/vrs-report-exports.spec.ts`.                                   |
| UI-09            | F     | Refund rows/statistics, pagination, failed reads and stopped polling: `RefundsDashboardInteractions.test.tsx`.                                                |
| UI-10            | F     | Built entry/reload, lazy-chunk recovery, auth expiry and embedded isolation: boundary tests and recovery browser suite.                                       |
| UI-11            | F     | MFA setup/recovery, errors, focus and clipboard handling: `MFASetup.test.tsx`, `MFAVerify.test.tsx`.                                                          |
| OPS-10           | B     | Scoped, idempotent flight/email delivery and failure replay: native flight delivery and email-worker suites.                                                  |
| UI-12            | F     | Report-input failures, current-context responses, stable generation identity and download: report UI and browser tests.                                       |
| CAP-01           | P     | All 36 available-report software matrices pass in accepted native CI; 35 partial and 28 blocked definitions retain their source/acceptance conditions.        |
| UI-M01           | F     | Same-run actual ErrorBoundary statement/function/branch evidence, with final source/provider/config identity in the accepted manifest.                        |

The B/F assignments retain the previous audit's criteria. For example, UI-03
and UI-08 retain historical component/browser evidence and are covered by the
accepted integrated tests and browser suites; this documentation edit did not
execute another test run. UI-M01's observed counter comparison
does not assert that a coverage-provider or source-map implementation defect
has been repaired.

## Evidence behind the eight newly verified functional findings

### SRC-API-SHUTDOWN — actual process shutdown and final observations

`server/__tests__/api-process-mysql.test.ts` launches the actual API entry.
It observes SIGTERM and SIGINT, repeated-signal handling, an existing pool
closing once, an unused API stopping without creating a pool, and exit/log
behavior for an injected `mysql2` end rejection or hang under the unchanged
10-second deadline. The real process has native connections; the end faults
are explicit child-only driver injections, not claims of a natural MySQL
failure.

The reproduced production defect was that final observation flushing created
a database pool during shutdown even when the API had never used it. The
no-work guard now avoids that creation. A subsequent review found that stop
could join an active flush and miss responses captured after that flush took
its bucket. Shutdown now awaits the active flush and then drains remaining
work, preserving retry identity and propagating a final-write failure.

| Attempt                      | Observed result                                                                 | Local evidence                                             |
| ---------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Unused-pool regression       | 1 selected failure; 15 deselected.                                              | `ais-evidence/api-process-followup/red-uninitialized.json` |
| API process suite            | 16 passed, 0 failed/skipped; shared with OPS-11.                                | `ais-evidence/api-process-followup/green-attempt-1.json`   |
| Observation drain regression | 2 passed controls and 2 failures.                                               | `ais-evidence/observation-drain-followup/red.json`         |
| Observation drain correction | 4 passed, 0 failed/skipped; controlled persistence boundary, no new native run. | `ais-evidence/observation-drain-followup/green.json`       |

Handoffs: `ais-evidence/api-process-followup/handoff.json` and
`ais-evidence/observation-drain-followup/handoff.json`. The native green
cleanup receipt is
`ais-evidence/runtime/20261105T111054364997Z/receipt.json`, with MySQL and Redis
exit 0. The four observation tests are additional unit evidence, not another
execution of the 16-process-case suite.

### BE-05 — native ticket revalidation refusal and replay

The new `ticket-revalidation-acceptance-mysql.test.ts` adds 49 scenarios:
34 preview/commit refusal cases, five changes after preview, seven temporal
refusals and three valid timezone/DST schedules. They cover owner/tenant,
registered bags, check-in/boarding, external funding evidence, incomplete
fare components, completed/flown sectors, changed fare terms/digests and
offer/coupon/issuance identities. Controlled row changes represent late or
corrupt evidence; they are not upstream DCS or external-provider workflows.

Successful cases preserve ticket/coupon/fare/funding identities and amounts,
move physical and RBD inventory once, and replay the same receipt without
changing database rows. Refusals compare complete row snapshots of all 182
cloned tables. The existing browser test remains the authentication/UI
evidence. An explicit loopback transport fault drops a successful response
after commit and verifies durable status and safe replay. No production
revalidation source change was needed.

The first 49-case attempt had **47 passed and 2 failed assertions**. Both
registered-bag requests were correctly refused with unchanged snapshots;
the expected error wording was wrong. After correcting those test-only
expectations, the targeted run passed **2 cases with 47 deselected**. There
was no fresh 49/49 run in that local handoff. The later accepted CI now records
**49/49 on the final tested source**, in full coverage and in each native
MySQL matrix leg; those executions supersede the local acceptance limitation
without changing the earlier attempt's result.

Evidence: `ais-evidence/ticket-revalidation-followup/handoff.json`,
`ais-evidence/ticket-revalidation-followup/attempt-1.json` and
`ais-evidence/ticket-revalidation-followup/targeted-2.json`. Cleanup receipts
`ais-evidence/runtime/20261105T114149463809Z/receipt.json` and
`ais-evidence/runtime/20261105T114315844477Z/receipt.json` record MySQL/Redis
exit 0. External airline/GDS reissue acceptance is outside this local proof.

### BE-07 — paid webhooks and confirmation delivery

`stripe-paid-webhook-mysql.test.ts` sends signed paid events through the
actual child API, raw-body handler and native settlement. It covers
concurrent insertion, provider redelivery after a database-route outage and
signature refusal. A transient losing request may return retryable 500;
redelivery converges to one settlement, ledger effect and confirmation event.

`booking-confirmation-mysql.test.ts` executes the configured publisher,
durable delivery claims, native ticket/coupon generation and actual
QRCode/PDFKit rendering. Only provider HTTP, deliberate rendering failure
and post-render scheduling are controlled. It exposed incomplete passenger
rosters and changes occurring during document generation. The production
sender now validates the roster and rereads booking, recipient, passenger
identity and **all itinerary sectors** before sending.

A second regression showed that an accepted provider request with a lost
response could retry with different PDF bytes. The document reads its first
persisted local coupon issue time, retains it across replay/exchange history,
and uses it for PDF creation/modification metadata. Unchanged semantic inputs
produce identical bytes across a clock change; a changed passenger name
deliberately changes the bytes. This is local issue history, not an external
carrier issuance timestamp.

| Attempt                            | Observed result                                                                                  | Local evidence                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Initial native baseline            | 9 passed and 6 failed: all 3 paid HTTP cases passed; mail had 6 controls passing and 6 failures. | `ais-evidence/stripe-delivery/native-baseline.json`                                      |
| Initial mail correction            | 72 passed: 12 native mail cases plus 60 related unit cases.                                      | `ais-evidence/stripe-delivery/mail-and-related-green.json`                               |
| Later regressions                  | 2 selected failures; 12 deselected: lost provider acceptance and changed second sector.          | `ais-evidence/stripe-delivery/additional-regressions-red.json`                           |
| Final mail/document attempt        | 26 passed: 14 native mail cases plus 12 coupon unit cases; 0 failed/skipped.                     | `ais-evidence/stripe-delivery/mail14-and-documents-green.json`                           |
| PDF renderer regression/correction | Red: 1 passed, 1 failed. Green: 2 passed.                                                        | `ais-evidence/pdf-retry-followup/red.json`, `ais-evidence/pdf-retry-followup/green.json` |
| Renderer plus coupon units         | 14 passed: the 2 renderer and 12 coupon cases; overlap with the rows above.                      | `ais-evidence/pdf-retry-followup/document-units.json`                                    |

The 26-case command also contained a selector named
`eticket-pdf-determinism.test.ts`, which matched no file. It contributes no
tests. The actual renderer evidence is the separate
`eticket-renderer-retry.test.ts` run. The three earlier HTTP successes were
not rerun locally solely to consolidate counts after mail-only changes. The
accepted integrated CI subsequently executed all three HTTP and all 14 mail
cases successfully on the same source.

Handoffs: `ais-evidence/stripe-delivery/handoff.json` and
`ais-evidence/pdf-retry-followup/handoff.json`. The latest native cleanup
receipt, `ais-evidence/runtime/20261105T122251943894Z/receipt.json`, records
MySQL/Redis exit 0. Local provider acceptance does not establish Resend or
recipient delivery. The final reread is not a distributed transaction with
the provider, and repeatable bytes do not freeze changed semantic data or
extend the provider's idempotency retention.

### BE-10 — wallet crossings with top-up and refund

`wallet-crossing-acceptance-mysql.test.ts` adds the combined native races that
the earlier two-spends and separate-refunds tests did not establish. Actual
InnoDB waits coordinate payment with top-up/refund, while snapshots and
injected write failures verify balance, invoice, funding and ledger
conservation, rollback and replay.

The initial run passed **6 cases and failed 1**. A focused run reproduced
the MySQL deadlock in **1 selected case with 6 deselected**. The production
correction locks the owner before wallet/inventory, matching internal-refund
lock order. Green then passed **90 cases: 7 native plus 83 related units**,
with no failures/skips. These are not 90 newly added native tests.

Evidence: `ais-evidence/wallet/handoff.json`,
`ais-evidence/wallet/native-baseline.json`,
`ais-evidence/wallet/deadlock-red-verified.json` and
`ais-evidence/wallet/native-and-related-green.json`. Cleanup is recorded in
`ais-evidence/runtime/20261105T113523520279Z/receipt.json`, MySQL/Redis exit 0.
Top-up starts at the verified-provider settlement boundary; this suite does
not prove external collection or signature verification. Earlier payment
router and split lifecycle/refund acceptance remains part of BE-10.

### OPS-04 — consistent manifest while a refund commits

The extension to `scripts/acceptance/dcs-counter-lifecycle.ts` completes the
manifest's first actual nonlocking SQL read before a test-only scheduling
gate pauses that same transaction connection. A real refund commits while
the read is paused; releasing the gate resumes the original transaction.
The passenger, baggage and capacity snapshot stays consistent. A subsequent
fresh read detects the now-unreconciled boarded/refunded state. The actual
manifest route succeeds for its authorized scope, and the actual closeout
route refuses a foreign tenant.

**38 DCS checks passed** in
`ais-evidence/dcs-bsp/attempt-20261105T115234715053Z/acceptance.json`, including
the OPS-06 additions below. That combined attempt later stopped at an
unrelated BSP harness check. DCS source stayed identical and was not rerun.
Earlier DCS attempts stopped after 13 and 32 passing checks because of a
synchronous-rejection assertion and an incorrect expected domain-error
type. Those are retained harness corrections, not production defects.

Evidence: `ais-evidence/dcs-bsp/handoff.json`. No production DCS source
change was required. This proves deliberately scheduled native concurrency,
not randomized load testing or physical station acceptance.

### OPS-08 — native concurrent HOT and bank imports

`scripts/acceptance/bsp-local-evidence.ts` adds **four races**: HOT and bank,
each with identical-content and changed-content competitors. An owned
`AFTER INSERT` trigger gates the first insert; actual InnoDB waits identify
the `bsp_evidence_identity` unique index, exact fresh reference and distinct
transactions. Identical requests return the same receipt. Changed content
conflicts, preserving the first immutable row, author, content and digest.
Replay and RET/HOT/bank reconciliation retain `basis=local_evidence_only`;
late ledger postings are detected.

The focused final BSP attempt passed **one acceptance group containing all
four races**:
`ais-evidence/dcs-bsp/attempt-20261105T115740480782Z/acceptance.json`.
It is separate from the 38 DCS checks. Earlier BSP attempts corrected
instrumentation correlation: thread attribution and `INNODB_TRX` visibility
were unreliable for the gated owner despite an actual unique-index wait.
The handoff retains the diagnostic attempts and final reference/transaction
correlation. No BSP production change was needed.

Handoff: `ais-evidence/dcs-bsp/handoff.json`. The final cleanup receipt is
`ais-evidence/runtime/20261105T115737610849Z/receipt.json`, MySQL/Redis exit 0,
owned schema dropped and no remaining triggers. External BSP settlement and
regulatory acceptance are not claimed and are not added as requirements of
this explicitly local-evidence finding.

### OPS-09 — real worker scheduling, fencing and drain

`worker-process-mysql.test.ts` runs the actual `server/worker.ts`, native
minute ticks, MySQL and owned Redis. Two processes compete for the same tick;
SQL observers record one claim. A template row lock keeps the callback active
past 30 seconds while the actual lease renews. SIGTERM removes readiness and
waits for the callback's durable report/scheduler receipts before pool close.
A missing privacy SQL source does not stop independent report progress.
Restart/replay does not duplicate publication, and replacing the lease token
prevents the displaced worker from recording success or erasing the owner.

The production fix allows an explicit `AIS_WORKER_READY_PATH` for separately
supervised same-host workers while retaining `/tmp/ais-worker-ready` as the
default. The first readiness attempt had a harness mismatch (`msg` versus
the logger's actual `message`) and is excluded as regression proof. The
corrected regression had **1 selected failure and 2 deselected**. Green
passed **3 native cases** with no failures/skips; a separate compatibility
run passed **37 unit cases**.

Evidence: `ais-evidence/worker-process/handoff.json`,
`ais-evidence/worker-process/readiness-red-verified.json`,
`ais-evidence/worker-process/native-green.json` and
`ais-evidence/worker-process/compatibility-unit.json`. Cleanup receipt:
`ais-evidence/runtime/20261105T111552975826Z/receipt.json`, MySQL/Redis exit 0.
No worker imports, cron callbacks, SQL results or timers are substituted.
Faults are explicit owned locks/table/token/cursor changes. The report is a
dashboard CSV receipt, not an external email-provider delivery receipt.

### OPS-11 — API readiness and middleware from the real entry

The same **16-case API process suite** used for SRC-API-SHUTDOWN now proves
liveness while the child's database route is partitioned, readiness recovery
in the same process, protected detailed health, controlled provider
unavailability/misconfiguration, and Redis partition/recovery under the
documented in-memory fallback policy. It also tests raw webhook bytes before
JSON parsing, real JSON/raw-body limits, REST/tRPC and webhook quotas, and
recovery after unchanged 60-second windows.

Evidence: `ais-evidence/api-process-followup/handoff.json` and
`ais-evidence/api-process-followup/green-attempt-1.json`. **Do not count these
16 cases twice** because they support two findings. Native MySQL remains
healthy while a child-only TCP route is partitioned; provider readiness is
an owned local HTTP boundary. This is actual API-process acceptance, not
external provider approval or a built-client test.

## Four findings that remain partial

### OPS-06 — native checks complete, policy wording unresolved

The shared 38-check DCS group now covers ten remap refusal scenarios, full
state preservation, compatible remap ownership/capacity, one event on replay,
wrong/stale/foreign quote rejection and `expectedRefund` mismatch. A real
downgrade event trigger failure rolls back mutations, refund plan, outbox and
idempotency state; clean retry and replay produce one effect. The local
refund plan does not itself claim provider settlement.

The remaining condition is specific: the original workbook says to refuse
remap for an operational block, while the existing implementation permits a
compatible remap that preserves that block. Incompatible blocks are refused.
This wave preserves compatible behavior and **does not claim literal blanket
compliance**. The original requirement and intended policy need an explicit
reconciliation before this row can close. Evidence:
`ais-evidence/dcs-bsp/handoff.json`.

### UI-05 — paid/cash/split receipts added; nonrefundable fare remains

The UI now retains the regular refund reference, amount and returned provider
status until explicit close. MyBookings keeps the selected dialog mounted
while refreshing the booking. Split cancellation shows the plan reference
and each payer's refund reference from the existing protected response.

Component regression evidence had **3 failures, 2 selected passes and 15
filtered cases**. The corrected related React group passed **29/29**.
The first native browser run passed **3 scenarios and failed 1**. Paid
modification, cash cancellation and split cancellation passed through the
real browser/API/MySQL/Stripe SDK. Funding and paid modification use signed
paid webhooks from the local provider; refunds use its SDK responses followed
by application reconciliation. The fourth fixture moved scheduled times
without recording final DCS closure.
After correcting that fixture, **1 targeted scenario passed**; the three
previous successes were reused in that local handoff. The later accepted
CI's dedicated `playwright.ui05.config.ts` profile now supplies a fresh
**4/4 successful suite**, with no skips, retries or flaky outcomes and with
the same source metadata as the other browser profiles. This adds final-source
evidence for those four scenarios, while the original nonrefundable-fare
criterion below remains incomplete.

Evidence: `ais-evidence/ui05-financial/handoff.json`,
`ais-evidence/ui05-financial/receipt-component-final.json`, and browser
receipts under `ais-evidence/runtime/20261105T121349032210Z/` and
`ais-evidence/runtime/20261105T121546954748Z/`. Both runs record MySQL/Redis
exit 0 and completed API shutdown; the owned auth process was intentionally
terminated with SIGTERM and recorded exit -15.

**Remaining:** original criterion 5 requires nonrefundable-fare cancellation
with its fees and operation receipt. DCS-closed refusal does not establish
that behavior. This change does not invent a zero-value cancellation or a
new financial policy. Native provider refunds in this profile succeed;
pending/failure UI states use component HTTP fixtures. The local provider
does not establish Stripe sandbox/card-network/bank settlement or external
ticket reissue.

### UI-07 — physical printing remains unaccepted

Existing kiosk component and browser evidence covers document version,
privacy timeout, abandoned requests and print failure/unknown state. Browser
printing is substituted. The original requirement separately demands actual
target-printer output, barcode readability and margins. No printer receipt
or physical acceptance was supplied by this wave. The accepted UI/browser
CI covers the software paths and does not satisfy the physical-output
condition alone.

### CAP-01 — available-report matrix complete, catalog unchanged

The catalog remains **99 definitions: 36 available, 35 partial, 28 blocked**.
No definition is promoted. The new
`server/__tests__/standard-reports-available-mysql.test.ts` and independent
fixture cover all 36 available IDs:

| Family     | Available IDs                                                                                               | Count |
| ---------- | ----------------------------------------------------------------------------------------------------------- | ----: |
| Operations | 2, 3, 5, 14, 15, 16, 17, 18, 19, 20, 22, 23, 25, 26, 27, 44, 45, 48, 49, 53, 54, 57, 64, 72, 73, 84, 92, 93 |    28 |
| Finance    | 6, 55                                                                                                       |     2 |
| Commercial | 4, 29, 30, 31, 42, 58                                                                                       |     6 |

The first native run passed **109/109**, with no failures, skips or retries:
108 report checks (three per ID) plus one matrix-identity check. Each ID has
known-data row counts and independent expected identity/quantity/money/status
columns, actual router execution, CSV export parsed independently, and tenant
checks. The API boundary is real tRPC `createCaller` with input/output and
authorization-context checks, not HTTP transport. SQL runs on native MySQL;
only the database binding and clock are controlled. Golden assertions cover
selected columns, not every possible column of every report.

Twenty-two reports test both UTC period endpoints and adjacent excluded
seconds against actual TIMESTAMP rows. The 14 definitions without a period
filter (2, 3, 17, 18, 19, 20, 22, 23, 25, 53, 6, 4, 42, 58) reject that input
through both run and export. Currency data is deliberately shared across
valid authenticated tenant scopes; forged context still fails. Existing
shared PDF/XLSX evidence is retained, while this per-ID matrix uses CSV.

Evidence: `ais-evidence/cap/handoff.json`,
`ais-evidence/cap/baseline-matrix.json`,
`ais-evidence/cap/executed-matrix.json` and
`ais-evidence/cap/attempt-20261105T121853532842Z/vitest.json`. Cleanup receipt
`ais-evidence/runtime/20261105T121851162804Z/receipt.json` records MySQL/Redis
exit 0; both owned schemas were dropped and their absence checked by SQL.

**Remaining:** the 35 partial definitions need their named missing
sources/dimensions/history and independent acceptance; the 28 blocked
definitions need the authoritative source or external acceptance receipt,
then implementation and tests. The
[63-entry source/acceptance ledger](20261104-report-source-acceptance-ledger.md)
continues to describe those conditions. The new matrix leaves those source and acceptance conditions, and the explicit refusal behavior, unchanged.

## Final-source wiring and META-01 provenance

The integration review maps these six new native files to the unrestricted
server test glob used by full coverage and to the MySQL 8.0/9.7 service gate:

- `server/__tests__/standard-reports-available-mysql.test.ts`
- `server/__tests__/wallet-crossing-acceptance-mysql.test.ts`
- `server/__tests__/ticket-revalidation-acceptance-mysql.test.ts`
- `server/__tests__/stripe-paid-webhook-mysql.test.ts`
- `server/__tests__/booking-confirmation-mysql.test.ts`
- `server/__tests__/worker-process-mysql.test.ts`

The existing API process file supplies the shared SRC/OPS-11 cases. The DCS
and BSP extensions remain reached through `verify-transaction-boundaries.ts`
and `acceptance/integration-remediation.ts`. The UI05 spec is outside the
default E2E directory and requires its own
`playwright.ui05.config.ts` invocation, a fresh built app, a separate Redis
phase and preserved report directory. The accepted run executed that dedicated
profile and preserved its results separately from main and isolated logout.

A related recovery-browser synchronization correction is preserved in
`ais-evidence/auth-recovery-flake/handoff.json`: the actual protected query
is mounted before cookie expiry, then refetched through the installed focus
listener. One scenario passed three repetitions with retries disabled. That
is not a rerun of the full 17-case recovery suite, and no production auth
behavior or timeout was changed.

The published implementation adds `scripts/ci/coverage-scope-inventory.mjs`.
CI runs its `write` command after the coverage wrapper succeeds and before the
existing artifact upload. It binds each source file and exclusion reason to
the actual commit/tree/config and reconciles eligible names with measured
LCOV partitions. The existing strict eleven-artifact manifest is preserved;
the inventory is a separate sidecar in the same uploaded directory. Unknown
exclusion reasons, dynamic scope or mismatched source/measurement are refused.

The generator was also checked against the historical PR284 evidence at
`ed84e3639271e1c5caf4ebb513817293d0b61745`: 1,199 files matched the configured
includes, 394 were excluded with reasons, and all 805 eligible names matched
the measured partitions. This is a later local derivation from historical CI,
not a new run or an original artifact of that historical execution.

The corrected-source runs above now provide the integrated gates, source-bound
sidecar and matching unit/native/browser evidence. Acceptance is bound to
`9929de4d1d246f748c467eecbf49ce6f452d60c5` and tree
`4e7b369dc2330a3e61c36cb91b62f4ab98a6c547`, not an untested future commit.
This subsequent documentation/ledger recording must retain the four partial
findings and the unchanged 99/36/35/28 report classification. It changes no
code, tests or configuration; the new PR head still requires its checks before
merge, and release PR283 follows the accepted fix wave and its refreshed checks.
