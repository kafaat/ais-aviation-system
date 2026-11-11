#!/usr/bin/env bash
# Delete the remote branches listed in branch-prune-<date>.txt through the
# GitHub REST API. Run by a maintainer whose token may delete refs; the cloud
# session that prepared the list could not (HTTP 403 on every delete).
#
#   scripts/ops/prune-branches.sh scripts/ops/branch-prune-2026-11-11.txt          # dry run
#   scripts/ops/prune-branches.sh scripts/ops/branch-prune-2026-11-11.txt --apply  # delete
#
# Never deletes main, any archive/* branch, or a branch with an open pull
# request. Section B branches are deleted only if their archive/<name> copy
# exists on the remote with the same tip.
set -euo pipefail
list=${1:?list file required}
apply=${2:-}
repo=${GITHUB_REPOSITORY:-kafaat/ais-aviation-system}

open_heads=$(gh api "repos/$repo/pulls?state=open&per_page=100" --jq '.[].head.ref')
remote_refs=$(gh api "repos/$repo/git/matching-refs/heads/" --paginate --jq '.[] | "\(.ref) \(.object.sha)"')

section=""
deleted=0; skipped=0; kept=0
while IFS= read -r line; do
  case "$line" in
    "## A") section=A; continue ;;
    "## B") section=B; continue ;;
    ""|\#*) continue ;;
  esac
  name=$line
  if [[ "$name" == "main" || "$name" == archive/* ]]; then echo "keep   $name (protected name)"; kept=$((kept+1)); continue; fi
  if grep -qx "$name" <<<"$open_heads"; then echo "keep   $name (open pull request)"; kept=$((kept+1)); continue; fi
  tip=$(awk -v r="refs/heads/$name" '$1==r{print $2}' <<<"$remote_refs")
  if [[ -z "$tip" ]]; then echo "skip   $name (already gone)"; skipped=$((skipped+1)); continue; fi
  if [[ "$section" == B ]]; then
    archived=$(awk -v r="refs/heads/archive/$name" '$1==r{print $2}' <<<"$remote_refs")
    if [[ "$archived" != "$tip" ]]; then echo "keep   $name (archive copy missing or stale: ${archived:-none})"; kept=$((kept+1)); continue; fi
  fi
  if [[ "$apply" == "--apply" ]]; then
    gh api -X DELETE "repos/$repo/git/refs/heads/$name" >/dev/null && echo "delete $name" || { echo "FAIL   $name"; kept=$((kept+1)); continue; }
  else
    echo "would  $name"
  fi
  deleted=$((deleted+1))
done < "$list"
echo "summary: ${apply:-dry-run} candidates=$deleted skipped=$skipped kept=$kept"
