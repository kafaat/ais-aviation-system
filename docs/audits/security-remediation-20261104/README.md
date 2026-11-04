# Security dependency remediation — 4 November 2026

## Scope and observed baseline

This review started from main commit `e80d8790fba2a30e3164322e0fe40ed5a62bb553`
(tree `a527a9d0ecd23362b6f4ed66369bb4f4902bbefe`). The authenticated repository UI
showed two open Dependabot alerts, two open Trivy code-scanning alerts, zero open
secret-scanning alerts, and private vulnerability reporting disabled. Enabled
feature badges were not treated as evidence that no vulnerabilities existed.

| Surface                      | Observed finding                                                | Disposition in this change                                                                                                      |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dependabot #239              | `deepmerge@4.3.1`, GHSA-gcqx-w48m-w2h4, low; no patched release | Remove the unused PWA generator that introduces the only dependency path.                                                       |
| Dependabot #242              | `minimatch@10.2.6`, GHSA-g3hv-75wg-m249, moderate               | Upgrade the remaining TypeScript ESTree dependency through a scoped override.                                                   |
| Fresh npm audit              | `glob@11.1.0`, GHSA-3g3m-2fjr-6pw4, moderate                    | Removed with the same unused PWA generator. This was an additional inventory finding.                                           |
| Trivy #141 and #142          | CVE-2026-118764 on `minimatch@3.1.5` and `5.1.9`                | Independently verified as outside the corrected advisory range; rerun the scan before any exact-alert false-positive dismissal. |
| Python dependency resolution | Seven distinct advisories on `starlette@0.41.3`                 | Upgrade FastAPI compatibly and explicitly pin patched Starlette.                                                                |

The initial UI observations are in [initial-observation.json](initial-observation.json).
The [reporting screenshot](private-reporting-enabled.png) records successful
enablement **before** the dependency fix and still shows the original alert counts.
The pull request and its workflow runs record remote acceptance; this document
does not claim that a local audit has already closed GitHub alerts.

## JavaScript dependency changes

`vite.config.ts` and the existing PWA contract deliberately use
`client/public/sw.js` as the single service-worker authority. `vite-plugin-pwa`
was not imported or called. Removing that unused development dependency prunes
Workbox, its vulnerable `glob`, and the only `deepmerge` path without altering
the application service worker.

After that removal, the only `minimatch@10.2.6` consumer is
`@typescript-eslint/typescript-estree@8.69.0`. Its actual use is
`minimatch(filePath, pattern, { dot: true })`. The override
`@typescript-eslint/typescript-estree>minimatch: 11.0.4` retains that named CommonJS
API and the supported Node 22/24 runtimes. It does not replace the callable
CommonJS exports expected by the unrelated minimatch 3 and 5 consumers.

The regenerated lockfile contains 1,257 package entries, down from 1,452. It removes
197 entries and adds two: `minimatch@11.0.4` and
`@isaacs/nonrecursive-glob-match@1.0.3`. Retained package metadata is unchanged.
The visualizer's peer resolves to the existing supported Rollup 4 after the unused
Rollup 2 branch is pruned. The independent reviewer verified the actual scoped
resolution, `brace-expansion@5.0.12`, and 20 bounded API compatibility cases.

See [minimatch-review.md](minimatch-review.md) for the precise affected-version
analysis, upstream source identity, and independent workflow review.

## Authentication service dependencies

The previous `fastapi==0.115.6` requirement resolves `starlette==0.41.3`.
The seven advisory records include three high, three medium, and one low severity
findings. These are dependency inventory findings: the current service uses
JSON function routes and does not expose the file-serving, form-parsing,
`HTTPEndpoint`, or URL-based authorization mechanisms implicated in those reports.
The Windows-specific condition also does not describe the Linux container.

FastAPI 0.133 is the first release line with official support for Starlette 1.x.
The change selects its patch release `0.133.1` and explicitly pins `starlette==1.3.1`,
the first version covering every advisory in this observed inventory. Other direct
auth requirements remain unchanged. The before and after evidence is in
[python-audit-before.json](python-audit-before.json) and
[python-audit-after.json](python-audit-after.json).

Eight new HTTP contract tests exercise the real FastAPI/Starlette stack with
in-memory SQLite and synthetic credentials. They verify service authentication,
ordinary-user registration, login and password-verification responses, generic
credential errors, JSON validation and bcrypt's byte limit, duplicate accounts,
safe readiness failure, and the configured CORS boundary. No live database or
external provider is contacted by these tests.

## Continuous checks and private disclosure

- Dependency Review runs directly. The deprecated `exportSbom` probe previously
  caught all API failures and could report a successful skipped review. The
  existing severity, license policy, action pins, and same-repository scope are
  preserved.
- Trivy keeps its complete SARIF report and uses a separate filesystem scan that
  blocks HIGH/CRITICAL findings. This separation matters because the pinned action
  removes severity filtering for SARIF by default. The SARIF upload still runs
  after failures; no ignore rule or severity suppression was added.
- The auth image is built and scanned alongside the existing application and
  migrator images. Pull-request image validation builds locally without pushing,
  and its evidence artifact now includes the auth build and scan results.
- CI discovers all auth `test_*.py` files and retains the separate public
  registration assertion.
- Dependabot version updates are scheduled weekly for npm, both Python manifests,
  and GitHub Actions, with one open routine update PR per configuration. Compatible
  minor/patch updates are grouped; major updates are not automatically merged or
  suppressed. Security updates remain independently enabled in GitHub settings.
- Private vulnerability reporting was enabled and verified in the authenticated
  GitHub UI. `docs/SECURITY.md` points to the repository's private reporting route
  and replaces unverified example emergency email contacts with deployment-owned
  escalation instructions.

## Local verification

| Check                                                        | Result                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| pnpm 10.34.5 frozen install                                  | Passed using the regenerated lockfile                             |
| Full `pnpm audit --json`                                     | Zero known vulnerabilities at every severity; no muted advisories |
| `pnpm lint:ci`                                               | Passed with zero warnings                                         |
| `pnpm check --incremental false`                             | Passed                                                            |
| Production build and five asset budgets                      | Passed                                                            |
| Existing PWA and service-worker privacy tests                | Three tests in two files passed                                   |
| Python 3.12 isolated installation and `pip check`            | Passed                                                            |
| Auth unittest discovery                                      | Eleven passed: three existing and eight new HTTP tests            |
| Existing public registration assertion                       | Passed                                                            |
| `pip-audit 2.10.1 --strict -r auth-service/requirements.txt` | 33 packages; zero known vulnerabilities; no skipped findings      |
| Workflow YAML, shell syntax, and whitespace checks           | Passed                                                            |

The old main push CI run `41875776559` was separately rechecked and is now terminal
`success`; that result belongs to the baseline commit, not to this new change.

## Boundaries and follow-up verification

The PR's required checks, native database gates, browser E2E, and actual container
scans must complete for the submitted commit before merge. GitHub alert states
must be checked after the default-branch dependency graph and scans refresh.
Any dismissal of #141/#142 must remain limited to CVE-2026-118764 and the exact
legacy versions established in the independent review.

CodeQL default setup was not configured in the observed repository settings; the
two observed code-scanning findings came from Trivy. This change does not claim
a completed CodeQL analysis, penetration test, or real-provider acceptance.

A package audit is a point-in-time comparison with known advisories. Container
results and deployed-version evidence remain separate. Starlette's test client
warns that the existing `httpx@0.28.1` compatibility path is deprecated; the tested
path works, and that unrelated client migration is not included here.

## Primary references

- [Reviewed minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [Reviewed deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
- [Reviewed glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [FastAPI 0.133.0 release](https://github.com/fastapi/fastapi/releases/tag/0.133.0)
- [FastAPI 0.133.1 metadata](https://pypi.org/pypi/fastapi/0.133.1/json)
- [Starlette 1.3.1 metadata](https://pypi.org/pypi/starlette/1.3.1/json)
- [Pinned Trivy action](https://github.com/aquasecurity/trivy-action/blob/d2a0b60797ff03db6132bd4e2b293f9b37081297/entrypoint.sh)
- [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
- [Dependabot version updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates)
