# Security dependency remediation — 21 October 2026

Scope: independent remediation of the native `pnpm audit --audit-level=high` and Trivy runner/migrator container-image findings observed on AIS main at `0d4a0df93f5c9090e4fd3d742eec571ad1719510`.

| Package | Installed | Pinned/minimum fix | Severity | Advisory |
| --- | --- | --- | --- | --- |
| proxy-addr | 2.0.7 | 2.0.8 (root pnpm override) | Critical | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| follow-redirects | 1.16.0 | 1.16.1 (root pnpm override) | High ×2 | [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8), [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c) |
| source-map-js | 1.2.1 | 1.2.2 (root pnpm override) | High | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| vite | 7.3.6 | 7.3.7 (devDependency) | High | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) |

The accompanying `pnpm-lock.yaml` uses npm package integrity hashes cross-checked in multiple public pnpm lockfiles; **registry retrieval and frozen-lockfile installation in GitHub Actions are authoritative tests**, not those third-party copies.

The runner-image Trivy report had 3 High/Critical findings (2 follow-redirects + 1 proxy-addr); the migrator report had 5 (the runner findings plus Vite and source-map-js). No High/Critical findings were listed for Alpine OS packages in the captured reports.

## Verification gates (not waived)

- `pnpm install --frozen-lockfile` and its reproducibility/format checks.
- `pnpm audit --audit-level=high` (0 High or Critical).
- Trivy `CRITICAL,HIGH` scans of both built images, with their JSON receipts and no suppression/ignore-unfixed change.
- Application lint, typechecks, unit tests, native MySQL acceptance, browser E2E, build and migration replay.
- Security scan SARIF: a missing SARIF file must not be treated as a passed scan. The earlier missing `trivy-results.sarif` was secondary after npm audit failed before the scan step could run.

This is a dependency-security PR separate from finance PR #184; it does not touch accounting code or deploy anything. Do not merge until green results on its final commit and PR protection/review requirements are met.