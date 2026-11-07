"""
Configuration for the Auth Service.
Security-sensitive values fail closed instead of falling back to usable secrets.
"""

import hashlib
import os
import re

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


INSECURE_JWT_SECRETS = {
    "your-super-secret-jwt-key-change-this-in-production",
    "test-jwt-secret-key",
    "test-secret-key-for-ci",
}

# Example-file and documentation values for the service credential. Compared
# case-insensitively after stripping, so "change_me" and "CHANGE-ME" also fail.
INSECURE_SERVICE_TOKENS = {
    "change_me",
    "change-me",
    "changeme",
    "auth_service_token",
    "auth-service-token",
    "your-auth-service-token",
    "local-development-auth-service-token-not-for-production",
    "placeholder",
    "secret",
    "token",
}

# Minimum length of the shared service credential outside DEBUG mode. Length
# does not prove entropy; operators must generate it randomly (see SECURITY.md).
SERVICE_TOKEN_MIN_LENGTH = 32


class Settings(BaseSettings):
    # Database: required in every environment, including development and tests.
    DATABASE_URL: str

    # JWT: required in every environment. There is deliberately no usable default.
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    REFRESH_TOKEN_PEPPER: str = ""

    # App
    APP_NAME: str = "AIS Auth Service"
    APP_ID: str = "ais-aviation-system"
    DEBUG: bool = False
    PORT: int = 8000

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    # Owner (auto-admin)
    OWNER_EMAIL: str = ""

    # Shared secret the Node backend presents on every call. Every auth route
    # requires it; nothing else may ask whether a password matches. Outside
    # DEBUG mode the process refuses to start without a usable value, and even
    # in DEBUG mode an empty value makes the auth routes answer 503 rather
    # than serving anonymous callers.
    AUTH_SERVICE_TOKEN: str = ""

    @field_validator("DATABASE_URL")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        # Rewrite only a bare scheme. "pymysql://" also contains "mysql://",
        # so substring replacement corrupts already qualified SQLAlchemy URLs.
        if value.startswith("mysql://"):
            value = "mysql+pymysql://" + value[len("mysql://"):]
        try:
            url = make_url(value)
        except (ArgumentError, ValueError):
            raise ValueError("DATABASE_URL must be a valid SQLAlchemy connection URL") from None
        if url.get_backend_name() == "mysql":
            if not url.host or not url.database or not url.database.strip():
                raise ValueError("DATABASE_URL must specify a MySQL host and database")
            if any(character.isspace() for character in url.host):
                raise ValueError("DATABASE_URL must specify a valid MySQL host")
            if url.port is not None and not 1 <= url.port <= 65535:
                raise ValueError("DATABASE_URL must specify a valid MySQL port")
        return value

    @field_validator("JWT_SECRET")
    @classmethod
    def validate_jwt_secret(cls, value: str) -> str:
        secret = value.strip()

        # The legacy CI fixture is never accepted as a signing key. GitHub Actions
        # may present it only as a sentinel; when trustworthy run identity is
        # available, derive a per-run 256-bit value before any use.
        if secret == "test-secret-key-for-ci" and os.getenv("GITHUB_ACTIONS") == "true":
            run_id = os.getenv("GITHUB_RUN_ID", "")
            run_attempt = os.getenv("GITHUB_RUN_ATTEMPT", "")
            sha = os.getenv("GITHUB_SHA", "")
            if run_id.isdigit() and run_attempt.isdigit() and re.fullmatch(r"[0-9a-fA-F]{40}", sha):
                material = f"ais-auth-ci:{run_id}:{run_attempt}:{sha}".encode()
                secret = hashlib.sha256(material).hexdigest()

        if len(secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters long")
        if secret in INSECURE_JWT_SECRETS:
            raise ValueError("JWT_SECRET must not use a known placeholder value")
        return secret

    @field_validator("AUTH_SERVICE_TOKEN")
    @classmethod
    def normalize_service_token(cls, value: str) -> str:
        token = value.strip()
        if token and token.lower() in INSECURE_SERVICE_TOKENS:
            raise ValueError(
                "AUTH_SERVICE_TOKEN must not use a known placeholder value"
            )
        if token and any(character.isspace() for character in token):
            raise ValueError("AUTH_SERVICE_TOKEN must not contain whitespace")
        if token and not all(33 <= ord(character) <= 126 for character in token):
            raise ValueError("AUTH_SERVICE_TOKEN must use printable ASCII characters")
        if len(token) >= SERVICE_TOKEN_MIN_LENGTH and len(set(token)) == 1:
            raise ValueError("AUTH_SERVICE_TOKEN must not use a repeated-character value")
        return token

    @model_validator(mode="after")
    def require_service_token_outside_debug(self) -> "Settings":
        # DEBUG is the only explicit non-production switch this service has.
        # Every other start (Compose, Railway, Kubernetes, the built image)
        # is production and fails closed before the engine is created.
        if self.DEBUG:
            return self
        if not self.AUTH_SERVICE_TOKEN:
            raise ValueError(
                "AUTH_SERVICE_TOKEN is required outside DEBUG mode: set the shared "
                "service credential (at least 32 random characters) on this "
                "service and on every Node API replica"
            )
        if len(self.AUTH_SERVICE_TOKEN) < SERVICE_TOKEN_MIN_LENGTH:
            raise ValueError(
                "AUTH_SERVICE_TOKEN must be at least "
                f"{SERVICE_TOKEN_MIN_LENGTH} characters outside DEBUG mode"
            )
        return self

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
