import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  usage: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock("../_core/llm", () => ({ invokeLLM: m.invoke }));
vi.mock("../services/agent-governance.service", () => ({
  recordAiUsage: m.usage,
}));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    get: async (key: string) => m.cache.get(key),
    set: async (key: string, value: unknown) => m.cache.set(key, value),
  },
}));
import { AIGateway } from "../services/intelligence/gateway";
const request = {
  agentId: "test",
  taskType: "analysis" as const,
  messages: [{ role: "user" as const, content: "Synthetic test" }],
  maxTokens: 100,
  tenantId: 1,
  userId: 1,
  feature: "ci",
  cacheKey: "same",
  cacheTtlSeconds: 60,
};
beforeEach(() => {
  m.cache.clear();
  m.invoke.mockReset().mockResolvedValue({
    model: "gemini-2.5-flash",
    choices: [],
    usage: { prompt_tokens: 5, completion_tokens: 10 },
  });
  m.usage.mockReset().mockResolvedValue(undefined);
});
it("sends the selected model and token ceiling to the actual transport", async () => {
  const result = await new AIGateway().invoke(request);
  expect(m.invoke).toHaveBeenCalledWith({
    messages: request.messages,
    model: "gemini-2.5-flash",
    provider: "forge",
    maxTokens: 100,
  });
  expect(result.modelUsed).toBe("gemini-2.5-flash");
});
it("isolates cached prompts by user and tenant", async () => {
  const gateway = new AIGateway();
  await gateway.invoke(request);
  expect((await gateway.invoke(request)).cached).toBe(true);
  await gateway.invoke({ ...request, userId: 2 });
  await gateway.invoke({ ...request, tenantId: 2 });
  expect(m.invoke).toHaveBeenCalledTimes(3);
});
it("rejects unconfigured models, unsupported budgets, and reported model mismatch", async () => {
  const gateway = new AIGateway();
  await expect(
    gateway.invoke({ ...request, preferredModel: "unconfigured" })
  ).rejects.toThrow("No suitable model");
  await expect(gateway.invoke({ ...request, maxCost: 0 })).rejects.toThrow(
    "No suitable model"
  );
  expect(m.invoke).not.toHaveBeenCalled();
  m.invoke.mockResolvedValue({ model: "different-model", choices: [] });
  await expect(gateway.invoke(request)).rejects.toThrow("different model");
  expect(m.invoke).toHaveBeenCalledTimes(1);
  expect(m.usage).not.toHaveBeenCalled();
});
it("bounds failure retries to distinct eligible transports", async () => {
  m.invoke.mockRejectedValue(new Error("upstream unavailable"));
  await expect(new AIGateway().invoke(request)).rejects.toThrow(
    "upstream unavailable"
  );
  expect(m.invoke).toHaveBeenCalledTimes(1);
});
