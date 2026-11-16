# Multi-currency: scope, current state and acceptance matrix

Planning record for feature issue #319 under decision 6 of
[2026-11-10](../decisions/2026-11-10-gap-closure-decisions.md) and the owner
addendum of the same day (#319, comment 6775309287). It inventories what the
source already does, names every SAR assumption that a non-SAR journey would
cross, and fixes the acceptance gates per use case. It changes no runtime
behaviour. Until the gates in section 5 pass, the deployed product remains SAR
for pricing, collection and refund, and nothing in the user interface may imply
otherwise.

Source inventoried: `main@b9addba`.

## 1. Four currencies, kept apart

| Concept                          | Meaning                                                                                          | Decided                                                                                                                                         | State on current main                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant base (pricing) currency   | The currency a tenant's fares are expressed in by default for new quotes after an effective date | **YER is the product default**; an authorised tenant administrator may select another currency from the approved, enabled list (owner addendum) | Not configurable. `BASE_CURRENCY = "SAR"` is a constant in `currency.service.ts`; `currencies.isBaseCurrency` flags SAR; `tenants` has no currency column  |
| Accounting (functional) currency | The currency of the legal ledger and statutory reporting, determined per entity under IAS 21     | Separate governed setting; Finance approval; never changed by a pricing-default change                                                          | Implicitly SAR: `financial_ledger.currency` defaults to SAR                                                                                                |
| Display currency                 | An indicative amount shown beside the priced amount                                              | User-selectable where enabled; always labelled an estimate                                                                                      | Implemented as an estimate: `ibePublic.displayRate`, `pricing.router.ts` conversion, `DisplayCurrencyEstimate.tsx`; eleven `DISPLAY_CURRENCIES`            |
| Collection / refund currency     | The currency the provider collects and the original payer is repaid                              | Bound immutably per quote, order, invoice and payment with FX source, version and time                                                          | SAR only. `payments.service.ts` creates sessions in SAR; `payment-settlement.service.ts` rejects any other collected currency; refunds verify SAR receipts |

A price shown in another currency today is an estimate and is labelled as such.
It is never the amount charged. Changing a tenant's default affects new quotes
after its effective date only; existing bookings, invoices, refunds and ledger
entries keep their original currency and amounts.

## 2. What already exists

- `server/services/currency/currency.service.ts`: `SUPPORTED_CURRENCIES` (SAR
  base; USD, EUR, AED, GBP, KWD, BHD, QAR, OMR, EGP), minor-unit conversion that
  respects 3-decimal currencies, versioned rate snapshots with inclusive start
  and exclusive expiry, Redis caching capped at observation expiry, cross-rate
  derivation through the base currency, and labelled fallback estimates that
  are never cached. Since Wave 1 slice A a conversion that produces an amount
  uses observed rates only; the fallback constants label a quote from
  `getExchangeRate` (source `fallback`) and never become an amount. Every
  pricing route also applies the display rule below: `pricing.convertCurrency`
  and `pricing.getExchangeRate` accept an observation only when each leg
  passes it, and `convertPriceForDisplay` uses the display quote itself.
- `exchange_rates` table (`drizzle/schema.ts`): pair, `DECIMAL(18,8)` rate,
  `source`, `validFrom`, `validTo`, and since migration 0079 the provenance of
  an operator quote: `sourceReference`, `recordedBy`, `version` (unique per
  pair) and `supersedesId` (unique). Display quotes are read only from the
  sources `manual`, `bank`, `openexchangerates` and `cby_sanaa`, skip a row
  whose correction has started, and expire after 24 hours
  (`shared/ibe-search.ts`). The operator procedure for recording a verified
  quote is in [ibe-embedding.md](../operations/ibe-embedding.md).
- `server/services/currency/operator-rates.service.ts` and the
  `exchangeRates` router: append-only operator entry with an audit record per
  entry, and the display-rate staleness alarm.
- Tests: `server/__tests__/nonsecurity-currency-contracts.test.ts` (precision,
  validity windows, cache expiry, fallback labelling),
  `server/__tests__/nonsecurity-currency-native-mysql.test.ts` (native DECIMAL
  legs, Redis round trip, malformed metadata), and
  `server/__tests__/new-features/currency.test.ts` (formatting and fallback).
- `currencies` table with per-currency `decimalPlaces` and `isBaseCurrency`;
  `audit_logs` table for recording configuration changes; `tenants` table as
  the isolation boundary.

## 3. Assumptions a non-SAR or YER-default journey would cross

| Area                     | Current behaviour                                                                                                                                                                                                      | Reference                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Base currency            | `BASE_CURRENCY = "SAR"` constant drives cross rates; `currencies.isBaseCurrency` is a global flag; no tenant-level currency setting or audit path exists                                                               | `currency.service.ts`, `drizzle/schema.ts` (`currencies`, `tenants`)                          |
| YER                      | Listed in `DISPLAY_CURRENCIES` but absent from `SUPPORTED_CURRENCIES`; no YER quote is seeded; an operator records the Central Bank of Yemen (Sanaa) rate as source `cby_sanaa`, which feeds the display estimate only | `shared/ibe-search.ts`, `currency.service.ts`, `ibe-embedding.md`                             |
| Rate ingestion           | Operator entry (`exchangeRates.record`); no automatic feed. The `updateExchangeRates` stub is removed; `FALLBACK_RATES` stay module-private labels and never produce an amount                                         | `operator-rates.service.ts`, `currency.service.ts`                                            |
| Quote                    | `pricing.router.ts` converts the SAR final price for display only, with the quote the display estimate would show; base and final prices stay SAR minor units                                                          | `server/routers/pricing.router.ts`                                                            |
| Checkout                 | Stripe session and payment record are created with `currency: "SAR"`                                                                                                                                                   | `server/services/payments.service.ts`                                                         |
| Settlement guard         | Collected amount must equal the persisted purchase and the currency must be SAR                                                                                                                                        | `server/services/payment-settlement.service.ts`                                               |
| Reconciliation           | Falls back to SAR when `paymentCurrency` is empty                                                                                                                                                                      | `server/services/stripe/stripe-reconciliation.service.ts`                                     |
| Exchange and servicing   | Consent and pricing schemas use `z.literal("SAR")`; new amounts are emitted in SAR                                                                                                                                     | `server/services/order-servicing.service.ts`                                                  |
| Refunds                  | Internal refunds require exactly one original SAR funding receipt; ordinary refunds, wallet and ledger entries must be SAR                                                                                             | `internal-refund.service.ts`, `ordinary-refund.service.ts`, `wallet.service.ts`               |
| Ledger                   | `financial_ledger.amount` is `DECIMAL(10,2)` with `currency` defaulting to SAR; a 3-decimal currency cannot be recorded without a schema gate                                                                          | `drizzle/schema.ts`                                                                           |
| Reporting and settlement | Revenue accounting, BSP RET/HOT, coupon review and financial reporting assume SAR                                                                                                                                      | `revenue-accounting.service.ts`, `bsp-reporting.service.ts`, `financial-reporting.service.ts` |
| Alternate providers      | HyperPay and Tamara adapters pass the input currency but default refunds and parts of the flow to SAR; both remain blocked for acceptance                                                                              | `server/services/payment-providers/*.provider.ts`, CLAUDE.md `alternatePayments`              |
| Loyalty                  | Accrual (`MILES_PER_SAR`), liability ledger and wallet funding are SAR-denominated                                                                                                                                     | `loyalty.service.ts`, `loyalty-liability-ledger.service.ts`, `wallet.service.ts`              |
| User interface           | The old selector is archived under `.archive/incomplete-features`; the retired `e2e/currency.spec.ts` targeted it                                                                                                      | decision record, section 6                                                                    |

## 4. Roles and approval authority

Roles are functional positions, as airlines and passenger-service-system
providers assign them; they are not the engineers or agents who execute the
work. AI agents may analyse, implement, test and prepare evidence; they never
hold approval authority for a financial policy or a regulatory commitment.
Names are assigned by the owner outside this file. A wave does not start until
its accountable role has a named person. One person may hold several roles
provided approval of a sensitive financial change stays separate from its
implementation and from its independent acceptance.

| Role in #319                  | Usual functional position                                                      | Responsibility                                                               | Assignee        |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------- |
| Product owner                 | Head of Product, or head of digital commerce and reservations                  | Currencies, markets and use cases per wave; go/no-go per wave; approves G1   | owner (interim) |
| Finance / Revenue Accounting  | CFO, delegating detail to the revenue-accounting manager or treasury           | Functional currency, FX source, rate fixing, rounding, settlement; G3 and G4 | owner (interim) |
| Payments engineering          | Payments engineering lead                                                      | Collection, refund, settlement and provider integration changes              | owner (interim) |
| Pricing / Booking engineering | Reservations and pricing engineering lead, with the revenue-management manager | Quote fixing, invoice currency, fare components, taxes and fees              | owner (interim) |
| Tax / Compliance              | Head of compliance, or legal and tax                                           | Per-currency tax, fee, contractual and regulatory requirements               | owner (interim) |
| QA                            | QA manager or independent test lead                                            | Native MySQL acceptance, browser journeys, negative and concurrency suites   | owner (interim) |
| Provider relationship         | Financial-partnerships or payment-gateway relationship manager                 | Stripe, bank and provider agreements; proof of support per currency          | owner (interim) |

**Interim assignment (owner decision, 2026-11-15, [#319](https://github.com/kafaat/ais-aviation-system/issues/319#issuecomment-6898362414)).** The
repository owner holds every role above and approves G1 to G10 until named
persons are assigned. Implementation stays with the engineering sessions and
independent acceptance with the lab, so approval stays separate from both.

Smaller initial structure, acceptable while no external airline is onboarded:
product owner or project manager (product and scope), authorised finance
officer (accounting, treasury, FX policy), CTO or tech lead (payments, pricing
and booking engineering), independent QA, and a compliance and partnerships
adviser. The separation above still applies.

Approval authority per gate (A approves, R executes):

| Gate | A                                                 | R                                                 |
| ---- | ------------------------------------------------- | ------------------------------------------------- |
| G1   | Product owner                                     | Product owner with the revenue-management manager |
| G2   | Treasury / Finance                                | FX integration engineer                           |
| G3   | Finance or treasury manager                       | Pricing / Booking engineering                     |
| G4   | Revenue-accounting manager / financial controller | Accounting and database engineer                  |
| G5   | Financial controller                              | Payments and accounting engineering               |
| G6   | Finance with Compliance                           | Accounting, pricing and reporting engineering     |
| G7   | Payments or financial-partnerships manager        | Payments engineering with the provider            |
| G8   | QA manager                                        | QA engineers                                      |
| G9   | Compliance manager                                | Legal, tax and provider relationship              |
| G10  | Product owner with Finance                        | Platform engineering                              |

Who may do what in the product once the waves ship:

| Action                                       | Permitted actor                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| Choose a display currency                    | Any user, from the enabled list                                                |
| Change a tenant's default pricing currency   | Authorised tenant administrator, from the approved list, with effective date   |
| Approve the currencies that may be collected | Product owner with Finance and the provider                                    |
| Approve FX sources and rates                 | Treasury or the authorised finance officer                                     |
| Change the accounting functional currency    | Approved finance officer, by a separate reviewed procedure                     |
| Enable payment in a new currency             | Only after payments engineering, Finance, Compliance and QA acceptance (G5–G9) |

## 5. Acceptance matrix

Each gate needs the listed evidence before the wave that depends on it may
ship. "Existing" names evidence already on main; everything else is open.

| #   | Gate                                                                                                                                                                                 | Required evidence                                                                                                 | Existing                                                                                                                                                                           | Needed by |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| G1  | Approved list of currencies and use cases (display, booking, collection, refund) with the first-wave subset. **Partially decided:** YER default and administrator-selectable base    | Signed product decision referenced from #319 naming the allowed choices, markets and first transaction currencies | Owner addendum on #319                                                                                                                                                             | Wave 0    |
| G2  | Authoritative FX source with timestamp and version per rate; contract for ingestion, staleness and outage; a YER reference-rate policy if YER is priced                              | Named provider or bank feed, contract, ingestion test against a recorded fixture, staleness alarm                 | Display path (Wave 1 slice A): audited operator quotes with actor, version, source, reference and validity; append-only corrections; staleness alarm; fallback kept out of amounts | Wave 1    |
| G3  | Rate-fixing policy: the moment a rate is locked, how long it holds, what happens on expiry mid-journey                                                                               | Written policy signed by Finance; tests that a locked quote survives a rate change and expires correctly          | Quote `validUntil` in pricing; no lock tied to a rate snapshot                                                                                                                     | Wave 2    |
| G4  | ISO 4217 minor units and rounding per currency, including 0- and 3-decimal cases; accounting treatment of rounding                                                                   | Rule document; unit tests per currency; schema change for `financial_ledger` precision                            | `toMinorUnits`/`fromMinorUnits`; KWD 3-decimal test                                                                                                                                | Wave 2    |
| G5  | Invariants: collected currency and amount equal the invoice; refunds return the original currency to the original payer; the ledger never converts silently                          | Native MySQL acceptance cases per invariant; replay and idempotency cases                                         | SAR-only versions in settlement, refund and ledger tests                                                                                                                           | Wave 3    |
| G6  | Fee and tax handling per currency; revenue accounting, BSP RET/HOT and reports consistent                                                                                            | Fixture-based report comparison per currency; Finance sign-off                                                    | SAR fixtures only                                                                                                                                                                  | Wave 3    |
| G7  | Provider acceptance per settlement currency: Stripe sandbox contracts extended; partial refund and chargeback paths                                                                  | `stripe-sandbox-evidence` artifact with the non-SAR contracts; dispute path recorded                              | Seven SAR contracts in the manual workflow (see provider acceptance)                                                                                                               | Wave 3    |
| G8  | Negative, concurrency and tenant tests; browser journey for the real selector replacing the retired spec                                                                             | Vitest and Playwright suites green on native MySQL in CI                                                          | Currency contract and native tests for the rate layer; native operator-entry, permission, YER display and alarm tests; fallback guard                                              | each wave |
| G9  | Regulatory and merchant-agreement confirmation for each non-SAR settlement currency                                                                                                  | Written confirmation held by Compliance; referenced, not committed                                                | none                                                                                                                                                                               | Wave 3    |
| G10 | Tenant base-currency setting: tenant-scoped, permission-checked, audited (actor, time, version, effective-from), validated against the approved list; never retroactive; YER default | Schema and service design review; native tests for cross-tenant rejection, audit event and unchanged history      | `tenants` isolation and `audit_logs` table; no currency setting yet                                                                                                                | Wave 2    |

## 6. Proposals and adopted defaults

These were prepared for the approvers named in section 4. On 14 November 2026
the repository owner adopted ADR 0002 and the G3 and G4 policy below as
working defaults ([#327, decision 4](https://github.com/kafaat/ais-aviation-system/issues/327#issuecomment-6880288729)); on 15 November 2026 the
owner chose the G1 first wave below ([#319](https://github.com/kafaat/ais-aviation-system/issues/319#issuecomment-6898362414)). Finance may amend the defaults once its role in section 4 is
named, and until then later waves build to them.

**G1, first-wave scope. Decided 2026-11-15: USD, EUR and AED are the first transaction currencies, as below.** Start with a subset rather
than all ten listed currencies.

| Currency      | Proposed first-wave scope                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YER           | Product default base per the owner addendum. Pricing or collecting in YER needs an approved YER FX reference policy (G2), a provider that settles YER (G7) and its inclusion in `SUPPORTED_CURRENCIES`; none exists today |
| SAR           | Current deployed pricing, collection and accounting currency; stays enabled                                                                                                                                               |
| USD, EUR, AED | First transaction currencies for display, booking, collection and full refund                                                                                                                                             |
| GBP, QAR, EGP | Display estimate only until their sale scope is approved                                                                                                                                                                  |
| KWD, BHD, OMR | Display estimate only; collection deferred until the ledger 3-decimal gate (G4) is closed                                                                                                                                 |

This is a product proposal, not evidence that any provider accepts these
currencies. All actual sales stay SAR until G2 to G9 pass for each currency.

**G3 and G4, financial policy. Adopted as working defaults on 2026-11-14.**

| Decision                         | Proposed policy                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rate fixing                      | At creation of a binding quote, before payment                                                                     |
| Lock duration                    | 15 minutes                                                                                                         |
| Quote expiry                     | A new quote and a new rate before payment starts                                                                   |
| Payment authorised before expiry | Keep the original rate and amount; verify the payment notification even if it arrives later                        |
| FX source unavailable            | Stop issuing new quotes in the affected currency; never use hard-coded fallback rates                              |
| Rounding                         | Exact decimal arithmetic; round at approved accounting boundaries to the currency's minor unit                     |
| Rounding mode                    | ROUND_HALF_UP for commercial amounts; any applicable tax or contractual rule takes precedence                      |
| Ledger                           | Store the original currency and amount; record the accounting-currency equivalent and the reference rate alongside |
| Refunds                          | Return the amount due in the original collected currency to the original payment method, per refund policy         |
| 3-decimal currencies             | Not enabled before an approved, tested migration of `financial_ledger` precision                                   |

Engineering recommendation: represent amounts as integer minor units with the
currency code and its exponent. The final schema and the migration of existing
rows need independent review; the current `DECIMAL(10,2)` column is not to be
converted in place without a migration plan and financial tests.

## 7. Delivery waves

**Wave 0, planning (no runtime change).** Close G1 (allowed choices, markets,
first transaction currencies); name the owners in section 4; Finance approves
or amends the G3 and G4 proposals; decide the YER FX reference policy. Exit:
#319 links the signed decisions and this file is updated.

Status on 14 November 2026:

| Wave 0 item                       | State                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR 0002                          | Accepted by the owner                                                                                                                                                                                                                                                                                                    |
| G3 rate fixing, G4 rounding       | Adopted as working defaults (section 6 table); Finance may amend once named                                                                                                                                                                                                                                              |
| YER FX reference policy (G2)      | **Decided 2026-11-15:** the official rate of the Central Bank of Yemen in Sanaa, entered manually by an authorised operator with an audit record (actor, time, source, rate, validity) ([#319](https://github.com/kafaat/ais-aviation-system/issues/319#issuecomment-6898362414)); staleness rule and contract test open |
| G1 first-wave currencies, markets | **Decided 2026-11-15:** USD, EUR and AED first; SAR stays; YER is the display base, and selling in YER waits for a provider that settles it (G7)                                                                                                                                                                         |
| Named persons for section 4 roles | **Decided 2026-11-15:** the repository owner holds every role in the interim                                                                                                                                                                                                                                             |

**Wave 0 is closed** (15 November 2026). Wave 1 starts after #365 merges, as
the owner chose: operator-entered rates with provenance, a staleness alarm,
and fallback constants kept out of any amount a user can act on. The
deployed product stays SAR for pricing, collection and refund.

**Wave 1, trustworthy display currency.** Replace the stubbed
`updateExchangeRates` with the G2 ingestion, record provenance on every row,
alarm on staleness, and keep fallback constants out of any amount a user can
act on. Exit: G2 and G8 for the display path; the estimate label stays.

Status on 16 November 2026:

| Wave 1 item                              | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slice A: operator entry and API          | **Done.** `exchangeRates.record` (platform `adminProcedure`: the table is deployment-wide, so tenant finance, ops and airline administrators are refused) writes an append-only row with actor, version, source, reference and validity, and its audit record in the same transaction; `exchangeRates.history` lists a pair's versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Slice A: YER display                     | **Done.** A current `cby_sanaa` quote makes the display estimate show YER, still labelled an estimate; without one nothing is shown for YER. YER stays outside `SUPPORTED_CURRENCIES`, so nothing prices, collects or refunds in YER                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Slice A: staleness alarm                 | **Done** as a producer on the shared operational alert transition (`operations_alerts` and its on-call dispatch): key `fx-display-rate:SAR_<code>` for each display pair an operator maintains, raised when it has no current quote or only one observed 24 hours ago or earlier. A pair is maintained once at least one quote has been recorded through `exchangeRates.record` (a row with its provenance); a pair never entered through it raises nothing (it displays nothing unless a legacy SQL row is still current, a slice B item), and an alert left active for it is resolved. A maintained pair needs an entry at least daily, because the display uses a quote for 24 hours. The worker job `displayRateAlarms` evaluates it every ten minutes under the scheduled-task lease; it also runs after every entry and on `exchangeRates.refreshAlarms` |
| Slice A: fallback guard                  | **Done.** Conversions that produce an amount refuse without an observed rate. `pricing.calculate`, `getPriceRange` and `getForecast` convert a price only with the quote the display estimate would show (approved source, current, not superseded, observed less than 24 hours ago) and otherwise answer `PRECONDITION_FAILED`; SAR requests are unchanged. A test finds money-path modules by a documented path rule (refund, payment, settlement, ledger, pricing, quote, checkout, order servicing, loyalty, wallet, revenue, BSP, cancellation and more) and keeps them out of the currency module's import graph; only an explicit allow-list of display-only modules imports it                                                                                                                                                                         |
| Slice A: remaining conversion paths      | **Done** (fix round 2 after the lab receipt for #378). `pricing.convertCurrency` and `pricing.getExchangeRate` apply the same display rule to every observed leg, also when it comes from Redis. Without such a quote `convertCurrency` answers `PRECONDITION_FAILED` (it answered `BAD_REQUEST` before) and `getExchangeRate` the labelled estimate (source `fallback` or `cross_rate_fallback`), never the stale or unapproved rate. `convertPriceForDisplay` uses the display quote itself. SAR responses are unchanged                                                                                                                                                                                                                                                                                                                                     |
| Slice B: operator form                   | Pending: an admin UI over `exchangeRates.record` and `exchangeRates.history`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Slice B: provenance required for display | Pending. Accepted for slice A: a row without provenance (written before migration 0079, or directly in SQL) still displays while it is current, at most 24 hours, because the browser fixture `e2e/fixtures/ibe-mobile.ts` writes such rows. Such a row does not make its pair maintained, so it raises no alarm. Slice B moves that fixture to `exchangeRates.record`, then makes the display require a row with provenance                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Rows without provenance are not given any: nothing is backfilled or inferred.
The documented procedure is the operator entry above. Entry refuses, with
`BAD_REQUEST`, a validity outside the MySQL `TIMESTAMP` range, a window longer
than 31 days (a manually entered reference rate is re-entered at least
monthly), and a rate that is not a positive decimal fitting `DECIMAL(18,8)`.

**Wave 2, tenant base currency and booking currency.** Add the tenant-scoped
base-currency setting with YER as the product default and an audited,
effective-dated change procedure (G10); lock a quote to a rate snapshot; carry
the invoice currency through fare components, taxes and fees; generalise the
`z.literal("SAR")` schemas to the approved list. No collection changes yet: a
non-SAR invoice is not sold until Wave 3. Exit: G3, G4, G8, G10.

**Wave 3, collection and refund.** Present the invoice currency to the
provider, generalise the settlement guard to "collected equals invoiced",
return refunds in the original currency to the original payer, record the
ledger in the invoice currency with the accounting equivalent, and extend
reconciliation, revenue accounting and BSP outputs. Exit: G5 to G9 for each
enabled currency; CLAUDE.md, provider acceptance and the decision record are
updated only then.

Alternate providers (HyperPay, Tamara) are out of these waves until their own
acceptance row in CLAUDE.md changes.

## 8. Rules that hold throughout

- No cosmetic selector: a currency control appears only when the amount it
  shows is the amount that will be charged or is clearly labelled an estimate.
- The archived selector is not revived; a new journey is written against the
  shipped feature and tested end to end.
- No fallback constant decides money. Fallback rates may label an estimate; they
  never price, collect or refund.
- A default change is never retroactive: no past booking, ticket, invoice,
  refund or ledger entry changes value or currency. Reverting a default does
  not convert old transactions and does not relax fail-closed authentication.
- Tenant isolation: a currency setting of one tenant is never applied to, or
  readable by, another tenant.
- Every wave ships behind its gates, with the evidence linked from #319.
