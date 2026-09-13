"""Execute the deployed worker probe against fresh, stale and missing evidence."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest


class WorkerProbeTest(unittest.TestCase):
    def test_worker_liveness_rejects_stale_or_missing_heartbeat(self):
        manifest = (Path(__file__).resolve().parents[2] / "k8s/base/background.yaml").read_text()
        probe = manifest.split("livenessProbe:", 1)[1].split("startupProbe:", 1)[0]
        match = re.search(r'^\s+- ("const fs=.*")$', probe, re.MULTILINE)
        self.assertIsNotNone(match, "Worker deployment must execute a liveness probe")
        command = json.loads(match.group(1))
        with tempfile.TemporaryDirectory() as directory:
            heartbeat = Path(directory) / "worker-ready"
            command = command.replace("/tmp/ais-worker-ready", str(heartbeat))

            def result():
                return subprocess.run(["node", "-e", command], capture_output=True, timeout=5).returncode

            self.assertNotEqual(result(), 0, "A missing worker must not remain healthy")
            heartbeat.write_text("ready")
            self.assertEqual(result(), 0)
            stale = time.time() - 40
            os.utime(heartbeat, (stale, stale))
            self.assertNotEqual(result(), 0, "A stalled worker must trigger restart")
