// Export the seeded distribution capability matrix as Markdown so the
// documentation cannot drift from the data. Run with
// `node --import tsx scripts/generate-ndc-capability-matrix.ts [--check]`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderCapabilityMatrixMarkdown,
  seedDistributionCapabilities,
} from "../server/services/ndc-capability-seed";

const destination = resolve("docs/architecture/ndc-capability-matrix.md");
const rendered = renderCapabilityMatrixMarkdown(seedDistributionCapabilities);
if (process.argv.includes("--check")) {
  if (
    !existsSync(destination) ||
    readFileSync(destination, "utf8") !== rendered
  )
    throw new Error(
      "docs/architecture/ndc-capability-matrix.md is stale; run node --import tsx scripts/generate-ndc-capability-matrix.ts"
    );
  console.info("ndc capability matrix documentation is current");
} else {
  writeFileSync(destination, rendered);
  console.info(
    JSON.stringify({
      rows: seedDistributionCapabilities.length,
      file: "docs/architecture/ndc-capability-matrix.md",
    })
  );
}
