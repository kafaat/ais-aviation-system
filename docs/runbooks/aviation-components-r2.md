# Aviation components — R2 implementation

Base: `90e540037dc45221d5b1d77b4a78cfff87db1532` (v1.25.0).
Implements the follow-up study _AIS Additional Components and Gap Solutions_,
13 September 2026. R2 numbers are separate from the original twelve research
patches. Booking, payments, inventory, and the transactional outbox remain the
authorities. Optional integrations do not establish provider acceptance.

| Patch | Scope                                               | Evidence / status                           |
| ----- | --------------------------------------------------- | ------------------------------------------- |
| R2-01 | Persisted wallet account scope for dispute evidence | Implemented; 11 dispute boundary tests pass |
| R2-02 | Resume publication of an existing release tag       | Pending                                     |
| R2-03 | Atomic gate allocation and conflict prevention      | Pending                                     |
| R2-04 | Provider-confirmed emergency hotel fulfillment      | Pending                                     |
| R2-05 | Versioned event contracts                           | Pending                                     |
| R2-06 | Provider/API contract laboratory                    | Pending                                     |
| R2-07 | Transport fault acceptance                          | Pending                                     |
| R2-08 | Trace context and data lineage                      | Pending                                     |
| R2-09 | On-call delivery and acknowledgement                | Pending                                     |
| R2-10 | Aviation weather source adapter                     | Pending                                     |
| R2-11 | Advisory optimization and simulation pilot          | Pending                                     |
| R2-12 | ONE Record cargo exchange pilot                     | Pending                                     |

No person, on-call rotation, production database, or provider acceptance is
inferred from local tests. Each patch records its tested scope below.

## R2-01 — dispute account scope

Wallet disputes resolve tenant scope from the persisted user account. Missing
accounts and changed receipt ownership roll back; an explicitly public account
retains `null`. Booking disputes retain the booking's tenant. The focused
`payment-dispute-boundary` suite passes 11 cases, including public and tenant
wallets and the missing-account rollback. These are transaction-double tests;
they do not claim live provider acceptance.
