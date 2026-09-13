# Loyalty credit adoption and reconciliation

Migration 0037 is additive. It does not invent an opening balance or rewrite the
historical miles ledger. The first subsequent balance operation locks the account
and reconstructs available credit from the original transactions. Each recorded
`balanceAfter` and the final account balance must agree; only then are the credit
lots and initialization marker committed.

For a clean account, spending uses the earliest expiring available credit. Only
unused miles expire. A refund first reverses expired credit without another debit,
then unused credit, then previously spent credit. Recovering spent credit may
consume other available credit or leave debt. New credits repay debt before they
become spendable. A family contribution counts as spending from the personal
account and is recorded as an adjustment, not a redemption for a discount.

When the worker reports `Loyalty expiration incomplete`, the operations scheduler
retains the failure and the first 20 affected user IDs. Other accounts are still
processed. Inspect the complete miles ledger, booking accruals, verified payment
receipts and family contributions for the affected account. Do not infer missing
credit from the current balance alone.

This read-only inventory identifies accounts still awaiting adoption and obvious
ledger/balance discrepancies. An equal aggregate does **not** prove that every
historical transition or expiration was valid; the canonical reconstruction checks
those details under the account lock.

```sql
SELECT a.id AS accountId, a.userId, a.currentMilesBalance,
       COALESCE(SUM(t.amount), 0) AS recordedLedgerBalance,
       COUNT(t.id) AS recordedTransactions
FROM loyalty_accounts a
LEFT JOIN miles_transactions t ON t.loyaltyAccountId = a.id AND t.userId = a.userId
WHERE a.creditLotsInitializedAt IS NULL
GROUP BY a.id, a.userId, a.currentMilesBalance;
```

An unrecorded historical family deduction, a duplicate expiration or an unknown
opening balance needs an approved reconciliation supported by original evidence.
Keep the original ledger, the affected account state and the approved correction
record. Never set `creditLotsInitializedAt` manually to bypass reconstruction or
create synthetic credit just to make adoption pass. No production account was
reconciled by this change; no production data or accepted reconciliation authority
was supplied.

Family groups with a nonzero contributed balance cannot be deactivated. A member's
personal balance and the persisted family pool are different balances; deleting
members or replacing the pool with their personal totals does not reconcile funds.
