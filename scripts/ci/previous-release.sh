#!/usr/bin/env bash
set -euo pipefail
candidate=$(git rev-parse HEAD)
selected=""
while IFS= read -r tag; do
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  sha=$(git rev-parse "$tag^{commit}")
  [[ "$sha" != "$candidate" ]] || continue
  selected="$tag"
  break
done < <(git tag --merged HEAD --sort=-version:refname)
[[ -n "$selected" ]] || { echo 'No older stable release reachable from candidate' >&2; exit 1; }
printf 'tag=%s\nsha=%s\ncandidate=%s\n' "$selected" "$sha" "$candidate"
