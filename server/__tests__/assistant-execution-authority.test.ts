import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";
import { aiChatRouter } from "../routers/ai-chat";
import {
  assertAssistantExecutionAuthorised,
  assistantOfferVersion,
  issueSelfServiceCapability,
} from "../services/self-service-capability.service";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof transactionMemory>["db"] | null,
  invoke: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/intelligence/gateway", () => ({
  aiGateway: { invoke: state.invoke },
}));
vi.mock("../services/flights.service", () => ({ searchFlights: state.search }));
vi.mock("../services/rate-limit.service", () => ({ rateLimitService: {} }));

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const secret = "test-assistant-execution-secret-0123456789abcdef";
const moneyTables = [
  "bookings",
  "payments",
  "payment_receipts",
  "financial_ledger",
  "inventory_locks",
  "booking_modifications",
  "wallet_transactions",
  "user_credits",
  "credit_usage",
  "loyalty_transactions",
];

function caller(id: number | null = 1) {
  return aiChatRouter.createCaller({
    user: id === null ? null : { id, role: "user" },
    tenantId: null,
    authMethod: "cookie",
  } as TrpcContext);
}

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    chat_conversations: [
      { id: 7, userId: 1, status: "active", context: {}, messageCount: 1 },
    ],
    booking_suggestions: [
      {
        id: 3,
        conversationId: 7,
        flightId: 11,
        cabinClass: "economy",
        pricePerPerson: 25000,
        totalPrice: 50000,
        currency: "SAR",
        selected: "pending",
        selectedAt: null,
        messageId: null,
        rank: 1,
        score: null,
        reason: null,
        expiresAt: null,
        createdAt: new Date("2026-11-03T10:00:00Z"),
      },
    ],
    ...Object.fromEntries(moneyTables.map(name => [name, []])),
  });
  state.db = withSuggestionJoin(fixture);
});

/** The memory double has no innerJoin; selectSuggestion joins the suggestion
 * to its conversation for ownership. Resolve that one join from the fixture. */
function withSuggestionJoin(memory: ReturnType<typeof transactionMemory>) {
  const base = memory.db;
  return {
    ...base,
    select: (projection?: Record<string, unknown>) => {
      const chain = base.select(projection);
      if (!projection || !("suggestion" in projection)) return chain;
      return {
        from: () => ({
          innerJoin: () => ({
            where: async (predicate: SQL) => {
              const id = Number(
                new MySqlDialect().sqlToQuery(predicate).params[0]
              );
              return memory
                .rows("booking_suggestions")
                .filter(s => s.id === id)
                .map(suggestion => ({
                  suggestion,
                  conversation: memory
                    .rows("chat_conversations")
                    .find(c => c.id === suggestion.conversationId),
                }));
            },
          }),
        }),
      };
    },
  };
}

describe("assistant fetches alternatives without execution authority", () => {
  it("exposes only conversational procedures; none commits money or inventory", () => {
    const procedures = Object.keys(aiChatRouter._def.procedures).sort();
    expect(procedures).toEqual([
      "getConfig",
      "getHistory",
      "getQuickReplies",
      "getSuggestions",
      "myConversations",
      "selectSuggestion",
      "sendMessage",
      "startConversation",
    ]);
    const source =
      read("server/routers/ai-chat.ts") +
      read("server/services/ai-chat-booking.service.ts");
    for (const forbidden of [
      "bookings.service",
      "booking-checkout.service",
      "payment-settlement.service",
      "wallet.service",
      "voucher.service",
      "loyalty.service",
      "refunds.service",
      "order-servicing.service",
      "../stripe",
      "withTransactionalIdempotency",
      "confirmFundedBooking",
    ])
      expect(source).not.toContain(forbidden);
  });

  it("lets the owner read and select an alternative while committing nothing", async () => {
    const suggestions = await caller().getSuggestions({ conversationId: 7 });
    expect(suggestions.map(s => s.id)).toEqual([3]);
    const selected = await caller().selectSuggestion({ suggestionId: 3 });
    expect(selected).toEqual({
      flightId: 11,
      cabinClass: "economy",
      price: 50000,
    });
    expect(fixture.rows("booking_suggestions")[0].selected).toBe("selected");
    for (const name of moneyTables) expect(fixture.rows(name)).toEqual([]);
    await expect(
      caller().selectSuggestion({ suggestionId: 3 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(2).selectSuggestion({ suggestionId: 3 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const name of moneyTables) expect(fixture.rows(name)).toEqual([]);
  });
});

describe("executing an alternative requires a bound authorisation", () => {
  const offer = {
    suggestionId: 3,
    flightId: 11,
    cabinClass: "economy",
    totalPrice: 50000,
  };
  const offerVersion = assistantOfferVersion(offer);
  const expected = {
    userId: 1,
    suggestionId: 3,
    amount: 50000,
    offerVersion,
  };
  const issue = (
    overrides: Partial<Parameters<typeof issueSelfServiceCapability>[0]> = {}
  ) =>
    issueSelfServiceCapability(
      {
        kind: "assistant-execution",
        userId: 1,
        conversationId: 7,
        suggestionId: 3,
        flightId: 11,
        cabinClass: "economy",
        amount: 50000,
        offerVersion,
        ...overrides,
      } as Parameters<typeof issueSelfServiceCapability>[0],
      { secret }
    );

  it("refuses an assistant session that holds no authorisation", () => {
    for (const missing of [undefined, null, ""])
      expect(() =>
        assertAssistantExecutionAuthorised(missing, expected, { secret })
      ).toThrow(
        expect.objectContaining({ code: "UNAUTHORIZED" }) as unknown as string
      );
  });

  it("accepts the user's own authorisation for the exact priced offer", () => {
    const capability = assertAssistantExecutionAuthorised(issue(), expected, {
      secret,
    });
    expect(capability.amount).toBe(50000);
    expect(capability.offerVersion).toBe(offerVersion);
  });

  it("binds the authorisation to the user and the alternative", () => {
    expect(() =>
      assertAssistantExecutionAuthorised(
        issue(),
        { ...expected, userId: 2 },
        { secret }
      )
    ).toThrow(TRPCError);
    expect(() =>
      assertAssistantExecutionAuthorised(
        issue(),
        { ...expected, userId: 2 },
        { secret }
      )
    ).toThrowErrorMatchingInlineSnapshot(
      `[TRPCError: Authorisation belongs to a different user]`
    );
    expect(() =>
      assertAssistantExecutionAuthorised(
        issue(),
        { ...expected, suggestionId: 4 },
        { secret }
      )
    ).toThrowErrorMatchingInlineSnapshot(
      `[TRPCError: Authorisation names a different alternative]`
    );
  });

  it("expires with the price: a repriced or re-versioned offer needs a fresh fetch", () => {
    for (const changed of [
      { ...expected, amount: 50001 },
      {
        ...expected,
        offerVersion: assistantOfferVersion({ ...offer, totalPrice: 50001 }),
      },
    ])
      expect(() =>
        assertAssistantExecutionAuthorised(issue(), changed, { secret })
      ).toThrow(
        expect.objectContaining({
          code: "PRECONDITION_FAILED",
        }) as unknown as string
      );
    expect(assistantOfferVersion(offer)).toBe(offerVersion);
    expect(assistantOfferVersion({ ...offer, flightId: 12 })).not.toBe(
      offerVersion
    );
  });

  it("cannot be replaced by a kiosk capability or a tampered token", () => {
    const kiosk = issueSelfServiceCapability(
      { kind: "kiosk-session", bookingId: 1, sessionId: 1, passengerIds: [1] },
      { secret }
    );
    expect(() =>
      assertAssistantExecutionAuthorised(kiosk, expected, { secret })
    ).toThrow(
      expect.objectContaining({ code: "UNAUTHORIZED" }) as unknown as string
    );
    const token = issue();
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(() =>
      assertAssistantExecutionAuthorised(tampered, expected, { secret })
    ).toThrow(
      expect.objectContaining({ code: "UNAUTHORIZED" }) as unknown as string
    );
    expect(() =>
      assertAssistantExecutionAuthorised(
        issue({ amount: 0.5 } as never),
        expected,
        { secret }
      )
    ).toThrow(
      expect.objectContaining({ code: "UNAUTHORIZED" }) as unknown as string
    );
  });
});
