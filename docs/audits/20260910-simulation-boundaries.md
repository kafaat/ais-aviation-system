# Production simulation boundaries and biometric authorization

Date: 2026-09-10. Reviewed base: `50f343753b51502adc99ef508fbd5fe2a1732e76` (v1.22.1).

هذه أول دفعة تنفيذية من المراجعة العميقة: حجب المحاكاة غير المعتمدة في الإنتاج، والتحقق من ملكية الراكب والجهة في جميع عمليات البيومتري الخاصة بالمسافر. لا تمنح هذه التغييرات اعتمادًا تشغيليًا للبيومتري أو حسابات الحمولة.

## Problem and result

Biometric matching and regional health/replication currently simulate success. Weight-and-balance services use illustrative passenger weights, fixed arms and estimated fuel consumption. These operations were callable in production. Authentication alone also allowed biometric passenger operations against another user's passenger ID.

The existing `requireDemoCapability` guard now protects 48 service operations. It rejects with `PRECONDITION_FAILED` before input processing, database access, cached reads or state changes whenever `NODE_ENV=production`, even if `AIS_ENABLE_DEMOS=true`. Outside production, explicit `AIS_ENABLE_DEMOS=true` is required. Development fixtures must use synthetic data in a separate database: some load-planning operations do persist data.

| Surface                    | Protected operations                                                        | Result                                                                      |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Biometric service          | All 10 exports, including event/gate reads and token issuance               | No simulated biometric or hardware success in production                    |
| Multi-region service       | All 10 exports, including health, replication, routing and failover history | No simulated region status or failover in production                        |
| Weight-and-balance service | All 13 exports, including cached aircraft limits and historical load sheets | No operational use of the illustrative model                                |
| Detailed load planning     | All 10 exports, including validation, finalization and amendment            | No alternate path to approve or retrieve synthetic load results             |
| DCS                        | Calculate W&B; create, get, approve and finalize load plan                  | Closes a third load-plan path; ordinary DCS aircraft reads remain available |

The protected passenger biometric operations are enrollment, verification, boarding-token generation, enrollment status and revocation. Each now receives the authenticated user ID, role and tenant from server context, then verifies the passenger's booking owner and both the booking and passenger tenant IDs. Authorization is enforced inside the service as well as carried by the router. Missing/unassigned tenant records fail closed. The established `admin`/`super_admin` override is preserved; `airline_admin` cannot bypass ownership or tenant checks. Existing baggage callers of `assertPassengerOwnership` retain their existing contract; strict tenant scope is an explicit additional argument used by biometrics.

No database migration, dependency change or new environment flag is required. Existing production clients of these simulated surfaces now receive an explicit precondition error, including reads of historical/cached simulation results. In-process biometric callers must supply trusted actor context; status and revocation are now asynchronous. The public request payload shapes remain unchanged, and client-supplied authority fields are ignored.

## Verification

- New regression coverage: 242 simulation-boundary cases and 32 biometric authorization cases. The former covers all 48 service operations across five environment/flag combinations, plus enabled-development and unaffected-DCS checks.
- The biometric tests use the real router, service and authorization helper with a database boundary double. They cover another user, forged payload authority, airline administrators, tenant mismatch, unassigned records, missing passenger, database loss, unauthenticated calls, direct service calls, the platform-admin override, and the successful owner workflow.
- Targeted run: 295 tests passed across four files, including the existing access-control and operational-truth tests.
- Full local Vitest run: 1,350 passed, 241 skipped; 92 files passed, 17 skipped. Skipped tests are not counted as verified behavior.
- TypeScript: `corepack pnpm check` passed.
- Production build: `corepack pnpm build` passed.
- Full ESLint run: passed with zero errors and 263 warnings; this change does not claim a warning-free repository.
- Database/service doubles are not evidence of live MySQL, Redis, hardware or provider acceptance. No real biometric device or flight-release process was exercised.

Reproduce the focused checks:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec vitest run --project server server/__tests__/simulation-boundaries.test.ts server/routers/biometric.security.test.ts server/services/access-control.service.test.ts server/__tests__/operational-truth.test.ts
corepack pnpm check
```

## Findings status and next acceptance gates

The identifiers below refer to the companion `AIS-Deep-Review-AR` report, not the older repository audit's numbering.

| Report finding                              | Status in this change                                     | Still required                                                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 — biometric simulation in production    | Production exposure contained                             | Verified provider/device adapter, durable encrypted templates and consent lifecycle, enrollment expiry/revocation semantics, replay-resistant token redemption and deletion verification |
| F02 — missing biometric passenger ownership | Addressed on all five passenger service/router operations | Live database acceptance and review of any future staff/delegated-access workflow                                                                                                        |
| F03 — synthetic W&B                         | Production exposure contained across three services       | Aircraft-registration-specific approved data, versioned mass/fuel/CG policies, reference calculation cases, qualified operational review and signed release/audit workflow               |
| F04 — simulated multi-region operations     | Production exposure contained                             | Real health probes, durable replication receipts, measured failover and restore exercises                                                                                                |

These are containment changes, not replacement implementations. Do not remove the production guard merely because credentials or a feature flag exist. Replace simulation with an adapter and its acceptance evidence before enabling the capability. Demo biometric tokens still have no production redemption path, and the demo's lifecycle logic is not a compliance implementation.

Next independent engineering slices from the report remain booking idempotency (F05), correct economics aggregation and measured assumptions (F06), unified pricing/offer snapshots (F07), and the remaining policy, integration, AI and delivery findings. They are not marked closed by this pull request.
