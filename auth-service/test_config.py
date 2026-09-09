"""Exercise real settings and SQLAlchemy driver loading without a live database."""
import os
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine

TEST_SECRET = "auth-config-regression-signing-key-for-tests-only"
with patch.dict(os.environ, {"JWT_SECRET": TEST_SECRET}):
    from config import Settings


class DatabaseUrlConfigurationTest(unittest.TestCase):
    def settings_for(self, url):
        return Settings(DATABASE_URL=url, JWT_SECRET=TEST_SECRET, _env_file=None)

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
