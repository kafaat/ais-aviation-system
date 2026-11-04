import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  COVERAGE_PARTITION_FILES,
  partitionLcov,
  verifyCoverageUpload,
  writeCoveragePartitions,
} from "./coverage-partitions.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
function record(source, { empty = false, newline = "\n" } = {}) {
  return [
    "TN:fixture",
    `SF:${source}`,
    ...(empty
      ? []
      : ["FN:1,example,with,commas", "FNDA:3,example,with,commas"]),
    `FNF:${empty ? 0 : 1}`,
    `FNH:${empty ? 0 : 1}`,
    ...(empty ? [] : ["DA:1,3", "DA:2,0"]),
    `LF:${empty ? 0 : 2}`,
    `LH:${empty ? 0 : 1}`,
    ...(empty ? [] : ["BRDA:1,0,0,3", "BRDA:1,0,1,-"]),
    `BRF:${empty ? 0 : 2}`,
    `BRH:${empty ? 0 : 1}`,
    "end_of_record",
    "",
  ].join(newline);
}
const SERVER = record("server/service.ts");
const CLIENT = record("client/src/App.tsx");
const SHARED = record("shared/types.ts");
const INPUT = CLIENT + SERVER + SHARED;
const SUMMARY = {
  total: {
    lines: { total: 6, covered: 3 },
    functions: { total: 3, covered: 3 },
    branches: { total: 6, covered: 3 },
  },
};
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "coverage-partitions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(t) {
  const root = temporary(t);
  for (const [file, content] of Object.entries({
    ".gitignore": "test-results/\n",
    "vitest.config.ts": "export default {};\n",
    "package.json": '{"private":true}\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "server/service.ts": "export const service = true;\n",
    "client/src/App.tsx": "export const App = true;\n",
    "shared/types.ts": "export const shared = true;\n",
  }))
    write(join(root, file), content);
  git(root, "init", "-q");
  git(root, "add", ".");
  git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "fixture"
  );
  const commit = git(root, "rev-parse", "HEAD");
  const directory = "test-results/coverage-evidence/run-fixture";
  const evidence = join(root, directory);
  const artifacts = {
    "vitest.config.ts": readFileSync(join(root, "vitest.config.ts")),
    "vitest-results.json": json({
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 1,
      numTodoTests: 0,
      numTotalTestSuites: 1,
      success: true,
    }),
    "junit.xml": '<testsuites tests="3"/>',
    "coverage/coverage-summary.json": json(SUMMARY),
    "coverage/coverage-final.json": "{}\n",
    "coverage/lcov.info": INPUT,
    "coverage/cobertura-coverage.xml": "<coverage/>\n",
  };
  for (const [file, content] of Object.entries(artifacts))
    write(join(evidence, file), content);
  writeCoveragePartitions(evidence);
  const env = {
    GITHUB_SHA: commit,
    GITHUB_REPOSITORY: "fixture/repository",
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
  };
  const manifest = {
    schemaVersion: 1,
    status: "passed",
    source: {
      commit,
      tree: git(root, "rev-parse", "HEAD^{tree}"),
      dirty: false,
      configSha256: hash(readFileSync(join(root, "vitest.config.ts"))),
      packageSha256: hash(readFileSync(join(root, "package.json"))),
      lockSha256: hash(readFileSync(join(root, "pnpm-lock.yaml"))),
    },
    ci: {
      repository: env.GITHUB_REPOSITORY,
      runId: env.GITHUB_RUN_ID,
      runAttempt: "1",
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      checkoutSha: commit,
    },
    result: {
      exitCode: 0,
      wrapperExitCode: 0,
      signal: null,
      interruptedBy: null,
      startupError: null,
      evidenceErrors: [],
    },
    tests: {
      success: true,
      total: 3,
      passed: 2,
      failed: 0,
      pending: 1,
      todo: 0,
      suites: 1,
    },
    artifacts: [...Object.keys(artifacts), ...COVERAGE_PARTITION_FILES].map(
      path => {
        const content = readFileSync(join(evidence, path));
        return { path, bytes: content.length, sha256: hash(content) };
      }
    ),
  };
  const save = () =>
    write(join(evidence, "execution-manifest.json"), json(manifest));
  const replace = (path, content) => {
    write(join(evidence, path), content);
    const item = manifest.artifacts.find(item => item.path === path);
    item.bytes = Buffer.byteLength(content);
    item.sha256 = hash(content);
    save();
  };
  save();
  return {
    root,
    directory,
    evidence,
    env,
    manifest,
    save,
    replace,
    verify: () => verifyCoverageUpload({ root, directory, env }),
  };
}

test("partitioning conserves every raw record and counter, including empty records and CRLF", () => {
  const empty = record("client/src/only-types.ts", { empty: true });
  const crlf = record("server/other.ts", { newline: "\r\n" });
  const original = Buffer.from(CLIENT + crlf + empty + SHARED + SERVER);
  const { manifest, reports } = partitionLcov(original);
  assert.deepEqual(reports.server, Buffer.from(crlf + SERVER));
  assert.deepEqual(reports.client, Buffer.from(CLIENT + empty));
  assert.deepEqual(reports.shared, Buffer.from(SHARED));
  assert.deepEqual(manifest.input, {
    path: "coverage/lcov.info",
    bytes: original.length,
    sha256: hash(original),
    records: 5,
    totals: { FNF: 4, FNH: 4, LF: 8, LH: 4, BRF: 8, BRH: 4 },
  });
  const byIndex = manifest.partitions
    .flatMap(partition => {
      let offset = 0;
      return partition.files.map(file => {
        const raw = reports[partition.flag].subarray(
          offset,
          offset + file.bytes
        );
        offset += file.bytes;
        assert.equal(hash(raw), file.sha256);
        return { index: file.index, raw };
      });
    })
    .sort((a, b) => a.index - b.index);
  assert.deepEqual(Buffer.concat(byIndex.map(item => item.raw)), original);
});

test("the final end marker need not have a newline", () => {
  assert.deepEqual(
    partitionLcov(INPUT.slice(0, -1)).reports.shared,
    Buffer.from(SHARED.slice(0, -1))
  );
});

test("duplicate function names retain separate producer counts", () => {
  const duplicate = SERVER.replace(
    "FN:1,example,with,commas\nFNDA:3,example,with,commas\nFNF:1\nFNH:1",
    "FN:1,same\nFN:2,same\nFNDA:3,same\nFNDA:0,same\nFNF:2\nFNH:1"
  );
  assert.deepEqual(
    partitionLcov(duplicate + CLIENT + SHARED).reports.server,
    Buffer.from(duplicate)
  );
});

for (const source of [
  "/server/service.ts",
  "server/../shared/types.ts",
  "server/./service.ts",
  "server//service.ts",
  "server\\service.ts",
  "C:/server/service.ts",
  "server/service.ts ",
  "serverish/service.ts",
  "client/other.ts",
  "unknown/service.ts",
]) {
  test(`rejects unsafe or unassigned source ${JSON.stringify(source)}`, () => {
    assert.throws(
      () => partitionLcov(record(source) + CLIENT + SHARED),
      /LCOV_/
    );
  });
}
for (const [name, mutate, code] of [
  ["duplicate source", value => value + SERVER, "LCOV_DUPLICATE_SOURCE"],
  ["absent scope", () => SERVER + CLIENT, "LCOV_EMPTY_SCOPE"],
  [
    "entirely empty scope",
    () => SERVER + CLIENT + record("shared/types.ts", { empty: true }),
    "LCOV_EMPTY_SCOPE",
  ],
  ["truncated report", value => value.slice(0, -5), "LCOV_INCOMPLETE_REPORT"],
  ["trailing garbage", value => value + "DA:8,1\n", "LCOV_INCOMPLETE_REPORT"],
  [
    "unknown field",
    value => value.replace("LF:2", "XX:2"),
    "LCOV_UNSUPPORTED_FIELD",
  ],
  [
    "wrong count",
    value => value.replace("LF:2", "LF:3"),
    "LCOV_COUNTER_MISMATCH",
  ],
  [
    "missing count",
    value => value.replace("LF:2\n", ""),
    "LCOV_COUNTER_MISMATCH",
  ],
  [
    "duplicate count",
    value => value.replace("LF:2", "LF:2\nLF:2"),
    "LCOV_DUPLICATE_COUNTER",
  ],
  [
    "negative hits",
    value => value.replace("DA:1,3", "DA:1,-1"),
    "LCOV_INVALID_NUMBER",
  ],
  [
    "unsafe hits",
    value => value.replace("DA:1,3", "DA:1,9007199254740992"),
    "LCOV_INVALID_NUMBER",
  ],
  [
    "duplicate line",
    value => value.replace("DA:1,3", "DA:1,3\nDA:1,0"),
    "LCOV_DUPLICATE_LINE",
  ],
  [
    "duplicate branch",
    value => value.replace("BRDA:1,0,0,3", "BRDA:1,0,0,3\nBRDA:1,0,0,0"),
    "LCOV_DUPLICATE_BRANCH",
  ],
  [
    "unmatched function",
    value => value.replace("FNDA:3,example,with,commas", "FNDA:3,different"),
    "LCOV_FUNCTION_COUNTER_MISMATCH",
  ],
  [
    "multiple sources in a record",
    value =>
      value.replace(
        "SF:server/service.ts",
        "SF:server/service.ts\nSF:shared/other.ts"
      ),
    "LCOV_INVALID_SOURCE_RECORD",
  ],
  [
    "invalid UTF-8",
    value => Buffer.concat([Buffer.from(value), Buffer.from([0xff])]),
    "LCOV_INVALID_UTF8",
  ],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => partitionLcov(mutate(INPUT)), { code });
  });
}

test("invalid input or a conflicting summary produces no partition files", t => {
  const root = temporary(t);
  write(join(root, "coverage/lcov.info"), INPUT);
  write(join(root, "coverage/coverage-summary.json"), json({ total: {} }));
  assert.throws(() => writeCoveragePartitions(root), {
    code: "LCOV_SUMMARY_MISMATCH",
  });
  assert.equal(existsSync(join(root, "coverage/codecov")), false);
  write(join(root, "coverage/coverage-summary.json"), json(SUMMARY));
  write(join(root, "coverage/lcov.info"), INPUT + SERVER);
  assert.throws(() => writeCoveragePartitions(root), {
    code: "LCOV_DUPLICATE_SOURCE",
  });
  assert.equal(existsSync(join(root, "coverage/codecov")), false);
});

test("verification binds the successful artifact and permits a later job-only rerun", t => {
  const f = fixture(t);
  assert.equal(f.verify().originalRunAttempt, 1);
  f.env.GITHUB_RUN_ATTEMPT = "2";
  const proof = f.verify();
  assert.equal(proof.uploadRunAttempt, 2);
  assert.equal(proof.source.commit, f.env.GITHUB_SHA);
  assert.equal(proof.input.sha256, hash(INPUT));
  assert.deepEqual(
    proof.partitions.map(item => item.flag),
    ["server", "client", "shared"]
  );
});

test("CLI fails closed with a nonzero exit before any upload", t => {
  const f = fixture(t);
  f.manifest.status = "failed";
  f.save();
  const result = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "coverage-partitions.mjs"),
      "verify",
      f.directory,
    ],
    { cwd: f.root, env: { ...process.env, ...f.env }, encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /COVERAGE_UNSUCCESSFUL_RUN/);
});

for (const [name, mutate, code] of [
  [
    "a failed child",
    f => {
      f.manifest.result.exitCode = 7;
    },
    "COVERAGE_UNSUCCESSFUL_RUN",
  ],
  [
    "an interrupted child",
    f => {
      f.manifest.result.signal = "SIGTERM";
    },
    "COVERAGE_UNSUCCESSFUL_RUN",
  ],
  [
    "reported failed tests",
    f => {
      f.manifest.tests.failed = 1;
    },
    "COVERAGE_UNSUCCESSFUL_RUN",
  ],
  [
    "wrong source commit",
    f => {
      f.manifest.source.commit = "a".repeat(40);
    },
    "COVERAGE_SOURCE_MISMATCH",
  ],
  [
    "wrong source tree",
    f => {
      f.manifest.source.tree = "a".repeat(40);
    },
    "COVERAGE_SOURCE_MISMATCH",
  ],
  [
    "dirty original source",
    f => {
      f.manifest.source.dirty = true;
    },
    "COVERAGE_SOURCE_MISMATCH",
  ],
  [
    "changed checkout source",
    f => {
      write(join(f.root, "server/service.ts"), "changed\n");
    },
    "COVERAGE_SOURCE_MISMATCH",
  ],
  [
    "wrong lock hash",
    f => {
      f.manifest.source.lockSha256 = "a".repeat(64);
    },
    "COVERAGE_INPUT_MISMATCH",
  ],
  [
    "another workflow run",
    f => {
      f.manifest.ci.runId = "124";
    },
    "COVERAGE_CI_MISMATCH",
  ],
  [
    "another repository",
    f => {
      f.manifest.ci.repository = "other/repository";
    },
    "COVERAGE_CI_MISMATCH",
  ],
  [
    "a future artifact attempt",
    f => {
      f.manifest.ci.runAttempt = "2";
    },
    "COVERAGE_ATTEMPT_MISMATCH",
  ],
  [
    "a pull request upload",
    f => {
      f.manifest.ci.event = f.env.GITHUB_EVENT_NAME = "pull_request";
    },
    "COVERAGE_PULL_REQUEST_UPLOAD_FORBIDDEN",
  ],
  [
    "a duplicate artifact",
    f => {
      f.manifest.artifacts[0] = f.manifest.artifacts[1];
    },
    "COVERAGE_ARTIFACT_CATALOG_MISMATCH",
  ],
  [
    "an artifact traversal",
    f => {
      f.manifest.artifacts[0].path = "../../../vitest.config.ts";
    },
    "COVERAGE_ARTIFACT_CATALOG_MISMATCH",
  ],
  [
    "a stale report hash",
    f => {
      write(join(f.evidence, "coverage/codecov/server.lcov.info"), "stale\n");
    },
    "COVERAGE_ARTIFACT_MISMATCH",
  ],
  [
    "a substituted partition with refreshed hash",
    f => {
      f.replace("coverage/codecov/server.lcov.info", CLIENT);
    },
    "COVERAGE_PARTITION_CONTENT_MISMATCH",
  ],
  [
    "a substituted partition manifest with refreshed hash",
    f => {
      f.replace("coverage/codecov/partition-manifest.json", "{}\n");
    },
    "COVERAGE_PARTITION_MANIFEST_MISMATCH",
  ],
]) {
  test(`verification rejects ${name}`, t => {
    const f = fixture(t);
    mutate(f);
    f.save();
    assert.throws(f.verify, { code });
  });
}

test("verification rejects missing reports and symlink artifacts", t => {
  const f = fixture(t);
  const path = join(f.evidence, "coverage/codecov/server.lcov.info");
  rmSync(path);
  assert.throws(f.verify, { code: "ENOENT" });
  symlinkSync(join(f.evidence, "coverage/lcov.info"), path);
  assert.throws(f.verify, { code: "COVERAGE_UNSAFE_ARTIFACT" });
});

test("verification rejects a runner report contradicting its rehashed success manifest", t => {
  const f = fixture(t);
  const result = JSON.parse(
    readFileSync(join(f.evidence, "vitest-results.json"))
  );
  result.success = false;
  result.numFailedTests = 1;
  f.replace("vitest-results.json", json(result));
  assert.throws(f.verify, { code: "COVERAGE_RESULT_MISMATCH" });
});

test("verification rejects untracked sources even in a fully rehashed partition set", t => {
  const f = fixture(t);
  rmSync(join(f.evidence, "coverage/codecov"), { recursive: true });
  f.replace(
    "coverage/lcov.info",
    INPUT.replace("shared/types.ts", "shared/nonexistent.ts")
  );
  writeCoveragePartitions(f.evidence);
  for (const path of COVERAGE_PARTITION_FILES)
    f.replace(path, readFileSync(join(f.evidence, path)));
  assert.throws(f.verify, { code: "COVERAGE_UNTRACKED_SOURCE" });
});

test("verification rejects ambiguous JSON and directories outside the evidence tree", t => {
  const f = fixture(t);
  write(
    join(f.evidence, "execution-manifest.json"),
    json(f.manifest).replace(
      '"status": "passed",',
      '"status": "failed",\n  "status": "passed",'
    )
  );
  assert.throws(f.verify, { code: "COVERAGE_NONCANONICAL_JSON" });
  assert.throws(
    () =>
      verifyCoverageUpload({
        root: f.root,
        directory: `${f.directory}/../run-fixture`,
        env: f.env,
      }),
    { code: "COVERAGE_INVALID_DIRECTORY" }
  );
});

test("the isolated uploader verifies one complete set before pairing each report with its own flag", () => {
  const workflow = readFileSync(
    join(import.meta.dirname, "../../.github/workflows/ci-cd.yml"),
    "utf8"
  );
  const upload = workflow.match(/^  codecov:\n((?: {4,}.*\n|\n)*)/m)?.[1];
  assert.ok(upload, "Expected an isolated Codecov job");
  assert.match(upload, /if: github.event_name != 'pull_request'/);
  assert.match(
    upload,
    /permissions:\n      contents: read\n      id-token: write/
  );
  assert.doesNotMatch(
    upload,
    /\b(?:pnpm|npm|yarn)\s+(?:install|run|exec)\b|node_modules\//
  );
  assert.match(
    upload,
    /run: node scripts\/ci\/coverage-partitions\.mjs verify "\$COVERAGE_EVIDENCE_DIR"/
  );
  assert.ok(
    upload.indexOf("node scripts/ci/coverage-partitions.mjs verify") <
      upload.indexOf("uses: codecov/codecov-action@")
  );
  assert.deepEqual(
    [...upload.matchAll(/ {10}files: (.*)\n {10}flags: (.*)\n/g)].map(
      ([, file, flag]) => ({ file, flag })
    ),
    ["server", "client", "shared"].map(flag => ({
      file: `\${{ needs.test.outputs.evidence-dir }}/coverage/codecov/${flag}.lcov.info`,
      flag,
    }))
  );
  assert.equal((upload.match(/use_oidc: true/g) ?? []).length, 3);
  assert.equal((upload.match(/disable_search: true/g) ?? []).length, 3);
  assert.equal((upload.match(/fail_ci_if_error: false/g) ?? []).length, 3);
});
