# Coverage closure: re-acceptance on the current main source (2026-11-09)

Issue: [#279](https://github.com/kafaat/ais-aviation-system/issues/279).
Ledger: [`coverage-closure-ledger.json`](coverage-closure-ledger.json).
Previous accepted source: `9929de4d1d246f748c467eecbf49ce6f452d60c5` (2026-11-05,
[native gap acceptance](2026-11-05-native-gap-acceptance.md)), retained in the
ledger under `previous_acceptances`.

## What changed

The ledger's `source_revision` now names a **main commit**,
`941f86c996b43f6de61fd904259b882a1a39a9b4`, on which every required workflow
family ran as a push run and passed:

| Workflow                | Run                                                                    | Result                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI/CD Pipeline          | https://github.com/kafaat/ais-aviation-system/actions/runs/42690069019 | Lint, Security, Run Tests (441 files, 6415 tests), Build, E2E (19 Playwright specs, the UI05 financial profile, the isolated logout and authentication phases); attempt 2 after one timing-dependent quota assertion in `api-process-mysql` failed on attempt 1 and passed on re-run with no code change |
| Production Gates        | https://github.com/kafaat/ais-aviation-system/actions/runs/42690069061 | Migration replay and live transaction acceptance on MySQL 8.0 and 9.7, native service boundaries, TCP faults and worker recovery, previous-release upgrade replay                                                                                                                                        |
| Aviation Component Labs | https://github.com/kafaat/ais-aviation-system/actions/runs/42690068964 | REST state machine and Microcks contracts, Docker production contract                                                                                                                                                                                                                                    |

Production Docker Validation is path-filtered and did not run on this
documentation-only commit; its last run on the preceding code commit
`61f64b548b7624de97efb3bade1f50b71a9360a6` passed.

Every finding that was `verified` on the previous source keeps its listed
tests; all of those tests are part of the suites above (Vitest runs every
`*.test.ts`, the E2E job lists every cited `e2e/*.spec.ts`, the UI05 profile
runs `browser-acceptance/ui05-financial-dialogs.spec.ts`, and the native
boundary step runs `scripts/verify-transaction-boundaries.ts` with the
acceptance scripts it imports). Their `accepted_sha` and `acceptance_run` now
point at this source and the CI/CD run.

## Five scripts CI type-checks but does not execute

`scripts/acceptance/aviation-research.ts`, `bsp-local-evidence.ts`,
`paid-sector-exchange.ts`, `r2-transport.ts` and `scoped-ancillary-sale.ts`
are cited by BE-07, OPS-03, OPS-05, OPS-08 and OPS-09. CI type-checks them
through `tsconfig.acceptance.json` but no workflow runs them; they remain
local evidence. Each of those five findings carries a `ci_execution_note`
saying so, and its verification rests on the other listed tests, all of which
CI executes. This was not stated in the ledger before.

## UI-05 promoted to verified

The 2026-11-05 assessment left UI-05 partial because its original criterion 5
(cancel a nonrefundable booking, a cash-funded booking and a split-funded
booking, showing the refund fee and an operation receipt) was unproved: the
cancellation policy was time-based and fare refundability was not applied.
That changed on 2026-11-06 (`3aca7f4`): `fare_classes.refundable` now drives
`policyReason: "nonrefundable_fare"` in
`server/services/zero-refund-cancellation.service.ts`.

Evidence on the accepted source:

- Browser journeys (`browser-acceptance/ui05-financial-dialogs.spec.ts`, real
  Chromium, API, MySQL, Stripe SDK transport and signed webhook): cash
  cancellation shows the 50% retained fee and the native refund receipt; a
  fare-only nonrefundable booking requires explicit zero-refund consent and
  retains a cancellation receipt with the retained fee across reload; split
  cancellation fulfils both original payers and preserves fees and operation
  receipts; a nonrefundable departure refuses cancellation with no provider
  refund and no financial effect.
- Native tests (`server/__tests__/ordinary-refund-boundary.test.ts`,
  `ordinary-refund-mysql.test.ts`, `split-refund-boundary.test.ts`): a
  nonrefundable fare is never turned into a time-based cash refund; the
  `nonRefundable` cancellation penalty is honoured and unrelated or expired
  rules excluded; zero cancellation requires consent, rejects a stale fare
  quote, cannot be bypassed through the generic cancellation route, refuses
  internal or mixed funding without manufacturing a refund, and rolls back
  with its receipt if the durable event cannot be recorded; concurrent
  explicit zero-refund cancellations commit once.

Design limit recorded rather than hidden: a zero-refund cancellation of an
internally or mixed-funded booking is refused explicitly and routed to
reconciliation, because there is no provider refund to issue. The previous
partial state is kept on the row as `prior_partial_state`.

## Still partial, and why the repository cannot close them

| Finding | Remaining condition                                                                                                                                                             | Owner                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| OPS-06  | The original criterion requires a blanket refusal of seat remap under an operational block; the implemented policy preserves a compatible remap. One of the two must be chosen. | Operations/product owner    |
| UI-07   | Physical target-printer acceptance of the bag-tag reprint: barcode validity, margins and hardware output. Browser print preview is not physical acceptance.                     | Station hardware acceptance |
| CAP-01  | 35 partial and 28 blocked report definitions need their authoritative data or provider acceptance before promotion (#280). `promotions_verified` stays 0.                       | Data/provider owners        |

## Guard

`scripts/ci/check_gap_closure_ledger.py` passes on this ledger: 38 distinct
findings, 33 P1 and 5 P2, every verified row bound to the single accepted
source and a GitHub run, 99 report classifications unchanged at 36/35/28.
