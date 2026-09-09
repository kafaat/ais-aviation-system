#!/usr/bin/env bash
# Build the actual production and migrator targets. Never push or use deployment secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."
evidence_dir="${EVIDENCE_DIR:-/tmp/ais-docker-build-evidence}"
mkdir -p "$evidence_dir"
container=""
negative_context=""
cleanup() {
  if [[ -n "$negative_context" ]]; then
    rm -rf "$negative_context"
  fi
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
  docker run --rm --network none --entrypoint sh "ais-build-check:$target" -ec '
    test ! -e /usr/local/lib/node_modules/npm
    test ! -e /usr/local/lib/node_modules/pnpm
    test ! -e /app/node_modules/pnpm
    for installer in npm npx pnpm pnpx; do
      if command -v "$installer" >/dev/null 2>&1; then
        echo "FAIL: deployed image contains installer $installer" >&2
        exit 1
      fi
    done
    node --version
  ' 2>&1 | tee "$evidence_dir/no-installers-$target.log"
done

# Check the installed CLI, not a tool fetched by npx on demand.
# The authoritative Drizzle root is ./drizzle; PR #115 deliberately archives the
# stale parallel drizzle/migrations tree under drizzle/legacy-migrations.
docker run --rm --network none --entrypoint sh ais-build-check:migrator -ec '
  if [ ! -s drizzle/meta/_journal.json ]; then
    echo "FAIL: authoritative migration journal missing at drizzle/meta/_journal.json" >&2
    exit 1
  fi
  ./node_modules/.bin/drizzle-kit --version
' 2>&1 | tee "$evidence_dir/migrator-cli.log"

# Exercise the actual guarded entrypoint and serializer without contacting a DB.
# Verify the installed dependency tree was created with the pinned build tool;
# the deployed image must not need that installer to run its migration code.
docker run --rm --network none --entrypoint node ais-build-check:migrator \
  --import tsx --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import { runMigration } from "./scripts/db/migrate.ts";
  import { assertSnapshotMatchesSchema } from "./scripts/db/snapshot-check.ts";
  const { packageManager } = JSON.parse(readFileSync("package.json", "utf8"));
  const modules = readFileSync("node_modules/.modules.yaml", "utf8");
  assert.ok(modules.split(/\r?\n/).includes(`packageManager: ${packageManager}`));
  assert.equal(typeof runMigration, "function");
  await assertSnapshotMatchesSchema();
  console.log("PASS: pinned dependency installation and guarded migrator work without installers");
' 2>&1 | tee "$evidence_dir/migrator-entrypoint.log"

# Fail when the runtime only works because build tools were copied into it.
docker run --rm --network none --entrypoint node ais-build-check:runner --input-type=module -e '
  import { accessSync, readFileSync } from "node:fs";
  import { createRequire } from "node:module";
  import assert from "node:assert/strict";
  const require = createRequire(import.meta.url);
  for (const file of ["dist/index.js", "dist/worker.js", "dist/public/index.html"]) accessSync(file);
  assert.equal(process.getuid(), 1001);
  assert.equal(process.env.NODE_ENV, "production");
  for (const name of ["express", "mysql2", "drizzle-orm"]) require.resolve(name);
  // Assert the installation mode, not absence of a package also needed as a peer.
  // The locked @trpc/server production dependency itself depends on TypeScript.
  const modules = readFileSync("node_modules/.modules.yaml", "utf8");
  const included = modules.match(/^included:\r?\n((?:[ \t]+[^\r\n]*\r?\n)+)/m)?.[1];
  assert.ok(included, "pnpm installation metadata must contain included flags");
  assert.match(included, /^  dependencies: true\r?$/m, "Runtime dependencies must be installed");
  assert.match(included, /^  devDependencies: false\r?$/m, "Root devDependencies must be excluded");
  for (const name of ["vite", "drizzle-kit"]) {
    assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" }, `Build-only dependency leaked: ${name}`);
  }
  const trpc = require("@trpc/server/package.json");
  console.log(`Runtime peer: TypeScript ${require("typescript/package.json").version}; @trpc/server requires ${trpc.peerDependencies.typescript}`);
  console.log("PASS: non-root runtime, compiled artifacts, production-only dependencies");
' 2>&1 | tee "$evidence_dir/runtime-artifacts.log"

# Keep negative pinning coverage in this canonical Docker check (formerly PR #89).
negative_context="$(mktemp -d)"
cp Dockerfile.prod package.json pnpm-lock.yaml .npmrc "$negative_context/"
for invalid in floating missing; do
  node --input-type=commonjs -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
    if (process.argv[2] === "floating") manifest.packageManager = "pnpm@latest";
    else delete manifest.packageManager;
    fs.writeFileSync(process.argv[1], JSON.stringify(manifest));
  ' "$negative_context/package.json" "$invalid"
  if docker build --progress=plain --file "$negative_context/Dockerfile.prod" \
    --target toolchain "$negative_context" > "$evidence_dir/reject-$invalid.log" 2>&1; then
    echo "FAIL: package-manager guard accepted $invalid version" >&2
    exit 1
  fi
  grep -F 'Error: packageManager must pin pnpm@x.y.z' "$evidence_dir/reject-$invalid.log"
done
rm -rf "$negative_context"
negative_context=""
echo 'PASS: floating and missing package-manager versions rejected before installation'

# No external network, real payment keys or databases. This checks image boot and
# static serving, NOT readiness, DB migrations, authentication or financial correctness.
# The repository's legacy admin-only HEALTHCHECK is outside this build-fix scope.
container="$(docker run -d --network none --no-healthcheck \
  -e NODE_ENV=production -e PORT=3000 \
  -e VITE_APP_ID=ais-image-smoke -e OWNER_OPEN_ID=image-smoke \
  -e JWT_SECRET=image-smoke-only-not-a-deployment-key \
  -e REFRESH_TOKEN_PEPPER=image-smoke-only-not-a-deployment-pepper \
  -e STRIPE_SECRET_KEY=sk_test_image_smoke_placeholder_not_real \
  -e STRIPE_WEBHOOK_SECRET=whsec_image_smoke_placeholder_not_real \
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
