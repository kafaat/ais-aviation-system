import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/ci/k8s-release-set.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def obj(kind, name):
    return {'apiVersion': 'apps/v1' if kind == 'Deployment' else 'v1', 'kind': kind, 'metadata': {'name': name, 'namespace': 'test'}, 'spec': {}}


class ReleaseSafety(unittest.TestCase):
    def test_partial_apply_can_restore_all_prior_resources_and_remove_new_ones(self):
        existing = obj('Deployment', 'api')
        existing['metadata'].update(uid='server-owned', resourceVersion='9')
        existing['status'] = {'readyReplicas': 1}
        new = obj('Service', 'auth')
        calls = []
        def fake(*args, data=None):
            calls.append((args, data))
            if args[0] == 'create':
                return json.dumps({'items': [existing, new]})
            if args[0] == 'get':
                return json.dumps(existing) if args[1] == 'deployment/api' else ''
            if args[:2] == ('apply', '-n') and '-f' in args and args[-1] != '-':
                raise RuntimeError('partial apply failure')
            return ''
        with tempfile.TemporaryDirectory() as tmp, patch.object(release, 'kubectl', fake), patch.dict(os.environ, {'GITHUB_OUTPUT': tmp + '/output'}):
            state = tmp + '/state.json'
            with self.assertRaisesRegex(RuntimeError, 'partial'):
                release.apply_set('test', state, ['release.yaml'])
            self.assertEqual(Path(tmp + '/output').read_text(), 'mutated=true\n')
            self.assertEqual(Path(state).stat().st_mode & 0o777, 0o600)
            release.restore(state)
        restored = [json.loads(data) for args, data in calls if data]
        self.assertNotIn('status', restored[0])
        self.assertNotIn('uid', restored[0]['metadata'])
        self.assertTrue(any(args[:2] == ('delete', 'service/auth') for args, _ in calls))
        self.assertTrue(any(args[:3] == ('rollout', 'status', 'deployment/api') for args, _ in calls))

    def test_invalid_kind_or_namespace_never_mutates(self):
        for resource in [obj('Secret', 'secret'), dict(obj('Deployment', 'api'), metadata={'name': 'api', 'namespace': 'other'})]:
            calls = []
            def fake(*args, data=None):
                calls.append(args)
                return json.dumps(resource) if args[0] == 'create' else ''
            with tempfile.TemporaryDirectory() as tmp, patch.object(release, 'kubectl', fake):
                with self.assertRaises(ValueError):
                    release.apply_set('test', tmp + '/state', ['input'])
                self.assertFalse(Path(tmp + '/state').exists())
            self.assertFalse(any(args[:2] == ('apply', '-n') for args in calls))

    def test_restore_continues_after_one_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / 'state'
            state.write_text(json.dumps({'namespace': 'test', 'resources': [{'target': 'service/a', 'prior': None}, {'target': 'service/b', 'prior': None}]}))
            with patch.object(release, 'kubectl', side_effect=[RuntimeError('denied'), '']) as command:
                with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                    release.restore(state)
                self.assertEqual(command.call_count, 2)

    def test_background_manifest_kinds_supported(self):
        kinds = [line.split(':', 1)[1].strip() for line in (ROOT / 'k8s/base/background.yaml').read_text().splitlines() if line.startswith('kind:')]
        self.assertTrue(kinds)
        self.assertTrue(set(kinds) <= {'Deployment', 'ConfigMap', 'Service', 'Ingress'})


class ShellSafety(unittest.TestCase):
    def execute_with_fakes(self, script, fake_git, fake_gh='', extra_args=()):
        with tempfile.TemporaryDirectory() as tmp:
            for name, body in [('git', fake_git), ('gh', fake_gh)]:
                path = Path(tmp) / name
                path.write_text('#!/bin/bash\nset -eu\n' + body)
                path.chmod(0o755)
            candidates = Path(tmp) / 'candidates'
            candidates.write_text('## A\nfeature/test\n')
            env = dict(os.environ, PATH=tmp + ':' + os.environ['PATH'], CALL_LOG=tmp + '/calls', GITHUB_REPOSITORY='test/repo')
            args = ['bash', str(ROOT / script)]
            if 'prune' in script:
                args += [str(candidates), *extra_args]
            result = subprocess.run(args, env=env, text=True, capture_output=True)
            log = Path(tmp + '/calls').read_text() if Path(tmp + '/calls').exists() else ''
            return result, log

    def test_previous_release_skips_candidate_and_prereleases(self):
        result, _ = self.execute_with_fakes('scripts/ci/previous-release.sh', '''
if [[ "$1" == tag ]]; then printf 'v2.0.0\nv1.9.0-rc.1\nv1.8.0\n';
elif [[ "$2" == HEAD || "$2" == 'v2.0.0^{commit}' ]]; then echo candidate;
else echo previous; fi
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'tag=v1.8.0\nsha=previous\ncandidate=candidate\n')

    def test_prune_uses_compare_and_swap_only_after_archive_and_pr_checks(self):
        sha = 'a' * 40
        git = 'echo "$*" >> "$CALL_LOG"\n'
        gh = f'''if [[ "$2" == *pulls* ]]; then :; else printf 'refs/heads/feature/test {sha}\\nrefs/heads/archive/feature/test {sha}\\n'; fi\n'''
        result, log = self.execute_with_fakes('scripts/ops/prune-branches.sh', git, gh, ('--apply',))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--force-with-lease=refs/heads/feature/test:' + sha, log)
        self.assertIn(':refs/heads/feature/test', log)
        result, log = self.execute_with_fakes('scripts/ops/prune-branches.sh', git, gh)
        self.assertNotIn('push', log)

    def test_prune_rechecks_pr_before_push(self):
        sha = 'a' * 40
        gh = f'''if [[ "$2" == *pulls* ]]; then
          if [[ -f "$CALL_LOG.pr" ]]; then echo feature/test; else touch "$CALL_LOG.pr"; fi
        else printf 'refs/heads/feature/test {sha}\\nrefs/heads/archive/feature/test {sha}\\n'; fi
'''
        result, log = self.execute_with_fakes('scripts/ops/prune-branches.sh', 'echo "$*" >> "$CALL_LOG"\n', gh, ('--apply',))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('push', log)
        self.assertIn('changed during inspection', result.stdout)

    def test_prune_refuses_open_pr_and_missing_archive(self):
        for gh in ['echo feature/test\n', "if [[ \"$2\" == *pulls* ]]; then :; else echo 'refs/heads/feature/test " + 'a' * 40 + "'; fi\n"]:
            result, log = self.execute_with_fakes('scripts/ops/prune-branches.sh', 'echo "$*" >> "$CALL_LOG"\n', gh, ('--apply',))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('push', log)


class BackupSafety(unittest.TestCase):
    def test_restore_checksum_mismatch_prevents_any_mysql_call(self):
        spec = importlib.util.spec_from_file_location('backup', ROOT / 'scripts/ci/backup-restore-smoke.py')
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'candidate.sql').write_text('corrupted')
            (path / 'candidate.sql.sha256').write_text('0' * 64 + '  candidate.sql\n')
            mysql = path / 'mysql'
            mysql.write_text('#!/bin/sh\necho called >> "$CALL_LOG"\n')
            mysql.chmod(0o755)
            env = dict(os.environ, PATH=tmp + ':' + os.environ['PATH'], AIS_RESTORE_DIR=tmp, MYSQL_DATABASE='ais_test', CALL_LOG=tmp + '/calls')
            result = subprocess.run(['sh', '-ec', backup.RESTORE_COMMAND, 'restore', 'candidate'], env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'checksum', result.stderr)
            self.assertFalse((path / 'calls').exists())

    def test_smoke_refuses_non_disposable_environment_before_docker(self):
        spec = importlib.util.spec_from_file_location('backup', ROOT / 'scripts/ci/backup-restore-smoke.py')
        backup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(backup)
        with patch.dict(os.environ, {}, clear=True), patch.object(backup, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, 'disposable'):
                backup.main()
            command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
