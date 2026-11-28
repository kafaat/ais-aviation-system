"""Production Compose must satisfy the worker's queue and provider contracts."""
import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


def service(manifest, name):
    match = re.search(rf"^  {name}:\n(.*?)(?=^  [\w-]+:|^\S|\Z)", manifest, re.M | re.S)
    if not match:
        raise AssertionError(f"Missing Compose service {name}")
    return match.group(1)


class WorkerComposeContracts(unittest.TestCase):
    def test_queue_redis_keeps_jobs_in_both_production_profiles(self):
        for path in ("docker-compose.prod.yml", "docker-compose.production.yml"):
            with self.subTest(path=path):
                manifest = (ROOT / path).read_text()
                self.assertIn("dist/worker.js", service(manifest, "worker"))
                policies = re.findall(r"--maxmemory-policy\s+(\S+)", service(manifest, "redis"))
                self.assertEqual(policies, ["noeviction"])

    def test_worker_receives_signature_configuration_for_stripe_replay(self):
        manifest = (ROOT / "docker-compose.production.yml").read_text()
        binding = "- STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}"
        for name in ("api1", "api2", "api3", "worker"):
            with self.subTest(service=name):
                self.assertIn(binding, [line.strip() for line in service(manifest, name).splitlines()])

        lite = (ROOT / "docker-compose.prod.yml").read_text()
        for name in ("app", "worker"):
            self.assertRegex(service(lite, name), r"env_file:\n\s+- \.env\.prod\b")
        self.assertRegex((ROOT / ".env.prod.example").read_text(), r"(?m)^STRIPE_WEBHOOK_SECRET=")
