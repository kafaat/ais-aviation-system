import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { runWithTrace } from "./trace";
import { newTraceContext } from "../../shared/trace-context";

const state = vi.hoisted(() => ({
  db: null as any,
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("./logger", () => ({
  createServiceLogger: () => ({
    info: state.info,
    warn: state.warn,
    error: vi.fn(),
  }),
}));

import {
  InvalidOperationKeyError,
  operationKey,
  providerRequestOptions,
  runIdempotentOperation,
  traceId,
} from "./idempotency";

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({ idempotency_requests: [] });
  state.db = fixture.db;
  state.info.mockClear();
  state.warn.mockClear();
});

describe("operationKey", () => {
  it("is derived only from the natural identity and is stable across calls", () => {
    const first = operationKey("modification.checkout", [17, 5000]);
    const second = operationKey("modification.checkout", [17, 5000]);
    expect(first.value).toBe("modification.checkout:17:5000");
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects material that cannot be a financial identity", () => {
    expect(() => operationKey("Refund", "x")).toThrow(InvalidOperationKeyError);
    expect(() => operationKey("refund", [])).toThrow(InvalidOperationKeyError);
    expect(() => operationKey("refund", "")).toThrow(InvalidOperationKeyError);
    expect(() => operationKey("refund", 1.5)).toThrow(InvalidOperationKeyError);
    expect(() => operationKey("refund", "a b")).toThrow(
      InvalidOperationKeyError
    );
    expect(() => operationKey("refund", "x".repeat(250))).toThrow(
      InvalidOperationKeyError
    );
    expect(() => operationKey("refund", ["pi_123", "re_456"])).not.toThrow();
  });

  it("hands the stable value to the provider with SDK retries disabled", () => {
    const options = providerRequestOptions(operationKey("wallet.topup", 9));
    expect(options).toEqual({
      idempotencyKey: "wallet.topup:9",
      timeout: 15000,
      maxNetworkRetries: 0,
    });
    expect(() => providerRequestOptions("")).toThrow(InvalidOperationKeyError);
  });
});

describe("traceId", () => {
  it("follows the ambient trace and otherwise mints one per attempt", () => {
    const context = newTraceContext();
    expect(runWithTrace(context, () => traceId())).toBe(context.traceId);
    const a = traceId();
    const b = traceId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("runIdempotentOperation", () => {
  const key = operationKey("test.charge", ["booking", 42]);

  it("replays the stored result for the same key without re-running", async () => {
    const run = vi.fn().mockResolvedValue({ chargeId: "ch_1" });
    const first = await runIdempotentOperation({
      key,
      userId: 7,
      request: { bookingId: 42, amount: 5000 },
      run,
    });
    const second = await runIdempotentOperation({
      key,
      userId: 7,
      request: { bookingId: 42, amount: 5000 },
      run,
    });
    expect(first).toEqual({ chargeId: "ch_1" });
    expect(second).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fixture.rows("idempotency_requests")).toHaveLength(1);
    expect(
      state.info.mock.calls.map(([fields]) => (fields as any).phase)
    ).toEqual(["attempt", "completed", "attempt", "replayed"]);
  });

  it("refuses a concurrent attempt while the first is in progress", async () => {
    let release!: (value: { ok: true }) => void;
    const pending = new Promise<{ ok: true }>(resolve => {
      release = resolve;
    });
    const run = vi.fn(() => pending);
    const first = runIdempotentOperation({
      key,
      userId: 7,
      request: { bookingId: 42 },
      run,
    });
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    await expect(
      runIdempotentOperation({
        key,
        userId: 7,
        request: { bookingId: 42 },
        run,
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    release({ ok: true });
    expect(await first).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(state.warn.mock.calls[0][0]).toMatchObject({
      phase: "in_progress",
      scope: "test.charge",
      key: "booking:42",
    });
  });

  it("rejects the same key with a different payload", async () => {
    await runIdempotentOperation({
      key,
      userId: 7,
      request: { amount: 5000 },
      run: async () => "first",
    });
    await expect(
      runIdempotentOperation({
        key,
        userId: 7,
        request: { amount: 9000 },
        run: async () => "second",
      })
    ).rejects.toThrow("different payload");
  });

  it("logs a different trace id per attempt while the key stays constant", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider timeout"))
      .mockResolvedValueOnce("done");
    const attempt = () =>
      runWithTrace(newTraceContext(), () =>
        runIdempotentOperation({ key, userId: 7, request: { n: 1 }, run })
      );
    await expect(attempt()).rejects.toThrow("provider timeout");
    expect(await attempt()).toBe("done");
    const attempts = state.info.mock.calls
      .map(
        ([fields]) => fields as { phase: string; traceId: string; key: string }
      )
      .filter(fields => fields.phase === "attempt");
    expect(attempts).toHaveLength(2);
    expect(attempts[0].traceId).not.toBe(attempts[1].traceId);
    expect(new Set(attempts.map(a => a.key))).toEqual(new Set(["booking:42"]));
    for (const a of attempts) expect(a.key).not.toContain(a.traceId);
    expect(state.warn.mock.calls[0][0]).toMatchObject({ phase: "failed" });
  });
});
