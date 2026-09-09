import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from "mysql2/promise";
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
  type Contract,
  type Migration,
} from "./schema-contract";
import { assertSnapshotMatchesSchema } from "./snapshot-check";

export type MigrationCommand = "migrate" | "preflight" | "verify" | "baseline";

/**
 * Adopt a database that already carries the final schema but has no journal,
 * typically one provisioned by `drizzle-kit push` before the migration history
 * became authoritative. Journal rows are written; no application DDL is emitted.
 *
 * The adoption is refused unless the live schema matches the final snapshot
 * exactly, in both directions, so an adopted database is indistinguishable from
 * one built by replaying every migration. A database that differs in any object
 * must be reconciled from its actual state first: this never rewrites history,
 * never creates or alters application objects, and never repairs data.
 *
 * The rows and the checks that accept them share one transaction. A partially
 * written journal would be worse than no journal at all: `baseline` would then
 * refuse the retry as already journaled, and `migrate` would read the surviving
 * rows as the applied point and reject the schema as drift, leaving the database
 * adoptable by neither command. Any failure therefore rolls back to an empty
 * journal, which is exactly the state the operator started from.
 */
export async function adoptJournal(
  connection: Connection,
  history: Migration[],
  applied: number,
  actual: Contract,
  target: Contract
): Promise<void> {
  if (applied !== 0)
    throw new Error(
      `BASELINE_ALREADY_JOURNALED: ${applied} journaled migration(s); baseline only adopts an unjournaled database`
    );
  const gaps = differences(target, actual);
  if (gaps.length)
    throw new Error(
      `BASELINE_SCHEMA_MISMATCH: no DDL executed; the database must already match the final snapshot exactly\n${gaps.join("\n")}`
    );
  // MySQL commits implicitly on DDL, so the journal table is created before the
  // transaction opens. An empty journal table is indistinguishable from none:
  // appliedMigrationCount reads zero rows, so a rolled-back attempt stays
  // adoptable.
  await connection.query(
    "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id serial primary key, hash text not null, created_at bigint)"
  );
  await connection.beginTransaction();
  try {
    for (const migration of history)
      await connection.query(
        "INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)",
        [migration.hash, migration.when]
      );
    const adopted = await appliedMigrationCount(connection, history);
    if (adopted !== history.length)
      throw new Error(`BASELINE_INCOMPLETE: ${adopted}/${history.length}`);
    const after = differences(target, await readDatabaseContract(connection));
    if (after.length)
      throw new Error(`BASELINE_RESULT_DRIFT:\n${after.join("\n")}`);
    await connection.commit();
    console.info(
      JSON.stringify({
        command: "baseline",
        adopted,
        tables: Object.keys(target).length,
        result: "PASS",
      })
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

export async function runMigration(
  command: MigrationCommand,
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
    const target = snapshotContract(latest.snapshot);
    // Adoption is evaluated before the drift guard: an unjournaled database is
    // entirely "drift" by definition, so the guard below can never see it.
    if (command === "baseline") {
      await adoptJournal(connection, history, applied, actual, target);
      return;
    }
    const expected = applied
      ? snapshotContract(history[applied - 1].snapshot)
      : {};
    const drift = differences(expected, actual);
    if (drift.length)
      throw new Error(
        `MIGRATION_DATABASE_DRIFT: no DDL executed; reconcile unjournaled objects first\n${drift.join("\n")}`
      );
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
  if (
    !url ||
    !["migrate", "preflight", "verify", "baseline"].includes(command)
  ) {
    console.error(
      "Usage: DATABASE_URL=... tsx scripts/db/migrate.ts migrate|preflight|verify|baseline"
    );
    process.exitCode = 1;
  } else {
    runMigration(command as MigrationCommand, url).catch(error => {
      console.error(
        error instanceof Error
          ? error.message.replaceAll(url, "[DATABASE_URL]")
          : "Migration failed"
      );
      process.exitCode = 1;
    });
  }
}
