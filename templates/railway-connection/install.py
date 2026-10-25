#!/usr/bin/env python3
"""Materialize the template offline; refuses existing files. No network or credentials."""
import argparse
import hashlib
import json
from pathlib import Path

from verify import Invalid, read_json, validate_config

ROOT = Path(__file__).resolve().parent


def materialize(config_path, destination):
    config = validate_config(read_json(config_path))
    # Example UUIDs are fixtures, never installable targets.
    if any(config[k].startswith("00000000-") for k in ("project_id", "environment_id")):
        raise Invalid("REPLACE_EXAMPLE_TARGET_IDS")
    files = {
        "scripts/ci/railway_connection_verify.py": (ROOT / "verify.py").read_text(),
        "scripts/ci/test_railway_connection.py": (ROOT / "test_contract.py").read_text(),
        ".github/railway-connection.json": json.dumps(config, indent=2) + "\n",
        ".github/workflows/railway-connection.yml": (ROOT / "workflow.yml.template").read_text().replace("__PROJECT_TOKEN_SECRET__", config["secret_name"]),
        "docs/runbooks/RAILWAY_CONNECTION.md": (ROOT / "README.md").read_text(),
    }
    manifest = {"template_version": "1.0.0", "source_commit": "2f0786aa4bbb048b17a5b72095b20dd22657748c",
                "files": {p: hashlib.sha256(c.encode()).hexdigest() for p, c in sorted(files.items())}}
    files["railway-connection-manifest.json"] = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    destination = Path(destination)
    # Preflight every path before writing. Never traverse a symlink into another tree.
    for name in files:
        target = destination / name
        if target.exists() or target.is_symlink():
            raise Invalid("DESTINATION_FILE_EXISTS")
        if any(p.is_symlink() for p in (target.parent, *target.parents)):
            raise Invalid("DESTINATION_SYMLINK_FORBIDDEN")
    for name, content in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    try:
        materialize(args.config, args.destination)
    except (Invalid, OSError) as exc:
        print(str(exc) if isinstance(exc, Invalid) else "INSTALL_IO_FAILED")
        return 1
    print("TEMPLATE_CREATED: offline files only; connection proof pending")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
