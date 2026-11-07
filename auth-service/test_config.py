"""Exercise real settings and SQLAlchemy driver loading without a live database."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy import create_engine

TEST_SECRET = "auth-config-regression-signing-key-for-tests-only"
with patch.dict(os.environ, {"JWT_SECRET": TEST_SECRET, "DATABASE_URL": "sqlite://"}):
    from config import Settings


class DatabaseUrlConfigurationTest(unittest.TestCase):
    def settings_for(self, url):
        return Settings(DATABASE_URL=url, JWT_SECRET=TEST_SECRET, _env_file=None)

    def test_database_url_is_required_in_every_environment(self):
        with patch.dict(os.environ, {}, clear=True):
            for debug in (False, True):
                with self.subTest(debug=debug):
                    with self.assertRaises(ValidationError) as caught:
                        Settings(JWT_SECRET=TEST_SECRET, DEBUG=debug, _env_file=None)
                    self.assertEqual(caught.exception.errors()[0]["loc"], ("DATABASE_URL",))
                    self.assertEqual(caught.exception.errors()[0]["type"], "missing")

    def test_malformed_database_urls_are_rejected(self):
        for url in (
            "", " ", "not-a-url", "mysql://", "mysql:///ais_test",
            "mysql://localhost", "mysql://localhost:invalid/ais_test",
            "mysql://localhost:0/ais_test", "mysql://localhost:65536/ais_test",
            "mysql+pymysql://localhost/", "mysql://local host/ais_test",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ValidationError) as caught:
                    self.settings_for(url)
                self.assertEqual(caught.exception.errors()[0]["loc"], ("DATABASE_URL",))

    def test_explicit_sqlite_fixture_is_preserved(self):
        self.assertEqual(self.settings_for("sqlite://").DATABASE_URL, "sqlite://")

    def test_invalid_configuration_stops_app_import_before_engine_creation(self):
        source = """
import sys
from unittest.mock import patch
from pydantic import ValidationError
with patch("sqlalchemy.create_engine", side_effect=AssertionError("engine must not be created")) as engine:
    try:
        import main
    except ValidationError as error:
        assert any(item["loc"] == ("DATABASE_URL",) for item in error.errors())
    else:
        raise AssertionError("invalid configuration must stop startup")
    engine.assert_not_called()
    assert "main" not in sys.modules
"""
        for url in (None, "", "not-a-url", "mysql://localhost:invalid/ais_test"):
            for debug in ("false", "true"):
                with self.subTest(url=url, debug=debug):
                    env = {
                        **os.environ,
                        "JWT_SECRET": TEST_SECRET,
                        "DEBUG": debug,
                        "PYTHONPATH": str(Path(__file__).resolve().parent),
                    }
                    env.pop("DATABASE_URL", None)
                    if url is not None:
                        env["DATABASE_URL"] = url
                    with tempfile.TemporaryDirectory() as directory:
                        result = subprocess.run(
                            [sys.executable, "-c", source], env=env, cwd=directory,
                            capture_output=True, text=True, timeout=15,
                        )
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_explicit_mysql_url_boots_without_connecting_to_a_database(self):
        source = """
from unittest.mock import patch
with patch("pymysql.connect", side_effect=AssertionError("no live database allowed")) as connect:
    import main
    assert main.engine.url.drivername == "mysql+pymysql"
    assert main.engine.url.database == "ais_test"
    assert any(route.path == "/auth/login" for route in main.app.routes)
    connect.assert_not_called()
"""
        env = {
            **os.environ,
            "JWT_SECRET": TEST_SECRET,
            "DATABASE_URL": "mysql://localhost:3306/ais_test",
            "PYTHONPATH": str(Path(__file__).resolve().parent),
        }
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, "-c", source], env=env, cwd=directory,
                capture_output=True, text=True, timeout=15,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_bare_and_qualified_mysql_urls_load_the_installed_driver(self):
        for scheme in ("mysql", "mysql+pymysql"):
            with self.subTest(scheme=scheme):
                configured = self.settings_for(
                    f"{scheme}://fixture:p%40ss%2Bword@localhost:3306/ais_test"
                )
                engine = create_engine(configured.DATABASE_URL)
                try:
                    self.assertEqual(engine.url.drivername, "mysql+pymysql")
                    self.assertEqual(engine.dialect.driver, "pymysql")
                    self.assertEqual(engine.url.username, "fixture")
                    self.assertEqual(engine.url.password, "p@ss+word")
                    self.assertEqual(engine.url.database, "ais_test")
                    self.assertEqual(
                        self.settings_for(configured.DATABASE_URL).DATABASE_URL,
                        configured.DATABASE_URL,
                    )
                finally:
                    engine.dispose()

    def test_qualified_url_content_is_preserved(self):
        url = "mysql+pymysql://fixture:fixture@localhost/ais_test?fixture=mysql://literal"
        self.assertEqual(self.settings_for(url).DATABASE_URL, url)

    def test_other_explicit_drivers_are_preserved(self):
        url = "mysql+mysqlconnector://fixture:fixture@localhost/ais_test"
        self.assertEqual(self.settings_for(url).DATABASE_URL, url)


if __name__ == "__main__":
    unittest.main()
