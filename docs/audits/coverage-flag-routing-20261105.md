# Coverage flag routing follow-up

## Problem and correction

The CI uploader sent one aggregate LCOV report without a flag, while the
`server` and `client` project statuses selected those flags. Defining flag paths
in `codecov.yml` does not assign an uploaded report to a flag. Codecov's
[flag documentation](https://docs.codecov.com/docs/flags) requires appropriately
scoped reports and upload-time flag assignment.

The coverage wrapper now derives three disjoint reports after a successful test
run and validates their counters against the original coverage summary:

| Flag     | Source prefix | Report under the run's evidence directory |
| -------- | ------------- | ----------------------------------------- |
| `server` | `server/`     | `coverage/codecov/server.lcov.info`       |
| `client` | `client/src/` | `coverage/codecov/client.lcov.info`       |
| `shared` | `shared/`     | `coverage/codecov/shared.lcov.info`       |

Each upload sends exactly its matching report and flag. The original aggregate
LCOV, summary, JSON coverage, Cobertura, runner JSON and JUnit remain available
in the evidence artifact. The aggregate is not uploaded again alongside the
partitions. The existing `unittests` flag definition is retained for compatibility;
this workflow does not assign that flag to any upload.

## Evidence and failure behavior

`scripts/ci/coverage-partitions.mjs` uses Node built-ins only. Its parser preserves
complete raw LCOV record bytes, line endings, source paths and ordering within
each partition. It checks line, function and branch counters, and rejects
duplicate sources or measurements, unknown fields, unsafe paths, incomplete
records, invalid numbers and sources outside the three prefixes. Empty records
remain in their scope; an absent or entirely unmeasured scope fails the run.

The new partition manifest records each original record's index, source, byte
count and SHA-256, plus aggregate and per-scope counters and hashes. The
execution manifest hashes all eleven required artifacts: the original seven,
the three scoped reports, and the partition manifest. Partition failures turn
an otherwise successful child process into a failed wrapper result. Failed or
interrupted test runs do not produce an uploadable partition set.

Before any OIDC upload, a fresh checkout verifies the successful execution
manifest, actual runner result, source commit/tree, clean source state,
configuration/package/lock hashes, repository, workflow run ID, event, ref and
checkout SHA. It verifies the complete artifact catalog and hashes, reconstructs
the partitions from the aggregate and requires byte-exact agreement, and checks
every source path is tracked in that checkout. Symlinked artifacts, paths outside
the run directory, and ambiguous manifest JSON fail verification.

A job-only rerun may reuse a successful earlier attempt from the same workflow
run and source: original attempt 1 is valid for upload attempt 2. Artifacts from
another run, source, repository, event or ref, or from a future attempt, fail.
Historical artifacts produced before partition generation remain historical
evidence; they are not accepted by the new verifier as a complete upload set.

The isolated upload job retains its pull-request exclusion, `contents: read`
and `id-token: write` permissions, pinned actions, `disable_search: true`, and
`fail_ci_if_error: false`. It installs no application dependencies and executes
no application tests. Consequently, a green upload job alone still does not prove
that Codecov accepted and processed all three reports. Hosted acceptance must
be checked against the exact new commit and each flag after the normal CI run.

## Codecov YAML defects

The recorded baseline validation of the committed configuration at
`e9189312c49775c3a298019270ec7490340cf62e` returned HTTP 400 from the official
validator for `comment.show_project_coverage`: unknown field. The replacement is
`hide_project_coverage: false`, documented by Codecov under
[show project coverage changes](https://docs.codecov.com/docs/common-recipe-list).
The existing comment layout is retained.

Local inspection of Codecov's public
[user schema](https://github.com/codecov/shared/blob/main/shared/validation/user_schema.py)
also confirmed that `coverage.status.project.default.exclude` is unsupported.
The inspected schema's Git blob ID is
`b912d15406081efdfb4e661170706254b843a8ef`. All six patterns in that redundant
block already exist verbatim in the unchanged top-level `ignore` list, so removing
the unsupported block preserves those exclusions.

The final YAML passed a local recursive unknown-key check against that schema,
and comparisons confirmed unchanged targets, thresholds, status paths, status
flag selectors and top-level ignores. This is a schema-key compatibility check,
not the full Cerberus validator or an official endpoint acceptance result.
Automatic approval review rejected sending the revised local configuration to
the external validator because authorization for disclosing that file to the
destination was not established. No retry or alternate transmission was made;
the safer check downloaded public schema data and kept the configuration local.

Project targets remain 80% aggregate, 80% server and 75% client, with their
existing 1%, 1% and 2% tolerances. Patch coverage remains 70% with 5% tolerance
and `only_pulls: true`. A corrected configuration can expose honest below-target
statuses; none of these statuses was changed to informational. These defects
do not, by themselves, establish the exact cause of any earlier hosted status
omission.

## Verification

The checked runtime is Node `v22.23.4`, matching the established CI runtime.

- `node --test scripts/ci/coverage-partitions.test.mjs`: 54 tests passed. Tests
  cover raw-byte reconstruction, CRLF, empty records, malformed/path/counter
  boundaries, source and CI identity, artifact tampering, failure results,
  job-only reruns, and the isolated three-report upload wiring.
- `python3 -m unittest scripts/ci/test_coverage_evidence.py`: 5 tests passed,
  including actual child failure/signal propagation, stale-output prevention,
  malformed coverage, inconsistent summaries, and the complete wrapper-to-upload
  verifier path with an earlier successful run attempt.
- The existing production CI contract and workflow-hardening suites passed all
  13 tests. `actionlint .github/workflows/ci-cd.yml` passed.
- Formatting checks and `git diff --check` passed for the change.

The production partition writer was also exercised on the actual archived LCOV
from workflow run `41905215880`, source commit `e9189312c49775c3a298019270ec7490340cf62e`.
This was a historical artifact compatibility and conservation check, not a fresh
application test run or a new hosted Codecov result.

| Scope     | Records | Empty records retained | Lines hit / found | Functions hit / found | Branches hit / found |     Bytes |
| --------- | ------: | ---------------------: | ----------------: | --------------------: | -------------------: | --------: |
| Server    |     495 |                      5 |   15,549 / 30,431 |         3,048 / 5,812 |      11,755 / 24,563 |   981,900 |
| Client    |     288 |                      1 |    4,416 / 10,625 |         1,349 / 3,870 |       4,259 / 11,200 |   467,616 |
| Shared    |      22 |                      1 |         438 / 454 |               83 / 89 |            266 / 308 |    14,831 |
| Aggregate |     805 |                      7 |   20,403 / 41,510 |         4,480 / 9,771 |      16,280 / 36,071 | 1,464,347 |

Reassembling records in their original index order reproduced the aggregate
byte for byte. Every source path was tracked at the original commit; there were
zero dropped or duplicate records. Its SHA-256 remains
`4eca9edb6e182aa8448da40d5d9918d9bf27fee15d29fc0d6f0d5bb23cfbc01e`.
The scoped SHA-256 values are:

- Server: `992d0ed7ebfbe6763cfd67e9b0b319686208c718923f9125869792445110232c`.
- Client: `8351268dea8750e5a8ddabb14cc4ed7b2a041f7dd1d80f05872fe585ba6a2da3`.
- Shared: `6712cabb41f4c270339cc9de5e9273e077a481052191e8e673f1a94ad573c89a`.

Coverage measurement, denominator, branch semantics, exclusions and thresholds
are preserved. Any difference between V8 line coverage and Codecov's normalized
coverage remains a separate accounting question.
