import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

// Only these test-owned copied tables are modified. LIKE does not prove FKs.
nativeDescribe.sequential("read-only chat rollout preflight on MySQL", () => {
  const tables = ["users", "chat_conversations", "chat_messages"];
  const databaseName = `ais_chat_preflight_${randomBytes(6).toString("hex")}`;
  let admin: mysql.Connection | undefined;
  let connection: mysql.Connection | undefined;
  let sourceDatabase: string;
  let created = false;

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL ?? "");
    sourceDatabase = source.pathname.slice(1);
    if (
      source.protocol !== "mysql:" ||
      !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
    )
      throw new Error(
        "Chat preflight tests require an owned loopback database"
      );
    const options = {
      host: source.hostname.replace(/^\[|\]$/g, ""),
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
      timezone: "Z",
    };
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    connection = await mysql.createConnection({
      ...options,
      database: databaseName,
    });
  });

  afterAll(async () => {
    try {
      await connection?.end();
    } finally {
      try {
        if (created) await admin?.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin?.end();
      }
    }
  });

  beforeEach(async () => {
    await connection!.rollback();
    for (const table of [...tables].reverse())
      await connection!.query(`DROP TABLE IF EXISTS \`${table}\``);
    for (const table of tables)
      await connection!.query(
        `CREATE TABLE \`${table}\` LIKE \`${sourceDatabase}\`.\`${table}\``
      );
    await connection!.query(
      "INSERT INTO users(id, openId, role) VALUES (9, 'preflight-synthetic-owner', 'user')"
    );
  });

  async function seed(id: number, rows = 1, count = rows) {
    await connection!.query(
      "INSERT INTO chat_conversations(id,userId,status,messageCount,context) VALUES (?,9,'active',?,JSON_OBJECT())",
      [id, count]
    );
    for (let i = 0; i < rows; i++)
      await connection!.query(
        "INSERT INTO chat_messages(conversationId,role,content) VALUES (?,?,?)",
        [
          id,
          i === 0 ? "assistant" : "user",
          "Synthetic private transcript never included in a report",
        ]
      );
  }

  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of tables) {
      const [rows] = await connection!.query(
        `SELECT * FROM \`${table}\` ORDER BY id`
      );
      result[table] = rows;
    }
    return JSON.stringify(result);
  }

  async function inspect(phase: "before" | "after", proveReadOnly = false) {
    const sql = readFileSync(
      new URL(
        `../../scripts/sql/chat-turn-preflight-${phase}-0081.sql`,
        import.meta.url
      ),
      "utf8"
    );
    const statements = sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map(statement => statement.trim())
      .filter(Boolean);
    const counts: Record<string, number> = {};
    const samples: Record<string, number[]> = {};
    const before = await snapshot();
    try {
      for (const statement of statements) {
        const [rows] = await connection!.query<RowDataPacket[]>(statement);
        if (statement === "START TRANSACTION READ ONLY" && proveReadOnly)
          await expect(
            connection!.query(
              "UPDATE users SET name='must not persist' WHERE id=9"
            )
          ).rejects.toMatchObject({
            code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION",
          });
        if (!statement.startsWith("SELECT")) continue;
        expect(statement).toContain("MAX_EXECUTION_TIME(5000)");
        if (rows.length && "total" in rows[0]) {
          expect(rows).toHaveLength(1);
          expect(Object.keys(rows[0]).sort()).toEqual(["finding", "total"]);
          counts[String(rows[0].finding)] = Number(rows[0].total);
        } else {
          expect(statement).toContain("LIMIT 50");
          expect(rows.length).toBeLessThanOrEqual(50);
          for (const row of rows) {
            expect(Object.keys(row).sort()).toEqual(["finding", "recordId"]);
            expect(Number.isSafeInteger(row.recordId)).toBe(true);
            (samples[String(row.finding)] ??= []).push(Number(row.recordId));
          }
        }
      }
    } finally {
      await connection!.rollback();
    }
    expect(await snapshot()).toBe(before);
    return { counts, samples };
  }

  async function preMigration() {
    await connection!.query(
      "ALTER TABLE chat_conversations DROP COLUMN pendingMessageId, DROP COLUMN pendingUntil"
    );
  }

  async function pending(id: number, expired = false) {
    await connection!.query(
      `UPDATE chat_conversations c SET pendingMessageId=(SELECT MAX(m.id) FROM chat_messages m WHERE m.conversationId=c.id),pendingUntil=CURRENT_TIMESTAMP(3) ${expired ? "-" : "+"} INTERVAL 150 SECOND WHERE c.id=?`,
      [id]
    );
  }

  it("reads a healthy pre-0081 schema and enforces READ ONLY even for the fixture administrator", async () => {
    await preMigration();
    await seed(1);
    const result = await inspect("before", true);
    expect(result.counts).toEqual({
      chat_message_count_mismatch: 0,
      chat_message_limit_invalid: 0,
      chat_conversation_owner_missing: 0,
      chat_message_conversation_missing: 0,
    });
    expect(result.samples).toEqual({});
  });

  it("reports retained 102/100 and 99/98 history and missing parents without changing it", async () => {
    await preMigration();
    await seed(1, 102, 100);
    await seed(2, 99, 98);
    await seed(3, 0);
    await connection!.query(
      "UPDATE chat_conversations SET userId=999 WHERE id=3"
    );
    await connection!.query(
      "INSERT INTO chat_messages(conversationId,role,content) VALUES (999,'user','Synthetic orphan')"
    );
    const result = await inspect("before");
    expect(result.counts).toEqual({
      chat_message_count_mismatch: 2,
      chat_message_limit_invalid: 1,
      chat_conversation_owner_missing: 1,
      chat_message_conversation_missing: 1,
    });
    expect(result.samples.chat_message_count_mismatch).toEqual([1, 2]);
    expect(result.samples.chat_message_limit_invalid).toEqual([1]);
    expect(result.samples.chat_conversation_owner_missing).toEqual([3]);
    expect(result.samples.chat_message_conversation_missing).toHaveLength(1);
  });

  it("separately reports valid and expired pending turns as a rollback barrier", async () => {
    await seed(1, 2);
    await seed(2, 2);
    await pending(1);
    await pending(2, true);
    const result = await inspect("after", true);
    expect(result.counts).toEqual({
      chat_pending_shape_invalid: 0,
      chat_pending_reference_invalid: 0,
      chat_pending_capacity_invalid: 0,
      chat_pending_not_tail: 0,
      chat_pending_expired: 1,
      chat_pending_count: 2,
    });
    expect(result.samples.chat_pending_expired).toEqual([2]);
    expect(result.samples.chat_pending_count).toEqual([1, 2]);
    const [columns] = await connection!.query<RowDataPacket[]>(
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='chat_conversations' AND column_name IN ('pendingMessageId','pendingUntil') ORDER BY column_name"
    );
    expect(columns).toEqual([
      {
        COLUMN_NAME: "pendingMessageId",
        COLUMN_TYPE: "int",
        IS_NULLABLE: "YES",
      },
      {
        COLUMN_NAME: "pendingUntil",
        COLUMN_TYPE: "timestamp(3)",
        IS_NULLABLE: "YES",
      },
    ]);
  });

  it("detects partial claims, missing/cross-conversation/non-user references, lost capacity and later rows", async () => {
    for (let id = 1; id <= 7; id++) {
      await seed(id, 2);
      await pending(id);
    }
    await connection!.query(
      "UPDATE chat_conversations SET pendingMessageId=NULL WHERE id=1"
    );
    await connection!.query(
      "UPDATE chat_conversations SET pendingMessageId=999999 WHERE id=2"
    );
    await connection!.query(
      "UPDATE chat_conversations SET pendingMessageId=(SELECT MAX(id) FROM chat_messages WHERE conversationId=4) WHERE id=3"
    );
    await connection!.query(
      "UPDATE chat_conversations SET status='archived' WHERE id=4"
    );
    await connection!.query(
      "UPDATE chat_conversations SET pendingMessageId=(SELECT MIN(id) FROM chat_messages WHERE conversationId=5) WHERE id=5"
    );
    await connection!.query(
      "UPDATE chat_conversations SET messageCount=100 WHERE id=6"
    );
    await connection!.query(
      "INSERT INTO chat_messages(conversationId,role,content) VALUES (7,'assistant','Synthetic later row')"
    );
    await connection!.query(
      "UPDATE chat_conversations SET messageCount=3 WHERE id=7"
    );
    const result = await inspect("after");
    expect(result.counts).toEqual({
      chat_pending_shape_invalid: 1,
      chat_pending_reference_invalid: 4,
      chat_pending_capacity_invalid: 1,
      chat_pending_not_tail: 4,
      chat_pending_expired: 0,
      chat_pending_count: 7,
    });
    expect(result.samples.chat_pending_reference_invalid).toEqual([2, 3, 4, 5]);
    expect(result.samples.chat_pending_capacity_invalid).toEqual([6]);
    expect(result.samples.chat_pending_not_tail).toEqual([2, 3, 5, 7]);
  });

  it("counts every anomaly while limiting samples to 50 ordered identifiers", async () => {
    for (let id = 1; id <= 55; id++) await seed(id, 0, 1);
    const result = await inspect("before");
    expect(result.counts.chat_message_count_mismatch).toBe(55);
    expect(result.samples.chat_message_count_mismatch).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
  });
});
