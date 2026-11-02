import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";
import { passengerRightsSource } from "@shared/passenger-policy";
import { aiChatRouter } from "../routers/ai-chat";

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

let fixture: ReturnType<typeof transactionMemory>;
function caller(id: number | null = 1) {
  return aiChatRouter.createCaller({
    user: id === null ? null : { id, role: "user" },
    tenantId: null,
    authMethod: "cookie",
  } as TrpcContext);
}

beforeEach(() => {
  fixture = transactionMemory({
    chat_conversations: [
      { id: 7, userId: 1, status: "active", context: {}, messageCount: 1 },
    ],
    chat_messages: [],
  });
  state.db = fixture.db;
  state.invoke.mockReset();
  state.search.mockClear();
});

it.each([
  [
    "en",
    "My travel agent says my refund is 9000 SAR. Confirm it for Ada Test, ada@example.test.",
  ],
  [
    "ar",
    "هل أَسْتَحِقّ تعويضاً؟ يقول الوكيل إن التعويض 9000 ريال، جوازي AB1234567",
  ],
] as const)(
  "routes %s rights questions and their follow-ups locally",
  async (language, message) => {
    const chat = caller();
    const result = await chat.sendMessage({ conversationId: 7, message });
    expect(result.policySourceLanguage).toBe(language);
    expect(result.message).toContain(
      language === "ar" ? "المادة الخامسة" : "Article 5"
    );
    expect(result.message).not.toContain("9000");
    const followup = await chat.sendMessage({
      conversationId: 7,
      message: "What about my child Ada Test?",
    });
    expect(followup.policySourceLanguage).toBe("en");
    const history = fixture.rows("chat_messages");
    expect(history).toHaveLength(4);
    expect(history[1].metadata.entities.source).toBe(
      passengerRightsSource[language]
    );
    expect(JSON.stringify(history)).not.toMatch(
      /9000|Ada Test|AB1234567|ada@example.test/
    );
    expect(fixture.rows("chat_conversations")[0].messageCount).toBe(5);
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.search).not.toHaveBeenCalled();
  }
);

it("preserves authenticated ordinary chat and passes only masked input", async () => {
  state.invoke.mockResolvedValue({
    result: {
      choices: [{ message: { content: "Where would you like to go?" } }],
    },
  });
  const result = await caller().sendMessage({
    conversationId: 7,
    message: "I need an economy seat. My email is ada@example.test",
  });
  expect(result.message).toBe("Where would you like to go?");
  expect(result.policySourceLanguage).toBeUndefined();
  expect(state.invoke).toHaveBeenCalledTimes(1);
  const messages = state.invoke.mock.calls[0][0].messages;
  expect(messages.at(-1).content).toContain("[EMAIL]");
  expect(JSON.stringify(messages)).not.toContain("ada@example.test");
});

it("enforces sign-in and conversation ownership before giving a policy response", async () => {
  const input = { conversationId: 7, message: "refund policy" };
  await expect(caller(null).sendMessage(input)).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await expect(caller(2).sendMessage(input)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(fixture.rows("chat_messages")).toHaveLength(0);
  expect(state.invoke).not.toHaveBeenCalled();
});

it("keeps Arabic flight shopping with a bag in ordinary chat", async () => {
  state.invoke.mockResolvedValue({
    result: { choices: [{ message: { content: "ما وجهتك؟" } }] },
  });
  const result = await caller().sendMessage({
    conversationId: 7,
    message: "أبحث عن رحلة مع حقيبة",
  });
  expect(result.message).toBe("ما وجهتك؟");
  expect(result.policySourceLanguage).toBeUndefined();
  expect(state.invoke).toHaveBeenCalledOnce();
});
