# Baggage entitlement mutation checks

Apply each mutation in a disposable worktree, run the focused baggage suite,
then discard the mutation. A surviving mutation requires either a documented
alternative protection or a stronger test.

| Mutation                                  | Expected detection                          |
| ----------------------------------------- | ------------------------------------------- |
| Ignore `fundedAt`/financial evidence      | unfunded and mismatched-evidence tests fail |
| Raise `MAX_BAG_WEIGHT_GRAMS` above 32,000 | single-piece rejection test fails           |
| Ignore `passengerId`                      | passenger-isolation test fails              |
| Ignore `segmentId`/`scopeState`           | segment/scope tests fail                    |
| Remove weigh/confirm revalidation         | session-cancellation test fails             |
| Fund order-service item before completion | pre-collection assertion fails              |

Passing the unmodified suite is not a claim that every possible database lock or
financial mutation has been killed.
