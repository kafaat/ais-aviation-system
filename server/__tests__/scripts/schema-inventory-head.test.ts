import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
it("inventory follows a new journal head and refuses a missing snapshot", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ais-schema-head-"));
  const meta = path.join(root, "drizzle/meta");
  mkdirSync(meta, { recursive: true });
  const run = () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {latestSchemaSnapshot} from ${JSON.stringify(new URL("../../../scripts/ci/schema-snapshot.mjs", import.meta.url).href)};const head=latestSchemaSnapshot(process.argv[1]);process.stdout.write(JSON.stringify({name:head.name,tables:Object.keys(head.snapshot.tables).length}));`,
          root,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      )
    );
  try {
    writeFileSync(
      path.join(meta, "_journal.json"),
      JSON.stringify({ entries: [{ idx: 31 }] })
    );
    writeFileSync(
      path.join(meta, "0031_snapshot.json"),
      JSON.stringify({ tables: { old: {} } })
    );
    expect(run()).toEqual({ name: "0031_snapshot.json", tables: 1 });
    writeFileSync(
      path.join(meta, "_journal.json"),
      JSON.stringify({ entries: [{ idx: 31 }, { idx: 32 }] })
    );
    expect(() => run()).toThrow();
    writeFileSync(
      path.join(meta, "0032_snapshot.json"),
      JSON.stringify({ tables: { old: {}, new: {} } })
    );
    expect(run()).toEqual({ name: "0032_snapshot.json", tables: 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
