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
import { adoptJournal, runMigration } from "./migrate";
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
const scratch: string[] = [];
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

  // Adoption of a database that already carries the final schema but was never
  // journaled, which is the shape left behind by `drizzle-kit push`. Both
  // fixtures are built by replaying every migration and then discarding the
  // journal, so the schema is known-good and only the history is missing.
  const scratchUrl = (name: string) => {
    const target = new URL(testUrl.href);
    target.pathname = `/${name}`;
    return target.href;
  };
  for (const name of [
    `${database}_adopt`,
    `${database}_mismatch`,
    `${database}_partial`,
    `${database}_myisam`,
  ]) {
    await admin.query(`CREATE DATABASE \`${name}\``);
    scratch.push(name);
    const seed = await createConnection(scratchUrl(name));
    await migrate(drizzle(seed), { migrationsFolder: "drizzle" });
    await seed.query("DROP TABLE `__drizzle_migrations`");
    await seed.end();
  }

  const adopt = await createConnection(scratchUrl(`${database}_adopt`));
  const beforeAdopt = JSON.stringify(await readDatabaseContract(adopt));
  await runMigration("baseline", scratchUrl(`${database}_adopt`));
  assert.equal(
    JSON.stringify(await readDatabaseContract(adopt)),
    beforeAdopt,
    "baseline must not touch application objects"
  );
  await runMigration("verify", scratchUrl(`${database}_adopt`));
  await assert.rejects(
    runMigration("baseline", scratchUrl(`${database}_adopt`)),
    /BASELINE_ALREADY_JOURNALED/
  );
  await adopt.end();
  console.info(
    "PASS: unjournaled database adopted without DDL, verified, and refused a second adoption"
  );

  const mismatch = await createConnection(scratchUrl(`${database}_mismatch`));
  await mismatch.query("ALTER TABLE users DROP COLUMN tenantId");
  const beforeMismatch = JSON.stringify(await readDatabaseContract(mismatch));
  await assert.rejects(
    runMigration("baseline", scratchUrl(`${database}_mismatch`)),
    /BASELINE_SCHEMA_MISMATCH/
  );
  assert.equal(
    JSON.stringify(await readDatabaseContract(mismatch)),
    beforeMismatch,
    "refused baseline must not change the schema"
  );
  const [journal] = await mismatch.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
  );
  assert.equal(
    Number(journal[0].n),
    0,
    "refused baseline must not create the journal"
  );
  await mismatch.end();
  console.info(
    "PASS: baseline refuses a database that differs from the final snapshot"
  );

  // A journal written half-way would strand the database: baseline would refuse
  // the retry as already journaled and migrate would read the surviving rows as
  // the applied point. Fail the fifth insert and require an empty journal after.
  const partialUrl = scratchUrl(`${database}_partial`);
  const partial = await createConnection(partialUrl);
  const journalRows = async () => {
    const [rows] = await partial.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM `__drizzle_migrations`"
    );
    return Number(rows[0].n);
  };
  let inserts = 0;
  const failing = new Proxy(partial, {
    get(target, property, receiver) {
      if (property === "query")
        return async (sql: string, values?: unknown[]) => {
          if (
            typeof sql === "string" &&
            sql.startsWith("INSERT INTO `__drizzle_migrations`") &&
            ++inserts === 5
          )
            throw new Error("SIMULATED_JOURNAL_WRITE_FAILURE");
          return await target.query(sql, values as never);
        };
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Connection;
  await assert.rejects(
    adoptJournal(
      failing,
      history,
      0,
      await readDatabaseContract(partial),
      snapshotContract(final.snapshot)
    ),
    /SIMULATED_JOURNAL_WRITE_FAILURE/
  );
  assert.equal(
    await journalRows(),
    0,
    "a failed adoption must roll back every journal row"
  );
  await runMigration("baseline", partialUrl);
  assert.equal(await journalRows(), history.length);
  await runMigration("verify", partialUrl);
  await partial.end();
  console.info(
    "PASS: interrupted adoption rolls back completely and stays retryable"
  );

  // The rollback above is only a guarantee on a transactional journal. A journal
  // table left behind by an older tool, or created while default_storage_engine
  // was MyISAM, would accept the inserts and ignore the rollback, so an empty
  // non-InnoDB journal must be refused rather than adopted.
  const myisamUrl = scratchUrl(`${database}_myisam`);
  const myisam = await createConnection(myisamUrl);
  await myisam.query(
    "CREATE TABLE `__drizzle_migrations` (id serial primary key, hash text not null, created_at bigint) ENGINE=MyISAM"
  );
  const [engine] = await myisam.query<RowDataPacket[]>(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
  );
  assert.equal(
    engine[0].ENGINE,
    "MyISAM",
    "this MySQL build must actually provide MyISAM for the fixture to mean anything"
  );
  await assert.rejects(
    runMigration("baseline", myisamUrl),
    /BASELINE_JOURNAL_ENGINE/
  );
  const [refused] = await myisam.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM `__drizzle_migrations`"
  );
  assert.equal(
    Number(refused[0].n),
    0,
    "a refused adoption must not write into a journal it cannot roll back"
  );
  await myisam.query("ALTER TABLE `__drizzle_migrations` ENGINE=InnoDB");
  await runMigration("baseline", myisamUrl);
  await runMigration("verify", myisamUrl);
  await myisam.end();
  console.info(
    "PASS: non-transactional journal refused before any insert and adopted once converted"
  );
} finally {
  await connection?.end();
  for (const name of scratch) await admin.query(`DROP DATABASE \`${name}\``);
  if (created) await admin.query(`DROP DATABASE \`${database}\``);
  await admin.end();
  rmSync(directory, { recursive: true, force: true });
}
