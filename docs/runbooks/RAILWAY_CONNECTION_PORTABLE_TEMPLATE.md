# Portable read-only Railway adoption template

Reference implementation: AIS workflow, verifier and unittest module named
`railway_staging_connection_preflight`; source lineage and target facts are in
[the AIS runbook](RAILWAY_GITHUB_ACTIONS_CONNECTION.md).

Copy these four files into a destination branch:

- .github/workflows/railway-staging-connection-preflight.yml
- scripts/ci/railway_staging_connection_preflight.py
- scripts/ci/test_railway_staging_connection_preflight.py
- docs/runbooks/RAILWAY_GITHUB_ACTIONS_CONNECTION.md

Replace and review each binding explicitly:

| Binding | Required destination input |
| --- | --- |
| PROJECT_ID and workflow project ID | Independently observed project UUID |
| STAGING_ID and workflow environment ID | Independently observed environment UUID |
| EXPECTED_ENVIRONMENT_NAME | Exact observed name, never inferred from purpose |
| Receipt environment_purpose and scope | Authorized purpose of this exact target |
| Receipt name_purpose_mismatch | Explicit comparison of reviewed name and purpose |
| AIS secret and artifact prefix | A separate destination/environment token and unique prefix |
| refs/heads/main and expected_sha | Reviewed branch policy and exact merged commit |
| Action pins and Python discovery | Destination's existing pin and test conventions |
| CLI pin/version check | Same reviewed schema/version, updated together if changed |
| Tests' target name/purpose assertions | New bindings plus wrong-project/environment cases |

Keep token exposure limited to status, bounded private raw files, constant error
codes, receipt allowlisting, exact one-edge scope, explicit boolean access,
negative tests and all false runtime/deploy flags. Do not share project tokens.
Run:

```sh
python3 -m unittest discover -s scripts/ci -p 'test_railway_staging_connection_preflight.py' -v
```

These tests are offline parser proof. Then require destination CI, normal review
and merge, and a manual exact-main-SHA connection run with a fresh scoped secret.
Archive only its sanitized receipt and verifier checksum. A template or a plugin
read cannot substitute for that run. Future deployments remain a separate stage.

## AI Factory next-target checkpoint (2026-10-23)

Railway discovery found `factory-experiments`:
project `105650bb-010f-4787-9c09-b96359d637c2`, environment
`1a250db5-bc5b-4c62-b6bb-c24f948e4a6c`, named `production`.
Its services include certification and experiment runners. This is a candidate,
not an asserted AI Factory staging boundary. Before adoption, confirm repository
ownership and permitted environment purpose from that project's source and policy.
Do not copy AIS's name/purpose exception or auto-create any token/deployment.

## Resume without repeating work

The adoption PR identifies its source and tested head. On continuation, inspect
the PR head, CI, current main and target IDs before changing anything. Reuse
offline evidence only while its file hashes match; live receipts apply only to
their stated source SHA and target. Pending work: scoped secret provisioning,
normal merge, manual Actions dispatch, receipt verification, then Factory binding.
