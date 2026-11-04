# Active customer profile and notifications regressions

## Scope and evidence boundary

Base: `e9189312c49775c3a298019270ec7490340cf62e`.
Work branch: `codex/coverage-client-active-20261105`.

`client/src/App.tsx` imports `Profile` and `Notifications` lazily and mounts
`/profile` and `/notifications` inside the real `ProtectedRoute`. Both pages use
`client/src/_core/hooks/useAuth.ts`. The new tests mount those pages with that
guard, the real auth hook, the real tRPC client, SuperJSON and React Query. The
existing `client/src/test/trpc-fixture.tsx` replaces only the HTTP response
boundary. Tests exercise browser DOM interactions under jsdom, including real
Radix controls and the application's English/Arabic translations.

The supplied HTTP identity and preference/notification responses are controlled
fixtures. These tests do not establish server authorization, tenant isolation,
database persistence, delivery by a provider, or native-browser behavior.
No server, provider or production account is contacted. The identity-change test
delivers a new `auth.me` response together with that account's preference
response; the separate logout test runs the real `useAuth.logout` cleanup while
a preference mutation remains pending.

A production-source importer search found no use of
`client/src/contexts/AuthContext.tsx` or `client/src/lib/auth-fetch.ts`; no tests
were added for those legacy modules. Existing avatar-upload behavior and the
account-privacy implementation are outside this change. The existing focused
`AccountPrivacy` tests were rerun as a nearby regression check.

## Reproduced defects and fixes

The first five tests were run against unchanged base production source. All five
failed for the intended behavior, with the exact test names below retained in
the final tests.

| Exact regression name                                                                                | Before the fix                                                                         | Final behavior                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocks a default save after a preference read failure and recovers with the stored values`          | No error alert; the default form and Save button remain present after the failed read. | A translated error and retry action replace the form until a read succeeds.                                                                              |
| `preserves dirty fields while applying refreshed server values to untouched fields`                  | Expected `Unsaved contact`; received `Other browser contact`.                          | Refreshed data updates untouched fields while the edited field keeps its local value.                                                                    |
| `keeps an edit made during an outstanding save and accepts later refreshes after that edit is saved` | Expected `Newer unsaved contact`; received `First saved contact`.                      | A save clears only edits matching its submitted values; newer edits survive. After those newer edits are saved, subsequent server refreshes apply again. |
| `distinguishes a failed list request from an empty inbox and retries the request`                    | No error alert; a failed list request renders the empty inbox.                         | A failed query has a translated error and retry action. A successful empty response retains its distinct empty state.                                    |
| `reports a failed mutation without pretending the unread notification was changed`                   | No error feedback after the failed mutation.                                           | The alert reports failure; the notification and unread count remain until a successful mutation and refresh.                                             |

Profile now keeps a field-level draft over the latest server preferences.
Successful saves update the cache from the returned persisted preferences,
invalidate the query, and release only edits whose values match that save's
submission. Query failures do not expose a savable default form. The draft is
associated with the authenticated user ID, so another identity cannot inherit
the previous account's pending field edits.

Review of the initial implementation found two additional hazards, each caught
by a failing regression before its final fix. These were failures of the first
implementation in this worktree, not claims about the unchanged base revision:

- `does not recreate private preference cache when an outstanding save finishes after logout`:
  after real logout removed private queries, the initial cache-write callback
  restored the old preferences. The expected cache value was `undefined` but the
  returned record contained user `23` and the old contact. The final callback
  checks the identity captured when the mutation was submitted against the
  current identity before updating cache or draft, invalidating queries, or
  displaying feedback.
- `resets edits for a new authenticated identity and ignores the previous owner's outstanding save`:
  the initial field overlay kept `First owner draft` instead of the newly
  authenticated account's `Second owner saved`. The final test additionally
  edits the second account's form, completes the first account's pending save,
  and verifies that the second draft and its cached user ID remain intact.

Notifications now show errors for each of the four mutations: mark one read,
mark all read, delete one, and delete all. Successful mutations invalidate the
list and unread-count queries and clear the failure feedback. Icon-only actions
have translated accessible names; the type selector and unread toggle expose
their accessible label/state. Delete-all remains behind its confirmation and
is disabled while its request is pending.

## Executed verification

Runtime: `/tmp/ais-resilience-tools/node22/node-v22.23.4-linux-x64/bin/node`
(`v22.23.4`), using the already linked dependencies. No dependency, lockfile,
workflow or Vitest configuration was changed.

Final focused regression command:

```bash
/tmp/ais-resilience-tools/node22/node-v22.23.4-linux-x64/bin/node node_modules/vitest/vitest.mjs run \
  client/src/pages/__tests__/Profile.test.tsx \
  client/src/pages/__tests__/Notifications.test.tsx \
  client/src/_core/hooks/useAuth.test.tsx \
  client/src/components/__tests__/AccountPrivacy.test.tsx \
  --reporter=verbose
```

Result: **28 passed, 4 files passed**, including **21 new tests** for Profile
and Notifications and **7 existing tests** for the auth hook and AccountPrivacy.
The added tests cover access/loading boundaries, successful empty responses,
input validation and corrected save payloads, preservation of false preference
values and Date serialization, failed-save retention and retry, refetch failure
and recovery, in-flight edits, identity/logout races, filtered notifications,
all four mutation flows, delete-all cancellation/confirmation, prevention of
accidental enclosing-link navigation, and translated English/Arabic feedback.

ESLint for both changed pages and both test files passed. Prettier formatting
and `git diff --check` passed. The initial whole-project `tsc --noEmit` attempt
aborted with exit `134` because the default Node heap was exhausted. The
integrated check with a 6 GB heap then identified unsupported `exact: true`
options in the two new role-query test files. Removing those options preserves
the library's exact string-name matching. The final integrated page run passed
all **21 tests**, and all four TypeScript configurations passed with Node
22.23.4: `tsconfig.json`, `tsconfig.scripts.json`, `tsconfig.acceptance.json`
and `tsconfig.e2e.json`. No typecheck exclusion or production behavior changed
for this correction.

## Focused coverage observation

The supplied full-CI baseline is
`/tmp/ais-pr276-postmerge-cicd/coverage/run-UO6rop/coverage/coverage-summary.json`.
Both active pages had zero executed lines in that V8 report.

The following measurement used the final 21 tests and restricted
`coverage.include` to the two pages. Production thresholds were left unchanged.
This is a measurement of these two files only; it does not establish overall
repository coverage, full-suite success, financial-service per-file gates or a
Codecov aggregate increase. Source changes also changed the denominators.

| Active page               | Baseline executed lines | Focused executed lines | Focused branches   | Focused functions |
| ------------------------- | ----------------------- | ---------------------- | ------------------ | ----------------- |
| `Profile.tsx`             | `0/67` (0%)             | `60/84` (71.42%)       | `86/98` (87.75%)   | `15/28` (53.57%)  |
| `Notifications.tsx`       | `0/66` (0%)             | `58/65` (89.23%)       | `56/63` (88.88%)   | `15/17` (88.23%)  |
| Combined, these two files | `0/133` (0%)            | `118/149` (79.19%)     | `142/161` (88.19%) | `30/45` (66.66%)  |

Measurement command:

```bash
/tmp/ais-resilience-tools/node22/node-v22.23.4-linux-x64/bin/node node_modules/vitest/vitest.mjs run \
  client/src/pages/__tests__/Profile.test.tsx \
  client/src/pages/__tests__/Notifications.test.tsx \
  --coverage \
  --coverage.include=client/src/pages/Profile.tsx \
  --coverage.include=client/src/pages/Notifications.tsx \
  --coverage.reporter=json-summary --coverage.reporter=text-summary \
  --coverage.reportsDirectory=/tmp/ais-client-active-followup-20261105/coverage-focused
```

Result: **21 tests passed**, exit `0`. The limited include set is deliberate
measurement scope, not a substitute for the repository's full coverage command.

## Review receipts

Local execution receipts remain under
`/tmp/ais-client-active-followup-20261105/` for the integration owner and reviewer.
The behavior and exact commands above are retained in the repository because
the temporary log paths alone are not durable evidence.

| Receipt                                                                                          | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `baseline-regressions.log` — original five tests against unchanged base source, 5 failures       | `e9a74b8bac5a16babf1c9ad69f396fc0b6943ece20c67c85931709fcf0352ffe` |
| `fixed-regressions.log` — those exact five tests after their initial fixes, 5 passes             | `43bc4f74e41cbedce7f44b82f96a14416e49135d477bc0671610bdb91ae8b246` |
| `logout-cache-before.log` — pre-guard implementation fails the late-logout cache assertion       | `33d0ada0b4a81078692e8e04f7c9bc33ecb6e7b89429d48238f36f3b74b7c843` |
| `identity-edits-before.log` — pre-owner-scoping implementation retains the wrong account's draft | `e6b47bc05d64ae8b38adbb29805ac19c706cf873ccf1539e8ca1975c752dc675` |
| `focused-final.log` — final 28 tests pass                                                        | `f7494c756b29aa1acf05ddcc324b3f5a3dbea128dedd4e9602dccef476838f71` |

Additional receipts: `eslint-final.log`, `typecheck.log`,
`coverage-focused.log` and `coverage-focused/coverage-summary.json`.
