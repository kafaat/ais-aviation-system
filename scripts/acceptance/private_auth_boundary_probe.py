#!/usr/bin/env python3
"""Read-only, private-network auth credential parity probe for AIS staging.

Execute from ais-web's own deployed environment, never from a public browser.
No credentials, addresses, request bodies or response bodies are printed.
A PASS proves only the scoped private HTTP handshake at this source revision;
it does not certify entropy, DEBUG=false, secret storage or production release.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

SOURCE_PATTERN = re.compile(r"[0-9a-f]{40}\Z")
PLACEHOLDERS = {
    "change_me", "change-me", "changeme", "auth_service_token",
    "auth-service-token", "your-auth-service-token", "placeholder",
    "secret", "token", "local-development-auth-service-token-not-for-production",
}
PATHS = ("/auth/register", "/auth/login", "/auth/verify-password")


def validate_target(raw: str) -> str:
    parsed = urllib.parse.urlsplit(raw)
    host = (parsed.hostname or "").lower()
    private = host in {"127.0.0.1", "localhost", "auth-service", "ais-auth"} or host.endswith(".railway.internal")
    if (parsed.scheme not in {"http", "https"} or not private or not host or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise ValueError("AUTH_SERVICE_URL must be a private auth-service origin")
    try:
        port = parsed.port
    except ValueError:
        raise ValueError("Invalid AUTH_SERVICE_URL port") from None
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("Invalid AUTH_SERVICE_URL port")
    return raw.rstrip("/")


def validate_token(token: str) -> None:
    if len(token) < 32 or not all(33 <= ord(char) <= 126 for char in token):
        raise ValueError("AUTH_SERVICE_TOKEN is absent or unusable")
    if token.lower() in PLACEHOLDERS or len(set(token)) == 1:
        raise ValueError("AUTH_SERVICE_TOKEN is a known placeholder or trivial value")


def http_call(opener, origin: str, path: str, method="POST", payload=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["X-Auth-Service-Token"] = token
    req = urllib.request.Request(
        origin + path,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers=headers,
        method=method,
    )
    try:
        with opener.open(req, timeout=6) as response:
            status = response.status
            body = response.read(8192)
    except urllib.error.HTTPError as error:
        status = error.code
        body = error.read(8192)
    return status, json.loads(body or b"null")


def check(name, observed, expected, checks):
    ok = observed == expected
    checks.append({"name": name, "status": "PASS" if ok else "FAIL"})
    return ok


def run(environ=None, *, opener=None):
    env = os.environ if environ is None else environ
    if env.get("AIS_AUTH_PRIVATE_PROBE") != "1":
        raise ValueError("Explicit AIS_AUTH_PRIVATE_PROBE=1 opt-in is required")
    origin = validate_target(env.get("AUTH_SERVICE_URL", ""))
    token = env.get("AUTH_SERVICE_TOKEN", "")
    validate_token(token)
    expected_sha = env.get("AIS_EXPECTED_SOURCE_SHA", "")
    actual_sha = env.get("RAILWAY_GIT_COMMIT_SHA", "")
    if not SOURCE_PATTERN.fullmatch(expected_sha) or actual_sha != expected_sha:
        raise ValueError("Exact deployed Railway source SHA is not verified")
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    checks = []
    email = "boundary-probe-" + uuid.uuid4().hex[:16] + "@example.com"
    login = {"email": email, "password": "NonexistentProbePassword123!"}
    register = {**login, "name": "Synthetic boundary probe"}
    wrong = ("Z" if token[0] != "Z" else "Y") + token[1:]
    try:
        s, b = http_call(opener, origin, "/auth/health", "GET")
        check("private_readiness_200", (s, b.get("status")), (200, "healthy"), checks)
        for path in PATHS:
            body = register if path.endswith("register") else login
            for label, presented in (("missing", None), ("wrong", wrong)):
                s, b = http_call(opener, origin, path, payload=body, token=presented)
                check(path.rsplit("/", 1)[1] + "_" + label + "_401", (s, b.get("detail")), (401, "Service credential required."), checks)
        s, b = http_call(opener, origin, "/auth/login", payload=login, token=token)
        check("valid_token_reaches_login_logic", (s, b.get("detail")), (401, "Invalid email or password."), checks)
        s, b = http_call(opener, origin, "/auth/verify-password", payload=login, token=token)
        check("valid_token_reaches_verification_logic", (s, b.get("success")), (200, False), checks)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        checks.append({"name": "private_transport_or_protocol", "status": "FAIL"})
    passed = all(x["status"] == "PASS" for x in checks) and len(checks) == 9
    return {
        "format": "ais.private-auth-boundary-probe.v1",
        "source_sha": expected_sha,
        "status": "PASS" if passed else "FAIL",
        "passed": sum(x["status"] == "PASS" for x in checks),
        "expected": 9,
        "checks": checks,
        "scope": "read-only private staging HTTP parity/denial, not entropy or DEBUG attestation",
        "secrets_in_receipt": False,
    }


def main():
    try:
        receipt = run()
    except ValueError:
        receipt = {"format": "ais.private-auth-boundary-probe.v1", "status": "BLOCKED", "reason": "private target, token, opt-in or deployed source proof invalid", "secrets_in_receipt": False}
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
