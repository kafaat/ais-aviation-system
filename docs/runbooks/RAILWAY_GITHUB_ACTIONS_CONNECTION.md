# AIS Railway connection proof

This adoption follows SAHOOL issue #1259 and the four source files at
`ccf195395fc0369975366ad61722194709e01115`:
https://github.com/kafaat/ai_platform_complete_v2.0.0_enhanced/issues/1259

## Independently resolved target

Railway list-projects and list-services on 2026-10-23 confirmed:

| Field | Exact value |
| --- | --- |
| Project | ais-aviation-staging |
| Project ID | d0425f39-b1dc-4cf3-b7d9-0aab68d6ae9b |
| Environment ID | 6067b737-ceb8-465c-a798-5ecc8061ccef |
| Environment display name | production |
| Intended purpose | staging |

`docs/operations/railway-staging-completion.md` independently describes this
project as a staging copy whose environment is named production. This exception
is bound to the exact IDs; a production-named environment in another project is
never implicitly authorized. The receipt records both name and purpose.

## Operator procedure

1. Create a new Railway **project token scoped to this environment**. Store it
   directly in this repository's Actions secret
   `AIS_RAILWAY_STAGING_PROJECT_TOKEN`. Never paste its value into chat, a PR,
   workflow input, log or artifact. Do not use an account-wide token.
2. Wait for destination CI and required reviews on the final PR head, then merge
   under normal repository policy. No automatic merge is configured.
3. Manually dispatch **AIS Railway staging connection preflight** on main with
   `expected_sha` equal to the exact reviewed merged 40-character commit.
4. Download `ais-railway-staging-connection-(sha)`. Require
   `CONNECTION_ONLY_PASS`, the exact IDs above, and the verifier SHA256 matching
   that commit. All deployment, migration, DB, runtime and production proof flags
   must be false. Missing token, inaccessible/ambiguous status or SHA drift fails.

Only the status step receives the token. CLI 5.63.1 is pinned and version-checked
before token exposure. Raw stdout/stderr are private runner files, never printed
or uploaded, and cleaned even on failure. Only the allowlisted receipt is uploaded.
The offline parser uses standard-library unittest, matching Production Gates'
existing discovery under scripts/ci; it needs no token or new Python dependency.
Action SHAs match the destination's existing checkout, setup-node and artifact pins.

## Evidence and limits

Railway plugin project discovery succeeded on 2026-10-23. This is OAuth-scoped
discovery, **not** a GitHub Actions project-token connection proof. No token was
created, retrieved or transferred during preparation. The final main-SHA Actions
receipt remains pending until the separately scoped secret is provisioned.

This change does not deploy, migrate, access application data, prove service
health, restore OAuth or certify production. Any future write requires separate
operator approval and the existing backup, isolation, identity and acceptance
requirements, including the worker restrictions in the staging runbook.

See [the portable adoption recipe](RAILWAY_CONNECTION_PORTABLE_TEMPLATE.md)
for the next repository. It is an offline-tested pattern; do not label another
project connected until its own main-SHA receipt exists.
