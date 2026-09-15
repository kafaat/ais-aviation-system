# Internal refund boundary verification

This follow-up tests the existing internal funding authority; it does not implement split tender, change refund policy, or close E01–E11.

Base tested: `1bade10888a37304c09e5bb2d6e1dca0520b6f31` plus the acceptance changes in this branch. This is local evidence, not a claim about current main or GitHub Actions.

## Executed scenarios

Each isolated booking starts with 10,000 minor units of original credit funding and one funded segment. Commands use real UUIDs and the existing finance authority.

| Concurrent commands               | Expected result                                                                  | Refund total |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------ |
| 3,000 + 3,000, distinct keys      | Both succeed                                                                     | 6,000        |
| 5,000 + 5,000, no cancellation    | One succeeds; exhausting the remainder requires explicit cancellation            | 5,000        |
| 6,000 + 6,000, distinct keys      | One succeeds                                                                     | 6,000        |
| 5,001 + 5,001, distinct keys      | One succeeds                                                                     | 5,001        |
| 5,000 replayed with the same key  | Identical results, one refund entry                                              | 5,000        |
| 3,000 refund + owner cancellation | Refund succeeds; owner cancellation requires approved return to original funding | 3,000        |

Every case checks the real PRECONDITION_FAILED contract for rejected commands, refund entries excluding charges, conversion of ledger decimal amounts into minor units, net credit usage, booking/segment status, and available capacity. Each case then refunds the remainder with explicit cancellation and checks booking/segment release and restored capacity. Concurrent completion must take less than ten seconds; this bounded observation does not prove absence of every possible deadlock.

## Results

- Real MySQL 8.0.46 and Redis acceptance: **127 passed, zero skipped, zero provider calls**.
- Acceptance TypeScript, changed-file ESLint and Prettier passed.
- Existing export fixtures remain unchanged; new refund scenarios use a separate synthetic owner.
- A temporary detached worktree disabled the actual full-refund/cancellation equivalence guard. The exact-limit test failed with two successes instead of one. The mutation was not added to application code in this branch.
- This proves sensitivity to the cancellation policy. It does **not** claim mutation proof for all row locks, uniqueness constraints, or transaction boundaries.

## Review of supplied draft files

The supplied test imports, string booking IDs, non-UUID request IDs, `.ok` result fields, omitted actor/approval/cancellation arguments, and aggregate of all ledger entries do not match the existing authority. The real router is `refunds.refundInternalFunding`; the service is `internal-refund.service.ts`. Proposed mutations naming `internal_funding_refunds` or a `refundable_amount` update do not identify actual implementation sites.

The supplied secret scanner does not parse its advertised command-line options. Matching variable names does not establish value leakage; printing matched source lines can itself expose values. The proposed YAML block-scalar heredoc was checked with synthetic values: it appends a newline to a single-line value and fails YAML parsing for the supplied multiline interpolation pattern. Those snippets have not been deployed.

Secret transport hardening, a runtime leakage harness, permission-matrix extraction, allocation policy, and release enforcement remain separate unfinished work. No operator approval, external secret store, role, route, or ruleset enforcement is fabricated by this follow-up.
