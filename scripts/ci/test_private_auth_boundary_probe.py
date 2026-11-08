"""Tests for private AIS staging auth probe; no Railway request is made."""
import importlib.util
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "acceptance" / "private_auth_boundary_probe.py"
spec = importlib.util.spec_from_file_location("private_auth_boundary_probe", source)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

SHA = "a" * 40
TOKEN = "private-auth-acceptance-fixture-unique-2026"


class FakeAuth(BaseHTTPRequestHandler):
    seen = []
    reject_wrong = True

    def log_message(self, *_args):
        return

    def send_json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/auth/health":
            self.send_json(200, {"status": "healthy"})
        else:
            self.send_json(404, {})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        presented = self.headers.get("X-Auth-Service-Token")
        self.__class__.seen.append((self.path, presented))
        if presented != TOKEN and self.reject_wrong:
            self.send_json(401, {"detail": "Service credential required."})
        elif self.path == "/auth/login":
            self.send_json(401, {"detail": "Invalid email or password."})
        elif self.path == "/auth/verify-password":
            self.send_json(200, {"success": False, "message": "Invalid email or password."})
        else:
            self.send_json(200, {"success": True})


class PrivateAuthProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeAuth)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.env = {
            "AIS_AUTH_PRIVATE_PROBE": "1",
            "AUTH_SERVICE_URL": f"http://127.0.0.1:{cls.server.server_port}",
            "AUTH_SERVICE_TOKEN": TOKEN,
            "AIS_EXPECTED_SOURCE_SHA": SHA,
            "RAILWAY_GIT_COMMIT_SHA": SHA,
        }

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def setUp(self):
        FakeAuth.seen.clear()
        FakeAuth.reject_wrong = True

    def test_private_host_allowlist(self):
        for url in ("https://example.com", "http://10.0.0.4:8000", "http://ais-auth.railway.app", "http://localhost:8000/api", "http://user:pass@ais-auth:8000"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                probe.validate_target(url)
        self.assertEqual(probe.validate_target("http://ais-auth.railway.internal:8000"), "http://ais-auth.railway.internal:8000")

    def test_secret_and_source_fail_closed(self):
        for token in ("", "CHANGE_ME", "x" * 32, "é" * 40):
            with self.subTest(token_len=len(token)), self.assertRaises(ValueError):
                probe.run({**self.env, "AUTH_SERVICE_TOKEN": token})
        with self.assertRaises(ValueError):
            probe.run({**self.env, "RAILWAY_GIT_COMMIT_SHA": "b" * 40})
        with self.assertRaises(ValueError):
            probe.run({**self.env, "AIS_AUTH_PRIVATE_PROBE": "0"})
        self.assertEqual(FakeAuth.seen, [])

    def test_correct_shared_secret_and_six_denials(self):
        result = probe.run(self.env)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual((result["passed"], result["expected"]), (9, 9))
        self.assertEqual(len(FakeAuth.seen), 8)
        self.assertEqual(sum(token == TOKEN for _, token in FakeAuth.seen), 2)
        self.assertEqual(sum(token is None for _, token in FakeAuth.seen), 3)
        self.assertNotIn(TOKEN, json.dumps(result))
        self.assertNotIn(self.env["AUTH_SERVICE_URL"], json.dumps(result))

    def test_negative_auth_failure_blocks_pass(self):
        FakeAuth.reject_wrong = False
        result = probe.run(self.env)
        self.assertEqual(result["status"], "FAIL")
        self.assertLess(result["passed"], result["expected"])
        self.assertNotIn(TOKEN, json.dumps(result))

    def test_main_redacts_without_opt_in(self):
        with self.assertRaises(ValueError):
            probe.run({**self.env, "AIS_AUTH_PRIVATE_PROBE": ""})


if __name__ == "__main__":
    unittest.main()
