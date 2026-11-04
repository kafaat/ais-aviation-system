import { createServer, get, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiShutdown } from "../_core/api-shutdown";

function fixture() {
  const server = createServer();
  const close = vi.spyOn(server, "close").mockImplementation(done => {
    done?.();
    return server;
  });
  return {
    server,
    close,
    log: { info: vi.fn(), error: vi.fn() },
    stopSLAMonitoring: vi.fn(),
    stopOperationalObservations: vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(),
    stopSystemMetricsCollection: vi.fn(),
    flushSentry: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    stopTracing: vi.fn<() => Promise<void>>().mockResolvedValue(),
    closePool: vi.fn<() => Promise<void>>().mockResolvedValue(),
    exit: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("API shutdown lifecycle", () => {
  it("drains a real in-flight HTTP response before flushing observations and closing the pool", async () => {
    const options = fixture();
    let accepted!: (response: ServerResponse) => void;
    const activeResponse = new Promise<ServerResponse>(resolve => {
      accepted = resolve;
    });
    const server: Server = createServer((_req, response) => accepted(response));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No HTTP port");
    const body = new Promise<string>((resolve, reject) => {
      get(`http://127.0.0.1:${address.port}/pending`, response => {
        let value = "";
        response.setEncoding("utf8");
        response.on("data", chunk => (value += chunk));
        response.on("end", () => resolve(value));
      }).on("error", reject);
    });
    try {
      const response = await activeResponse;
      const shutdown = createApiShutdown({ ...options, server });
      const finished = shutdown("SIGTERM");
      expect(shutdown("SIGINT")).toBe(finished);
      await vi.waitFor(() => expect(server.listening).toBe(false));
      expect(options.stopOperationalObservations).not.toHaveBeenCalled();
      expect(options.closePool).not.toHaveBeenCalled();
      expect(options.exit).not.toHaveBeenCalled();
      response.end("drained");
      expect(await body).toBe("drained");
      await finished;
      expect(options.stopOperationalObservations).toHaveBeenCalledTimes(1);
      expect(options.closePool).toHaveBeenCalledTimes(1);
      expect(
        options.stopOperationalObservations.mock.invocationCallOrder[0]
      ).toBeLessThan(options.closePool.mock.invocationCallOrder[0]);
      expect(options.exit).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it.each([
    "stopSLAMonitoring",
    "stopOperationalObservations",
    "stopSystemMetricsCollection",
    "flushSentry",
    "stopTracing",
    "closePool",
  ] as const)(
    "continues cleanup after %s fails and exits unsuccessfully",
    async name => {
      vi.useFakeTimers();
      const options = fixture();
      const error = new Error(`${name} failed`);
      options[name].mockImplementation(() => {
        throw error;
      });
      await createApiShutdown(options)("SIGTERM");
      expect(options.closePool).toHaveBeenCalledTimes(1);
      expect(options.stopTracing).toHaveBeenCalledTimes(1);
      expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(options.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ error }),
        expect.any(String)
      );
      expect(options.log.info).not.toHaveBeenCalledWith(
        { event: "shutdown_completed" },
        expect.any(String)
      );
      if (name === "closePool")
        expect(options.log.info).not.toHaveBeenCalledWith(
          { event: "database_closed" },
          expect.any(String)
        );
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("treats an HTTP-close callback error as failure while still closing other resources", async () => {
    const options = fixture();
    const error = new Error("HTTP close failed");
    options.close.mockImplementation(done => {
      done?.(error);
      return options.server;
    });
    await createApiShutdown(options)("SIGINT");
    expect(options.closePool).toHaveBeenCalledOnce();
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(options.log.error).toHaveBeenCalledWith(
      { event: "http_server_closed_error", error },
      expect.any(String)
    );
  });

  it("does not report a timed-out Sentry flush as success or skip tracing and pool closure", async () => {
    const options = fixture();
    options.flushSentry.mockResolvedValue(false);
    await createApiShutdown(options)("SIGTERM");
    expect(options.stopTracing).toHaveBeenCalledOnce();
    expect(options.closePool).toHaveBeenCalledOnce();
    expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(options.log.info).not.toHaveBeenCalledWith(
      { event: "sentry_flushed" },
      expect.any(String)
    );
  });

  it.each(["HTTP", "pool"] as const)(
    "bounds a stuck %s drain and suppresses a late successful exit",
    async resource => {
      vi.useFakeTimers();
      const options = fixture();
      let release!: () => void;
      if (resource === "HTTP")
        options.close.mockImplementation(done => {
          release = () => done?.();
          return options.server;
        });
      else
        options.closePool.mockImplementation(
          () =>
            new Promise(resolve => {
              release = resolve;
            })
        );
      const shutdown = createApiShutdown({ ...options, timeoutMs: 100 });
      const pending = shutdown("SIGTERM");
      await vi.advanceTimersByTimeAsync(99);
      expect(options.exit).not.toHaveBeenCalled();
      expect(shutdown("SIGINT")).toBe(pending);
      await vi.advanceTimersByTimeAsync(1);
      expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(options.log.error).toHaveBeenCalledWith(
        { event: "forced_shutdown", signal: "SIGTERM" },
        expect.any(String)
      );
      release();
      await pending;
      expect(options.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(options.log.info).not.toHaveBeenCalledWith(
        { event: "shutdown_completed" },
        expect.any(String)
      );
      expect(options.log.info).not.toHaveBeenCalledWith(
        { event: "database_closed" },
        expect.any(String)
      );
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
