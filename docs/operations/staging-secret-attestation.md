# Staging secret attestation (template)

Issue: [#103](https://github.com/kafaat/ais-aviation-system/issues/103).
Decision: [gap-closure decision package, section 4](../decisions/2026-11-10-gap-closure-decisions.md).

An authorised operator completes the checks below in the Railway dashboard
and files the completed copy as a comment on #103. The attestation names
facts about the secrets; it never contains a secret value, a hash or a digest
of one, a reference expression, or a screenshot that shows any of them.

## Scope

| Field                 | Value to record                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Project / environment | `ais-aviation-staging` / environment named `production` (a staging environment, not an airline's) |
| Running source SHA    | the `main` commit deployed on `ais-web` and `ais-auth` at the time of the checks                  |
| Operator              | name and role of the person performing the checks                                                 |
| Time (UTC)            | when the checks were performed                                                                    |

## Checks

| #   | Check                                                                                                                                                                      | Result (yes / no) and note without values |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | `AUTH_SERVICE_TOKEN` on `ais-web` and on `ais-auth` resolve to the same value (same literal, or one is a reference to the other)                                           |                                           |
| 2   | The value was produced by a cryptographically secure random generator with at least 32 bytes of entropy (for example `openssl rand -hex 32`), not a typed or reused phrase |                                           |
| 3   | `DEBUG` on `ais-auth` is absent or exactly `false`, so the fail-closed start-up rule is in force                                                                           |                                           |
| 4   | `AUTH_SERVICE_TOKEN`, `METRICS_TOKEN` and `MFA_ENCRYPTION_KEY` generated in the 2 November 2026 session have been replaced; the old values are no longer set anywhere      |                                           |
| 5   | Rotation was applied to `ais-auth` and `ais-web` in one coordinated change and both redeployed; no earlier deployment that accepted a missing credential was restored      |                                           |
| 6   | After redeploy, the `ais-acceptance` summary on the running source shows `login.passed: true` (the synthetic register, login, session and logout through the deployed web) |                                           |
| 7   | The `ais-auth` log for the same window shows no `ValidationError` naming `AUTH_SERVICE_TOKEN` and no 401 on `verify-password` from the web's private address               |                                           |

## Statement

"I performed the seven checks above on the environment and source named in
the scope table. Every check that reads `yes` was observed directly in the
Railway dashboard or logs. No secret value, hash, digest or reference
expression is recorded in this attestation or elsewhere in GitHub."

Signed (name, role, UTC time).
