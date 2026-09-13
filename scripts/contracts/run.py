"""Bounded contract lab; missing prerequisites fail, never silently skip."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def rest(report):
    with tempfile.TemporaryDirectory(prefix="ais-contract-") as directory:
        descriptor = Path(directory) / "host.json"
        env = dict(os.environ, AIS_CONTRACT_DESCRIPTOR=str(descriptor))
        with (report / "rest-host.log").open("w") as log:
            host = subprocess.Popen(["node", "--import", "tsx", "scripts/contracts/rest-host.ts", str(descriptor)], cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(200):
                    if descriptor.exists():
                        break
                    if host.poll() is not None:
                        raise RuntimeError("REST fixture host failed; inspect rest-host.log")
                    time.sleep(0.1)
                else:
                    raise TimeoutError("REST fixture host startup timeout")
                subprocess.run([sys.executable, "-m", "pytest", "scripts/contracts/test_rest.py", "-q", "--tb=short", "--junitxml=" + str(report / "rest-junit.xml")], cwd=ROOT, env=env, check=True, timeout=180)
            finally:
                host.terminate()
                try:
                    host.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    host.kill()
                    host.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["rest", "microcks", "all"])
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    args.report = args.report.resolve()
    args.report.mkdir(parents=True, exist_ok=True)
    evidence = {"rest": "not_requested", "microcks": "not_requested", "providerCalls": 0}
    try:
        for mode in ["rest", "microcks"]:
            if args.mode in [mode, "all"]:
                evidence[mode] = "failed"
                if mode == "rest":
                    rest(args.report)
                else:
                    from microcks_lab import verify
                    verify(ROOT)
                evidence[mode] = "passed"
    finally:
        (args.report / "contract-lab.json").write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    main()
