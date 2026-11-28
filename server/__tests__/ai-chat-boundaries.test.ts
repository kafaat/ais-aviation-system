import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatConversations,
  chatMessages,
  bookingSuggestions,
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
const caller = (userId = 1) =>
  aiChatRouter.createCaller({
    user: { id: userId, role: "user" },
    tenantId: 3,
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
    chatConversations,
    chatMessages,
    bookingSuggestions,
  ]);
  fixture.insert(chatConversations, {
    id: 7,
    userId: 1,
    status: "active",
    context: "{}",
    messageCount: 1,
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
        .filter(row => row.role === "assistant")
        .map(row => row.content)
    ).toEqual(["Contact [EMAIL]."]);
    const history = await caller().getHistory({ conversationId: 7 });
    expect(history.find(row => row.role === "assistant")?.content).toBe(
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
    fixture.insert(chatMessages, {
      id: 1,
      conversationId: 7,
      role: "assistant",
      content: "Contact legacy@example.test.",
      metadata: JSON.stringify(metadata),
    });
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
    fixture.insert(chatMessages, {
      id: 1,
      conversationId: 7,
      role: "assistant",
      content: "Contact legacy@example.test.",
    });
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
      { flightId: 11, cabinClass: "business", price: 20000 },
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
      { flightId: 11, cabinClass: "business", price: 20000 },
    ]);
    expect(fixture.rows(bookingSuggestions)).toMatchObject([
      { totalPrice: 40000 },
    ]);
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
