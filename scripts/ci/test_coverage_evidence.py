"""Exercise the evidence wrapper with real child-process exit and signal results."""
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts/ci/run-coverage-evidence.mjs"
FIXTURE = r"""
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const argument = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
if (process.env.FIXTURE_MODE === 'signal') process.kill(process.pid, 'SIGTERM');
else if (process.env.FIXTURE_MODE !== 'missing') {
  const failed = process.env.FIXTURE_MODE === 'failure';
  write(argument('--outputFile.json'), JSON.stringify({numTotalTests: 3, numPassedTests: failed ? 1 : 2, numFailedTests: failed ? 1 : 0, numPendingTests: 1, numTodoTests: 0, numTotalTestSuites: 1, success: !failed}));
  write(argument('--outputFile.junit'), '<testsuites tests="3"/>');
  const coverage = argument('--coverage.reportsDirectory');
  const summary = {total: {lines: {total: 3, covered: 3}, functions: {total: 0, covered: 0}, branches: {total: 0, covered: 0}}};
  if (process.env.FIXTURE_MODE === 'bad-summary') summary.total.lines.total = 4;
  write(join(coverage, 'coverage-summary.json'), JSON.stringify(summary));
  write(join(coverage, 'coverage-final.json'), '{}');
  const records = ['server/service.ts', 'client/src/App.tsx', 'shared/types.ts'].map(source =>
    `TN:fixture\nSF:${source}\nFNF:0\nFNH:0\nDA:1,1\nLF:1\nLH:1\nBRF:0\nBRH:0\nend_of_record\n`).join('');
  write(join(coverage, 'lcov.info'), process.env.FIXTURE_MODE === 'malformed' ? records + 'truncated' : records);
  write(join(coverage, 'cobertura-coverage.xml'), '<coverage/>');
  if (failed) process.exitCode = 7;
}
"""


class CoverageEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for package in ["vitest", "@vitest/coverage-v8"]:
            path = self.root / "node_modules" / package
            path.mkdir(parents=True)
            (path / "package.json").write_text(json.dumps({"version": "4.1.12", "type": "module"}))
        (self.root / "node_modules/vitest/vitest.mjs").write_text(FIXTURE)
        (self.root / "vitest.config.ts").write_text("export default { test: { coverage: { provider: 'v8' } } };\n")
        (self.root / "package.json").write_text(json.dumps({"packageManager": "pnpm@10.34.5"}))
        (self.root / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        (self.root / ".gitignore").write_text("node_modules/\ntest-results/\noutput.txt\n")
        for source in ["server/service.ts", "client/src/App.tsx", "shared/types.ts"]:
            path = self.root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export const fixture = true;\n")
        for command in [
            ["git", "init", "-q"],
            ["git", "add", "."],
            ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"],
        ]:
            subprocess.run(command, cwd=self.root, check=True, capture_output=True)

    def run_fixture(self, mode):
        output = self.root / "output.txt"
        env = {**os.environ, "FIXTURE_MODE": mode, "GITHUB_OUTPUT": str(output),
               "DATABASE_URL": "mysql://private_user:PRIVATE_MARKER@localhost/private_test",
               "JWT_SECRET": "PRIVATE_MARKER", "GITHUB_RUN_ID": "123", "GITHUB_REPOSITORY": "fixture/repo",
               "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main",
               "GITHUB_SHA": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()}
        self.last_env = env
        entry = f"import {{runCoverage}} from {json.dumps(RUNNER.as_uri())}; process.exitCode = await runCoverage({{root: {json.dumps(str(self.root))}}});"
        result = subprocess.run(["node", "--input-type=module", "-e", entry], env=env, capture_output=True, text=True, timeout=20)
        directory = self.root / output.read_text().splitlines()[-1].split("=", 1)[1]
        manifest = json.loads((directory / "execution-manifest.json").read_text())
        return result, directory, manifest

    def test_success_binds_source_config_counts_and_hashes_without_secrets(self):
        result, directory, manifest = self.run_fixture("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(manifest["status"], "passed")
        self.assertEqual(manifest["tests"]["pending"], 1)
        self.assertEqual(manifest["tests"]["passed"], 2)
        self.assertEqual(manifest["source"]["commit"], subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip())
        self.assertFalse(manifest["source"]["dirty"])
        self.assertNotIn("PRIVATE_MARKER", json.dumps(manifest))
        self.assertEqual(len(manifest["artifacts"]), 11)
        for artifact in manifest["artifacts"]:
            self.assertEqual(artifact["sha256"], hashlib.sha256((directory / artifact["path"]).read_bytes()).hexdigest())
        partition = json.loads((directory / "coverage/codecov/partition-manifest.json").read_text())
        self.assertEqual(partition["input"]["records"], 3)
        self.assertEqual([item["flag"] for item in partition["partitions"]], ["server", "client", "shared"])
        self.assertEqual(sum(item["bytes"] for item in partition["partitions"]), (directory / "coverage/lcov.info").stat().st_size)
        verified = subprocess.run(
            ["node", str(ROOT / "scripts/ci/coverage-partitions.mjs"), "verify", str(directory.relative_to(self.root))],
            cwd=self.root, env={**self.last_env, "GITHUB_RUN_ATTEMPT": "2"}, capture_output=True, text=True, timeout=20)
        self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertEqual(json.loads(verified.stdout)["originalRunAttempt"], 1)
        self.assertEqual(json.loads(verified.stdout)["uploadRunAttempt"], 2)

    def test_failure_preserves_child_exit_code_even_when_coverage_exists(self):
        result, directory, manifest = self.run_fixture("failure")
        self.assertEqual(result.returncode, 7)
        self.assertEqual(manifest["status"], "failed")
        self.assertEqual(manifest["result"]["exitCode"], 7)
        self.assertEqual(manifest["tests"]["failed"], 1)
        self.assertFalse((directory / "coverage/codecov").exists())

    def test_malformed_coverage_and_inconsistent_summary_fail_a_successful_child(self):
        for mode, error in [("malformed", "LCOV_INCOMPLETE_REPORT"), ("bad-summary", "LCOV_SUMMARY_MISMATCH")]:
            with self.subTest(mode=mode):
                result, directory, manifest = self.run_fixture(mode)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(manifest["result"]["exitCode"], 0)
                self.assertEqual(manifest["status"], "failed")
                self.assertIn(error, manifest["result"]["evidenceErrors"])
                self.assertIn(f"Coverage evidence rejected: {error}", result.stderr)
                self.assertIn(str((directory / "execution-manifest.json").relative_to(self.root)), result.stderr)
                self.assertNotIn("PRIVATE_MARKER", result.stderr)
                self.assertFalse((directory / "coverage/codecov").exists())

    def test_missing_reports_cannot_reuse_prior_success(self):
        _, prior, _ = self.run_fixture("success")
        result, current, manifest = self.run_fixture("missing")
        self.assertNotEqual(prior, current)
        self.assertTrue((prior / "execution-manifest.json").is_file())
        self.assertEqual(result.returncode, 1)
        self.assertEqual(manifest["result"]["exitCode"], 0)
        self.assertEqual(manifest["status"], "failed")
        self.assertIsNone(manifest["tests"])
        self.assertIn("MISSING_OR_INVALID_RESULT_JSON", manifest["result"]["evidenceErrors"])

    def test_terminated_child_is_not_counted_as_passed(self):
        result, _, manifest = self.run_fixture("signal")
        self.assertEqual(result.returncode, 143)
        self.assertEqual(manifest["status"], "interrupted")
        self.assertEqual(manifest["result"]["signal"], "SIGTERM")


if __name__ == "__main__":
    unittest.main()
