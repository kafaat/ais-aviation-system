import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  cache: vi.fn(),
  usage: vi.fn(),
}));
vi.mock("../services/cache.service", () => ({
  cacheService: { get: boundary.cache, set: vi.fn() },
}));
vi.mock("../services/agent-governance.service", () => ({
  recordAiUsage: boundary.usage,
}));
import { invokeLLM } from "../_core/llm";
import { AIGateway } from "../services/intelligence/gateway";

const messages = [
  { role: "user" as const, content: "Synthetic deadline test" },
];
const request = { agentId: "test", taskType: "generation" as const, messages };
const response = () =>
  new Response(
    JSON.stringify({
      model: "gemini-2.5-flash",
      choices: [],
    })
  );
const fetchMock = vi.fn();

beforeEach(() => {
  boundary.cache.mockReset().mockResolvedValue(undefined);
  boundary.usage.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("one caller deadline across gateway and transport", () => {
  it("rejects an already aborted gateway request before cache or transport", async () => {
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    controller.abort(reason);
    await expect(
      new AIGateway().invoke({
        ...request,
        cacheKey: "test",
        signal: controller.signal,
      })
    ).rejects.toBe(reason);
    expect(boundary.cache).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(boundary.usage).not.toHaveBeenCalled();
  });

  it("rejects an already aborted direct transport without fetch", async () => {
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    controller.abort(reason);
    await expect(
      invokeLLM({ messages, signal: controller.signal })
    ).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not start transport when the deadline passes during cache lookup", async () => {
    let release!: (value: undefined) => void;
    boundary.cache.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    const pending = new AIGateway().invoke({
      ...request,
      cacheKey: "test",
      signal: controller.signal,
    });
    const outcome = Promise.allSettled([pending]);
    controller.abort(reason);
    release(undefined);
    expect(await outcome).toEqual([{ status: "rejected", reason }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates the caller signal to a pending fetch and retains its abort reason", async () => {
    let transportSignal: AbortSignal | undefined;
    let rejectFetch!: (error: unknown) => void;
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      transportSignal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        rejectFetch = reject;
        transportSignal!.addEventListener(
          "abort",
          () => reject(transportSignal!.reason),
          { once: true }
        );
      });
    });
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    const pending = new AIGateway().invoke({
      ...request,
      signal: controller.signal,
    });
    const outcome = Promise.allSettled([pending]);
    try {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      controller.abort(reason);
      expect(transportSignal?.aborted).toBe(true);
      expect(await outcome).toEqual([{ status: "rejected", reason }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      rejectFetch(new Error("synthetic test cleanup"));
      await outcome;
    }
  });

  it("returns the deadline reason rather than retrying an upstream failure after abort", async () => {
    const controller = new AbortController();
    const reason = new DOMException("synthetic deadline", "TimeoutError");
    fetchMock.mockImplementation(async () => {
      controller.abort(reason);
      throw new Error("synthetic upstream failure after deadline");
    });
    await expect(
      new AIGateway().invoke({ ...request, signal: controller.signal })
    ).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(boundary.usage).not.toHaveBeenCalled();
  });
});
