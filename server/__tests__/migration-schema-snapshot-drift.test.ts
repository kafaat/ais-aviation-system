import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const drizzleDir = join(root, "drizzle");
const schemaPath = join(drizzleDir, "schema.ts");
const metaDir = join(drizzleDir, "meta");

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function schemaTableNames(): string[] {
  const source = readFileSync(schemaPath, "utf8");
  const names: string[] = [];
  const pattern = /mysqlTable\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(pattern)) names.push(match[1]);
  return sortedUnique(names);
}

function latestSnapshotTableNames(): { file: string; tables: string[] } {
  const snapshots = readdirSync(metaDir)
    .filter(name => /^\d{4}_snapshot\.json$/.test(name))
    .sort();
  const file = snapshots.at(-1);
  if (!file) throw new Error("No Drizzle snapshot found");
  const snapshot = JSON.parse(readFileSync(join(metaDir, file), "utf8")) as {
    tables?: Record<string, unknown>;
  };
  return { file, tables: sortedUnique(Object.keys(snapshot.tables ?? {})) };
}

function migrationCreatedTables(): string[] {
  const names: string[] = [];
  const sqlFiles = readdirSync(drizzleDir)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const pattern =
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"]?([A-Za-z0-9_]+)[`"]?/gi;
  for (const file of sqlFiles) {
    const sql = readFileSync(join(drizzleDir, file), "utf8");
    for (const match of sql.matchAll(pattern)) names.push(match[1]);
  }
  return sortedUnique(names);
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter(value => !rightSet.has(value));
}

describe("Drizzle schema/snapshot authority", () => {
  it("keeps schema.ts, latest generated snapshot, and executable CREATE TABLE history aligned", () => {
    const schema = schemaTableNames();
    const snapshot = latestSnapshotTableNames();
    const migrations = migrationCreatedTables();

    const report = {
      schemaTableCount: schema.length,
      latestSnapshot: snapshot.file,
      snapshotTableCount: snapshot.tables.length,
      migrationCreatedTableCount: migrations.length,
      schemaMissingFromSnapshot: difference(schema, snapshot.tables),
      snapshotMissingFromSchema: difference(snapshot.tables, schema),
      schemaMissingFromCreateHistory: difference(schema, migrations),
      createHistoryMissingFromSchema: difference(migrations, schema),
    };

    expect(
      report,
      `Drizzle authority drift:\n${JSON.stringify(report, null, 2)}`
    ).toEqual(
      expect.objectContaining({
        schemaMissingFromSnapshot: [],
        snapshotMissingFromSchema: [],
        schemaMissingFromCreateHistory: [],
        createHistoryMissingFromSchema: [],
      })
    );
  });
});
