# Aviation research implementation series

Base: `3161c036b221f0d2e3610c3d6430609b0f5605bb` (`v1.22.11`).
Apply the numbered patches in order. Production migrations and partner acceptance are separate deployment steps; no production connection is used to produce this series.

## 01 — Financial read definitions

Owner: `financial-reporting.service`; consumers: Analytics KPI/daily collections and Warehouse revenue exports. Uses the existing `financial_ledger`, including booking wallet spending and each settled split payer. Wallet top-ups are excluded to prevent counting funding twice. Refunds use posted amounts and posting dates, including partial and refund-only days. Booking invoice amounts use creation dates and remain separate. All values are SAR minor units; UTC dates are independent of the database session timezone.

`totalRevenue`/daily `revenue` remain compatibility aliases for **net collections**; dashboard labels have changed. Revenue exports now expose explicit billed, collected, refunded and net-collected columns; `earnedRevenue` is empty/unknown, never inferred from payment or flight status. Consumers of the previous revenue-export layout must update their mappings. Incremental invoice timestamps are rejected for settlement exports. Booking-origin/popularity and ancillary metrics elsewhere still describe invoiced amounts; they must not be interpreted as cash or recognition.

Paid/refunded legacy bookings without a booking charge, and unclassified adjustment entries, appear as reconciliation gaps. Reconcile them with provider and accounting evidence; no automatic historical ledger entries are fabricated.

Validation: financial read tests cover split payers, partial refunds, posting dates, an unknown earned amount, invalid amounts, export parity and storage failures. Final validation results are recorded with the patch bundle.
