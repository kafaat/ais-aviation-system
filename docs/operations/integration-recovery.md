# Integration recovery runbook

Use `/admin/operations` with an authorized administrator in the intended tenant.
The screen lists the oldest 100 incomplete event deliveries and cancellation jobs.
Read each consumer receipt; an archive-only envelope is not completed domain work.

1. Correct the transport/recipient/provider or missing source evidence first.
2. Enter a review reason and replay a failed or expired event claim. The command
   preserves completed consumer receipts, resets only the producer retry lease,
   and records the actor and prior attempts in the transactional outbox.
3. For cancellation jobs without any provider request, reconcile original
   collection evidence, then use **Recheck funding**. The planning command reruns
   the same guards; it cannot override missing funds, currency or ownership.
4. Existing order refund requests must be reconciled by their saved provider ID
   and original payer. Never delete/reset a request or create another refund to
   clear a dashboard warning. Pending/unknown transport outcomes are polled by the
   worker using their existing key and provider history. Failed, conflicting or
   older unknown outcomes remain under financial review. The verified provider
   refund webhook is the authority for updating the saved request.
5. Acknowledge alerts to record who saw them. Acknowledgement does not resolve an
   incident; a fresh successful observation resolves its condition. Inspect
   `lastSuccessAt`, not merely a worker process or a scheduled-task name.
6. Import signed crew/maintenance source packages, assign crew and validate a tail
   before recovery. Create passenger protection in the IROPS screen, propose a
   plan, inspect each booking's destination and unassigned passengers, approve the
   displayed digest, then execute. Expired or changed plans require a new proposal.

Historical offered waitlist rows and approved groups without inventory-hold links
need a data review. The old writers did not consistently reserve capacity, so the
application cannot safely infer a compensating increment. Export the affected
rows, compare aircraft capacity, funded itinerary reservations and active holds,
and review a transaction that links/replaces the allocation before releasing it.
No migration silently changes these financial or inventory facts.

A signed AIS boarding document is validated online against its passenger, actual
itinerary leg, seat, nonce and clearance. Re-check-in never revives a revoked nonce.
The local PDF/QR format does not claim airline BCBP or external gate acceptance.

To reproduce the software gate, use an EMPTY disposable `*_test` MySQL database,
Redis, `NODE_ENV=test` and `AIS_DISPOSABLE_DATABASE=true`, then run:

```sh
pnpm db:migrate
pnpm db:verify
node --import tsx scripts/acceptance/integration-remediation.ts /absolute/path/results.json
pnpm lint:ci
pnpm check
pnpm check:scripts
```

CI keeps the remediation database separate from migration replay and the older
transaction acceptance fixtures. Provider calls in this regression runner are
synthetic and cannot establish real provider acceptance.
