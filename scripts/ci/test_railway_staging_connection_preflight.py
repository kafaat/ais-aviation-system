"""Regression proof for Railway staging connectivity without side effects."""

from __future__ import annotations

import json
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ci"))
import railway_staging_connection_preflight as p  # noqa: E402

TEST_SHA = "d23b320ae6c437273a8c8a6a1ba9fc5f111b1e1c"


class RailwayPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        # Railway CLI v5.63.1 serializes ProjectProject directly as JSON.
        self.status = {
            "id": p.PROJECT_ID,
            "name": "ais-staging",
            "environments": {
                "edges": [
                    {
                        "node": {
                            "id": p.STAGING_ID,
                            "name": "production",
                            "canAccess": True,
                        }
                    }
                ]
            },
            "services": {"edges": [{"node": {"status": "CRASHED"}}]},
        }

    def test_real_cli_shape_without_runtime_claims(self) -> None:
        result = p.validate_status(self.status, TEST_SHA)
        self.assertEqual(result["verdict"], "CONNECTION_ONLY_PASS")
        self.assertEqual(result["environment_id"], p.STAGING_ID)
        for flag in (
            "deployment_performed",
            "migration_performed",
            "database_access_verified",
            "runtime_verified",
            "production_certified",
        ):
            self.assertFalse(result[flag], flag)

    def test_rejects_legacy_wrapper_instead_of_real_cli_json(self) -> None:
        self.status = {
            "project": {"id": p.PROJECT_ID},
            "environment": {"id": p.STAGING_ID, "name": "staging"},
        }
        with self.assertRaisesRegex(p.PreflightError, "PROJECT_ID_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_missing_project_id(self) -> None:
        self.status.pop("id")
        with self.assertRaisesRegex(p.PreflightError, "PROJECT_ID_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_missing_environments(self) -> None:
        self.status.pop("environments")
        with self.assertRaisesRegex(p.PreflightError, "MISSING_ENVIRONMENTS"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_empty_environment_edges(self) -> None:
        self.status["environments"]["edges"] = []
        with self.assertRaisesRegex(p.PreflightError, "ENVIRONMENT_SCOPE_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_unscoped_multiple_environments(self) -> None:
        self.status["environments"]["edges"].append(
            {"node": {"id": "00000000-0000-4000-8000-000000000001", "name": "production"}}
        )
        with self.assertRaisesRegex(p.PreflightError, "ENVIRONMENT_SCOPE_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_missing_edge_node(self) -> None:
        self.status["environments"]["edges"] = [{}]
        with self.assertRaisesRegex(p.PreflightError, "INVALID_ENVIRONMENT_SHAPE"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_unapproved_environment(self) -> None:
        self.status["environments"]["edges"][0]["node"]["id"] = "00000000-0000-4000-8000-000000000001"
        with self.assertRaisesRegex(p.PreflightError, "ENVIRONMENT_ID_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_wrong_environment_name(self) -> None:
        self.status["environments"]["edges"][0]["node"]["name"] = "staging"
        with self.assertRaisesRegex(p.PreflightError, "ENVIRONMENT_NAME_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_staging_inaccessible(self) -> None:
        self.status["environments"]["edges"][0]["node"]["canAccess"] = False
        with self.assertRaisesRegex(p.PreflightError, "STAGING_ACCESS_DENIED"):
            p.validate_status(self.status, TEST_SHA)

    def test_rejects_wrong_project(self) -> None:
        self.status["id"] = "00000000-0000-4000-8000-000000000000"
        with self.assertRaisesRegex(p.PreflightError, "PROJECT_ID_MISMATCH"):
            p.validate_status(self.status, TEST_SHA)

    def test_requires_explicit_boolean_access(self) -> None:
        node = self.status["environments"]["edges"][0]["node"]
        for value in (None, 1, "true", [], {}):
            with self.subTest(value=value):
                node["canAccess"] = value
                with self.assertRaisesRegex(p.PreflightError, "STAGING_ACCESS_DENIED"):
                    p.validate_status(self.status, TEST_SHA)
        node.pop("canAccess")
        with self.assertRaisesRegex(p.PreflightError, "STAGING_ACCESS_DENIED"):
            p.validate_status(self.status, TEST_SHA)

    def test_records_environment_name_separately_from_purpose(self) -> None:
        result = p.validate_status(self.status, TEST_SHA)
        self.assertEqual(result["environment_name"], "production")
        self.assertEqual(result["environment_purpose"], "staging")
        self.assertTrue(result["name_purpose_mismatch"])

    def test_rejects_bad_sha(self) -> None:
        with self.assertRaisesRegex(p.PreflightError, "INVALID_SOURCE_SHA"):
            p.validate_status(self.status, "main")

    def test_rejects_error_payload(self) -> None:
        self.status["errors"] = ["secret must never be printed"]
        with self.assertRaisesRegex(p.PreflightError, "STATUS_HAS_ERROR"):
            p.validate_status(self.status, TEST_SHA)

    def test_receipt_never_includes_cli_secrets(self) -> None:
        self.status["variables"] = {"DATABASE_URL": "must_not_leak"}
        receipt = p.validate_status(self.status, TEST_SHA)
        self.assertNotIn("must_not_leak", json.dumps(receipt))
        self.assertNotIn("variables", json.dumps(receipt))

    def test_cli_receipt_hash_and_malformed_secret_redaction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            status = Path(tmp) / "status.json"
            evidence = Path(tmp) / "evidence.json"
            script = ROOT / "scripts/ci/railway_staging_connection_preflight.py"
            command = [sys.executable, str(script), "--status-json", str(status),
                       "--source-sha", TEST_SHA, "--evidence", str(evidence)]
            status.write_text(json.dumps(self.status), encoding="utf-8")
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            receipt = json.loads(evidence.read_text())
            self.assertEqual(receipt["verifier_sha256"],
                             hashlib.sha256(script.read_bytes()).hexdigest())
            evidence.unlink()
            status.write_text('{"token":"DO_NOT_EMIT_SECRET"', encoding="utf-8")
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("MALFORMED_STATUS_JSON", result.stderr)
            self.assertNotIn("DO_NOT_EMIT_SECRET", result.stdout + result.stderr)
            self.assertFalse(evidence.exists())

    def test_workflow_has_no_railway_write_step(self) -> None:
        wf = (
            ROOT / ".github" / "workflows" / "railway-staging-connection-preflight.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", wf)
        self.assertIn("if: github.event_name == 'workflow_dispatch'", wf)
        self.assertIn("secrets.AIS_RAILWAY_STAGING_PROJECT_TOKEN", wf)
        self.assertIn("refs/heads/main", wf)
        self.assertIn("expected_sha", wf)
        self.assertIn("railway status --json", wf)
        for forbidden in (
            "railway up",
            "railway redeploy",
            "railway ssh",
            "railway run",
            "railway variable set",
            "railway environment edit",
        ):
            self.assertNotIn(forbidden, wf.lower())


if __name__ == "__main__":
    unittest.main()

