"""Run the deployed entry points against a local HTTP contract fixture."""
from contextlib import contextmanager
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading
import unittest
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[2]


@contextmanager
def fixture(fault=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path)
            route = path.path.removeprefix("/api/trpc/")
            status, body, mime = 200, None, "application/json"
            rows = [] if fault == "empty airport catalog" else [{"id": 31}, {"id": 99}]
            values = {"health.live": {"alive": True}, "health.ready": {"ready": fault != "dependency"},
                      "reference.airports": rows, "auth.me": None, "flights.statusBatch": []}
            if path.path == "/":
                mime = "text/html"
                body = '<!doctype html><html><div id="root"></div><script type="module" src="/assets/app.js"></script></html>'
            elif path.path == "/assets/app.js":
                mime, body = ("text/html", "<html>") if fault == "missing asset" else ("text/javascript", "export {};")
            elif route == "flights.search":
                query = json.loads(parse_qs(path.query).get("input", ["{}"])[0]).get("json", {})
                if query == {}:
                    status, code = 400, "BAD_REQUEST"
                else:
                    valid = (query.get("originId"), query.get("destinationId")) == (31, 99)
                    valid = valid and date.fromisoformat(query["departureDate"]) >= date.today()
                    if not valid or fault == "wrong input":
                        status, code = 400, "BAD_REQUEST"
                    else:
                        values[route] = []
            elif route in ("bookings.myBookings", "admin.getMetrics"):
                if fault == "authorization":
                    values[route] = []
                else:
                    status, code = 401, "UNAUTHORIZED"
            elif route not in values:
                status, code = 404, "NOT_FOUND"
            if body is None:
                body = json.dumps({"result": {"data": {"json": values[route]}}} if status == 200 else
                                  {"error": {"json": {"data": {"code": code}}}})
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("X-RateLimit-Limit", "0" if fault == "no quota" else "100")
            if fault == "cors":
                self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-RateLimit-Remaining", "99")
            self.end_headers()
            self.wfile.write(body.encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class DeploymentProbes(unittest.TestCase):
    def run_probe(self, script, origin):
        return subprocess.run(["bash", str(ROOT / "scripts" / script), origin],
                              capture_output=True, text=True, timeout=12)

    def test_real_entry_points_accept_current_http_contracts(self):
        with fixture() as origin:
            for name in ("smoke-tests.sh", "e2e-critical.sh"):
                with self.subTest(script=name):
                    result = self.run_probe(name, origin)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn("PASS", result.stdout)

    def test_critical_entry_point_rejects_failures(self):
        for fault in ("dependency", "missing asset", "wrong input", "authorization", "cors", "no quota"):
            with self.subTest(fault=fault), fixture(fault) as origin:
                result = self.run_probe("e2e-critical.sh", origin)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("FAIL", result.stdout + result.stderr)

    def test_search_is_reported_skipped_when_airport_catalog_is_empty(self):
        with fixture("empty airport catalog") as origin:
            result = self.run_probe("e2e-critical.sh", origin)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("SKIP positive flight search", result.stdout)
        self.assertNotIn("PASS search using", result.stdout)
        self.assertIn("SKIP WebSocket", result.stdout)

    def test_unreachable_origin_fails(self):
        with fixture() as origin:
            pass
        self.assertNotEqual(self.run_probe("e2e-critical.sh", origin).returncode, 0)
