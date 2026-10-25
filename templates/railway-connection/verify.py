#!/usr/bin/env python3
"""Portable read-only Railway CLI 5.63.1 identity verifier; Python 3.12+."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

MAX_BYTES = 2_000_000
SHA = re.compile(r"[0-9a-f]{40}")
KEYS = {"schema_version", "project_id", "environment_id", "environment_name",
        "environment_purpose", "allow_name_purpose_mismatch", "secret_name"}


class Invalid(ValueError):
    """Constant, secret-free diagnostic codes only."""


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Invalid("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def read_json(path):
    try:
        with Path(path).open("rb") as stream:
            data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise Invalid("JSON_TOO_LARGE")
        return json.loads(data.decode("utf-8"), object_pairs_hook=no_duplicates)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise Invalid("MALFORMED_JSON") from None


def validate_config(config):
    if not isinstance(config, dict) or set(config) != KEYS:
        raise Invalid("INVALID_CONFIG_FIELDS")
    if type(config["schema_version"]) is not int or config["schema_version"] != 1:
        raise Invalid("INVALID_CONFIG_VERSION")
    for key in ("project_id", "environment_id"):
        value = config[key]
        try:
            if not isinstance(value, str) or str(UUID(value)) != value or UUID(value).int == 0:
                raise Invalid("INVALID_TARGET_ID")
        except (ValueError, AttributeError):
            raise Invalid("INVALID_TARGET_ID") from None
    name = config["environment_name"]
    if not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}", name) is None:
        raise Invalid("INVALID_ENVIRONMENT_NAME")
    # This v1 deliberately supports staging connection proofs only.
    if config["environment_purpose"] != "staging":
        raise Invalid("UNAPPROVED_ENVIRONMENT_PURPOSE")
    approval = config["allow_name_purpose_mismatch"]
    if type(approval) is not bool:
        raise Invalid("INVALID_MISMATCH_APPROVAL")
    if name != "staging" and approval is not True:
        raise Invalid("NAME_PURPOSE_APPROVAL_REQUIRED")
    secret = config["secret_name"]
    if not isinstance(secret, str) or re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", secret) is None:
        raise Invalid("INVALID_SECRET_NAME")
    if secret.startswith("GITHUB_") or secret in {"RAILWAY_API_TOKEN", "RAILWAY_TOKEN"}:
        raise Invalid("FORBIDDEN_SECRET_NAME")
    return config


def validate_status(payload, source_sha, config):
    c = validate_config(config)
    if not isinstance(source_sha, str) or SHA.fullmatch(source_sha) is None:
        raise Invalid("INVALID_SOURCE_SHA")
    if not isinstance(payload, dict) or "error" in payload or "errors" in payload:
        raise Invalid("INVALID_STATUS")
    if payload.get("id") != c["project_id"]:
        raise Invalid("PROJECT_ID_MISMATCH")
    envs = payload.get("environments")
    edges = envs.get("edges") if isinstance(envs, dict) else None
    if not isinstance(edges, list) or len(edges) != 1:
        raise Invalid("ENVIRONMENT_SCOPE_MISMATCH")
    node = edges[0].get("node") if isinstance(edges[0], dict) else None
    if not isinstance(node, dict):
        raise Invalid("INVALID_ENVIRONMENT_SHAPE")
    if node.get("id") != c["environment_id"]:
        raise Invalid("ENVIRONMENT_ID_MISMATCH")
    if node.get("name") != c["environment_name"]:
        raise Invalid("ENVIRONMENT_NAME_MISMATCH")
    if node.get("canAccess") is not True:
        raise Invalid("ACCESS_NOT_PROVEN")
    return {
        "verdict": "CONNECTION_ONLY_PASS", "source_sha": source_sha,
        "project_id": c["project_id"], "environment_id": c["environment_id"],
        "environment_name": c["environment_name"], "scope": "staging",
        "environment_purpose": c["environment_purpose"],
        "name_purpose_mismatch": c["environment_name"] != c["environment_purpose"],
        "read_only": True, "deployment_performed": False,
        "migration_performed": False, "database_access_verified": False,
        "runtime_verified": False, "production_certified": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--status-json", type=Path)
    parser.add_argument("--source-sha")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--github-target", action="store_true")
    args = parser.parse_args()
    try:
        if not args.github_target and args.evidence is not None:
            args.evidence.unlink(missing_ok=True)
        config = validate_config(read_json(args.config))
        if args.github_target:
            # Strictly validated UUIDs, safe for GITHUB_OUTPUT.
            print("project_id=" + config["project_id"])
            print("environment_id=" + config["environment_id"])
            return 0
        if args.status_json is None or args.evidence is None:
            raise Invalid("MISSING_STATUS_OR_EVIDENCE")
        # Remove stale success before attempting a new proof.
        receipt = validate_status(read_json(args.status_json), args.source_sha, config)
        receipt.update(observed_at_utc=datetime.now(UTC).isoformat(),
                       verifier_sha256=digest(__file__), config_sha256=digest(args.config),
                       railway_cli_version="5.63.1", template_version="1.0.0")
        args.evidence.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (Invalid, OSError) as exc:
        print("::error::" + (str(exc) if isinstance(exc, Invalid) else "FILE_IO_FAILED"), file=sys.stderr)
        return 1
    print("CONNECTION_ONLY_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
