# AIS — coordinated forensic remediation / التنفيذ الموحد

## Authority and source

The user initially divided the work between two conversations, then explicitly authorized this conversation to implement **both tracks** and said they would stop the other agent. This latest direction supersedes the handoff below. The same six specialists are reused across successive assignments, with one integrator and one review branch. Baseline: `50a3114ec49d2bf43a4933f54b7eba43de086888` (PR #288 merged). Recheck main/open PRs before starting or integrating. At the initial recheck only release PR #287 was open; branch names alone are not evidence of active ownership.

Track A integration branch: `codex/ais-forensic-phase1-20261105`.
Track B now integrates into the same branch; its originally proposed separate branch is not needed.
No merge or production deployment is implied by a passing local test. Preserve provider and device gates until their actual acceptance is available.

## Track A — this conversation: ten new findings

| Agent                         | Findings                              | Scope and acceptance                                                                                                                                                                    |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 refund lifecycle           | FIN-01                                | Persist ordinary cancellation intent, complete delayed successful refunds, preserve compensating partial refunds, reconcile DCS conflicts, prove replay and capacity/coupon effects.    |
| A2 wallet dispute             | FIN-02                                | Reconcile disputed top-up funds with spendable wallet balance, preserve existing-travel policy, prove duplicate/reinstatement/insufficient-funds behavior.                              |
| A3 seat ownership             | OWN-01                                | Bind expected booking/passenger/actor to the locked seat, preserve lock ordering and other DCS/payment guards, prove stale authorization refusal and native concurrency when available. |
| A4 account locks              | IDENTITY-01                           | Atomic reusable lock state after explicit unlock/expiry; consistent effective-lock semantics and first-lock/relock/expiry controls.                                                     |
| A5 request identity           | IDENTITY-02, IDENTITY-03, IDENTITY-05 | Browser-bound OAuth login state; IP admission enforcement; transport-equivalent Cookie/Bearer identity for rate limiting.                                                               |
| A6 role and voucher contracts | IDENTITY-04, IDENTITY-06, CONS-01     | Explicit role capabilities, intended platform-admin equivalence with tenant/owner checks retained, correct fixed/percentage voucher units and create/update validation.                 |

Runtime concurrency permits three subagents at once. Six specialists execute in two parallel waves; their changes are integrated into one branch. Each works in an isolated checkout. The integrator owns shared migration numbering/journal/snapshot, generated catalogs, aggregate CI configuration and integration evidence.

### Track A reserved surfaces

- `server/services/refunds.service.ts`, `payment-settlement.service.ts`, cancellation reconciliation and any new cancellation-intent storage.
- `server/services/payment-dispute.service.ts`, `wallet.service.ts`, any wallet-funding guard, relevant transactional helpers.
- `server/routers/seat-map.ts`, `server/services/seat-map.service.ts` release ownership and regression tests.
- `server/services/account-lock.service.ts` and effective account-lock authorization tests.
- OAuth login entry/callback/state, `client/src/const.ts`, shared request authentication, `server/_core/middleware/user-rate-limit.ts`, IP admission wiring.
- `server/services/rbac.service.ts`, intended platform-owner bypass checks in routers/services, and role-matrix tests.
- Voucher value conversion and validation in `client/src/pages/admin/VoucherManagement.tsx`, `server/routers/vouchers.ts`, and relevant service/tests.

Do not independently rewrite these surfaces in concurrent assignments. Read the Track A diff before integrating adjacent UI. Apply dependent changes after rebasing on the integrated contracts rather than duplicating a fix.

## Track B — subsequent assignments in this conversation

### B1. Five consumer workflows (CONS-02..CONS-06)

1. Settlement review: operator list/detail/recovery workflow using existing payments contracts; distinguish `review_required`, `awaiting_webhook`, and actual completion. Consume Track A cancellation semantics; do not modify its financial state machine in parallel.
2. Bag-return grants: admin workflow for staff/carrier/station grants and revocation, with all custody/tenant restrictions retained. The bag handover action already exists; do not bypass its grant.
3. Individual flight favorites: connect `favorites.addFlight` to an actual flight and verify read/remove/reload/owner isolation. Route favorites are a different resource.
4. Reviews: mount reading, statistics, pagination and helpful voting with existing moderation/eligibility boundaries. Review creation already exists.
5. Voucher editing: implement the disabled editor after Track A voucher-unit patch. Define permitted edits for active/used vouchers; preserve correct existing API-created records. Avoid parallel edits to `VoucherManagement.tsx` until Track A changes are available.

### B2. Four previous partial items

- OPS-06: reconcile the old blanket prohibition with the implemented compatible remap that preserves the operational block. Obtain/record the intended policy; do not change it merely to make an old assertion green. Coordinate with Track A seat-release changes, which concern a different authorization boundary.
- UI-05: define and connect nonrefundable fare cancellation policy, including a zero-refund cancellation decision. This depends on Track A FIN-01 completion and must not be implemented as a concurrent rewrite of refund settlement.
- UI-07: actual target printer/scanner and barcode/margin acceptance. Browser preview is not physical evidence. This overlaps the device portion of INT-03; close both using the same real receipt when appropriate.
- CAP-01: inspect all99 report definitions and remaining sources. Current labels are36 available/35 partial/28 blocked. Promote only definitions with accepted source data and executable acceptance; no invented commercial or provider data.

### B3. Governance and architecture

- GOV-01: obtain real accountable domain owners/on-call acceptance. `service-ownership.json` has no assignments; do not substitute `@kafaat`, file names or invented people for an accepted operating owner.
- SSOT-01: ADR-0001 remains Proposed. Document current Booking/receipt/ledger authority; do not introduce an unapproved wholesale Order migration while fixes are landing. Any accepted migration requires shadow comparison and rollback evidence.
- TEST-01: expand acceptance for Track B journeys, bind evidence to exact commits, and retain any untested/blocked external scope. Do not reuse historical coverage percentages as current acceptance.

### B4. External readiness (INT-01..INT-06)

- INT-01 GDS/external NDC/interline: accepted provider/partner adapters and booking/ticket/EMD/settlement identity reconciliation. Demo/local metadata is not external execution acceptance.
- INT-02 APIS/Type B: production transport consumer plus destination authorization, authoritative ACK/reject, retry/lease/idempotency/ambiguous-outcome reconciliation. The existing handler-station harness is synthetic.
- INT-03 BCBP/baggage devices: real print/scan/job receipts and handler handoff; retain `document_ready` until actual confirmation. BCBP generation and local custody/closeout already exist.
- INT-04 ZATCA: approved fiscal classification and accepted signed invoice/authority response integration. The current implementation is internal draft/preview only; no legal certification can be inferred from code tests.
- INT-05 non-Stripe payments: eight HTTP adapters exist but centralized activation is blocked. Accept invoice/session/owner/tenant/amount/currency, authenticated settlement and refund behavior independently for each provider. Do not lift gates based only on credentials or mocks.
- INT-06 DCS load release: accepted aircraft/configuration inputs and operational approval/handoff. Existing approve/finalize path is explicitly simulated; counter DCS functionality is separate.

External contracts, credentials, organizational assignments and physical devices may be unavailable. Complete the source/harness work that is authorized and possible, but report the exact remaining acceptance as BLOCKED or NOT_VERIFIED. Do not manufacture receipt IDs or claim production success.

## Integration and evidence contract

1. Separate branches and focused commits; no force push or deletion of other conversations' branches.
2. Track A owns low-level financial/auth/resource contracts; Track B consumes their final changes.
3. Track B can start read-only inventory, independent consumer UI and provider adapter/harness work now. Delay voucher editor integration, UI-05 refund wiring and shared schema snapshots until Track A APIs are fixed.
4. Coordinate migration IDs before adding migrations. The baseline ends at0067; do not independently reserve the same next number. Regenerate combined snapshots/catalogs only after both source changes are integrated.
5. A regression must assert the intended business/security outcome, with positive and negative controls. A passing witness that expects the old defect does not close it.
6. Record exact command, source commit/tree, results, skips, environment, hashes and owned cleanup. Fixture tests are distinct from native MySQL/HTTP/browser/provider/device acceptance.
7. Audit coverage and counts on fcc32cc are historical. The baseline of this implementation is50a3114; read fresh CI on the final PR head.
8. Do not label a provider or device capability implemented in production merely because code exists or its metadata says implemented.

## Original review evidence

The user has AIS_Forensic_Audit_AR_2026-11-05.pdf, AIS_Forensic_Findings_AR_2026-11-05.xlsx and AIS_Forensic_Evidence_2026-11-05.zip. Their baseline execution evidence isfcc32cc and current-source delta is50a3114. Use the finding IDs and exact source references, not historical aggregate counts, when closing a defect.

## Superseded handoff (historical; do not start a second concurrent implementation)

نفّذ الجزء الثاني فقط من مراجعة AIS في مستودع kafaat/ais-aviation-system وفق وثيقة docs/remediation/2026-11-05-two-track-execution.md. تحقق أولًا من main والطلبات المفتوحة ومن فرع codex/ais-forensic-phase1-20261105 لتجنب التكرار. تتولى الصفحة الأولى الاكتشافات العشرة الجديدة FIN-01 وFIN-02 وOWN-01 وIDENTITY-01..06 وCONS-01. نطاقك هو CONS-02..06 وOPS-06 وUI-05 وUI-07 وCAP-01 وGOV-01 وSSOT-01 وTEST-01 وINT-01..06، مع مراعاة تداخل الأجهزة والسياسات. ابدأ الأعمال المستقلة، واجعل تعديل القسائم وسياسة الاسترداد معتمدين على تغييرات الجزء الأول، ولا تعدّل الملفات المحجوزة له بالتوازي. اجمع عملك في فرع وPR واحد، واثبت كل إغلاق باختبار أو إيصال قبول حقيقي. احتفظ ببوابات المزودين والأجهزة وميّز ما يحتاج مالكًا أو قرار سياسة أو قبولًا خارجيًا، دون اختراع أسماء أو بيانات أو ادعاء اكتمال غير مثبت.
