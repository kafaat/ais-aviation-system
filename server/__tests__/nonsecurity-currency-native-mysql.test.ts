import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import mysql from "mysql2/promise";
import Redis from "ioredis";
import superjson from "superjson";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { responseContracts } from "../contracts/pricing.router";
import { startNativeRedis } from "./helpers/native-redis";

type FxCache = typeof import("../services/cache.service").cacheService;
const boundary = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
// Currency SQL, Redis, the production pricing router, HTTP transport and output
// validation are real. The dynamic pricing engine is not exercised here.
vi.mock("../services/pricing/dynamic-pricing.service", () => ({
  DynamicPricingService: {},
}));

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.AIS_TEST_REDIS_SERVER_BIN);
const nativeDescribe = allowed ? describe : describe.skip;

nativeDescribe("currency over native MySQL, Redis and HTTP", () => {
  let admin: mysql.Connection | undefined;
  let connection: mysql.Connection | undefined;
  let databaseName = "";
  let databaseCreated = false;
  let redisFixture: Awaited<ReturnType<typeof startNativeRedis>> | undefined;
  let reference: Redis | undefined;
  let cache: FxCache | undefined;
  let server: Server | undefined;
  let url = "";
  const table = getTableName(schema.exchangeRates);
  const key = "exchange_rate:v2:SAR_KWD";
  const pair = { fromCurrency: "SAR", toCurrency: "KWD" };

  async function request(procedure: string, input: Record<string, unknown>) {
    const serialized = JSON.stringify(superjson.serialize(input));
    const encoded = encodeURIComponent(serialized);
    const response = await fetch(`${url}/${procedure}?input=${encoded}`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    return superjson.deserialize(body.result.data);
  }

  async function seed(id: number, rate: string, from: Date, until: Date) {
    await connection!.execute(
      `INSERT INTO \`${table}\` (id,fromCurrency,toCurrency,rate,source,validFrom,validTo,updatedAt) VALUES (?,'SAR','KWD',?,'bank',?,?,?)`,
      [id, rate, from, until, from]
    );
  }

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL!);
    const options = {
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
      timezone: "Z",
    };
    databaseName = `ais_fx_${randomBytes(6).toString("hex")}`;
    if (!/^ais_fx_[0-9a-f]{12}$/.test(databaseName))
      throw new Error("Invalid disposable database identity");
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    databaseCreated = true;
    connection = await mysql.createConnection({
      ...options,
      database: databaseName,
    });
    await connection.query("SET SESSION time_zone = '+00:00'");
    // Use canonical column names and MySQL types. This fixture proves query and
    // driver behavior, not full migration/index/constraint parity.
    const columns = Object.values(getTableColumns(schema.exchangeRates)).map(
      column => `\`${column.name}\` ${column.getSQLType()}`
    );
    await connection.query(`CREATE TABLE \`${table}\` (${columns.join(",")})`);
    boundary.db = drizzle(connection, { schema, mode: "default" });

    redisFixture = await startNativeRedis();
    vi.stubEnv("REDIS_URL", redisFixture.url);
    reference = new Redis(redisFixture.url, { lazyConnect: true });
    await reference.connect();
    ({ cacheService: cache } = await import("../services/cache.service"));
    await vi.waitFor(() => {
      if (!cache?.isConnected()) throw new Error("Isolated Redis is not ready");
    });
    const { pricingRouter } = await import("../routers/pricing.router");
    const app = express();
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: pricingRouter,
        createContext: ({ req, res }) => ({
          req,
          res,
          user: null,
          authMethod: null,
          tenantId: null,
        }),
      })
    );
    server = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });
    const port = (server.address() as AddressInfo).port;
    url = `http://127.0.0.1:${port}/api/trpc`;
  }, 30000);

  beforeEach(async () => {
    await connection!.query(`DELETE FROM \`${table}\``);
    // This Redis process is owned exclusively by this fixture, never REDIS_URL
    // inherited from a developer shell or the shared CI service.
    await reference!.flushdb();
  });

  afterAll(async () => {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server!.close(error => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      boundary.db = null;
      try {
        await cache?.disconnect();
        await reference?.quit();
      } finally {
        reference?.disconnect();
        try {
          await redisFixture?.stop();
          await connection?.end();
        } finally {
          try {
            if (databaseCreated)
              await admin?.query(`DROP DATABASE \`${databaseName}\``);
          } finally {
            await admin?.end();
            vi.unstubAllEnvs();
          }
        }
      }
    }
  });

  it("preserves three decimals through the public route", async () => {
    for (const currency of ["KWD", "BHD", "OMR"]) {
      const result = responseContracts.convertCurrency.parse(
        await request("convertCurrency", {
          amount: 1.234,
          fromCurrency: currency,
          toCurrency: currency,
        })
      );
      expect(result.data.convertedAmount).toBe(1.234);
      expect(result.data.rateTimestamp).toBeInstanceOf(Date);
    }
  });

  it("proves the Redis cache hit after the MySQL read", async () => {
    const time = Date.now();
    const from = new Date(time - 60000);
    const until = new Date(time + 60000);
    await seed(1, "0.082", from, until);
    const first = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    const stored = await reference!.get(key);
    expect(stored).not.toBeNull();
    expect(typeof JSON.parse(stored!).quote.updatedAt).toBe("string");
    expect(await reference!.ttl(key)).toBeGreaterThan(0);
    expect(await reference!.ttl(key)).toBeLessThanOrEqual(60);
    await connection!.query(`DELETE FROM \`${table}\``);
    const second = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(second.data).toEqual(first.data);
    expect(second.data.source).toBe("bank");
    const converted = responseContracts.convertCurrency.parse(
      await request("convertCurrency", { ...pair, amount: 1 })
    );
    expect(converted.data.convertedAmount).toBe(0.082);
    expect(converted.data.rateTimestamp).toEqual(first.data.updatedAt);
  });

  it("rejects future and expired MySQL observations", async () => {
    const time = Date.now();
    const past = new Date(time - 60000);
    const future = new Date(time + 60000);
    await seed(1, "0.081", past, future);
    await seed(2, "0.9", future, new Date(time + 120000));
    await seed(3, "0.8", new Date(time - 120000), past);
    const result = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(result.data.rate).toBe(0.081);
  });

  it("rechecks snapshot expiry independently of Redis", async () => {
    const time = Date.now();
    const past = new Date(time - 60000);
    const future = new Date(time + 60000);
    await seed(1, "0.084", past, future);
    await reference!.setex(
      key,
      60,
      JSON.stringify({
        version: 2,
        quote: {
          fromCurrency: "SAR",
          toCurrency: "KWD",
          rate: 0.9,
          inverseRate: 1 / 0.9,
          source: "expired-fixture",
          updatedAt: new Date(time - 120000),
        },
        validFrom: new Date(time - 120000),
        expiresAt: past,
      })
    );
    const result = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(result.data.rate).toBe(0.084);
    expect(result.data.source).toBe("bank");
  });
});
