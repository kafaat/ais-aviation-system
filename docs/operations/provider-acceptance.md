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
