import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiProcessWebhookSecret,
  apiProcessProviderDiagnostic,
  startApiProcessFixture,
  type ApiProcessOptions,
} from "./helpers/api-process-fixture";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

nativeDescribe.sequential(
  "actual API process with isolated native MySQL and controlled providers",
  () => {
    let admin: mysql.Connection | undefined;
    let pool: mysql.Pool | undefined;
    let api: Awaited<ReturnType<typeof startApiProcessFixture>> | undefined;
    let databaseName = "";
    let databaseUrl = "";
    let created = false;
    let phase = "startup readiness";

    beforeAll(async () => {
      const source = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = source.pathname.slice(1);
      if (
        source.protocol !== "mysql:" ||
        !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
      )
        throw new Error(
          "Native API acceptance requires a loopback disposable _test source"
        );
      const options = {
        host: source.hostname.replace(/^\[|\]$/g, ""),
        port: Number(source.port || 3306),
        user: decodeURIComponent(source.username),
        password: decodeURIComponent(source.password),
        timezone: "Z",
      };
      databaseName = "ais_api_process_" + randomBytes(6).toString("hex");
      if (!/^ais_api_process_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid owned schema name");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      created = true;
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 2,
      });
      // Preserve the migration-verified native catalog, including the API's
      // final observation write. There are no users/bookings or financial effects.
      for (const table of [
        "stripe_events",
        "operational_samples",
        "scheduled_tasks",
        "outbox",
        "operations_alerts",
        "alert_dispatches",
      ])
        await pool.query(
          `CREATE TABLE \`${table}\` LIKE \`${sourceDatabase}\`.\`${table}\``
        );
      source.pathname = "/" + databaseName;
      databaseUrl = source.toString();
      api = await startApiProcessFixture(databaseUrl);
      await ready();
    }, 40_000);

    afterAll(async () => {
      try {
        await api?.close();
      } finally {
        try {
          await pool?.end();
        } finally {
          if (admin) {
            try {
              if (created) await admin.query("DROP DATABASE " + databaseName);
            } finally {
              await admin.end();
            }
          }
        }
      }
    }, 25_000);

    async function request(path: string, init?: RequestInit, target = api) {
      if (!target) throw new Error("API fixture was not started");
      const started = Date.now();
      try {
        const response = await fetch(target.origin + path, {
          ...init,
          signal: AbortSignal.timeout(5000),
        });
        const text = await response.text();
        return {
          status: response.status,
          headers: response.headers,
          elapsedMs: Date.now() - started,
          text,
          body: JSON.parse(text) as Record<string, unknown>,
        };
      } catch (error) {
        throw new Error(
          `API request failed during ${phase}: ${init?.method ?? "GET"} ${path} after ${Date.now() - started}ms; child DB proxy sockets=${target.proxy.connections()}\nCaptured child output (bounded):\n${target.diagnostics()}`,
          { cause: error }
        );
      }
    }
    async function ready(target = api) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const result = await request(
          "/api/rest/health/ready",
          undefined,
          target
        );
        if (result.status === 200) {
          expect(result.body).toEqual({ ready: true });
          return;
        }
        if (Date.now() >= deadline)
          throw new Error(
            `API did not become ready: ${result.text}; ${target?.diagnostics()}`
          );
        await delay(250);
      }
    }
    function trpcData(body: Record<string, unknown>) {
      const result = body.result as { data: { json: unknown } };
      return result.data.json;
    }
    function assertPublicResponse(text: string) {
      expect(text).not.toMatch(
        /mysql:|ECONN|SELECT |sqlMessage|stack|dependencies|"checks"|"database"/i
      );
      expect(text).not.toContain(databaseName);
      expect(text).not.toContain(apiProcessWebhookSecret);
      expect(text).not.toContain(apiProcessProviderDiagnostic);
    }

    async function withProcess(
      options: ApiProcessOptions,
      work: (child: NonNullable<typeof api>) => Promise<void>
    ) {
      const child = await startApiProcessFixture(databaseUrl, options);
      try {
        await work(child);
      } finally {
        await child.close();
      }
    }

    it("keeps REST/tRPC liveness while only the child's DB route fails, then recovers readiness in the same process", async () => {
      phase = "before DB outage";
      expect(api!.proxy.connections()).toBeGreaterThan(0);
      const pid = api!.pid;
      const initial = await request("/api/trpc/health.ready");
      expect(initial.status).toBe(200);
      expect(trpcData(initial.body)).toEqual({ ready: true });
      api!.proxy.disconnect();
      phase = "readiness during DB outage";
      try {
        for (const path of [
          "/api/rest/health/ready",
          "/api/trpc/health.ready",
        ]) {
          const unavailable = await request(path);
          expect(unavailable.status).toBe(503);
          expect(unavailable.text).toContain("Service is not ready");
          assertPublicResponse(unavailable.text);
        }
        for (const [path, trpc] of [
          ["/api/rest/health/live", false],
          ["/api/trpc/health.live", true],
        ] as const) {
          phase = "liveness during DB outage";
          const live = await request(path);
          expect(live.status).toBe(200);
          expect(trpc ? trpcData(live.body) : live.body).toEqual({
            alive: true,
          });
        }
        const [control] =
          await admin!.query<mysql.RowDataPacket[]>("SELECT 1 AS alive");
        expect(control[0].alive).toBe(1);
      } finally {
        api!.proxy.reconnect();
      }
      phase = "readiness after DB recovery";
      await ready();
      const recovered = await request("/api/trpc/health.ready");
      expect(recovered.status).toBe(200);
      expect(trpcData(recovered.body)).toEqual({ ready: true });
      expect(api!.pid).toBe(pid);
    }, 25_000);

    it("keeps detailed health protected on both registered transports", async () => {
      phase = "protected health";
      for (const path of ["/api/rest/health", "/api/trpc/health.check"]) {
        const denied = await request(path);
        expect(denied.status).toBe(401);
        assertPublicResponse(denied.text);
      }
    });

    it("keeps readiness with unavailable Redis under the documented memory-fallback policy", async () => {
      phase = "explicit Redis memory fallback";
      expect(api!.redis.mode).toBe("unavailable");
      expect(api!.redis.rejectedConnections()).toBeGreaterThan(0);
      expect(
        api!.records.some(record =>
          /using memory fallback/.test(String(record.message))
        )
      ).toBe(true);
      for (const [path, trpc] of [
        ["/api/rest/health/ready", false],
        ["/api/trpc/health.ready", true],
      ] as const) {
        const result = await request(path);
        expect(result.status).toBe(200);
        expect(trpc ? trpcData(result.body) : result.body).toEqual({
          ready: true,
        });
        assertPublicResponse(result.text);
      }
    });

    it.each(["unavailable", "timeout"] as const)(
      "keeps liveness, redacts provider %s and recovers readiness in the same actual process",
      async state => {
        phase = `provider ${state}`;
        const pid = api!.pid;
        const firstRecord = api!.records.length;
        const firstRequest = api!.providerRequests.length;
        api!.setProviderState(state);
        try {
          for (const path of [
            "/api/rest/health/ready",
            "/api/trpc/health.ready",
          ]) {
            const result = await request(path);
            expect(result.status).toBe(503);
            expect(result.text).toContain("Service is not ready");
            assertPublicResponse(result.text);
            if (state === "timeout") {
              expect(result.elapsedMs).toBeGreaterThanOrEqual(1200);
              expect(result.elapsedMs).toBeLessThan(4000);
            }
          }
          for (const [path, trpc] of [
            ["/api/rest/health/live", false],
            ["/api/trpc/health.live", true],
          ] as const) {
            const live = await request(path);
            expect(live.status).toBe(200);
            expect(trpc ? trpcData(live.body) : live.body).toEqual({
              alive: true,
            });
          }
          await expect
            .poll(() =>
              api!.records.slice(firstRecord).some(
                record =>
                  record.message === "Readiness dependencies are not ready" &&
                  JSON.stringify(record.dependencies) ===
                    JSON.stringify({
                      database: "pass",
                      stripe: "fail",
                      cache: "pass",
                    })
              )
            )
            .toBe(true);
          expect(api!.providerRequests.length).toBeGreaterThan(firstRequest);
        } finally {
          api!.setProviderState("ready");
        }
        await ready();
        const recovered = await request("/api/trpc/health.ready");
        expect(trpcData(recovered.body)).toEqual({ ready: true });
        expect(api!.pid).toBe(pid);
      },
      15_000
    );

    it.each(["missing-key", "missing-mock"] as const)(
      "starts live but refuses readiness for isolated provider configuration %s without calling a provider",
      async providerConfiguration => {
        phase = `provider configuration ${providerConfiguration}`;
        await withProcess({ providerConfiguration }, async child => {
          for (const path of [
            "/api/rest/health/ready",
            "/api/trpc/health.ready",
          ]) {
            const result = await request(path, undefined, child);
            expect(result.status).toBe(503);
            assertPublicResponse(result.text);
          }
          const live = await request("/api/rest/health/live", undefined, child);
          expect(live.body).toEqual({ alive: true });
          expect(live.status).toBe(200);
          expect(child.providerRequests).toHaveLength(0);
          await expect
            .poll(() => child.records)
            .toContainEqual(
              expect.objectContaining({
                message: "Readiness dependencies are not ready",
                dependencies: {
                  database: "pass",
                  stripe: "fail",
                  cache: "pass",
                },
              })
            );
        });
      },
      40_000
    );

    it("stays ready across an owned native Redis partition and recovers Redis in the same API process", async () => {
      phase = "native Redis partition and recovery";
      await withProcess({ redis: "native" }, async child => {
        const direct = new Redis(child.redis.nativeUrl!, {
          lazyConnect: true,
          maxRetriesPerRequest: 0,
        });
        try {
          await direct.connect();
          const readyRecords = () =>
            child.records.filter(
              record => record.message === "Redis cache service ready"
            ).length;
          await expect
            .poll(readyRecords, { timeout: 10_000 })
            .toBeGreaterThan(0);
          await ready(child);
          const pid = child.pid;
          const initialReady = readyRecords();
          const firstRecord = child.records.length;
          child.redis.disconnect();
          await expect
            .poll(() =>
              child.records
                .slice(firstRecord)
                .some(record => record.message === "Redis connection closed")
            )
            .toBe(true);
          expect(await direct.ping()).toBe("PONG");
          await ready(child);
          const fallback = await request(
            "/api/trpc/health.ready",
            undefined,
            child
          );
          expect(fallback.status).toBe(200);
          expect(trpcData(fallback.body)).toEqual({ ready: true });
          assertPublicResponse(fallback.text);
          child.redis.reconnect();
          await expect
            .poll(readyRecords, { timeout: 15_000 })
            .toBeGreaterThan(initialReady);
          await ready(child);
          expect(child.pid).toBe(pid);
          expect(await direct.ping()).toBe("PONG");
        } finally {
          child.redis.reconnect();
          direct.disconnect();
        }
      });
    }, 50_000);

    it("verifies the original raw webhook bytes before JSON parsing and commits one receipt for an unsupported harmless event", async () => {
      phase = "signed raw webhook";
      const eventId = `evt_nativeapi_${randomUUID()}`;
      const payload =
        JSON.stringify(
          {
            id: eventId,
            object: "event",
            type: "customer.created",
            livemode: false,
            api_version: "2025-12-15.clover",
            data: { object: { id: "cus_native_fixture", object: "customer" } },
          },
          null,
          2
        ) + "\n";
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", apiProcessWebhookSecret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      const headers = {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`,
      };
      const invalid = await request("/api/stripe/webhook", {
        method: "POST",
        headers,
        body: payload + " ",
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toEqual({
        error: "Signature verification failed",
        retryable: false,
      });
      const [before] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT id FROM stripe_events WHERE id=?",
        [eventId]
      );
      expect(before).toHaveLength(0);
      const accepted = await request("/api/stripe/webhook", {
        method: "POST",
        headers,
        body: payload,
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body).toEqual({ received: true });
      const replay = await request("/api/stripe/webhook", {
        method: "POST",
        headers,
        body: payload,
      });
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ received: true, deduplicated: true });
      const [stored] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT id,type,processed,retryCount FROM stripe_events WHERE id=?",
        [eventId]
      );
      expect(stored).toMatchObject([
        { id: eventId, type: "customer.created", processed: 1, retryCount: 0 },
      ]);
    });

    it("rejects oversized JSON and raw-webhook bodies at the real middleware limits", async () => {
      phase = "body limits";
      const json = await request("/api/rest/health/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
      });
      expect(json.status).toBe(413);
      expect(json.body).toMatchObject({ statusCode: 413 });
      assertPublicResponse(json.text);
      const raw = await request("/api/stripe/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": "fixture",
        },
        body: JSON.stringify({ padding: "x".repeat(128 * 1024) }),
      });
      expect(raw.status).toBe(413);
      assertPublicResponse(raw.text);
    });

    it("does not create a pool or connection while stopping an API that has never used the database", async () => {
      phase = "uninitialized pool shutdown";
      await withProcess({}, async child => {
        // Do not probe readiness or send a request: either would legitimately
        // initialize DB work. server_started proves the real entry is listening.
        expect(
          child.records.some(record => record.event === "server_started")
        ).toBe(true);
        expect(
          child.records.some(record => record.event === "pool_initialized")
        ).toBe(false);
        expect(child.proxy.attempts()).toBe(0);
        const stopped = await child.stop("SIGTERM");
        expect(stopped, child.diagnostics()).toEqual({ code: 0, signal: null });
        const events = child.records.map(record => record.event);
        expect(
          events.filter(event => event === "shutdown_initiated")
        ).toHaveLength(1);
        expect(events).toContain("shutdown_completed");
        expect(events).not.toContain("pool_initialized");
        expect(events).not.toContain("pool_closed");
        expect(events).not.toContain("forced_shutdown");
        expect(child.proxy.attempts()).toBe(0);
      });
    }, 40_000);

    it("handles actual SIGINT and a following SIGTERM with one drain and one existing-pool close", async () => {
      phase = "SIGINT during an actual readiness request";
      await withProcess({}, async child => {
        await ready(child);
        const beforeConnections = child.proxy.attempts();
        const beforeProvider = child.providerRequests.length;
        child.setProviderState("timeout");
        const inFlight = request("/api/rest/health/ready", undefined, child);
        // This real provider request holds an actual HTTP response open, so the
        // second signal is delivered while the original shutdown is draining.
        await expect
          .poll(() => child.providerRequests.length)
          .toBeGreaterThan(beforeProvider);
        const stopped = child.stop("SIGINT");
        await expect
          .poll(() =>
            child.records.some(
              record =>
                record.event === "shutdown_initiated" &&
                record.signal === "SIGINT"
            )
          )
          .toBe(true);
        child.signal("SIGTERM");
        expect((await inFlight).status).toBe(503);
        expect(await stopped, child.diagnostics()).toEqual({
          code: 0,
          signal: null,
        });
        const events = child.records.map(record => record.event);
        for (const event of [
          "shutdown_initiated",
          "http_server_closed",
          "observations_stopped",
          "pool_initialized",
          "pool_closed",
          "database_closed",
          "shutdown_completed",
        ])
          expect(
            events.filter(value => value === event),
            event
          ).toHaveLength(1);
        expect(events.indexOf("observations_stopped")).toBeLessThan(
          events.indexOf("pool_closed")
        );
        expect(events.indexOf("pool_closed")).toBeLessThan(
          events.indexOf("shutdown_completed")
        );
        expect(events).not.toContain("forced_shutdown");
        expect(child.proxy.attempts()).toBe(beforeConnections);
        await expect.poll(() => child.proxy.connections()).toBe(0);
      });
    }, 40_000);

    it("exits unsuccessfully after an explicitly injected mysql2 end rejection without claiming a native MySQL failure or a successful close", async () => {
      phase = "injected driver close failure in real API process";
      await withProcess({ poolEndFault: "reject" }, async child => {
        await ready(child);
        expect(child.proxy.connections()).toBeGreaterThan(0);
        const stopped = await child.stop("SIGTERM");
        expect(stopped, child.diagnostics()).toEqual({ code: 1, signal: null });
        const events = child.records.map(record => record.event);
        for (const event of [
          "fixture_pool_end_fault",
          "pool_close_failed",
          "database_closed_error",
          "shutdown_failed",
        ])
          expect(
            events.filter(value => value === event),
            event
          ).toHaveLength(1);
        expect(child.records).toContainEqual(
          expect.objectContaining({
            event: "fixture_pool_end_fault",
            fault: "reject",
            evidence: "injected mysql2 end outcome; not a native MySQL failure",
          })
        );
        for (const event of [
          "pool_closed",
          "database_closed",
          "shutdown_completed",
          "forced_shutdown",
        ])
          expect(events).not.toContain(event);
        await expect.poll(() => child.proxy.connections()).toBe(0);
        const [control] =
          await admin!.query<mysql.RowDataPacket[]>("SELECT 1 AS alive");
        expect(control[0].alive).toBe(1);
      });
    }, 40_000);

    it("enforces the actual shutdown deadline for an explicitly hung driver end and ignores a second signal", async () => {
      phase = "injected driver close hang in real API process";
      await withProcess({ poolEndFault: "hang" }, async child => {
        await ready(child);
        const started = Date.now();
        const stopped = child.stop("SIGINT");
        await expect
          .poll(() =>
            child.records.some(
              record =>
                record.event === "fixture_pool_end_fault" &&
                record.fault === "hang"
            )
          )
          .toBe(true);
        child.signal("SIGTERM");
        expect(await stopped, child.diagnostics()).toEqual({
          code: 1,
          signal: null,
        });
        const elapsed = Date.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(9500);
        expect(elapsed).toBeLessThan(13_000);
        const events = child.records.map(record => record.event);
        for (const event of [
          "shutdown_initiated",
          "fixture_pool_end_fault",
          "forced_shutdown",
        ])
          expect(
            events.filter(value => value === event),
            event
          ).toHaveLength(1);
        expect(child.records).toContainEqual(
          expect.objectContaining({
            event: "forced_shutdown",
            signal: "SIGINT",
          })
        );
        for (const event of [
          "pool_closed",
          "database_closed",
          "shutdown_completed",
        ])
          expect(events).not.toContain(event);
        await expect.poll(() => child.proxy.connections()).toBe(0);
      });
    }, 45_000);

    it("enforces real REST/tRPC and webhook quotas during Redis fallback, then recovers after their unchanged windows", async () => {
      phase = "real middleware quota exhaustion and window recovery";
      const pid = api!.pid;
      const livePaths = ["/api/rest/health/live", "/api/trpc/health.live"];
      let apiLimited = false;
      let apiAccepted = 0;
      for (let attempt = 0; attempt <= 60; attempt++) {
        const result = await request(livePaths[attempt % livePaths.length]);
        expect(result.headers.get("x-ratelimit-limit")).toBe("60");
        if (result.status === 429) {
          apiLimited = true;
          expect(result.headers.get("x-ratelimit-remaining")).toBe("0");
          expect(Number(result.headers.get("retry-after"))).toBeGreaterThan(0);
          expect(Number(result.headers.get("retry-after"))).toBeLessThanOrEqual(
            60
          );
          expect(result.body).toMatchObject({
            error: "TOO_MANY_REQUESTS",
            limit: 60,
          });
          assertPublicResponse(result.text);
          break;
        }
        expect(result.status).toBe(200);
        apiAccepted++;
      }
      expect(apiAccepted).toBeGreaterThan(0);
      expect(apiLimited).toBe(true);
      // Both transports share the original anonymous quota, even with Redis
      // unavailable. Switching routers must not bypass the exhausted bucket.
      for (const path of livePaths)
        expect((await request(path)).status).toBe(429);

      const invalidWebhook = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": "fixture",
        },
        body: "{}",
      };
      let webhookLimited = false;
      let webhookAccepted = 0;
      for (let attempt = 0; attempt <= 50; attempt++) {
        const result = await request("/api/stripe/webhook", invalidWebhook);
        expect(result.headers.get("x-ratelimit-limit")).toBe("50");
        if (result.status === 429) {
          webhookLimited = true;
          expect(result.headers.get("x-ratelimit-remaining")).toBe("0");
          expect(Number(result.headers.get("retry-after"))).toBeGreaterThan(0);
          expect(Number(result.headers.get("retry-after"))).toBeLessThanOrEqual(
            60
          );
          expect(result.body).toMatchObject({ error: "TOO_MANY_REQUESTS" });
          break;
        }
        // An admitted invalid signature reaches the real raw-body handler;
        // it has no financial or receipt effect and is distinct from a 429.
        expect(result.status).toBe(400);
        webhookAccepted++;
      }
      expect(webhookAccepted).toBeGreaterThan(0);
      expect(webhookLimited).toBe(true);
      // Real elapsed time, without fake clocks, quota resets or test-only limits.
      await expect
        .poll(
          async () => {
            const responses = await Promise.all([
              ...livePaths.map(path => request(path)),
              request("/api/stripe/webhook", invalidWebhook),
            ]);
            return responses.map(response => response.status);
          },
          { timeout: 65_000, interval: 1000 }
        )
        .toEqual([200, 200, 400]);
      expect(api!.pid).toBe(pid);
      await ready();
      expect(api!.redis.rejectedConnections()).toBeGreaterThan(0);
    }, 80_000);

    it("exits on a real SIGTERM after flushing observations and closing its existing pool", async () => {
      phase = "shutdown readiness";
      await ready();
      const diagnostics = () => {
        const lifecycle = api!.records
          .filter(record =>
            /shutdown|closed|stopped|sentry_/.test(String(record.event))
          )
          .slice(-20)
          .map(record => ({ event: record.event, message: record.message }));
        return `API shutdown receipts:\n${JSON.stringify(lifecycle, null, 2).slice(-4000)}\nCaptured child output (bounded):\n${api!.diagnostics()}`;
      };
      let stopped;
      try {
        stopped = await api!.stop();
      } catch (error) {
        throw new Error(diagnostics(), { cause: error });
      }
      expect(stopped, diagnostics()).toEqual({ code: 0, signal: null });
      const events = api!.records.map(record => record.event);
      expect(events).toContain("pool_closed");
      expect(events).toContain("database_closed");
      expect(events).toContain("shutdown_completed");
      expect(events).not.toContain("forced_shutdown");
      expect(events.indexOf("pool_closed")).toBeLessThan(
        events.indexOf("shutdown_completed")
      );
      await expect.poll(() => api!.proxy.connections()).toBe(0);
      const [samples] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT requests FROM operational_samples WHERE component='api'"
      );
      expect(samples.some(sample => Number(sample.requests) > 0)).toBe(true);
      expect(api!.providerRequests.length).toBeGreaterThan(0);
      expect(
        api!.providerRequests.every(
          request =>
            request.method === "GET" &&
            request.path === "/v1/balance" &&
            request.authorized
        )
      ).toBe(true);
    }, 15_000);
  }
);
