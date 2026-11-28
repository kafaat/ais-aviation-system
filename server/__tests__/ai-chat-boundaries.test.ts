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
import type { TrpcContext } from "../_core/context";
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
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { aiChatRouter } from "../routers/ai-chat";

let fixture: ReturnType<typeof authorityRelationalFixture>;
const caller = (userId = 1, tenantId: number | null = 3) =>
  aiChatRouter.createCaller({
    user: { id: userId, role: "user" },
    tenantId,
    authMethod: "cookie",
  } as TrpcContext);
function providerResponse(content: string) {
  return {
    requestId: "synthetic-provider-response",
    modelUsed: "gemini-2.5-flash",
    result: {
      id: "synthetic-completion",
      created: 1,
      model: "gemini-2.5-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    cost: { inputTokens: 1, outputTokens: 1, totalCost: 0 },
    latencyMs: 1,
    cached: false,
  };
}
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
    openId: "synthetic-ai-owner",
    tenantId: 3,
    role: "user",
  });
  fixture.insert(chatConversations, {
    id: 7,
    userId: 1,
    status: "active",
    context: "{}",
    messageCount: 1,
  });
  fixture.insert(chatMessages, {
    id: 1,
    conversationId: 7,
    role: "assistant",
    content: "Synthetic greeting",
  });
  boundary.db = fixture.db;
  boundary.invoke
    .mockReset()
    .mockResolvedValue(providerResponse("Where would you like to go?"));
  boundary.search.mockReset().mockResolvedValue([]);
});
afterEach(() => fixture.close());

/** SQLite exercises the production Drizzle query/response paths. The provider
 * and search boundary are synthetic; this is not MySQL or model evaluation. */
describe("assistant response privacy across persistence and reuse", () => {
  it("stores the same masked provider content returned to the owner and reused in the next prompt", async () => {
    boundary.invoke.mockResolvedValueOnce(
      providerResponse("Contact model-contact@example.test.")
    );
    const response = await caller().sendMessage({
      conversationId: 7,
      message: "An economy seat, please.",
    });
    expect(response.message).toBe("Contact [EMAIL].");
    expect(
      fixture
        .rows(chatMessages)
        .filter(row => row.role === "assistant" && row.id !== 1)
        .map(row => row.content)
    ).toEqual(["Contact [EMAIL]."]);
    const history = await caller().getHistory({ conversationId: 7 });
    expect(history.findLast(row => row.role === "assistant")?.content).toBe(
      "Contact [EMAIL]."
    );
    await caller().sendMessage({
      conversationId: 7,
      message: "What cabin options are available?",
    });
    const prompt = boundary.invoke.mock.calls[1][0].messages;
    expect(prompt).toContainEqual({
      role: "assistant",
      content: "Contact [EMAIL].",
    });
    expect(JSON.stringify(prompt)).not.toContain("model-contact@example.test");
  });

  it("masks a legacy assistant row for history and future prompts without rewriting it or its metadata", async () => {
    const metadata = {
      intent: "legacy_note",
      suggestions: [5],
      entities: { source: "https://example.test/policy", article: 5 },
    };
    fixture.sqlite
      .prepare("UPDATE chat_messages SET content=?, metadata=? WHERE id=1")
      .run("Contact legacy@example.test.", JSON.stringify(metadata));
    const storedBefore = fixture.rows(chatMessages);
    const history = await caller().getHistory({ conversationId: 7 });
    expect(history[0].content).toBe("Contact [EMAIL].");
    expect(history[0].metadata).toEqual(metadata);
    expect(fixture.rows(chatMessages)).toEqual(storedBefore);
    await caller().sendMessage({
      conversationId: 7,
      message: "An economy seat, please.",
    });
    const prompt = boundary.invoke.mock.calls[0][0].messages;
    expect(prompt).toContainEqual({
      role: "assistant",
      content: "Contact [EMAIL].",
    });
    expect(JSON.stringify(prompt)).not.toContain("legacy@example.test");
    expect(fixture.rows(chatMessages).find(row => row.id === 1)).toEqual(
      storedBefore[0]
    );
  });

  it("keeps both history and message submission unavailable to another owner", async () => {
    fixture.sqlite
      .prepare("UPDATE chat_messages SET content=? WHERE id=1")
      .run("Contact legacy@example.test.");
    const before = fixture.rows(chatMessages);
    await expect(
      caller(2).getHistory({ conversationId: 7 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller(2).sendMessage({ conversationId: 7, message: "Hello" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows(chatMessages)).toEqual(before);
    expect(boundary.invoke).not.toHaveBeenCalled();
  });
});

describe("exchange referral uses current purchaser authority", () => {
  beforeEach(() => {
    const eligible = {
      userId: 1,
      tenantId: 3,
      status: "confirmed",
      paymentStatus: "paid",
      deletedAt: null,
    };
    for (const booking of [
      { id: 100, bookingReference: "OWN003" },
      { id: 101, bookingReference: "OWN004", tenantId: 4 },
      { id: 102, bookingReference: "PERSON", tenantId: null },
      { id: 103, bookingReference: "OTHUSR", userId: 2 },
      { id: 104, bookingReference: "UNPAID", paymentStatus: "pending" },
      { id: 105, bookingReference: "CANCEL", status: "cancelled" },
      {
        id: 106,
        bookingReference: "ERASED",
        deletedAt: "2026-11-28 12:00:00",
      },
    ])
      fixture.insert(bookings, { ...eligible, ...booking });
  });

  async function requestExchange(tenantId: number | null) {
    const before = fixture.rows(bookings);
    const response = await caller(1, tenantId).sendMessage({
      conversationId: 7,
      message: "Change my booking PNR OWN003",
    });
    expect(fixture.rows(bookings)).toEqual(before);
    expect(fixture.rows(inventoryLocks)).toEqual([]);
    expect(fixture.rows(seatHolds)).toEqual([]);
    expect(fixture.rows(bookingSuggestions)).toEqual([]);
    expect(JSON.stringify(fixture.rows(chatMessages))).not.toMatch(
      /OWN003|OWN004|PERSON|OTHUSR|UNPAID|CANCEL|ERASED/
    );
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
    return response;
  }

  it("lists a genuinely unassigned buyer's own eligible airline bookings", async () => {
    fixture.sqlite.prepare("UPDATE users SET tenantId=NULL WHERE id=1").run();
    const response = await requestExchange(null);
    expect(response.exchangeBookings).toEqual([
      { id: 102, bookingReference: "PERSON" },
      { id: 101, bookingReference: "OWN004" },
      { id: 100, bookingReference: "OWN003" },
    ]);
    expect(fixture.rows(chatMessages)).toHaveLength(3);
    expect(fixture.rows(chatConversations)[0].messageCount).toBe(3);
  });

  it.each([3, null])(
    "restricts an assigned buyer to the actual tenant with request scope %s",
    async requestTenant => {
      const response = await requestExchange(requestTenant);
      expect(response.exchangeBookings).toEqual([
        { id: 100, bookingReference: "OWN003" },
      ]);
      const userRead = fixture.queries.findIndex(query =>
        /from `users` .*for share$/i.test(query.sql)
      );
      const bookingRead = fixture.queries.findIndex(query =>
        /from `bookings` /i.test(query.sql)
      );
      expect(userRead).toBeGreaterThanOrEqual(0);
      expect(bookingRead).toBeGreaterThan(userRead);
      expect(fixture.queries[userRead].inTransaction).toBe(true);
      expect(fixture.queries[bookingRead].inTransaction).toBe(true);
      // SQLite records lock clauses but does not simulate MySQL locking.
      expect(fixture.queries[bookingRead].sql).not.toMatch(
        /for (update|share)/i
      );
    }
  );

  it("does not disclose a former tenant's bookings through a stale assigned context", async () => {
    fixture.sqlite.prepare("UPDATE users SET tenantId=4 WHERE id=1").run();
    const response = await requestExchange(3);
    expect(response.exchangeBookings).toEqual([]);
  });

  it("rejects a missing current user before recording a referral or returning references", async () => {
    fixture.sqlite.prepare("DELETE FROM users WHERE id=1").run();
    const before = fixture.rows(bookings);
    await expect(
      caller(1, null).sendMessage({
        conversationId: 7,
        message: "Change my booking",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows(bookings)).toEqual(before);
    expect(fixture.rows(chatMessages)).toMatchObject([
      { id: 1, content: "Synthetic greeting" },
    ]);
    expect(fixture.rows(chatConversations)[0].messageCount).toBe(1);
    expect(boundary.invoke).not.toHaveBeenCalled();
  });
});

describe("explicit chat route context reaches deterministic flight search", () => {
  beforeEach(() => {
    boundary.search.mockResolvedValue([
      {
        id: 11,
        airlineId: 3,
        originId: 1,
        destinationId: 2,
        flightNumber: "TEST11",
        status: "scheduled",
        departureTime: new Date("2030-06-10T09:00:00Z"),
        arrivalTime: new Date("2030-06-10T11:00:00Z"),
        economyPrice: 10000,
        businessPrice: 20000,
        economyAvailable: 10,
        businessAvailable: 4,
        airline: { id: 3, name: "Synthetic Airline", code: "TS" },
        origin: { id: 1, city: "Origin", timezone: "Asia/Riyadh" },
        destination: { id: 2, city: "Destination", timezone: "Asia/Riyadh" },
      },
    ]);
  });

  it("searches the explicit initial route and stores the independently derived cabin and passenger total", async () => {
    const chat = caller();
    const { conversationId } = await chat.startConversation({
      initialContext: {
        originId: 1,
        destinationId: 2,
        departureDate: "2030-06-10",
        passengers: 2,
        cabinClass: "business",
      },
    });
    const response = await chat.sendMessage({
      conversationId,
      message: "Show available options.",
    });
    expect(boundary.search).toHaveBeenCalledExactlyOnceWith({
      originId: 1,
      destinationId: 2,
      departureDate: "2030-06-10",
    });
    expect(response.bookingReady).toBe(true);
    expect(response.suggestions).toMatchObject([
      { flightId: 11, cabinClass: "business", price: 20000, passengers: 2 },
    ]);
    expect(fixture.rows(bookingSuggestions)).toMatchObject([
      {
        conversationId,
        flightId: 11,
        pricePerPerson: 20000,
        totalPrice: 40000,
        currency: "SAR",
      },
    ]);
  });

  it("accumulates a date and passenger count on a later turn without losing the explicit route or cabin", async () => {
    const chat = caller();
    const { conversationId } = await chat.startConversation({
      initialContext: { originId: 1, destinationId: 2 },
    });
    const incomplete = await chat.sendMessage({
      conversationId,
      message: "Business class, please.",
    });
    expect(incomplete.bookingReady).toBe(false);
    expect(boundary.search).not.toHaveBeenCalled();
    const response = await chat.sendMessage({
      conversationId,
      message: "2 passengers on 2030-06-10",
    });
    expect(boundary.search).toHaveBeenCalledExactlyOnceWith({
      originId: 1,
      destinationId: 2,
      departureDate: "2030-06-10",
    });
    expect(response.bookingReady).toBe(true);
    expect(response.suggestions).toMatchObject([
      { flightId: 11, cabinClass: "business", price: 20000, passengers: 2 },
    ]);
    expect(fixture.rows(bookingSuggestions)).toMatchObject([
      { totalPrice: 40000 },
    ]);
  });

  it("retains each suggestion's immutable party count after later context changes, independently of prices", async () => {
    const chat = caller();
    const { conversationId } = await chat.startConversation({
      initialContext: {
        originId: 1,
        destinationId: 2,
        departureDate: "2030-06-10",
        passengers: 2,
        cabinClass: "business",
      },
    });
    const first = await chat.sendMessage({
      conversationId,
      message: "Show options.",
    });
    const originalId = first.suggestions![0].id;
    const later = await chat.sendMessage({
      conversationId,
      message: "3 passengers",
    });
    expect(later.suggestions![0]).toMatchObject({ passengers: 3 });
    const original = fixture
      .rows(bookingSuggestions)
      .find(row => row.id === originalId)!;
    expect(original.messageId).toBeTypeOf("number");
    const turn = (await chat.getHistory({ conversationId })).find(
      row => row.id === original.messageId
    )!;
    expect(turn.role).toBe("assistant");
    expect(turn.metadata).toMatchObject({
      suggestions: [originalId],
      entities: { passengers: 2 },
    });
    fixture.sqlite
      .prepare(
        "UPDATE booking_suggestions SET pricePerPerson=0,totalPrice=0 WHERE id=?"
      )
      .run(originalId);
    const stored = await chat.getSuggestions({ conversationId });
    expect(stored.find(row => row.id === originalId)).toMatchObject({
      passengers: 2,
      pricePerPerson: 0,
      totalPrice: 0,
    });
    expect(
      stored.find(row => row.id === later.suggestions![0].id)
    ).toMatchObject({ passengers: 3 });
    await expect(
      chat.selectSuggestion({ suggestionId: originalId })
    ).resolves.toMatchObject({
      flightId: 11,
      cabinClass: "business",
      price: 0,
      passengers: 2,
    });
  });

  it("does not invent route identifiers from city names or provider-produced JSON", async () => {
    boundary.invoke.mockResolvedValue(
      providerResponse(
        '{"intent":"search_flights","originId":1,"destinationId":2,"date":"2030-06-10"}'
      )
    );
    const response = await caller().sendMessage({
      conversationId: 7,
      message: "Riyadh to Jeddah, 2 passengers on 2030-06-10",
    });
    expect(response.bookingReady).toBe(false);
    expect(response.suggestions).toBeUndefined();
    expect(boundary.search).not.toHaveBeenCalled();
    expect(fixture.rows(bookingSuggestions)).toEqual([]);
  });

  it.each([
    { originId: -1 },
    { originId: 1.5 },
    { destinationId: 0 },
    { destinationId: 1 },
    { departureDate: "not-a-date" },
    { departureDate: "2030-02-30" },
    { passengers: 1.5 },
  ])("refuses to mark or search invalid supplied context %j", async invalid => {
    const chat = caller();
    const { conversationId } = await chat.startConversation({
      initialContext: {
        originId: 1,
        destinationId: 2,
        departureDate: "2030-06-10",
        passengers: 2,
        ...invalid,
      },
    });
    const response = await chat.sendMessage({
      conversationId,
      message: "Show available options.",
    });
    expect(response.bookingReady).toBe(false);
    expect(response.suggestions).toBeUndefined();
    expect(boundary.search).not.toHaveBeenCalled();
    expect(fixture.rows(bookingSuggestions)).toEqual([]);
  });
});

describe("stored suggestion party count compatibility", () => {
  it.each([
    { name: "missing legacy snapshot", message: null },
    {
      name: "another conversation",
      message: {
        conversationId: 8,
        role: "assistant",
        passengers: 2,
        suggestions: [40],
      },
    },
    {
      name: "a user message",
      message: {
        conversationId: 7,
        role: "user",
        passengers: 2,
        suggestions: [40],
      },
    },
    {
      name: "an invalid count",
      message: {
        conversationId: 7,
        role: "assistant",
        passengers: 10,
        suggestions: [40],
      },
    },
    {
      name: "an unrelated assistant turn",
      message: {
        conversationId: 7,
        role: "assistant",
        passengers: 2,
        suggestions: [41],
      },
    },
  ])(
    "reports unknown count for $name without inferring it from money",
    async ({ message }) => {
      if (message)
        fixture.insert(chatMessages, {
          id: 50,
          conversationId: message.conversationId,
          role: message.role,
          content: "Synthetic",
          metadata: JSON.stringify({
            suggestions: message.suggestions,
            entities: { passengers: message.passengers },
          }),
        });
      fixture.insert(bookingSuggestions, {
        id: 40,
        conversationId: 7,
        messageId: message ? 50 : null,
        flightId: 11,
        cabinClass: "economy",
        pricePerPerson: 10000,
        totalPrice: 90000,
      });
      const before = fixture.rows(bookingSuggestions);
      await expect(
        caller(2).getSuggestions({ conversationId: 7 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        caller(2).selectSuggestion({ suggestionId: 40 })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fixture.rows(bookingSuggestions)).toEqual(before);
      expect(
        (await caller().getSuggestions({ conversationId: 7 }))[0]
      ).toMatchObject({ passengers: null });
      await expect(
        caller().selectSuggestion({ suggestionId: 40 })
      ).resolves.toMatchObject({ passengers: null });
    }
  );
});

describe("chat suggestion capacity before shortlist selection", () => {
  const flight = (
    id: number,
    economyAvailable: number,
    businessAvailable: number
  ) => ({
    id,
    departureTime: new Date("2030-06-10T09:00:00Z"),
    arrivalTime: new Date("2030-06-10T11:00:00Z"),
    economyPrice: 10000,
    businessPrice: 20000,
    economyAvailable,
    businessAvailable,
    airline: { name: "Synthetic Airline" },
    origin: { city: "Origin", timezone: "UTC" },
    destination: { city: "Destination", timezone: "UTC" },
  });
  async function request(cabinClass: "economy" | "business", passengers = 2) {
    const chat = caller();
    const { conversationId } = await chat.startConversation({
      initialContext: {
        originId: 1,
        destinationId: 2,
        departureDate: "2030-06-10",
        cabinClass,
        passengers,
      },
    });
    return chat.sendMessage({ conversationId, message: "Show options." });
  }

  it("filters a sold-out cabin and insufficient party capacity before taking the first three flights", async () => {
    boundary.search.mockResolvedValue([
      flight(11, 20, 0),
      flight(12, 20, 1),
      flight(13, 20, 2),
      flight(14, 0, 3),
      flight(15, 0, 5),
      flight(16, 0, 4),
      flight(17, 0, 4),
    ]);
    const result = await request("business", 3);
    expect(result.suggestions?.map(suggestion => suggestion.flightId)).toEqual([
      14, 15, 16,
    ]);
    expect(
      fixture.rows(bookingSuggestions).map(suggestion => suggestion.flightId)
    ).toEqual([14, 15, 16]);
  });

  it.each([
    ["economy", [12]],
    ["business", [11]],
  ] as const)(
    "uses %s capacity rather than the other cabin",
    async (cabin, expected) => {
      boundary.search.mockResolvedValue([flight(11, 0, 5), flight(12, 3, 1)]);
      const result = await request(cabin);
      expect(
        result.suggestions?.map(suggestion => suggestion.flightId)
      ).toEqual(expected);
    }
  );

  it("subtracts active canonical and unlinked legacy holds once, ignoring aliases, expired holds and other cabins", async () => {
    boundary.search.mockResolvedValue([
      flight(11, 20, 5),
      flight(12, 20, 4),
      flight(13, 20, 2),
      flight(14, 20, 2),
      flight(15, 20, 2),
    ]);
    const active = {
      cabinClass: "business",
      status: "active",
      sessionId: "synthetic-hold",
      expiresAt: "2035-01-01 00:00:00",
    };
    fixture.insert(inventoryLocks, {
      ...active,
      id: 1,
      flightId: 11,
      numberOfSeats: 2,
    });
    fixture.insert(seatHolds, {
      ...active,
      id: 1,
      flightId: 11,
      seats: 2,
      inventoryLockId: null,
    });
    fixture.insert(inventoryLocks, {
      ...active,
      id: 2,
      flightId: 12,
      numberOfSeats: 2,
    });
    fixture.insert(seatHolds, {
      ...active,
      id: 2,
      flightId: 12,
      seats: 2,
      inventoryLockId: 2,
    });
    fixture.insert(inventoryLocks, {
      ...active,
      id: 3,
      flightId: 13,
      numberOfSeats: 100,
      expiresAt: "2000-01-01 00:00:00",
    });
    fixture.insert(inventoryLocks, {
      ...active,
      id: 4,
      flightId: 13,
      numberOfSeats: 100,
      status: "converted",
    });
    fixture.insert(seatHolds, {
      ...active,
      id: 3,
      flightId: 13,
      seats: 100,
      inventoryLockId: null,
      status: "released",
    });
    fixture.insert(inventoryLocks, {
      ...active,
      id: 5,
      flightId: 14,
      numberOfSeats: 100,
      cabinClass: "economy",
    });
    fixture.insert(seatHolds, {
      ...active,
      id: 4,
      flightId: 15,
      seats: 1,
      inventoryLockId: null,
    });
    const before = {
      canonical: fixture.rows(inventoryLocks),
      legacy: fixture.rows(seatHolds),
    };
    const result = await request("business");
    expect(result.suggestions?.map(suggestion => suggestion.flightId)).toEqual([
      12, 13, 14,
    ]);
    expect({
      canonical: fixture.rows(inventoryLocks),
      legacy: fixture.rows(seatHolds),
    }).toEqual(before);
  });
});
