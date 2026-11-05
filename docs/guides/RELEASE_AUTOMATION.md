# Release automation

Release Automation proposes a reviewed version change on `release/vX.Y.Z`.
After that proposal is merged, it publishes the tag and GitHub Release from the
exact merged commit. The publication verifier permits only the package version
and changelog to differ from the parent source.

## Refreshing an open proposal

An automatic run reuses the one unpublished release branch when its version is
compatible with the required bump. It regenerates the complete notes from the
latest published tag through that run's source commit, incorporates the source
tree, and updates the existing pull request. A higher required release scope or
a conflicting manual version fails with an explanation so the proposal can be
reviewed. It does not silently create competing release branches.

Documentation-only main changes also refresh a manually selected open proposal,
even when the unpublished commit range does not call for an automatic bump.

The new changelog section records its source SHA and has a generated block:

```markdown
## What's Changed in v1.38.0

<!-- ais-release-source: FULL_40_CHARACTER_SOURCE_SHA -->
<!-- ais-release-notes:start -->

Generated changes and comparison link.

<!-- ais-release-notes:end -->

Reviewer-authored upgrade notes belong here, outside the generated block.
```

Refresh replaces only the generated block and its source marker. It preserves
reviewer notes outside that block and every previously published changelog entry.
The PR description has its own `ais-release-proposal` markers; text outside those
markers is also preserved. Checks and review boxes are reset for the refreshed
source rather than asserted to have passed.

Each refresh retains the prior proposal head as a parent and pushes normally.
Concurrent branch changes therefore cannot be overwritten. A queued run whose
source is no longer current main does not prepare an obsolete proposal. If main
advances later during preparation, the push fails and the newer run or a manual
rerun can continue. Recovery reuses an identical prepared commit and only starts
missing checks for that exact head.

Older proposals without these markers, edits to published history, or unrelated
code changes on the proposal branch are rejected. Review and migrate such a
proposal before enabling refresh, or retire the unpublished proposal and create
a replacement. Do not move an existing release tag to recover publication.

## Stable releases and prereleases

The optional custom version accepts a bare version or one leading `v`. Versions
must advance the current package version. Invalid versions, downgrades and equal
versions are rejected before any proposal is written.

- A custom `1.38.0` with **Create as prerelease** selected becomes
  `1.38.0-rc.YYYYMMDDHHmm`.
- A custom `1.38.0-beta.2` retains that suffix even when the checkbox is clear.
- A custom `1.38.0` without the checkbox remains stable.

The reviewed package version carries prerelease intent across the proposal and
merge runs; a later push does not need the original dispatch inputs. Refresh
reuses an open prerelease's existing identifier instead of minting another
timestamp. To promote a published prerelease to its stable version, request that
explicit higher stable version after the prerelease proposal has completed.

## Optional release deployment

When `DEPLOYMENT_PAT` is configured, publication of a stable release requests
`ci-cd.yml` with `workflow_dispatch` on the exact tag and passes both `release_tag`
and `release_commit`. The token needs permission to dispatch Actions workflows
in this repository. There is no fallback to `GITHUB_TOKEN`.

The CI workflow verifies the event ref, event SHA, checkout, remote tag, main
ancestry, version-only release commit and published stable GitHub Release before
the quality, build and deployment graph proceeds. Production deployment also
waits for browser acceptance. Existing production environments, credentials,
approval rules and deployment method still apply. Concurrent deployments to each
production environment are serialized.

Immediately before production changes, inside that environment's job lock, the
workflow requires the requested commit to remain the current `main` head. An
older queued push or tag run therefore cannot deploy after a newer main revision
has superseded it. This path does not authorize rollback. Two eligible runs of
the same current SHA may still repeat deployment; concurrency does not deduplicate
them, and a skipped job is not treated as an application receipt.

An ordinary manual CI run with both fields empty runs checks only. A partial or
invalid deployment request fails. Missing optional credentials are reported as
skipped deployment, and no production-success notification is sent for that
case. A successful dispatch or release publication alone is not deployment
evidence; inspect the actual migration, rollout and smoke-test steps.

This consumer is available only in release tags that contain these workflow
changes. Previously published tags such as `v1.37.0` do not contain the new
inputs and must not be used to exercise this dispatch contract.

## Verification and recovery

The focused regression suites are:

```bash
pnpm exec vitest run --project server \
  server/__tests__/scripts/release-publication.test.ts \
  server/__tests__/scripts/release-version.test.ts \
  server/__tests__/scripts/release-proposal-version.test.ts \
  server/__tests__/scripts/release-proposal.test.ts \
  server/__tests__/scripts/release-deployment.test.ts \
  server/__tests__/ci-workflow-hardening.test.ts
```

These use isolated Git repositories and HTTP fixtures. They do not publish
releases or deploy infrastructure. The repository's full required checks remain
the acceptance gate for the actual PR head.

If a tag was created but GitHub Release creation was interrupted, use the
existing `resume_tag` and exact `resume_commit` inputs. That path re-verifies the
tag and commit and avoids another version bump. It does not automatically retry
an infrastructure deployment.
