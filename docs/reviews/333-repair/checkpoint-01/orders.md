# Orders / distribution / agency / corporate fixes

Status: source and focused tests stable; no commit, push, schema change or dependency edit.
Read CLAUDE.md; no nested AGENTS.md found in this checkout.

## Changes

- PRC-01: direct retail offers require the exact passenger-type sequence before positional initial fare attribution. Internal `remapPassengerTypes` opt-in retains multiset comparison only for the existing order-servicing path that actually remaps fare lines by type. NDC count-based behavior unchanged. Regression exercises actual `quotePaidOrderService` with reversed child/adult offer and verifies canonical adult=6000/child=4000 lines.
- DIST-01: NDC AirShopping rejects any supplied returnDate with BAD_REQUEST before database offer writes; it cannot present outbound-only inventory as a return itinerary.
- DIST-02: search SQL excludes departed instances and the returned candidates are rechecked for future departure before offer generation. Read and offer-persistence failures propagate; no broad catch converting infrastructure failure to empty availability.
- AGT-01: search resolves active linked agency owner, verifies active tenant, filters exact owner tenant including strict NULL tenant isolation, future departure and requested cabin availability for the entire party. Defaults remain economy/one passenger. Service boundary rejects invalid count/cabin.
- CORP-01: create/update reject nonfinite, negative and >99.99 discounts before database writes; router maximum changed to 99.99. This stricter representable upper bound prevents decimal(5,2) rounding of 99.999 to 100. Existing approval guard remains. No historical account migration.

## Files owned

Production:

- server/services/retail-offer.service.ts
- server/services/order-servicing.service.ts (one opt-in at remapping call site)
- server/services/ndc.service.ts
- server/services/travel-agent.service.ts
- server/services/corporate.service.ts
- server/routers/corporate.ts

Tests:

- server/**tests**/retail-offer.test.ts
- server/**tests**/order-servicing.test.ts
- server/**tests**/ndc-shopping-boundary.test.ts (new)
- server/services/travel-agent.search-boundary.test.ts (new)
- server/services/corporate-discount-boundary.test.ts (new)

## Verification

Before product edits, focused run: 20 failed / 39 passed across 5 files. Failures were the new PRC, DIST, AGT and invalid discount scenarios; existing servicing/remap behavior passed.
After fixes: 59/59 passed across same 5 files.
Expanded after formatting: 92 passed / 38 skipped, 10 files passed / 2 skipped.
Expanded files add ndc-unpaid-boundary, ndc-capabilities, travel-agent.owner, travel-agent.commission, travel-agent.inventory-atomicity, corporate.service, retail-offer-concurrency-mysql.

The 2 native database suites (corporate.service and retail-offer-concurrency-mysql) skipped because database acceptance environment was unavailable. No native MySQL or actual provider acceptance claimed. New agency tests exercise production SQL predicates through transactionMemory with display-only join fixtures, not MySQL locking. NDC tests use query/persistence boundary doubles; explicit database/read/write failure cases ensure errors propagate. Redis attempted connection and used memory fallback in existing imports.

Scoped eslint: exit 0, empty log. Prettier completed; git diff --check clean.
TypeScript attempt: default tsc --noEmit aborted with V8 heap out-of-memory exit134; no completed typecheck claim. Parent informed to run one serial higher-heap check. No tsc/vitest process left running by this worker.

Logs:

- /tmp/orders-red.log
- /tmp/orders-green.log
- /tmp/orders-expanded.log
- /tmp/orders-lint.log
- /tmp/orders-typecheck.log

## Remaining limits

No current production change or live DB migration. Corporate native acceptance, concurrency and real flight/provider scenarios remain unrun. AGT returnDate handling was outside assigned change; NDC returnDate now explicitly unsupported. Public API response contracts unchanged. Additional central suite may expose consumers relying on the now-refused unsafe behavior.
