import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiProcessWebhookSecret,
  startApiProcessFixture,
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
    let created = false;

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
      api = await startApiProcessFixture(source.toString());
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

    async function request(path: string, init?: RequestInit) {
      if (!api) throw new Error("API fixture was not started");
      const response = await fetch(api.origin + path, {
        ...init,
        signal: AbortSignal.timeout(5000),
      });
      const text = await response.text();
      return {
        status: response.status,
        text,
        body: JSON.parse(text) as Record<string, unknown>,
      };
    }
    async function ready() {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const result = await request("/api/rest/health/ready");
        if (result.status === 200) {
          expect(result.body).toEqual({ ready: true });
          return;
        }
        if (Date.now() >= deadline)
          throw new Error(
            `API did not become ready: ${result.text}; ${api?.diagnostics()}`
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
    }

    it("keeps REST/tRPC liveness while only the child's DB route fails, then recovers readiness in the same process", async () => {
      expect(api!.proxy.connections()).toBeGreaterThan(0);
      const pid = api!.pid;
      const initial = await request("/api/trpc/health.ready");
      expect(initial.status).toBe(200);
      expect(trpcData(initial.body)).toEqual({ ready: true });
      api!.proxy.disconnect();
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
      await ready();
      const recovered = await request("/api/trpc/health.ready");
      expect(recovered.status).toBe(200);
      expect(trpcData(recovered.body)).toEqual({ ready: true });
      expect(api!.pid).toBe(pid);
    }, 25_000);

    it("keeps detailed health protected on both registered transports", async () => {
      for (const path of ["/api/rest/health", "/api/trpc/health.check"]) {
        const denied = await request(path);
        expect(denied.status).toBe(401);
        assertPublicResponse(denied.text);
      }
    });

    it("verifies the original raw webhook bytes before JSON parsing and commits one receipt for an unsupported harmless event", async () => {
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

    it("exits on a real SIGTERM after flushing observations and closing its existing pool", async () => {
      await ready();
      expect(await api!.stop()).toEqual({ code: 0, signal: null });
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
