#!/usr/bin/env bash
# Dry run by default.
# Section A: the tip must be the head commit of a merged pull request, so the
#            branch is restorable from that PR page.
# Section B: the tip must have an exact remote archive/<name> copy.
set -euo pipefail
list=${1:?list file required}
apply=${2:-}
[[ -z "$apply" || "$apply" == '--apply' ]] || { echo 'Unknown mode' >&2; exit 2; }
repo=${GITHUB_REPOSITORY:-kafaat/ais-aviation-system}
owner=${repo%%/*}
section=""
deleted=0; skipped=0; kept=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    '## A') section=A; continue ;;
    '## B') section=B; continue ;;
    ''|\#*) continue ;;
  esac
  [[ "$section" == A || "$section" == B ]] || { echo 'Candidate outside a known section' >&2; exit 2; }
  name=$line
  git check-ref-format "refs/heads/$name" >/dev/null || exit 2
  if [[ "$name" == main || "$name" == archive/* ]]; then
    echo "keep $name (protected name)"; kept=$((kept+1)); continue
  fi
  open_heads=$(gh api "repos/$repo/pulls?state=open&per_page=100" --paginate --jq '.[].head.ref')
  if grep -Fxq -- "$name" <<<"$open_heads"; then
    echo "keep $name (open PR)"; kept=$((kept+1)); continue
  fi
  # The same remote view the force-with-lease push is checked against.
  refs=$(git ls-remote --heads "https://github.com/$repo.git")
  tip=$(awk -v r="refs/heads/$name" '$2==r{print $1}' <<<"$refs")
  archived=$(awk -v r="refs/heads/archive/$name" '$2==r{print $1}' <<<"$refs")
  if [[ -z "$tip" ]]; then echo "skip $name (absent)"; skipped=$((skipped+1)); continue; fi
  if [[ ! "$tip" =~ ^[a-f0-9]{40}$ ]]; then
    echo "keep $name (unreadable tip)"; kept=$((kept+1)); continue
  fi
  if [[ "$section" == A ]]; then
    # A merged PR alone does not prove the branch has not advanced since: the
    # current tip itself must be the head of a merged PR from this branch.
    merged_heads=$(gh api "repos/$repo/pulls?state=closed&head=$owner:$name&per_page=100" --paginate \
      --jq '.[] | select(.merged_at != null) | .head.sha')
    if ! grep -Fxq -- "$tip" <<<"$merged_heads"; then
      echo "keep $name (tip is not the head of a merged PR)"; kept=$((kept+1)); continue
    fi
  elif [[ "$archived" != "$tip" ]]; then
    echo "keep $name (exact archive copy required)"; kept=$((kept+1)); continue
  fi
  if [[ "$apply" == '--apply' ]]; then
    # Recheck after the lookups: a PR or ref change during candidate inspection
    # must stop deletion. The push lease separately protects the head.
    open_heads=$(gh api "repos/$repo/pulls?state=open&per_page=100" --paginate --jq '.[].head.ref')
    fresh_refs=$(git ls-remote --heads "https://github.com/$repo.git")
    fresh_tip=$(awk -v r="refs/heads/$name" '$2==r{print $1}' <<<"$fresh_refs")
    fresh_archive=$(awk -v r="refs/heads/archive/$name" '$2==r{print $1}' <<<"$fresh_refs")
    if grep -Fxq -- "$name" <<<"$open_heads" || [[ "$fresh_tip" != "$tip" ]] \
      || [[ "$section" == B && "$fresh_archive" != "$tip" ]]; then
      echo "keep $name (PR or refs changed during inspection)"; kept=$((kept+1)); continue
    fi
    git push --porcelain --force-with-lease="refs/heads/$name:$tip" \
      "https://github.com/$repo.git" ":refs/heads/$name" || exit 1
    echo "delete $name"
  else
    echo "would $name at $tip"
  fi
  deleted=$((deleted+1))
done < "$list"
echo "summary: ${apply:-dry-run} candidates=$deleted skipped=$skipped kept=$kept"
