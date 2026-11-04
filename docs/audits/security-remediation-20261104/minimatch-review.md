# Independent minimatch and security workflow review

Reviewed on 2026-11-04 against main
`e80d8790fba2a30e3164322e0fe40ed5a62bb553`, tree
`a527a9d0ecd23362b6f4ed66369bb4f4902bbefe`, and the proposed security remediation
changes based on that commit.

## Scope and conclusion

The two existing Trivy code scanning findings described below are false positives
for **CVE-2026-118764 / GHSA-g3hv-75wg-m249** on their exact installed versions.
This conclusion follows the current reviewed advisory and verified upstream
source. It does not assert that those versions are free of unrelated
vulnerabilities.

| Finding observed on main                                                                       | Scanner    | Installed version  | Assessment for this CVE                                            |
| ---------------------------------------------------------------------------------------------- | ---------- | ------------------ | ------------------------------------------------------------------ |
| [Code scanning #141](https://github.com/kafaat/ais-aviation-system/security/code-scanning/141) | Trivy      | `minimatch@3.1.5`  | Outside the current affected range; affected implementation absent |
| [Code scanning #142](https://github.com/kafaat/ais-aviation-system/security/code-scanning/142) | Trivy      | `minimatch@5.1.9`  | Outside the current affected range; affected implementation absent |
| [Dependabot #242](https://github.com/kafaat/ais-aviation-system/security/dependabot/242)       | Dependabot | `minimatch@10.2.6` | Affected; the proposed scoped update addresses this instance       |

The [GitHub Reviewed advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249),
updated 2026-11-04, specifies affected versions `>=7.0.0, <11.0.1` and patched
version `11.0.1`. The [maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)
describes amplification during the first preprocessing phase, followed by
quadratic work in the second phase. The [upstream fix](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
bounds pattern expansion and large-set deduplication in those phases.

Prefer a fresh scan after the dependency changes, allowing the scanner to resolve
the findings from current advisory metadata. If these exact two findings remain,
a false-positive dismissal with the evidence below is justified. Do not add a
blanket CVE ignore, suppress low or medium findings, or replace all minimatch
majors merely to change scanner output. This review itself did not dismiss alerts
or alter scanner settings.

## Source and package provenance

The baseline lockfile contains `minimatch@3.1.5`, `5.1.9`, and `10.2.6`. The
installed sources were read from the baseline dependency installation. For each
legacy version, the reviewer downloaded the official npm metadata and archive,
verified the archive SHA512 against the registry metadata and lockfile, and
compared `minimatch.js` byte for byte with both the installed file and the upstream
version tag. Both comparisons matched for both versions.

| Version | `minimatch.js` SHA256, identical across installed file, npm archive and upstream tag |
| ------- | ------------------------------------------------------------------------------------ |
| `3.1.5` | `746849f267c4868a53729225bd85c7dccd387712136fb305fcc0a3eadd4a3d9d`                   |
| `5.1.9` | `1339bca8b70e33847860daa8fc3ccfa62487e143670da01a3b718d40d5fd424f`                   |

Official npm archive digests:

| Archive                                                                           | SHA256                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [minimatch-3.1.5.tgz](https://registry.npmjs.org/minimatch/-/minimatch-3.1.5.tgz) | `d81817ecf72de3c8c5d3724407752d943c9e1a42af5c437d9cb923be8a72c648` |
| [minimatch-5.1.9.tgz](https://registry.npmjs.org/minimatch/-/minimatch-5.1.9.tgz) | `67e7dacfba9fcabb6ac661620b67e6c22600b4aa56ffa14431cbdfdeebbd4cfe` |

Verified archive and lockfile SHA512 values:

```text
3.1.5 sha512-VgjWUsnnT6n+NUk6eZq77zeFdpW2LWDzP6zFGrCbHXiYNul5Dzqk2HHQ5uFH2DNW5Xbp8+jVzaeNt94ssEEl4w==
5.1.9 sha512-7o1wEA2RyMP7Iu7GNba9vc0RWWGACJOCZBJX2GJWip0ikV+wcOsgVuY9uE8CPiyQhkGFSlhuSkZPavN7u1c2Fw==
```

The complete main implementations in
[v3.1.5](https://github.com/isaacs/minimatch/blob/v3.1.5/minimatch.js) and
[v5.1.9](https://github.com/isaacs/minimatch/blob/v5.1.9/minimatch.js) contain none
of `firstPhasePreProcess`, `secondPhasePreProcess`, or `optimizationLevel`.
Their `make()` implementations expand braces, split the resulting strings on
slashes, and map `parse()` over the path portions. They do not perform the
preprocessing described by this CVE.

In contrast, the installed `10.2.6` implementation contains both preprocessing
methods and the optimization option. Its CommonJS implementation SHA256 is
`d224f71f20d7c206fcc5b7e9f747324c7698345a0b2c28d717dd9cf698306783`.
The [upstream changelog](https://github.com/isaacs/minimatch/blob/main/changelog.md)
associates advanced preprocessing with 7.0 and the configurable optimization level
with 7.1, consistent with the reviewed advisory's lower bound.

## Bounded differential observation

A finite constructor comparison ran under a 10-second external subprocess
deadline and a 128 MiB Node heap limit. Each case used one, two, or three
repetitions of `**/../a/b`, joined with `/`, and compared default options with
`{ optimizationLevel: 2 }`.

| Installed version | Default parsed-set counts for 1 / 2 / 3 repetitions | Counts with optimization level 2 | First preprocessing method |
| ----------------- | --------------------------------------------------- | -------------------------------- | -------------------------- |
| `3.1.5`           | 1 / 1 / 1                                           | 1 / 1 / 1                        | Absent                     |
| `5.1.9`           | 1 / 1 / 1                                           | 1 / 1 / 1                        | Absent                     |
| `10.2.6`          | 1 / 1 / 1                                           | 2 / 4 / 8                        | Present                    |

For both legacy versions, the serialized parsed sets were also identical with
and without the option. The command exited 0 without stderr. These bounded cases
corroborate the source review; they are not exhaustive denial-of-service testing
and are not the sole basis for the false-positive classification.

## Dependency change review

The proposed changes remove the unused `vite-plugin-pwa` development dependency
and scope the `minimatch@11.0.4` override to
`@typescript-eslint/typescript-estree>minimatch`.

The existing Vite configuration identifies `client/public/sw.js` as the service
worker authority. The existing `server/pwa-build-contract.test.ts` rejects a
`VitePWA` import or invocation. Source inspection found no implementation requiring
the removed plugin.

Independent semantic comparison of the old and proposed lockfiles found:

- Package entries decrease from 1,452 to 1,257: 197 removed and two added.
- The additions are `minimatch@11.0.4` and
  `@isaacs/nonrecursive-glob-match@1.0.3`.
- Metadata for every retained package entry is unchanged.
- Production importer dependencies are unchanged.
- No remaining direct dependency version changes. The only remaining development
  importer change is the visualizer peer suffix, from Rollup 2.80.0 to 4.63.1.
  `rollup-plugin-visualizer@5.14.0` explicitly permits Rollup 2.x, 3.x, or 4.x.
- Legacy minimatch 3.1.5 and 5.1.9 remain on their own dependency paths.

The only minimatch invocation in the installed
`@typescript-eslint/typescript-estree@8.69.0` implementation is the named function
`minimatch(filePath, pattern, { dot: true })`, used to match `allowDefaultProject`.
It does not use removed `makeRe`, `AST`, `regexp`, or internal matcher methods.
The installed 11.0.4 package retains this named function and supports the project's
Node 22 runtime (`20 || >=22`).

Resolution from the actual TypeScript ESTree package was verified to reach
11.0.4. Twenty bounded file-pattern pairs, including dotfiles, brace patterns,
extglobs, negation, exact paths, and Unicode filenames, produced the same booleans
as the baseline 10.2.6 named API with `{ dot: true }`.

The resolved 11.0.4 package declares `brace-expansion@^5.0.12`; the actual lockfile
and installation select 5.0.12. Its new matcher dependency resolves to 1.0.3.
Both new packages declare BlueOak-1.0.0, which is already present in the dependency
review license allowlist. The current dependency changes have no identified
review blocker, subject to the normal integration gates.

## Security workflow review

Removing the catch-all dependency-graph preflight prevents API failures from
silently skipping dependency review. The proposed auth image build and scan
extend the existing high/critical gate to the Python service, with evidence
uploaded even when a job fails. Their paths, image tags, and failure conditions
match the existing build and deployment flow.

One concrete issue was found in the initial filesystem-scan change: adding
`exit-code: "1"` to the existing SARIF invocation does not enforce only the
configured high/critical threshold. The exact pinned
[Trivy action entrypoint](https://github.com/aquasecurity/trivy-action/blob/d2a0b60797ff03db6132bd4e2b293f9b37081297/entrypoint.sh)
unsets `TRIVY_SEVERITY` for SARIF unless `limit-severities-for-sarif` is true.
Consequently that initial change would also fail the job on low and medium
findings. This behavior is documented in the
[official action inputs](https://github.com/aquasecurity/trivy-action#inputs).

The correction was implemented and independently verified in the updated
workflow: the complete SARIF report uses explicit `exit-code: "0"`, followed by a
separate filesystem table scan with `severity: CRITICAL,HIGH` and
`exit-code: "1"`. Both use the same pinned action. The SARIF upload retains
`if: always()` after both scans. No `continue-on-error`, severity suppression, or
ignore rule was added. This preserves visibility of lower-severity findings while
failing closed at the declared threshold; a scanner execution error still fails
the job. Merely limiting the SARIF report would have removed lower-severity
findings from the uploaded report.

The updated workflow parses successfully, and `git diff --check` passes. The
identified workflow blocker is resolved. The reviewed dependency and workflow
changes are approved, subject to the normal integration gates. This approval
does not cover concurrent authentication-service implementation changes.

## Limits

The old Trivy findings are consistent with earlier affected-range metadata, but
this reviewer did not inspect the exact Trivy database revision and does not
claim that as a proven cause. A successful npm audit is not proof of a completed
GitHub alert rescan. Final alert state, complete CI results, image scans, merge,
and deployment must be verified separately against the final commit.
