import base64
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import kubernetes_secrets as target


class DeploymentSecrets(unittest.TestCase):
    def test_workflow_binds_every_key_in_both_environments(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/ci-cd.yml").read_text()
        blocks = re.findall(r"      - name: Create/Update secrets\n(.*?)(?=\n      - name:)", workflow, re.S)
        self.assertEqual(len(blocks), 2)
        for block in blocks:
            self.assertEqual(set(re.findall(r"^          ([A-Z_]+):", block, re.M)), set(target.KEYS))
            self.assertIn("kubernetes_secrets.py apply --namespace ais-", block)
            self.assertNotIn("--from-literal", block)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.values = {key: f"synthetic-{key}-'\"$();\\\nعربية\r\nend"
                       for key in target.KEYS}
        self.values["SMS_PROVIDER"] = ""
        self.env = dict(os.environ, **self.values)
        self.env["PATH"] = str(self.root) + os.pathsep + os.environ["PATH"]
        self.env["PROBE_OUTPUT"] = str(self.root / "probe.json")
        self.env["EXPECTED_SHA"] = json.dumps({key: hashlib.sha256(value.encode()).hexdigest()
                                                for key, value in self.values.items()})

    def invoke(self):
        command = [sys.executable, str(Path(target.__file__)), "apply", "--namespace", "ais-staging"]
        for value in self.values.values():
            if value:
                self.assertNotIn(value, "\0".join(command))
        return subprocess.run(command, env=self.env,
                              capture_output=True, timeout=10)

    def fake(self, failure=False):
        code = '''
import base64, hashlib, json, os, pathlib, sys
payload = json.load(sys.stdin)
expected = json.loads(os.environ['EXPECTED_SHA'])
assert payload['metadata'] == {'name': 'ais-secrets', 'namespace': 'ais-staging'}
assert 'annotations' not in payload['metadata']
assert set(payload['data']) == set(expected)
argv = pathlib.Path('/proc/self/cmdline').read_bytes()
for key, encoded in payload['data'].items():
    value = base64.b64decode(encoded)
    assert hashlib.sha256(value).hexdigest() == expected[key]
    assert key not in os.environ
    if value:
        assert value not in argv and encoded.encode() not in argv
assert '--server-side' in sys.argv and '--force-conflicts' not in sys.argv
pathlib.Path(os.environ['PROBE_OUTPUT']).write_text('{"verified": true}')
'''
        if failure:
            code += "\nprint(json.dumps(payload)); print(json.dumps(payload), file=sys.stderr); sys.exit(42)\n"
        path = self.root / "kubectl"
        path.write_text(f"#!{sys.executable}\n" + code)
        path.chmod(0o700)

    def assert_no_leak(self, result):
        outputs = result.stdout + result.stderr
        for value in self.values.values():
            if value:
                self.assertNotIn(value.encode(), outputs)
                self.assertNotIn(base64.b64encode(value.encode()), outputs)
        self.assertTrue((self.root / "probe.json").exists(), result.stderr)
        report = (self.root / "probe.json").read_bytes()
        self.assertEqual(json.loads(report), {"verified": True})
        self.assertEqual(set(p.name for p in self.root.iterdir()), {"kubectl", "probe.json"})

    def test_bytes_args_child_environment_and_report(self):
        self.fake()
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_no_leak(result)

    def test_child_failure_cannot_echo_payload_to_logs(self):
        self.fake(failure=True)
        result = self.invoke()
        self.assertEqual(result.returncode, 1)
        self.assert_no_leak(result)

    def test_missing_binding_fails_before_subprocess(self):
        del self.env["DATABASE_URL"]
        self.fake()
        result = self.invoke()
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.root / "probe.json").exists())
        self.assertNotIn(self.values["JWT_SECRET"].encode(), result.stderr)

    def test_kubeconfig_permissions_bytes_and_status(self):
        content = b"synthetic kubeconfig\n"
        output = self.root / "output"
        with patch.object(target.Path, "home", return_value=self.root), patch.dict(os.environ, {
            "AIS_KUBECONFIG_BASE64": base64.b64encode(content).decode(), "GITHUB_OUTPUT": str(output),
        }):
            target.configure()
        config = self.root / ".kube" / "config"
        self.assertEqual(config.read_bytes(), content)
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(output.read_text(), "configured=true\n")

    def test_kubeconfig_symlink_is_not_followed(self):
        (self.root / ".kube").mkdir()
        victim = self.root / "victim"
        victim.write_text("unchanged")
        (self.root / ".kube" / "config").symlink_to(victim)
        with patch.object(target.Path, "home", return_value=self.root), patch.dict(os.environ, {
            "AIS_KUBECONFIG_BASE64": "YQ==", "GITHUB_OUTPUT": str(self.root / "output"),
        }), self.assertRaises(OSError):
            target.configure()
        self.assertEqual(victim.read_text(), "unchanged")

    def test_missing_kubeconfig_disables_without_writing_credentials(self):
        output = self.root / "output"
        with patch.object(target.Path, "home", return_value=self.root), patch.dict(os.environ, {
            "AIS_KUBECONFIG_BASE64": "", "GITHUB_OUTPUT": str(output),
        }):
            target.configure()
        self.assertEqual(output.read_text(), "configured=false\n")
        self.assertFalse((self.root / ".kube").exists())


if __name__ == "__main__":
    unittest.main()
