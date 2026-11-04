import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advanceCacheGeneration,
  readCacheGeneration,
} from "./cache-generation-authority";

const database = vi.hoisted(() => ({
  available: true,
  select: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () =>
    database.available
      ? {
          select: () => ({ from: () => ({ where: database.select }) }),
          insert: () => ({
            values: () => ({ onDuplicateKeyUpdate: database.write }),
          }),
        }
      : null,
}));

beforeEach(() => {
  database.available = true;
  database.select.mockReset().mockResolvedValue([]);
  database.write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("durable cache generation availability boundary", () => {
  it("only uses the initial token after a successful authoritative empty read", async () => {
    expect(await readCacheGeneration("fixture", "search")).toBe("0.0");
    database.available = false;
    await expect(readCacheGeneration("fixture", "search")).rejects.toThrow(
      "unavailable"
    );
    await expect(advanceCacheGeneration("fixture", "search")).rejects.toThrow(
      "unavailable"
    );
    database.available = true;
    database.select.mockRejectedValue(new Error("table missing"));
    await expect(readCacheGeneration("fixture", "search")).rejects.toThrow(
      "table missing"
    );
  });

  it("bounds wait time and outstanding operations without retaining a guessed generation", async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    database.select.mockImplementation(
      () => new Promise(resolve => releases.push(() => resolve([])))
    );
    const pending = Array.from({ length: 8 }, () =>
      expect(readCacheGeneration("fixture", "search")).rejects.toThrow(
        "timed out"
      )
    );
    await vi.advanceTimersByTimeAsync(250);
    await Promise.all(pending);
    expect(database.select).toHaveBeenCalledTimes(8);
    await expect(readCacheGeneration("fixture", "search")).rejects.toThrow(
      "busy"
    );
    expect(database.select).toHaveBeenCalledTimes(8);
    for (const release of releases) release();
    await vi.advanceTimersByTimeAsync(0);
    database.select.mockResolvedValue([]);
    expect(await readCacheGeneration("fixture", "search")).toBe("0.0");
  });

  it("does not acknowledge a timed out write even when it eventually completes", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    database.write.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    const result = expect(
      advanceCacheGeneration("fixture", "search")
    ).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    release();
    await vi.advanceTimersByTimeAsync(0);
    database.write.mockResolvedValue(undefined);
    await expect(
      advanceCacheGeneration("fixture", "search")
    ).resolves.toBeUndefined();
  });
});
