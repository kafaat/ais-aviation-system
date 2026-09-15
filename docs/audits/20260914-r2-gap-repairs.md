# R2 gap repairs and verification

Base: `52aa07e2f6177ae537a6d88a3e58150faea50311` on
`claude/project-exploration-JWCKA`. Repairs are on `codex/r2-gap-repairs`.
No dependency or production configuration changes were needed.

## Behavior repaired

| Area                          | Change                                                                                                                                                                                       | Regression evidence                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment policy             | Maximise assigned passengers before minimising the declared secondary cost. The uniform coverage surcharge exceeds the sum of finite row maxima and is excluded from displayed costs.        | A feasible seat at +30 hours is used; 80 complete small plans match exhaustive lexicographic enumeration, alongside the existing 120 matrix checks.                                            |
| Assignment size and identity  | Retain only the best N seats per cabin; reject duplicate passenger/flight IDs and reject a manifest above 150 explicitly.                                                                    | A 2000-seat option works for a small manifest; duplicates fail; MySQL rejects 151 passengers without returning a partial manifest.                                                             |
| Real inputs                   | Reuse current-segment membership and inventory hold predicates in one read-only repeatable-read transaction. Failed score reads propagate instead of producing zero or omitting a passenger. | Later legs included; moved/cancelled legs excluded; canonical and legacy holds counted without double-counting aliases or updating expired rows.                                               |
| Alternative scope             | Filter effective eligible capacity before selecting the earliest 20 arrivals. Expose `optionsTruncated`.                                                                                     | Twenty unavailable flights cannot hide a later usable flight; the 21st eligible option is disclosed.                                                                                           |
| Trace context                 | Reject uppercase hex, invalid `ff` and invalid version-00 extensions; continue valid higher-version prefixes; clear reserved outgoing flags. New traces default to unsampled.                | Parsing/continuation regressions plus the existing MySQL request/outbox/inbox causality checks. This remains traceparent correlation, not a complete tracing SDK or tracestate implementation. |
| Incident sequencing           | Serialize claims and closes through the raise row. Wait for an active send lease, persist closure while delivery is disabled, and cancel superseded raises.                                  | Concurrent MySQL workers and closers preserve ordering; accepted-but-lost raise followed by close cannot be resent by the old local dispatch.                                                  |
| Provider identity and retries | Bind persisted mode/reference to an endpoint/credential fingerprint, preserve the original close target, retain UUID entropy for long keys, and enforce the attempt ceiling after crashes.   | Changed mode, endpoint or credential is blocked; unsafe retries become visible failures without stranded leases; maximum-length keys remain distinct.                                          |
| Service ownership             | Classify passenger priority and reaccommodation under airline operations and regenerate the catalog.                                                                                         | Catalog check passes; accountable owners and rotations remain unassigned until the organization supplies them.                                                                                 |

The assignment remains advisory and assumes independent passengers, additive
costs and cabin eligibility. It does not model group cohesion, onward-connection
feasibility or an entire airline network. `objectiveValue` is a secondary cost:
compare unassigned counts first, and compare plans only within one request.
Acting on an advisory still requires the existing booking authority to recheck
capacity and commercial eligibility.

## Verification

Executed with Node 24.19.0, the unchanged pnpm lockfile, MySQL 8.0.46 and a real
Redis instance, in UTC. Temporary MySQL data lived on local `/tmp` storage for
the migration replay. All commands below completed successfully.

| Gate                               | Result                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full Vitest suite with coverage    | **1888 passed**, 238 existing skips; 139 passing and 16 skipped files. No new test is skipped. Existing coverage thresholds pass (lines 22.11%, statements 21.90%, branches 18.45%, functions 19.42%). |
| MySQL/Redis transaction acceptance | **87 passed, 0 skipped, 0 external provider calls**. [Complete check list](20260914-r2-gap-repairs/live-acceptance.json).                                                                              |
| Migration replay and preservation  | 46 migrations; 16 replay/preservation/refusal checks. All 151 live tables match the declared catalog.                                                                                                  |
| REST contract lab                  | 4 passed; no provider calls. Microcks was outside this run.                                                                                                                                            |
| TypeScript                         | Main, operational scripts and acceptance configurations pass.                                                                                                                                          |
| Code quality                       | ESLint with zero warnings, Prettier and both generated catalogs pass.                                                                                                                                  |
| Build                              | Production application and worker build; all size budgets pass.                                                                                                                                        |
| Python                             | 15 CI tests and 3 authentication configuration tests pass; CI/contract scripts compile.                                                                                                                |
| Secret policy                      | 8 policy probes pass, including positive detection controls; new commit range scanned with gitleaks 8.24.3.                                                                                            |

The [regression proof](20260914-r2-gap-repairs/regression-proof.json) restores
baseline source files temporarily, or reinstates swallowed scoring failures.
It produces **4 assignment failures, 3 trace failures, 10 on-call failures and
1 scoring failure**. Restoring the repairs passes all **66 focused tests**.
The final full suite ran after the original repairs were restored.

Reproduction uses the existing project entry points: `pnpm test:coverage`,
`pnpm check`, `pnpm check:scripts`, `pnpm exec tsc -p tsconfig.acceptance.json
--noEmit`, `pnpm lint:ci`, `pnpm exec prettier --check .`, `pnpm build`,
`pnpm size`, both catalog generators with `--check`, and the existing Python
CI/configuration tests. In an empty disposable `*_test` MySQL database with
Redis configured, run `pnpm db:migrate`, `pnpm db:verify`,
`pnpm db:verify-catalog`, `pnpm db:test-migrations`, `pnpm test:acceptance` and
`python scripts/contracts/run.py rest --report <directory>`.

## Deployment and remaining operational acceptance

Apply migration **0045** before enabling this worker. It appends `cancelled` to
the dispatch status enum. During a rolling deployment update API readers before
workers begin writing that status; older readers do not accept it.

Pending legacy dispatches without a target fingerprint, and dispatches affected
by credential rotation, require reconciliation against the original provider.
They fail visibly instead of being sent to an unverified destination. Do not
rewrite their references simply to bypass this check. A close keeps the original
target even if the current configuration differs or is disabled.

GoAlert deduplicates open incidents, not the complete lifetime of a key. Local
ordering prevents the reproduced resurrection race; it cannot guarantee the
outcome of an arbitrarily delayed remote request or a closure performed outside
AIS. Those cases still require provider reconciliation. A delivery receipt
continues to mean provider acceptance, not human acknowledgement.

This repair does not claim a live on-call drill, weather-source acceptance,
Stripe/GDS/NDC/EMD/APIS/device approval, measured simulation calibration or a
ONE Record counterparty pilot. Those require the previously identified
operational inputs. No production migration, external page or deployment was
performed.

Protocol references: [W3C trace context](https://www.w3.org/TR/trace-context/)
and [GoAlert generic API](https://goalert.me/docs/alerting/alerting-from-generic-api/).
