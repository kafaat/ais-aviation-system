"""The operator's launch path must target the database and configuration the image uses."""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ProductionRunbook(unittest.TestCase):
    def test_examples_declare_compose_and_runtime_inputs(self):
        for filename, manifest in ((".env.production.example", "docker-compose.production.yml"),
                                   (".env.prod.example", "docker-compose.prod.yml")):
            with self.subTest(filename=filename):
                example = (ROOT / filename).read_text()
                keys = set(re.findall(r"^([A-Z0-9_]+)=", example, re.M))
                required = set(re.findall(r"\$\{([A-Z0-9_]+):\?", (ROOT / manifest).read_text()))
                required.update(("SELF_SERVICE_CAPABILITY_SECRET", "DB_NAME", "DB_ROOT_PASSWORD",
                                 "RESEND_API_KEY", "FRONTEND_URL", "JWT_SECRET", "CSRF_SECRET"))
                self.assertFalse(required - keys, f"Missing bindings: {sorted(required - keys)}")
                self.assertNotIn("postgresql://", example)

    def test_full_runbook_uses_the_migrator_and_guarded_restore(self):
        guide = (ROOT / "docs/GO_LIVE_RUNBOOK.md").read_text()
        self.assertNotRegex(guide, r"\b(?:psql|pg_dump|ais_postgres)\b")
        commands = [line for line in guide.splitlines() if re.search(r"docker(?:-| )compose .*?-f docker-compose.production.yml", line)]
        self.assertTrue(commands)
        for command in commands:
            self.assertIn("--env-file .env.production", command)
        self.assertIn("scripts/db/migrate.ts verify", guide)
        self.assertIn("BACKUP_RESTORE_ACCEPTANCE.md", guide)
