// Destructive fixtures are confined to a newly created random database, never
// the database named in DATABASE_URL. Run against a disposable CI MySQL service.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { runMigration } from "./migrate";
import {
  differences,
  readDatabaseContract,
  readHistory,
  snapshotContract,
} from "./schema-contract";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is required; use a disposable MySQL service");
const admin = await createConnection(url);
const database = `ais_migration_acceptance_${randomBytes(6).toString("hex")}`;
const testUrl = new URL(url);
testUrl.pathname = `/${database}`;
let connection: Connection | undefined;
let created = false;
const directory = mkdtempSync(join(tmpdir(), "ais-migrations-"));
try {
  await admin.query(`CREATE DATABASE \`${database}\``);
  created = true;
  connection = await createConnection(testUrl.href);
  const history = readHistory();
  const final = history.at(-1);
  assert.ok(final);
  // Replay the genuine immutable 0000..0012 files and hashes, no schema push.
  const boundary = history.findIndex(
    m => m.tag === "0013_schema_reconciliation"
  );
  assert.ok(
    boundary > 0,
    "reconciliation must follow the historical migrations"
  );
  mkdirSync(join(directory, "meta"));
  writeFileSync(
    join(directory, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "mysql",
      entries: history.slice(0, boundary).map(({ idx, tag, when }) => ({
        idx,
        tag,
        when,
        version: "5",
        breakpoints: true,
      })),
    })
  );
  for (const m of history.slice(0, boundary))
    copyFileSync(
      join("drizzle", `${m.tag}.sql`),
      join(directory, `${m.tag}.sql`)
    );
  await migrate(drizzle(connection), { migrationsFolder: directory });
  assert.deepEqual(
    differences(
      snapshotContract(history[boundary - 1].snapshot),
      await readDatabaseContract(connection)
    ),
    []
  );
  await connection.query(
    "INSERT INTO users (openId, name) VALUES ('migration-sentinel', 'preserve this row')"
  );

  const fingerprint = async () => {
    assert.ok(connection);
    const [journal] = await connection.query<RowDataPacket[]>(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id"
    );
    return JSON.stringify({
      schema: await readDatabaseContract(connection),
      journal,
    });
  };
  const refusesWithoutDdl = async (reason: RegExp) => {
    const before = await fingerprint();
    await assert.rejects(runMigration("migrate", testUrl.href), reason);
    assert.equal(
      await fingerprint(),
      before,
      "refusal must not change schema or journal"
    );
  };
  await connection.query("CREATE TABLE tenants (id int PRIMARY KEY)");
  await refusesWithoutDdl(/MIGRATION_DATABASE_DRIFT/);
  await connection.query("DROP TABLE tenants");
  console.info("PASS: unjournaled existing table rejected before DDL");

  await connection.query(
    "INSERT INTO flight_reviews (userId, flightId, bookingId, rating) VALUES (1, 1, 1, 5), (1, 1, 2, 4)"
  );
  await refusesWithoutDdl(/MIGRATION_UNIQUE_CONFLICT/);
  const [duplicates] = await connection.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM flight_reviews"
  );
  assert.equal(Number(duplicates[0].n), 2, "never auto-deduplicate data");
  await connection.query("DELETE FROM flight_reviews");
  console.info("PASS: duplicate groups rejected and preserved");

  await connection.query(
    "INSERT INTO user_preferences (userId, wheelchairAssistance) VALUES (1, NULL)"
  );
  await refusesWithoutDdl(/MIGRATION_NULL_CONFLICT/);
  await connection.query("DELETE FROM user_preferences");
  console.info("PASS: nullable legacy values rejected before NOT NULL DDL");

  await connection.query(
    "UPDATE __drizzle_migrations SET hash = REPEAT('0', 64) WHERE id = 1"
  );
  await refusesWithoutDdl(/MIGRATION_HISTORY_MISMATCH/);
  await connection.query(
    "UPDATE __drizzle_migrations SET hash = ? WHERE id = 1",
    [history[0].hash]
  );
  console.info("PASS: changed historical hash rejected");

  const lockName = `ais:migrate:${createHash("sha256").update(database).digest("hex").slice(0, 40)}`;
  await connection.query("SELECT GET_LOCK(?, 0)", [lockName]);
  await refusesWithoutDdl(/MIGRATION_LOCK_BUSY/);
  await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
  console.info("PASS: concurrent migrator rejected");

  // MySQL UNIQUE permits multiple rows with NULL in any indexed column.
  await connection.query(
    "INSERT INTO favorite_flights (userId, originId, destinationId, airlineId) VALUES (1, 1, 2, NULL), (1, 1, 2, NULL)"
  );
  await runMigration("preflight", testUrl.href);
  await runMigration("migrate", testUrl.href);
  await runMigration("verify", testUrl.href);
  const [sentinel] = await connection.query<RowDataPacket[]>(
    "SELECT name FROM users WHERE openId = 'migration-sentinel'"
  );
  assert.deepEqual(
    sentinel.map(r => r.name),
    ["preserve this row"]
  );
  const [favorites] = await connection.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM favorite_flights"
  );
  assert.equal(Number(favorites[0].n), 2);
  const after = await fingerprint();
  await runMigration("migrate", testUrl.href);
  assert.equal(await fingerprint(), after);
  console.info(
    "PASS: populated upgrade, NULL uniqueness semantics, row preservation and idempotent replay"
  );

  await connection.query("DROP INDEX user_flight_unique ON flight_reviews");
  await connection.query(
    "CREATE INDEX user_flight_unique ON flight_reviews (userId, flightId)"
  );
  await assert.rejects(
    runMigration("verify", testUrl.href),
    /MIGRATION_DATABASE_DRIFT/
  );
  await connection.query("DROP INDEX user_flight_unique ON flight_reviews");
  await connection.query(
    "CREATE UNIQUE INDEX user_flight_unique ON flight_reviews (userId, flightId)"
  );
  console.info("PASS: weakened physical uniqueness detected");

  await connection.query("ALTER TABLE users DROP COLUMN tenantId");
  await assert.rejects(
    runMigration("verify", testUrl.href),
    /MIGRATION_DATABASE_DRIFT/
  );
  console.info(
    "PASS: physical column drift detected despite unchanged table count"
  );
} finally {
  await connection?.end();
  if (created) await admin.query(`DROP DATABASE \`${database}\``);
  await admin.end();
  rmSync(directory, { recursive: true, force: true });
}
