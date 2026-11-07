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
TEST_SERVICE_TOKEN = "auth-config-regression-service-token-for-tests-only"
with patch.dict(
    os.environ,
    {
        "JWT_SECRET": TEST_SECRET,
        "DATABASE_URL": "sqlite://",
        "AUTH_SERVICE_TOKEN": TEST_SERVICE_TOKEN,
    },
):
    from config import SERVICE_TOKEN_MIN_LENGTH, Settings


class DatabaseUrlConfigurationTest(unittest.TestCase):
    def settings_for(self, url):
        return Settings(
            DATABASE_URL=url,
            JWT_SECRET=TEST_SECRET,
            AUTH_SERVICE_TOKEN=TEST_SERVICE_TOKEN,
            _env_file=None,
        )

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
            "AUTH_SERVICE_TOKEN": TEST_SERVICE_TOKEN,
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


class ServiceTokenConfigurationTest(unittest.TestCase):
    """The shared service credential fails closed outside DEBUG mode."""

    def settings_for(self, token, debug=False):
        kwargs = dict(DATABASE_URL="sqlite://", JWT_SECRET=TEST_SECRET, DEBUG=debug, _env_file=None)
        if token is not None:
            kwargs["AUTH_SERVICE_TOKEN"] = token
        return Settings(**kwargs)

    def assert_rejected(self, token, debug=False, message=None):
        with self.assertRaises(ValidationError) as caught:
            self.settings_for(token, debug)
        errors = caught.exception.errors()
        self.assertTrue(
            any("AUTH_SERVICE_TOKEN" in str(error["loc"]) or "AUTH_SERVICE_TOKEN" in error["msg"] for error in errors),
            errors,
        )
        if message:
            self.assertTrue(any(message in error["msg"] for error in errors), errors)

    def test_production_mode_requires_an_explicit_token(self):
        with patch.dict(os.environ, {}, clear=True):
            for token in (None, "", "   "):
                with self.subTest(token=token):
                    self.assert_rejected(token, message="required outside DEBUG mode")

    def test_production_mode_rejects_placeholder_and_weak_tokens(self):
        for token in ("CHANGE_ME", "change_me", " changeme ", "secret", "token"):
            with self.subTest(token=token):
                self.assert_rejected(token, message="placeholder")
        for token in ("short", "x" * (SERVICE_TOKEN_MIN_LENGTH - 1)):
            with self.subTest(token=token):
                self.assert_rejected(token, message=f"at least {SERVICE_TOKEN_MIN_LENGTH} characters")
        with self.subTest(token="whitespace inside"):
            self.assert_rejected("a" * 20 + " " + "b" * 20, message="whitespace")

    def test_production_mode_accepts_a_usable_token_and_strips_it(self):
        settings = self.settings_for(f"  {TEST_SERVICE_TOKEN}  ")
        self.assertEqual(settings.AUTH_SERVICE_TOKEN, TEST_SERVICE_TOKEN)
        self.assertEqual(
            self.settings_for("x" * SERVICE_TOKEN_MIN_LENGTH).AUTH_SERVICE_TOKEN,
            "x" * SERVICE_TOKEN_MIN_LENGTH,
        )

    def test_debug_mode_keeps_explicit_fixtures_but_never_placeholders(self):
        # Local development may run without a credential (the routes then
        # answer 503) or with a short explicit fixture; placeholder values
        # from the example files are refused everywhere.
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.settings_for(None, debug=True).AUTH_SERVICE_TOKEN, "")
        self.assertEqual(self.settings_for("", debug=True).AUTH_SERVICE_TOKEN, "")
        self.assertEqual(self.settings_for("local-fixture", debug=True).AUTH_SERVICE_TOKEN, "local-fixture")
        self.assert_rejected("CHANGE_ME", debug=True, message="placeholder")

    def test_missing_production_token_stops_app_import_before_engine_creation(self):
        source = """
import sys
from unittest.mock import patch
from pydantic import ValidationError
with patch("sqlalchemy.create_engine", side_effect=AssertionError("engine must not be created")) as engine:
    try:
        import main
    except ValidationError as error:
        assert any("AUTH_SERVICE_TOKEN" in str(item["msg"]) for item in error.errors()), error.errors()
    else:
        raise AssertionError("a production start without AUTH_SERVICE_TOKEN must fail")
    engine.assert_not_called()
    assert "main" not in sys.modules
"""
        for token in (None, "", "CHANGE_ME", "too-short"):
            for debug in (None, "false"):
                with self.subTest(token=token, debug=debug):
                    env = {
                        **os.environ,
                        "JWT_SECRET": TEST_SECRET,
                        "DATABASE_URL": "mysql://localhost:3306/ais_test",
                        "PYTHONPATH": str(Path(__file__).resolve().parent),
                    }
                    env.pop("AUTH_SERVICE_TOKEN", None)
                    env.pop("DEBUG", None)
                    if token is not None:
                        env["AUTH_SERVICE_TOKEN"] = token
                    if debug is not None:
                        env["DEBUG"] = debug
                    with tempfile.TemporaryDirectory() as directory:
                        result = subprocess.run(
                            [sys.executable, "-c", source], env=env, cwd=directory,
                            capture_output=True, text=True, timeout=15,
                        )
                    self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
