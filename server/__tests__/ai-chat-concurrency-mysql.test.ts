import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";

const boundary = vi.hoisted(() => ({
  db: null as MySql2Database<typeof schema> | null,
  invoke: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/intelligence/gateway", () => ({
  aiGateway: { invoke: boundary.invoke },
}));
vi.mock("../services/flights.service", () => ({
  searchFlights: boundary.search,
}));
import { startConversation } from "../services/ai-chat-booking.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

/** The real service and MySQL driver operate on three owned table copies.
 * CREATE TABLE LIKE preserves migrated types/indexes, not foreign keys; this
 * suite proves creation admission/rollback, not migration replay or generation.
 * Contention is observed in InnoDB's data_lock_waits before releasing a gate. */
nativeDescribe.sequential("chat creation admission on native MySQL", () => {
  let admin: mysql.Connection | undefined;
  let pool: mysql.Pool | undefined;
  let db: MySql2Database<typeof schema>;
  const databaseName = `ais_chat_start_${randomBytes(6).toString("hex")}`;
  let created = false;

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL ?? "");
    const sourceDatabase = source.pathname.slice(1);
    if (
      process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
      process.env.NODE_ENV !== "test" ||
      source.protocol !== "mysql:" ||
      !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
    )
      throw new Error(
        "Chat admission acceptance requires a loopback disposable database"
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
    for (const table of ["users", "chat_conversations", "chat_messages"])
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${table}\` LIKE \`${sourceDatabase}\`.\`${table}\``
      );
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 5,
    });
    db = drizzle(pool, { schema, mode: "default" });
    boundary.db = db;
  });

  afterAll(async () => {
    boundary.db = null;
    try {
      await pool?.end();
    } finally {
      try {
        if (created) await admin?.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin?.end();
      }
    }
  });

  beforeEach(async () => {
    boundary.invoke.mockReset();
    boundary.search.mockReset();
    await pool!.query("DROP TRIGGER IF EXISTS reject_chat_greeting");
    for (const table of ["chat_messages", "chat_conversations", "users"])
      await pool!.query(`TRUNCATE TABLE \`${table}\``);
    await db.insert(schema.users).values([
      { id: 9, openId: "native-chat-owner-one", role: "user" },
      { id: 10, openId: "native-chat-owner-two", role: "user" },
    ]);
  });

  async function seedConversations(
    count: number,
    userId = 9,
    status: "active" | "completed" | "archived" | "expired" = "active",
    firstId = 1
  ) {
    await db.insert(schema.chatConversations).values(
      Array.from({ length: count }, (_, offset) => ({
        id: firstId + offset,
        userId,
        status,
        messageCount: 1,
        context: {},
      }))
    );
    await db.insert(schema.chatMessages).values(
      Array.from({ length: count }, (_, offset) => ({
        conversationId: firstId + offset,
        role: "assistant" as const,
        content: "Earlier synthetic greeting",
      }))
    );
  }

  async function gateOwner(userId: number) {
    const connection = await pool!.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query("SELECT id FROM users WHERE id=? FOR UPDATE", [
        userId,
      ]);
    } catch (error) {
      connection.release();
      throw error;
    }
    return async () => {
      try {
        await connection.rollback();
      } finally {
        connection.release();
      }
    };
  }

  async function observeOwnerWaiters(
    userId: number,
    expected: number,
    finished: () => boolean
  ) {
    const deadline = Date.now() + 5000;
    let observed = 0;
    do {
      const [rows] = await admin!.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='users' AND l.INDEX_NAME='PRIMARY' AND l.LOCK_DATA=?",
        [databaseName, String(userId)]
      );
      observed = Math.max(observed, Number(rows[0]?.waiting ?? 0));
      if (observed >= expected || finished()) return observed;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    return observed;
  }

  async function activeConversations(userId: number) {
    return db
      .select()
      .from(schema.chatConversations)
      .where(
        and(
          eq(schema.chatConversations.userId, userId),
          eq(schema.chatConversations.status, "active")
        )
      );
  }

  async function expectGreeting(conversationId: number, greeting: string) {
    const conversations = await db
      .select()
      .from(schema.chatConversations)
      .where(eq(schema.chatConversations.id, conversationId));
    expect(conversations).toEqual([
      expect.objectContaining({ messageCount: 1, status: "active" }),
    ]);
    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.conversationId, conversationId));
    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", content: greeting }),
    ]);
  }

  it("admits one of two starts at 49 after both contend on the owner row", async () => {
    await seedConversations(49);
    const release = await gateOwner(9);
    let finished = false;
    const results = Promise.allSettled([
      startConversation({ userId: 9 }),
      startConversation({ userId: 9 }),
    ]).then(outcomes => {
      finished = true;
      return outcomes;
    });
    let observed = 0;
    try {
      observed = await observeOwnerWaiters(9, 2, () => finished);
    } finally {
      await release();
    }
    const outcomes = await results;
    expect.soft(observed).toBe(2);
    expect
      .soft(outcomes.filter(row => row.status === "fulfilled"))
      .toHaveLength(1);
    expect.soft(outcomes.filter(row => row.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: "TOO_MANY_REQUESTS" }),
      }),
    ]);
    expect.soft(await activeConversations(9)).toHaveLength(50);
    const winner = outcomes.find(row => row.status === "fulfilled");
    if (winner?.status === "fulfilled")
      await expectGreeting(winner.value.conversationId, winner.value.greeting);
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
  });

  it("admits another owner while the first owner is waiting on its row", async () => {
    const release = await gateOwner(9);
    let finished = false;
    const first = startConversation({ userId: 9 });
    const firstResult = Promise.allSettled([first]).then(outcomes => {
      finished = true;
      return outcomes;
    });
    let independent: ReturnType<typeof startConversation> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observed = await observeOwnerWaiters(9, 1, () => finished);
      expect.soft(observed).toBe(1);
      independent = startConversation({ userId: 10 });
      const second = await Promise.race([
        independent,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Another owner waited on an unrelated owner")),
            3000
          );
        }),
      ]);
      expect.soft(finished).toBe(false);
      expect.soft(await activeConversations(9)).toHaveLength(0);
      expect(await activeConversations(10)).toHaveLength(1);
      await expectGreeting(second.conversationId, second.greeting);
    } finally {
      clearTimeout(timer);
      await release();
      await Promise.allSettled([first, ...(independent ? [independent] : [])]);
    }
    expect((await firstResult)[0].status).toBe("fulfilled");
    expect(await activeConversations(9)).toHaveLength(1);
  });

  it("counts only the owner's active conversations toward the cap", async () => {
    await seedConversations(49);
    await seedConversations(1, 9, "completed", 50);
    await seedConversations(1, 9, "archived", 51);
    await seedConversations(1, 9, "expired", 52);
    await seedConversations(50, 10, "active", 100);
    const response = await startConversation({ userId: 9 });
    expect(await activeConversations(9)).toHaveLength(50);
    expect(await activeConversations(10)).toHaveLength(50);
    await expectGreeting(response.conversationId, response.greeting);
    await expect(startConversation({ userId: 9 })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(await activeConversations(9)).toHaveLength(50);
  });

  it("rejects a missing owner without creating any rows", async () => {
    await expect(startConversation({ userId: 99 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await db.select().from(schema.chatConversations)).toEqual([]);
    expect(await db.select().from(schema.chatMessages)).toEqual([]);
  });

  it("returns the slot when greeting persistence fails and permits a retry", async () => {
    await seedConversations(49);
    await pool!.query(
      "CREATE TRIGGER reject_chat_greeting BEFORE INSERT ON chat_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic greeting failure'"
    );
    try {
      await expect(startConversation({ userId: 9 })).rejects.toThrow();
    } finally {
      await pool!.query("DROP TRIGGER reject_chat_greeting");
    }
    expect(await activeConversations(9)).toHaveLength(49);
    expect(await db.select().from(schema.chatMessages)).toHaveLength(49);
    const response = await startConversation({ userId: 9 });
    expect(await activeConversations(9)).toHaveLength(50);
    await expectGreeting(response.conversationId, response.greeting);
  });
});
