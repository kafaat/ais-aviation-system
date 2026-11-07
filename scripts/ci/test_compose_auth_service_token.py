#!/usr/bin/env python3
"""Compose must refuse to start without the shared auth-service credential.

Static checks read the three Compose files; interpolation checks run the real
`docker compose config` (skipped only when Docker Compose is unavailable) with
the credential missing (negative) and configured (positive) and confirm the
identical value reaches every Node API replica and the auth service.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
FILES = {
    "docker-compose.production.yml": {"api1", "api2", "api3", "auth-service"},
    "docker-compose.prod.yml": {"app", "auth-service"},
    "docker-compose.yml": {"auth-service"},
}
TOKEN = "compose-interpolation-test-token-only-for-tests-not-a-key"
FIXTURE = "compose-interpolation-fixture-value-at-least-32-chars"


def required_variables(text: str) -> set[str]:
    return set(re.findall(r"\$\{([A-Z0-9_]+):\?", text))


def compose_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        result = subprocess.run(
            ["docker", "compose", "version"], capture_output=True, text=True, timeout=20
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


class ComposeAuthServiceTokenTest(unittest.TestCase):
    def test_no_compose_file_defaults_the_credential_to_empty(self):
        for name, services in FILES.items():
            text = (ROOT / name).read_text()
            with self.subTest(file=name):
                self.assertNotIn("AUTH_SERVICE_TOKEN:-", text, "empty fallback reintroduced")
                self.assertEqual(
                    len(re.findall(r"\$\{AUTH_SERVICE_TOKEN:\?", text)),
                    len(services),
                    f"{name} must require AUTH_SERVICE_TOKEN once per {sorted(services)}",
                )

    def run_config(self, name: str, with_token: bool):
        text = (ROOT / name).read_text()
        env = {
            "PATH": os.environ["PATH"],
            "HOME": os.environ.get("HOME", "/tmp"),
            **{key: FIXTURE for key in required_variables(text) - {"AUTH_SERVICE_TOKEN"}},
        }
        for key in ("DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"):
            if key in os.environ:
                env[key] = os.environ[key]
        if with_token:
            env["AUTH_SERVICE_TOKEN"] = TOKEN
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / name
            target.write_text(text)
            # env_file entries must exist for `config`; keep them empty so the
            # interpolation decision comes only from the process environment.
            for env_file in re.findall(r"^\s+-\s+(\.env[\w.-]*)\s*$", text, re.MULTILINE):
                (Path(directory) / env_file).write_text("")
            return subprocess.run(
                ["docker", "compose", "-f", str(target), "config", "--format", "json"],
                cwd=directory, env=env, capture_output=True, text=True, timeout=120,
            )

    @unittest.skipUnless(compose_available(), "Docker Compose is not available")
    def test_missing_credential_fails_interpolation_before_any_service_starts(self):
        for name in FILES:
            with self.subTest(file=name):
                result = self.run_config(name, with_token=False)
                self.assertNotEqual(result.returncode, 0, result.stdout[:500])
                self.assertIn("AUTH_SERVICE_TOKEN", result.stderr)
                self.assertIn("required variable", result.stderr)

    @unittest.skipUnless(compose_available(), "Docker Compose is not available")
    def test_configured_credential_reaches_every_api_replica_and_the_auth_service(self):
        for name, services in FILES.items():
            with self.subTest(file=name):
                result = self.run_config(name, with_token=True)
                self.assertEqual(result.returncode, 0, result.stderr[-2000:])
                rendered = json.loads(result.stdout)["services"]
                carrying = {
                    service
                    for service, spec in rendered.items()
                    if (spec.get("environment") or {}).get("AUTH_SERVICE_TOKEN") == TOKEN
                }
                self.assertEqual(carrying, services)
                # No other service receives the credential by accident.
                for service, spec in rendered.items():
                    if service not in services:
                        self.assertNotIn(
                            "AUTH_SERVICE_TOKEN", spec.get("environment") or {}, service
                        )


if __name__ == "__main__":
    unittest.main()
