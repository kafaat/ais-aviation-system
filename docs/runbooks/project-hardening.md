# Project hardening after v1.27.3

Base: `40e2cdc2052b68ae37198d3302ca58db6e0ec59b`. This work extends the audit closure; it does not certify external capabilities E01–E11. Apply migrations through the existing migration runner before starting the new API and worker. `0050` adds privacy archive chunks and a backwards-compatible manifest count; `0051` adds nullable outbox sampling flags. Existing inline privacy archives and historical outbox rows remain readable.

## Internal funding and returns

Customers can pay a complete pending booking invoice with existing user credits from My Bookings. The server derives the amount and performs the existing atomic funding operation. There is no credit-plus-card checkout in this change.

Finance users can submit `refunds.refundInternalFunding` from the refunds dashboard or airline console. The command requires a finance approval reference, a reason, a UUID and an amount in SAR minor units. Platform administrators may act across tenants; airline administrators and finance users require the same non-null tenant as the booking. Authorization is checked again on replay. The approval reference is an operator assertion recorded with the actor, not a fabricated provider receipt or a separate four-eyes approval workflow.

The command only accepts an unflown, unchecked-in, unmodified booking with exactly one original full-invoice `user_credit` or `corporate_credit` charge. External payment receipts, unrelated ledger movements and inconsistent allocations require reconciliation. Returns restore the original credit lots without changing expiry, or reduce the original corporate account exposure. They append a linked ledger receipt and an outbox event in the same transaction. Concurrent replay returns one receipt. The UI retains the submitted body and UUID after an ambiguous failure so a retry cannot create a second financial instruction.

Partial returns retain the itinerary and inventory. Returning the entire remaining amount requires explicitly cancelling the **whole itinerary**. This is not a segment-only refund algorithm. Cash totals exclude internal funding and its returns; reports show those movements separately. Wallet cash, mixed tender, receivable collection, automatic fare-policy approval and external payouts remain outside this authority.

## Revenue and advisory reads

Yield reads use funded active segment membership and accepted flight-cost evidence. The source is re-authorized on every read. Missing or revoked evidence returns unavailable coverage and null distance, revenue and derived values. Numeric airport IDs are no longer treated as geographic coordinates. The passenger basis is funded membership; this is a planning measure, not certified carried-passenger RPK or revenue recognition. The dashboard displays source failures and allows retry instead of displaying zeros.

The reaccommodation advisory retains the exact primary assignment. It may add two distinct contingency plans by excluding explicitly listed candidate flights and solving those subsets with the same objective. The search is bounded to eight additional solves and declares truncation. These are outage contingencies, not a proof of the three globally cheapest assignments. No plan writes seats. Booking-level execution still uses the existing servicing authority and may differ from the individual-passenger advisory.

Crew replacement assessment loads accepted rules once and assignment history once for the candidate group. The shared duty evaluator supplies both individual and batch decisions; write-time assignment still locks and rechecks eligibility. Limits are 500 candidates, 10,000 history rows and 1,000 history rows per crew member. Exceeding a limit fails explicitly. The complete replacement lookup also reads the target flight and candidate pool, so it is four reads rather than two.

## Privacy archive lifecycle

The worker uses keyset pages of 25 rows and stores 64 KiB binary chunks as base64, with per-chunk and whole-document SHA-256. It publishes the immutable manifest and the completed request in one transaction. The authenticated HTTP route streams verified chunks with backpressure and private/no-store headers. An interrupted or corrupt archive terminates the download. Expired chunks and manifests are removed together. Existing inline archives remain readable.

JSON exports declare version 3.0; the CSV section layout is retained. The supported archive limit is 512 MiB, and bookings exceeding 10,000 passengers require an assisted export. The compatibility in-process download reader retains a 16 MiB limit; the HTTP route supports the larger streamed archive. The long repeatable-read export transaction and database storage are explicit current limits; this is not an object-store archive service.

This change scales the existing subject inventory. It does not declare that inventory legally exhaustive and does not enable erasure. Actual erasure still reports `RETENTION_REVIEW_REQUIRED` until the operator approves subject mapping and retention policy.

## Optional distributed tracing

Tracing is disabled by default, including when `AIS_OTEL_ENABLED` is empty. To enable it, provide the same configuration to the API and worker:

| Setting                              | Meaning                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `AIS_OTEL_ENABLED=true`              | Enable the private OpenTelemetry provider                                 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Full OTLP/HTTP JSON traces endpoint; HTTPS required in production         |
| `OTEL_EXPORTER_OTLP_HEADERS`         | Optional exporter authentication headers from the deployment secret store |
| `OTEL_TRACES_SAMPLER_ARG`            | Root sampling ratio from 0 to 1; default 0.1                              |

Explicit spans cover HTTP requests, scheduled worker tasks, outbox consumption, and outbox/on-call/weather HTTP calls. Stored trace ID, parent span ID and sampling bit connect an outbox consumer to its producer across process boundaries. Unsampled parents remain unsampled. Legacy rows with unknown flags are not exported. Provider spans measure latency until response headers; they do not measure streamed response-body time. SQL statements and uninstrumented providers do not automatically acquire spans.

Attributes exclude URLs, request bodies, headers, user/booking IDs and error text. The provider coexists with Sentry without replacing its global registration. Export is batched with bounded queues and is flushed on orderly shutdown. Local tests use a real HTTP collector and verify exported parent relationships and suppression of unsampled traces. No production collector, dashboard, retention policy or external trace acceptance is supplied or certified here.

Reference: [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/) and [exporters](https://opentelemetry.io/docs/languages/js/exporters/).

## Repository protection prerequisites

`.github/main-ruleset.json` is a prepared policy, not evidence that GitHub enforces it. It requires review, resolution of conversations, current-base checks from the GitHub Actions app, and prevents force pushes/deletion. `node scripts/ci/verify-main-protection.mjs` reads the current main SHA before and after inspection and fails if required rules are absent or the release workflow is incompatible. It never writes repository settings. Reading organization/repository bypass actors separately requires administrative access.

At the verified base, `main` reported `protected: false`, and it still did on 21 September 2026 (`rules/branches/main` empty). The release workflow used to push version commits directly to main with `GITHUB_TOKEN`, which no ruleset could allow without a bypass; that dependency is now removed rather than hidden.

### Release flow that the ruleset allows

`Release Automation` no longer writes to `main`. It has two phases, both recognised by content rather than by commit message:

1. **Propose.** When `main` carries releasable commits since the last tag, or on a manual dispatch, the workflow commits the version bump and changelog to `release/vX.Y.Z`, proves that commit touches only `package.json` and `CHANGELOG.md`, pushes the branch and opens a pull request titled `chore: release vX.Y.Z` (the PR title check rejects a `release` scope, so the scope is omitted). A branch and pull request created with `GITHUB_TOKEN` start no workflow on their own, so the workflow then starts `ci-cd.yml`, `production-gates.yml`, `component-labs.yml` and `docker-image-validation.yml` on the release branch with `workflow_dispatch`, the one event that token may raise; their check runs attach to the branch head, which is the pull request head. Only one `release/v*` branch may exist at a time; a second proposal is skipped with a notice until the open one is merged or deleted. Deploy jobs in `ci-cd.yml` stay gated on a push to their branch and never run from a dispatch.
2. **Publish.** When the tip of `main` is a merged release commit (only `package.json` and `CHANGELOG.md` changed against its first parent, version bumped, tag absent), the workflow verifies exactly that with `release-publication.js`, tags that commit (`RELEASE_MERGED_SHA`, not whatever `main` points at by then), and creates the GitHub release from the changelog's top section. `resume_tag` still republishes an existing tag.

The release pull request needs the same approval as any other, from a collaborator other than its last pusher. With `require_last_push_approval` and one required approval, the repository's two collaborators can approve each other's pull requests but not their own; the release bot's pull requests can be approved by either. Do not grant the bot a bypass.

### Activating the policy

Activation writes repository settings and therefore needs a token with repository administration write access; the CI token never has it, and neither does the tooling that prepared this policy. An administrator runs, from a checkout of `main`:

```bash
GITHUB_TOKEN=<fine-grained token: Administration read/write on this repository> \
  node scripts/ci/apply-main-protection.mjs --dry-run   # shows POST or PUT and the payload
GITHUB_TOKEN=<same token> node scripts/ci/apply-main-protection.mjs
node scripts/ci/verify-main-protection.mjs              # independent read-back
```

The apply script creates the ruleset named in `.github/main-ruleset.json` or updates the existing one of that name in place, never deletes anything, and exits non-zero if the live rules for `main` still lack any required rule. Merge the release-flow change before activating; a policy activated first would block the old workflow's direct push, and a release proposal opened by the old workflow would not exist.

Reference: [GitHub repository rules REST API](https://docs.github.com/en/rest/repos/rules), [workflow_dispatch from GITHUB_TOKEN](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow).

## Verification

The live acceptance gate adds original-credit restoration, corporate restoration, duplicate commands, foreign finance rejection, cash/noncash separation, accepted/revoked revenue evidence, batch duty equivalence, and a streamed Arabic archive larger than 16 MiB. It uses disposable MySQL/Redis and synthetic evidence with zero provider calls.

CI runs eleven Chromium journeys: the existing two smoke tests plus booking/replay, credit checkout, partial/full finance returns, unauthorized mutations, authenticated privacy download, source failure, unavailable biometrics and empty kiosks. Fixture writes require test mode, an explicit disposable-database flag, a loopback host and a database name ending in `_test`. Failure to register accounts through the real authentication service fails setup. Local type-checking or test discovery is not a substitute for executing those browser journeys; consult the current PR SHA and its E2E job before declaring them passed.

### Browser-gate follow-up

The first CI head (`e74d4a7`) failed nine browser journeys. There were distinct causes:

- The custom Rollup policy declared every JavaScript module side-effect-free, dropping the side-effect-only i18n bootstrap from the production bundle. Screens reading `i18n.language` then failed to render. Keep the normal side-effect analysis; the home smoke now asserts translated text, not just visibility of an untranslated key. This failure reproduced locally with the production build after authentication setup was corrected.
- Repeated UI logins across parallel tests/retries exhausted the real five-attempt IP quota. Global setup now performs two real UI logins and reuses their authenticated cookies in isolated browser contexts. Session state is temporary, mode `0600`, outside uploaded result directories, and deleted after the run. No production limiter is disabled or widened.
- Authenticated cookie consent is server-authoritative. Setup records essential-only preferences through the real writer; localStorage preparation applies only to anonymous pages.
- Without an accepted biometric adapter the correct response is `PRECONDITION_FAILED`, not an empty event list. The browser test verifies that rejection and the visible unavailable/retry state, and rejects a false empty state. Empty/populated event envelopes remain covered by the separate consumer contract tests. This is not hardware acceptance.

Credit checkout must reach the server-confirmed paid UI state before the replay probe, so an API replay cannot hide a broken payment button. Failed booking reads now show an error and retry rather than a false empty list; disabling that rendering guard fails two regression tests.

The eleven journeys subsequently passed locally with two Chromium workers against freshly migrated MySQL and Redis, using the production bundle. The local browser binary was Chromium 153.0.8010.0; CI still uses its pinned Playwright-managed browser. Local evidence does not substitute for the new SHA's GitHub Actions results.

`docs/audits/2026-09-15-project-hardening-verification.json` records local gates and remaining limits. CI results are separate and must be read on the published head.
