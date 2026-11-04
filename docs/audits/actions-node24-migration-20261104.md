# GitHub Actions Node 24 migration — 2026-11-04

## Scope and provenance

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

## Remaining Node 20 dependencies

| Action                         | Current pin                                | Invocations | Reason retained                                                                                      |
| ------------------------------ | ------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| `codecov/codecov-action`       | `b9fd7d16f6d7d1b5d2bec1a2887e65ceed900238` | 1           | Separate Codecov CLI/action-major migration; preserve the existing #268 coverage upload integration. |
| `slackapi/slack-github-action` | `70cd7be8e40a46e8b0eced40b0de447bdb42f68e` | 5           | Separate notification input/API migration; preserve current Slack webhook behavior.                  |

These two third-party families were audited and are explicitly outside this compatible-pin patch. The patch does not claim that every future workflow warning is eliminated. Semantic-PR, SBOM, and CodeQL pins already declare Node 24 and remain unchanged. PR-size-labeler uses Docker; Trivy uses a composite action and is unchanged.

## Validation and limits

- All 11 workflows parse with duplicate-key rejection and GitHub-compatible boolean handling.
- Full YAML structure comparison against the exact main base permits only the verified `uses` replacements and `package-manager-cache: false` additions. This protects #268 coverage gates and all existing workflow behavior settings.
- All supplied inputs for migrated actions exist in the new pinned manifests; existing input defaults were compared.
- Prettier checks and `git diff --check` pass.
- `actionlint` was not installed on PATH or found in the checked tool caches; no actionlint success is claimed.
- No Actions run, deployment, Slack send, repository dispatch, branch push, or PR write was performed. Deployment-only steps have static contract/release-note verification; they were not executed locally.
