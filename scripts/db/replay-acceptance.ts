// Destructive fixtures are confined to a newly created random database, never
// the database named in DATABASE_URL. Run against a disposable CI MySQL service.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
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
  const materializePrefix = (count: number) => {
    writeFileSync(
      join(directory, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "mysql",
        entries: history.slice(0, count).map(({ idx, tag, when }) => ({
          idx,
          tag,
          when,
          version: "5",
          breakpoints: true,
        })),
      })
    );
    for (const m of history.slice(0, count))
      copyFileSync(
        join("drizzle", `${m.tag}.sql`),
        join(directory, `${m.tag}.sql`)
      );
  };
  materializePrefix(boundary);
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
  // Exercise the preservation CLI across the real financial migration even
  // after every reachable release already includes 0014.
  const financialBoundary = history.findIndex(
    m => m.tag === "0014_transactional_audit_forward"
  );
  assert.ok(financialBoundary > boundary);
  materializePrefix(financialBoundary);
  await migrate(drizzle(connection), { migrationsFolder: directory });
  const preserve = (mode: "seed" | "verify", url: string, artifact: string) =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/migration-preservation-check.ts",
        mode,
        artifact,
      ],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" }
    );
  const legacyArtifact = join(directory, "legacy-financial-before.json");
  preserve("seed", testUrl.href, legacyArtifact);
  await runMigration("migrate", testUrl.href);
  await runMigration("verify", testUrl.href);
  preserve("verify", testUrl.href, legacyArtifact);
  console.info(
    "PASS: preservation CLI verifies the actual 0014 financial backfill"
  );
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

  // Data inserted after 0014 must stay unchanged on a migration replay. In
  // particular, it must not be treated as legacy funding/inventory a second time.
  const currentDatabase = `${database}_preserve_current`;
  await admin.query(`CREATE DATABASE \`${currentDatabase}\``);
  scratch.push(currentDatabase);
  const currentUrl = new URL(testUrl.href);
  currentUrl.pathname = `/${currentDatabase}`;
  const currentArtifact = join(directory, "current-financial-before.json");
  await runMigration("migrate", currentUrl.href);
  preserve("seed", currentUrl.href, currentArtifact);
  await runMigration("migrate", currentUrl.href);
  preserve("verify", currentUrl.href, currentArtifact);
  console.info(
    "PASS: preservation CLI verifies fresh data after 0014 on a no-op upgrade"
  );

  // Exercise the exact pre-turn journal with retained healthy and historically
  // inconsistent chat rows. Additive DDL must preserve both; it is not a repair.
  const chatBoundary = history.findIndex(
    m => m.tag === "0081_chat_pending_turn"
  );
  assert.ok(chatBoundary > 0, "chat fencing migration must be journaled");
  assert.equal(
    history[chatBoundary - 1].tag,
    "0080_servicing_refund_resolution"
  );
  const chatDatabase = `${database}_chat_turn`;
  await admin.query(`CREATE DATABASE \`${chatDatabase}\``);
  scratch.push(chatDatabase);
  const chatUrl = new URL(testUrl.href);
  chatUrl.pathname = `/${chatDatabase}`;
  const chatConnection = await createConnection(chatUrl.href);
  try {
    materializePrefix(chatBoundary);
    await migrate(drizzle(chatConnection), { migrationsFolder: directory });
    assert.deepEqual(
      differences(
        snapshotContract(history[chatBoundary - 1].snapshot),
        await readDatabaseContract(chatConnection)
      ),
      []
    );
    await chatConnection.query(
      "INSERT INTO users(id,openId,name) VALUES (9001,'chat-migration-sentinel','Synthetic migration owner')"
    );
    await chatConnection.query(
      "INSERT INTO airlines(id,code,name) VALUES (9001,'PF','Preflight synthetic airline')"
    );
    await chatConnection.query(
      "INSERT INTO airports(id,code,name,city,country,timezone) VALUES (9001,'PFA','Synthetic origin','Origin','Test','UTC'),(9002,'PFB','Synthetic destination','Destination','Test','UTC')"
    );
    await chatConnection.query(
      "INSERT INTO flights(id,flightNumber,airlineId,originId,destinationId,departureTime,arrivalTime,economySeats,businessSeats,economyPrice,businessPrice,economyAvailable,businessAvailable) VALUES (9001,'PF001',9001,9001,9002,'2030-06-10 09:00:00','2030-06-10 11:00:00',10,4,10000,20000,10,4)"
    );
    for (const [id, actualRows, storedCount] of [
      [1, 3, 3],
      [2, 102, 100],
      [3, 99, 98],
      [4, 1, 1],
    ]) {
      await chatConnection.query(
        "INSERT INTO chat_conversations(id,userId,status,messageCount,context,lastMessageAt) VALUES (?,9001,'active',?,JSON_OBJECT('passengers',2,'cabinClass','business'),'2025-11-27 12:34:56')",
        [id, storedCount]
      );
      for (let index = 0; index < actualRows; index++)
        await chatConnection.query(
          "INSERT INTO chat_messages(conversationId,role,content,createdAt) VALUES (?,?,?,'2025-11-27 12:34:56')",
          [id, index % 2 === 0 ? "assistant" : "user", `رحلة اختبار ${index}`]
        );
    }
    await chatConnection.query(
      "UPDATE chat_conversations SET status='archived' WHERE id=4"
    );
    await chatConnection.query(
      "INSERT INTO booking_suggestions(id,conversationId,messageId,flightId,cabinClass,pricePerPerson,totalPrice,reason,selected,expiresAt) VALUES (1,1,(SELECT MAX(id) FROM chat_messages WHERE conversationId=1),9001,'business',20000,40000,'اقتراح محفوظ','expired','2025-11-27 13:04:56')"
    );
    await chatConnection.query(
      "UPDATE chat_messages SET metadata=JSON_OBJECT('suggestions',JSON_ARRAY(1),'entities',JSON_OBJECT('passengers',2)) WHERE id=(SELECT messageId FROM booking_suggestions WHERE id=1)"
    );
    const chatSnapshot = async (includePending: boolean) => {
      const [conversations] = await chatConnection.query<RowDataPacket[]>(
        "SELECT * FROM chat_conversations ORDER BY id"
      );
      const [messages] = await chatConnection.query<RowDataPacket[]>(
        "SELECT * FROM chat_messages ORDER BY id"
      );
      const [suggestions] = await chatConnection.query<RowDataPacket[]>(
        "SELECT * FROM booking_suggestions ORDER BY id"
      );
      return JSON.stringify({
        conversations: conversations.map(row => {
          if (includePending) return row;
          const { pendingMessageId: _id, pendingUntil: _until, ...old } = row;
          return old;
        }),
        messages,
        suggestions,
      });
    };
    const retainedChat = await chatSnapshot(false);
    const [chatJournalPrefix] = await chatConnection.query<RowDataPacket[]>(
      "SELECT hash,created_at FROM __drizzle_migrations ORDER BY id"
    );
    await runMigration("migrate", chatUrl.href);
    await runMigration("verify", chatUrl.href);
    assert.equal(await chatSnapshot(false), retainedChat);
    const [columns] = await chatConnection.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,DATETIME_PRECISION AS timePrecision FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='chat_conversations' AND column_name IN ('pendingMessageId','pendingUntil') ORDER BY column_name"
    );
    assert.deepEqual(columns, [
      {
        name: "pendingMessageId",
        type: "int",
        nullable: "YES",
        defaultValue: null,
        timePrecision: null,
      },
      {
        name: "pendingUntil",
        type: "timestamp(3)",
        nullable: "YES",
        defaultValue: null,
        timePrecision: 3,
      },
    ]);
    const [pending] = await chatConnection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM chat_conversations WHERE pendingMessageId IS NOT NULL OR pendingUntil IS NOT NULL"
    );
    assert.equal(Number(pending[0].n), 0);
    const [journalBefore] = await chatConnection.query<RowDataPacket[]>(
      "SELECT hash,created_at FROM __drizzle_migrations ORDER BY id"
    );
    assert.equal(journalBefore.length, history.length);
    assert.deepEqual(journalBefore.slice(0, chatBoundary), chatJournalPrefix);
    const afterChat = await chatSnapshot(true);
    await runMigration("migrate", chatUrl.href);
    const [journalAfter] = await chatConnection.query(
      "SELECT hash,created_at FROM __drizzle_migrations ORDER BY id"
    );
    assert.deepEqual(journalAfter, journalBefore);
    assert.equal(await chatSnapshot(true), afterChat);
    console.info(
      "PASS: canonical 0080-to-0081 chat upgrade preserves 205 Unicode transcript rows, archived state, linked suggestion and existing counts, creates nullable millisecond pending fields, and replays without data/journal changes"
    );
  } finally {
    await chatConnection.end();
  }

  // Change only the diagnostic text, preserving the trigger's rejection policy.
  // This tests body drift independently of a missing trigger or journal change.
  const triggerName = "supplier_finance_no_update";
  const originalTrigger = readFileSync(
    "drizzle/0058_supplier_finance_control.sql",
    "utf8"
  )
    .split("--> statement-breakpoint")
    .map(sql => sql.trim())
    .find(sql => sql.startsWith(`CREATE TRIGGER ${triggerName} `));
  assert.ok(originalTrigger);
  await connection.query(`DROP TRIGGER ${triggerName}`);
  await assert.rejects(
    runMigration("verify", testUrl.href),
    /supplier_finance_events.triggers.supplier_finance_no_update/
  );
  await connection.query(
    originalTrigger.replace(
      "evidence is append-only",
      "evidence must remain append-only"
    )
  );
  for (const command of ["preflight", "verify", "migrate"] as const)
    await assert.rejects(
      runMigration(command, testUrl.href),
      /supplier_finance_no_update.bodyHash/
    );
  await connection.query(`DROP TRIGGER ${triggerName}`);
  await connection.query(originalTrigger);
  await runMigration("verify", testUrl.href);
  console.info(
    "PASS: missing and modified triggers rejected; original trigger verified"
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
    `${database}_wallet`,
    `${database}_booking`,
  ]) {
    await admin.query(`CREATE DATABASE \`${name}\``);
    scratch.push(name);
    const seed = await createConnection(scratchUrl(name));
    await migrate(drizzle(seed), { migrationsFolder: "drizzle" });
    await seed.query("DROP TABLE `__drizzle_migrations`");
    await seed.end();
  }

  const adopt = await createConnection(scratchUrl(`${database}_adopt`));
  await adopt.query(`DROP TRIGGER ${triggerName}`);
  await assert.rejects(
    runMigration("baseline", scratchUrl(`${database}_adopt`)),
    /supplier_finance_events.triggers.supplier_finance_no_update/
  );
  const [absentJournal] = await adopt.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
  );
  assert.equal(Number(absentJournal[0].n), 0);
  await adopt.query(originalTrigger);
  console.info(
    "PASS: incomplete trigger set refused before baseline journal creation"
  );
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

  // A schema-pushed database can have the final columns while missing the data
  // changes from 0014. Refuse adoption before creating a journal, leave its
  // balances/bookings intact, then prove an explicitly reconciled fixture can
  // be adopted. The repair statements below run only in disposable test DBs.
  for (const kind of ["wallet", "booking"] as const) {
    const financialUrl = scratchUrl(`${database}_${kind}`);
    const financial = await createConnection(financialUrl);
    try {
      if (kind === "wallet")
        await financial.query(
          "INSERT INTO wallets (userId, balance, currency, status) VALUES (1, 12345, 'SAR', 'active')"
        );
      else
        await financial.query(
          "INSERT INTO bookings (userId, flightId, bookingReference, pnr, status, paymentStatus, totalAmount, cabinClass, numberOfPassengers) VALUES (1, 1, 'BASE01', 'BASE02', 'confirmed', 'paid', 12345, 'economy', 1)"
        );
      const table = kind === "wallet" ? "wallets" : "bookings";
      const contents = async () =>
        JSON.stringify(
          (await financial.query(`SELECT * FROM \`${table}\` ORDER BY id`))[0]
        );
      const beforeData = await contents();
      const beforeSchema = await readDatabaseContract(financial);
      await assert.rejects(
        runMigration("baseline", financialUrl),
        /BASELINE_DATA_REVIEW_REQUIRED/
      );
      assert.equal(
        await contents(),
        beforeData,
        "baseline never repairs application data"
      );
      assert.deepEqual(await readDatabaseContract(financial), beforeSchema);
      const [absent] = await financial.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'"
      );
      assert.equal(
        Number(absent[0].n),
        0,
        "data refusal must not create the journal"
      );
      await financial.query(
        kind === "wallet"
          ? "UPDATE wallets SET status = 'frozen' WHERE userId = 1"
          : "UPDATE bookings SET seatsReserved = TRUE WHERE bookingReference = 'BASE01'"
      );
      const reviewed = await contents();
      await runMigration("baseline", financialUrl);
      await runMigration("verify", financialUrl);
      assert.equal(
        await contents(),
        reviewed,
        "adoption preserves reviewed data"
      );
      console.info(
        `PASS: baseline refuses unresolved legacy ${kind} before journal creation and accepts explicit reconciliation`
      );
    } finally {
      await financial.end();
    }
  }

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
