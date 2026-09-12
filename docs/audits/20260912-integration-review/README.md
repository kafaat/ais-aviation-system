# Integration audit evidence — 2026-09-12

Reviewed commit: `3a140729b7ff68ab8bf917c8031b09a2af5383d2` (v1.23.0).

Read the [Arabic integration review](../20260912-integration-review.md) for
14 findings, pinned code citations, missing integrations, and an ordered closure
plan. These artifacts preserve the review of that commit. They are not a
production-readiness certificate or evidence that the identified defects have
been fixed.

## Evidence

| File                                             | Meaning                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| [reproductions.json](reproductions.json)         | 13 functional defects reproduced on disposable MySQL                            |
| [inventory-summary.json](inventory-summary.json) | Scope and limitations of the static TypeScript inventory                        |
| [service-map.csv](service-map.csv)               | Service lifecycle, direct consumers, dependencies, and table expressions        |
| [api-map.csv](api-map.csv)                       | Mounted domains, literal procedure guards, and frontend call sites              |
| [patch-ancestry.json](patch-ancestry.json)       | Mapping of all 12 original patch commits to merged commits with identical trees |
| [ci-coverage.json](ci-coverage.json)             | Eight tracked scripts outside the current CI TypeScript programs                |
| [gitleaks-audit.json](gitleaks-audit.json)       | Three allowlist regression scenarios observed with Gitleaks 8.24.3              |
| [validation.json](validation.json)               | Checks performed and verification limits                                        |

The inventory captures static import relationships and literal calls. It does
not prove runtime integration, provider acceptance, or complete dynamic-call
coverage. Data-writer expressions include retired services and need lifecycle
and domain review before being treated as active authorities.

## Reproduce the functional observations

Use the reviewed checkout with Node 24 and pnpm 10.34.5, plus a new empty
disposable MySQL 8 database whose name ends in `_test` and an isolated Redis
instance. Never use a shared or production database.

Set `NODE_ENV=test`, `AIS_DISPOSABLE_DATABASE=true`, `DATABASE_URL`, `REDIS_URL`,
and `QUEUE_REDIS_URL` for those disposable services. Set a synthetic local
`JWT_SECRET` and `STRIPE_SECRET_KEY=sk_test_mock_key`.

From the repository root:

```bash
pnpm db:migrate
pnpm db:verify
node --import tsx scripts/acceptance/integration-audit.ts /absolute/output/reproductions.json
pnpm exec tsc -p tsconfig.audit-scripts.json --noEmit
```

The runner stubs outbound HTTP and Stripe refund creation. It neither sends
provider messages nor executes real payments. It creates a temporary trigger
to inject a status-history write failure and drops that trigger in `finally`.

**`REPRODUCED` means the incorrect behavior was observed.** This runner is a
manual audit instrument, not part of the normal test suite. When fixing a
finding, replace the defective-behavior assertions with correct-behavior
regression coverage; do not add these assertions unchanged as a product-health
gate.

## Regenerate the static inventory

With dependencies installed in the reviewed checkout:

```bash
node scripts/ci/integration-audit-inventory.mjs /absolute/repository /absolute/output
```

This emits `inventory.json`, `service-map.csv`, and `api-map.csv`. The checked-in
summary and maps remain a historical snapshot of the reviewed commit.

## Reproduce the Gitleaks policy finding

Supply a verified Gitleaks 8.24.3 executable and the reviewed configuration:

```bash
python scripts/ci/probe-gitleaks-policy.py --gitleaks /absolute/gitleaks --config .gitleaks.toml
```

The reviewed configuration is expected to fail three detection scenarios. The
probe uses generated, nonfunctional controls and prints scenario names, never
matching values. All eight scenarios should pass after the allowlist is scoped
to the exact synthetic fixture values. The policy itself is unchanged in this
audit PR.
