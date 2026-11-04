# Railway readiness recovery — 2026-11-04

## Observed failure

The `ais-aviation-staging` project uses a Railway environment named `production`.
Its web deployment of `88b32f16426f866fff7cd7fa5456abc50c8654da` served liveness
but returned the application’s readiness error:

| Request without authentication | Observed response                                 |
| ------------------------------ | ------------------------------------------------- |
| `GET /api/rest/health/live`    | 200, `{"alive":true}`                             |
| `GET /api/rest/health/ready`   | 503, `SERVICE_UNAVAILABLE / Service is not ready` |
| `GET /api/rest/health`         | 401, `UNAUTHORIZED`                               |

A redeployment of the same build, `303b5221-7343-4664-8af1-50f9c53efd38`,
made the process diagnostic observable. At `2026-11-04T13:25:33.500845299Z`
its actual `Readiness dependencies are not ready` log contained:

```json
{ "database": "pass", "stripe": "fail", "cache": "pass" }
```

These are results from the web process. The independently passing acceptance
runner is not substituted for web readiness: that runner records a web 503
without failing its database/Redis acceptance suite.

The web service did not have `AIS_PROVIDER_BOUNDARY` or `STRIPE_MOCK_HOST`
configured, so its payment client selected the default open transport. The
existing readiness code accepted only a long Stripe-shaped key and did not
understand the isolated mock transport already used by the worker. No key was
printed, copied, regenerated, or replaced to make it resemble a real credential.

The private `stripe-mock` service was already running version 0.206.0 and
listening on HTTP port 12111 and HTTPS port 12112. It has no public domain or
TCP proxy. Stripe’s [official mock documentation](https://github.com/stripe/stripe-mock)
uses short synthetic test tokens and explicitly describes the mock’s limitations.
A successful mock response is not acceptance by the real Stripe service.

## Recovery design

Readiness must use the same validated payment transport as payment operations.
Under the default open boundary, the existing key-configuration check remains
in place. Under explicit isolation, a test token and an allowed private mock
origin are required; a bounded read-only request verifies the configured mock.
An arbitrary configured URL, live credential, transport error, timeout, redirect,
or malformed reply must not become a passing readiness check.

The shared transport validation applies at client construction as well as in
readiness and the provider-boundary report. The web entrypoint verifies its
provider boundary before starting telemetry, Sentry or its HTTP listener, as the
worker already does. The administrative health contract distinguishes mock
verification from configuration-only verification. Public readiness remains a
minimal success response or a generic 503; detailed health remains admin-only.

Database and cache requirements are retained. Neither a plausible replacement
key nor removal of a failing dependency is a recovery mechanism.

## Deployment and verification

Apply the application change before selecting the isolated transport on web.
Configure only the intended payment routing:

```text
AIS_PROVIDER_BOUNDARY=isolated
STRIPE_MOCK_HOST=http://${{stripe-mock.RAILWAY_PRIVATE_DOMAIN}}:12111
```

Use a synthetic token accepted by the configured mock. Retaining the legacy
token in the first isolated rollout produced a real mock HTTP 401 and correctly
left readiness at 503. The operational correction used the short token in
Stripe's documented mock example, which still fails the open-mode key-format
check. The mock service must remain private. This configures readiness for the
staging environment's declared mock dependency; it does not enable real card
processing or demonstrate provider acceptance.

For the exact deployed source SHA, record:

1. Terminal Railway deployment success and the safe provider-boundary report.
2. Public liveness 200 with `alive:true` and readiness 200 with `ready:true`.
3. The detailed endpoint still returning 401 without authentication.
4. A second bounded readiness observation after the deployment settles.
5. Current-head unit/contract checks and regression coverage proving refusal of
   invalid origins, live keys, failed/slow/malformed mock responses, and failed
   database/cache checks.

Record the observed deployment IDs, response bodies, timestamps and CI links in
the implementing pull request. Do not describe a green deploy job, a passing
synthetic suite, or a key-format match as live provider acceptance.

A temporary credential-free pre-deploy diagnostic configuration was removed
once the web process diagnostic identified the failing dependency. The normal
start command is retained and no diagnostic endpoint is exposed publicly.

## Verified rollout

[PR #267](https://github.com/kafaat/ais-aviation-system/pull/267) merged as
`538a577923175a84eecc3a7bf0994e508b083ec0`. After the actual mock authentication
failure was corrected, web deployment
`5d403d69-403a-438b-afe0-7f18847eb7d2` and worker deployment
`48f1aef7-a6c9-4b5b-8cb2-6f03390f041d` both reached `SUCCESS` on that exact
source. Both startup reports recorded `boundary=isolated` and an allowed Stripe
mock. The worker kept its existing reference to the web service's synthetic
token; the webhook secret was not changed.

Two bounded public observations on 4 November 2026 confirmed recovery:

| Observation (UTC) | Liveness              | Readiness             | Detailed health without login |
| ----------------- | --------------------- | --------------------- | ----------------------------- |
| 14:09:43          | 200, `{"alive":true}` | 200, `{"ready":true}` | 401, `UNAUTHORIZED`           |
| 14:11:25          | 200, `{"alive":true}` | 200, `{"ready":true}` | 401, `UNAUTHORIZED`           |

The private mock log independently recorded `GET /v1/balance` with HTTP 200.
Its public domain and TCP proxy lists remained empty. The final Railway
inspection at 14:14:28 UTC found no services with issues and no pending work;
the temporary pre-deploy diagnostic command remained cleared.

The [post-merge CI run](https://github.com/kafaat/ais-aviation-system/actions/runs/41843383106)
and all twelve required checks completed successfully on the same main SHA.
The PR receipt preserves test counts, the separate browser retry observation,
deployment IDs, and the distinction between actual Railway verification and
conditionally skipped Kubernetes rollout steps.
