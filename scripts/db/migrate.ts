import { createConnection, type RowDataPacket } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  appliedMigrationCount,
  assertDataCompatible,
  differences,
  readDatabaseContract,
  readHistory,
  snapshotContract,
} from "./schema-contract";
import { assertSnapshotMatchesSchema } from "./snapshot-check";

export async function runMigration(
  command: "migrate" | "preflight" | "verify",
  url: string
): Promise<void> {
  const history = readHistory();
  const latest = history.at(-1);
  if (!latest) throw new Error("EMPTY_MIGRATION_HISTORY");
  await assertSnapshotMatchesSchema();
  const connection = await createConnection({
    uri: url,
    multipleStatements: false,
    connectTimeout: 10000,
  });
  let lockName: string | undefined;
  try {
    const [database] = await connection.query<RowDataPacket[]>(
      "SELECT DATABASE() AS name"
    );
    if (!database[0].name)
      throw new Error("DATABASE_URL must select a database");
    const requestedLock = `ais:migrate:${createHash("sha256").update(database[0].name).digest("hex").slice(0, 40)}`;
    const [lock] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK(?, 0) AS acquired",
      [requestedLock]
    );
    if (lock[0].acquired !== 1)
      throw new Error(
        "MIGRATION_LOCK_BUSY: another migrator holds the database lock"
      );
    lockName = requestedLock;
    const applied = await appliedMigrationCount(connection, history);
    const actual = await readDatabaseContract(connection);
    const expected = applied
      ? snapshotContract(history[applied - 1].snapshot)
      : {};
    const drift = differences(expected, actual);
    if (drift.length)
      throw new Error(
        `MIGRATION_DATABASE_DRIFT: no DDL executed; reconcile unjournaled objects first\n${drift.join("\n")}`
      );
    const target = snapshotContract(latest.snapshot);
    if (command === "verify" && applied !== history.length)
      throw new Error(`MIGRATIONS_PENDING: ${history.length - applied}`);
    await assertDataCompatible(connection, actual, target);
    console.info(
      JSON.stringify({
        command,
        applied,
        pending: history.length - applied,
        actualTables: Object.keys(actual).length,
        targetTables: Object.keys(target).length,
        preflight: "PASS",
      })
    );
    if (command !== "migrate") return;
    await migrate(drizzle(connection), { migrationsFolder: "drizzle" });
    if ((await appliedMigrationCount(connection, history)) !== history.length)
      throw new Error("MIGRATION_HISTORY_INCOMPLETE");
    const after = differences(target, await readDatabaseContract(connection));
    if (after.length)
      throw new Error(`MIGRATION_RESULT_DRIFT:\n${after.join("\n")}`);
    console.info(
      JSON.stringify({
        result: "PASS",
        applied: history.length,
        tables: Object.keys(target).length,
      })
    );
  } finally {
    try {
      if (lockName)
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
    } finally {
      await connection.end();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const command = process.argv[2] ?? "migrate";
  const url = process.env.DATABASE_URL;
  if (!url || !["migrate", "preflight", "verify"].includes(command)) {
    console.error(
      "Usage: DATABASE_URL=... tsx scripts/db/migrate.ts migrate|preflight|verify"
    );
    process.exitCode = 1;
  } else {
    runMigration(command as "migrate" | "preflight" | "verify", url).catch(
      error => {
        console.error(
          error instanceof Error
            ? error.message.replaceAll(url, "[DATABASE_URL]")
            : "Migration failed"
        );
        process.exitCode = 1;
      }
    );
  }
}
