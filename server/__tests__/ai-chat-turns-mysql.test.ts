import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  afterEach,
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
import {
  archiveOldConversations,
  getUserConversations,
  sendMessage,
} from "../services/ai-chat-booking.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const reply = (content = "Synthetic reply") => ({
  result: { choices: [{ message: { role: "assistant", content } }] },
});
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

/** Actual service/driver on an owned MySQL schema, with controlled provider
 * promises. Expired-row cases simulate interruption; no process kill or real
 * provider acceptance is claimed. LIKE copies omit foreign keys. */
nativeDescribe.sequential("durable chat turns on native MySQL", () => {
  const tables = [
    "users",
    "bookings",
    "chat_conversations",
    "chat_messages",
    "booking_suggestions",
    "inventory_locks",
    "seat_holds",
  ];
  const databaseName = `ais_chat_turns_${randomBytes(6).toString("hex")}`;
  let admin: mysql.Connection | undefined;
  let pool: mysql.Pool | undefined;
  let db: MySql2Database<typeof schema>;
  let created = false;
  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL ?? "");
    const sourceDatabase = source.pathname.slice(1);
    if (
      source.protocol !== "mysql:" ||
      !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
    )
      throw new Error(
        "Chat turn acceptance requires an owned loopback test database"
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
    for (const table of tables)
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
    await pool!.query("DROP TRIGGER IF EXISTS reject_chat_answer");
    for (const table of [...tables].reverse())
      await pool!.query(`TRUNCATE TABLE \`${table}\``);
    await db
      .insert(schema.users)
      .values({ id: 9, openId: "native-chat-turn-owner", role: "user" });
    boundary.invoke.mockReset().mockResolvedValue(reply());
    boundary.search.mockReset().mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function seed(count = 1, conversationId = 7, context = {}) {
    await db.insert(schema.chatConversations).values({
      id: conversationId,
      userId: 9,
      status: "active",
      messageCount: count,
      context,
    });
    await db.insert(schema.chatMessages).values(
      Array.from({ length: count }, (_, i) => ({
        conversationId,
        role: i === 0 || i % 2 ? ("assistant" as const) : ("user" as const),
        content: "Earlier synthetic message",
      }))
    );
  }
  async function row(id = 7) {
    const [conversation] = await db
      .select()
      .from(schema.chatConversations)
      .where(eq(schema.chatConversations.id, id));
    return conversation;
  }
  async function messages(id = 7) {
    return db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.conversationId, id))
      .orderBy(schema.chatMessages.id);
  }
  async function expire(id = 7) {
    await db
      .update(schema.chatConversations)
      .set({ pendingUntil: sql`CURRENT_TIMESTAMP - INTERVAL 1 SECOND` })
      .where(eq(schema.chatConversations.id, id));
  }
  async function gateConversation(id = 7) {
    const connection = await pool!.getConnection();
    await connection.beginTransaction();
    await connection.query(
      "SELECT id FROM chat_conversations WHERE id=? FOR UPDATE",
      [id]
    );
    return async () => {
      try {
        await connection.rollback();
      } finally {
        connection.release();
      }
    };
  }
  async function waitForAdmissionBoundary(providers: () => number) {
    const deadline = Date.now() + 5000;
    let waiting = 0;
    do {
      const [rows] = await admin!.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='chat_conversations'",
        [databaseName]
      );
      waiting = Number(rows[0]?.waiting ?? 0);
      if (waiting >= 2 || providers() >= 2) return waiting;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    return waiting;
  }
  async function within<T>(promise: Promise<T>, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  it("serializes simultaneous admission at 98 and prevents the 102-row stale-counter reproduction", async () => {
    await seed(98);
    const release = await gateConversation();
    const answers: Array<
      ReturnType<typeof deferred<ReturnType<typeof reply>>> & {
        message: string;
      }
    > = [];
    const entered = deferred<void>();
    boundary.invoke.mockImplementation(request => {
      const answer = {
        ...deferred<ReturnType<typeof reply>>(),
        message: request.messages.at(-1).content as string,
      };
      answers.push(answer);
      entered.resolve();
      return answer.promise;
    });
    const first = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "2 passengers",
    });
    const second = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "Business class",
    });
    const firstOutcome = Promise.allSettled([first]);
    const secondOutcome = Promise.allSettled([second]);
    const settled = Promise.allSettled([first, second]);
    let waiting = 0;
    try {
      waiting = await waitForAdmissionBoundary(() => answers.length);
    } finally {
      await release();
    }
    try {
      await within(
        entered.promise,
        "No provider reached after releasing admission gate"
      );
      // Both baseline calls reached the provider before the gate released.
      // The corrected path reaches exactly one after a real row-lock wait.
      if (answers.length === 2) {
        answers
          .find(answer => answer.message === "2 passengers")!
          .resolve(reply("First reply"));
        await first;
        answers
          .find(answer => answer.message === "Business class")!
          .resolve(reply("Second reply"));
      } else {
        await within(
          answers[0].message === "2 passengers" ? secondOutcome : firstOutcome,
          "Overlapping admission did not reject while the first provider waited"
        );
        answers[0].resolve(reply("Single admitted reply"));
      }
      const outcomes = await settled;
      console.info(
        JSON.stringify({
          finding: "AIS-AI-002",
          engine: "native MySQL with synthetic provider",
          seededRows: 98,
          observedAdmissionWaiters: waiting,
          providerCalls: answers.length,
          persistedRows: (await messages()).length,
          storedCount: (await row()).messageCount,
          context: (await row()).context,
          outcomes: outcomes.map(outcome => outcome.status),
        })
      );
      expect.soft(waiting).toBe(2);
      expect
        .soft(outcomes.filter(outcome => outcome.status === "fulfilled"))
        .toHaveLength(1);
      expect
        .soft(outcomes.filter(outcome => outcome.status === "rejected"))
        .toEqual([
          expect.objectContaining({
            reason: expect.objectContaining({ code: "CONFLICT" }),
          }),
        ]);
      expect.soft(await messages()).toHaveLength(100);
      expect.soft((await row()).messageCount).toBe(100);
      expect.soft(boundary.invoke).toHaveBeenCalledTimes(1);
      const winner =
        outcomes[0].status === "fulfilled"
          ? { passengers: 2 }
          : { cabinClass: "business" };
      expect((await row()).context).toEqual(winner);
    } finally {
      for (const answer of answers) answer.resolve(reply());
      await settled;
    }
  });

  it("releases the conversation lock while the provider waits and keeps internal claim associations private", async () => {
    await seed();
    await seed(1, 8);
    const entered = deferred<void>();
    const answer = deferred<ReturnType<typeof reply>>();
    boundary.invoke.mockImplementationOnce(() => {
      entered.resolve();
      return answer.promise;
    });
    const pending = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    const probe = pool!.getConnection();
    let connection: mysql.PoolConnection | undefined;
    try {
      await Promise.race([entered.promise, pending]);
      connection = await probe;
      await connection.query("SET SESSION innodb_lock_wait_timeout=1");
      await connection.beginTransaction();
      await connection.query(
        "SELECT id FROM chat_conversations WHERE id=7 FOR UPDATE"
      );
      await connection.rollback();
      await within(
        sendMessage({ userId: 9, conversationId: 8, message: "Economy class" }),
        "Another conversation was blocked by provider I/O"
      );
      const current = await row();
      expect.soft(current.messageCount).toBe(2);
      expect.soft(current.pendingMessageId).toBe((await messages()).at(-1)?.id);
      for (const conversation of await getUserConversations(9)) {
        expect.soft(conversation).not.toHaveProperty("pendingMessageId");
        expect.soft(conversation).not.toHaveProperty("pendingUntil");
      }
    } finally {
      await connection?.rollback();
      connection?.release();
      answer.resolve(reply());
      await outcome;
    }
  });

  it("recovers a seeded interrupted user row at the last slot even when the new send is refused", async () => {
    await seed(98);
    const [user] = await db
      .insert(schema.chatMessages)
      .values({ conversationId: 7, role: "user", content: "2 passengers" });
    await db
      .update(schema.chatConversations)
      .set({
        messageCount: 99,
        pendingMessageId: user.insertId,
        pendingUntil: sql`CURRENT_TIMESTAMP - INTERVAL 1 SECOND`,
      })
      .where(eq(schema.chatConversations.id, 7));
    await expect(
      sendMessage({ userId: 9, conversationId: 7, message: "Business class" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect.soft(await messages()).toHaveLength(100);
    expect.soft(await row()).toMatchObject({
      messageCount: 100,
      pendingMessageId: null,
      pendingUntil: null,
      context: { passengers: 2 },
    });
    expect.soft((await messages()).at(-1)).toMatchObject({ role: "assistant" });
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it("keeps a newer token and context when the expired provider returns late", async () => {
    await seed();
    const firstEntered = deferred<void>();
    const secondEntered = deferred<void>();
    const firstAnswer = deferred<ReturnType<typeof reply>>();
    const secondAnswer = deferred<ReturnType<typeof reply>>();
    boundary.invoke
      .mockImplementationOnce(() => {
        firstEntered.resolve();
        return firstAnswer.promise;
      })
      .mockImplementationOnce(() => {
        secondEntered.resolve();
        return secondAnswer.promise;
      });
    const first = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "2 passengers",
    });
    const firstOutcome = Promise.allSettled([first]);
    await Promise.race([firstEntered.promise, first]);
    await expire();
    const second = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "Business class",
    });
    const secondOutcome = Promise.allSettled([second]);
    try {
      await Promise.race([secondEntered.promise, second]);
      const replacement = await row();
      expect
        .soft(replacement.pendingMessageId)
        .toBe((await messages()).at(-1)?.id);
      firstAnswer.resolve(reply("Expired reply"));
      expect.soft((await firstOutcome)[0]).toEqual({
        status: "rejected",
        reason: expect.objectContaining({ code: "PRECONDITION_FAILED" }),
      });
      expect
        .soft((await row()).pendingMessageId)
        .toBe(replacement.pendingMessageId);
      expect
        .soft(
          (await messages()).some(
            message => message.content === "Expired reply"
          )
        )
        .toBe(false);
      secondAnswer.resolve(reply("Current reply"));
      await second;
      expect.soft(await messages()).toHaveLength(5);
      expect(await row()).toMatchObject({
        messageCount: 5,
        pendingMessageId: null,
        pendingUntil: null,
        context: { passengers: 2, cabinClass: "business" },
      });
    } finally {
      firstAnswer.resolve(reply());
      secondAnswer.resolve(reply());
      await Promise.all([firstOutcome, secondOutcome]);
    }
  });

  it("rolls back assistant and suggestion completion writes, then recovers its reserved last slot", async () => {
    await seed(98, 7, {
      originId: 1,
      destinationId: 2,
      departureDate: "2030-06-10",
    });
    boundary.search.mockResolvedValue([
      {
        id: 11,
        departureTime: new Date("2030-06-10T09:00:00Z"),
        arrivalTime: new Date("2030-06-10T11:00:00Z"),
        economyPrice: 10000,
        businessPrice: 20000,
        economyAvailable: 9,
        businessAvailable: 9,
        airline: { name: "Synthetic Airline" },
        origin: { city: "Origin", timezone: "UTC" },
        destination: { city: "Destination", timezone: "UTC" },
      },
    ]);
    await pool!.query(
      "CREATE TRIGGER reject_chat_answer BEFORE INSERT ON chat_messages FOR EACH ROW BEGIN IF NEW.role='assistant' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic assistant failure'; END IF; END"
    );
    try {
      await expect(
        sendMessage({ userId: 9, conversationId: 7, message: "2 passengers" })
      ).rejects.toThrow();
    } finally {
      await pool!.query("DROP TRIGGER reject_chat_answer");
    }
    expect.soft(await db.select().from(schema.bookingSuggestions)).toEqual([]);
    expect.soft(await messages()).toHaveLength(99);
    expect.soft((await row()).messageCount).toBe(99);
    await expire();
    await expect(
      sendMessage({ userId: 9, conversationId: 7, message: "Business class" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect.soft(await messages()).toHaveLength(100);
    expect(await row()).toMatchObject({
      messageCount: 100,
      pendingMessageId: null,
      pendingUntil: null,
    });
  });

  it("uses database time for pending expiry and activity despite a skewed worker clock", async () => {
    await seed();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
    const entered = deferred<void>();
    const answer = deferred<ReturnType<typeof reply>>();
    boundary.invoke.mockImplementationOnce(() => {
      entered.resolve();
      return answer.promise;
    });
    const pending = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    try {
      await Promise.race([entered.promise, pending]);
      const [clock] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS now"
      );
      const now = Number(clock[0].now);
      const current = await row();
      expect
        .soft(Math.abs((current.lastMessageAt?.getTime() ?? 0) - now))
        .toBeLessThan(2000);
      expect
        .soft((current.pendingUntil?.getTime() ?? 0) - now)
        .toBeGreaterThan(147000);
      expect((current.pendingUntil?.getTime() ?? 0) - now).toBeLessThanOrEqual(
        150000
      );
    } finally {
      vi.useRealTimers();
      answer.resolve(reply());
      await outcome;
    }
  });

  it("advances archive batches past a corrupt row and preserves actual partial progress", async () => {
    await db.insert(schema.chatConversations).values(
      Array.from({ length: 102 }, (_, index) => ({
        id: index + 1,
        userId: 9,
        status: "active" as const,
        messageCount: 1,
        lastMessageAt: new Date("2000-01-01T00:00:00Z"),
        context: {},
        ...(index === 0
          ? {
              pendingMessageId: 999999,
              pendingUntil: new Date("2000-01-01T00:00:00Z"),
            }
          : {}),
      }))
    );
    await db.insert(schema.chatMessages).values(
      Array.from({ length: 102 }, (_, index) => ({
        conversationId: index + 1,
        role: "assistant" as const,
        content: "Old synthetic greeting",
      }))
    );
    const result = await archiveOldConversations(7);
    expect.soft(result).toEqual({ archivedCount: 101, failedCount: 1 });
    expect.soft((await row(1)).status).toBe("active");
    const archived = await db
      .select()
      .from(schema.chatConversations)
      .where(eq(schema.chatConversations.status, "archived"));
    expect(archived).toHaveLength(101);
  });

  it("archives a pending turn atomically and fences its later provider reply", async () => {
    await seed();
    const entered = deferred<void>();
    const answer = deferred<ReturnType<typeof reply>>();
    boundary.invoke.mockImplementationOnce(() => {
      entered.resolve();
      return answer.promise;
    });
    const pending = sendMessage({
      userId: 9,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    try {
      await Promise.race([entered.promise, pending]);
      // Force eligibility to exercise explicit closure, not the age scheduler.
      await db
        .update(schema.chatConversations)
        .set({ lastMessageAt: new Date("2000-01-01T00:00:00Z") })
        .where(eq(schema.chatConversations.id, 7));
      expect
        .soft(await archiveOldConversations(7))
        .toEqual({ archivedCount: 1, failedCount: 0 });
      answer.resolve(reply("Late archived answer"));
      expect.soft((await outcome)[0]).toEqual({
        status: "rejected",
        reason: expect.objectContaining({ code: "PRECONDITION_FAILED" }),
      });
      expect.soft(await row()).toMatchObject({
        status: "archived",
        messageCount: 3,
        pendingMessageId: null,
        pendingUntil: null,
      });
      expect.soft(await messages()).toHaveLength(3);
      expect(
        (await messages()).some(
          message => message.content === "Late archived answer"
        )
      ).toBe(false);
    } finally {
      answer.resolve(reply());
      await outcome;
    }
  });
});
