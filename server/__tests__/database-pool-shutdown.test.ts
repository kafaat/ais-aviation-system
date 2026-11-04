import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  createPool: vi.fn(),
  drizzle: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("mysql2/promise", () => ({
  default: { createPool: fixture.createPool },
}));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: fixture.drizzle }));
vi.mock("../_core/logger", () => ({ createServiceLogger: () => fixture.log }));

const pool = {
  end: vi.fn<() => Promise<void>>(),
  on: vi.fn(),
  pool: { on: vi.fn() },
};
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("DATABASE_URL", "mysql://fixture:fixture@127.0.0.1/ais_pool_test");
  pool.end.mockResolvedValue(undefined);
  fixture.createPool.mockReturnValue(pool);
  fixture.drizzle.mockReturnValue({ fixture: "drizzle" });
});
afterEach(() => vi.unstubAllEnvs());

describe("owned database pool shutdown", () => {
  it("does not initialize a connection when no pool was used", async () => {
    const { closePool } = await import("../db");
    await closePool();
    expect(fixture.createPool).not.toHaveBeenCalled();
    expect(fixture.drizzle).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();
    expect(fixture.log.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "pool_closed" }),
      expect.any(String)
    );
  });

  it("awaits the owned pool's close and never closes it twice for concurrent callers", async () => {
    let release!: () => void;
    pool.end.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    const { closePool, getDb } = await import("../db");
    expect(getDb()).toEqual({ fixture: "drizzle" });
    let finished = false;
    const first = closePool().then(() => {
      finished = true;
    });
    const second = closePool();
    await vi.waitFor(() => expect(pool.end).toHaveBeenCalledTimes(1));
    expect(finished).toBe(false);
    expect(fixture.log.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "pool_closed" }),
      expect.any(String)
    );
    release();
    await Promise.all([first, second]);
    await closePool();
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(fixture.log.info).toHaveBeenCalledWith(
      { event: "pool_closed" },
      "Database connection pool closed"
    );
    expect(fixture.createPool).toHaveBeenCalledTimes(1);
  });

  it("propagates a pool-end failure and does not emit a successful close receipt", async () => {
    const failure = new Error("Fixture pool end failed");
    pool.end.mockRejectedValue(failure);
    const { closePool, getPool } = await import("../db");
    getPool();
    await expect(closePool()).rejects.toBe(failure);
    expect(fixture.log.error).toHaveBeenCalledWith(
      { event: "pool_close_failed", error: failure },
      expect.any(String)
    );
    expect(fixture.log.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "pool_closed" }),
      expect.any(String)
    );
  });

  it("does not create an untracked fallback pool after configured pool initialization fails", async () => {
    fixture.createPool.mockImplementation(() => {
      throw new Error("Pool configuration rejected");
    });
    const { getDb, closePool } = await import("../db");
    expect(getDb()).toBeNull();
    await closePool();
    expect(fixture.drizzle).not.toHaveBeenCalled();
    expect(fixture.createPool).toHaveBeenCalledTimes(1);
  });
});
