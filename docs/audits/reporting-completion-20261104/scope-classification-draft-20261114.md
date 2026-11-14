# Product scope classification: draft for owner review (2026-11-14)

**This is a draft, not a decision.** It proposes a `product_scope` value for each of the 99 catalog reports so the product owner can approve or edit it (#280, CAP-01). `catalog.json` is unchanged. Every `product_scope` value there is still `unclassified`, and availability stays at 36 available, 35 partial and 28 blocked. Under decision 3 of `docs/decisions/2026-11-10-gap-closure-decisions.md`, scope never changes availability: a `required` partial or blocked report stays partial or blocked until its source is supplied and accepted. The catalog changes only after the owner and the owner session approve, in a separate change.

The per-report proposal is in [`scope-classification-draft-20261114.json`](scope-classification-draft-20261114.json). Each entry has the report's id, title and current status, the proposed scope, a one-sentence rationale, the missing source or owner (partial and blocked reports only) and a confidence level.

## How the values were applied

- **required**: needed now by booking, DCS, payments, refunds, loyalty or reporting, by compliance, or by the approved multi-currency work.
- **planned**: waits for a module or integration that the improvement plan or the decision record already names (modules 1, 2 and 9, a contracted GDS, a ground handler's ETL).
- **optional**: a variant of another report, a convenience lookup, or a refinement with no control function.
- **out_of_scope**: needs a capability the product does not have and no plan names. It takes effect only if the owner records the exclusion.

Owner decisions of 14 November 2026 that affect this draft: multi-currency (#319) goes ahead, so Currencies (4) is `required`, and the missing sale-currency snapshot of Product Sales (63) is part of why that report is `required`. Deferring UI-07 changes no row, because no report depends on the physical bag-tag printer or scanner. The draft assumes SAR-only staging that sells direct, with no contracted GDS and no interline partner (`docs/operations/provider-acceptance.md`, improvement plan section 5).

## Summary: proposed scope by current status

| Proposed scope | available | partial | blocked |  Total |
| -------------- | --------: | ------: | ------: | -----: |
| required       |        29 |      24 |       2 |     55 |
| planned        |         0 |       1 |      16 |     17 |
| optional       |         7 |      10 |       5 |     22 |
| out_of_scope   |         0 |       0 |       5 |      5 |
| **Total**      |    **36** |  **35** |  **28** | **99** |

Confidence: 31 high, 59 medium, 9 low.

| Proposed scope   | Report ids                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| required (55)    | 1, 2, 3, 4, 5, 6, 8, 9, 10, 14, 15, 16, 17, 23, 26, 27, 28, 29, 30, 31, 43, 44, 45, 48, 49, 53, 54, 55, 56, 57, 59, 60, 63, 64, 67, 68, 70, 72, 73, 75, 77, 78, 81, 83, 84, 85, 86, 88, 89, 90, 92, 93, 94, 95, 96 |
| planned (17)     | 7, 21, 24, 32, 33, 34, 35, 36, 37, 41, 50, 51, 65, 66, 69, 87, 99                                                                                                                                                  |
| optional (22)    | 11, 12, 18, 19, 20, 22, 25, 42, 46, 52, 58, 61, 62, 71, 74, 76, 79, 80, 82, 91, 97, 98                                                                                                                             |
| out_of_scope (5) | 13, 38, 39, 40, 47                                                                                                                                                                                                 |

## Look at these first: low confidence

| Id    | Report                                 | Status  | Proposed     | Alternative | What decides it                                                                                                                                                      |
| ----- | -------------------------------------- | ------- | ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32–34 | GDS Bookings, Etickets, ID             | blocked | planned      | required    | Is GDS a launch sales channel? Decision 3 names these receipts as a first source to secure, but no GDS provider is contracted. Reports 35–37 follow the same answer. |
| 38–40 | Interline Etickets, IDEC Files, Values | blocked | out_of_scope | planned     | Is an interline agreement expected? No partner exists, and the improvement plan names no interline module.                                                           |
| 47    | Migration Report                       | blocked | out_of_scope | planned     | Does go-live include a cutover of live bookings from a legacy system?                                                                                                |
| 56    | PNL (Passenger Name List)              | partial | required     | planned     | Will any go-live station run departure control outside AIS? Report 57 follows the same answer.                                                                       |
| 88    | Tax Codes                              | blocked | required     | planned     | Is an approved tax-code registry a launch condition, or does it wait for the tax-line module (module 5, wave B)?                                                     |

## What `required` commits to

As drafted, 26 `required` reports are partial or blocked today, and CAP-01 closes only when each of them is available and accepted. Eleven of them depend on one or more of three shared sources:

- **Revenue recognition policy (Finance/Revenue Accounting):** 67, 75, 77, 78, 81, 83.
- **Production acceptance of the coupon uplift source:** 43, 81, 95.
- **Sales and issuing office entity (module 2):** 1, 28, 67, 68, 83. With these marked `required`, module 2 becomes a condition for closing CAP-01 unless the owner moves them to `planned`.

The other 15 each have their own source, named in the JSON: 8, 9, 10, 56, 59, 60, 63, 70, 85, 86, 88, 89, 90, 94 and 96.
