# Authentication session recovery

## Refresh rotation and replay

A refresh family is the shared authority for its browser cookie and Bearer
access tokens. A successful rotation consumes the old refresh token and creates
one successor in the same database transaction. If successor persistence fails,
the claim rolls back and the original token remains usable.

Presenting an already rotated or expired token revokes every active record in
that family. The transaction commits this revocation before the request receives
`UNAUTHORIZED`. Other families, including another device belonging to the same
user, remain independent.

A concurrent losing refresh request is treated as replay too. At most one
successor is inserted, and the losing request commits revocation of that family,
including the winner's successor. This is a deliberate change from the earlier
concurrent-claim behavior described in the September 9 remediation audit. The
server cannot distinguish an accidental duplicate from a stolen refresh token.
Both the rotation and replay paths take the user lock before changing family
records, preventing a rotation from escaping a completed replay revocation.

Clients should serialize refresh requests for each session. After rejection,
discard that session's credentials and require sign-in again. A client that
loses the refresh response must not blindly retry the consumed token. An HTTP
success arriving just before a concurrent replay rejection does not guarantee
that the family is still active; every authenticated request consults the stored
family authority.

## MFA encryption migration

Completing a valid TOTP challenge can move a legacy encrypted secret to the
configured dedicated MFA key. The proof passed to session issuance must contain
the ciphertext actually persisted by that transaction. Session issuance still
requires the same user and current enabled enrollment. Changing the enrollment
between verification and issuance invalidates the proof. Challenges and TOTP
steps remain single-use.

Enabling or disabling MFA checks the expected enrollment, consumes the TOTP
step, performs any encryption migration, changes enrollment, and revokes prior
sessions/challenges in one locked transaction. A rejected or failed change does
not consume a valid step in a separate earlier transaction.

## Password-provider responses

The password-service client accepts success only from a successful HTTP response
with a boolean `success: true` and a complete, validated user identity. An error
HTTP response cannot authenticate even when its body claims success. Malformed
responses are normalized to failure before the router reaches session issuance.
Service-token requirements are still controlled by the provider deployment.

## Verification boundaries

- `auth-session-regression.test.ts` exercises the real router, crypto and session
  services with a commit/rollback persistence adapter. It reproduces rollback of
  replay revocation and the migrated-secret proof failure without claiming
  native SQL or locking acceptance.
- `auth-service-http.test.ts` uses an owned loopback HTTP password fixture and
  the real HTTP client/circuit breaker. Its downstream session boundary is a
  test double; malformed responses must never reach it.
- `auth-session-mysql.test.ts` requires explicit disposable test configuration,
  a loopback MySQL endpoint and an `ais_*test` source database. It creates an
  owned schema using the migrated table definitions and drops only that schema.
  It exercises real MySQL transactions and the HTTP router/session/MFA chain.
  Its password provider is a controlled HTTP fixture, not FastAPI or bcrypt
  acceptance. Native cases are skipped when the disposable-database opt-in is
  absent; a skip is not a pass.

The CI evidence for the exact reviewed commit determines native acceptance.
These tests do not establish production deployment or credential-provider
certification.
