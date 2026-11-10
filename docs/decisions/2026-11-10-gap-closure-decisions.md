# Gap-closure decision package — 2026-11-10

Adopted by the repository owner on 2026-11-10 from the recommendation set
prepared the same day. Each decision below separates what the software does,
what an operating policy says, what hardware or an external party must
accept, and what is deferred as product roadmap. The ledgers these decisions
touch are named in each section; no new tracking issue duplicates an existing
one.

| #   | Topic                                     | Decision                                                                             | Ledger effect                                                                                            |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | OPS-06 seat remap under operational block | Option A: permit a compatible remap under the safety conditions in section 1         | OPS-06 verified in `docs/remediation/coverage-closure-ledger.json`; policy text in `dcs-remap-policy.md` |
| 2   | UI-07 bag-tag printer                     | Option B: external hardware acceptance pending, with a named owner role              | OPS row stays partial, classified `EXTERNAL_HARDWARE_ACCEPTANCE_PENDING`; receipt contents fixed         |
| 3   | CAP-01 and the report catalog (#280)      | Hybrid: classify product scope first, then implement in waves                        | `product_scope` dimension added to the catalog; availability counts unchanged at 36/35/28                |
| 4   | #103 staging secrets                      | Option A: authorised operator acts in the Railway dashboard and files an attestation | Attestation template in `docs/operations/staging-secret-attestation.md`; issue stays open until filed    |
| 5   | Password reset                            | Implement as a later product capability, not as a condition of #103                  | Tracked as a feature issue with OWASP-aligned requirements                                               |
| 6   | Multi-currency                            | SAR only for pricing, collection and refund now; design kept extensible              | No code change; `.archive` selector stays archived; prerequisites for a later activation recorded below  |

## 1. OPS-06 — compatible seat remap under operational constraints

**Adopted policy.** A seat remap is permitted when it is compatible with the
flight's, the passenger's and the cabin's constraints, provided that no
existing operational block is removed, and that constraints keep following
their source: a block attached to a seat stays on that seat number (a
defective 12A cannot be "moved" to 14A and 12A released), while a constraint
attached to a passenger's assignment stays with that passenger's seat
identity. The operation is refused when constraints conflict or cannot be
verified.

**Why no code change is needed.** `remapDeskSeats` in
`server/services/dcs-station.service.ts` already implements exactly this
split: a blocked seat keeps its `blocked` status at the same seat number even
if the replacement template calls it available; a template that introduces a
block on a seat that was not blocked, or changes cabin counts, is refused
pending inventory reconciliation; an assigned, held or restricted seat must
keep its cabin, seat type, price, tier and physical features or the whole
transaction rolls back; checked-in seats, active check-in nonces and issued
boarding passes refuse the remap; a repeated command key returns the original
receipt without a second event.

**Evidence on the accepted source** (`main@941f86c`, Production Gates run
42690069061, native MySQL 8.0 and 9.7): the acceptance case "range blocks
roll back on conflict, preserve capacity and survive compatible remap" checks
unchanged seat ownership, cabin and status, unchanged flight availability, the
retained block at its seat number and one event on replay; the refusal matrix
in the same script covers unauthorized staff, foreign tenant, wrong airline,
wrong aircraft, checked-in seat, issued boarding pass, active check-in nonce,
changed protected seat price, changed protected seat feature and an
incompatible operational block, each leaving state untouched.

**Boundary.** The original workbook wording (refuse any remap whenever a block
exists) is superseded by this decision and kept on the ledger row for
traceability. A layout being active in the application still does not certify
aircraft data or a carrier's equipment-change procedure; that acceptance stays
with the accountable carrier or station owner.

## 2. UI-07 — bag-tag reprint on the target printer

Classified `EXTERNAL_HARDWARE_ACCEPTANCE_PENDING`. Owner role: airport
operations or the departure-control provider for the station. The software
side (version-guarded reprint, failure and cancel leaving `unknown`/`failed`,
120-second passenger-data clearance, browser print preview) is covered by
`client/src/pages/__tests__/KioskBagTag.test.tsx` and
`e2e/vrs-kiosk-tags.spec.ts` and is not re-run for this decision.

The acceptance receipt that promotes UI-07 must contain: the printed tag
specimen, margin check against the tag stock, a successful scanner read of the
barcode, a match of the encoded data against the bag and flight record, and
the printer model, driver and settings used. Browser printing or a PDF does
not substitute for any of these.

## 3. CAP-01 and #280 — product scope before promotion

The catalog keeps its 99 definitions and its honest availability flags
(36 available, 35 partial, 28 blocked). A separate `product_scope` dimension
is added to the catalog as a map keyed by report id (the rows themselves stay
identical to the server's report definitions, which the source-truth test
compares exactly) with the values `required` (launch or compliance),
`planned` (a later release), `optional` (deferrable improvement),
`out_of_scope` (excluded by documented product decision) and `unclassified`
(the initial value until the product owner classifies the row). Scope never
changes availability: a `required` partial report is still partial until its
missing source is supplied and its acceptance passes.

First sources to secure, in this order: authoritative sales-office
assignments (report 1), a recorded document-validity deadline and approved
expiry policy (report 10), and accepted GDS receipts linked to a specific
booking, ticket or sector (reports 32 to 34). Estimated or substitute data is
not used in place of an official source. Implementation then proceeds in
small waves ordered by report value and source availability; CAP-01 closes
only when every `required` definition is available and accepted, not when
rows are excluded.

## 4. #103 — staging secrets handled by an authorised operator

The operator completes the work in the Railway dashboard, never through a
conversation, and files the attestation in
`docs/operations/staging-secret-attestation.md` (no values, no digests).
The attestation covers the environment, the running source SHA, the
operator's identity and role, the time, the reference parity between `ais-web`
and `ais-auth`, the credential's strength (at least 32 bytes from a
cryptographically secure generator, not merely 32 characters), the effective
`DEBUG=false` on `ais-auth`, and the revocation of the secrets exposed in the
2 November session. Rotation is coordinated so the boundary stays fail-closed
and no previous fail-open build is restored. The one-shot probe (9/9) and the
synthetic login journey are already proven and are not re-run for this. #103
stays open until the attestation is filed.

## 5. Password reset — later product capability

Implemented in a later release as its own feature, independent of #103.
Requirements: a short-lived single-use token stored hashed, request rate
limits, a uniform response that does not reveal whether an account exists,
session invalidation according to the security policy after the password
changes, and no activation for users before an approved mail channel exists
and the full journey is tested end to end. The present `fixme` in
`e2e/auth.spec.ts` remains the marker until then.

## 6. Multi-currency — SAR only for now

SAR remains the pricing, collection and refund currency in the current scope.
The design keeps display currency, ticketing currency and payment or refund
currency as separate concepts. Activating a display currency later requires an
approved exchange-rate source, a rate fixing moment, rounding and accounting
rules, and acceptance, before any selector is enabled; a numeric conversion in
the user interface is not sufficient. The archived selector under
`.archive/incomplete-features` stays archived.

## Execution order

1. #103 attestation by the operator.
2. OPS-06 recorded as decided (this change).
3. UI-07 owner and CAP-01 scope classification by their owners.
4. Roadmap: password reset, then multi-currency when the market requires it.
