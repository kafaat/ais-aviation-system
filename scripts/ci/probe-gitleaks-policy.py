"""Exercise the real scanner with synthetic fixtures and nonfunctional controls."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
NATIVE_RECEIPT = (
    "docs/audits/ui-service-connectivity-20261105/"
    "evidence/native/attempt2/source-binding.json"
)
# Public build digests, independently verified against the recorded artifacts.
BUILD_DIGESTS = (
    "8453d7c793977453dbcc86f016d86aae87bf31d5adaa2e6a88bc756d640a45db",
    "13bacc1b352f6c25db5e63b5552657a881e1da77aab1c1e012a2d8f86945accc",
    "22fb6548cfa0b79f593e335da6c475a3d9228079d78eeb4f4e8e32e71be41b55",
)


def verify_receipt_allowlist(binary: str, config: Path) -> dict:
    control = hashlib.sha256(
        b"AIS synthetic nonfunctional receipt policy control v1"
    ).hexdigest()
    cases = {
        "native_public_js_digest": (
            NATIVE_RECEIPT,
            f'"dist/public/assets/vendor-api-BrN3R5s7.js": "{BUILD_DIGESTS[0]}"',
            [],
        ),
        "native_public_brotli_digest": (
            NATIVE_RECEIPT,
            f'"dist/public/assets/vendor-api-BrN3R5s7.js.br": "{BUILD_DIGESTS[1]}"',
            [],
        ),
        "native_public_gzip_digest": (
            NATIVE_RECEIPT,
            f'"dist/public/assets/vendor-api-BrN3R5s7.js.gz": "{BUILD_DIGESTS[2]}"',
            [],
        ),
        "different_value_in_receipt": (
            NATIVE_RECEIPT, f'"apiKey": "{control}"', [control]
        ),
        "different_value_on_digest_line": (
            NATIVE_RECEIPT,
            f'"apiKey": "{BUILD_DIGESTS[0]}", "password": "{control}"',
            [control],
        ),
        "known_digest_outside_receipt": (
            NATIVE_RECEIPT.replace("source-binding.json", "source-binding-copy.json"),
            f'"apiKey": "{BUILD_DIGESTS[0]}"',
            [BUILD_DIGESTS[0]],
        ),
        "prefixed_digest_is_not_exempt": (
            NATIVE_RECEIPT,
            f'"apiKey": "prefix{BUILD_DIGESTS[0]}"',
            ["prefix" + BUILD_DIGESTS[0]],
        ),
        "suffixed_digest_is_not_exempt": (
            NATIVE_RECEIPT,
            f'"apiKey": "{BUILD_DIGESTS[0]}suffix"',
            [BUILD_DIGESTS[0] + "suffix"],
        ),
    }
    with tempfile.TemporaryDirectory(prefix="ais-gitleaks-receipt-") as temp:
        directory = Path(temp)
        source = directory / "source"
        source.mkdir()

        def git(*args: str) -> str:
            result = subprocess.run(
                ["git", "-c", "user.name=AIS policy probe",
                 "-c", "user.email=policy-probe@example.invalid",
                 "-c", "commit.gpgsign=false", *args],
                cwd=source, capture_output=True, text=True, check=True, timeout=30,
            )
            return result.stdout.strip()

        # Git mode emits repository-relative paths, matching the CI scan. Each
        # case owns one line so a same-line exemption cannot mask another value.
        lines = {}
        identities = {}
        for name, (path, content, _) in cases.items():
            rows = lines.setdefault(path, ["{"])
            identities[(path, len(rows) + 1)] = name
            rows.append("  " + content + ",")
        for path, rows in lines.items():
            rows[-1] = rows[-1].removesuffix(",")
            target = source / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("\n".join([*rows, "}"]) + "\n", encoding="utf-8")
        git("init", "--quiet")
        git("add", ".")
        git("commit", "--quiet", "-m", "Synthetic receipt policy fixtures")
        commits = []
        for mode in ("new_root_commit", "rewritten_root_commit"):
            if commits:
                # A changed root commit models a squash/rewrite with the same
                # tree. The exception must depend on rule/path/value, not SHA.
                git("commit", "--amend", "--quiet", "-m", "Squashed receipt policy fixtures")
            commits.append(git("rev-parse", "HEAD"))
            report = directory / f"{mode}.json"
            scan = subprocess.run(
                [binary, "detect", "--source", str(source), "--log-opts=HEAD",
                 "--config", str(config), "--exit-code=2", "--report-format=json",
                 "--report-path", str(report)],
                cwd=source, capture_output=True, text=True, timeout=30,
            )
            if scan.returncode not in (0, 2) or not report.is_file():
                raise RuntimeError(f"Receipt scanner failed (exit {scan.returncode})")
            findings = json.loads(report.read_text(encoding="utf-8"))
            actual = {name: [] for name in cases}
            for finding in findings:
                identity = (finding["File"], finding["StartLine"])
                if identity not in identities or finding["RuleID"] != "generic-api-key":
                    raise RuntimeError("Receipt scanner returned an unexpected finding identity")
                actual[identities[identity]].append(finding["Secret"])
            failed = [name for name, (_, _, expected) in cases.items()
                      if sorted(actual[name]) != sorted(expected)]
            if failed:
                raise RuntimeError(f"Receipt policy failed in {mode}: " + ", ".join(failed))
            if scan.returncode != 2:
                raise RuntimeError("Receipt positive controls must keep leak exit code")
        if commits[0] == commits[1]:
            raise RuntimeError("Receipt history-rewrite probe did not change commit")
        return {"checks": list(cases), "detectedControls": len(findings),
                "historyModes": ["new_root_commit", "rewritten_root_commit"]}


def verify(binary: str, config: Path) -> dict:
    if Path(binary).is_file():
        binary = str(Path(binary).resolve())
    # Generated at runtime so this regression test does not itself add a
    # credential-shaped literal to the repository's scanned history.
    control = hashlib.sha256(
        b"AIS synthetic nonfunctional gitleaks control v1"
    ).hexdigest()
    fixture = "split-refund-1"
    logger_fixture = "sk_test_123456789"
    cases = {
        "idempotency_fixture": (f'idempotencyKey: "{fixture}"', []),
        "logger_fixture": (f'apiKey: "{logger_fixture}"', []),
        "credential_alone": (f'apiKey: "{control}"', [control]),
        "same_line_idempotency": (
            f'idempotencyKey: "{fixture}", apiKey: "{control}"', [control]
        ),
        "same_line_logger": (
            f'apiKey: "{logger_fixture}", password: "{control}"', [control]
        ),
        "separate_line": (
            f'idempotencyKey: "{fixture}",\napiKey: "{control}"', [control]
        ),
        "unrecognised_idempotency": (
            f'idempotencyKey: "{control}"', [control]
        ),
        "fixture_prefix_is_not_exempt": (
            f'apiKey: "{logger_fixture}{control}"', [logger_fixture + control]
        ),
    }
    with tempfile.TemporaryDirectory(prefix="ais-gitleaks-policy-") as temp:
        directory = Path(temp)
        source = directory / "fixtures"
        source.mkdir()
        for name, (content, _) in cases.items():
            (source / f"{name}.ts").write_text(
                "export const value = { " + content + " };\n", encoding="utf-8"
            )
        report = directory / "report.json"
        # Only generated, nonfunctional controls live in this isolated source.
        # Capture diagnostics privately and never print matching values.
        scan = subprocess.run(
            [binary, "detect", "--no-git", "--source", str(source),
             "--config", str(config), "--exit-code=2", "--report-format=json",
             "--report-path", str(report)],
            capture_output=True, text=True, timeout=30,
        )
        if scan.returncode not in (0, 2) or not report.is_file():
            raise RuntimeError(f"Scanner did not produce evidence (exit {scan.returncode})")
        findings = json.loads(report.read_text(encoding="utf-8"))
        actual = {name: [] for name in cases}
        for finding in findings:
            name = Path(finding["File"]).stem
            if name not in actual:
                raise RuntimeError("Scanner returned an unexpected finding identity")
            actual[name].append(finding["Secret"])
        failed = [name for name, (_, expected) in cases.items()
                  if sorted(actual[name]) != sorted(expected)]
        if failed:
            raise RuntimeError("Detection or fixture exemption failed: " + ", ".join(failed))
        if scan.returncode != 2:
            raise RuntimeError("Positive controls must produce the configured leak exit code")
        existing_count = len(findings)
    receipt = verify_receipt_allowlist(binary, config)
    checks = list(cases) + receipt["checks"]
    return {"result": "PASS", "passed": len(checks), "checks": checks,
            "detectedControls": existing_count + receipt["detectedControls"],
            "historyModes": receipt["historyModes"], "providerCalls": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitleaks", required=True, help="Path to the scanner used by CI")
    parser.add_argument("--config", type=Path, default=ROOT / ".gitleaks.toml")
    args = parser.parse_args()
    print(json.dumps(verify(args.gitleaks, args.config.resolve())))


if __name__ == "__main__":
    main()
