import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = {
  entries: Array<{ idx: number; tag: string }>;
};

const repoRoot = process.cwd();
const drizzleDir = resolve(repoRoot, "drizzle");
const journalPath = resolve(drizzleDir, "meta/_journal.json");

describe("Drizzle migration journal parity", () => {
  it("keeps every executable SQL migration journaled exactly once", () => {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
    const executableSql = readdirSync(drizzleDir)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    const journalSql = journal.entries.map((entry) => `${entry.tag}.sql`).sort();

    expect(executableSql).toEqual(journalSql);
    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(
      journal.entries.length,
    );
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
  });

  it("uses only the authoritative drizzle root for executable migrations", () => {
    const config = readFileSync(resolve(repoRoot, "drizzle.config.ts"), "utf8");

    expect(config).toContain('out: "./drizzle"');
    expect(existsSync(resolve(drizzleDir, "migrations"))).toBe(false);
  });
});
