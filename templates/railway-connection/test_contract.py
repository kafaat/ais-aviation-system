"""Offline contract tests, runnable in the bundle and in a generated repository."""
import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "railway_connection_verify.py"
if not SCRIPT.exists():
    SCRIPT = HERE / "verify.py"
spec = importlib.util.spec_from_file_location("portable_verify", SCRIPT)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
SHA = "a" * 40


class PortableContract(unittest.TestCase):
    def setUp(self):
        self.config = {"schema_version": 1,
                       "project_id": "11111111-1111-4111-8111-111111111111",
                       "environment_id": "22222222-2222-4222-8222-222222222222",
                       "environment_name": "staging", "environment_purpose": "staging",
                       "allow_name_purpose_mismatch": False,
                       "secret_name": "DEMO_RAILWAY_STAGING_PROJECT_TOKEN"}
        self.payload = {"id": self.config["project_id"], "environments": {"edges": [
            {"node": {"id": self.config["environment_id"], "name": "staging", "canAccess": True}}]}}

    def test_receipt_limits(self):
        self.payload["secrets"] = "DO_NOT_LEAK"
        receipt = v.validate_status(self.payload, SHA, self.config)
        self.assertEqual(receipt["verdict"], "CONNECTION_ONLY_PASS")
        self.assertNotIn("DO_NOT_LEAK", json.dumps(receipt))
        for flag in ("deployment_performed", "migration_performed", "runtime_verified",
                     "production_certified", "database_access_verified"):
            self.assertIs(receipt[flag], False)

    def test_target_mismatch(self):
        mutations = [lambda p: p.update(id="wrong"),
                     lambda p: p.update(errors=["DO_NOT_LEAK"]),
                     lambda p: p["environments"].update(edges=[]),
                     lambda p: p["environments"]["edges"].append(p["environments"]["edges"][0]),
                     lambda p: p["environments"]["edges"][0].update(node=None),
                     lambda p: p["environments"]["edges"][0]["node"].update(id="wrong"),
                     lambda p: p["environments"]["edges"][0]["node"].update(name="production")]
        for mutation in mutations:
            payload = copy.deepcopy(self.payload)
            mutation(payload)
            with self.subTest(payload=payload), self.assertRaises(v.Invalid):
                v.validate_status(payload, SHA, self.config)

    def test_access_boolean_required(self):
        for value in (False, None, 1, "true", [], {}):
            self.payload["environments"]["edges"][0]["node"]["canAccess"] = value
            with self.subTest(value=value), self.assertRaises(v.Invalid):
                v.validate_status(self.payload, SHA, self.config)

    def test_name_purpose_exception_is_explicit(self):
        self.config["environment_name"] = "production"
        self.payload["environments"]["edges"][0]["node"]["name"] = "production"
        with self.assertRaises(v.Invalid):
            v.validate_status(self.payload, SHA, self.config)
        self.config["allow_name_purpose_mismatch"] = True
        receipt = v.validate_status(self.payload, SHA, self.config)
        self.assertTrue(receipt["name_purpose_mismatch"])
        self.assertEqual(receipt["environment_purpose"], "staging")

    def test_invalid_config_and_injection(self):
        for key, value in (("project_id", "$(touch /tmp/no)"), ("environment_name", "x\ny=1"),
                           ("secret_name", "X }}"), ("secret_name", "RAILWAY_API_TOKEN"),
                           ("environment_purpose", "production"), ("schema_version", True),
                           ("allow_name_purpose_mismatch", 1), ("unknown", "value")):
            config = dict(self.config)
            config[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(v.Invalid):
                v.validate_config(config)

    def test_invalid_sha_and_status(self):
        for sha in ("main", "A" * 40, None, "a" * 39):
            with self.subTest(sha=sha), self.assertRaises(v.Invalid):
                v.validate_status(self.payload, sha, self.config)
        for payload in (None, [], {}, {"error": "secret"}):
            with self.subTest(payload=payload), self.assertRaises(v.Invalid):
                v.validate_status(payload, SHA, self.config)

    def test_cli_hash_redaction_and_stale_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config, status, evidence = (root / n for n in ("config.json", "status.json", "receipt.json"))
            config.write_text(json.dumps(self.config))
            status.write_text(json.dumps(self.payload))
            cmd = [sys.executable, str(SCRIPT), "--config", str(config), "--status-json", str(status),
                   "--source-sha", SHA, "--evidence", str(evidence)]
            result = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(evidence.read_text())
            self.assertEqual(receipt["verifier_sha256"], hashlib.sha256(SCRIPT.read_bytes()).hexdigest())
            self.assertEqual(receipt["config_sha256"], hashlib.sha256(config.read_bytes()).hexdigest())
            for bad in ('{"secret":"DO_NOT_LEAK"', '{"id":1,"id":2}', "x" * (v.MAX_BYTES + 1)):
                evidence.write_text("stale success")
                status.write_text(bad)
                result = subprocess.run(cmd, capture_output=True, text=True)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("DO_NOT_LEAK", result.stdout + result.stderr)
                self.assertFalse(evidence.exists())

    def test_workflow_boundaries(self):
        workflow = HERE / "workflow.yml.template"
        if not workflow.exists():
            workflow = HERE.parents[1] / ".github/workflows/railway-connection.yml"
        text = workflow.read_text()
        self.assertEqual(sum(line.strip().startswith("RAILWAY_TOKEN:") for line in text.splitlines()), 1)
        for fragment in ("refs/heads/main", "expected_sha", "timeout 90s railway status", "if: always()"):
            self.assertIn(fragment, text)
        for forbidden in ("railway up", "railway redeploy", "railway run", "railway ssh", "pull_request_target"):
            self.assertNotIn(forbidden, text)

    def test_committed_binding_matches_workflow(self):
        if SCRIPT.name == "verify.py":
            config = v.validate_config(v.read_json(HERE / "target.example.json"))
            self.assertEqual(config["schema_version"], 1)
        else:
            root = HERE.parents[1]
            config = v.validate_config(v.read_json(root / ".github/railway-connection.json"))
            workflow = (root / ".github/workflows/railway-connection.yml").read_text()
            self.assertIn("secrets." + config["secret_name"] + " }}", workflow)


if __name__ == "__main__":
    unittest.main()
