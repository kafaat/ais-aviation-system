"""Launch a real Toxiproxy process (local) or pinned Testcontainers image (CI)."""
import argparse
import contextlib
import os
from pathlib import Path
import socket
import subprocess
import time

import requests
from testcontainers.core.container import DockerContainer

IMAGE = "ghcr.io/shopify/toxiproxy:2.12.0@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e"
ROOT = Path(__file__).resolve().parents[2]


@contextlib.contextmanager
def native(binary, port):
    version = subprocess.check_output([str(binary), "-version"], text=True)
    if "2.12.0" not in version:
        raise RuntimeError("Expected Toxiproxy 2.12.0")
    process = subprocess.Popen([str(binary), "-host", "127.0.0.1", "-port", str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--toxiproxy-binary", type=Path)
    args = parser.parse_args()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    context = native(args.toxiproxy_binary, port) if args.toxiproxy_binary else DockerContainer(IMAGE).with_network_mode("host").with_command(f"-host 127.0.0.1 -port {port}")
    # Host networking keeps this test's proxy and synthetic receiver on loopback.
    # CI is Linux; a missing Docker daemon fails rather than skipping the lab.
    with context:
        session = requests.Session()
        session.trust_env = False
        base = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                if session.get(base + "/version", timeout=1).status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(0.1)
        else:
            raise TimeoutError("Toxiproxy startup deadline exceeded")
        subprocess.run(["node", "--import", "tsx", "scripts/acceptance/r2-transport.ts", str(args.report.resolve())], cwd=ROOT, env=dict(os.environ, TOXIPROXY_CONTROL_URL=base), check=True, timeout=60)


if __name__ == "__main__":
    main()
