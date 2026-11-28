#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "$0")/ci/deployment-probes.py" smoke "${1:-http://localhost:3000}"
