# Wallet top-up dispute reconciliation

## Authority and policy

`payment_receipts.amount` owns the collected principal, in minor units.
`payment_receipts.refundedAmount` owns cumulative verified refunds.
Verified `charge.dispute.funds_withdrawn` and `funds_reinstated` ledger rows
own the cash dispute observations. Created, updated, and closed events carry
no cash authority, including a closed event whose status is won or lost.

For each dispute identity, use the greatest observed withdrawn amount and
greatest observed reinstated amount. Outstanding disputed principal is their
nonnegative difference. This treats another event reporting the same cash
movement as an observation rather than a second debit, and tolerates
reinstatement arriving before withdrawal. Partial amounts can increase these
observations. A genuinely separate dispute uses its separate provider identity.

The target funding loss for one receipt is:

```text
min(collected principal, cumulative refunded amount + outstanding disputes)
```

The wallet balance changes only by the difference between previously applied
loss and target loss. Overlapping refunds and disputes cannot remove more than
the collected principal. Reinstatement cannot restore refunded principal or
mint a credit when no funding was removed.

Previously purchased travel remains booked. A reversal after spending can
produce a negative wallet balance, which freezes an active wallet. Reinstatement
restores the correct balance but preserves frozen or closed status. There is no
authoritative freeze-reason field, so this path cannot safely reactivate such an
account. An active, nonnegative wallet remains active.

## Committed evidence

Each reconciled provider ledger row preserves its original metadata and adds:

```json
{
  "walletFunding": {
    "version": 1,
    "walletId": 1,
    "adjustment": -10000,
    "loss": 10000
  }
}
```

`adjustment` is the actual signed wallet delta in minor units; `loss` is the
receipt's resulting total funding loss. The marker, wallet balance change,
completed wallet movement, provider evidence, and outbox effect share the
provider transaction. A zero adjustment is also marked. The marker is required
even when a dispute already consumed all principal before a refund arrives.

Summing the negative of committed marker adjustments gives applied wallet loss.
An **unmarked historical refund** is recognized as already applied because the
previous refund boundary atomically debited that delta. An **unmarked historical
dispute** proves no wallet debit: the old dispute boundary recorded evidence
only. Do not infer a debit from the negative dispute ledger amount itself.

When an existing dispute event is explicitly reconciled, its marker can accumulate
the additional actual adjustment. Its original provider amount, event identity,
payment history, and outbox entries are not duplicated. Wallet movements retain
each individual adjustment.

## Lock order and shared refund hook

Dispute handling locks account, top-up request, wallet, then receipt. Refunds lock
top-up request, wallet, then receipt. Wallet payment locks booking, account, then
wallet. Funding evidence is read with a current locking read after the wallet and
receipt locks. This prevents stale repeatable-read snapshots from bypassing a
concurrent reversal or event replay. The spend guard does not lock top-up request
rows while holding the wallet, avoiding an inversion with the refund boundary.

`settleVerifiedRefund` invokes the same helper after updating the receipt and
inserting the refund ledger row:

```ts
await reconcileWalletFunding(tx, {
  receipt: { ...receipt, refundedAmount: input.amountRefunded },
  wallet: ownerWallet,
  eventId: input.eventId,
});
```

The missing-wallet guard remains in place. The just-inserted refund ledger row
must not have already been applied to the wallet. Deploy the shared refund and
dispute boundaries together: an old unconditional refund debit would still allow
double debit when refund delivery follows a dispute. Receipt discovery for the
spend guard uses the `payment_receipts_owner_kind_idx` covering index.

## Existing-row detection and repair

Deployment must drain old application workers so an old evidence-only writer
cannot race the new authority. This change does not run a bulk backfill.
`payFromWallet` checks known top-up receipts under its wallet lock before making a
new payment. A mismatch returns `PRECONDITION_FAILED` and tells the owner to contact
support for reconciliation. The guard changes no balance, creates no movement,
and calls no provider. Replay of an already paid booking remains idempotent.

Use `scripts/db/reconcile-wallet-funding.ts` through authorized maintenance
database access. It defaults to a read-only transaction and accepts one explicitly
chosen wallet owner and 1–25 exact payment-intent IDs. There is no wildcard, all-user,
auto-discovery, force, or blanket-backfill option. The accountable actor must already
exist: finance must have the owner's non-null tenant; admin and super_admin retain
their global scope. Current role, tenant, account locks, and deletion suspension are
checked before preview, apply, and approved replay. The CLI does not create actors,
elevate roles, or construct an application session.

Create an operator scope file using the actual persisted IDs, for example:

```json
{
  "actorId": 10,
  "userId": 9,
  "paymentIntentIds": ["pi_reviewed_topup"]
}
```

With `DATABASE_URL` set by the authorized maintenance environment, preview it:

```sh
node --import tsx scripts/db/reconcile-wallet-funding.ts scope.json
```

The JSON report contains a SHA-256 digest, scope, source counts, each receipt's
collected/refunded/applied-loss/target-loss amounts and proposed adjustment, and
the projected wallet balance/status. Amounts are minor units. Source bodies and
credentials are not printed. Preview changes no wallet, ledger, movement, audit,
provider event, booking, or outbox row and contacts no provider.

The digest binds the selected persisted sources **and the projected decisions**.
Review the complete report and obtain the explicit approval reference for that
digest. Then pass the reviewed value, not a newly generated unreviewed digest:

```sh
node --import tsx scripts/db/reconcile-wallet-funding.ts scope.json \
  --apply="$APPROVED_WALLET_DIGEST" \
  --approval-reference="FIN-2026-001"
```

Both flags are required for apply. Unknown, duplicate, or incomplete flags fail
before connecting. Do not pipe a preview's digest directly into apply as an
automatic backfill.

The supported batch is bounded at 200 ledger rows and 200 wallet movements per
selected receipt, 1,000 source-evidence rows overall, and a 10 MiB source payload.
Actor access history also has a fixed review bound. Exceeding a bound stops the
command; it never truncates evidence and calculates from an incomplete history.

### Proof and failure boundaries

Each selected receipt must have a matching completed top-up, original collection
ledger row, owner, target, amount, and currency. Cumulative refund ledger amounts
must agree with the receipt. Completed provider reversal/reinstatement movements
must prove the already applied funding loss; an unexplained manual adjustment or
an already debited but unmarked dispute stops the command rather than risking a
second debit.

Every cash dispute row must match its persisted, processed `stripe_events` record:
event type, dispute/charge/payment identity, amount, currency, status, and reason.
A missing, failed, ambiguous, or mismatched verification record requires separate
financial review. The command never invents or retrieves replacement provider
evidence. Fully restored or fully refunded principal can correctly produce a zero
adjustment.

Apply pins existing verified provider events before account/wallet locks, matching
the webhook order. It then locks actor/owner accounts, top-up requests, wallet,
receipts, and financial evidence; rechecks current sources; and rejects a changed
digest. Movement reads use a current snapshot established after acquiring the
wallet, avoiding a lock inversion with unrelated pending top-ups. Proven credits
precede debits within a selected multi-receipt batch so an intermediate calculation
does not create an artificial debt freeze.

Wallet changes, completed movements, existing ledger metadata markers, and the
success audit receipt commit in one transaction. Failure rolls all of them back.
Cash ledger row identity, amount, provider metadata, and stored provider event
bodies remain intact. No booking, inventory, outbox, or payment status is changed.

An exact repeat of the approved scope, digest, actor, and reference returns the
original audit result without another financial effect. Current authorization is
still required. Reusing the same actor/reference for a different command is denied.
The returned audit event ID identifies the committed result in `audit_logs`.

After a successful apply, repeat preview and retain both reports and the audit ID.
Each selected receipt should show zero remaining adjustment. The public webhook
inbox can skip an already processed event, so HTTP redelivery is not a substitute
for this maintenance command. Frozen and closed wallets remain frozen or closed;
existing account review is separate from funding reconciliation.

## Acceptance coverage

`wallet-dispute-funding-boundary.test.ts` covers actual wallet purchase rejection,
lifecycle controls, active-wallet restoration, repeated and reordered cash events,
partial spend/debt, legacy refund evidence, overlapping partial/full refunds,
corrupt bindings, historical mismatch repair, and atomic rollback.

`wallet-dispute-funding-mysql.test.ts` exercises the actual settlement boundaries
on a fresh loopback-only cloned schema. It observes real InnoDB lock waits for
refund/dispute and withdrawal/payment in both orderings. Its refund crossover
cases exercise the shared refund hook above. `CREATE TABLE LIKE` preserves types,
defaults and indexes but omits foreign keys; these tests do not replace migration
or foreign-key verification.

`wallet-funding-maintenance.test.ts` covers read-only previews, exact approvals,
source/actor changes, unsupported evidence, explicit batch bounds, reversal and
restoration proofs, rollback, replay, and CLI flag selection.
`wallet-funding-maintenance-mysql.test.ts` includes the actual CLI against a fresh
owned database, concurrent approved retries, an injected audit failure, and a real
wallet-lock wait followed by a changed source digest. Native results must be
reported only after those cases run; unit doubles do not simulate MySQL locking.
