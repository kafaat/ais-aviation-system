# Staging auth-service credential handshake — private operator acceptance

Issue: [#103](https://github.com/kafaat/ais-aviation-system/issues/103). This is **not** a production/provider certification and does **not** change deployed credentials.

## Purpose and limits

`#306` added fail-closed service-to-service authorization. GitHub CI proves behavior with synthetic credentials; the existing Railway staging receipt (171 passed) does **not** prove that the current `ais-web` secret is accepted by the current `ais-auth` service.

`scripts/acceptance/private-auth-boundary-probe.mjs` is a deliberately **opt-in** script shipped in the `ais-web` Node image. It has no automatic startup hook. It refuses public hosts, userinfo in URLs, path/query overrides, missing/unusable credentials, and a source SHA mismatch. It never prints the token, URL, request body, customer identity, or raw response body.

The probe contacts the private auth service using **the running `ais-web` environment's own** `AUTH_SERVICE_URL` and `AUTH_SERVICE_TOKEN`. It makes no successful registration and uses only a synthetic, randomly named nonexistent account:
- `GET /auth/health` returns 200;
- all three password routes refuse **missing and wrong** service credentials (six negative checks, 401);
- the legitimate shared token reaches password-verification logic (one generic invalid-email login 401 and one verification response `success=false` with HTTP 200).

Total: nine checks. A source-bound JSON receipt includes only statuses and the deployed Git SHA. No account is created or modified. A failed transport, improper negative behavior or absent source identity prevents PASS.

## Operator-only procedure

1. First verify privately, **without putting values or hashes in GitHub/chat**, that `ais-web` and `ais-auth` have the same *random* at-least-32-character printable-ASCII `AUTH_SERVICE_TOKEN`, and that `ais-auth` has `DEBUG=false` and `ais-web` has `NODE_ENV=production`. The connector currently exposes names only. Reject any known compromised/test token, rotate both services in a coordinated maintenance window if needed.
2. Independently read the exact deployed `main` commit SHA from GitHub/Railway. Obtain a trusted, authorized shell **inside the running `ais-web` service** on project `ais-aviation-staging` (environment label `production`). Do not run from a public browser or generic local shell, as the private host is not reachable and the web service secret would not be the same.
3. Set only the *non-secret* acceptance inputs for that shell; the service's own runtime environment must provide `AUTH_SERVICE_URL`, `AUTH_SERVICE_TOKEN`, and `RAILWAY_GIT_COMMIT_SHA`:

   ```bash
   AIS_AUTH_PRIVATE_PROBE=1 AIS_EXPECTED_SOURCE_SHA=<verified-40-character-deployment-commit> \
     node /app/scripts/acceptance/private-auth-boundary-probe.mjs
   ```

   If `RAILWAY_GIT_COMMIT_SHA` is absent, the probe returns BLOCKED. Fix source provenance instead of setting it to a guessed value. A PASS is only a private handshake observation for the exact revision at runtime.
4. Save the redacted JSON receipt and attach only it (not CLI command history or environment dump) to #103. Record operator, UTC time, source SHA and the `DEBUG`/secret parity *attestation without values*. Keep stage/production acceptance separate. A real **user** login through the UI is still a different test and must use a separately approved synthetic user in staging.

## Rollback

If authentication fails, leave protected endpoints unavailable, correct the two service configurations or roll forward to a proven safe revision. Do not revert `ais-auth` to its old fail-open implementation; a single-service rollback is not automatically safe. This script cannot determine token entropy, secret provenance, account health beyond synthetic invalid credentials, or third-party/provider readiness.

## Developer tests

```bash
node --test scripts/ci/private-auth-boundary-probe.test.mjs
```

The test starts only an owned loopback HTTP fixture, and verifies fail-closed URL/token/SHA checks, positive and negative HTTP behavior, and receipt redaction. It does not touch Railway.
