# IBE journey completion — ownership and acceptance

Recorded 2026-11-03 against main `128e67c640ebb1e57f9e944471b89b1bb4711660`.
This ledger identifies the work owned by this branch so simultaneous AIS agents
can avoid repeating changes. A source change, a passing test, a merged change,
and acceptance on a deployed target are separate states.

## Existing owners checked before implementation

| Scope                                                                                                    | Existing work                                  | Treatment here                                                         |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Direct sectors, initial ancillary scope, named fare rules, ticket allowance, agency ownership, reporting | PR #248 `codex/vrs-acceptance-reconciliation`  | Consume and verify its implementation; do not duplicate these writers. |
| Departure desk, boarding/offload, physical baggage acceptance, APIS                                      | PR #247 `codex/dcs-counter-lifecycle-20261103` | Preserve independent ownership and operational authority.              |
| Passenger special services by sector                                                                     | PR #249 `codex/sector-ssr`                     | Preserve independent ownership.                                        |
| Version proposal                                                                                         | PR #245 `release/v1.35.0`                      | Release metadata is independent of functional acceptance.              |

PR heads may advance. Re-read their exact heads and changed hunks before
integration; sharing a file does not imply sharing ownership of every feature.

## Work owned by this branch

| Audit finding | Owner                           | Implementation scope                                                                                           | Acceptance                                                                                            |
| ------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| IBE F04       | Checkout agent                  | Return cancelled payment to the same owned booking and frozen checkout; explicit resume UI                     | Different booking/flight IDs, replay, expired/paid/non-owner states; no duplicate booking or charge   |
| IBE F05       | Authentication/navigation agent | Validated internal return destination across login/MFA; usable search navigation                               | Preserve query, reject open redirects, retain financial/server authority                              |
| IBE F06       | Public retrieval agent          | Narrow public booking-reference and surname entry; account actions retain authorization                        | Non-enumerating failure, request limiting, tenant isolation, minimum disclosure                       |
| IBE F08       | Integrator                      | Validated market/display-currency context using existing pricing authority                                     | Canonical SAR invoice unchanged; display conversion labelled and preserved across navigation          |
| IBE F09       | Integrator                      | Explicit integration configuration and safe public search embedding where supportable                          | Approved origins only; no relaxation of account/payment frame protection                              |
| IBE F10       | Integrator                      | Remaining unclaimed search inputs and promotion connection, building on existing multi-city and fare-rule work | User selection reaches authoritative quote/booking; unsupported policies do not become invented fares |

IBE F01–F03 are verified against PR #248 rather than rewritten. F07 agency
portal scope is being checked against that PR before any additional UI work.
The Videcom document does not require AIS to copy vendor hosting, ASPX paths,
specific fare-brand names, or youth-age policies. External airline, payment,
station, DNS and partner acceptance must be reported separately.

## Status

- Ownership inventory: in progress; direct GitHub PR collection and branch heads checked.
- Implementation: active in isolated agent worktrees.
- Validation: pending implementation; no closure is claimed by this ledger alone.
- Merge/deployment: no action performed by the initial ownership commit.
