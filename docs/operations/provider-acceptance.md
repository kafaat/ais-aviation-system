# External acceptance and ownership

The twelve earlier research patches are distinct from the audit remediation.
Software presence, a signed source upload and a green regression suite each prove
different facts. The following prerequisites cannot be manufactured by a patch.

| Domain                | Evidence required from the organization/provider                                                                                                    | Current repository conclusion                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Ticketing / NDC / GDS | Contracted ticket and EMD issuance/reissue, round-trip booking identity, provider acknowledgement and rejection, cancellation/refund reconciliation | Local order and document workflows implemented; external fulfillment acceptance unprovided                                 |
| Departure / APIS      | Authority receipt/rejection, approved document and passenger policy, actual gate/dispatch tests                                                     | Local eligibility and signed AIS documents implemented; authority/gate acceptance unprovided                               |
| Kiosk / baggage       | Registered device heartbeat, scanner/printer/scale/conveyor receipts, custody and offload fixtures                                                  | Digital records are separate from physical device acceptance                                                               |
| Crew / tail           | Operator-approved rule version, licence/medical/qualification records, maintenance release, continuity and dispatch approval                        | Signed scoped evidence checked during planning; operational sign-off unprovided                                            |
| Payments              | Provider sandbox acceptance for invoice, amount/currency, each original payer, timeout/replay, partial/full refund and chargeback                   | Stripe-shaped local tests pass; this PR does not execute live collection/refund acceptance or activate alternate providers |
| Resilience            | Observed backup restore, replication state, controlled failover and recovery-time measurements                                                      | Committed backup/restore gates retained; no claim of multi-region production acceptance                                    |
| Accountability        | Accepted accountable owner, on-call contact and approval evidence for every domain                                                                  | Explicit nullable assignments in `service-ownership.json`; repository reviewer fallback is not domain ownership            |

Record provider, environment, tenant/operator/device scope, executed-at time,
request identity, acknowledgement/rejection identity and redacted evidence location.
Keep production secrets and passenger/payment data out of repository fixtures.
Register sources and credentials through the deployment secret/configuration
mechanism; uploads never register their own authority. Expired or removed source
authorization invalidates operational use of its stored evidence.

Only mark a domain's ownership as assigned after its owner, on-call contact and
acceptance evidence are present. `generate-service-catalog.ts --check` verifies
that the catalog reflects the committed assignment file; it cannot certify a
person's acceptance or a provider contract.

## Running the existing Stripe sandbox acceptance

Use the **Stripe Sandbox Acceptance** workflow on `main` after PR #148. It is
intentionally manual and already exists; the remediation extends that workflow
instead of introducing a second provider path. Supply the GitHub Actions secret `STRIPE_TEST_SECRET_KEY`
through the repository's secret configuration. The workflow maps it to
`STRIPE_SECRET_KEY`; never put its value in a PR, command log or evidence file.

The workflow uses Node 24, a disposable MySQL database and Redis. Its preflight
runs before dependency installation and records `BLOCKED` when a prerequisite is
missing. After preflight, `NOT_RUN` means setup or the actual acceptance has not
completed; only the completed scoped run can record `PASS`. The artifact is
`stripe-sandbox-evidence` and contains the source SHA, time, run identity, completed
checks, safe provider object identities and any failed phase. A missing artifact
is an error.

The extended run checks seven contracts:

1. Checkout metadata binds the stored invoice amount, currency, owner and request.
2. Retrying checkout returns the same session.
3. Another user cannot recover that checkout.
4. Provider-confirmed unpaid expiry releases the local claim.
5. Directly retrieved test-card captures fund two frozen shares (4000/6000 minor
   units). Idempotent retries and duplicate settlement cannot reserve seats twice.
6. A synthetic completed exchange supplies a partial 2500 refund. Original payers
   receive 1000/1500; deliberately withholding one local acknowledgement exercises
   recovery from real provider refund history.
7. Flight cancellation returns the remaining 7500 through the normal refund worker.
   Each payer has exactly two successful refunds; the ledger records four refund
   deltas and the reserved seat is released once.

This is not hosted Checkout completion, exchange quoting, 3DS, delivery of a
provider-signed webhook, chargeback handling or production certification. Those
scopes remain explicit in the evidence. The old three credential-gated Vitest
cases are now always-running offline router checks; provider assertions remain
in this explicit sandbox runner.

The full control flow was exercised locally using real MySQL and a **simulated**
Stripe transport (one session, two captures, four refunds), and 18 offline boundary
and evidence tests passed. No real Stripe sandbox credential was available in
this execution environment. No live-provider acceptance was executed, and the
presence of a GitHub Actions secret has not been verified.

## Remaining operational handoff after PR #148

The post-merge [CI/CD Pipeline run 34746676270](https://github.com/kafaat/ais-aviation-system/actions/runs/34746676270)
completed successfully at 2026-09-13 08:14 UTC on merge commit
`773e0cde397ba68b334a79fd107827a2da3805b9`. The resulting v1.24.0 release
commit `bdd446423e2ad1852d339804d53cabf9e33196cb` changes only the changelog
and package version. This closes the outstanding post-merge CI check.

| Remaining acceptance                                       | Concrete next action                                                                                                                                            | Required input                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stripe's seven automated sandbox contracts                 | Run the existing manual workflow on `main` and retain `stripe-sandbox-evidence`; accept only `PASS` with its source SHA and completed checks                    | Configured test key and an operator with workflow dispatch access                 |
| Hosted Checkout, 3DS, signed webhook delivery, chargebacks | Execute these separately in the provider sandbox and correlate each request, provider acknowledgement and local settlement                                      | Sandbox merchant access and a reachable test deployment                           |
| Historical balances and allocations                        | Run the existing forensic auditor on a restored copy, then reconcile each finding against original evidence; see [loyalty procedure](loyalty-reconciliation.md) | Restored database copy, restricted evidence store and accepted financial reviewer |
| Domain ownership                                           | Fill all three assignment fields for each of the five domains and regenerate the existing catalog                                                               | Accepted owner, on-call contact and approval evidence                             |
| Airline and airport services                               | Execute the scoped contracts in the domain table above                                                                                                          | Provider/device connections and operator approval                                 |
| Forecast and resilience acceptance                         | Evaluate on representative dated data and retain observed restore/failover measurements from the target environment                                             | Representative data, target deployment and operational reviewers                  |

### Chargeback evidence path

Before this change the webhook logged every `charge.dispute.*` event as unhandled,
so a provider sandbox chargeback would have left no local record to correlate.
`server/services/payment-dispute.service.ts` now records each signature-verified
dispute event inside the webhook transaction: one `financial_ledger` adjustment per
provider event id (signed amount only on `funds_withdrawn`/`funds_reinstated`,
zero for lifecycle events), a `payment_history` entry (`disputed`, or `chargeback`
on funds withdrawal and a lost outcome) for booking payments, and a
`payment.disputed` outbox event. It never cancels a booking, releases inventory or
changes payment status; the chargeback outcome remains an operator decision.
Replays write nothing, a dispute for an unknown payment is retried like an early
refund, and a foreign currency or an amount above the receipt is rejected. This is
the local half of the chargeback row above; the provider half still requires a
sandbox dispute (`4000 0000 0000 0259` and its outcome) delivered to a reachable
test deployment.

No workflow-dispatch run was returned by the repository API during this follow-up.
The available connection exposes reads and reruns, but no workflow dispatch;
the local environment supplies neither a Stripe test key nor a production database.
These are execution prerequisites, not passing acceptance results. A regression
test, local fixture or updated document cannot supply the missing external evidence.
