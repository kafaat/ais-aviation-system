import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  COVERAGE_PARTITION_FILES,
  partitionLcov,
  verifyCoverageUpload,
} from "./coverage-partitions.mjs";
import {
  INVENTORY_FILE,
  buildCoverageInventory,
  readCoverageScope,
  verifyCoverageInventory,
  writeCoverageInventory,
} from "./coverage-scope-inventory.mjs";

const require = createRequire(import.meta.url);
const CONFIG = readFileSync(
  new URL("../../vitest.config.ts", import.meta.url),
  "utf8"
);
const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const record = source =>
  [
    "TN:scope-fixture",
    `SF:${source}`,
    "FNF:0",
    "FNH:0",
    "DA:1,1",
    "DA:2,0",
    "LF:2",
    "LH:1",
    "BRDA:1,0,0,1",
    "BRDA:1,0,1,-",
    "BRF:2",
    "BRH:1",
    "end_of_record",
    "",
  ].join("\n");
const MEASURED = ["server/service.ts", "client/src/App.tsx", "shared/types.ts"];
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(
  t,
  { config = CONFIG, extraSources = {}, measured = MEASURED } = {}
) {
  const root = mkdtempSync(join(tmpdir(), "coverage-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({
    ".gitignore": "test-results/\n",
    "vitest.config.ts": config,
    "package.json": '{"private":true}\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    ...Object.fromEntries(
      MEASURED.map(path => [path, "export const source = true;\n"])
    ),
    "server/__tests__/service.test.ts": "// test source\n",
    "server/types.d.ts": "declare const source: boolean;\n",
    "server/dist/generated.ts": "export const generated = true;\n",
    "client/src/test/setup.ts": "// test support\n",
    "server/setup.ts": "// setup\n",
    "README.md": "Outside the application coverage includes.\n",
    ...extraSources,
  }))
    write(join(root, path), content);
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
  const directory = "test-results/coverage-evidence/run-fixture";
  const evidence = join(root, directory);
  const plan = partitionLcov(measured.map(record).join(""));
  const reported = {
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTestSuites: 1,
    success: true,
  };
  const artifacts = {
    "vitest.config.ts": config,
    "vitest-results.json": json(reported),
    "junit.xml": '<testsuites tests="3"/>\n',
    "coverage/coverage-summary.json": json({
      total: {
        lines: {
          total: plan.manifest.input.totals.LF,
          covered: plan.manifest.input.totals.LH,
        },
        functions: {
          total: plan.manifest.input.totals.FNF,
          covered: plan.manifest.input.totals.FNH,
        },
        branches: {
          total: plan.manifest.input.totals.BRF,
          covered: plan.manifest.input.totals.BRH,
        },
      },
    }),
    "coverage/coverage-final.json": "{}\n",
    "coverage/lcov.info": measured.map(record).join(""),
    "coverage/cobertura-coverage.xml": "<coverage/>\n",
    ...Object.fromEntries(
      plan.manifest.partitions.map(item => [item.path, plan.reports[item.flag]])
    ),
    "coverage/codecov/partition-manifest.json": json(plan.manifest),
  };
  for (const [path, content] of Object.entries(artifacts))
    write(join(evidence, path), content);
  const commit = git(root, "rev-parse", "HEAD");
  const manifest = {
    schemaVersion: 1,
    status: "passed",
    source: {
      commit,
      tree: git(root, "rev-parse", "HEAD^{tree}"),
      dirty: false,
      configSha256: hash(config),
      packageSha256: hash(readFileSync(join(root, "package.json"))),
      lockSha256: hash(readFileSync(join(root, "pnpm-lock.yaml"))),
    },
    ci: {
      repository: "fixture/repository",
      runId: "123",
      runAttempt: "1",
      event: "push",
      ref: "refs/heads/main",
      checkoutSha: commit,
    },
    runtime: {
      vitest: require("vitest/package.json").version,
      coverageProvider: "v8",
      coverageProviderVersion: require("@vitest/coverage-v8/package.json")
        .version,
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
      total: 3,
      passed: 3,
      failed: 0,
      pending: 0,
      todo: 0,
      suites: 1,
      success: true,
    },
    artifacts: Object.entries(artifacts).map(([path, content]) => ({
      path,
      bytes: Buffer.byteLength(content),
      sha256: hash(content),
    })),
  };
  const save = () =>
    write(join(evidence, "execution-manifest.json"), json(manifest));
  const replaceArtifact = (path, content) => {
    write(join(evidence, path), content);
    Object.assign(
      manifest.artifacts.find(item => item.path === path),
      { bytes: Buffer.byteLength(content), sha256: hash(content) }
    );
    save();
  };
  save();
  return { root, directory, evidence, manifest, save, replaceArtifact };
}

test("source-bound inventory reconciles names and reasons without changing the strict eleven-artifact catalog", t => {
  const f = fixture(t);
  const original = readFileSync(join(f.evidence, "execution-manifest.json"));
  const result = writeCoverageInventory(f);
  const byPath = new Map(result.files.map(file => [file.path, file]));
  assert.deepEqual(result.source, f.manifest.source);
  assert.equal(result.execution.sha256, hash(original));
  assert.equal(
    result.inputs.find(item => item.path === "vitest.config.ts").sha256,
    f.manifest.source.configSha256
  );
  assert.equal(
    result.inputs.find(item => item.path.endsWith("partition-manifest.json"))
      .sha256,
    f.manifest.artifacts.find(item =>
      item.path.endsWith("partition-manifest.json")
    ).sha256
  );
  assert.deepEqual(
    result.files
      .filter(file => file.status === "measured")
      .map(file => file.path)
      .sort(),
    [...MEASURED].sort()
  );
  assert.equal(result.reconciliation.eligible, MEASURED.length);
  assert.equal(result.reconciliation.measured, MEASURED.length);
  assert.equal(result.reconciliation.excluded, 5);
  assert.deepEqual(result.reconciliation.missing, []);
  assert.deepEqual(result.reconciliation.unexpected, []);
  assert.equal(byPath.get("README.md").status, "outside_include");
  assert.equal(
    byPath.get("server/service.ts").gitObject,
    git(f.root, "rev-parse", "HEAD:server/service.ts")
  );
  assert.deepEqual(byPath.get("server/__tests__/service.test.ts").exclusions, [
    { pattern: "**/*.test.ts", reasonId: "test-source" },
    { pattern: "**/__tests__/**", reasonId: "test-source" },
  ]);
  assert.equal(
    byPath.get("server/types.d.ts").exclusions[0].reasonId,
    "type-declaration"
  );
  assert.equal(
    byPath.get("server/dist/generated.ts").exclusions[0].reasonId,
    "build-output"
  );
  assert.ok(
    result.interpretation.exclusions.every(rule => rule.reason.length > 10)
  );
  assert.deepEqual(verifyCoverageInventory(f), result);
  assert.deepEqual(
    readFileSync(join(f.evidence, "execution-manifest.json")),
    original
  );
  assert.equal(
    f.manifest.artifacts.length,
    7 + COVERAGE_PARTITION_FILES.length
  );
  assert.ok(!f.manifest.artifacts.some(item => item.path === INVENTORY_FILE));
  assert.equal(
    verifyCoverageUpload({
      ...f,
      env: {
        GITHUB_SHA: f.manifest.source.commit,
        GITHUB_REPOSITORY: "fixture/repository",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
      },
    }).source.commit,
    f.manifest.source.commit
  );
});

test("an eligible source absent from LCOV cannot disappear from the inventory", t => {
  const f = fixture(t, {
    extraSources: { "server/unmeasured.ts": "export const missing = true;\n" },
  });
  assert.throws(
    () => buildCoverageInventory(f),
    error =>
      error.code === "COVERAGE_SCOPE_MEASURED_SOURCE_MISMATCH" &&
      error.message.includes("server/unmeasured.ts")
  );
});

for (const source of [
  "server/untracked.ts",
  "server/__tests__/service.test.ts",
]) {
  test(`rejects a measured source that is not eligible: ${source}`, t => {
    const f = fixture(t, { measured: [...MEASURED, source] });
    assert.throws(
      () => buildCoverageInventory(f),
      error =>
        error.code === "COVERAGE_SCOPE_MEASURED_SOURCE_MISMATCH" &&
        error.message.includes(source)
    );
  });
}

test("an unknown exclusion needs a reason even when it excludes no tracked file", t => {
  const f = fixture(t, {
    config: CONFIG.replace(
      '"**/*.d.ts",',
      '"**/*.d.ts", "**/unknown-policy/**",'
    ),
  });
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_UNKNOWN_EXCLUSION_REASON",
  });
});

test("dynamic, merged and conditional coverage configs fail closed", () => {
  for (const config of [
    CONFIG.replace('"server/**/*.ts",', "...externalIncludes,"),
    CONFIG.replace('"server/**/*.ts",', "process.env.COVERAGE_INCLUDE,"),
    CONFIG.replace("coverage: {", "coverage: { ...overrides,"),
    CONFIG.replace(
      "return {",
      "if (mode === 'changed') return alternate; return {"
    ),
    CONFIG.replace("coverage: {", "coverage: externalCoverage, ignored: {"),
    CONFIG.replace("({ mode })", "({ mode, templateRoot })"),
  ])
    assert.throws(() => readCoverageScope(config), {
      code: "COVERAGE_SCOPE_DYNAMIC_CONFIG",
    });
});

test("an unsupported coverage option cannot silently alter the source scope", () => {
  assert.throws(
    () => readCoverageScope(CONFIG.replace('provider: "v8"', "provider: v8")),
    { code: "COVERAGE_SCOPE_UNSUPPORTED_CONFIG" }
  );
  for (const addition of [
    "allowExternal: true,",
    "excludeAfterRemap: true,",
    "ignoreEmptyLines: true,",
  ])
    assert.throws(
      () =>
        readCoverageScope(
          CONFIG.replace("coverage: {", `coverage: { ${addition}`)
        ),
      { code: "COVERAGE_SCOPE_UNSUPPORTED_CONFIG" }
    );
});

test("binds the inventory to actual HEAD and a clean tree", t => {
  const f = fixture(t);
  f.manifest.source.commit = "0".repeat(40);
  f.save();
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_SOURCE_MISMATCH",
  });
  f.manifest.source.commit = git(f.root, "rev-parse", "HEAD");
  f.manifest.source.tree = "0".repeat(40);
  f.save();
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_SOURCE_MISMATCH",
  });
  f.manifest.source.tree = git(f.root, "rev-parse", "HEAD^{tree}");
  f.save();
  writeFileSync(
    join(f.root, "server/service.ts"),
    "export const changed = true;\n"
  );
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_SOURCE_MISMATCH",
  });
});

test("a rehashed config artifact still has to match the source tree and manifest scope", t => {
  const f = fixture(t);
  f.replaceArtifact(
    "vitest.config.ts",
    CONFIG.replace('"**/*.d.ts",', '"**/*.d.ts", "**/unknown/**",')
  );
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_INPUT_MISMATCH",
  });
});

test("partition names must come from LCOV even if someone updates the partition artifact hash", t => {
  const f = fixture(t);
  const path = "coverage/codecov/partition-manifest.json";
  const altered = JSON.parse(readFileSync(join(f.evidence, path)));
  altered.partitions[0].files[0].source = "server/forged.ts";
  f.replaceArtifact(path, json(altered));
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_PARTITION_MISMATCH",
  });
});

test("rejects changed input bytes and a changed sidecar, and never overwrites a previous sidecar", t => {
  const f = fixture(t);
  const output = writeCoverageInventory(f);
  assert.throws(() => writeCoverageInventory(f), { code: "EEXIST" });
  output.files.find(file => file.status === "excluded").exclusions = [];
  writeFileSync(join(f.evidence, INVENTORY_FILE), json(output));
  assert.throws(() => verifyCoverageInventory(f), {
    code: "COVERAGE_SCOPE_INVENTORY_MISMATCH",
  });
  writeFileSync(join(f.evidence, "coverage/lcov.info"), "changed\n");
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_ARTIFACT_MISMATCH",
  });
});

test("a different provider/runtime cannot reuse this inventory interpretation", t => {
  const f = fixture(t);
  f.manifest.runtime.vitest = "0.0.0";
  f.save();
  assert.throws(() => buildCoverageInventory(f), {
    code: "COVERAGE_SCOPE_RUNTIME_MISMATCH",
  });
});
