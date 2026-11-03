# Monthly cash report read model

This change replaces two conflicting monthly projections with one read model. Both `generateReport` and `getReports` build from `getFinancialDays` and `aggregateFinancialMonths`.

## Semantic contract

- `totalRevenue` is preserved solely as a compatibility alias of **cash collected**; it is not earned revenue.
- `collectedAmount` and `refundAmount` use booking-bound ledger events by their transaction epoch-day; `netCollectedAmount` may be negative on refund-only months.
- `billedAmount` is the **booking-created total** from the existing daily financial source (not necessarily issued invoices or paid bookings).
- `nonCashFundedAmount` and `nonCashRefundedAmount` are shown separately from cash; wallet top-ups without booking IDs are excluded by the existing read source.
- `recognizedRevenue`, `deferredRevenue` and `ancillaryRevenue` are `null` without verified recognition evidence; no zero placeholders or inference from current flight status.
- `persisted=false` and `status=draft`: these are live computed views, not previously saved or certified reports.
- `sourceBasis=booking_created_and_ledger_posted_epoch_day` distinguishes booking creation from ledger posting buckets; all amounts are SAR minor units.

## Evidence and boundaries

- Regression tests cover booking-created vs cash-posted dates, refund-only months, partial refund, noncash separation and unknown accounting recognition.
- A database query failure must remain an error, never a fabricated empty month.
- Before operational acceptance, test native MySQL month boundaries and session time zone, account/tenant scope, repeatable-read snapshot, and large-ledger performance. Tests using mocked daily rows do not prove these properties.
- `getFinancialDays` groups via `UNIX_TIMESTAMP`; verify the database session zone before interpreting epoch buckets as UTC. No claim of production timezone certification is made.
- The daily query has a 50,000-bucket limit. The unbounded monthly list currently aggregates available history; production-size load acceptance is separate.
- No schema migration, payments, provider booking, deployment or revenue-recognition rule is introduced.

## Compatibility impact

Clients of the two report endpoints must handle nullable recognition fields; the Admin UI now says 'Not verified'. The legacy `totalRevenue` name remains for older clients but cash is labeled explicitly in the UI.

## Dashboard and upcoming bookings

The admin dashboard uses the same recognition boundary as the monthly view. Its
`totalRevenue` and `netRevenue` compatibility fields are booking-bound cash
collected and cash net of refunds. The recognized, deferred and ancillary
revenue fields are nullable. A completed flight, a paid future itinerary or
an active ancillary alone supplies no verified monetary recognition or
deferral.

The legacy `getDeferredRevenue` route returns `total: null` and preserves
its booking list. `upcomingBookingGross` is the sum of gross confirmed, paid
booking totals whose primary flight is still scheduled or delayed and has a
future departure. It is not a liability allocation per passenger or coupon.
Consumers of either route must render null as unavailable.

The route, cabin, and sales-channel breakdowns remain booking-value
projections. The active add-on breakdown is booked ancillary gross. Neither
allocates consideration to fulfilled sectors. For loyalty, `syncBookingMiles`
and its accrual/lot records track points on posted funding and subsequent
refunds. A points balance or redemption credit is not the monetary liability
at month end. That valuation requires an approved policy and financial
evidence; no amount or breakage rate is inferred by this report.
