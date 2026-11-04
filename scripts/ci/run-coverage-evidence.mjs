import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { constants } from "node:os";
import { pathToFileURL } from "node:url";
import {
  COVERAGE_PARTITION_FILES,
  writeCoveragePartitions,
} from "./coverage-partitions.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const readJson = path => JSON.parse(readFileSync(path, "utf8"));

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Record the actual runner and its result; never infer a pass from coverage. */
export async function runCoverage({
  root = resolve(import.meta.dirname, "../.."),
  env = process.env,
} = {}) {
  const history = join(root, "test-results/coverage-evidence");
  mkdirSync(history, { recursive: true });
  // Every attempt owns fresh paths, so failed starts cannot publish old results.
  const directory = mkdtempSync(join(history, "run-"));
  const path = name => join(directory, name);
  const reportPath = name => relative(root, path(name));
  const config = readFileSync(join(root, "vitest.config.ts"));
  writeFileSync(path("vitest.config.ts"), config);
  const packageJson = readJson(join(root, "package.json"));
  const packageVersion = name =>
    readJson(join(root, "node_modules", name, "package.json")).version;
  const command = [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--coverage",
    "--coverage.provider=v8",
    `--coverage.reportsDirectory=${reportPath("coverage")}`,
    "--reporter=default",
    "--reporter=json",
    "--reporter=junit",
    `--outputFile.json=${reportPath("vitest-results.json")}`,
    `--outputFile.junit=${reportPath("junit.xml")}`,
  ];
  const startedAt = new Date();
  const manifest = {
    schemaVersion: 1,
    status: "running",
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: null,
    source: {
      commit: git(root, ["rev-parse", "HEAD"]),
      tree: git(root, ["rev-parse", "HEAD^{tree}"]),
      dirty: git(root, ["status", "--porcelain"]) !== "",
      configSha256: hash(config),
      packageSha256: hash(readFileSync(join(root, "package.json"))),
      lockSha256: hash(readFileSync(join(root, "pnpm-lock.yaml"))),
    },
    ci: {
      repository: env.GITHUB_REPOSITORY ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      job: env.GITHUB_JOB ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
      event: env.GITHUB_EVENT_NAME ?? null,
      ref: env.GITHUB_REF ?? null,
      // For a PR, this can be the tested merge commit, not the PR's head.
      checkoutSha: env.GITHUB_SHA ?? null,
      runUrl:
        env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
          ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
          : null,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      declaredPackageManager: packageJson.packageManager ?? null,
      vitest: packageVersion("vitest"),
      coverageProvider: "v8",
      coverageProviderVersion: packageVersion("@vitest/coverage-v8"),
    },
    command: [process.execPath, ...command],
    environment: {
      nodeEnv: env.NODE_ENV ?? null,
      disposableDatabase: env.AIS_DISPOSABLE_DATABASE === "true",
      databaseConfigured: Boolean(env.DATABASE_URL),
      redisConfigured: Boolean(env.REDIS_URL),
    },
    result: null,
    tests: null,
    artifacts: [],
  };
  const save = () =>
    writeFileSync(
      path("execution-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n"
    );
  save();
  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `evidence-dir=${relative(root, directory)}\n`
    );
  }

  let interrupted = null;
  const child = spawn(process.execPath, command, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const interrupt = signal => {
    interrupted ??= signal;
    child.kill(signal);
  };
  const onTerm = () => interrupt("SIGTERM");
  const onInt = () => interrupt("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  let startupError = null;
  child.once("error", error => {
    startupError = error.code ?? "RUNNER_START_FAILED";
  });
  const result = await new Promise(resolveResult => {
    child.once("close", (exitCode, signal) =>
      resolveResult({ exitCode, signal, startupError })
    );
  });
  process.removeListener("SIGTERM", onTerm);
  process.removeListener("SIGINT", onInt);
  const evidenceErrors = [];
  try {
    const tests = readJson(path("vitest-results.json"));
    manifest.tests = {
      total: tests.numTotalTests,
      passed: tests.numPassedTests,
      failed: tests.numFailedTests,
      pending: tests.numPendingTests,
      todo: tests.numTodoTests,
      suites: tests.numTotalTestSuites,
      success: tests.success,
    };
    if (!Number.isInteger(tests.numTotalTests) || tests.numTotalTests <= 0)
      evidenceErrors.push("EMPTY_OR_INVALID_TEST_CATALOG");
    if (result.exitCode === 0 && tests.success !== true)
      evidenceErrors.push("RUNNER_REPORT_DISAGREES_WITH_EXIT");
    readJson(path("coverage/coverage-summary.json"));
  } catch {
    evidenceErrors.push("MISSING_OR_INVALID_RESULT_JSON");
  }
  for (const name of [
    "vitest.config.ts",
    "vitest-results.json",
    "junit.xml",
    "coverage/coverage-summary.json",
    "coverage/coverage-final.json",
    "coverage/lcov.info",
    "coverage/cobertura-coverage.xml",
  ]) {
    if (existsSync(path(name))) {
      const content = readFileSync(path(name));
      manifest.artifacts.push({
        path: name,
        bytes: content.length,
        sha256: hash(content),
      });
    } else {
      evidenceErrors.push(`MISSING_ARTIFACT:${name}`);
    }
  }
  const signal = interrupted ?? result.signal;
  if (
    result.exitCode === 0 &&
    !startupError &&
    !signal &&
    !evidenceErrors.length
  ) {
    try {
      writeCoveragePartitions(directory);
      for (const name of COVERAGE_PARTITION_FILES) {
        const content = readFileSync(path(name));
        manifest.artifacts.push({
          path: name,
          bytes: content.length,
          sha256: hash(content),
        });
      }
    } catch (error) {
      evidenceErrors.push(error.code ?? "COVERAGE_PARTITION_FAILED");
    }
  }
  const exitCode = signal
    ? 128 + (constants.signals[signal] ?? 1)
    : result.exitCode || (startupError || evidenceErrors.length ? 1 : 0);
  manifest.status = signal
    ? "interrupted"
    : exitCode === 0
      ? "passed"
      : "failed";
  manifest.endedAt = new Date().toISOString();
  manifest.durationMs = Date.now() - startedAt.getTime();
  manifest.result = {
    ...result,
    interruptedBy: interrupted,
    evidenceErrors,
    wrapperExitCode: exitCode,
  };
  save();
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await runCoverage();
}
