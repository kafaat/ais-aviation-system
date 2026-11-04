# Authentication image base review — 4 November 2026

## Decision and scope

Use the official Python 3.12 Alpine base at the exact digest below. The base
passed a HIGH/CRITICAL vulnerability preflight, and every resolved authentication
requirement has a compatible binary or pure-Python wheel for Linux/amd64. These
results cover the **base image and dependency compatibility preflight**. Acceptance
of the final application image still requires its own scan and the container
runtime tests in CI; this document does not claim those later checks have passed.

| Candidate                   | Exact multi-platform index digest                                         | Detected OS   | HIGH / CRITICAL | Exit |
| --------------------------- | ------------------------------------------------------------------------- | ------------- | --------------- | ---- |
| `python:3.12-alpine3.24`    | `sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8` | Alpine 3.24.3 | 0 / 0           | 0    |
| `python:3.12-slim-bookworm` | `sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337` | Debian 12.15  | 36 / 2          | 1    |

Both candidates contain Python **3.12.16**. The Alpine amd64 manifest is
`sha256:69ebe56e2a764c399514a0a6117131cb730cc4d0e71e85c08deb9af74cbb9f41`;
its image config is
`sha256:38fd5a425aa93b06d367e2e47e2da6a9bc0cabdaf5788fb1707d143fd1416e97`.
The official [Python image catalog](https://hub.docker.com/_/python),
[tag registry source](https://github.com/docker-library/official-images/blob/master/library/python),
and [Alpine Dockerfile at its recorded source commit](https://github.com/docker-library/python/blob/3d7e95597e56a415d9e4abc0f15877e005d2cb2e/3.12/alpine3.24/Dockerfile)
were checked. Digests were read from the public Docker Registry manifests.

## Failure that triggered this review

[Production Docker Validation run 41888953071, job 126780860449](https://github.com/kafaat/ais-aviation-system/actions/runs/41888953071/job/126780860449)
built PR head `bee99028ee59053b54f5fdb758d59fd41ba4e25a` through merge commit
`21960bc4b29dc509387c8c090f65ed232d381192`, tree
`85b4f89ab27adf0d977d292b0f6fa5ac86d32f0d`. The auth scan failed; runner and
migrator scans passed. Its `python:3.12-slim` base resolved to
`sha256:b18b261e1b4974b4f321451ad5251ded85abb22c2b8b262da527dda1d031ab30`
and Debian 13.7. The auth report contained **45 HIGH package/CVE rows, nine
distinct CVEs, and no Python package findings**. Every row lacked a fixed version:
44 were `affected` and one was `fix_deferred`. Affected package families were
util-linux, ACL, ncurses, SQLite, systemd/udev, and Perl.

The [original evidence artifact 13352169141](https://github.com/kafaat/ais-aviation-system/actions/runs/41888953071/artifacts/13352169141)
was downloaded and verified: 185,223 bytes, ZIP SHA256
`bdcc86f1d60fd4e5d17901cf30791d952d36a0d939cdd6081bcaa2684fc68093`.
No finding was ignored or dismissed. Moving to bookworm also fails the same
policy, as the candidate comparison shows.

## Reproducible base scan

The official [Trivy 0.74.0 release](https://github.com/aquasecurity/trivy/releases/tag/v0.74.0)
Linux-64bit archive was checked against the release asset SHA256:
`2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a`.
The scan used remote registry access without a container daemon:

```sh
EVIDENCE=/workspace/scratch/983713fe9ea8/security-pr270-evidence/images
"$EVIDENCE/tools/trivy" image \
  --cache-dir "$EVIDENCE/trivy-cache" \
  --image-src remote --platform linux/amd64 --scanners vuln \
  --severity HIGH,CRITICAL --exit-code 1 --timeout 3m --format json \
  --output "$EVIDENCE/trivy-python-alpine-base.json" \
  docker.io/library/python:3.12-alpine3.24@sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8
```

The scan finished at **2026-11-04 18:44:49 UTC**, inspecting **38 OS packages
and one Python package**. The database was updated at
`2026-11-04T13:16:53.670958885Z` and downloaded at
`2026-11-04T18:44:33.365502258Z`. Bookworm used the same command and cached DB
with `--skip-db-update`, its exact image reference, and a separate output file;
it finished at 18:46:53 UTC. Its 38 rows covered 13 CVEs, all without fixed versions.
This was a vulnerability scan filtered to HIGH/CRITICAL, not an all-severity or
secret scan. Trivy reported a missing Alpine 3.24 EOL-list entry while completing
vulnerability detection against the Alpine 3.24 repository.

The [Alpine JSON report](auth-base-trivy.json) preserves the parsed scan output
with repository formatting and the two public-key metadata substitutions described
below. The original, unsanitized scan JSON has SHA256
`ba1e833646c259772beb9269566db3a88bbbf45b10b047cd1542b038a16effb5`.

## Public signing fingerprint classification

Gitleaks alerts [151](https://github.com/kafaat/ais-aviation-system/security/code-scanning/151)
and [152](https://github.com/kafaat/ais-aviation-system/security/code-scanning/152)
matched the official Python release-signing **public fingerprint** copied into
the image history and environment. The immutable
[upstream Dockerfile](https://github.com/docker-library/python/blob/3d7e95597e56a415d9e4abc0f15877e005d2cb2e/3.12/alpine3.24/Dockerfile)
declares this value as `GPG_KEY`, retrieves its public key, and uses it to verify
the Python source archive. It is not an application credential or private key.

Only the fingerprint values at these two JSON paths are replaced with `<public>`:

- `Metadata.ImageConfig.history[5].created_by`
- `Metadata.ImageConfig.config.Env[2]`

Package inventories, vulnerability findings, image digests, and scan metadata are
unchanged. This prevents the copied public value from generating a new finding
when the PR is squash-merged. The original report remains recoverable from
commit `1176fa7bb2cb37db3917395b79eaebff33d0a4e6` and the upstream image digest.

CI also scans the PR's commit history, so sanitizing the current file alone does
not remove the two historical findings. `.gitleaksignore` therefore records only
their exact commit, path, rule, and line identities (62 and 110). No detector,
file, directory, or credential pattern is exempted. `.gitleaks.toml`, the scanned
commit range, and the nonzero leak exit code remain unchanged.

Independent verification used the same Gitleaks **8.24.3** binary as CI, with
archive SHA256 `9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.
Tests ran in an isolated Git clone with generated, nonfunctional controls and
zero provider calls:

| Case                                                                                  | Expected and observed result                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Published PR history before the correction                                            | Exit 2; exactly two public-fingerprint findings |
| Entire PR history with the correction                                                 | Exit 0; zero findings                           |
| Corrected tree under a new squash-like commit identity                                | Exit 0; zero findings                           |
| New synthetic credentials at the same report path and lines 62/110, plus another path | Exit 2; all three detected                      |
| Existing `probe-gitleaks-policy.py`                                                   | 8/8 passed; all six positive controls detected  |

## Native dependency compatibility

From the repository root, the following completed successfully:

```sh
python -m pip download --only-binary=:all: \
  --platform musllinux_1_2_x86_64 --platform musllinux_1_1_x86_64 \
  --python-version 3.12 --implementation cp --abi cp312 \
  --dest "$EVIDENCE/musl-wheels" -r auth-service/requirements.txt
```

All **33 resolved packages** downloaded without source-build fallback. Eleven
had native wheels: bcrypt 4.2.1, SQLAlchemy 2.0.36, cryptography 50.0.1,
pydantic-core 2.27.2, cffi 2.1.1, greenlet 3.5.6, httptools 0.9.0,
PyYAML 6.0.3, uvloop 0.23.0, watchfiles 1.3.0, and websockets 17.4.
Static `readelf -d` inspection of their 24 shared objects found musl libc as
the only external shared-library requirement. Required libgcc/libstdc++ copies
are included in the wheels with relative loader paths. This supports using the
base without adding a compiler, Rust toolchain, or development packages.

The official base retains its CPython runtime dependencies through
`.python-rundeps`, including OpenSSL 3.5.9-r0, SQLite 3.53.4-r0,
libuuid 2.42.3-r1, ncurses 6.6_p20260516-r0, libffi, compression libraries,
readline, and musl. Its complete package inventory is in the JSON report.
Neither wheel availability nor static dependency inspection substitutes for
executing the final image: CI must run its authentication/configuration tests,
exercise the actual ASGI server, and preserve the HIGH/CRITICAL image gate.
