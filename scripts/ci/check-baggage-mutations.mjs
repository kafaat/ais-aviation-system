import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Run against a disposable copy of the committed tree, never mutate the checkout.
const root = resolve(import.meta.dirname, "../..");
const directory = mkdtempSync(join(tmpdir(), "ais-baggage-mutations-"));
const authority = "server/services/baggage-entitlement.service.ts";
const bagDrop = "server/services/bag-drop.service.ts";
const tests = [
  "server/__tests__/baggage-entitlement.test.ts",
  "server/__tests__/durable-operations.test.ts",
  "server/__tests__/baggage-custody.test.ts",
];
const mutations = [
  [
    "M5c booking custody guard",
    "server/services/baggage-custody.service.ts",
    "if (custody)",
    "if (false)",
  ],
  [
    "M1 funding timestamp",
    authority,
    "!ancillary.fundedAt || !ancillary.fundingReference",
    "!ancillary.fundingReference",
  ],
  [
    "M2 single piece limit",
    authority,
    "MAX_BAG_WEIGHT_GRAMS = 32000",
    "MAX_BAG_WEIGHT_GRAMS = 42000",
  ],
  [
    "M3 passenger scope",
    authority,
    "if (ancillary.passengerId !== args.passengerId) continue;",
    "// passenger filter removed",
  ],
  [
    "M4 segment scope",
    authority,
    "if (ancillary.segmentId !== args.segmentId) continue;",
    "// segment filter removed",
  ],
  [
    "M5a weighing revalidation",
    bagDrop,
    "await refreshSessionEntitlement(tx, session);",
    "// session revalidation removed",
    0,
  ],
  [
    "M5b confirmation revalidation",
    bagDrop,
    "await refreshSessionEntitlement(tx, session);",
    "// session revalidation removed",
    1,
  ],
];
function run() {
  const report = join(directory, "result.json");
  rmSync(report, { force: true });
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      ...tests,
      "--reporter=json",
      `--outputFile=${report}`,
    ],
    { cwd: directory, encoding: "utf8", timeout: 120000 }
  );
  if (result.error || result.signal)
    throw new Error("Test runner did not complete");
  const data = JSON.parse(readFileSync(report, "utf8"));
  const assertions = data.testResults.flatMap(suite => suite.assertionResults);
  if (assertions.length !== data.numTotalTests)
    throw new Error("Test collection failed; this is not a mutation kill");
  if (!data.numTotalTests || data.numPendingTests || data.numTodoTests)
    throw new Error(
      "Incomplete test collection cannot establish mutation evidence"
    );
  return {
    exit: result.status,
    passed: data.numPassedTests,
    failed: assertions.filter(assertion => assertion.status === "failed")
      .length,
    total: data.numTotalTests,
  };
}
try {
  const archive = spawnSync("git", ["archive", "HEAD"], {
    cwd: root,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (archive.status !== 0)
    throw new Error("Cannot archive committed baseline");
  const extract = spawnSync("tar", ["-x", "-C", directory], {
    input: archive.stdout,
  });
  if (extract.status !== 0) throw new Error("Cannot extract baseline");
  symlinkSync(
    join(root, "node_modules"),
    join(directory, "node_modules"),
    "dir"
  );
  const baseline = run();
  if (baseline.exit !== 0 || baseline.failed)
    throw new Error("Baseline must pass before mutation testing");
  console.log(JSON.stringify({ name: "baseline", ...baseline }));
  let survived = false;
  for (const [name, file, before, after, occurrence = 0] of mutations) {
    const path = join(directory, file);
    const original = readFileSync(path, "utf8");
    if (!original.includes(before))
      throw new Error(`Mutation target changed: ${name}`);
    const parts = original.split(before);
    if (parts.length <= occurrence + 1)
      throw new Error(`Mutation occurrence changed: ${name}`);
    writeFileSync(
      path,
      parts.slice(0, occurrence + 1).join(before) +
        after +
        parts.slice(occurrence + 1).join(before)
    );
    let outcome;
    try {
      outcome = run();
    } finally {
      writeFileSync(path, original);
    }
    if (outcome.total !== baseline.total)
      throw new Error(`Collection changed: ${name}`);
    const killed = outcome.exit !== 0 && outcome.failed > 0;
    console.log(JSON.stringify({ name, killed, ...outcome }));
    survived ||= !killed;
  }
  process.exitCode = survived ? 1 : 0;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
