#!/usr/bin/env bash
# Exercise the built auth image without host ports, live databases or providers.
set -euo pipefail
cd "$(dirname "$0")/../.."

auth_evidence_dir="${EVIDENCE_DIR:-/tmp/ais-docker-build-evidence}"
mkdir -p "$auth_evidence_dir"
auth_scratch_dir="$(mktemp -d)"
auth_unit_cid_file="$auth_scratch_dir/unit.cid"
auth_boot_cid_file="$auth_scratch_dir/boot.cid"
auth_boot_container=""
auth_stage="starting"
printf '{"passed":false,"stage":"starting"}\n' > "$auth_evidence_dir/auth-runtime.json"

cleanup() {
  local auth_exit_status=$?
  local auth_unit_container=""
  trap - EXIT INT TERM

  if [[ -z "$auth_boot_container" && -s "$auth_boot_cid_file" ]]; then
    auth_boot_container="$(< "$auth_boot_cid_file")"
  fi
  if [[ -n "$auth_boot_container" ]]; then
    if ! timeout 10s docker logs "$auth_boot_container" > "$auth_evidence_dir/auth-boot.log" 2>&1; then
      auth_exit_status=1
      auth_stage="cleanup"
    fi
    if ! timeout 10s docker rm -f "$auth_boot_container" >/dev/null 2>&1; then
      auth_exit_status=1
      auth_stage="cleanup"
    fi
  fi

  # --rm normally removes the test container. Retain its exact ID so a timed-out
  # docker client cannot leave an owned test process running in the background.
  if [[ -s "$auth_unit_cid_file" ]]; then
    auth_unit_container="$(< "$auth_unit_cid_file")"
    if [[ "$auth_unit_container" =~ ^[0-9a-f]{64}$ ]] && \
      timeout 5s docker container inspect "$auth_unit_container" >/dev/null 2>&1; then
      if ! timeout 10s docker rm -f "$auth_unit_container" >/dev/null 2>&1; then
        auth_exit_status=1
        auth_stage="cleanup"
      fi
    fi
  fi
  rm -f "$auth_unit_cid_file" "$auth_boot_cid_file"
  rmdir "$auth_scratch_dir"

  if (( auth_exit_status != 0 )); then
    python3 - "$auth_evidence_dir/auth-runtime.json" "$auth_stage" "$auth_exit_status" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
receipt = json.loads(path.read_text())
receipt.update(passed=False, failedStage=sys.argv[2], exitCode=int(sys.argv[3]))
path.write_text(json.dumps(receipt, indent=2) + "\n")
PY
    printf 'FAIL: auth image verification stopped at %s; inspect the saved evidence.\n' "$auth_stage" >&2
  fi
  exit "$auth_exit_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

auth_stage="image"
auth_source_sha="$(git rev-parse HEAD)"
auth_image_id="$(docker image inspect --format '{{.Id}}' ais-build-check:auth)"

auth_stage="unit-tests"
timeout --signal=TERM --kill-after=5s 90s \
  docker run --rm --pull never --network none --cidfile "$auth_unit_cid_file" \
    --entrypoint python "$auth_image_id" \
    -m unittest -v test_config test_http_contract \
  2>&1 | tee "$auth_evidence_dir/auth-unit.log"

# unittest can exit successfully after skipping tests; verify the actual result.
# Explicit module names work in the image's flat /app layout and exclude the
# repository-relative standalone public-registration source assertion.
python3 - "$auth_evidence_dir/auth-unit.log" "$auth_evidence_dir/auth-unit-summary.json" <<'PY'
import json
import re
import sys
from pathlib import Path

output = Path(sys.argv[1]).read_text()
counts = re.findall(r"^Ran (\d+) tests? in ", output, re.MULTILINE)
assert len(counts) == 1 and int(counts[0]) >= 11, "Expected at least eleven auth tests"
assert re.search(r"^OK\s*$", output, re.MULTILINE), "Auth tests failed or were skipped"
Path(sys.argv[2]).write_text(json.dumps({"passed": int(counts[0]), "skipped": 0}) + "\n")
PY

auth_stage="boot"
# No entrypoint or command override: this starts the image's actual Uvicorn CMD.
auth_boot_container="$(docker run -d --pull never --network none --cidfile "$auth_boot_cid_file" \
  -e JWT_SECRET=auth-image-smoke-signing-key-only-for-tests \
  -e AUTH_SERVICE_TOKEN=auth-image-smoke-service-token-only-for-tests \
  -e DATABASE_URL=sqlite:// \
  "$auth_image_id")"

auth_stage="http"
timeout --signal=TERM --kill-after=5s 50s \
  docker exec -i "$auth_boot_container" python - \
  > "$auth_evidence_dir/auth-http.json" 2> "$auth_evidence_dir/auth-http.log" <<'PY'
import json
import time
import urllib.error
import urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
deadline = time.monotonic() + 40
attempts = 0
while True:
    attempts += 1
    try:
        with opener.open("http://127.0.0.1:8000/auth/health", timeout=1) as response:
            health_status = response.status
            health = json.loads(response.read(8192))
        assert health_status == 200 and health["status"] == "healthy", "Invalid auth readiness response"
        break
    except urllib.error.HTTPError as error:
        raise AssertionError(f"Auth readiness returned HTTP {error.code}") from None
    except (urllib.error.URLError, OSError):
        # Retry connection startup only. HTTP errors or failed assertions fail
        # immediately instead of allowing a later request to hide a regression.
        if time.monotonic() >= deadline:
            raise AssertionError("Auth image did not start serving within 40 seconds") from None
        time.sleep(0.2)

request = urllib.request.Request(
    "http://127.0.0.1:8000/auth/login",
    data=json.dumps({"email": "image-smoke@example.com", "password": "ImageSmokeFixture123!"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with opener.open(request, timeout=2) as response:
        unauthorized_status = response.status
        unauthorized = json.loads(response.read(8192))
except urllib.error.HTTPError as error:
    unauthorized_status = error.code
    unauthorized = json.loads(error.read(8192))
assert unauthorized_status == 401, "Auth image accepted a request without its service credential"
assert unauthorized == {"detail": "Service credential required."}, "Unexpected unauthenticated auth response"
print(json.dumps({"healthStatus": health_status, "unauthorizedLoginStatus": unauthorized_status, "startupAttempts": attempts}))
PY

auth_stage="receipt"
docker inspect --format '{{json .Config.Cmd}}' "$auth_boot_container" > "$auth_evidence_dir/auth-command.json"
docker inspect --format '{{json .HostConfig.NetworkMode}}' "$auth_boot_container" > "$auth_evidence_dir/auth-network.json"
docker inspect --format '{{json .NetworkSettings.Ports}}' "$auth_boot_container" > "$auth_evidence_dir/auth-ports.json"
python3 - "$auth_evidence_dir" "$auth_source_sha" "$auth_image_id" <<'PY'
import json
import sys
from pathlib import Path

directory = Path(sys.argv[1])
read = lambda name: json.loads((directory / name).read_text())
network = read("auth-network.json")
ports = read("auth-ports.json") or {}
assert network == "none" and all(value is None for value in ports.values()), "Auth smoke must remain isolated"
receipt = {
    "passed": True,
    "sourceSha": sys.argv[2],
    "imageId": sys.argv[3],
    "command": read("auth-command.json"),
    "unitTests": read("auth-unit-summary.json"),
    "http": read("auth-http.json"),
    "network": network,
    "publishedPorts": False,
    "providerCalls": 0,
    "scope": "Built image runtime, synthetic credentials and SQLite; no live MySQL or external providers",
}
(directory / "auth-runtime.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
PY
auth_stage="completed"
