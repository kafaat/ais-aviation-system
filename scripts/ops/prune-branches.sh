#!/usr/bin/env bash
# Dry run by default. Every candidate requires an exact remote archive copy.
set -euo pipefail
list=${1:?list file required}
apply=${2:-}
[[ -z "$apply" || "$apply" == '--apply' ]] || { echo 'Unknown mode' >&2; exit 2; }
repo=${GITHUB_REPOSITORY:-kafaat/ais-aviation-system}
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
  refs=$(gh api "repos/$repo/git/matching-refs/heads/" --paginate --jq '.[] | "\(.ref) \(.object.sha)"')
  tip=$(awk -v r="refs/heads/$name" '$1==r{print $2}' <<<"$refs")
  archived=$(awk -v r="refs/heads/archive/$name" '$1==r{print $2}' <<<"$refs")
  if [[ -z "$tip" ]]; then echo "skip $name (absent)"; skipped=$((skipped+1)); continue; fi
  if [[ ! "$tip" =~ ^[a-f0-9]{40}$ || "$archived" != "$tip" ]]; then
    echo "keep $name (exact archive required for every section)"; kept=$((kept+1)); continue
  fi
  if [[ "$apply" == '--apply' ]]; then
    # Recheck after the archive lookup: a PR or archive change during candidate
    # inspection must stop deletion. The push lease separately protects the head.
    open_heads=$(gh api "repos/$repo/pulls?state=open&per_page=100" --paginate --jq '.[].head.ref')
    fresh_refs=$(gh api "repos/$repo/git/matching-refs/heads/" --paginate --jq '.[] | "\(.ref) \(.object.sha)"')
    fresh_tip=$(awk -v r="refs/heads/$name" '$1==r{print $2}' <<<"$fresh_refs")
    fresh_archive=$(awk -v r="refs/heads/archive/$name" '$1==r{print $2}' <<<"$fresh_refs")
    if grep -Fxq -- "$name" <<<"$open_heads" || [[ "$fresh_tip" != "$tip" || "$fresh_archive" != "$tip" ]]; then
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
