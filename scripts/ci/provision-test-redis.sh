#!/usr/bin/env bash
set -euo pipefail

# Build an immutable upstream checkout for tests that own their Redis process.
# Do not reuse a shared Redis URL, install globally, or write into the checkout.
readonly redis_commit=7e0f53393290f7c1f35596117b67748efad16580
readonly redis_version=7.4.5
: "${RUNNER_TEMP:?RUNNER_TEMP must identify the runner temporary directory}"
: "${GITHUB_ENV:?GITHUB_ENV must identify the runner environment file}"

if [[ "$RUNNER_TEMP" != /* || "$RUNNER_TEMP" == *$'\n'* || "$RUNNER_TEMP" == *$'\r'* ]]; then
  echo "RUNNER_TEMP must be an absolute single-line path" >&2
  exit 1
fi
tool_parent="$(realpath -- "$RUNNER_TEMP")"
checkout_root="$(git rev-parse --show-toplevel)"
readonly tool_parent checkout_root
if [[ "$tool_parent" == "$checkout_root" || "$tool_parent" == "$checkout_root/"* ]]; then
  echo "Native Redis test tools must remain outside the tested checkout" >&2
  exit 1
fi
source_root="$(mktemp -d "$tool_parent/ais-test-redis.XXXXXX")"
readonly source_root

git -C "$source_root" init --quiet
git -C "$source_root" remote add origin https://github.com/redis/redis.git
git -C "$source_root" fetch --no-tags --depth=1 origin "$redis_commit"
git -C "$source_root" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$source_root" rev-parse HEAD)" = "$redis_commit"
make -C "$source_root/src" -j2 MALLOC=libc BUILD_TLS=no REDIS_CFLAGS= REDIS_LDFLAGS= redis-server

readonly redis_binary="$source_root/src/redis-server"
actual_version="$("$redis_binary" --version)"
readonly actual_version
if [[ "$actual_version" != "Redis server v=$redis_version "* ]]; then
  echo "The native Redis binary did not report the pinned version" >&2
  exit 1
fi

# This is tool provenance, not a project acceptance receipt. The subsequent
# suites must start their own loopback server and verify the actual behavior.
node --input-type=module - "$redis_binary" "$redis_commit" "$actual_version" "$tool_parent/native-redis-tool.json" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const [binary, sourceCommit, version, receipt] = process.argv.slice(2);
const data = {
  source: "https://github.com/redis/redis",
  sourceCommit,
  version,
  binary,
  binarySha256: createHash("sha256").update(readFileSync(binary)).digest("hex"),
  build: "make -C src -j2 MALLOC=libc BUILD_TLS=no REDIS_CFLAGS= REDIS_LDFLAGS= redis-server",
  scope: "owned native Redis test binary; project acceptance follows separately",
};
writeFileSync(receipt, JSON.stringify(data, null, 2) + "\n");
process.stdout.write(JSON.stringify(data) + "\n");
NODE

# Publish only after source, build, version and receipt verification succeed.
printf 'AIS_TEST_REDIS_SERVER_BIN=%s\n' "$redis_binary" >> "$GITHUB_ENV"
