# GitHub Actions Node 24 migration — 2026-11-04

## Scope and provenance

This audit records the initial compatible-pin migration and the subsequent Codecov/Slack compatibility work. The follow-up below starts from merged main `e80d8790fba2a30e3164322e0fe40ed5a62bb553` and resolves the two families deferred by the initial migration.

This change starts from `dbf179516c5f91d423e6f6c2893cb95f862f6f08` (main after #268). It changes action execution runtimes while preserving the application runtime selections, workflow permissions, triggers, conditions, timeouts, job dependencies, command bodies, and coverage gates. Open-PR inspection found only #269 and the unrelated release #262; no competing Actions migration was open.

The inventory covers all 118 action invocations in 11 workflow files, representing 24 distinct pinned references. Exact pinned action manifests identify 18 Node 20 families. This patch migrates 90 invocations across 16 families to verified Node 24 manifests. The 12 existing Node 24 checkout pins are retained and their version comments corrected.

Tags were resolved through the owning repository’s Git reference API. The annotated pnpm tag was peeled to its commit. Each replacement below was then checked by reading `action.yml` at that full commit SHA and requiring `runs.using: node24`. No floating action references are introduced.

GitHub’s [Node 20 deprecation notice](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) directs workflow owners to versions using Node 24. Action runtime selection is independent of `actions/setup-node`’s requested application Node version.

## Verified replacements

| Action                             | Release   | Full commit SHA                            | Primary evidence                                                                                                                                                                                                               |
| ---------------------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actions/cache`                    | `v5.1.0`  | `caa296126883cff596d87d8935842f9db880ef25` | [Tag](https://api.github.com/repos/actions/cache/git/refs/tags/v5.1.0) · [Manifest](https://raw.githubusercontent.com/actions/cache/caa296126883cff596d87d8935842f9db880ef25/action.yml)                                       |
| `actions/checkout`                 | `v5.1.0`  | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | [Tag](https://api.github.com/repos/actions/checkout/git/refs/tags/v5.1.0) · [Manifest](https://raw.githubusercontent.com/actions/checkout/fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/action.yml)                                 |
| `actions/dependency-review-action` | `v5.0.0`  | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | [Tag](https://api.github.com/repos/actions/dependency-review-action/git/refs/tags/v5.0.0) · [Manifest](https://raw.githubusercontent.com/actions/dependency-review-action/a1d282b36b6f3519aa1f3fc636f609c47dddb294/action.yml) |
| `actions/download-artifact`        | `v7.0.0`  | `37930b1c2abaa49bbe596cd826c3c89aef350131` | [Tag](https://api.github.com/repos/actions/download-artifact/git/refs/tags/v7.0.0) · [Manifest](https://raw.githubusercontent.com/actions/download-artifact/37930b1c2abaa49bbe596cd826c3c89aef350131/action.yml)               |
| `actions/github-script`            | `v8.0.0`  | `ed597411d8f924073f98dfc5c65a23a2325f34cd` | [Tag](https://api.github.com/repos/actions/github-script/git/refs/tags/v8.0.0) · [Manifest](https://raw.githubusercontent.com/actions/github-script/ed597411d8f924073f98dfc5c65a23a2325f34cd/action.yml)                       |
| `actions/setup-node`               | `v5.0.0`  | `a0853c24544627f65ddf259abe73b1d18a591444` | [Tag](https://api.github.com/repos/actions/setup-node/git/refs/tags/v5.0.0) · [Manifest](https://raw.githubusercontent.com/actions/setup-node/a0853c24544627f65ddf259abe73b1d18a591444/action.yml)                             |
| `actions/setup-python`             | `v6.3.0`  | `ece7cb06caefa5fff74198d8649806c4678c61a1` | [Tag](https://api.github.com/repos/actions/setup-python/git/refs/tags/v6.3.0) · [Manifest](https://raw.githubusercontent.com/actions/setup-python/ece7cb06caefa5fff74198d8649806c4678c61a1/action.yml)                         |
| `actions/upload-artifact`          | `v6.0.0`  | `b7c566a772e6b6bfb58ed0dc250532a479d7789f` | [Tag](https://api.github.com/repos/actions/upload-artifact/git/refs/tags/v6.0.0) · [Manifest](https://raw.githubusercontent.com/actions/upload-artifact/b7c566a772e6b6bfb58ed0dc250532a479d7789f/action.yml)                   |
| `azure/setup-kubectl`              | `v5.2.0`  | `bda439f5f36b99b262ebdcd3613869bddb064c8e` | [Tag](https://api.github.com/repos/Azure/setup-kubectl/git/refs/tags/v5.2.0) · [Manifest](https://raw.githubusercontent.com/azure/setup-kubectl/bda439f5f36b99b262ebdcd3613869bddb064c8e/action.yml)                           |
| `docker/build-push-action`         | `v7.4.0`  | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` | [Tag](https://api.github.com/repos/docker/build-push-action/git/refs/tags/v7.4.0) · [Manifest](https://raw.githubusercontent.com/docker/build-push-action/c3c9e263c25d99ce0380d002d59b67737d91b0dc/action.yml)                 |
| `docker/login-action`              | `v4.7.0`  | `81c6f93d4bc991e510b342a00b419b3bb4efc5c6` | [Tag](https://api.github.com/repos/docker/login-action/git/refs/tags/v4.7.0) · [Manifest](https://raw.githubusercontent.com/docker/login-action/81c6f93d4bc991e510b342a00b419b3bb4efc5c6/action.yml)                           |
| `docker/metadata-action`           | `v6.2.0`  | `dc802804100637a589fabce1cb79ff13a1411302` | [Tag](https://api.github.com/repos/docker/metadata-action/git/refs/tags/v6.2.0) · [Manifest](https://raw.githubusercontent.com/docker/metadata-action/dc802804100637a589fabce1cb79ff13a1411302/action.yml)                     |
| `docker/setup-buildx-action`       | `v4.4.1`  | `f87e5991a6d7451dcb8d9637bfbc97413f497069` | [Tag](https://api.github.com/repos/docker/setup-buildx-action/git/refs/tags/v4.4.1) · [Manifest](https://raw.githubusercontent.com/docker/setup-buildx-action/f87e5991a6d7451dcb8d9637bfbc97413f497069/action.yml)             |
| `peter-evans/repository-dispatch`  | `v4.0.1`  | `28959ce8df70de7be546dd1250a005dd32156697` | [Tag](https://api.github.com/repos/peter-evans/repository-dispatch/git/refs/tags/v4.0.1) · [Manifest](https://raw.githubusercontent.com/peter-evans/repository-dispatch/28959ce8df70de7be546dd1250a005dd32156697/action.yml)   |
| `pnpm/action-setup`                | `v4.4.0`  | `fc06bc1257f339d1d5d8b3a19a8cae5388b55320` | [Tag](https://api.github.com/repos/pnpm/action-setup/git/refs/tags/v4.4.0) · [Manifest](https://raw.githubusercontent.com/pnpm/action-setup/fc06bc1257f339d1d5d8b3a19a8cae5388b55320/action.yml)                               |
| `webfactory/ssh-agent`             | `v0.10.0` | `e83874834305fe9a4a2997156cb26c5de65a8555` | [Tag](https://api.github.com/repos/webfactory/ssh-agent/git/refs/tags/v0.10.0) · [Manifest](https://raw.githubusercontent.com/webfactory/ssh-agent/e83874834305fe9a4a2997156cb26c5de65a8555/action.yml)                        |

## Compatibility decisions

- **Runner:** Node 24 actions require Actions Runner **2.327.1 or later**, documented by [dependency-review v5](https://github.com/actions/dependency-review-action/releases/tag/v5.0.0), [github-script v8](https://github.com/actions/github-script/blob/ed597411d8f924073f98dfc5c65a23a2325f34cd/README.md#v8), and [upload-artifact v6](https://github.com/actions/upload-artifact/releases/tag/v6.0.0). These workflows use GitHub-hosted Ubuntu and Windows 2022 runners; runner labels remain unchanged.

- **checkout:** v5.1.0 is the Node 24 pin already used by main’s #268 workflows. It retains the existing checkout input defaults and credential-storage behavior. Its [safer pull-request-target handling](https://github.com/actions/checkout/releases/tag/v5.1.0) is not bypassed; this repository has no `pull_request_target` workflow.

- **setup-node:** [v5 introduces automatic package-manager caching](https://github.com/actions/setup-node/releases/tag/v5.0.0). Every setup-node step explicitly sets `package-manager-cache: false` so the existing pnpm setup order and explicit cache keys, paths, and restore rules remain in control. All 18 existing `node-version` values are unchanged, including application Node 22. The repository’s `pnpm@10.34.5` selection is unchanged.

- **Artifacts:** [upload-artifact v6](https://github.com/actions/upload-artifact/releases/tag/v6.0.0) and [download-artifact v7](https://github.com/actions/download-artifact/releases/tag/v7.0.0) explicitly change the default action runtime to Node 24. Their preceding versions advertised Node 24 support while their pinned manifests still selected Node 20, which is why manifest verification was required. Both deployment downloads retain `name: build-output` and `path: dist`; upload names, paths, retention, and missing-file policy remain unchanged. The existing consumers use named artifact extraction, so the earlier single-artifact-ID path adjustment does not affect them. [Download v8](https://github.com/actions/download-artifact/releases/tag/v8.0.0) adds a default hard error for digest mismatches; this patch selects v7 to preserve the existing failure policy.

- **Docker actions:** The [build-push v7](https://github.com/docker/build-push-action/releases/tag/v7.0.0), [login v4](https://github.com/docker/login-action/releases/tag/v4.0.0), [metadata v6](https://github.com/docker/metadata-action/releases/tag/v6.0.0), and [setup-buildx v4](https://github.com/docker/setup-buildx-action/releases/tag/v4.0.0) migrations use Node 24 and internal ESM bundles. All currently supplied inputs exist in the new manifests, and defaults of existing inputs are unchanged. Removed legacy build-summary environment variables and deprecated Buildx inputs/outputs are not used here. The metadata action’s new treatment of `#` inside list values does not affect the existing tag configuration. Docker contexts, image names, tags, cache configuration, push conditions, and credentials expressions are unchanged.

- **kubectl and SSH:** [setup-kubectl v5](https://github.com/Azure/setup-kubectl/releases/tag/v5.0.0) moves to Node 24 and the official `dl.k8s.io` download host; its new partial-version resolution does not change either explicit `v1.29.0` selection. [ssh-agent v0.10.0](https://github.com/webfactory/ssh-agent/releases/tag/v0.10.0) changes the Node runtime only. Existing inputs and secret expressions are unchanged.

- **pnpm and repository-dispatch:** pnpm stays on the v4 release line; v4.4.0 declares Node 24 and retains existing input defaults. Repository-dispatch v4.0.1 declares Node 24 and retains the token, event type, and client-payload inputs used here. No dispatch or notification is sent by this migration work.

## Dependencies deferred by the initial migration

| Action                         | Current pin                                | Invocations | Reason retained                                                                                      |
| ------------------------------ | ------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| `codecov/codecov-action`       | `b9fd7d16f6d7d1b5d2bec1a2887e65ceed900238` | 1           | Separate Codecov CLI/action-major migration; preserve the existing #268 coverage upload integration. |
| `slackapi/slack-github-action` | `70cd7be8e40a46e8b0eced40b0de447bdb42f68e` | 5           | Separate notification input/API migration; preserve current Slack webhook behavior.                  |

These two third-party families were outside the initial compatible-pin patch. They are migrated in the follow-up below. Semantic-PR, SBOM, and CodeQL pins already declare Node 24 and remain unchanged. PR-size-labeler uses Docker; Trivy uses a composite action and is unchanged.

## Initial migration validation and limits

- All 11 workflows parse with duplicate-key rejection and GitHub-compatible boolean handling.
- Full YAML structure comparison against the exact main base permits only the verified `uses` replacements and `package-manager-cache: false` additions. This protects #268 coverage gates and all existing workflow behavior settings.
- All supplied inputs for migrated actions exist in the new pinned manifests; existing input defaults were compared.
- Prettier checks and `git diff --check` pass.
- `actionlint` was not installed on PATH or found in the checked tool caches; no actionlint success is claimed.
- No Actions run, deployment, Slack send, repository dispatch, branch push, or PR write was performed. Deployment-only steps have static contract/release-note verification; they were not executed locally.

## Follow-up: Codecov and Slack compatibility

All six deferred invocations now use the following full commit pins. These were the latest stable releases returned by the owning repositories on 4 November 2026. The Codecov annotated tag was peeled to its commit before inspecting the manifest.

| Action                         | Release  | Full commit SHA                            | Runtime evidence                                                                                                                                                                                                                                         |
| ------------------------------ | -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codecov/codecov-action`       | `v7.1.1` | `303a32d7a59b442fa8d48b6a1cc6825c09c847a5` | [Tag object](https://api.github.com/repos/codecov/codecov-action/git/tags/2320916714171c258d01dbd81040d64d798c6f8e) · [Composite manifest](https://raw.githubusercontent.com/codecov/codecov-action/303a32d7a59b442fa8d48b6a1cc6825c09c847a5/action.yml) |
| `slackapi/slack-github-action` | `v4.0.0` | `dcb1066f776dd043e64d0e8ba94ca15cc7e1875d` | [Tag](https://api.github.com/repos/slackapi/slack-github-action/git/ref/tags/v4.0.0) · [Node 24 manifest](https://raw.githubusercontent.com/slackapi/slack-github-action/dcb1066f776dd043e64d0e8ba94ca15cc7e1875d/action.yml)                            |

### Codecov

The new Codecov action is **composite**, not itself a Node action. Its only nested JavaScript action is the fully pinned `actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd`, whose [manifest selects Node 24](https://raw.githubusercontent.com/actions/github-script/ed597411d8f924073f98dfc5c65a23a2325f34cd/action.yml). The wrapper runs through Bash on the existing Ubuntu runner.

The existing upload token, exact `lcov.info` evidence path, pull-request exclusion and `fail_ci_if_error: false` are unchanged. The action still uses the default coverage upload command and token authentication; no OIDC permission is added. The [v5 migration guide](https://github.com/codecov/codecov-action/blob/303a32d7a59b442fa8d48b6a1cc6825c09c847a5/README.md#v5-release) changes singular `file`/`plugin` inputs, neither of which this workflow used. The [v7 release](https://github.com/codecov/codecov-action/releases/tag/v7.0.0) moves the uploader verification-key lookup to `codecovsecops`; signature validation remains enabled. The previous CLI version-selection policy is unchanged.

### Slack

The five existing incoming-webhook steps now pass `webhook` and `webhook-type: incoming-webhook` as inputs. This follows the [v2 migration contract](https://github.com/slackapi/slack-github-action/releases/tag/v2.0.0); the old `SLACK_WEBHOOK_TYPE` environment variable is no longer used. All five payload strings, destination expressions and step conditions remain identical.

Two explicit inputs preserve the previous delivery behavior: `errors: true` makes a failed delivery fail the step, and `retries: "0"` retains a single request attempt. The new defaults would otherwise swallow delivery errors and permit five retries. No token/API technique, second template substitution or payload flattening is enabled. GitHub already expands the inline workflow expressions. The existing JSON payloads also satisfy [v4's stricter YAML parsing](https://github.com/slackapi/slack-github-action/releases/tag/v4.0.0). Changed output formats do not affect these workflows because none of the five steps' outputs is consumed.

### Required native Redis acceptance

Both the full coverage job and the MySQL 8.0/9.7 native matrix run `scripts/ci/provision-test-redis.sh` before testing. It fetches [Redis 7.4.5 commit `7e0f53393290f7c1f35596117b67748efad16580`](https://github.com/redis/redis/commit/7e0f53393290f7c1f35596117b67748efad16580), verifies the checkout SHA, builds a local binary below `RUNNER_TEMP`, checks its version, and records its binary SHA-256. Only then does it export `AIS_TEST_REDIS_SERVER_BIN` through `GITHUB_ENV`. The step has a five-minute bound, performs no global installation and refuses a temporary directory inside the tested checkout.

The existing native matrix now explicitly includes `cache-recovery-mysql.test.ts`, `cache-rate-limit-native.test.ts`, `redis-cache-native.test.ts` and the integrated authority workstream's `booking-purge-mysql.test.ts`; the coverage collection includes them automatically. Each Redis subprocess test owns its server. The separate cross-process cache suite uses the matrix's existing disposable MySQL/Redis services. The purge suite creates an owned schema from migrated table definitions. A preparation failure fails the required job instead of allowing a missing binary to silently skip the six native Redis cases. The existing matrix artifact retains its name and paths and adds `native-redis-tool.json` for tool provenance.

### Follow-up validation and limits

- **All 11 workflows pass actionlint 1.7.12.** The Linux amd64 release archive was checked against both the official release digest and published checksum: `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`. The tool is kept outside the checkout.
- **All 9 existing workflow-hardening tests pass.** Duplicate-key-rejecting YAML parsing and full structure comparison against `e80d879` allow only the six action references, five Slack input mappings, two required native-tool preparation steps, four added native suites and the tool-receipt artifact entry. The coordinator repeated the exact comparison after adding the purge suite. All other triggers, permissions, conditions, runtime selections, job dependencies, commands and gates are equal to the base.
- **Eight pinned Slack bundle cases pass against an owned loopback HTTP fixture:** all five current payloads remain structurally identical and exit 0 after one successful request; the old action also succeeds with the representative payload; both old and new actions exit 1 after exactly one HTTP 503 response. A child-process socket guard rejects destinations outside the fixture, and the child environment contains only synthetic context and runner input defaults. No Slack service or real webhook was contacted. Initial harness attempts that omitted runner-created output files or default inputs remain recorded separately; these were corrected in the fixture, without changing upstream bundles.
- **The new provisioner completed an actual fresh pinned build** and wrote the checked source/version/binary receipt before exporting the absolute binary. Missing, relative, multiline and in-checkout temporary-directory cases fail before publishing an environment value. This establishes tool provisioning, not application acceptance; integrated native MySQL/Redis results belong to the subsequent CI receipts.
- Bash syntax, Prettier and `git diff --check` pass. TypeScript and the combined application tests remain part of the coordinator's integration check.
- No Codecov upload, real Slack delivery, repository dispatch, deployment, Railway configuration change, branch-protection change or release publication was performed by this workstream. Live service acceptance is separate from action input/runtime compatibility.
