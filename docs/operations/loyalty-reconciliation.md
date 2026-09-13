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

Run the existing forensic auditor against a restored production copy using a
read-only database account. The copy must include migration 0037; a missing table
or column produces `blocked`, not a zero count. Supply `DATABASE_URL` through the
environment and keep the report in the organization's restricted evidence store.

```bash
pnpm db:audit-data --run --output=/secure/evidence/data-preflight.json
```

The same queries are available in `scripts/sql/forensic-data-preflight.sql`,
generated from the executable registry with `pnpm db:audit-data --print-sql`.
The auditor uses one read-only repeatable-read transaction, reports full counts
and at most 50 record IDs per finding by default, and rolls back. Exit 0 means no
listed findings, exit 2 requires review, and exit 1 means the audit was blocked.
The `owner` field names a software authority; it does not assign a person.

| Finding                                    | Meaning of each `recordId`                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `loyalty_credit_adoption_pending`          | Account awaiting canonical reconstruction; review only, not proof of corruption                                                      |
| `loyalty_account_missing_owner`            | Account whose user does not exist                                                                                                    |
| `loyalty_ledger_owner_mismatch`            | Transaction with a missing account or different account owner                                                                        |
| `loyalty_ledger_transition_mismatch`       | Transaction whose recorded balance differs from the running ledger total ordered by transaction ID                                   |
| `loyalty_ledger_balance_mismatch`          | Account whose stored balance or empty historical ledger cannot be explained                                                          |
| `loyalty_credit_lot_conservation_mismatch` | Credit transaction whose lot has invalid amounts or does not conserve credited miles                                                 |
| `loyalty_credit_lot_identity_mismatch`     | Credit transaction whose lot has a different account, owner, amount, booking, expiry or transaction type                             |
| `loyalty_initialized_credit_missing_lot`   | Positive credit transaction without a lot in an initialized account                                                                  |
| `loyalty_available_credit_mismatch`        | Initialized account whose available lots disagree with its spendable balance; legitimate negative debt requires zero available miles |
| `loyalty_uninitialized_account_has_lots`   | Account with partial or unexplained initialization                                                                                   |
| `family_pool_balance_mismatch`             | Group whose pool differs from all membership contributions less redemptions, including removed members                               |
| `family_contribution_ledger_mismatch`      | Group with a member's contributions unsupported by that user's recorded personal deductions                                          |
| `family_transfer_missing_membership`       | Family transfer transaction with an invalid debit, missing group or missing historical membership                                    |
| `inactive_family_retains_miles`            | Deactivated group retaining a nonzero pool                                                                                           |

A matching final ledger total does **not** prove valid intermediate balances.
The auditor checks those transitions separately. These SQL findings still do not
certify expiration eligibility, original payment evidence or approval of a past
correction. Canonical reconstruction remains authoritative for legacy adoption;
the auditor neither invokes a balance mutation nor sets its initialization marker.

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
