#!/usr/bin/env python3
"""Probe a running auth service for its credential boundary over real HTTP.

Requires AUTH_SERVICE_URL and AUTH_SERVICE_TOKEN in the environment and a
reachable auth service started with the same token. Verifies, on every auth
route, that an anonymous caller and a wrong credential are refused (401) with
the fixed message and no account data, that readiness stays public, and that
the correct credential is served. Exit status is non-zero on any deviation.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("AUTH_SERVICE_URL", "http://localhost:8000").rstrip("/")
TOKEN = os.environ.get("AUTH_SERVICE_TOKEN", "")
ROUTES = ("/auth/register", "/auth/login", "/auth/verify-password")
DENIED = {"detail": "Service credential required."}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(method: str, path: str, body: dict | None = None, token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["X-Auth-Service-Token"] = token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=10) as response:
            return response.status, json.loads(response.read(65536) or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read(65536) or b"null")


def main() -> int:
    if not TOKEN:
        print("AUTH_SERVICE_TOKEN must be set for the probe", file=sys.stderr)
        return 2
    failures: list[str] = []
    # example.com is accepted by the service's e-mail validator; .test is not.
    email = f"credential-probe-{uuid.uuid4().hex[:12]}@example.com"
    password = "CredentialProbeFixture123!"
    payload = {"email": email, "password": password, "name": "Credential probe"}

    status, body = request("GET", "/auth/health")
    if status != 200 or body.get("status") != "healthy":
        failures.append(f"readiness is not public and healthy: {status} {body}")

    for path in ROUTES:
        for label, token in (("anonymous", None), ("wrong", TOKEN[:-1] + ("x" if TOKEN[-1] != "x" else "y"))):
            status, body = request("POST", path, payload, token)
            if status != 401 or body != DENIED:
                failures.append(f"{label} caller on {path}: expected 401 {DENIED}, got {status} {body}")
            if email in json.dumps(body):
                failures.append(f"{label} caller on {path} leaked the probed e-mail")

    status, body = request("POST", "/auth/register", payload, TOKEN)
    if status != 200 or not body.get("success"):
        failures.append(f"correct credential could not register: {status} {body}")
    status, body = request("POST", "/auth/login", {"email": email, "password": password}, TOKEN)
    if status != 200 or not body.get("success"):
        failures.append(f"correct credential could not log in: {status} {body}")
    status, body = request("POST", "/auth/verify-password", {"email": email, "password": "Wrong" + password}, TOKEN)
    if status != 200 or body.get("success") is not False:
        failures.append(f"wrong password with correct credential must be success=false: {status} {body}")

    receipt = {
        "passed": not failures,
        "routes": ROUTES,
        "anonymousAndWrongCredential": 401,
        "readinessPublic": True,
        "correctCredentialServed": not failures,
        "failures": failures,
    }
    print(json.dumps(receipt))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
