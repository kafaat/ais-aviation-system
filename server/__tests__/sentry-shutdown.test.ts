import { createServer } from "node:http";
import * as Sentry from "@sentry/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiShutdown } from "../_core/api-shutdown";
import { flushSentry, initSentry } from "../services/sentry.service";

let previousClient: ReturnType<typeof Sentry.getClient>;
beforeEach(() => {
  previousClient = Sentry.getClient();
  Sentry.getCurrentScope().setClient(undefined);
  vi.stubEnv("SENTRY_DSN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  Sentry.getCurrentScope().setClient(previousClient);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function shutdownFixture() {
  const server = createServer();
  vi.spyOn(server, "close").mockImplementation(done => {
    done?.();
    return server;
  });
  const log = { info: vi.fn(), error: vi.fn() };
  const closePool = vi.fn<() => Promise<void>>().mockResolvedValue();
  const exit = vi.fn();
  const shutdown = createApiShutdown({
    server,
    log,
    stopSLAMonitoring: () => {},
    stopOperationalObservations: async () => {},
    stopSystemMetricsCollection: () => {},
    flushSentry: () => flushSentry(2000),
    stopTracing: async () => {},
    closePool,
    exit,
  });
  return { shutdown, log, closePool, exit };
}

function bindClient(flush: () => Promise<boolean>) {
  // No provider is initialized: this is the existing client's flush boundary.
  // Disabled cases above/below execute the actual SDK's no-client behavior.
  Sentry.getCurrentScope().setClient({ flush } as NonNullable<
    ReturnType<typeof Sentry.getClient>
  >);
}

describe("Sentry lifecycle with an optional SDK client", () => {
  it.each([
    "",
    "https://your-key@example.test/1",
    "https://fixture@your-project.example.test/1",
  ])(
    "treats a deliberately disabled Sentry client as having no pending events (%s)",
    async dsn => {
      vi.stubEnv("SENTRY_DSN", dsn);
      initSentry();
      expect(Sentry.getClient()).toBeUndefined();
      // This is the installed SDK behavior that caused the native process exit 1.
      expect(await Sentry.flush(2000)).toBe(false);
      expect(await flushSentry(2000)).toBe(true);
    }
  );

  it("allows API shutdown to succeed with real disabled-Sentry semantics", async () => {
    initSentry();
    const fixture = shutdownFixture();
    await fixture.shutdown("SIGTERM");
    expect(fixture.closePool).toHaveBeenCalledOnce();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(fixture.log.info).toHaveBeenCalledWith(
      { event: "shutdown_completed" },
      expect.any(String)
    );
    expect(fixture.log.error).not.toHaveBeenCalled();
  });

  it("awaits an existing client's pending flush even when the environment no longer contains a DSN", async () => {
    let release!: (success: boolean) => void;
    const flush = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          release = resolve;
        })
    );
    bindClient(flush);
    const fixture = shutdownFixture();
    const pending = fixture.shutdown("SIGTERM");
    await vi.waitFor(() => expect(flush).toHaveBeenCalledExactlyOnceWith(2000));
    expect(fixture.closePool).not.toHaveBeenCalled();
    expect(fixture.exit).not.toHaveBeenCalled();
    release(true);
    await pending;
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it.each(["false", "rejection"] as const)(
    "retains a real client's %s failure and still closes the pool",
    async failure => {
      const flush = vi.fn<() => Promise<boolean>>();
      if (failure === "false") flush.mockResolvedValue(false);
      else
        flush.mockRejectedValue(new Error("Existing Sentry transport failed"));
      bindClient(flush);
      const fixture = shutdownFixture();
      await fixture.shutdown("SIGTERM");
      expect(flush).toHaveBeenCalledExactlyOnceWith(2000);
      expect(fixture.closePool).toHaveBeenCalledOnce();
      expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(fixture.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: "sentry_flushed_error" }),
        expect.any(String)
      );
      expect(fixture.log.info).not.toHaveBeenCalledWith(
        { event: "shutdown_completed" },
        expect.any(String)
      );
    }
  );
});
