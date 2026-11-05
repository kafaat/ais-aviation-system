# Gap acceptance follow-up — 5 November 2026

## Decision and source identity

This follow-up adds local acceptance evidence and fixes defects reproduced by
that evidence. It does **not** mark any of the 38 original findings `verified`.
The [closure ledger](coverage-closure-ledger.json) retains 12 findings that were
eligible in the previous audit as `needs_current_sha_verification`; the other
26 remain `partial`. Thirteen of those partial findings have evidence covering
their original acceptance and are recorded as `candidate_pending_ci`, subject
to final-source CI. UI-05 has passing local UI evidence but unresolved original
acceptance, so it is explicitly excluded from that candidate count. BE-06 now
includes the corrected full-day period-end boundary and its targeted native
and unit acceptance.

The implementation and acceptance tests are committed at
[`d399331f1d21a80e5ab6cac3d79e8bc25064b883`](https://github.com/kafaat/ais-aviation-system/commit/d399331f1d21a80e5ab6cac3d79e8bc25064b883),
with code tree `a0f4dbdf9af0804c5aef0ceeff464ed59afe80fd`, based on
`146a88db5b0cd31d3309274c5cdb516ec917b838`. `source_revision` identifies that
committed code. This documentation-only follow-up does not change its source.
Local receipts and file hashes bind each attempt to its files; all 38
`accepted_sha` and `acceptance_run` fields remain `null` until the original
acceptance and required CI are confirmed on the actual tested source. A PR
checkout may use a synthetic merge commit, which must be recorded as such.

The acceptance criteria come from the original 38-row workbook,
`AIS_Test_Coverage_Gap_Analysis_AR_2026-11-04`. They are copied verbatim into
`findings[].original_acceptance` in the ledger. The earlier source audit was
bound to `0eb7bc528987b08b659b5663386b093b64c45dc0`, including the saved
[CI run 41943770807](https://github.com/kafaat/ais-aviation-system/actions/runs/41943770807).
That previous run is historical evidence, not acceptance of these changes.

| Formal ledger status             | Findings | Meaning                                                                                             |
| -------------------------------- | -------: | --------------------------------------------------------------------------------------------------- |
| `needs_current_sha_verification` |       12 | Previously eligible under the original criteria; require current-source CI.                         |
| `partial`                        |       26 | Acceptance is incomplete or the scoped local follow-up still awaits acceptance.                     |
| `verified`                       |        0 | No current-source acceptance SHA/run has been assigned.                                             |
| `blocked`                        |        0 | No whole finding is reclassified this way; separate report definitions retain their blocked status. |

The 26 partial rows include 13 row-level candidates, UI-05 with passing UI
evidence but incomplete original acceptance, META-01 awaiting a current CI
manifest, and 11 findings with their other original acceptance conditions
still open. These are subdivisions of the same 26 rows, not additional findings.

## Evidence boundaries and local attempts

Evidence paths in this section are relative to the workspace directory
`ais-evidence/`, outside the tested checkout. They are retained execution
artifacts, not published CI links. The earlier audit inputs are in
`gap-audit-20261105/original-gap-workbook-rows.json`,
`backend-ops-original-acceptance-audit.json`,
`current-evidence-summary.json`, `current-evidence/`, and
`reports-completeness-audit.json`.

The local JavaScript runtime was Node 22.23.4 with Vitest/V8 4.1.12. Native
database attempts used owned loopback MySQL 8.0.46 and Redis. Browser attempts
used the built application, the local authentication service and Chromium.
Their receipts record the command, return code and owned-service cleanup.
They do not substitute for a fresh MySQL 8.0/9.7 CI matrix on the final source.

| Evidence group                                | Observed result                                                                                                   | Receipt or result                                                                                                                                         | What the result proves                                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Standard reports and refund UI                | 42 passed: 33 standard-report cases and 9 refund cases                                                            | `report-ui/verification.json`, `report-ui/report-ui-green.json`                                                                                           | Actual React, tRPC client serialization and React Query behavior with substituted HTTP responses.                                                |
| Booking page and dialogs                      | 33 passed: 15 roster cases and 18 dialog cases                                                                    | `booking-dialogs/verification.json`, `booking-dialogs/booking-dialogs-green-verified.json`                                                                | The roster tests use mocked tRPC hooks; the dialog tests use the real client with HTTP fixtures. Neither is native server evidence.              |
| Booking browser handoff/reload                | Three successes in the original four-case attempt; the corrected reload case passed separately, without retry     | `runtime/20261105T103907817601Z/receipt.json`, `runtime/20261105T104154332209Z/receipt.json`                                                              | Native wallet/split invoice amounts and a real browser reload/request-key journey. The paid checkout response is mocked, as detailed below.      |
| Payer page                                    | 32 component cases; 2 native browser cases                                                                        | `payer/component-green.log`, `runtime/20261105T101757602881Z/receipt.json`                                                                                | Real-client UI transitions plus native unpaid cancellation and expired-link terminal behavior.                                                   |
| MFA, authentication hook and React boundaries | 37 passed in 6 files with same-run V8 output                                                                      | `mfa-boundary/green-receipt.json`, `mfa-boundary/acceptance-summary.json`, `mfa-boundary/coverage/coverage-final.json`                                    | Actual components and boundary handlers; HTTP fixtures for UI responses; counter attribution from the same run.                                  |
| Built entry and session recovery              | 17 browser cases passed, without retry                                                                            | `auth-recovery/build-green-receipt.json`, `runtime/20261105T102827530878Z/receipt.json`                                                                   | Direct URLs/reloads, a rejected built chunk, safe recovery, real unauthorized queries/mutations and embedded search.                             |
| Logout                                        | 3 browser cases passed, without retry                                                                             | `runtime/20261105T103414936362Z/receipt.json`                                                                                                             | Native logout/private-state cleanup with an actual installed service worker, plus explicit transport faults.                                     |
| APIS and boarding documents                   | 41 native cases passed with no skips                                                                              | `apis-seats/followup-summary.json`, `apis-seats/followup-green-source.json`, `runtime/20261105T103759875594Z/receipt.json`                                | Actual router/service calls and InnoDB state, including lock races and PDF ownership/tenant behavior.                                            |
| DCS tabs, station, loading and weight UI      | 66 passed in 5 files                                                                                              | `dcs-ui/verification.json`, `dcs-ui/dcs-green-verified.json`                                                                                              | Actual rendered tabs and controls with real tRPC client/React Query and HTTP fixtures; no operator dispatch acceptance.                          |
| Fare rules                                    | 41 native cases passed with no skips; 73/74 unit cases followed by the one corrected assertion passing separately | `fare/native-final.json`, `fare/final-source.json`, `runtime/20261105T104933535792Z/receipt.json`, `fare/review-green.json`, `fare/review-one-green.json` | Actual admin/router/SQL applicability and fare readers, plus numerical and rule validation. The focused unit rerun is not a fresh 74-case suite. |

These groups overlap prior tests and acceptance scopes. Their counts must not
be added into a whole-repository coverage or independent-test claim. In
particular, the APIS/boarding follow-up's 41-case result supersedes its earlier
35-case result. The separately recorded 139 related unit cases preceded the
last locking/PDF changes and are not represented as a fresh run of those
changes. The booking browser evidence reuses three earlier successes and adds
one corrected success; it is not a new successful four-case suite execution.
The full Vitest attempt ended with **5,055 passed, 1 failed and 0 skipped
(5,056 total)**, recorded in `full-suite-final.json` and
`runtime/20261105T105159796850Z/receipt.json` (exit 1). Its failing
`server/bookings.test.ts` case has a stale response stub without `setHeader`;
the corrected test context passed its one affected seeded-database case in
`booking-fixture-green.json` and `runtime/20261105T110039535471Z/receipt.json`
(exit 0, two other cases deliberately unselected). No passing full rerun is
claimed. Main, E2E and acceptance-script TypeScript checks passed; the final
fare/native-test dependency typecheck also passed after the date-boundary
follow-up. The application build passed, followed by a backend rebuild for
those final fare edits. Final integrated CI remains required.

### Preserved failure evidence

- `report-ui/ui12-red.json` records two stale download-error failures before the
  revision guard. The current-request error remains covered after the fix.
- `booking-dialogs/ui02-red-targeted.json` records two delayed-allocation seat
  failures. `booking-dialogs/ui05-red.json` records the changed request key after
  dialog remount. The earlier broad allocation attempt also included a test
  helper issue and is not used as the designated regression proof.
- `dcs-ui/dashboard-red.json` records 16 failing cases before the dashboard
  fixes. `dcs-ui/load-weight-red.json` records four failures involving stale
  validation, a changed flight and a changed aircraft.
- `apis-seats/races-red.json`, bound by
  `runtime/20261105T103658838165Z/receipt.json`, records both corrected native
  race reproductions: validating a replacement document from an earlier read,
  and returning an old boarding sequence beside a newly signed barcode. The
  first boarding race barrier in `followup-red.json` stopped an earlier router
  lookup and is explicitly excluded as race regression evidence. The separate
  owner-admin PDF failures in that attempt were genuine.
- The failed built-browser recovery and logout attempts are retained under
  their individual `runtime/` directories. The passing attempts above identify
  the accepted local reruns; failed or skipped attempts are not counted as
  passes.
- The initial booking reload failure was a test assumption: `MyBookings`
  consumes `exchange` when opening the dialog. After a real reload, the test
  now opens Modify from the same booking-reference card. No product change was
  needed for that test correction.

## Previously eligible findings: current CI still required

The previous backend/operations audit identified ten eligible findings. UI-03
and UI-08 are supported by the saved UI/browser results, yielding the 12 below.
All retain `needs_current_sha_verification`; none receives a new acceptance SHA.
The ledger preserves the exact original criteria and full test paths.

| ID     | Original acceptance focus                                                                                            | Existing evidence to run on the final source                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01  | Refresh replay commits family revocation, including concurrent rotation, while other families survive.               | `auth-session-mysql.test.ts`, `auth-session-regression.test.ts`, `scripts/verify-transaction-boundaries.ts`.                                                                                                                                                                        |
| BE-02  | MFA migration/session proof, one-use challenges/codes, enrollment/action races and rollback.                         | `auth-session-mysql.test.ts`, `session-mfa-boundary.test.ts`. The new UI tests do not replace these authorities.                                                                                                                                                                    |
| BE-03  | Internal refunds conserve each tender, invoice and ledger under replay, concurrency and failed commits.              | `internal-refund-boundary.test.ts`, `financial-authority-mysql.test.ts`, `scripts/acceptance/project-hardening.ts`.                                                                                                                                                                 |
| BE-04  | Agency credit limits, ownership, concurrent invoices and repayment/refund debt semantics.                            | `financial-authority-mysql.test.ts`, `e2e/agency-credit.spec.ts`.                                                                                                                                                                                                                   |
| BE-08  | Real authentication client/provider boundary, native session issuance/rotation/revocation and failed authentication. | `auth-service-http.test.ts`, `auth-session-mysql.test.ts`. Controlled provider HTTP is distinguished from an external provider.                                                                                                                                                     |
| BE-09  | Booking economics entry enforces role/tenant before computation, including missing/foreign/error cases.              | `seat-economics-tenant-boundary.test.ts`. The persistence adapter is a relational double; the original criterion does not require native SQL.                                                                                                                                       |
| OPS-01 | Report API schemas, roles, scope, generation/export and owner-only saved results.                                    | `standard-report-router.test.ts`, `standard-report-schedules-mysql.test.ts`, `e2e/standard-reports.spec.ts`. This does not certify every report's source.                                                                                                                           |
| OPS-02 | Scheduler recovery, fencing, delivery claims, deletion and changed owner/tenant authority.                           | The 27-case `standard-report-schedules-mysql.test.ts` suite identified by the previous audit.                                                                                                                                                                                       |
| OPS-07 | Inventory capacity/hold/promise invariants and transactional/concurrent rollback.                                    | `operations-inventory-mysql.test.ts`, `inventory-allocation-boundary.test.ts`, `scripts/acceptance/integration-remediation.ts`.                                                                                                                                                     |
| OPS-10 | Notification replay, failed-recipient retry, tenant scope and controlled-provider refusal/timeout.                   | `flight-event-delivery.test.ts`, `flight-delivery-mysql.test.ts`, `email-worker.test.ts`, `email-worker-provider.test.ts`. Controlled provider behavior is the original local acceptance boundary.                                                                                  |
| UI-03  | Multi-city ordered handoff, passenger/fare/cabin selection, stale quote/input/overnight cases.                       | Saved Vitest results contain 9 passing `MultiCityResults.test.tsx` cases; saved Playwright results contain the passing `e2e/multi-city-fare.spec.ts` journey.                                                                                                                       |
| UI-08  | Actual booking/revenue/flight/refund downloads in CSV/Excel/PDF, failure retry and context isolation.                | Saved Vitest results contain 19 passing `ExportReportButton.test.tsx` cases; saved Playwright results contain 6 passing `e2e/vrs-report-exports.spec.ts` cases with content, dates and tenant checks. Synthetic component PDF/XLSX bytes alone would not prove document generation. |

The UI-03 and UI-08 results were read from
`gap-audit-20261105/current-evidence/vitest-results.json` and
`playwright-results.json`, rather than inferred from test-file presence. Their
original mapping is also documented in
[the 4 November remediation record](20261104-coverage-gap-remediation.md).

## Current candidates, mapped to the original acceptance

The following 13 findings, including BE-06 detailed below, have executable evidence covering their original
acceptance, with `candidate_pending_ci` metadata. Their formal ledger status
remains `partial` until the final-source gates pass. An unmet original criterion
is not treated as a CI-only dependency; separate capability boundaries are not
added as new requirements to a UI-only criterion.

| ID     | Original criterion and current evidence                                                                                                                                                                                                                                                                                                                                                             | Remaining condition or boundary                                                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-03 | `server/__tests__/apis-seats-acceptance-mysql.test.ts` calls the actual APIS routes/services for collection/update, owner/tenant refusal, missing data, calendar/date boundaries, failed validation, mixed-sector PAXLST/PNRGOV counts and refusal of external submission. A competing native document update cannot be stamped validated from the previous snapshot.                               | Fresh exact-source native CI. External authority transmission/ACK is deliberately unavailable; explicit refusal is the workbook's local requirement, so absence of an external ACK is not invented as a new failure of this ID.                          |
| OPS-05 | The same native suite covers repeated seat initialization without duplicates, blocked seats, current gate/seat/document reads, check-in nonce/sequence changes, owner/flight/tenant guards and PDF behavior. After undo/check-in, a stale wrapper snapshot is refused, then a fresh document is consistent.                                                                                         | Fresh exact-source native CI. Physical printer or carrier certification is outside this ID's local acceptance. Global admin/super_admin owners with no airline context retain their PDF path; nonowners remain rejected before issuance.                 |
| UI-C01 | `PayYourShare.test.tsx` and `e2e/payer-terminal-acceptance.spec.ts` cover an unpaid cancelled share with no refund item, a success/session return, and null expired-link results. Native browser request counts stay unchanged beyond two polling periods.                                                                                                                                          | Fresh component/browser CI. No provider settlement is claimed.                                                                                                                                                                                           |
| UI-01  | `useAuth.test.tsx`, `e2e/auth-logout-acceptance.spec.ts` and `e2e/auth-recovery-acceptance.spec.ts` cover private cache/UI/persistence cleanup, back navigation, another account, worker-cache deletion and safe return URLs.                                                                                                                                                                       | Fresh isolated logout and recovery phases. The logout `UNAUTHORIZED` reply is injected because the public expired-session logout normally succeeds. The lost-reply case forwards the real logout before aborting its response.                           |
| UI-02  | `BookingPageSeatRoster.test.tsx` covers unchanged retry identity, passenger/extras changes, deleting the middle of three passengers with seat/extras ownership, and delayed group/waitlist roster replacement. The browser file verifies wallet/split method and invoice amounts returned by the actual server.                                                                                     | Fresh component/browser CI. Roster tests mock tRPC hooks. The native wallet/split cases prove booking-to-invoice handoff and totals, not subsequent spending or settlement.                                                                              |
| UI-04  | The 32 payer component cases cover invalid/missing tokens, pending-to-paid, already paid, expiry/cancellation with and without return parameters, checkout refusal/retry, pending duplicate protection and terminal polling. Native terminal cases supplement UI-C01.                                                                                                                               | Fresh CI. Successful checkout and pending-to-paid component responses are HTTP fixtures; they do not prove a payment-provider charge.                                                                                                                    |
| UI-06  | `DcsStationActions`, `DcsDashboardInteractions`, `LoadPlanningInteractions` and `WeightBalanceInteractions` execute the actual tabs and all four original UI criteria: case open/link/close with identity or permission change; current downgrade quote and refusal; old equipment/layout rejection then refresh; invalid/over-limit/valid loading, finalization and stale/server-error protection. | Fresh final-source UI CI. HTTP fixtures establish interaction and rejection handling, not native service authority. The separately guarded demo/dispatch capability is not promoted and is not an added requirement of this original UI row.             |
| UI-09  | `RefundsDashboardInteractions.test.tsx` checks actual displayed row and statistics changes through `review_required → processing → completed`, plus pagination/filter reset, read failures, retries and stopped polling. It checks values rather than refetch counts alone.                                                                                                                         | Fresh CI. Phase-dependent HTTP fixtures do not independently establish financial conservation on the server.                                                                                                                                             |
| UI-10  | `App-route-boundary.test.tsx` invokes the actual React boundary. Seventeen built-browser cases cover direct/reloaded routes with/without a session, rejected chunk retry/home, real unauthorized query/mutation, safe `returnTo`, embedded isolation and Arabic/English bootstrap.                                                                                                                  | Fresh build/browser CI on the final source. The chunk failure is injected into a real built page; render-error component tests and built-chunk recovery remain distinct proof.                                                                           |
| UI-11  | The final 37-case shared group includes 18 `MFASetup` and 4 `MFAVerify` cases for backup/TOTP challenge use, rejection, consumed codes, pending controls, reset/focus, setup acknowledgment, copy/download and clipboard denial.                                                                                                                                                                    | Fresh UI CI plus the separate native BE-02/session suites. HTTP fixture success is not native cryptographic acceptance. Clipboard data deliberately copied before cancellation cannot be revoked.                                                        |
| UI-12  | Thirty-three `StandardReports.test.tsx` cases exercise validation and mutation failures, generating/ready request identity, downloads and abandoned context. New deferred rejection tests prove that old errors do not replace the current view and a current error remains visible.                                                                                                                | Fresh CI plus the native generation/download browser suite. Native time/number controls normalize `24:00` and nonnumeric text to empty; these tests prove no mutation, not an internal `hour > 23` or `NaN` branch hit. This work does not close CAP-01. |
| UI-M01 | Same-run V8 results record the actual standalone boundary return at line 38 (14 hits) and catch at line 43 (7), and App boundary return at line 155 (6) and catch at line 159 (3), alongside their function/branch counters.                                                                                                                                                                        | Publish the current source/provider/config identity and comparison in CI. Nonzero behavior and differing counters do not establish that a source-map or coverage-provider defect has been repaired.                                                      |

### BE-06: fare acceptance and completed calendar-boundary correction

The earlier native fare attempt passed 41 cases with no skips for actual
administrative authorization/persistence, SQL class/airline/route/date
filtering, availability/comparison against rounded calculation, and malformed
or unsupported rules. Corrections cover safe minor-unit arithmetic, valid
signed discounts, negative multipliers, all supported blackout aliases and
invalid dates. A date-only request is bound to the flight's UTC day and its
actual departure instant. These results are preserved in `fare/native-final.json`,
`fare/final-source.json` and `runtime/20261105T104933535792Z/receipt.json`.
The 73/74 unit attempt and the separate corrected assertion remain distinct
receipts, not a new 74-case full-suite result.

The later period-end review reproduced ten failing unit cases with eight
controls passing. Its correction passed **24 targeted unit cases** (18 new
and six directly affected) and **24 targeted native cases** (19 new and five
directly affected). The other 68 unit and 36 native cases were deliberately
unselected in those focused reruns; earlier successful cases were not repeated
solely to consolidate a report. Evidence is recorded in
`fare/date-boundary-20261105T105951068881Z/completion.json` and
`runtime/20261105T110808309679Z/receipt.json`, with matching final source hashes
and MySQL/Redis cleanup exit 0.

Calendar-only blackout and seasonal periods include the full final UTC day.
Explicit timestamps remain exact boundaries. A date-only rule `validUntil`
is persisted at 23:59:59, matching the existing whole-second MySQL column,
without rounding into the following day. Router creation/update and actual
SQL filtering cover the endpoint and following-day controls. BE-06 is now
`candidate_pending_ci`, still formally `partial` until the final-source gates
are accepted. No external tariff or operator policy approval is inferred from
configured local rules.

### UI-05: local UI passes, original row remains partial

This row is not a closure candidate. Its test CI is still pending, but a green
test rerun alone would not supply the missing original paid-modification and
cancellation-receipt acceptance.

| ID    | Original criterion and current UI evidence                                                                                                                                                                                                                                                                                                     | Remaining original acceptance                                                                                                                                                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI-05 | `BookingServiceDialogs.test.tsx` covers quote identity/consent, the exact expiry boundary, unchanged retry/remount identity, changed inputs, actor/tenant scope, corrupt saved identity, paid-seat refusal, free confirmation and failure states. The real reload journey sends the same key three times and persists one native modification. | Full paid fulfillment and original nonrefundable/cash/split cancellation fees/receipts still need their current native financial acceptance linked. The paid browser test mocks `payments.createModificationCheckout`; it proves consent, the quote ID and URL navigation only. The reload case aborts its first two requests before the server, not after commit. |

### UI-06: original UI acceptance and the separate dispatch boundary

The original UI criterion asks that invalid and over-limit input, a valid plan,
finalization, changed equipment and declined server operations behave safely.
The new tests exercise those decisions through the real rendered UI and client
lifecycle. They reproduced stale approval, duplicate pending commands,
truncated decimal input, stale validation and wrong-context completion notices
before the production fixes.

All four workbook UI-06 criteria are interaction/state/rejection requirements.
Operational dispatch approval is not added as an extra condition for closing
that original UI coverage row.

The existing services still call `requireDemoCapability` for the simulated
load-planning/weight-and-balance path. `AIS_ENABLE_DEMOS` is a development/test
capability and does not enable a verified production adapter. The separate
`ControlledLoadSheetReview` explicitly states that dispatch acceptance requires
the operator's procedure. Its internally reviewed/signed draft is not an
operational load sheet accepted for dispatch. Passing UI tests cannot
erase that boundary. Operator-approved data/policy and an actual operational
acceptance receipt are still required for that broader capability.

## Other original acceptance remains open

The source guards and older successful tests below are useful evidence. The
specific unproved criteria must still be exercised; source presence does not
turn them into a newly observed defect or a completed acceptance result.

| ID               | Existing evidence                                                                                                                     | Remaining original acceptance                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BE-05            | `e2e/local-ticket-revalidation.spec.ts` and related revalidation authority tests, listed in the ledger.                               | Changed fare digest/offer between preview and commit; other-tenant and check-in/baggage/external-receipt cases; incomplete components/completed sector and local departure/arrival timezone boundaries.                                                                                                                                                                        |
| BE-07            | Existing Stripe boundary, settlement and webhook tests.                                                                               | Two concurrently signed paid webhooks through the whole native settlement/ledger/outbox path; database outage then provider redelivery through that chain; tenant-safe confirmation/attachments and failed PDF/email replay without repeated ticket issuance.                                                                                                                  |
| BE-10            | Existing native wallet/spend, refund and split authorities.                                                                           | Wallet payment concurrent with refund or top-up, with invoice/ledger conservation and failed/replayed operations. Separate spend and refund races do not prove this crossing.                                                                                                                                                                                                  |
| OPS-04           | Existing manifest and baggage closeout routes/services.                                                                               | Refund concurrent with manifest reading; link successful actual-route manifest acceptance with foreign-tenant closeout refusal. Sequential refund-then-read is not a snapshot race.                                                                                                                                                                                            |
| OPS-06           | `scripts/acceptance/dcs-counter-lifecycle.ts`, native station tests and the strengthened station UI tests.                            | Native negative remaps, replay event uniqueness, stale/foreign downgrade quote and injected middle-of-change rollback. The original text asks for rejection of an operational-block remap, while the documented implementation allows a compatible remap that preserves the block. Reconcile that intended-behavior criterion rather than claiming blanket literal compliance. |
| OPS-08           | `bsp-local-evidence-persistence.test.ts`, `bsp-local-evidence.test.ts`, `scripts/acceptance/bsp-local-evidence.ts`.                   | Simultaneous same-reference HOT/bank imports, including competing changed content. Concurrent staging and serial import conflicts do not prove concurrent import. External BSP settlement is outside this local criterion.                                                                                                                                                     |
| OPS-09           | Cron/task/worker lifecycle tests and the existing forensic/transport acceptance scripts.                                              | The actual `server/worker.ts` with native DB/Redis executing a standard-report tick and receipt; a native lease exceeding 30 seconds with renewal; SIGTERM during that tick, readiness withdrawal and final receipt before DB close. An outbox SIGKILL child is a different boundary.                                                                                          |
| OPS-11           | `api-process-mysql.test.ts` and health/readiness/provider boundary tests.                                                             | Actual API-process readiness for unavailable provider/configuration and Redis outage/fallback; actual entry-stack rate limiting, 429 and recovery. Isolated health/client tests do not establish the complete middleware process behavior.                                                                                                                                     |
| SRC-API-SHUTDOWN | API shutdown wiring, pool shutdown and native API-process tests.                                                                      | Real-process SIGINT in addition to SIGTERM; real uninitialized-pool and close-failure exit/log/deadline cases where only controlled wiring evidence exists.                                                                                                                                                                                                                    |
| UI-07            | `KioskBagTag.test.tsx`, `e2e/vrs-kiosk-tags.spec.ts`.                                                                                 | Browser printing is substituted. The original criterion separately requires target-printer barcode/margin and physical-output acceptance; it remains unprovided. Current-source UI/version/privacy reruns also remain required.                                                                                                                                                |
| META-01          | `scripts/ci/run-coverage-evidence.mjs`, `scripts/ci/test_coverage_evidence.py`, historical CI artifacts and the local receipts above. | A final committed/merge source, current run identity, runtime/provider/scope/timestamps/exit codes, matching suite outputs and critical-journey receipts. Dirty-worktree local evidence cannot populate `accepted_sha` or `acceptance_run`.                                                                                                                                    |
| CAP-01           | Catalog/source audit, native report family tests, independent review and browser exports.                                             | Per-definition available-report acceptance and each partial/blocked source condition, described below.                                                                                                                                                                                                                                                                         |

## CAP-01: catalog count is not capability completion

The classification remains exactly:

| Report classification | Count | Acceptance meaning                                                                                                      |
| --------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------- |
| Available             |    36 | A documented local capability; each still needs its known-data totals, API/export, tenant and period-boundary evidence. |
| Partial               |    35 | A runnable result with named missing sources, dimensions or history. No promotion is made here.                         |
| Blocked               |    28 | An explicit refusal until the missing source/authority/acceptance condition is supplied. No promotion is made here.     |
| Total                 |    99 | Unique definitions, not 99 fully accepted capabilities.                                                                 |

There are 71 nonblocked definitions and 63 that are not fully available. The
native operations enumeration checks 29 executable readers, but that loop alone
does not prove semantic totals and API/export isolation for all 36 available
reports. The standard-report browser tests for selected IDs and the separate
legacy CSV/Excel/PDF export suite also have distinct scopes.

The [63-entry source/acceptance ledger](20261104-report-source-acceptance-ledger.md)
continues to identify each partial/blocked report's condition. The later source
audit groups those 63 into 21 primarily local model/history tasks, 21
external/operator authority tasks and 21 mixed tasks. Those are work-planning
groups, not replacement availability labels or granted certificates.

Missing historical office/sale/coupon records must not be invented from current
state. Carrier, GDS, interline, authority, bank, payment, uplift and dispatch
acceptance require their actual authoritative evidence and applicable approved
policy. A UI regression fix, an enumeration test or a fixture cannot supply it.
The ledger therefore retains `promotions_verified: 0` and the catalog itself is
unchanged.

## Required acceptance and ledger guard

The implementation's workflow changes select the new native APIS/seat and fare
suites in the existing production-gate matrix, add payer/recovery/booking
browser files to the normal Chromium phase, and isolate logout so that it does
not revoke another journey's shared login. That is test selection, not evidence
that the final workflow has run successfully. The separate logout report must
be retained alongside the main browser report.

Before formal closure, the coordinator must:

1. Record the actual code/merge revision, retaining local failure and success
   receipts and the original acceptance mapping.
2. Complete the integrated fare checks and any remaining original criteria. A `candidate_pending_ci`
   row still requires its exact-source evidence review. UI-05 remains excluded
   until its missing original acceptance is supplied; BE-06 awaits the latest
   boundary-correction evidence.
3. Run the required integrated type/build/unit/coverage, native MySQL matrix,
   browser and workflow gates against the final source. Keep mocked provider
   results, actual provider acceptance and physical/operator acceptance separate.
4. Publish the source-bound manifests/results. Only then may a finding with all
   original criteria met receive `verified`, its real `accepted_sha`, and its
   actual GitHub `acceptance_run`.

The repository guard is `python3 scripts/ci/check_gap_closure_ledger.py`. It
requires 38 unique findings, the original 33 P1/5 P2 priorities, permitted status
values, source/run evidence for any `verified` row, and the unchanged 99-report
classification. The guard passed at this documentation handoff. An additional integrity check
matched all 38 acceptance texts and priorities to the original workbook and
confirmed every referenced repository/evidence path exists. `git diff --check`
also passed. These checks validate record integrity; they do not execute
acceptance tests or certify a report source.
