"""Exercise the real scanner with synthetic fixtures and nonfunctional controls."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]


def verify(binary: str, config: Path) -> dict:
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
        return {"result": "PASS", "passed": len(cases), "checks": list(cases),
                "detectedControls": len(findings), "providerCalls": 0}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitleaks", required=True, help="Path to the scanner used by CI")
    parser.add_argument("--config", type=Path, default=ROOT / ".gitleaks.toml")
    args = parser.parse_args()
    print(json.dumps(verify(args.gitleaks, args.config.resolve())))


if __name__ == "__main__":
    main()
