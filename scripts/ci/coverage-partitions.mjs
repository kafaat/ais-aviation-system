import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCOPES = [
  { flag: "server", prefix: "server/" },
  { flag: "client", prefix: "client/src/" },
  { flag: "shared", prefix: "shared/" },
];
const DIRECTORY = "coverage/codecov";
const INPUT = "coverage/lcov.info";
const PARTITION_MANIFEST = `${DIRECTORY}/partition-manifest.json`;
const COUNTERS = ["FNF", "FNH", "LF", "LH", "BRF", "BRH"];
const BASE_FILES = [
  "vitest.config.ts",
  "vitest-results.json",
  "junit.xml",
  "coverage/coverage-summary.json",
  "coverage/coverage-final.json",
  INPUT,
  "coverage/cobertura-coverage.xml",
];
export const COVERAGE_PARTITION_FILES = [
  ...SCOPES.map(({ flag }) => `${DIRECTORY}/${flag}.lcov.info`),
  PARTITION_MANIFEST,
];

const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const totals = () => Object.fromEntries(COUNTERS.map(key => [key, 0]));
const fail = code => {
  throw Object.assign(new Error(code), { code });
};
function integer(value, positive = false) {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail("LCOV_INVALID_NUMBER");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (positive && number === 0))
    fail("LCOV_INVALID_NUMBER");
  return number;
}
function addTotals(target, source) {
  for (const key of COUNTERS) {
    target[key] += source[key];
    if (!Number.isSafeInteger(target[key])) fail("LCOV_COUNTER_OVERFLOW");
  }
}
function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// Accept the pinned Istanbul producer's LCOV record shape. Unsupported input
// fails explicitly instead of silently dropping a field or changing counters.
function record(raw, index) {
  const lines = raw.replace(/\r?\n$/, "").split(/\r?\n/);
  if (lines.pop() !== "end_of_record") fail("LCOV_INCOMPLETE_RECORD");
  let source;
  let testName = false;
  const summary = {};
  const actual = totals();
  const functions = new Map();
  const functionHits = new Map();
  const seenLines = new Set();
  const seenBranches = new Set();
  for (const [position, line] of lines.entries()) {
    if (!line || /[\u0000-\u001f\u007f]/.test(line))
      fail("LCOV_INVALID_RECORD_LINE");
    const colon = line.indexOf(":");
    if (colon < 1) fail("LCOV_INVALID_RECORD_LINE");
    const tag = line.slice(0, colon);
    const value = line.slice(colon + 1);
    if (tag === "TN") {
      if (position !== 0 || testName) fail("LCOV_INVALID_TEST_NAME");
      testName = true;
    } else if (tag === "SF") {
      if (source || position !== (testName ? 1 : 0))
        fail("LCOV_INVALID_SOURCE_RECORD");
      if (
        !value ||
        value.trim() !== value ||
        /[\\:]/.test(value) ||
        value.split("/").some(part => !part || part === "." || part === "..")
      )
        fail("LCOV_INVALID_SOURCE_PATH");
      source = value;
    } else {
      if (!source) fail("LCOV_MISSING_SOURCE");
      if (COUNTERS.includes(tag)) {
        if (Object.hasOwn(summary, tag)) fail("LCOV_DUPLICATE_COUNTER");
        summary[tag] = integer(value);
      } else if (tag === "FN" || tag === "FNDA") {
        const separator = value.indexOf(",");
        if (separator < 1 || separator === value.length - 1)
          fail("LCOV_INVALID_FUNCTION");
        const amount = integer(value.slice(0, separator), tag === "FN");
        const name = value.slice(separator + 1);
        if (tag === "FN") {
          actual.FNF++;
          increment(functions, name);
        } else {
          if (amount > 0) actual.FNH++;
          increment(functionHits, name);
        }
      } else if (tag === "DA") {
        const fields = value.split(",");
        if (fields.length !== 2) fail("LCOV_INVALID_LINE");
        const number = integer(fields[0], true);
        const hits = integer(fields[1]);
        if (seenLines.has(number)) fail("LCOV_DUPLICATE_LINE");
        seenLines.add(number);
        actual.LF++;
        if (hits > 0) actual.LH++;
      } else if (tag === "BRDA") {
        const fields = value.split(",");
        if (fields.length !== 4) fail("LCOV_INVALID_BRANCH");
        integer(fields[0], true);
        integer(fields[1]);
        integer(fields[2]);
        const hits = fields[3] === "-" ? 0 : integer(fields[3]);
        const key = fields.slice(0, 3).join(",");
        if (seenBranches.has(key)) fail("LCOV_DUPLICATE_BRANCH");
        seenBranches.add(key);
        actual.BRF++;
        if (hits > 0) actual.BRH++;
      } else fail("LCOV_UNSUPPORTED_FIELD");
    }
  }
  if (!source) fail("LCOV_MISSING_SOURCE");
  if (
    functions.size !== functionHits.size ||
    [...functions].some(([name, count]) => functionHits.get(name) !== count)
  )
    fail("LCOV_FUNCTION_COUNTER_MISMATCH");
  if (COUNTERS.some(key => summary[key] !== actual[key]))
    fail("LCOV_COUNTER_MISMATCH");
  const scope = SCOPES.find(({ prefix }) => source.startsWith(prefix));
  if (!scope) fail("LCOV_UNASSIGNED_SOURCE");
  const bytes = Buffer.from(raw, "utf8");
  return {
    flag: scope.flag,
    raw: bytes,
    totals: actual,
    file: { index, source, bytes: bytes.length, sha256: hash(bytes) },
  };
}

/** Split complete raw records, never regenerate coverage counters or paths. */
export function partitionLcov(input) {
  const bytes = Buffer.from(input);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) fail("LCOV_INVALID_UTF8");
  const records = [];
  const sources = new Set();
  let offset = 0;
  for (const match of text.matchAll(/^end_of_record(?:\r?\n|$)/gm)) {
    const end = match.index + match[0].length;
    const parsed = record(text.slice(offset, end), records.length);
    if (sources.has(parsed.file.source)) fail("LCOV_DUPLICATE_SOURCE");
    sources.add(parsed.file.source);
    records.push(parsed);
    offset = end;
  }
  if (!records.length || offset !== text.length) fail("LCOV_INCOMPLETE_REPORT");
  const inputTotals = totals();
  const reports = {};
  const partitions = SCOPES.map(({ flag, prefix }) => {
    const selected = records.filter(item => item.flag === flag);
    const counts = totals();
    for (const item of selected) addTotals(counts, item.totals);
    // Empty/type-only records are retained within a measured scope. An absent
    // or entirely unmeasured scope cannot masquerade as a complete upload set.
    if (!selected.length || counts.LF + counts.BRF === 0)
      fail("LCOV_EMPTY_SCOPE");
    const content = Buffer.concat(selected.map(item => item.raw));
    reports[flag] = content;
    addTotals(inputTotals, counts);
    return {
      flag,
      prefix,
      path: `${DIRECTORY}/${flag}.lcov.info`,
      bytes: content.length,
      sha256: hash(content),
      records: selected.length,
      totals: counts,
      files: selected.map(item => item.file),
    };
  });
  return {
    reports,
    manifest: {
      schemaVersion: 1,
      input: {
        path: INPUT,
        bytes: bytes.length,
        sha256: hash(bytes),
        records: records.length,
        totals: inputTotals,
      },
      partitions,
    },
  };
}

function verifySummary(plan, summary) {
  for (const [metric, found, hit] of [
    ["lines", "LF", "LH"],
    ["functions", "FNF", "FNH"],
    ["branches", "BRF", "BRH"],
  ]) {
    if (
      summary?.total?.[metric]?.total !== plan.manifest.input.totals[found] ||
      summary?.total?.[metric]?.covered !== plan.manifest.input.totals[hit]
    )
      fail("LCOV_SUMMARY_MISMATCH");
  }
}

export function writeCoveragePartitions(directory) {
  const plan = partitionLcov(readFileSync(join(directory, INPUT)));
  verifySummary(
    plan,
    JSON.parse(readFileSync(join(directory, "coverage/coverage-summary.json")))
  );
  // Validate every record before creating anything. Existing output is never
  // overwritten; each wrapper attempt already owns a fresh evidence directory.
  mkdirSync(join(directory, DIRECTORY));
  for (const partition of plan.manifest.partitions)
    writeFileSync(
      join(directory, partition.path),
      plan.reports[partition.flag],
      {
        flag: "wx",
      }
    );
  writeFileSync(join(directory, PARTITION_MANIFEST), json(plan.manifest), {
    flag: "wx",
  });
  return plan.manifest;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) fail("COVERAGE_CHECKOUT_UNAVAILABLE");
  return result.stdout.trim();
}
function readEvidence(directory, file) {
  const path = join(directory, file);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path)
    fail("COVERAGE_UNSAFE_ARTIFACT");
  return readFileSync(path);
}
function canonicalJson(bytes) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (!bytes.equals(Buffer.from(json(value))))
    fail("COVERAGE_NONCANONICAL_JSON");
  return value;
}

/** Verify the complete downloaded set before an OIDC-capable upload begins. */
export function verifyCoverageUpload({
  root = process.cwd(),
  directory,
  env = process.env,
}) {
  if (
    typeof directory !== "string" ||
    !/^test-results\/coverage-evidence\/run-[A-Za-z0-9_-]+$/.test(directory)
  )
    fail("COVERAGE_INVALID_DIRECTORY");
  const checkout = realpathSync(resolve(root));
  const evidence = join(checkout, directory);
  if (!lstatSync(evidence).isDirectory() || realpathSync(evidence) !== evidence)
    fail("COVERAGE_UNSAFE_DIRECTORY");
  const manifest = canonicalJson(
    readEvidence(evidence, "execution-manifest.json")
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== "passed" ||
    manifest.result?.exitCode !== 0 ||
    manifest.result?.wrapperExitCode !== 0 ||
    manifest.result?.signal !== null ||
    manifest.result?.startupError !== null ||
    manifest.result?.interruptedBy !== null ||
    !Array.isArray(manifest.result?.evidenceErrors) ||
    manifest.result.evidenceErrors.length !== 0 ||
    manifest.tests?.success !== true ||
    manifest.tests?.failed !== 0 ||
    !Number.isSafeInteger(manifest.tests?.total) ||
    manifest.tests.total <= 0 ||
    !Number.isSafeInteger(manifest.tests?.passed) ||
    manifest.tests.passed <= 0
  )
    fail("COVERAGE_UNSUCCESSFUL_RUN");
  const commit = git(checkout, ["rev-parse", "HEAD"]);
  const tree = git(checkout, ["rev-parse", "HEAD^{tree}"]);
  if (
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    commit !== env.GITHUB_SHA ||
    manifest.source?.commit !== commit ||
    manifest.source?.tree !== tree ||
    manifest.source?.dirty !== false ||
    git(checkout, ["status", "--porcelain"]) !== ""
  )
    fail("COVERAGE_SOURCE_MISMATCH");
  for (const [field, file] of [
    ["configSha256", "vitest.config.ts"],
    ["packageSha256", "package.json"],
    ["lockSha256", "pnpm-lock.yaml"],
  ]) {
    if (manifest.source[field] !== hash(readFileSync(join(checkout, file))))
      fail("COVERAGE_INPUT_MISMATCH");
  }
  for (const [field, name] of [
    ["repository", "GITHUB_REPOSITORY"],
    ["runId", "GITHUB_RUN_ID"],
    ["checkoutSha", "GITHUB_SHA"],
    ["event", "GITHUB_EVENT_NAME"],
    ["ref", "GITHUB_REF"],
  ]) {
    if (!env[name] || manifest.ci?.[field] !== env[name])
      fail("COVERAGE_CI_MISMATCH");
  }
  if (env.GITHUB_EVENT_NAME.startsWith("pull_request"))
    fail("COVERAGE_PULL_REQUEST_UPLOAD_FORBIDDEN");
  const originalAttempt = integer(manifest.ci?.runAttempt ?? "", true);
  const uploadAttempt = integer(env.GITHUB_RUN_ATTEMPT ?? "", true);
  // A job-only rerun legitimately reuses this run's successful earlier tests.
  if (originalAttempt > uploadAttempt) fail("COVERAGE_ATTEMPT_MISMATCH");
  const expected = [...BASE_FILES, ...COVERAGE_PARTITION_FILES];
  if (
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== expected.length ||
    new Set(manifest.artifacts.map(item => item.path)).size !== expected.length
  )
    fail("COVERAGE_ARTIFACT_CATALOG_MISMATCH");
  const files = {};
  for (const item of manifest.artifacts) {
    if (!expected.includes(item.path))
      fail("COVERAGE_ARTIFACT_CATALOG_MISMATCH");
    const content = readEvidence(evidence, item.path);
    if (item.bytes !== content.length || item.sha256 !== hash(content))
      fail("COVERAGE_ARTIFACT_MISMATCH");
    files[item.path] = content;
  }
  if (
    !files["vitest.config.ts"].equals(
      readFileSync(join(checkout, "vitest.config.ts"))
    )
  )
    fail("COVERAGE_INPUT_MISMATCH");
  const result = JSON.parse(files["vitest-results.json"]);
  for (const [field, reported] of [
    ["success", "success"],
    ["total", "numTotalTests"],
    ["passed", "numPassedTests"],
    ["failed", "numFailedTests"],
    ["pending", "numPendingTests"],
    ["todo", "numTodoTests"],
    ["suites", "numTotalTestSuites"],
  ]) {
    if (manifest.tests[field] !== result[reported])
      fail("COVERAGE_RESULT_MISMATCH");
  }
  const plan = partitionLcov(files[INPUT]);
  verifySummary(plan, JSON.parse(files["coverage/coverage-summary.json"]));
  if (!files[PARTITION_MANIFEST].equals(Buffer.from(json(plan.manifest))))
    fail("COVERAGE_PARTITION_MANIFEST_MISMATCH");
  const tracked = new Set(git(checkout, ["ls-files", "-z"]).split("\0"));
  for (const partition of plan.manifest.partitions) {
    if (!files[partition.path].equals(plan.reports[partition.flag]))
      fail("COVERAGE_PARTITION_CONTENT_MISMATCH");
    if (partition.files.some(file => !tracked.has(file.source)))
      fail("COVERAGE_UNTRACKED_SOURCE");
  }
  return {
    source: { commit, tree },
    runId: manifest.ci.runId,
    originalRunAttempt: originalAttempt,
    uploadRunAttempt: uploadAttempt,
    input: plan.manifest.input,
    partitions: plan.manifest.partitions.map(
      ({ files: _files, ...rest }) => rest
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "verify")
      fail("USAGE: coverage-partitions.mjs verify <evidence-directory>");
    console.info(
      json(verifyCoverageUpload({ directory: process.argv[3] })).trim()
    );
  } catch (error) {
    console.error(error.code ?? "COVERAGE_VERIFICATION_FAILED");
    process.exitCode = 1;
  }
}
