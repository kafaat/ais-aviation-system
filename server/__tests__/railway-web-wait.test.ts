import { describe, expect, it } from "vitest";
import { LIVENESS_PATH, waitForWeb } from "../../scripts/ci/railway-web-wait";

/**
 * A scripted stand-in for the deployed web during a rollout: the first
 * attempts fail at the socket (the new container is not on the private
 * network yet), then the liveness endpoint answers. Time is injected so the
 * tests prove the bounded-wait contract without sleeping.
 */
function clock() {
  let current = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      slept.push(ms);
      current += ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
    slept,
  };
}

function scripted(
  outcomes: Array<number | Error>,
  seen: URL[] = []
): typeof fetch {
  let index = 0;
  return (async (input: string | URL | Request) => {
    seen.push(new URL(String(input)));
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (outcome instanceof Error) throw outcome;
    return new Response(JSON.stringify({ alive: outcome === 200 }), {
      status: outcome,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("waitForWeb", () => {
  it("retries socket failures until the liveness endpoint answers 2xx", async () => {
    const time = clock();
    const seen: URL[] = [];
    const report = await waitForWeb(new URL("http://ais-web.internal:3000"), {
      fetchImpl: scripted(
        [new TypeError("fetch failed"), new TypeError("fetch failed"), 200],
        seen
      ),
      intervalMs: 3_000,
      timeoutMs: 120_000,
      now: time.now,
      sleep: time.sleep,
    });
    expect(report).toEqual({
      reachable: true,
      attempts: 3,
      waitedMs: 6_000,
      lastStatus: 200,
      lastError: null,
    });
    expect(time.slept).toEqual([3_000, 3_000]);
    expect(seen.every(url => url.pathname === LIVENESS_PATH)).toBe(true);
  });

  it("keeps polling through a non-2xx liveness answer", async () => {
    const time = clock();
    const report = await waitForWeb(new URL("http://ais-web.internal:3000"), {
      fetchImpl: scripted([503, 503, 200]),
      intervalMs: 1_000,
      timeoutMs: 60_000,
      now: time.now,
      sleep: time.sleep,
    });
    expect(report.reachable).toBe(true);
    expect(report.attempts).toBe(3);
    expect(report.lastStatus).toBe(200);
  });

  it("gives up at the deadline and reports the last failure without passing", async () => {
    const time = clock();
    const report = await waitForWeb(new URL("http://ais-web.internal:3000"), {
      fetchImpl: scripted([new TypeError("fetch failed")]),
      intervalMs: 3_000,
      timeoutMs: 10_000,
      now: time.now,
      sleep: time.sleep,
    });
    expect(report.reachable).toBe(false);
    // Attempts at t=0, 3s, 6s and 9s; a fifth would end after the deadline.
    expect(report.attempts).toBe(4);
    expect(report.waitedMs).toBe(9_000);
    expect(report.lastStatus).toBeNull();
    expect(report.lastError).toBe("fetch failed");
  });

  it("returns at once when the web is already up", async () => {
    const time = clock();
    const report = await waitForWeb(new URL("http://ais-web.internal:3000"), {
      fetchImpl: scripted([200]),
      now: time.now,
      sleep: time.sleep,
    });
    expect(report).toMatchObject({ reachable: true, attempts: 1, waitedMs: 0 });
    expect(time.slept).toEqual([]);
  });
});
