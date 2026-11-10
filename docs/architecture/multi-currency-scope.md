# Multi-currency: scope, current state and acceptance matrix

Planning record for feature issue #319 under decision 6 of
[2026-11-10](../decisions/2026-11-10-gap-closure-decisions.md). It inventories
what the source already does, names every SAR assumption that a non-SAR
journey would cross, and fixes the acceptance gates per use case. It changes no
runtime behaviour. Until the gates in section 5 pass, the deployed product
remains SAR for pricing, collection and refund, and nothing in the user
interface may imply otherwise.

Source inventoried: `main@1c29db1`.

## 1. Three currencies, kept apart

| Concept                      | Meaning                                                             | State on current main                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display currency             | An indicative amount shown beside the SAR price                     | Implemented as an estimate: `ibePublic.displayRate`, `pricing.router.ts` conversion, `DisplayCurrencyEstimate.tsx`; eleven `DISPLAY_CURRENCIES`            |
| Ticketing / booking currency | The currency the fare, taxes and invoice are expressed and fixed in | SAR only. Fare components, invoices, order servicing and exchange consent accept `SAR` literally                                                           |
| Collection / refund currency | The currency the provider collects and the original payer is repaid | SAR only. `payments.service.ts` creates sessions in SAR; `payment-settlement.service.ts` rejects any other collected currency; refunds verify SAR receipts |

A price shown in another currency today is an estimate and is labelled as such.
It is never the amount charged.

## 2. What already exists

- `server/services/currency/currency.service.ts`: `SUPPORTED_CURRENCIES` (SAR
  base; USD, EUR, AED, GBP, KWD, BHD, QAR, OMR, EGP), minor-unit conversion that
  respects 3-decimal currencies, versioned rate snapshots with inclusive start
  and exclusive expiry, Redis caching capped at observation expiry, cross-rate
  derivation, and labelled fallback estimates that are never cached.
- `exchange_rates` table (`drizzle/schema.ts`): pair, `DECIMAL(18,8)` rate,
  `source`, `validFrom`, `validTo`. Display quotes are read only from the
  sources `manual`, `bank` and `openexchangerates` and expire after 24 hours
  (`shared/ibe-search.ts`). The operator procedure for recording a verified
  quote is in [ibe-embedding.md](../operations/ibe-embedding.md).
- Tests: `server/__tests__/nonsecurity-currency-contracts.test.ts` (precision,
  validity windows, cache expiry, fallback labelling),
  `server/__tests__/nonsecurity-currency-native-mysql.test.ts` (native DECIMAL
  legs, Redis round trip, malformed metadata), and
  `server/__tests__/new-features/currency.test.ts` (formatting and fallback).
- `currencies` table with per-currency `decimalPlaces` and `isBaseCurrency`.

## 3. SAR assumptions a non-SAR journey would cross

| Area                     | Current behaviour                                                                                                                             | Reference                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rate ingestion           | `updateExchangeRates` is a stub: the database write is commented out and `FALLBACK_RATES` are hard-coded constants                            | `currency.service.ts`, `updateExchangeRates`                                                  |
| Quote                    | `pricing.router.ts` converts the SAR final price for display only; base and final prices stay SAR minor units                                 | `server/routers/pricing.router.ts`                                                            |
| Checkout                 | Stripe session and payment record are created with `currency: "SAR"`                                                                          | `server/services/payments.service.ts`                                                         |
| Settlement guard         | Collected amount must equal the persisted purchase and the currency must be SAR                                                               | `server/services/payment-settlement.service.ts`                                               |
| Reconciliation           | Falls back to SAR when `paymentCurrency` is empty                                                                                             | `server/services/stripe/stripe-reconciliation.service.ts`                                     |
| Exchange and servicing   | Consent and pricing schemas use `z.literal("SAR")`; new amounts are emitted in SAR                                                            | `server/services/order-servicing.service.ts`                                                  |
| Refunds                  | Internal refunds require exactly one original SAR funding receipt; wallet and ledger entries must be SAR                                      | `server/services/internal-refund.service.ts`, `ordinary-refund.service.ts`                    |
| Ledger                   | `financial_ledger.amount` is `DECIMAL(10,2)` with `currency` defaulting to SAR; a 3-decimal currency cannot be recorded without a schema gate | `drizzle/schema.ts`                                                                           |
| Reporting and settlement | Revenue accounting, BSP RET/HOT, coupon review and financial reporting assume SAR                                                             | `revenue-accounting.service.ts`, `bsp-reporting.service.ts`, `financial-reporting.service.ts` |
| Alternate providers      | HyperPay and Tamara adapters pass the input currency but default refunds and parts of the flow to SAR; both remain blocked for acceptance     | `server/services/payment-providers/*.provider.ts`, CLAUDE.md `alternatePayments`              |
| Loyalty                  | Accrual, liability ledger and wallet funding are SAR-denominated                                                                              | `loyalty.service.ts`, `loyalty-liability-ledger.service.ts`, `wallet.service.ts`              |
| User interface           | The old selector is archived under `.archive/incomplete-features`; the retired `e2e/currency.spec.ts` targeted it                             | decision record, section 6                                                                    |

## 4. Owner roles

Names are assigned by the owner outside this file; the roles come from decision
D6. A wave does not start until its accountable role has a named person.

| Role                                   | Responsibility                                                               | Assignee   |
| -------------------------------------- | ---------------------------------------------------------------------------- | ---------- |
| Product owner                          | Approved currency list and use cases per wave; go/no-go per wave             | unassigned |
| Finance / Revenue Accounting           | FX source, rate-fixing policy, rounding and accounting rules, reconciliation | unassigned |
| Payments engineering                   | Checkout, settlement, refund and reconciliation changes; provider contracts  | unassigned |
| Pricing / Booking engineering          | Quote fixing, invoice currency, fare components, taxes and fees              | unassigned |
| Tax / Compliance                       | Per-currency tax and fee rules; merchant and regulatory requirements         | unassigned |
| QA                                     | Native MySQL acceptance, browser journeys, negative and concurrency suites   | unassigned |
| Provider relationship (Stripe, others) | Sandbox and production acceptance per settlement currency                    | unassigned |

## 5. Acceptance matrix

Each gate needs the listed evidence before the wave that depends on it may
ship. "Existing" names evidence already on main; everything else is open.

| #   | Gate                                                                                                                                                        | Required evidence                                                                                        | Existing                                                             | Needed by |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------- |
| G1  | Approved list of currencies and use cases (display, booking, collection, refund) with the first-wave subset                                                 | Signed product decision referenced from #319                                                             | none                                                                 | Wave 0    |
| G2  | Authoritative FX source with timestamp and version per rate; contract for ingestion, staleness and outage                                                   | Named provider or bank feed, contract, ingestion test against a recorded fixture, staleness alarm        | Table and validity-window logic; operator-entered quotes             | Wave 1    |
| G3  | Rate-fixing policy: the moment a rate is locked, how long it holds, what happens on expiry mid-journey                                                      | Written policy signed by Finance; tests that a locked quote survives a rate change and expires correctly | Quote `validUntil` in pricing; no lock tied to a rate snapshot       | Wave 2    |
| G4  | ISO 4217 minor units and rounding per currency, including 0- and 3-decimal cases; accounting treatment of rounding                                          | Rule document; unit tests per currency; schema change for `financial_ledger` precision                   | `toMinorUnits`/`fromMinorUnits`; KWD 3-decimal test                  | Wave 2    |
| G5  | Invariants: collected currency and amount equal the invoice; refunds return the original currency to the original payer; the ledger never converts silently | Native MySQL acceptance cases per invariant; replay and idempotency cases                                | SAR-only versions in settlement, refund and ledger tests             | Wave 3    |
| G6  | Fee and tax handling per currency; revenue accounting, BSP RET/HOT and reports consistent                                                                   | Fixture-based report comparison per currency; Finance sign-off                                           | SAR fixtures only                                                    | Wave 3    |
| G7  | Provider acceptance per settlement currency: Stripe sandbox contracts extended; partial refund and chargeback paths                                         | `stripe-sandbox-evidence` artifact with the non-SAR contracts; dispute path recorded                     | Seven SAR contracts in the manual workflow (see provider acceptance) | Wave 3    |
| G8  | Negative, concurrency and tenant tests; browser journey for the real selector replacing the retired spec                                                    | Vitest and Playwright suites green on native MySQL in CI                                                 | Currency contract and native tests for the rate layer                | each wave |
| G9  | Regulatory and merchant-agreement confirmation for each non-SAR settlement currency                                                                         | Written confirmation held by Compliance; referenced, not committed                                       | none                                                                 | Wave 3    |

## 6. Delivery waves

**Wave 0, planning (no runtime change).** Close G1; name the owners in
section 4; draft the G3 and G4 policies; decide whether YER stays display-only.
Exit: #319 links the signed decisions and this file is updated.

**Wave 1, trustworthy display currency.** Replace the stubbed
`updateExchangeRates` with the G2 ingestion, record provenance on every row,
alarm on staleness, and keep fallback constants out of any amount a user can
act on. Exit: G2 and G8 for the display path; the estimate label stays.

**Wave 2, booking and ticketing currency.** Lock a quote to a rate snapshot,
carry the invoice currency through fare components, taxes and fees, and
generalise the `z.literal("SAR")` schemas to the approved list. No collection
changes yet: a non-SAR invoice is not sold until Wave 3. Exit: G3, G4, G8.

**Wave 3, collection and refund.** Present the invoice currency to the
provider, generalise the settlement guard to "collected equals invoiced",
return refunds in the original currency to the original payer, record the
ledger in the invoice currency, and extend reconciliation, revenue accounting
and BSP outputs. Exit: G5 to G9 for each enabled currency; CLAUDE.md,
provider acceptance and the decision record are updated only then.

Alternate providers (HyperPay, Tamara) are out of these waves until their own
acceptance row in CLAUDE.md changes.

## 7. Rules that hold throughout

- No cosmetic selector: a currency control appears only when the amount it
  shows is the amount that will be charged or is clearly labelled an estimate.
- The archived selector is not revived; a new journey is written against the
  shipped feature and tested end to end.
- No fallback constant decides money. Fallback rates may label an estimate; they
  never price, collect or refund.
- Every wave ships behind its gates, with the evidence linked from #319.
