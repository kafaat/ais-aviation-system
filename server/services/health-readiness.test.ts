import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  execute: vi.fn(),
  cache: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => ({ execute: state.execute }) }));
vi.mock("./redis-cache.service", () => ({
  redisCacheService: { healthCheck: state.cache },
}));
vi.mock("../_core/logger", () => ({ logger: { warn: state.warn } }));
import { isReady } from "./health.service";
afterEach(() => vi.unstubAllEnvs());

it("keeps readiness fail-closed and logs only changed dependency statuses", async () => {
  state.execute.mockResolvedValue([]);
  state.cache.mockResolvedValue({ status: "ok", redis: { latency: 1 } });
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  expect(await isReady()).toBe(false);
  expect(state.warn).toHaveBeenCalledWith(
    { dependencies: { database: "pass", stripe: "fail", cache: "pass" } },
    "Readiness dependencies are not ready"
  );
  expect(await isReady()).toBe(false);
  expect(state.warn).toHaveBeenCalledTimes(1);
  state.execute.mockRejectedValue(
    new Error("database-password-must-never-be-logged")
  );
  expect(await isReady()).toBe(false);
  expect(state.warn).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(state.warn.mock.calls)).not.toContain(
    "database-password"
  );
});
