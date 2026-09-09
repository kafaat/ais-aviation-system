import { createRequire } from "node:module";
import * as schema from "../../drizzle/schema";
import { differences, readHistory } from "./schema-contract";

// Use Drizzle's serializer, including every table re-exported by schema.ts.
const { generateMySQLDrizzleJson } = createRequire(import.meta.url)(
  "drizzle-kit/api"
) as typeof import("drizzle-kit/api");

export async function assertSnapshotMatchesSchema(): Promise<void> {
  const latest = readHistory().at(-1)?.snapshot;
  if (!latest) throw new Error("No generated snapshot found");
  const generated = await generateMySQLDrizzleJson(schema);
  const drift = differences(
    { tables: generated.tables, views: generated.views },
    { tables: latest.tables, views: latest.views }
  );
  if (drift.length)
    throw new Error(`SCHEMA_SNAPSHOT_DRIFT:\n${drift.join("\n")}`);
}

export function assertMigrationScope(
  before: { tables: Record<string, unknown>; views?: unknown },
  after: { tables: Record<string, unknown>; views?: unknown },
  scope: string[]
): void {
  const changed = [
    ...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]),
  ]
    .sort()
    .filter(t => differences(before.tables[t], after.tables[t]).length);
  if (
    JSON.stringify(changed) !== JSON.stringify([...scope].sort()) ||
    differences(before.views, after.views).length
  ) {
    throw new Error(
      `MIGRATION_SCOPE_MISMATCH: allowed=${JSON.stringify(scope)} actual=${JSON.stringify(changed)}; no migration generated`
    );
  }
}
