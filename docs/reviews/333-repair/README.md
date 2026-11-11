# Review #333 repair and recovery record

Base: PR #336, `603a59f6e1e6da1cc54297ec0e3e064dcd9beb1b`. Working branch: `fix/review-333-sequential`.

This branch implements the documented code defects. It does not certify operator, device, BSP, APIS transport, provider, Kubernetes or disaster recovery acceptance. SAR policy is unchanged. No production migration, deployment, branch deletion or secret change was performed.

| Scope                                     | Implemented behavior                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REC-01, FIN-01/02/03                      | Shared verified settlement; reuse pending payment attempt; legacy unresolved history explicitly needs review; ordinary refund queue reporting; verified completion event; ledger-based partial-refund metric |
| DCS-01, INT-01, GRP-02, IROPS-01          | Atomic baggage history; clear stale APIS validation; SSR reactivation policy and atomic bulk transitions; itinerary connections from persisted booking segments                                              |
| SEC-01, PRIV-01/02, LOY-01, GRP-01        | Serialize reblocking/default-passenger/waitlist writes; atomic preference upsert; user/tenant-scoped loyalty credit                                                                                          |
| PRC-01, DIST-01/02, AGT-01, CORP-01       | Direct-offer passenger order validation with explicit servicing remap; refuse unsupported return shopping; future/tenant/cabin/party predicates; representable corporate discount bound                      |
| AI-01/02, OPS-01/02, BG-01/02, UTIL-01/02 | Scoped AI cache and enabled-state guards; flight tracking validation; runnable queue selection and zero delay; favorite price baseline; same-row SMS retry with unknown outcomes pending                     |
| BSP-01/BSP-R1, SVC-01, UI-01/02/03        | Settlement source scope and transmitted RET evidence; persisted segment revenue attribution; canonical search navigation; airport-local time filter; direct-only stop choices                                |
| QA-01/02/03/04 and branch maintenance     | SHA-safe labels; snapshot/restore release resources after partial failure; distinct prior stable release commit; backup writer security approximation; archive+fresh-PR checks and leased deletion           |

SEC-02 is withdrawn/already fixed, not reimplemented. Historical paid bookings without receipts and incomplete historical segment allocations require explicit reconciliation; these fixes do not invent financial evidence.

Migration `0075_favorite_price_observations.sql` is additive and must precede deployment of the updated monitor. MySQL replay and concurrency acceptance remain required on CI; local skipped tests are not acceptance.

## Evidence and resumption

`checkpoint-01/manifest.json` is an immutable intermediate snapshot, including six worker reports and a source hash inventory. Its task statuses are deliberately incomplete. Later checkpoints supersede its pending actions; do not reinterpret historical counts as the final state. Source hash inventories are evidence bindings, not a substitute for the git tree.

Resume from the newest committed checkpoint and its exact git head. Verify manifest artifact hashes, inspect git status and live PR state, then run only pending validation. Do not repeat completed external writes. No local harness ownership or weighted-run claim was taken.

## Deployment limits

The release-set rollback restores Deployment, ConfigMap, Service and Ingress resources, including background workloads. It does not roll back database migrations or pre-existing secret/namespace provisioning. Current deployment topology is rolling, not a blue-green traffic swap. Tests use mocked kubectl; real cluster acceptance is pending.

The backup smoke runner approximates the generated job's non-root/read-only/capability restrictions. Docker execution and PVC/CSI/storage-driver semantics were not accepted here. Branch deletion remains subject to a final non-atomic PR-open race; keep archives and use an exclusive maintenance window. The repair task did not execute deletion.
