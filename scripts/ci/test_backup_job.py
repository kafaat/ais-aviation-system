"""Execute the generated shell command at dump failure and persistence boundaries."""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "backup_job", Path(__file__).resolve().parents[1] / "k8s-backup-job.py")
backup_job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_job)


class BackupJobTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "backup"
        self.output.mkdir()
        self.client = self.root / "mysqldump"
        self.client.write_text("#!/bin/sh\nprintf 'CREATE TABLE fixture (id int);\\n'\n")
        self.client.chmod(0o700)
        job = backup_job.build_job({"BACKUP_PVC": "backup-pvc",
                                    "BACKUP_CREDENTIAL_SECRET": "backup-secret",
                                    "BACKUP_RUN_ID": "123-1"})
        self.command = job["spec"]["template"]["spec"]["containers"][0]["command"]
        self.env = dict(os.environ, PATH=str(self.root) + os.pathsep + os.environ["PATH"],
                        BACKUP_DIR=str(self.output), BACKUP_NAME="db-backup-123-1",
                        MYSQL_HOST="unused", MYSQL_USER="fixture", MYSQL_DATABASE="fixture_test",
                        MYSQL_PWD="unit-test-only")

    def execute(self):
        return subprocess.run(self.command, env=self.env, capture_output=True, timeout=30)

    def test_success_has_matching_checksum_and_private_permissions(self):
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        dump = self.output / "db-backup-123-1.sql"
        self.assertEqual(dump.stat().st_mode & 0o777, 0o600)
        checksum = (self.output / "db-backup-123-1.sql.sha256").read_text()
        self.assertEqual(checksum, hashlib.sha256(dump.read_bytes()).hexdigest() + "  db-backup-123-1.sql\n")
        self.assertEqual(len(list(self.output.iterdir())), 2)

    def test_failed_dump_cannot_publish_partial_output(self):
        self.client.write_text("#!/bin/sh\nprintf 'partial SQL'\nexit 2\n")
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_empty_dump_cannot_report_success(self):
        self.client.write_text("#!/bin/sh\nexit 0\n")
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_existing_backup_is_unchanged(self):
        self.assertEqual(self.execute().returncode, 0)
        before = {p.name: p.read_bytes() for p in self.output.iterdir()}
        self.client.write_text("#!/bin/sh\nprintf 'replacement SQL'\n")
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertEqual({p.name: p.read_bytes() for p in self.output.iterdir()}, before)

    def test_another_writer_lock_is_preserved(self):
        lock = self.output / "db-backup-123-1.lock"
        lock.mkdir()
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertTrue(lock.is_dir())
        self.assertEqual(list(self.output.iterdir()), [lock])

    def test_unsafe_backup_name_cannot_escape_directory(self):
        self.env["BACKUP_NAME"] = "../outside"
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_missing_credentials_fail_before_dumping(self):
        del self.env["MYSQL_PWD"]
        self.assertNotEqual(self.execute().returncode, 0)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_invalid_job_configuration_is_rejected(self):
        for env in ({}, {"BACKUP_PVC": "pvc", "BACKUP_CREDENTIAL_SECRET": "secret", "BACKUP_RUN_ID": "../other"}):
            with self.subTest(env=env), self.assertRaises(ValueError):
                backup_job.build_job(env)

    def valid(self, **overrides):
        return backup_job.build_job({"BACKUP_PVC": "backup-pvc",
                                     "BACKUP_CREDENTIAL_SECRET": "backup-secret",
                                     "BACKUP_RUN_ID": "123-1", **overrides})

    def test_dump_never_runs_as_root_or_with_extra_privileges(self):
        pod = self.valid()["spec"]["template"]["spec"]
        self.assertTrue(pod["securityContext"]["runAsNonRoot"])
        self.assertNotEqual(pod["securityContext"]["runAsUser"], 0)
        # fsGroup must match, or the non-root dump cannot write to the PVC.
        self.assertEqual(pod["securityContext"]["fsGroup"],
                         pod["securityContext"]["runAsUser"])
        container = pod["containers"][0]["securityContext"]
        self.assertFalse(container["allowPrivilegeEscalation"])
        self.assertTrue(container["readOnlyRootFilesystem"])
        self.assertEqual(container["capabilities"]["drop"], ["ALL"])

    def test_read_only_root_still_offers_scratch_space(self):
        pod = self.valid()["spec"]["template"]["spec"]
        mounts = {m["mountPath"] for m in pod["containers"][0]["volumeMounts"]}
        self.assertEqual(mounts, {"/backup", "/tmp"})
        self.assertIn("emptyDir", next(v for v in pod["volumes"] if v["name"] == "tmp"))

    def test_container_declares_resources(self):
        resources = self.valid()["spec"]["template"]["spec"]["containers"][0]["resources"]
        self.assertTrue(resources["requests"] and resources["limits"])

    def test_deadline_is_operator_sizable_within_bounds(self):
        self.assertEqual(self.valid()["spec"]["activeDeadlineSeconds"],
                         backup_job.DEFAULT_DEADLINE_SECONDS)
        self.assertEqual(
            self.valid(BACKUP_DEADLINE_SECONDS="7200")["spec"]["activeDeadlineSeconds"], 7200)
        # An unset workflow variable arrives as an empty string, which must mean
        # the default rather than a failure.
        self.assertEqual(
            self.valid(BACKUP_DEADLINE_SECONDS="")["spec"]["activeDeadlineSeconds"],
            backup_job.DEFAULT_DEADLINE_SECONDS)
        # An unbounded or unparsable window would reintroduce a silent kill with
        # no retry, so anything outside the reviewed range is refused outright.
        for value in ("0", "60", "86400", "abc", "-600", "3600.5"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.valid(BACKUP_DEADLINE_SECONDS=value)

    def test_image_reference_is_overridable_and_validated(self):
        digest = "mysql@sha256:" + "a" * 64
        self.assertEqual(
            self.valid(BACKUP_IMAGE=digest)["spec"]["template"]["spec"]["containers"][0]["image"],
            digest)
        for value in ("mysql:8.0; rm -rf /", "MySQL:8.0", "mysql:8.0 --privileged", "-mysql:8.0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.valid(BACKUP_IMAGE=value)

    def test_default_image_is_pinned_to_a_digest(self):
        # A mutable tag means two runs of the same reviewed code can dump with
        # different mysql clients, so the default carries an immutable digest.
        image = self.valid()["spec"]["template"]["spec"]["containers"][0]["image"]
        self.assertEqual(image, backup_job.DEFAULT_IMAGE)
        self.assertRegex(image, r"^mysql:[\w.\-]+@sha256:[a-f0-9]{64}$")


if __name__ == "__main__":
    unittest.main()
