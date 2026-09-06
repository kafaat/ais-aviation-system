#!/usr/bin/env bash
# Build the actual production and migrator targets. Never push or use deployment secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."
evidence_dir="${EVIDENCE_DIR:-/tmp/ais-docker-build-evidence}"
mkdir -p "$evidence_dir"
container=""
cleanup() {
  if [[ -n "$container" ]]; then
    docker logs "$container" > "$evidence_dir/runtime.log" 2>&1 || true
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

git rev-parse HEAD | tee "$evidence_dir/source-sha.txt"
docker version > "$evidence_dir/docker-version.txt"
for target in runner migrator; do
  docker build --pull --progress=plain --file Dockerfile.prod \
    --target "$target" --tag "ais-build-check:$target" . \
    2>&1 | tee "$evidence_dir/build-$target.log"
  docker image inspect "ais-build-check:$target" > "$evidence_dir/image-$target.json"
  test "$(docker run --rm --network none --entrypoint id "ais-build-check:$target" -u)" = 1001
 done

# Check the installed CLI, not a tool fetched by npx on demand.
docker run --rm --network none --entrypoint sh ais-build-check:migrator -ec '
  expected="$(node -p '\''require("./package.json").packageManager.split("@")[1]'\'')"
  test "$(pnpm --version)" = "$expected"
  test "$(pnpm config get shamefully-hoist)" = true
  test -s drizzle/migrations/meta/_journal.json
  ./node_modules/.bin/drizzle-kit --version
' | tee "$evidence_dir/migrator-cli.log"

# Fail when the runtime only works because build tools were copied into it.
docker run --rm --network none --entrypoint node ais-build-check:runner --input-type=module -e '
  import { accessSync } from "node:fs";
  import { createRequire } from "node:module";
  import assert from "node:assert/strict";
  const require = createRequire(import.meta.url);
  for (const file of ["dist/index.js", "dist/worker.js", "dist/public/index.html"]) accessSync(file);
  assert.throws(() => require.resolve("vite"), { code: "MODULE_NOT_FOUND" });
  console.log("PASS: compiled artifacts present; Vite absent from runtime dependencies");
' | tee "$evidence_dir/runtime-artifacts.log"

# No external network, real payment keys or databases. This checks image boot and
# static serving, NOT readiness, DB migrations, authentication or financial correctness.
# The repository's legacy admin-only HEALTHCHECK is outside this build-fix scope.
container="$(docker run -d --network none --no-healthcheck \
  -e NODE_ENV=production -e PORT=3000 \
  -e VITE_APP_ID=ais-image-smoke -e OWNER_OPEN_ID=image-smoke \
  -e JWT_SECRET=image-smoke-only-not-a-deployment-key \
  -e DATABASE_URL=mysql://image:image@127.0.0.1:3306/image_smoke \
  -e OAUTH_SERVER_URL=http://127.0.0.1:8000 \
  -e AUTH_SERVICE_URL=http://127.0.0.1:8000 \
  -e BUILT_IN_FORGE_API_URL=http://127.0.0.1:9 \
  -e BUILT_IN_FORGE_API_KEY=image-smoke-placeholder \
  ais-build-check:runner)"
for attempt in $(seq 1 45); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container")" != true ]]; then
    docker logs "$container"
    echo 'FAIL: production image exited before serving HTTP' >&2
    exit 1
  fi
  if docker exec "$container" node --input-type=module -e '
    import assert from "node:assert/strict";
    const response = await fetch("http://127.0.0.1:3000/", {signal: AbortSignal.timeout(1500)});
    assert.equal(response.status, 200);
    assert.match(await response.text(), /id="root"/);
    const health = await fetch("http://127.0.0.1:3000/api/trpc/health.live", {signal: AbortSignal.timeout(1500)});
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal((payload.result.data.json ?? payload.result.data).alive, true);
  ' > "$evidence_dir/http-check.log" 2>&1; then
    echo 'PASS: production image boots as non-root and serves HTML + liveness' | tee "$evidence_dir/result.txt"
    exit 0
  fi
  sleep 1
done
cat "$evidence_dir/http-check.log" >&2
echo 'FAIL: image HTTP smoke timed out' >&2
exit 1
