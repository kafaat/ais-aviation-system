import { beforeEach, describe, expect, it, vi } from "vitest";
import type { operationalSamples } from "../../drizzle/schema";

type Sample = typeof operationalSamples.$inferInsert;
const persistence = vi.hoisted(() => ({
  getDb: vi.fn(),
  write: vi.fn<(sample: Sample) => Promise<void>>(),
}));
vi.mock("../db", () => ({ getDb: persistence.getDb }));

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(() => {
  vi.resetModules();
  persistence.getDb.mockReset();
  persistence.write.mockReset();
  // Only the asynchronous persistence boundary is controlled. The production
  // observation bucket, flush coalescing and stop function all execute unchanged.
  persistence.getDb.mockReturnValue({
    insert: () => ({
      values: (sample: Sample) => ({
        onDuplicateKeyUpdate: () => persistence.write(sample),
      }),
    }),
  });
});

describe("API observation shutdown drain", () => {
  it("waits for responses observed after an in-flight flush captured its bucket", async () => {
    const observations =
      await import("../services/operational-observations.service");
    const first = deferred();
    const last = deferred();
    persistence.write
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => last.promise);
    observations.observeApiResponse(11, 200);
    const inFlight = observations.flushApiObservations();
    expect(persistence.write).toHaveBeenCalledTimes(1);
    observations.observeApiResponse(29, 503);
    let stopped = false;
    const stop = observations.stopOperationalObservations().then(() => {
      stopped = true;
    });
    try {
      expect(stopped).toBe(false);
      first.release();
      await inFlight;
      expect(persistence.write).toHaveBeenCalledTimes(2);
      expect(stopped).toBe(false);
      expect(
        persistence.write.mock.calls.map(([sample]) => ({
          requests: sample.requests,
          errors: sample.errors,
          totalDurationMs: sample.totalDurationMs,
        }))
      ).toEqual([
        { requests: 1, errors: 0, totalDurationMs: "11.000" },
        { requests: 1, errors: 1, totalDurationMs: "29.000" },
      ]);
      last.release();
      await stop;
      expect(stopped).toBe(true);
    } finally {
      first.release();
      last.release();
      await Promise.allSettled([inFlight, stop]);
    }
  });

  it("does not acquire a database when there is no pending or observed work", async () => {
    const observations =
      await import("../services/operational-observations.service");
    await observations.stopOperationalObservations();
    expect(persistence.getDb).not.toHaveBeenCalled();
    expect(persistence.write).not.toHaveBeenCalled();
  });

  it("retries the same failed sample during shutdown without losing its counters", async () => {
    const observations =
      await import("../services/operational-observations.service");
    persistence.write.mockRejectedValueOnce(
      new Error("Synthetic write failure")
    );
    persistence.write.mockResolvedValue(undefined);
    observations.observeApiResponse(17, 500);
    await expect(observations.flushApiObservations()).rejects.toThrow(
      "Synthetic write failure"
    );
    const failedSample = persistence.write.mock.calls[0][0];
    await observations.stopOperationalObservations();
    expect(persistence.write.mock.calls[1][0]).toEqual(failedSample);
    expect(failedSample).toMatchObject({
      requests: 1,
      errors: 1,
      totalDurationMs: "17.000",
    });
  });

  it("reports failure while draining the last bucket and preserves it for a retry", async () => {
    const observations =
      await import("../services/operational-observations.service");
    const first = deferred();
    persistence.write
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(new Error("Synthetic final write failure"))
      .mockResolvedValue(undefined);
    observations.observeApiResponse(7, 200);
    const inFlight = observations.flushApiObservations();
    observations.observeApiResponse(13, 502);
    const stop = observations.stopOperationalObservations();
    const rejected = expect(stop).rejects.toThrow(
      "Synthetic final write failure"
    );
    first.release();
    await inFlight;
    await rejected;
    const failedSample = persistence.write.mock.calls[1][0];
    await observations.stopOperationalObservations();
    expect(persistence.write.mock.calls[2][0]).toEqual(failedSample);
    expect(failedSample).toMatchObject({
      requests: 1,
      errors: 1,
      totalDurationMs: "13.000",
    });
  });
});
