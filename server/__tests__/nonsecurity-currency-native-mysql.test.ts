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
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  const key = "exchange_rate:v3:SAR_KWD";
  const pair = { fromCurrency: "SAR", toCurrency: "KWD" };

  async function response(procedure: string, input: Record<string, unknown>) {
    const serialized = JSON.stringify(superjson.serialize(input));
    const encoded = encodeURIComponent(serialized);
    const reply = await fetch(`${url}/${procedure}?input=${encoded}`);
    return { status: reply.status, body: await reply.json() };
  }

  async function request(procedure: string, input: Record<string, unknown>) {
    const { status, body } = await response(procedure, input);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    return superjson.deserialize(body.result.data);
  }

  async function seed(
    id: number,
    rate: string,
    from: Date,
    until: Date | null,
    currencies = pair,
    updatedAt: Date | null = from
  ) {
    await connection!.execute(
      `INSERT INTO \`${table}\` (id,fromCurrency,toCurrency,rate,source,validFrom,validTo,updatedAt) VALUES (?,?,?,?,'bank',?,?,?)`,
      [
        id,
        currencies.fromCurrency,
        currencies.toCurrency,
        rate,
        from,
        until,
        updatedAt,
      ]
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

  afterEach(() => {
    vi.useRealTimers();
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
    await seed(1, "0.081", past, future);
    await request("getExchangeRate", pair);
    const stored = await reference!.get(key);
    expect(stored).not.toBeNull();
    const snapshot = JSON.parse(stored!);
    // Preserve all other genuine cache metadata so only expiry is invalid.
    snapshot.expiresAt = past.toISOString();
    await reference!.setex(key, 60, JSON.stringify(snapshot));
    await seed(2, "0.084", past, future);
    const result = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(result.data.rate).toBe(0.084);
    expect(result.data.source).toBe("bank");
  });

  it.each([
    {
      name: "a direct pair",
      currencies: pair,
      current: [{ ...pair, rate: "0.081" }],
      next: { ...pair, rate: "0.085" },
      before: 0.081,
      after: 0.085,
      beforeSource: "bank",
      afterSource: "bank",
    },
    {
      name: "a SAR component of a cached cross rate",
      currencies: { fromCurrency: "USD", toCurrency: "AED" },
      current: [
        { fromCurrency: "USD", toCurrency: "SAR", rate: "3.75" },
        { fromCurrency: "SAR", toCurrency: "AED", rate: "0.9793" },
      ],
      next: { fromCurrency: "SAR", toCurrency: "AED", rate: "1" },
      before: 3.672375,
      after: 3.75,
      beforeSource: "cross_rate",
      afterSource: "cross_rate",
    },
    {
      name: "a scheduled direct observation replacing a cached cross rate",
      currencies: { fromCurrency: "USD", toCurrency: "AED" },
      current: [
        { fromCurrency: "USD", toCurrency: "SAR", rate: "3.75" },
        { fromCurrency: "SAR", toCurrency: "AED", rate: "0.9793" },
      ],
      next: { fromCurrency: "USD", toCurrency: "AED", rate: "4" },
      before: 3.672375,
      after: 4,
      beforeSource: "cross_rate",
      afterSource: "bank",
    },
  ])("refreshes warmed Redis bytes at validFrom for $name", async scenario => {
    // Only the application's Date clock is controlled. Native MySQL queries,
    // Redis expiry and HTTP remain real, so a still-live Redis value cannot
    // conceal a stale snapshot at the inclusive observation boundary.
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2030-06-10T12:00:00Z");
    const starts = new Date("2030-06-10T12:00:30Z");
    vi.setSystemTime(now);
    for (const [index, row] of scenario.current.entries())
      await seed(index + 1, row.rate, new Date(+now - 60_000), null, row);
    await seed(10, scenario.next.rate, starts, null, scenario.next);

    const first = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", scenario.currencies)
    );
    expect(first.data.rate).toBeCloseTo(scenario.before, 12);
    expect(first.data.source).toBe(scenario.beforeSource);
    const cacheKey = `exchange_rate:v3:${scenario.currencies.fromCurrency}_${scenario.currencies.toCurrency}`;
    const cached = await reference!.get(cacheKey);
    expect(cached).not.toBeNull();
    expect(await reference!.ttl(cacheKey)).toBeGreaterThan(0);
    expect(await reference!.ttl(cacheKey)).toBeLessThanOrEqual(30);

    vi.setSystemTime(new Date(+starts - 1000));
    const before = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", scenario.currencies)
    );
    expect(before.data).toEqual(first.data);
    expect(await reference!.get(cacheKey)).toBe(cached);

    vi.setSystemTime(starts);
    // Redis uses its own actual clock and has not expired this key yet.
    expect(await reference!.ttl(cacheKey)).toBeGreaterThan(0);
    const current = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", scenario.currencies)
    );
    expect(current.data.rate).toBe(scenario.after);
    expect(current.data.source).toBe(scenario.afterSource);
    expect(current.data.updatedAt).toBeInstanceOf(Date);
    expect(await reference!.get(cacheKey)).not.toBe(cached);
  });

  it("rounds 1000 USD through native decimal legs to 3672.38 AED cold and after a Redis roundtrip", async () => {
    const time = Math.floor(Date.now() / 1000) * 1000;
    const from = new Date(time - 60_000);
    const until = new Date(time + 600_000);
    await seed(1, "3.75", from, until, {
      fromCurrency: "USD",
      toCurrency: "SAR",
    });
    await seed(2, "0.9793", from, until, {
      fromCurrency: "SAR",
      toCurrency: "AED",
    });
    const input = {
      amount: 1000,
      fromCurrency: "USD",
      toCurrency: "AED",
    };
    const cold = responseContracts.convertCurrency.parse(
      await request("convertCurrency", input)
    );
    expect(cold.data).toMatchObject({
      originalAmount: 1000,
      originalCurrency: "USD",
      targetCurrency: "AED",
      convertedAmount: 3672.38,
      rateTimestamp: from,
    });
    expect(cold.data.exchangeRate).toBeCloseTo(3.672375, 12);
    const crossKey = "exchange_rate:v3:USD_AED";
    expect(await reference!.get(crossKey)).not.toBeNull();
    expect(await reference!.ttl(crossKey)).toBeGreaterThan(0);

    // Remove both SQL inputs and their individual caches. The second request
    // must preserve the composed quote through its real Redis JSON roundtrip.
    await connection!.query(`DELETE FROM \`${table}\``);
    await reference!.del(
      "exchange_rate:v3:USD_SAR",
      "exchange_rate:v3:SAR_AED"
    );
    const warm = responseContracts.convertCurrency.parse(
      await request("convertCurrency", input)
    );
    expect(warm.data).toEqual(cold.data);
    expect(warm.data.convertedAmount).toBe(3672.38);
    const quote = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", {
        fromCurrency: "USD",
        toCurrency: "AED",
      })
    );
    expect(quote.data.source).toBe("cross_rate");
    expect(quote.data.updatedAt).toEqual(from);
  });

  it("retains the native DECIMAL string when the public numeric rate rounds to a neighboring value", async () => {
    const time = Math.floor(Date.now() / 1000) * 1000;
    const currencies = { fromCurrency: "USD", toCurrency: "AED" };
    await seed(
      1,
      "999999999.99999999",
      new Date(time - 60_000),
      new Date(time + 600_000),
      currencies
    );
    const [rows] = await connection!.query<mysql.RowDataPacket[]>(
      `SELECT rate FROM \`${table}\` WHERE id=1`
    );
    expect(rows[0].rate).toBe("999999999.99999999");
    const input = { ...currencies, amount: 5e-12 };
    const cold = responseContracts.convertCurrency.parse(
      await request("convertCurrency", input)
    );
    // The exact result is just below half a cent. Converting the DECIMAL to
    // Number before multiplying would incorrectly turn this into 0.01 AED.
    expect(cold.data.convertedAmount).toBe(0);
    expect(cold.data.exchangeRate).toBe(1_000_000_000);
    expect(await reference!.get("exchange_rate:v3:USD_AED")).not.toBeNull();

    await connection!.query(`DELETE FROM \`${table}\``);
    const warm = responseContracts.convertCurrency.parse(
      await request("convertCurrency", input)
    );
    expect(warm.data).toEqual(cold.data);
    const aboveHalf = responseContracts.convertCurrency.parse(
      await request("convertCurrency", {
        ...currencies,
        amount: 5.00000001e-12,
      })
    );
    expect(aboveHalf.data.convertedAmount).toBe(0.01);
  });

  it("returns an explicitly labeled uncached fallback after a genuine query failure with a live database handle", async () => {
    const time = Date.now();
    await seed(1, "0.086", new Date(time - 60_000), new Date(time + 600_000));
    const handle = boundary.db;
    expect(handle).toBeTruthy();
    const unavailableTable = `${table}_query_failure`;
    await connection!.query(
      `RENAME TABLE \`${table}\` TO \`${unavailableTable}\``
    );
    try {
      const [alive] = await connection!.query<mysql.RowDataPacket[]>(
        "SELECT 1 AS connected"
      );
      expect(alive[0].connected).toBe(1);
      expect(boundary.db).toBe(handle);
      await expect(
        connection!.query(`SELECT rate FROM \`${table}\``)
      ).rejects.toMatchObject({ code: "ER_NO_SUCH_TABLE" });

      const estimate = responseContracts.getExchangeRate.parse(
        await request("getExchangeRate", pair)
      );
      expect(estimate.data).toMatchObject({
        ...pair,
        source: "fallback",
        rate: 0.082,
      });
      expect(estimate.data.updatedAt).toBeInstanceOf(Date);
      const converted = responseContracts.convertCurrency.parse(
        await request("convertCurrency", { ...pair, amount: 1 })
      );
      expect(converted.data.convertedAmount).toBe(0.082);
      expect(await reference!.keys("exchange_rate:*")).toEqual([]);
    } finally {
      await connection!.query(
        `RENAME TABLE \`${unavailableTable}\` TO \`${table}\``
      );
    }

    const recovered = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(recovered.data.rate).toBe(0.086);
    expect(recovered.data.source).toBe("bank");
    expect(await reference!.get(key)).not.toBeNull();
  });

  it("rejects malformed selected MySQL metadata instead of turning validation failure into fallback", async () => {
    const time = Date.now();
    const from = new Date(time - 60_000);
    // The existing types-only fixture deliberately permits NULL metadata to
    // exercise validation of a driver result. This does not claim a bypass of
    // the migrated schema's NOT NULL constraint.
    await seed(1, "0.086", from, new Date(time + 600_000), pair, null);
    const [rows] = await connection!.query<mysql.RowDataPacket[]>(
      `SELECT rate, updatedAt FROM \`${table}\` WHERE id=1`
    );
    expect(rows[0].updatedAt).toBeNull();
    expect(Number(rows[0].rate)).toBe(0.086);
    for (const [procedure, input] of [
      ["getExchangeRate", pair],
      ["convertCurrency", { ...pair, amount: 1 }],
    ] as const) {
      const rejected = await response(procedure, input);
      expect(rejected.status).toBe(400);
      expect(rejected.body.error?.json?.data?.code).toBe("BAD_REQUEST");
      expect(rejected.body.result).toBeUndefined();
    }
    expect(await reference!.keys("exchange_rate:*")).toEqual([]);

    await connection!.execute(
      `UPDATE \`${table}\` SET updatedAt=? WHERE id=1`,
      [from]
    );
    const repaired = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(repaired.data.source).toBe("bank");
    expect(repaired.data.rate).toBe(0.086);
  });
});
