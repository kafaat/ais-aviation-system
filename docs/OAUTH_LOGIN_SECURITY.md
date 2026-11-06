# Browser-bound OAuth login

OAuth clients start at `/api/oauth/start?returnTo=/local/application/path`.
The server creates an unpredictable state and an independent browser nonce,
stores their SHA-256 hashes in `oauth_login_states`, and sets an HTTP-only,
SameSite=Lax nonce cookie. The state expires after ten minutes and can be
consumed once. HTTPS deployments use a host-only `__Host-` cookie with the
Secure flag.

## Runtime configuration

Set these variables on the web server before enabling OAuth:

```dotenv
OAUTH_REDIRECT_URI=https://your-application.example/api/oauth/callback
OAUTH_PORTAL_URL=https://your-provider.example/portal
OAUTH_SERVER_URL=https://your-provider-api.example
VITE_APP_ID=your-registered-application-id
```

`OAUTH_REDIRECT_URI` is the exact callback registered with the provider. Its
path must be `/api/oauth/callback`; query parameters, fragments and embedded
credentials are rejected. Production requires HTTPS for both callback and
portal. There is no fallback to request Host or forwarding headers. An absent
or invalid configuration makes OAuth routes return 503.

`OAUTH_PORTAL_URL` preserves a configured portal path, and the start route
appends `/app-auth`. The existing `VITE_OAUTH_PORTAL_URL` remains a fallback
when `OAUTH_PORTAL_URL` is unset, but must be present in the server's runtime
environment. A client-build-only value is insufficient now that the server
initiates the flow.

Apply the migration creating `oauth_login_states` before enabling these
routes. Storage failures fail closed. Expired rows are no longer eligible;
they can be removed by ordinary retention maintenance after `expiresAt`.

## Provider exchange contract

The provider receives `appId`, `redirectUri`, opaque `state`, and `type=signIn`.
It must echo the opaque state unchanged in the callback. The SDK's
`ExchangeToken` request retains its existing `clientId`, `grantType`, `code`,
and `redirectUri` fields. The redirect URI comes from the validated, consumed
server record and is identical to the URI sent at initiation. State is no
longer a base64-encoded redirect URI.

The callback requires the initiating browser's nonce, checks the canonical
callback and expiry, and atomically consumes the record before contacting the
provider. A replay, another browser, or an unsolicited callback cannot mint a
session. Return destinations come only from the saved local path. MFA-enabled
accounts still receive an MFA challenge before a session is issued.

The repository's controlled HTTP provider fixtures verify this application
contract. They do not establish acceptance by the live OAuth provider; that
requires a configured provider environment.
