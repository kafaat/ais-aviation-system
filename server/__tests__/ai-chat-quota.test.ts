import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  sendMessage,
  startConversation,
} from "../services/ai-chat-booking.service";

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
  boundary.db = fixture.db;
  fixture.insert(users, {
    id: 1,
    openId: "synthetic-chat-quota-owner",
    role: "user",
  });
  boundary.invoke.mockReset().mockResolvedValue({
    result: {
      choices: [{ message: { role: "assistant", content: "Synthetic reply" } }],
    },
  });
  boundary.search.mockReset().mockResolvedValue([
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
});
afterEach(() => fixture.close());

/** This fixture executes production SQL and rollback on SQLite. Native locking
 * and concurrent admission are exercised separately in the MySQL suite. */
describe("chat creation persistence", () => {
  it("persists one greeting and an accurate initial count for its owner", async () => {
    const response = await startConversation({
      userId: 1,
      initialContext: { originId: 1, destinationId: 2 },
    });
    expect(fixture.rows(chatConversations)).toEqual([
      expect.objectContaining({
        id: response.conversationId,
        userId: 1,
        status: "active",
        messageCount: 1,
        context: JSON.stringify({ originId: 1, destinationId: 2 }),
      }),
    ]);
    expect(fixture.rows(chatMessages)).toEqual([
      expect.objectContaining({
        conversationId: response.conversationId,
        role: "assistant",
        content: response.greeting,
      }),
    ]);
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
  });

  it("rejects a missing owner before persisting a conversation or greeting", async () => {
    await expect(startConversation({ userId: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixture.rows(chatConversations)).toEqual([]);
    expect(fixture.rows(chatMessages)).toEqual([]);
  });

  it("rolls back the conversation when its greeting cannot be stored", async () => {
    fixture.sqlite.exec(`
      CREATE TRIGGER reject_chat_greeting BEFORE INSERT ON chat_messages
      BEGIN SELECT RAISE(ABORT, 'synthetic greeting failure'); END;
    `);
    await expect(startConversation({ userId: 1 })).rejects.toThrow();
    expect(fixture.rows(chatConversations)).toEqual([]);
    expect(fixture.rows(chatMessages)).toEqual([]);

    fixture.sqlite.exec("DROP TRIGGER reject_chat_greeting");
    const response = await startConversation({ userId: 1 });
    expect(fixture.rows(chatConversations)).toEqual([
      expect.objectContaining({ id: response.conversationId, messageCount: 1 }),
    ]);
    expect(fixture.rows(chatMessages)).toHaveLength(1);
  });
});

function seedTranscript(count: number) {
  fixture.insert(chatConversations, {
    id: 7,
    userId: 1,
    status: "active",
    messageCount: count,
    context: JSON.stringify({
      originId: 1,
      destinationId: 2,
      departureDate: "2030-06-10",
      passengers: 1,
      cabinClass: "economy",
    }),
  });
  for (let id = 1; id <= count; id++)
    fixture.insert(chatMessages, {
      id,
      conversationId: 7,
      role: id === 1 || id % 2 === 0 ? "assistant" : "user",
      content: "Synthetic earlier message",
    });
}

const turns = [
  { path: "ordinary", message: "2 passengers" },
  { path: "rights referral", message: "refund policy" },
  { path: "exchange referral", message: "change my booking" },
];

describe.each(turns)("$path transcript quota", ({ path, message }) => {
  it.each([99, 100])(
    "rejects at %i rows before provider, suggestions, or transcript writes",
    async count => {
      seedTranscript(count);
      const before = {
        conversations: fixture.rows(chatConversations),
        messages: fixture.rows(chatMessages),
        suggestions: fixture.rows(bookingSuggestions),
      };
      await expect(
        sendMessage({ conversationId: 7, userId: 1, message })
      ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect(fixture.rows(chatConversations)).toEqual(before.conversations);
      expect(fixture.rows(chatMessages)).toEqual(before.messages);
      expect(fixture.rows(bookingSuggestions)).toEqual(before.suggestions);
      expect(boundary.invoke).not.toHaveBeenCalled();
      expect(boundary.search).not.toHaveBeenCalled();
    }
  );

  it("allows one complete turn at 98 rows and stops at exactly 100", async () => {
    seedTranscript(98);
    const response = await sendMessage({
      conversationId: 7,
      userId: 1,
      message,
    });
    const messages = fixture.rows(chatMessages);
    expect(messages).toHaveLength(100);
    expect(messages.slice(-2)).toEqual([
      expect.objectContaining({ conversationId: 7, role: "user" }),
      expect.objectContaining({
        conversationId: 7,
        role: "assistant",
        content: response.message,
      }),
    ]);
    expect(fixture.rows(chatConversations)[0].messageCount).toBe(100);
    if (path === "ordinary") {
      expect(response.message).toBe("Synthetic reply");
      expect(response.suggestions).toHaveLength(1);
      expect(fixture.rows(bookingSuggestions)).toHaveLength(1);
    } else {
      expect(fixture.rows(bookingSuggestions)).toEqual([]);
      expect(boundary.invoke).not.toHaveBeenCalled();
    }
  });
});
