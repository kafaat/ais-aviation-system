# Branch consolidation, 11 November 2026

Requested by the owner after the Wave A test PRs were folded into one (#336):
close the open branches to avoid conflicts. The remote carried 249 branches
beside `main`; only one had an open pull request.

## What was done from the cloud session

| Group                                                             | Count | Action taken                                                                           |
| ----------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------- |
| A. Content already on `main` through a merged pull request        | 201   | Listed for deletion (restorable from each PR page)                                     |
| B. Diverged after their merged PR, closed without merge, or no PR | 46    | Copied to `archive/<name>` at the same tip, then listed for deletion                   |
| Kept                                                              | 3     | `main`, `claude/wave-a-consolidated` (#336), `archive/release-v1.31.3-orphan-20261021` |

The classification is in `scripts/ops/branch-prune-2026-11-11.txt` (section A
and section B). Group B includes the four branches superseded by #336, the
five whose tip moved after their PR merged (among them
`claude/project-exploration-JWCKA`), twenty closed-unmerged PR branches and the
reference branches of early November that never had a pull request.

**Deletion could not be performed from the session**: every delete, through
the git proxy and through the REST API, returned HTTP 403. The repository
ruleset restricts deletion on `main` only, so the limit is the session's
credential. A maintainer runs:

```bash
scripts/ops/prune-branches.sh scripts/ops/branch-prune-2026-11-11.txt          # dry run
scripts/ops/prune-branches.sh scripts/ops/branch-prune-2026-11-11.txt --apply  # delete
```

The script never deletes `main`, an `archive/*` branch or a branch with an open
pull request. It deletes a section A branch only while its current tip is the
head commit of a merged pull request from that branch (so the PR page can
restore it), and a section B branch only when its `archive/<name>` copy exists
at the same tip.

## Restoring a branch

- Group A: the pull request page offers "Restore branch".
- Group B: `git fetch origin archive/<name>` and recreate it, or work from the
  archive branch directly.

## Conventions after the consolidation

- One topical branch per change, deleted after its squash merge.
- Reference or exploratory work that is not meant to merge lives under
  `archive/` from the start, so it never looks like pending work.
- Release Automation reads only `release/v*`; nothing here touches it.

## Review hardening

A merged PR does not prove its branch has not advanced, so the script checks the
tip itself: a section A branch is deleted only while its current tip is the head
commit of a merged PR from that branch, and a section B branch only with an exact
remote `archive/<name>` copy. The owner chose this over archiving section A as
well (which would have kept about 248 `archive/*` branches permanently). Refresh
all pages of open PRs and refs for each candidate; explicit Git force-with-lease
refuses a moving tip. No deletions run in CI or this review. Archive creation and
deletion remain separate operator actions. GitHub has no atomic open-PR-and-delete
transaction: a concurrently opened PR remains a residual race; use an exclusive
maintenance window for apply and retain the section B archives.
