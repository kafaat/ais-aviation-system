#!/usr/bin/env bash
set -euo pipefail
overlay=${1:?overlay required}
[[ "$overlay" == staging || "$overlay" == production ]] || exit 2
: "${SOURCE_SHA:?}" "${IMAGE_TAG:?}" "${AUTH_IMAGE_TAG:?}" "${NAMESPACE:?}" "${REPLICAS:?}" "${RUNNER_TEMP:?}"
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{7,40}$ ]] || exit 2
dir="$RUNNER_TEMP/ais-release-$overlay"
mkdir -p "$dir"
files=()
for source in k8s/base/configmap.yaml k8s/base/background.yaml k8s/base/deployment.yaml k8s/base/service.yaml "k8s/overlays/$overlay/ingress.yaml"; do
  target="$dir/$(basename "$source")"
  envsubst '${SOURCE_SHA} ${IMAGE_TAG} ${AUTH_IMAGE_TAG} ${NAMESPACE} ${REPLICAS}' < "$source" > "$target"
  files+=("$target")
done
python3 scripts/ci/k8s-release-set.py apply "$NAMESPACE" "$dir/state.json" "${files[@]}"
