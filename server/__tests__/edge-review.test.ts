/**
 * HTTP-edge rules closed by the October 2026 review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));

import { errorResponseMiddleware } from "../_core/middleware/sentry.middleware";
import {
  sendMessage,
  startConversation,
} from "../services/ai-chat-booking.service";
import { AI_LIMITS } from "../services/ai-guardrails.service";

function respond() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    getHeader: () => undefined,
  };
  return res;
}

describe("error responses", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it.each(["test", "staging", "production", ""])(
    "hides the message and stack of a 500 when NODE_ENV is %j",
    env => {
      process.env.NODE_ENV = env;
      const res = respond();
      errorResponseMiddleware(
        new Error("SELECT secret FROM users failed"),
        {} as any,
        res,
        () => undefined
      );
      expect(res.statusCode).toBe(500);
      expect(res.body).toMatchObject({ error: "Internal server error" });
      expect(res.body).not.toHaveProperty("stack");
    }
  );

  it("keeps details for a developer's own machine only", () => {
    process.env.NODE_ENV = "development";
    const res = respond();
    errorResponseMiddleware(new Error("boom"), {} as any, res, () => undefined);
    expect(res.body).toMatchObject({ error: "boom" });
    expect(res.body).toHaveProperty("stack");
  });
});

describe("AI chat limits are enforced", () => {
  beforeEach(() => {
    state.db = transactionMemory({
      chat_conversations: Array.from(
        { length: AI_LIMITS.maxConversationsPerUser },
        (_, i) => ({
          id: i + 1,
          userId: 9,
          status: "active",
          messageCount: i === 0 ? AI_LIMITS.maxMessagesPerConversation : 1,
          context: {},
        })
      ),
      chat_messages: [],
    }).db;
  });

  it("refuses a new conversation once the per-user cap is reached", async () => {
    await expect(startConversation({ userId: 9 } as any)).rejects.toMatchObject(
      { code: "TOO_MANY_REQUESTS" }
    );
  });

  it("refuses another message once the per-conversation cap is reached", async () => {
    await expect(
      sendMessage({ conversationId: 1, userId: 9, message: "hello" } as any)
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(state.db.select().from).toBeDefined();
  });
});
