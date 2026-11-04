import crypto from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import Redis from "ioredis";
import { startRedisFaultProxy } from "./helpers/redis-fault-proxy";
import type { CacheCommand } from "./helpers/cache-process-worker";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test"
    ? describe
    : describe.skip;

type Worker = {
  child: ChildProcess;
  request: (command: Omit<CacheCommand, "id">) => Promise<unknown>;
  stop: () => Promise<void>;
};

nativeDescribe(
  "durable cache recovery with native MySQL and Redis processes",
  () => {
    const prefix = `ais_cache_recovery_${crypto.randomBytes(6).toString("hex")}`;
    const database = `ais_cache_recovery_${crypto.randomBytes(6).toString("hex")}`;
    let created = false;
    let admin: Connection | undefined;
    let probe: Redis | undefined;
    let proxy: Awaited<ReturnType<typeof startRedisFaultProxy>> | undefined;
    let databaseURL: string;
    let redisURL: string;
    const workers: Worker[] = [];
    let writer: Worker;
    let reader: Worker;

    function startWorker(url: string, cachePrefix = prefix): Worker {
      const child = fork(
        fileURLToPath(
          new URL("./helpers/cache-process-worker.ts", import.meta.url)
        ),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          env: {
            ...process.env,
            DATABASE_URL: databaseURL,
            REDIS_URL: url,
            CACHE_PREFIX: cachePrefix,
            LOG_LEVEL: "fatal",
            DB_POOL_SIZE: "2",
            DB_MAX_IDLE: "2",
          },
        }
      );
      let sequence = 0;
      let markReady!: () => void;
      const ready = new Promise<void>(resolve => {
        markReady = resolve;
      });
      const pending = new Map<
        number,
        {
          resolve: (value: unknown) => void;
          reject: (error: Error) => void;
          timer: NodeJS.Timeout;
        }
      >();
      let output = "";
      child.stdout?.on("data", chunk => {
        output = (output + String(chunk)).slice(-3000);
      });
      child.stderr?.on("data", chunk => {
        output = (output + String(chunk)).slice(-3000);
      });
      child.on(
        "message",
        (reply: {
          id: number;
          value?: unknown;
          error?: string;
          ready?: boolean;
        }) => {
          if (reply.ready) {
            markReady();
            return;
          }
          const request = pending.get(reply.id);
          if (!request) return;
          clearTimeout(request.timer);
          pending.delete(reply.id);
          if (reply.error) request.reject(new Error(reply.error));
          else request.resolve(reply.value);
        }
      );
      child.on("exit", (code, signal) => {
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(
            new Error(`Cache worker exited ${code}/${signal}: ${output}`)
          );
        }
        pending.clear();
      });
      const worker: Worker = {
        child,
        request(command) {
          return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(
                new Error(
                  `Cache worker command timed out: ${command.operation}: ${output}`
                )
              );
            }, 8000);
            pending.set(id, { resolve, reject, timer });
            void ready.then(() => {
              if (!pending.has(id)) return;
              child.send({ ...command, id }, error => {
                if (error) {
                  clearTimeout(timer);
                  pending.delete(id);
                  reject(error);
                }
              });
            });
          });
        },
        async stop() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exited = new Promise<void>(resolve =>
            child.once("exit", () => resolve())
          );
          try {
            await worker.request({ operation: "shutdown" });
          } finally {
            const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
            await exited;
            clearTimeout(timer);
          }
        },
      };
      workers.push(worker);
      return worker;
    }

    async function connected(worker: Worker, expected: boolean) {
      const deadline = performance.now() + 7000;
      while (performance.now() < deadline) {
        if ((await worker.request({ operation: "connected" })) === expected)
          return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(await worker.request({ operation: "connected" })).toBe(expected);
    }

    beforeAll(async () => {
      const source = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = source.pathname.slice(1);
      if (
        source.protocol !== "mysql:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) ||
        !/^ais_[a-z0-9_]*test$/.test(sourceDatabase)
      ) {
        throw new Error(
          "Native cache recovery requires an explicit loopback ais_*test MySQL database"
        );
      }
      if (!process.env.REDIS_URL)
        throw new Error("Native cache recovery requires REDIS_URL");
      redisURL = process.env.REDIS_URL;
      proxy = await startRedisFaultProxy(redisURL);
      probe = new Redis(redisURL, {
        maxRetriesPerRequest: 1,
        commandTimeout: 1000,
      });
      await probe.ping();
      admin = await mysql.createConnection(source.toString());
      await admin.query(`CREATE DATABASE \`${database}\``);
      created = true;
      await admin.query(
        `CREATE TABLE \`${database}\`.cache_namespace_generations LIKE \`${sourceDatabase}\`.cache_namespace_generations`
      );
      source.pathname = `/${database}`;
      databaseURL = source.toString();
      writer = startWorker(proxy.url);
      reader = startWorker(redisURL);
      await Promise.all([connected(writer, true), connected(reader, true)]);
    }, 30000);

    afterAll(async () => {
      await Promise.allSettled(workers.map(worker => worker.stop()));
      await proxy?.close();
      if (probe) {
        let cursor = "0";
        do {
          const [next, keys] = await probe.scan(
            cursor,
            "MATCH",
            `${prefix}*:*`,
            "COUNT",
            100
          );
          cursor = next;
          if (keys.length) await probe.del(...keys);
        } while (cursor !== "0");
        await probe.quit();
      }
      if (created) await admin?.query(`DROP DATABASE \`${database}\``);
      await admin?.end();
    }, 15000);

    it("survives writer-only Redis isolation, writer death, a late reader fill and a restarted writer", async () => {
      await writer.request({ operation: "set", value: "before mutation" });
      expect(await reader.request({ operation: "get" })).toBe(
        "before mutation"
      );
      await reader.request({ operation: "capture", token: "old-source-read" });
      const versionBefore = await probe!.get(`${prefix}:version:search`);
      const keysBefore = await probe!.keys(`${prefix}:search:*`);
      expect(keysBefore).toHaveLength(1);

      proxy!.disconnect();
      await connected(writer, false);
      await connected(reader, true);
      await writer.request({ operation: "invalidate" });
      expect(await probe!.get(`${prefix}:version:search`)).toBe(versionBefore);
      expect(await probe!.get(keysBefore[0])).toBe(
        JSON.stringify("before mutation")
      );
      const exited = new Promise<NodeJS.Signals | null>(resolve =>
        writer.child.once("exit", (_code, signal) => resolve(signal))
      );
      writer.child.kill("SIGKILL");
      expect(await exited).toBe("SIGKILL");

      // The connected replica has seen no reconnect event or local invalidation.
      expect(await reader.request({ operation: "get" })).toBeNull();
      await reader.request({ operation: "set", value: "after mutation" });
      await reader.request({
        operation: "fill",
        token: "old-source-read",
        value: "late stale fill",
      });
      expect(await reader.request({ operation: "get" })).toBe("after mutation");
      const [rows] = await admin!.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM \`${database}\`.cache_namespace_generations`
      );
      expect(Number(rows[0].count)).toBe(1);

      proxy!.reconnect();
      writer = startWorker(proxy!.url);
      await connected(writer, true);
      expect(await writer.request({ operation: "get" })).toBe("after mutation");
    }, 20000);

    it("isolates prefixes and namespaces, and durably clears versioned keys without falsely claiming raw erasure", async () => {
      const other = startWorker(redisURL, `${prefix}_other`);
      await connected(other, true);
      await other.request({ operation: "set", value: "other prefix" });
      await writer.request({
        operation: "set",
        namespace: "airports",
        value: "reference",
      });
      await writer.request({
        operation: "raw-set",
        namespace: "raw-key",
        value: "raw value",
      });
      await reader.request({
        operation: "capture",
        namespace: "airports",
        token: "pre-clear",
      });
      proxy!.disconnect();
      await connected(writer, false);
      await expect(writer.request({ operation: "clear" })).rejects.toThrow(
        "raw Redis cleanup is unconfirmed"
      );
      expect(await reader.request({ operation: "get" })).toBeNull();
      expect(
        await reader.request({ operation: "get", namespace: "airports" })
      ).toBeNull();
      expect(
        await reader.request({ operation: "raw-get", namespace: "raw-key" })
      ).toBe("raw value");
      expect(await other.request({ operation: "get" })).toBe("other prefix");
      await reader.request({
        operation: "fill",
        namespace: "airports",
        token: "pre-clear",
        value: "stale reference",
      });
      expect(
        await reader.request({ operation: "get", namespace: "airports" })
      ).toBeNull();
      proxy!.reconnect();
      await connected(writer, true);
      await writer.request({ operation: "clear" });
      expect(
        await reader.request({ operation: "raw-get", namespace: "raw-key" })
      ).toBeNull();
      expect(await other.request({ operation: "get" })).toBe("other prefix");
    }, 20000);

    it("bypasses warm entries and rejects invalidation when the durable authority is unavailable", async () => {
      await reader.request({
        operation: "set",
        value: "must not guess initial generation",
      });
      expect(await reader.request({ operation: "get" })).toBe(
        "must not guess initial generation"
      );
      await admin!.query(
        `RENAME TABLE \`${database}\`.cache_namespace_generations TO \`${database}\`.authority_unavailable`
      );
      try {
        const started = performance.now();
        expect(await reader.request({ operation: "get" })).toBeNull();
        expect(performance.now() - started).toBeLessThan(1500);
        await expect(
          reader.request({ operation: "invalidate" })
        ).rejects.toThrow();
        await reader.request({
          operation: "set",
          value: "unverifiable source fill",
        });
      } finally {
        await admin!.query(
          `RENAME TABLE \`${database}\`.authority_unavailable TO \`${database}\`.cache_namespace_generations`
        );
      }
      expect(await writer.request({ operation: "get" })).toBe(
        "must not guess initial generation"
      );
    }, 10000);
  }
);
