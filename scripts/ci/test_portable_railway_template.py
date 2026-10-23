"""Exercise installation into another repository and run its actual offline tests."""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "templates/railway-connection"
sys.path.insert(0, str(BUNDLE))
spec = importlib.util.spec_from_file_location("portable_installer", BUNDLE / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
sys.path.pop(0)


class PortableInstallTests(unittest.TestCase):
    def config(self):
        config = json.loads((BUNDLE / "target.example.json").read_text())
        config.update(project_id="11111111-1111-4111-8111-111111111111",
                      environment_id="22222222-2222-4222-8222-222222222222")
        return config

    def test_generated_second_project_contract_and_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "target.json"
            config.write_text(json.dumps(self.config()))
            output = root / "project"
            manifest = installer.materialize(config, output)
            self.assertEqual(len(manifest["files"]), 5)
            for path, sha in manifest["files"].items():
                self.assertEqual(hashlib.sha256((output / path).read_bytes()).hexdigest(), sha)
            workflow = (output / ".github/workflows/railway-connection.yml").read_text()
            self.assertIn("secrets.PROJECT_RAILWAY_STAGING_PROJECT_TOKEN", workflow)
            self.assertNotIn("__PROJECT_TOKEN_SECRET__", workflow)
            self.assertNotIn("d0425f39-b1dc-4cf3-b7d9-0aab68d6ae9b", workflow)
            result = subprocess.run([sys.executable, "-m", "unittest", "discover",
                                     "-s", "scripts/ci", "-p", "test_railway_connection.py", "-v"],
                                    cwd=output, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Ran 9 tests", result.stderr)

    def test_example_ids_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(installer.Invalid):
            installer.materialize(BUNDLE / "target.example.json", Path(tmp) / "output")

    def test_collision_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "target.json"
            config.write_text(json.dumps(self.config()))
            output = root / "project"
            blocked = output / "docs/runbooks/RAILWAY_CONNECTION.md"
            blocked.parent.mkdir(parents=True)
            blocked.write_text("existing")
            with self.assertRaises(installer.Invalid):
                installer.materialize(config, output)
            self.assertEqual(blocked.read_text(), "existing")
            self.assertFalse((output / "scripts").exists())

    def test_symlink_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = root / "target.json"
            config.write_text(json.dumps(self.config()))
            real = root / "real"
            real.mkdir()
            link = root / "project"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaises(installer.Invalid):
                installer.materialize(config, link)
            self.assertEqual(list(real.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
