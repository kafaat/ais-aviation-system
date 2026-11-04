"""Exercise the auth HTTP contract with the real ASGI stack and isolated SQLite."""

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


TEST_SERVICE_TOKEN = "auth-http-contract-service-token-for-tests"
TEST_ORIGIN = "https://auth-ui.example.com"
TEST_EMAIL = "http-contract@example.com"
TEST_PASSWORD = "AuthContractPassword123!"

# test_config may already have imported config during unittest discovery. Patch
# its settings as well as the environment so app import never selects a live DB.
with patch.dict(
    os.environ,
    {
        "JWT_SECRET": "auth-http-contract-signing-key-only-for-tests",
        "DATABASE_URL": "sqlite://",
        "AUTH_SERVICE_TOKEN": TEST_SERVICE_TOKEN,
        "CORS_ORIGINS": TEST_ORIGIN,
    },
):
    import config as auth_config

    with patch.multiple(
        auth_config.settings,
        DATABASE_URL="sqlite://",
        AUTH_SERVICE_TOKEN=TEST_SERVICE_TOKEN,
        CORS_ORIGINS=TEST_ORIGIN,
    ):
        import main as auth


class AuthHttpContractTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.addCleanup(engine.dispose)
        auth.Base.metadata.create_all(engine)
        self.sessions = sessionmaker(bind=engine)

        def isolated_db():
            with self.sessions() as session:
                yield session

        self.enterContext(
            patch.dict(auth.app.dependency_overrides, {auth.get_db: isolated_db})
        )
        self.enterContext(
            patch.object(auth.settings, "AUTH_SERVICE_TOKEN", TEST_SERVICE_TOKEN)
        )
        self.client = self.enterContext(TestClient(auth.app))
        self.headers = {"x-auth-service-token": TEST_SERVICE_TOKEN}

    def register(self, **overrides):
        return self.client.post(
            "/auth/register",
            headers=self.headers,
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD,
                "name": "HTTP contract fixture",
                **overrides,
            },
        )

    def test_all_auth_routes_require_the_service_credential(self):
        for path in ("/auth/register", "/auth/login", "/auth/verify-password"):
            for headers in ({}, {"x-auth-service-token": "incorrect-test-token"}):
                with self.subTest(path=path, credential=bool(headers)):
                    response = self.client.post(
                        path,
                        headers=headers,
                        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
                    )
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(
                        response.json(), {"detail": "Service credential required."}
                    )

    def test_registration_and_login_preserve_the_public_user_response(self):
        registered = self.register(role="admin")
        self.assertEqual(registered.status_code, 200)
        user = registered.json()["user"]
        self.assertEqual(user["role"], "user")
        self.assertEqual(
            set(user), {"id", "openId", "name", "email", "role"}
        )
        logged_in = self.client.post(
            "/auth/login",
            headers=self.headers,
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        self.assertEqual(logged_in.status_code, 200)
        self.assertTrue(logged_in.json()["success"])
        self.assertEqual(logged_in.json()["user"], user)

    def test_invalid_credentials_keep_the_same_public_error(self):
        self.assertEqual(self.register().status_code, 200)
        for email in (TEST_EMAIL, "unknown-http-contract@example.com"):
            with self.subTest(email=email):
                response = self.client.post(
                    "/auth/login",
                    headers=self.headers,
                    json={"email": email, "password": "IncorrectPassword123!"},
                )
                self.assertEqual(response.status_code, 401)
                self.assertEqual(
                    response.json(), {"detail": "Invalid email or password."}
                )

    def test_password_verification_preserves_success_and_failure_contracts(self):
        self.assertEqual(self.register().status_code, 200)
        for email, password, expected in (
            (TEST_EMAIL, TEST_PASSWORD, True),
            (TEST_EMAIL, "IncorrectPassword123!", False),
            ("unknown-http-contract@example.com", TEST_PASSWORD, False),
        ):
            with self.subTest(email=email, success=expected):
                response = self.client.post(
                    "/auth/verify-password",
                    headers=self.headers,
                    json={"email": email, "password": password},
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["success"], expected)
                if not expected:
                    self.assertIsNone(response.json()["user"])
                    self.assertEqual(
                        response.json()["message"], "Invalid email or password."
                    )

    def test_registration_validation_rejects_invalid_json_values(self):
        for overrides in (
            {"email": "invalid-email"},
            {"password": "short"},
            {"password": "é" * 37},  # 74 UTF-8 bytes exceeds bcrypt's limit.
        ):
            with self.subTest(overrides=overrides):
                self.assertEqual(self.register(**overrides).status_code, 422)
        with self.sessions() as session:
            self.assertEqual(session.query(auth.User).count(), 0)

    def test_duplicate_registration_keeps_the_conflict_response(self):
        self.assertEqual(self.register().status_code, 200)
        duplicate = self.register()
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(
            duplicate.json(), {"detail": "A user with this email already exists."}
        )

    def test_readiness_reports_database_failure_without_internal_details(self):
        self.assertEqual(self.client.get("/auth/health").status_code, 200)

        class UnavailableDatabase:
            def execute(self, _statement):
                raise RuntimeError("synthetic-private-database-error")

        with patch.dict(
            auth.app.dependency_overrides,
            {auth.get_db: lambda: UnavailableDatabase()},
        ):
            response = self.client.get("/auth/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": "Database unavailable"})
        self.assertNotIn("synthetic-private-database-error", response.text)

    def test_cors_preflight_preserves_the_configured_origin_boundary(self):
        for origin, expected_status in (
            (TEST_ORIGIN, 200),
            ("https://untrusted.example.com", 400),
        ):
            with self.subTest(origin=origin):
                response = self.client.options(
                    "/auth/login",
                    headers={
                        "origin": origin,
                        "access-control-request-method": "POST",
                        "access-control-request-headers": "x-auth-service-token,content-type",
                    },
                )
                self.assertEqual(response.status_code, expected_status)
                if expected_status == 200:
                    self.assertEqual(
                        response.headers["access-control-allow-origin"], TEST_ORIGIN
                    )
                else:
                    self.assertNotIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
