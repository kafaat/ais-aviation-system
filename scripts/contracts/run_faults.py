"""Launch a real Toxiproxy process (local) or pinned Testcontainers image (CI)."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time

import requests
from testcontainers.core.container import DockerContainer

IMAGE = "ghcr.io/shopify/toxiproxy:2.12.0@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e"
ROOT = Path(__file__).resolve().parents[2]
# A cold image pull plus container start can take far longer than a warm one,
# and the lab forks several tsx workers that each pay their own startup cost.
# These deadlines exist to stop a hang, not to police performance: keep them
# well clear of a healthy run so a slow runner reports the real outcome. The
# workflow's own timeout-minutes remains the outer bound.
# The workflow caps the job at 15 minutes. Keep the worst case well inside it:
# three readiness attempts plus one lab deadline must still leave room to print
# diagnostics, or the job dies without saying why.
READY_DEADLINE_SECONDS = 45
LAB_DEADLINE_SECONDS = 240


@contextlib.contextmanager
def native(binary, port):
    version = subprocess.check_output([str(binary), "-version"], text=True)
    if "2.12.0" not in version:
        raise RuntimeError("Expected Toxiproxy 2.12.0")
    process = subprocess.Popen([str(binary), "-host", "127.0.0.1", "-port", str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        yield None
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def free_port():
    """Ask the kernel for an unused port. The caller binds it moments later, so
    a competing process can still take it; callers must tolerate that."""
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def await_control(session, base, deadline):
    """True once the Toxiproxy control API answers, False at the deadline."""
    end = time.monotonic() + deadline
    while time.monotonic() < end:
        try:
            if session.get(base + "/version", timeout=1).status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(0.1)
    return False


def diagnose(report, container):
    """A silent failure is unusable in CI. Surface whatever the lab recorded and
    whatever the proxy said, without inventing an outcome."""
    print("--- transport lab diagnostics ---", flush=True)
    try:
        print(json.dumps(json.loads(report.read_text()), indent=2), flush=True)
    except (OSError, ValueError) as error:
        print(f"No readable lab report at {report}: {error}", flush=True)
    if container is None:
        return
    try:
        stdout, stderr = container.get_logs()
        for name, stream in (("stdout", stdout), ("stderr", stderr)):
            text = stream.decode(errors="replace").strip() if stream else ""
            if text:
                print(f"--- toxiproxy {name} ---\n{text}", flush=True)
    except Exception as error:  # noqa: BLE001 - diagnostics must never mask the real failure
        print(f"Toxiproxy logs unavailable: {error}", flush=True)


def run_lab(report, base):
    """Run the lab in its own process group and kill the group on timeout.

    The lab deliberately parks one forked worker forever so it can be SIGKILLed
    mid-flight. Killing only the direct child leaves that worker holding the
    inherited pipes, so the wait after a timeout never returns and the job dies
    at the workflow cap with nothing printed. Signalling the group ends them all.
    """
    process = subprocess.Popen(
        ["node", "--import", "tsx", "scripts/acceptance/r2-transport.ts", str(report.resolve())],
        cwd=ROOT,
        env=dict(os.environ, TOXIPROXY_CONTROL_URL=base),
        start_new_session=True,
    )
    try:
        code = process.wait(timeout=LAB_DEADLINE_SECONDS)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        process.wait(timeout=30)
        raise
    if code != 0:
        raise subprocess.CalledProcessError(code, process.args)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--toxiproxy-binary", type=Path)
    args = parser.parse_args()
    # Testcontainers 4.15.0 exposes no with_network_mode; extra run kwargs are
    # the supported way to reach host networking. Check it rather than trust it:
    # an AttributeError here aborts the whole lab instead of failing one case.
    if not args.toxiproxy_binary and not hasattr(DockerContainer, "with_kwargs"):
        raise RuntimeError("Testcontainers does not expose with_kwargs; host networking is unavailable")
    session = requests.Session()
    session.trust_env = False
    # Host networking keeps this test's proxy and synthetic receiver on loopback.
    # CI is Linux; a missing Docker daemon fails rather than skipping the lab.
    # Retry the port, not the deadline: free_port cannot reserve what it returns,
    # so another process taking it first must not read as an unreachable proxy.
    attempts = 3
    for attempt in range(1, attempts + 1):
        port = free_port()
        context = native(args.toxiproxy_binary, port) if args.toxiproxy_binary else DockerContainer(IMAGE).with_kwargs(network_mode="host").with_command(f"-host 127.0.0.1 -port {port}")
        with context as container:
            base = f"http://127.0.0.1:{port}"
            if not await_control(session, base, READY_DEADLINE_SECONDS):
                if attempt < attempts:
                    print(f"Toxiproxy did not answer on port {port}; retrying on another port", flush=True)
                    continue
                diagnose(args.report, container)
                raise TimeoutError(
                    f"Toxiproxy control API unreachable after {attempts} attempts"
                )
            try:
                run_lab(args.report, base)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                diagnose(args.report, container)
                raise
            return


if __name__ == "__main__":
    main()
