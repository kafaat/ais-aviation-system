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

Use the **Stripe Sandbox Acceptance** workflow on the branch containing the
changes (`codex/integration-remediation-20260913` before merge). It is intentionally
manual and already exists; this change extends that workflow instead of introducing
a second provider path. Supply the GitHub Actions secret `STRIPE_TEST_SECRET_KEY`
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
