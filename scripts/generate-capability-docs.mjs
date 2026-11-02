import { readFileSync, writeFileSync } from "node:fs";
import { capabilityCatalog } from "../server/services/capability-catalog.service.ts";

const start = "<!-- capability-catalog:start -->";
const end = "<!-- capability-catalog:end -->";
const escape = value => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const rows = capabilityCatalog.map(({ id, implementation, requirement }) =>
  [id, implementation, requirement].map(escape).join(" | ")
);
const block = [
  start,
  "<!-- prettier-ignore -->",
  "| Capability | Implementation | Acceptance requirement |",
  "| --- | --- | --- |",
  ...rows.map(row => `| ${row} |`),
  "",
  end,
].join("\n");
for (const file of ["README.md", "CLAUDE.md", "docs/SYSTEM_COMPARISON.md"]) {
  const current = readFileSync(file, "utf8");
  const first = current.indexOf(start);
  const last = current.indexOf(end);
  if (
    first < 0 ||
    last < first ||
    current.lastIndexOf(start) !== first ||
    current.lastIndexOf(end) !== last
  )
    throw new Error(`Invalid capability markers in ${file}`);
  const updated =
    current.slice(0, first) + block + current.slice(last + end.length);
  if (current === updated) continue;
  if (process.argv.includes("--check")) {
    console.error(`Stale capability table in ${file}`);
    process.exitCode = 1;
  } else writeFileSync(file, updated);
}
