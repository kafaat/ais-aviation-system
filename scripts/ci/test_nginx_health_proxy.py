#!/usr/bin/env python3
"""Real Nginx /health proxy integration with a controlled upstream.

The reverse proxy is real; the application and DB are simulated, so this is
NOT production or complete AIS end-to-end acceptance.
"""

from __future__ import annotations

import http.server
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get("AIS_NGINX_CONFIG", str(ROOT / "nginx.conf")))


class Upstream(http.server.BaseHTTPRequestHandler):
    readiness_status = 200
    last_path = ""

    def do_GET(self):
        type(self).last_path = self.path
        if self.path == "/api/trpc/health.ready":
            status = type(self).readiness_status
        elif self.path == "/api/trpc/health.check":
            status = 401
        else:
            status = 404
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"upstream":"controlled-test"}')

    def log_message(self, *_args):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request_status(url):
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code


class NginxHealthContract(unittest.TestCase):
    def test_real_nginx_passes_readiness_status_unchanged(self):
        nginx = shutil.which("nginx")
        self.assertIsNotNone(nginx, "nginx binary required; no silent skip")
        source = SOURCE.read_text(encoding="utf-8")
        blocks = re.findall(r"(?m)^\s*location\s*=\s*/health\s*\{[^{}]*\}", source)
        self.assertEqual(len(blocks), 1, "one exact-match /health location required")
        block = blocks[0]
        self.assertRegex(block, r"proxy_pass\s+http://ais_api/api/trpc/health\.ready\s*;")
        self.assertNotIn("health.check", block)
        upstream_port = free_port()
        proxy_port = free_port()
        upstream = http.server.ThreadingHTTPServer(("127.0.0.1", upstream_port), Upstream)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        try:
            with tempfile.TemporaryDirectory(prefix="ais-nginx-probe-") as tmp:
                directory = Path(tmp)
                cfg = directory / "nginx.conf"
                cfg.write_text(
                    "worker_processes 1;\n"
                    f"pid {directory}/nginx.pid;\n"
                    f"error_log {directory}/error.log warn;\n"
                    "events { worker_connections 128; }\n"
                    "http {\n"
                    f"  upstream ais_api {{ server 127.0.0.1:{upstream_port}; }}\n"
                    f"  server {{ listen 127.0.0.1:{proxy_port};\n"
                    f"{block}\n"
                    "    location / { return 404; }\n"
                    "  }\n}\n",
                    encoding="utf-8",
                )
                check = subprocess.run(
                    [nginx, "-t", "-c", str(cfg), "-p", tmp],
                    capture_output=True, text=True,
                )
                self.assertEqual(check.returncode, 0, check.stderr)
                process = subprocess.Popen(
                    [nginx, "-c", str(cfg), "-p", tmp, "-g", "daemon off;"],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                try:
                    url = f"http://127.0.0.1:{proxy_port}/health"
                    for _ in range(100):
                        try:
                            status = request_status(url)
                            break
                        except (OSError, TimeoutError):
                            if process.poll() is not None:
                                self.fail("nginx exited before responding")
                            time.sleep(0.03)
                    else:
                        self.fail("nginx never listened")
                    self.assertEqual(status, 200)
                    self.assertEqual(Upstream.last_path, "/api/trpc/health.ready")
                    Upstream.readiness_status = 503
                    self.assertEqual(request_status(url), 503)
                    self.assertEqual(Upstream.last_path, "/api/trpc/health.ready")
                    self.assertEqual(request_status(url + "/other"), 404)
                    self.assertEqual(
                        request_status(f"http://127.0.0.1:{proxy_port}/api/trpc/health.check"),
                        404,
                    )
                finally:
                    process.terminate()
                    try:
                        process.communicate(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=3)
        finally:
            upstream.shutdown()
            upstream.server_close()


if __name__ == "__main__":
    unittest.main()
