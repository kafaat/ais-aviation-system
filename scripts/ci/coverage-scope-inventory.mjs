import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { partitionLcov } from "./coverage-partitions.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
// Match the installed coverage producer, not an unrelated hoisted dependency.
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const picomatch = vitestRequire("picomatch");
const versions = {
  vitest: require("vitest/package.json").version,
  coverageProvider: require("@vitest/coverage-v8/package.json").version,
  picomatch: vitestRequire("picomatch/package.json").version,
  typescript: require("typescript/package.json").version,
};
export const INVENTORY_FILE = "coverage-scope-inventory.json";
const CONFIG = "vitest.config.ts";
const LCOV = "coverage/lcov.info";
const PARTITION = "coverage/codecov/partition-manifest.json";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const fail = (code, detail) => {
  throw Object.assign(
    new Error(code + (detail ? `: ${json(detail).trim()}` : "")),
    {
      code,
    }
  );
};

// Reviewed explanations for the exclusions declared in vitest.config.ts.
// New patterns require an explicit reason here; matching zero files is not an
// excuse to silently accept an unexplained exclusion.
const REASONS = [
  {
    id: "test-source",
    reason: "Test cases and test support are outside application coverage.",
    patterns: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/tests/**",
      "**/__tests__/**",
      "**/test/**",
    ],
  },
  {
    id: "tool-configuration",
    reason:
      "Build and test tool configuration is outside application coverage.",
    patterns: [
      "**/vitest.config.ts",
      "**/vite.config.ts",
      "**/drizzle.config.ts",
      "**/tailwind.config.ts",
      "**/postcss.config.js",
    ],
  },
  {
    id: "type-declaration",
    reason: "Type declarations have no runtime implementation.",
    patterns: ["**/*.d.ts"],
  },
  {
    id: "generated-migration",
    reason:
      "Generated database migrations are excluded by the coverage configuration.",
    patterns: ["**/drizzle/migrations/**"],
  },
  {
    id: "dependency",
    reason: "Installed dependencies are not application source.",
    patterns: ["**/node_modules/**"],
  },
  {
    id: "build-output",
    reason: "Build output duplicates source and is not measured separately.",
    patterns: ["**/dist/**"],
  },
  {
    id: "test-mock",
    reason: "Test mocks are outside application coverage.",
    patterns: ["**/__mocks__/**", "**/mocks/**"],
  },
  {
    id: "test-setup",
    reason: "Test setup is outside application coverage.",
    patterns: ["**/setup.ts"],
  },
];

function properties(node) {
  if (!node || !ts.isObjectLiteralExpression(node))
    fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
  const result = new Map();
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ||
      result.has(property.name.text)
    )
      fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
    result.set(property.name.text, property.initializer);
  }
  return result;
}
function strings(node) {
  if (!node || !ts.isArrayLiteralExpression(node) || !node.elements.length)
    fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
  const values = node.elements.map(item => {
    if (
      !ts.isStringLiteral(item) ||
      !item.text ||
      /[\x00-\x1f\\]/.test(item.text)
    )
      fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
    return item.text;
  });
  if (new Set(values).size !== values.length)
    fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
  return values;
}

/** Read the declared scope without executing a potentially dynamic config. */
export function readCoverageScope(text) {
  const file = ts.createSourceFile(CONFIG, text, ts.ScriptTarget.Latest, true);
  const exports = file.statements.filter(ts.isExportAssignment);
  const imported = file.statements.some(
    node =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "vitest/config" &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        item => !item.propertyName && item.name.text === "defineConfig"
      )
  );
  if (file.parseDiagnostics.length || exports.length !== 1 || !imported)
    fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
  const call = exports[0].expression;
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "defineConfig" ||
    call.arguments.length !== 1
  )
    fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
  let object = call.arguments[0];
  const localBindings = [];
  if (ts.isArrowFunction(object) || ts.isFunctionExpression(object)) {
    localBindings.push(...object.parameters.map(parameter => parameter.name));
    object = object.body;
    if (ts.isBlock(object)) {
      const statements = [...object.statements];
      const returned = statements.pop();
      if (
        !returned ||
        !ts.isReturnStatement(returned) ||
        statements.some(item => !ts.isVariableStatement(item))
      )
        fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
      localBindings.push(
        ...statements.flatMap(statement =>
          [...statement.declarationList.declarations].map(item => item.name)
        )
      );
      object = returned.expression;
    }
  }
  const config = properties(object);
  // The repository root is the checkout directory. A different/dynamic root
  // needs a reviewed interpretation instead of silently changing the universe.
  if (config.has("root")) {
    const root = config.get("root");
    const declaration = file.statements
      .filter(ts.isVariableStatement)
      .flatMap(item => [...item.declarationList.declarations])
      .find(
        item => ts.isIdentifier(item.name) && item.name.text === "templateRoot"
      );
    if (
      !ts.isIdentifier(root) ||
      root.text !== "templateRoot" ||
      !declaration ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      localBindings.some(name => /\btemplateRoot\b/.test(name.getText(file))) ||
      declaration?.initializer?.getText(file) !==
        "path.resolve(import.meta.dirname)"
    )
      fail("COVERAGE_SCOPE_DYNAMIC_CONFIG");
  }
  const tests = properties(config.get("test"));
  const coverage = properties(tests.get("coverage"));
  const provider = coverage.get("provider");
  const supported = new Set([
    "provider",
    "enabled",
    "reportsDirectory",
    "reporter",
    "include",
    "exclude",
    "thresholds",
    "clean",
    "skipFull",
    "watermarks",
    "allowExternal",
    "excludeAfterRemap",
  ]);
  if (
    [...coverage.keys()].some(key => !supported.has(key)) ||
    !provider ||
    !ts.isStringLiteral(provider) ||
    provider.text !== "v8" ||
    ["allowExternal", "excludeAfterRemap", "skipFull"].some(
      key =>
        coverage.has(key) &&
        coverage.get(key).kind !== ts.SyntaxKind.FalseKeyword
    )
  )
    fail("COVERAGE_SCOPE_UNSUPPORTED_CONFIG");
  const include = strings(coverage.get("include"));
  const exclude = strings(coverage.get("exclude"));
  if (
    include.some(
      pattern =>
        /^(?:[!\/]|[a-z]:)/i.test(pattern) || pattern.split("/").includes("..")
    )
  )
    fail("COVERAGE_SCOPE_UNSUPPORTED_CONFIG");
  const exclusions = exclude.map(pattern => {
    const entry = REASONS.find(reason => reason.patterns.includes(pattern));
    if (!entry) fail("COVERAGE_SCOPE_UNKNOWN_EXCLUSION_REASON", pattern);
    return { pattern, reasonId: entry.id, reason: entry.reason };
  });
  return { include, exclusions };
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) fail("COVERAGE_SCOPE_GIT_UNAVAILABLE");
  return result.stdout;
}
function read(directory, name) {
  if (
    typeof name !== "string" ||
    /[\\\x00-\x1f]/.test(name) ||
    name.split("/").some(part => !part || part === "." || part === "..")
  )
    fail("COVERAGE_SCOPE_UNSAFE_ARTIFACT");
  const path = join(directory, name);
  if (!lstatSync(path).isFile() || realpathSync(path) !== path)
    fail("COVERAGE_SCOPE_UNSAFE_ARTIFACT");
  return readFileSync(path);
}

/** Reconcile source names, not percentages; never change the producer's reports. */
export function buildCoverageInventory({ root = process.cwd(), directory }) {
  const checkout = realpathSync(resolve(root));
  const evidence = resolve(checkout, directory);
  if (realpathSync(evidence) !== evidence || !lstatSync(evidence).isDirectory())
    fail("COVERAGE_SCOPE_UNSAFE_ARTIFACT");
  const manifestBytes = read(evidence, "execution-manifest.json");
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== "passed" ||
    manifest.result?.exitCode !== 0 ||
    manifest.result?.wrapperExitCode !== 0 ||
    manifest.result?.signal !== null ||
    manifest.result?.startupError !== null ||
    manifest.result?.interruptedBy !== null ||
    manifest.result?.evidenceErrors?.length !== 0
  )
    fail("COVERAGE_SCOPE_UNSUCCESSFUL_RUN");
  if (
    manifest.source?.commit !== git(checkout, ["rev-parse", "HEAD"]).trim() ||
    manifest.source?.tree !==
      git(checkout, ["rev-parse", "HEAD^{tree}"]).trim() ||
    manifest.source?.dirty !== false ||
    (manifest.ci?.checkoutSha != null &&
      manifest.ci.checkoutSha !== manifest.source.commit) ||
    git(checkout, ["status", "--porcelain"]) !== ""
  )
    fail("COVERAGE_SCOPE_SOURCE_MISMATCH");
  for (const [field, path] of [
    ["configSha256", CONFIG],
    ["packageSha256", "package.json"],
    ["lockSha256", "pnpm-lock.yaml"],
  ]) {
    const source = git(checkout, ["show", `${manifest.source.tree}:${path}`]);
    if (
      manifest.source[field] !== hash(source) ||
      manifest.source[field] !== hash(read(checkout, path))
    )
      fail("COVERAGE_SCOPE_INPUT_MISMATCH", path);
  }
  if (
    manifest.runtime?.coverageProvider !== "v8" ||
    manifest.runtime?.vitest !== versions.vitest ||
    manifest.runtime?.coverageProviderVersion !== versions.coverageProvider
  )
    fail("COVERAGE_SCOPE_RUNTIME_MISMATCH");
  const artifacts = new Map();
  if (!Array.isArray(manifest.artifacts))
    fail("COVERAGE_SCOPE_ARTIFACT_MISMATCH");
  for (const artifact of manifest.artifacts) {
    if (artifacts.has(artifact.path)) fail("COVERAGE_SCOPE_ARTIFACT_MISMATCH");
    const bytes = read(evidence, artifact.path);
    if (bytes.length !== artifact.bytes || hash(bytes) !== artifact.sha256)
      fail("COVERAGE_SCOPE_ARTIFACT_MISMATCH", artifact.path);
    artifacts.set(artifact.path, bytes);
  }
  for (const path of [CONFIG, LCOV, PARTITION])
    if (!artifacts.has(path)) fail("COVERAGE_SCOPE_MISSING_ARTIFACT", path);
  if (hash(artifacts.get(CONFIG)) !== manifest.source.configSha256)
    fail("COVERAGE_SCOPE_INPUT_MISMATCH", CONFIG);
  const scope = readCoverageScope(artifacts.get(CONFIG).toString("utf8"));
  const plan = partitionLcov(artifacts.get(LCOV));
  if (!artifacts.get(PARTITION).equals(Buffer.from(json(plan.manifest))))
    fail("COVERAGE_SCOPE_PARTITION_MISMATCH");
  const measured = new Map();
  for (const partition of plan.manifest.partitions) {
    if (!artifacts.get(partition.path)?.equals(plan.reports[partition.flag]))
      fail("COVERAGE_SCOPE_PARTITION_MISMATCH");
    for (const file of partition.files)
      measured.set(file.source, {
        partition: partition.flag,
        record: file.index,
        sha256: file.sha256,
      });
  }
  const entries = git(checkout, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    manifest.source.tree,
  ])
    .split("\0")
    .filter(Boolean)
    .map(entry => {
      const match =
        /^(\d+) (blob|commit) ([a-f0-9]{40})\t([^\x00-\x1f]+)$/.exec(entry);
      if (!match) fail("COVERAGE_SCOPE_UNSUPPORTED_SOURCE");
      return { path: match[4], gitObject: match[3], mode: match[1] };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const eligible = new Set();
  const files = entries.map(entry => {
    // Same picomatch options as Vitest 4's BaseCoverageProvider.isIncluded.
    const absolute = resolve(checkout, entry.path).replaceAll("\\", "/");
    const matches = pattern =>
      picomatch.isMatch(absolute, pattern, { contains: true, dot: true });
    const includes = scope.include.filter(matches);
    const exclusions = includes.length
      ? scope.exclusions.filter(rule => matches(rule.pattern))
      : [];
    let status = "outside_include";
    if (includes.length) {
      status = exclusions.length ? "excluded" : "measured";
      if (!exclusions.length) {
        if (!["100644", "100755"].includes(entry.mode))
          fail("COVERAGE_SCOPE_UNSUPPORTED_SOURCE", entry.path);
        eligible.add(entry.path);
      }
    }
    return {
      ...entry,
      status,
      includePatterns: includes,
      exclusions: exclusions.map(({ pattern, reasonId }) => ({
        pattern,
        reasonId,
      })),
      ...(measured.has(entry.path)
        ? { measurement: measured.get(entry.path) }
        : {}),
    };
  });
  const missing = [...eligible].filter(path => !measured.has(path));
  const unexpected = [...measured.keys()]
    .filter(path => !eligible.has(path))
    .sort();
  if (missing.length || unexpected.length)
    fail("COVERAGE_SCOPE_MEASURED_SOURCE_MISMATCH", { missing, unexpected });
  return {
    schemaVersion: 1,
    source: manifest.source,
    execution: {
      path: "execution-manifest.json",
      sha256: hash(manifestBytes),
      ci: manifest.ci,
    },
    inputs: [CONFIG, LCOV, PARTITION].map(path => ({
      path,
      sha256: hash(artifacts.get(path)),
    })),
    interpretation: {
      versions,
      provider: "v8",
      matcher: "picomatch",
      matcherOptions: { contains: true, dot: true },
      include: scope.include,
      exclusions: scope.exclusions.map(rule => ({
        ...rule,
        matchedFiles: files.filter(file =>
          file.exclusions.some(item => item.pattern === rule.pattern)
        ).length,
      })),
      outsideIncludeReason:
        "Tracked path does not match a declared coverage include; it is outside the coverage denominator, not an exclusion rule.",
      note: "Exclusion matches may overlap; excluded counts below count each source once. This inventory adds no coverage or suite result.",
    },
    reconciliation: {
      tracked: files.length,
      included: files.filter(file => file.includePatterns.length).length,
      excluded: files.filter(file => file.status === "excluded").length,
      outsideInclude: files.filter(file => file.status === "outside_include")
        .length,
      eligible: eligible.size,
      measured: measured.size,
      missing,
      unexpected,
      exactMatch: true,
      partitions: plan.manifest.partitions.map(({ flag, records, sha256 }) => ({
        flag,
        records,
        sha256,
      })),
    },
    files,
  };
}

export function writeCoverageInventory(options) {
  const inventory = buildCoverageInventory(options);
  writeFileSync(
    resolve(options.root ?? process.cwd(), options.directory, INVENTORY_FILE),
    json(inventory),
    { flag: "wx" }
  );
  return inventory;
}
export function verifyCoverageInventory(options) {
  const expected = buildCoverageInventory(options);
  const bytes = read(
    realpathSync(resolve(options.root ?? process.cwd(), options.directory)),
    INVENTORY_FILE
  );
  if (!bytes.equals(Buffer.from(json(expected))))
    fail("COVERAGE_SCOPE_INVENTORY_MISMATCH");
  return expected;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (
      process.argv.length !== 4 ||
      !["write", "verify"].includes(process.argv[2])
    )
      fail(
        "USAGE: coverage-scope-inventory.mjs <write|verify> <evidence-directory>"
      );
    const operation =
      process.argv[2] === "write"
        ? writeCoverageInventory
        : verifyCoverageInventory;
    const result = operation({ directory: process.argv[3] });
    console.info(
      json({
        source: result.source,
        reconciliation: result.reconciliation,
      }).trim()
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
