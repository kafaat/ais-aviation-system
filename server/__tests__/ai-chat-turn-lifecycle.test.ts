import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import {
  users,
  bookings,
  chatConversations,
  chatMessages,
  bookingSuggestions,
  inventoryLocks,
  seatHolds,
} from "../../drizzle/schema";
import { authorityRelationalFixture } from "./helpers/authority-relational-fixture";

const boundary = vi.hoisted(() => ({
  db: null as ReturnType<typeof authorityRelationalFixture>["db"] | null,
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
  getConversationHistory,
  sendMessage,
  startConversation,
} from "../services/ai-chat-booking.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const reply = (content = "Synthetic reply") => ({
  result: { choices: [{ message: { role: "assistant", content } }] },
});

describe("chat deadline and lazy recovery boundaries", () => {
  function interruptedTurn() {
    seed(1);
    fixture.insert(chatMessages, {
      id: 2,
      conversationId: 7,
      role: "user",
      content: "2 passengers",
    });
    fixture.sqlite.exec(
      "UPDATE chat_conversations SET messageCount=2, pendingMessageId=2, pendingUntil='2000-01-01 00:00:00.000' WHERE id=7"
    );
  }

  it.each(["Business class", "refund policy"])(
    "keeps recovery committed when the current input %s expires before admission",
    async message => {
      interruptedTurn();
      vi.spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValue(120_001);
      await expect(
        sendMessage({ userId: 1, conversationId: 7, message })
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      const rows = fixture.rows(chatMessages);
      expect(rows).toHaveLength(3);
      expect(rows.at(-1)).toMatchObject({ role: "assistant" });
      expect(String(rows.at(-1)?.content)).toContain(
        "Sorry, an error occurred"
      );
      expect(fixture.rows(chatConversations)[0]).toMatchObject({
        messageCount: 3,
        context: JSON.stringify({ passengers: 2 }),
        pendingMessageId: null,
        pendingUntil: null,
      });
      expect(boundary.invoke).not.toHaveBeenCalled();
      expect(boundary.search).not.toHaveBeenCalled();
    }
  );

  it("keeps expired dormant history read-only and supplies recovered context/history to the next accepted turn", async () => {
    interruptedTurn();
    // A seeded interrupted turn, not a worker process-kill experiment.
    const before = fixture.rows(chatConversations);
    const history = await getConversationHistory(7, 1);
    expect(history.map(message => message.id)).toEqual([1, 2]);
    expect(fixture.rows(chatConversations)).toEqual(before);
    expect(fixture.rows(chatMessages)).toHaveLength(2);
    await sendMessage({
      userId: 1,
      conversationId: 7,
      message: "Business class",
    });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    const prompt = boundary.invoke.mock.calls[0][0].messages;
    expect(prompt.slice(-3)).toEqual([
      { role: "user", content: "2 passengers" },
      {
        role: "assistant",
        content: expect.stringContaining("Sorry, an error occurred"),
      },
      { role: "user", content: "Business class" },
    ]);
    expect(fixture.rows(chatConversations)[0]).toMatchObject({
      messageCount: 5,
      context: JSON.stringify({ passengers: 2, cabinClass: "business" }),
      pendingMessageId: null,
    });
  });

  it("refuses a deterministic referral behind an accepted ordinary turn, without another transcript row", async () => {
    seed();
    const entered = deferred<void>();
    const answer = deferred<ReturnType<typeof reply>>();
    boundary.invoke.mockImplementationOnce(() => {
      entered.resolve();
      return answer.promise;
    });
    const pending = sendMessage({
      userId: 1,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    try {
      await Promise.race([entered.promise, pending]);
      await expect(
        sendMessage({
          userId: 1,
          conversationId: 7,
          message: "change my booking",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixture.rows(chatMessages)).toHaveLength(2);
      expect(boundary.invoke).toHaveBeenCalledTimes(1);
      expect(fixture.rows(bookingSuggestions)).toEqual([]);
    } finally {
      answer.resolve(reply());
      await outcome;
    }
  });

  it("completes one friendly fallback at the preparation deadline and discards a late provider rejection", async () => {
    seed(1, { originId: 1, destinationId: 2, departureDate: "2030-06-10" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const entered = deferred<void>();
    const answer = deferred<ReturnType<typeof reply>>();
    let signal!: AbortSignal;
    boundary.invoke.mockImplementationOnce(request => {
      signal = request.signal;
      entered.resolve();
      return answer.promise;
    });
    const pending = sendMessage({
      userId: 1,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    try {
      await Promise.race([entered.promise, pending]);
      await vi.advanceTimersByTimeAsync(120_001);
      expect(signal.aborted).toBe(true);
      expect(await pending).toMatchObject({
        message: expect.stringContaining("Sorry, an error occurred"),
        suggestions: undefined,
      });
      const completed = fixture.rows(chatConversations);
      expect(completed[0]).toMatchObject({
        messageCount: 3,
        pendingMessageId: null,
        pendingUntil: null,
        context: JSON.stringify({
          originId: 1,
          destinationId: 2,
          departureDate: "2030-06-10",
          passengers: 2,
        }),
      });
      expect(boundary.search).not.toHaveBeenCalled();
      answer.reject(new Error("synthetic late provider rejection"));
      await answer.promise.catch(() => undefined);
      expect(fixture.rows(chatConversations)).toEqual(completed);
      expect(fixture.rows(chatMessages)).toHaveLength(3);
    } finally {
      answer.resolve(reply());
      await outcome;
    }
  });

  it("keeps an obtained answer when optional search exceeds the deadline and never begins later read stages", async () => {
    seed(1, { originId: 1, destinationId: 2, departureDate: "2030-06-10" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const entered = deferred<void>();
    const search = deferred<never[]>();
    boundary.search.mockImplementationOnce(() => {
      entered.resolve();
      return search.promise;
    });
    const pending = sendMessage({
      userId: 1,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    try {
      await Promise.race([entered.promise, pending]);
      await vi.advanceTimersByTimeAsync(120_001);
      expect(await pending).toMatchObject({
        message: "Synthetic reply",
        suggestions: undefined,
      });
      const queriesAfterCompletion = fixture.queries.length;
      search.resolve([]);
      await search.promise;
      await Promise.resolve();
      expect(fixture.queries).toHaveLength(queriesAfterCompletion);
      expect(fixture.rows(bookingSuggestions)).toEqual([]);
      expect(fixture.rows(chatMessages)).toHaveLength(3);
      expect(
        fixture.queries.some(query =>
          /from `(?:inventory_locks|seat_holds)`/.test(query.sql)
        )
      ).toBe(false);
    } finally {
      search.resolve([]);
      await outcome;
    }
  });

  it("uses DB cleanup time despite a far-future worker clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2090-01-01T00:00:00Z"));
    const { conversationId } = await startConversation({ userId: 1 });
    expect(await archiveOldConversations(7)).toEqual({
      archivedCount: 0,
      failedCount: 0,
    });
    expect(fixture.rows(chatConversations)[0]).toMatchObject({
      id: conversationId,
      status: "active",
    });
  });

  it("fails closed on a counted legacy transcript mismatch before provider or transcript writes", async () => {
    seed(3);
    fixture.sqlite.exec(
      "UPDATE chat_conversations SET messageCount=1 WHERE id=7"
    );
    const before = fixture.rows(chatMessages);
    await expect(
      sendMessage({ userId: 1, conversationId: 7, message: "Hello" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows(chatMessages)).toEqual(before);
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
  });
});

let fixture: ReturnType<typeof authorityRelationalFixture>;
beforeEach(() => {
  fixture = authorityRelationalFixture([
    users,
    bookings,
    chatConversations,
    chatMessages,
    bookingSuggestions,
    inventoryLocks,
    seatHolds,
  ]);
  fixture.insert(users, {
    id: 1,
    openId: "synthetic-chat-turn-owner",
    role: "user",
  });
  boundary.db = fixture.db;
  boundary.invoke.mockReset().mockResolvedValue(reply());
  boundary.search.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fixture.close();
});

function seed(count = 1, context: Record<string, unknown> = {}) {
  fixture.insert(chatConversations, {
    id: 7,
    userId: 1,
    status: "active",
    messageCount: count,
    context: JSON.stringify(context),
  });
  for (let id = 1; id <= count; id++)
    fixture.insert(chatMessages, {
      id,
      conversationId: 7,
      role: id === 1 || id % 2 === 0 ? "assistant" : "user",
      content: "Earlier synthetic message",
    });
}

/** Real service/SQL with SQLite and a controlled gateway. This is not proof of
 * MySQL contention; the native suite repeats the service-boundary races. */
describe("durable chat turn admission and persistence", () => {
  it("admits only one turn at 98 and preserves count/context through overlapping provider waits", async () => {
    seed(98);
    const firstEntered = deferred<void>();
    const secondEntered = deferred<void>();
    const firstReply = deferred<ReturnType<typeof reply>>();
    const secondReply = deferred<ReturnType<typeof reply>>();
    boundary.invoke
      .mockImplementationOnce(() => {
        firstEntered.resolve();
        return firstReply.promise;
      })
      .mockImplementationOnce(() => {
        secondEntered.resolve();
        return secondReply.promise;
      });
    const first = sendMessage({
      userId: 1,
      conversationId: 7,
      message: "2 passengers",
    });
    const firstOutcome = Promise.allSettled([first]);
    await Promise.race([firstEntered.promise, first]);
    const second = sendMessage({
      userId: 1,
      conversationId: 7,
      message: "Business class",
    });
    const secondOutcome = Promise.allSettled([second]);
    try {
      await Promise.race([secondOutcome, secondEntered.promise]);
      firstReply.resolve(reply("First reply"));
      await firstOutcome;
      secondReply.resolve(reply("Second reply"));
      const [outcome] = await secondOutcome;
      expect.soft(outcome).toEqual({
        status: "rejected",
        reason: expect.objectContaining({ code: "CONFLICT" }),
      });
      const conversation = fixture.rows(chatConversations)[0];
      expect.soft(fixture.rows(chatMessages)).toHaveLength(100);
      expect.soft(conversation.messageCount).toBe(100);
      expect.soft(JSON.parse(String(conversation.context))).toEqual({
        passengers: 2,
      });
      expect(boundary.invoke).toHaveBeenCalledTimes(1);
    } finally {
      firstReply.resolve(reply());
      secondReply.resolve(reply());
      await Promise.allSettled([first, second]);
    }
  });

  it("counts the accepted user row accurately while its provider is pending", async () => {
    seed(98);
    const entered = deferred<void>();
    const answer = deferred<ReturnType<typeof reply>>();
    boundary.invoke.mockImplementationOnce(() => {
      entered.resolve();
      return answer.promise;
    });
    const pending = sendMessage({
      userId: 1,
      conversationId: 7,
      message: "2 passengers",
    });
    const outcome = Promise.allSettled([pending]);
    try {
      await Promise.race([entered.promise, pending]);
      expect(fixture.rows(chatMessages)).toHaveLength(99);
      expect(fixture.rows(chatConversations)[0].messageCount).toBe(99);
    } finally {
      answer.resolve(reply());
      await outcome;
    }
  });

  it("rolls back suggestion writes when the assistant insert fails", async () => {
    seed(1, {
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
    fixture.sqlite.exec(`
      CREATE TRIGGER reject_chat_answer BEFORE INSERT ON chat_messages
      WHEN NEW.role = 'assistant'
      BEGIN SELECT RAISE(ABORT, 'synthetic assistant failure'); END;
    `);
    await expect(
      sendMessage({ userId: 1, conversationId: 7, message: "2 passengers" })
    ).rejects.toThrow();
    expect.soft(fixture.rows(bookingSuggestions)).toEqual([]);
    expect(fixture.rows(chatMessages)).toHaveLength(2);
    expect(fixture.rows(chatConversations)[0].messageCount).toBe(2);
  });

  it("uses database activity time when the worker wall clock is years behind", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
    await startConversation({ userId: 1 });
    const row = fixture.rows(chatConversations)[0];
    const now = fixture.sqlite
      .prepare("SELECT CURRENT_TIMESTAMP AS now")
      .get() as { now: string };
    const databaseTime = Date.parse(now.now.replace(" ", "T") + "Z");
    const activity = Date.parse(
      String(row.lastMessageAt).replace(" ", "T") + "Z"
    );
    expect(Math.abs(activity - databaseTime)).toBeLessThan(2000);
  });
});
