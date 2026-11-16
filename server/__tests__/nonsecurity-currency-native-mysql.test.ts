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
import type { TrpcContext } from "../_core/context";
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

  // Round 3 (#378): the routes take the display rule and read MySQL on every
  // call, with no Redis snapshot. The generic functions keep the cache, so
  // the snapshot assertions below exercise them.
  const generic = () => import("../services/currency/currency.service");
  const rateKeys = async () =>
    (await reference!.keys("exchange_rate:v3:*")).sort();

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
    expect(await rateKeys()).toEqual([]);
    const { getExchangeRate, convertCurrency } = await generic();
    expect(await getExchangeRate("SAR", "KWD")).toEqual(first.data);
    const stored = await reference!.get(key);
    expect(stored).not.toBeNull();
    expect(typeof JSON.parse(stored!).quote.updatedAt).toBe("string");
    expect(await reference!.ttl(key)).toBeGreaterThan(0);
    expect(await reference!.ttl(key)).toBeLessThanOrEqual(60);
    await connection!.query(`DELETE FROM \`${table}\``);
    const second = await getExchangeRate("SAR", "KWD");
    expect(second).toEqual(first.data);
    expect(second.source).toBe("bank");
    const converted = await convertCurrency(1, "SAR", "KWD");
    expect(converted.convertedAmount).toBe(0.082);
    expect(converted.rateTimestamp).toEqual(first.data.updatedAt);
    // With the row gone the routes answer from MySQL: the labelled estimate
    // (SAR_KWD 0.082 is also the constant) and no converted amount.
    const routeQuote = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", pair)
    );
    expect(routeQuote.data).toMatchObject({
      ...pair,
      rate: 0.082,
      source: "fallback",
    });
    const refused = await response("convertCurrency", { ...pair, amount: 1 });
    expect(refused.status).toBe(412);
    expect(refused.body.error?.json?.data?.code).toBe("PRECONDITION_FAILED");
    expect(await reference!.get(key)).toBe(stored);
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
    expect(await rateKeys()).toEqual([]);
    const { getExchangeRate } = await generic();
    await getExchangeRate("SAR", "KWD");
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
    // The route left the planted bytes alone; the generic quote rechecks them.
    expect(await reference!.get(key)).toBe(JSON.stringify(snapshot));
    const recheck = await getExchangeRate("SAR", "KWD");
    expect(recheck.rate).toBe(0.084);
    expect(recheck.source).toBe("bank");
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
    expect(await rateKeys()).toEqual([]);
    const { getExchangeRate } = await generic();
    const quote = () =>
      getExchangeRate(
        scenario.currencies.fromCurrency,
        scenario.currencies.toCurrency
      );
    expect(await quote()).toEqual(first.data);
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
    expect(await quote()).toEqual(first.data);
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
    expect(await quote()).toEqual(current.data);
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
    expect(await rateKeys()).toEqual([]);
    const { convertCurrency, getExchangeRate } = await generic();
    expect(await convertCurrency(1000, "USD", "AED")).toEqual(cold.data);
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
    const warm = await convertCurrency(1000, "USD", "AED");
    expect(warm).toEqual(cold.data);
    expect(warm.convertedAmount).toBe(3672.38);
    const quote = await getExchangeRate("USD", "AED");
    expect(quote.source).toBe("cross_rate");
    expect(quote.updatedAt).toEqual(from);
    // With both legs gone the routes answer from MySQL: no converted amount,
    // and the labelled estimate.
    const refused = await response("convertCurrency", input);
    expect(refused.status).toBe(412);
    expect(refused.body.error?.json?.data?.code).toBe("PRECONDITION_FAILED");
    const routeQuote = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", {
        fromCurrency: "USD",
        toCurrency: "AED",
      })
    );
    expect(routeQuote.data.source).toBe("cross_rate_fallback");
    expect(await rateKeys()).toEqual([crossKey]);
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
    // Asked of the route while the row exists: the route reads MySQL.
    const aboveHalf = responseContracts.convertCurrency.parse(
      await request("convertCurrency", {
        ...currencies,
        amount: 5.00000001e-12,
      })
    );
    expect(aboveHalf.data.convertedAmount).toBe(0.01);
    expect(await rateKeys()).toEqual([]);
    const { convertCurrency } = await generic();
    expect(await convertCurrency(5e-12, "USD", "AED")).toEqual(cold.data);
    expect(await reference!.get("exchange_rate:v3:USD_AED")).not.toBeNull();

    await connection!.query(`DELETE FROM \`${table}\``);
    const warm = await convertCurrency(5e-12, "USD", "AED");
    expect(warm).toEqual(cold.data);
    expect(
      (await convertCurrency(5.00000001e-12, "USD", "AED")).convertedAmount
    ).toBe(0.01);
    // With the row gone the route answers from MySQL: no converted amount.
    const refused = await response("convertCurrency", input);
    expect(refused.status).toBe(412);
    expect(refused.body.error?.json?.data?.code).toBe("PRECONDITION_FAILED");
  });

  it("fix: returns an explicitly labeled uncached fallback quote, and no converted amount, after a genuine query failure with a live database handle", async () => {
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
      // Wave 1 (#319): the fallback labels the quote above; it never
      // becomes a converted amount. Without a quote the display rule accepts
      // the route answers the price routes' precondition (fix round 2; it
      // was BAD_REQUEST before).
      const refused = await response("convertCurrency", { ...pair, amount: 1 });
      expect(refused.status).toBe(412);
      expect(refused.body.error?.json?.data?.code).toBe("PRECONDITION_FAILED");
      expect(refused.body.error?.json?.message).toMatch(
        /No current exchange rate observation/
      );
      expect(refused.body.result).toBeUndefined();
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
    expect(await rateKeys()).toEqual([]);
    const { getExchangeRate } = await generic();
    expect(await getExchangeRate("SAR", "KWD")).toEqual(recovered.data);
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

  // Fix round 2 (lab receipt for #378 at 6600395): the public conversion
  // and quote routes take the display rule (approved source, current, not
  // superseded, observed less than 24 hours ago), also over a warm Redis.
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it("fix: converts no amount from a quote observed 48 hours ago and quotes the labelled estimate instead", async () => {
    const time = Date.now();
    const gbp = { fromCurrency: "SAR", toCurrency: "GBP" };
    await seed(
      1,
      "0.30",
      new Date(time - 48 * HOUR),
      new Date(time + 20 * DAY),
      gbp
    );
    const refused = await response("convertCurrency", { ...gbp, amount: 100 });
    expect(refused.status).toBe(412);
    expect(refused.body.error?.json?.data?.code).toBe("PRECONDITION_FAILED");
    expect(refused.body.error?.json?.message).toBe(
      "No current exchange rate observation: SAR to GBP. Request the price in SAR."
    );
    expect(refused.body.result).toBeUndefined();
    const quote = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", gbp)
    );
    // SAR_GBP 0.21 is the label-only constant, not the stored 0.30.
    expect(quote.data).toMatchObject({
      ...gbp,
      rate: 0.21,
      source: "fallback",
    });
    expect(await reference!.keys("exchange_rate:*")).toEqual([]);
  });

  it.each(["the conversion route", "a conversion without the display rule"])(
    "fix: refuses a quote converted by %s once it is 24 hours old, whatever Redis holds",
    async warmedBy => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = new Date("2030-06-10T12:00:00Z");
      vi.setSystemTime(now);
      await seed(
        1,
        "0.081",
        new Date(+now - DAY + 60_000),
        new Date(+now + 20 * DAY)
      );
      const input = { ...pair, amount: 1 };
      if (warmedBy === "the conversion route") {
        const warm = responseContracts.convertCurrency.parse(
          await request("convertCurrency", input)
        );
        expect(warm.data.convertedAmount).toBe(0.081);
        // Round 3: the route caches nothing, not even for its 60 s left.
        expect(await rateKeys()).toEqual([]);
      } else {
        const { convertCurrency } = await generic();
        expect((await convertCurrency(1, "SAR", "KWD")).convertedAmount).toBe(
          0.081
        );
        expect(await reference!.get(key)).not.toBeNull();
      }

      vi.setSystemTime(new Date(+now + 120_000));
      // Redis keeps its own clock: bytes the generic path warmed are still
      // there, and the route does not read them.
      if (warmedBy !== "the conversion route")
        expect(await reference!.get(key)).not.toBeNull();
      const refused = await response("convertCurrency", input);
      expect(refused.status).toBe(412);
      expect(refused.body.error?.json?.data?.code).toBe("PRECONDITION_FAILED");
      const quote = responseContracts.getExchangeRate.parse(
        await request("getExchangeRate", pair)
      );
      // SAR_KWD 0.082 is the label-only constant, not the stored 0.081.
      expect(quote.data).toMatchObject({
        ...pair,
        rate: 0.082,
        source: "fallback",
      });
    }
  );

  // Fix round 3 (lab receipt for #378 at 1cec4e6): a Redis snapshot is never
  // re-checked for supersession, so under the display rule the two routes
  // read MySQL on every call and neither read nor write a snapshot. The
  // generic functions share the key and still cache it.
  const gbp = { fromCurrency: "SAR", toCurrency: "GBP" };
  const gbpKey = "exchange_rate:v3:SAR_GBP";
  const wholeSecond = () => Math.floor(Date.now() / 1000) * 1000;

  /** A correction written in SQL, outside exchangeRates.record: nothing
   * clears the cache for it. */
  async function correct(
    id: number,
    supersedesId: number,
    rate: string,
    observed: Date,
    currencies = gbp,
    source = "bank"
  ) {
    await connection!.execute(
      `INSERT INTO \`${table}\` (id,fromCurrency,toCurrency,rate,source,validFrom,validTo,updatedAt,supersedesId,version) VALUES (?,?,?,?,?,?,?,?,?,2)`,
      [
        id,
        currencies.fromCurrency,
        currencies.toCurrency,
        rate,
        source,
        observed,
        new Date(wholeSecond() + 20 * HOUR),
        observed,
        supersedesId,
      ]
    );
  }

  async function convertGbp(amount: number) {
    const reply = await response("convertCurrency", { ...gbp, amount });
    if (reply.status !== 200)
      return { status: reply.status, code: reply.body.error?.json?.data?.code };
    return responseContracts.convertCurrency.parse(
      superjson.deserialize(reply.body.result.data)
    ).data;
  }

  it.each([
    {
      name: "a display-eligible correction",
      observedAgo: 1000,
      converted: { convertedAmount: 31, exchangeRate: 0.31 },
      quote: { rate: 0.31, source: "bank" },
    },
    {
      name: "a correction observed 48 hours ago",
      observedAgo: 48 * HOUR,
      converted: { status: 412, code: "PRECONDITION_FAILED" },
      // SAR_GBP 0.21 is the label-only constant.
      quote: { rate: 0.21, source: "fallback" },
    },
  ])(
    "fix: pricing.convertCurrency and pricing.getExchangeRate ignore the Redis snapshot of a quote superseded by $name",
    async scenario => {
      const time = wholeSecond();
      await seed(
        1,
        "0.30",
        new Date(time - HOUR),
        new Date(time + 20 * HOUR),
        gbp
      );
      // Quote A, cached under the routes' key by the generic quote.
      const { getExchangeRate } = await generic();
      expect(await getExchangeRate("SAR", "GBP")).toMatchObject({
        rate: 0.3,
        source: "bank",
      });
      const planted = await reference!.get(gbpKey);
      expect(JSON.parse(planted!).quote.rate).toBe(0.3);
      await correct(2, 1, "0.31", new Date(time - scenario.observedAgo));
      expect(await convertGbp(100)).toMatchObject(scenario.converted);
      const quote = responseContracts.getExchangeRate.parse(
        await request("getExchangeRate", gbp)
      );
      expect(quote.data).toMatchObject({ ...gbp, ...scenario.quote });
      // The superseded snapshot is still there; the routes did not read it.
      expect(await reference!.get(gbpKey)).toBe(planted);
    }
  );

  it("fix: pricing.convertCurrency and pricing.getExchangeRate ignore the Redis snapshot of a superseded cross-rate leg", async () => {
    const time = wholeSecond();
    const usdToAed = { fromCurrency: "USD", toCurrency: "AED" };
    const sarToAed = { fromCurrency: "SAR", toCurrency: "AED" };
    const window = [new Date(time - HOUR), new Date(time + 20 * HOUR)] as const;
    await seed(1, "3.75", ...window, {
      fromCurrency: "USD",
      toCurrency: "SAR",
    });
    await seed(2, "0.95", ...window, sarToAed);
    const { convertCurrency } = await generic();
    expect((await convertCurrency(1000, "USD", "AED")).convertedAmount).toBe(
      3562.5
    );
    expect(await rateKeys()).toEqual([
      "exchange_rate:v3:SAR_AED",
      "exchange_rate:v3:USD_AED",
      "exchange_rate:v3:USD_SAR",
    ]);
    await correct(3, 2, "1.00", new Date(time - 1000), sarToAed);
    const converted = responseContracts.convertCurrency.parse(
      await request("convertCurrency", { ...usdToAed, amount: 1000 })
    );
    expect(converted.data).toMatchObject({
      convertedAmount: 3750,
      exchangeRate: 3.75,
    });
    const quote = responseContracts.getExchangeRate.parse(
      await request("getExchangeRate", usdToAed)
    );
    expect(quote.data).toMatchObject({ rate: 3.75, source: "cross_rate" });
  });

  it("fix: pricing.convertCurrency and pricing.getExchangeRate write no exchange-rate key and change no TTL", async () => {
    const time = wholeSecond();
    const window = [new Date(time - HOUR), new Date(time + 20 * HOUR)] as const;
    await seed(1, "0.30", ...window, gbp);
    await seed(2, "3.75", ...window, {
      fromCurrency: "USD",
      toCurrency: "SAR",
    });
    const usdToGbp = { fromCurrency: "USD", toCurrency: "GBP" };
    const sarToEur = { fromCurrency: "SAR", toCurrency: "EUR" };
    const routes = async () => {
      expect(await convertGbp(100)).toMatchObject({ convertedAmount: 30 });
      expect(
        responseContracts.getExchangeRate.parse(
          await request("getExchangeRate", gbp)
        ).data
      ).toMatchObject({ rate: 0.3, source: "bank" });
      expect(
        responseContracts.convertCurrency.parse(
          await request("convertCurrency", { ...usdToGbp, amount: 100 })
        ).data
      ).toMatchObject({ convertedAmount: 112.5, exchangeRate: 1.125 });
      expect(
        responseContracts.getExchangeRate.parse(
          await request("getExchangeRate", usdToGbp)
        ).data
      ).toMatchObject({ rate: 1.125, source: "cross_rate" });
      expect(
        responseContracts.getExchangeRate.parse(
          await request("getExchangeRate", sarToEur)
        ).data
      ).toMatchObject({ source: "fallback" });
      expect(
        (await response("convertCurrency", { ...sarToEur, amount: 100 })).status
      ).toBe(412);
    };
    // Cold: no new key.
    await routes();
    expect(await rateKeys()).toEqual([]);
    // Warm through the generic conversion, then pin each key's TTL: a route
    // that rewrote a key would reset it to the snapshot's own TTL.
    const { convertCurrency } = await generic();
    await convertCurrency(100, "USD", "GBP");
    const keys = await rateKeys();
    expect(keys).toEqual([
      gbpKey,
      "exchange_rate:v3:USD_GBP",
      "exchange_rate:v3:USD_SAR",
    ]);
    const bytes = new Map<string, string | null>();
    for (const name of keys) {
      expect(await reference!.expire(name, 1234)).toBe(1);
      bytes.set(name, await reference!.get(name));
    }
    await routes();
    expect(await rateKeys()).toEqual(keys);
    for (const name of keys) {
      expect(await reference!.get(name)).toBe(bytes.get(name));
      expect(await reference!.ttl(name)).toBeLessThanOrEqual(1234);
      expect(await reference!.ttl(name)).toBeGreaterThan(1200);
    }
  });

  it.each(["convertCurrency", "getExchangeRate"] as const)(
    "fix: a pricing.%s call in flight while a correction commits leaves nothing that outlives the correction",
    async procedure => {
      const time = wholeSecond();
      await seed(
        1,
        "0.30",
        new Date(time - HOUR),
        new Date(time + 20 * HOUR),
        gbp
      );
      const { invalidateExchangeRateSnapshots } = await generic();
      // The lab's B6 interleaving, deterministic: a hook around the read
      // holds the in-flight call once its second exchange_rates select has
      // returned, until a correction has committed and its cache delete has
      // run. No sleep.
      const query = connection!.query.bind(connection!);
      let selects = 0;
      let entered!: () => void;
      const reachedRead = new Promise<void>(resolve => (entered = resolve));
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      const hook = vi.spyOn(connection!, "query").mockImplementation((async (
        ...args: Parameters<typeof query>
      ) => {
        const result = await query(...args);
        const sql =
          typeof args[0] === "string"
            ? args[0]
            : ((args[0] as { sql?: string }).sql ?? "");
        if (sql.includes(`from \`${table}\``) && ++selects === 2) {
          entered();
          await released;
        }
        return result;
      }) as never);
      const input =
        procedure === "convertCurrency" ? { ...gbp, amount: 100 } : gbp;
      try {
        const inFlight = request(procedure, input);
        await Promise.race([reachedRead, inFlight]);
        expect(selects).toBe(2);
        await correct(2, 1, "0.31", new Date(time - 1000));
        await invalidateExchangeRateSnapshots("SAR", "GBP");
        release();
        // It read quote A before the correction committed.
        expect(await inFlight).toMatchObject({
          data:
            procedure === "convertCurrency"
              ? { convertedAmount: 30 }
              : { rate: 0.3 },
        });
      } finally {
        release();
        hook.mockRestore();
      }
      // The next calls show the correction, and no snapshot of quote A was
      // written after the correction's delete.
      expect(await convertGbp(100)).toMatchObject({
        convertedAmount: 31,
        exchangeRate: 0.31,
      });
      expect(
        responseContracts.getExchangeRate.parse(
          await request("getExchangeRate", gbp)
        ).data
      ).toMatchObject({ rate: 0.31, source: "bank" });
      expect(await rateKeys()).toEqual([]);
    }
  );

  it("control: the generic quote and conversion cache in Redis as before", async () => {
    const time = wholeSecond();
    await seed(
      1,
      "0.30",
      new Date(time - HOUR),
      new Date(time + 20 * HOUR),
      gbp
    );
    const { getExchangeRate, convertCurrency } = await generic();
    const first = await getExchangeRate("SAR", "GBP");
    expect(first).toMatchObject({ rate: 0.3, source: "bank" });
    expect(await reference!.ttl(gbpKey)).toBeGreaterThan(3500);
    expect(await reference!.ttl(gbpKey)).toBeLessThanOrEqual(3600);
    await connection!.query(`DELETE FROM \`${table}\``);
    expect(await getExchangeRate("SAR", "GBP")).toEqual(first);
    expect((await convertCurrency(100, "SAR", "GBP")).convertedAmount).toBe(30);
  });

  it("control: SAR responses are byte-identical over HTTP", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    // Whatever is stored, SAR never reads it.
    await seed(
      1,
      "0.30",
      new Date("2029-12-31T23:00:00Z"),
      new Date("2030-01-01T20:00:00Z"),
      gbp
    );
    const raw = async (procedure: string, input: Record<string, unknown>) => {
      const serialized = encodeURIComponent(
        JSON.stringify(superjson.serialize(input))
      );
      const reply = await fetch(`${url}/${procedure}?input=${serialized}`);
      expect(reply.status).toBe(200);
      return reply.text();
    };
    const sar = { fromCurrency: "SAR", toCurrency: "SAR" };
    expect(await raw("convertCurrency", { ...sar, amount: 1.234 })).toBe(
      JSON.stringify({
        result: {
          data: {
            json: {
              success: true,
              data: {
                originalAmount: 1.234,
                originalCurrency: "SAR",
                convertedAmount: 1.23,
                targetCurrency: "SAR",
                exchangeRate: 1,
                formattedOriginal: "1.23",
                formattedConverted: "1.23",
                rateTimestamp: "2030-01-01T00:00:00.000Z",
              },
            },
            meta: { values: { "data.rateTimestamp": ["Date"] } },
          },
        },
      })
    );
    expect(await raw("getExchangeRate", sar)).toBe(
      JSON.stringify({
        result: {
          data: {
            json: {
              success: true,
              data: {
                fromCurrency: "SAR",
                toCurrency: "SAR",
                rate: 1,
                inverseRate: 1,
                source: "identity",
                updatedAt: "2030-01-01T00:00:00.000Z",
              },
            },
            meta: { values: { "data.updatedAt": ["Date"] } },
          },
        },
      })
    );
    expect(await rateKeys()).toEqual([]);
  });
});

/**
 * #319 Wave 1 on native MySQL: operator-entered quotes, their provenance and
 * audit, append-only corrections, the permission boundary, the YER display
 * estimate and the staleness alarm. The tables are cloned from the migrated
 * DATABASE_URL schema (CREATE TABLE LIKE keeps the unique indexes), into a
 * child database that this suite creates and drops.
 */
const operatorDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL)
    ? describe
    : describe.skip;

operatorDescribe.sequential("operator exchange rates over native MySQL", () => {
  type Row = mysql.RowDataPacket & Record<string, unknown>;
  type Actor = { id: number; role: string; tenantId: number | null };
  type OperatorApp = Awaited<ReturnType<typeof buildApp>>;
  let admin: mysql.Connection | undefined;
  let pool: mysql.Pool | undefined;
  let databaseName = "";
  let created = false;
  let app: OperatorApp | undefined;
  const cloned = [
    schema.exchangeRates,
    schema.auditLogs,
    schema.users,
    schema.tenants,
    schema.operationsAlerts,
    schema.alertDispatches,
  ].map(table => getTableName(table));
  const platformAdmin: Actor = { id: 20, role: "admin", tenantId: null };
  const customer: Actor = { id: 9, role: "user", tenantId: 3 };
  const tenantFinance: Actor = { id: 31, role: "finance", tenantId: 3 };
  const otherTenantAdmin: Actor = {
    id: 41,
    role: "airline_admin",
    tenantId: 4,
  };
  const hour = 3_600_000;

  async function buildApp() {
    const [{ router }, { exchangeRatesRouter }, { ibePublicRouter }] =
      await Promise.all([
        import("../_core/trpc"),
        import("../routers/exchange-rates"),
        import("../routers/ibe-public"),
      ]);
    return router({
      exchangeRates: exchangeRatesRouter,
      ibePublic: ibePublicRouter,
    });
  }

  function caller(actor: Actor | null, tenantId = actor?.tenantId ?? null) {
    return app!.createCaller({
      user: actor,
      tenantId,
      authMethod: actor ? "cookie" : null,
      req: {
        ip: "198.51.100.9",
        id: "req-fx-operator",
        headers: { "user-agent": "vitest-native" },
      },
      res: { setHeader: () => undefined },
    } as unknown as TrpcContext);
  }

  function wholeSecond(value: number) {
    return new Date(Math.floor(value / 1000) * 1000);
  }

  function yerQuote(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    return {
      baseCurrency: "SAR" as const,
      quoteCurrency: "YER" as const,
      rate: "140.50000000",
      source: "cby_sanaa" as const,
      sourceReference: "CBY Sanaa daily bulletin 318 of 2026-11-16",
      validFrom: wholeSecond(now - hour),
      validTo: wholeSecond(now + 20 * hour),
      ...overrides,
    };
  }

  async function rows(sql: string, values: unknown[] = []) {
    const [result] = await pool!.query<Row[]>(sql, values);
    return result;
  }

  const quoteRows = () => rows("SELECT * FROM `exchange_rates` ORDER BY id");
  const rateAudit = () =>
    rows(
      "SELECT * FROM `audit_logs` WHERE eventType LIKE 'EXCHANGE_RATE_%' ORDER BY id"
    );
  const accessAudit = () =>
    rows(
      "SELECT * FROM `audit_logs` WHERE eventType='PRIVILEGED_MUTATION' ORDER BY id"
    );
  const alarms = () =>
    rows(
      "SELECT `key`, status, message FROM `operations_alerts` WHERE `key` LIKE 'fx-display-rate:%' ORDER BY `key`"
    );

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL!);
    const sourceDatabase = source.pathname.slice(1);
    if (
      source.protocol !== "mysql:" ||
      !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
    )
      throw new Error(
        "Operator rate acceptance requires a loopback disposable database"
      );
    const options = {
      host: source.hostname.replace(/^\[|\]$/g, ""),
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
      timezone: "Z",
    };
    databaseName = `${sourceDatabase.slice(0, 40)}_fx_${randomBytes(6).toString("hex")}`;
    if (!/^[A-Za-z0-9_]+_fx_[0-9a-f]{12}$/.test(databaseName))
      throw new Error("Invalid disposable database identity");
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    for (const name of cloned)
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
      );
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 5,
    });
    // As server/db.ts does: TIMESTAMP values convert in UTC.
    pool.pool.on("connection", connection => {
      connection.query("SET SESSION time_zone = '+00:00'", () => undefined);
    });
    boundary.db = drizzle(pool, { schema, mode: "default" });
  }, 60000);

  beforeEach(async () => {
    boundary.db = drizzle(pool!, { schema, mode: "default" });
    for (const name of cloned) await pool!.query(`TRUNCATE TABLE \`${name}\``);
    await pool!.query(
      "INSERT INTO `tenants` (id, slug, name, status) VALUES (3, 'fx-tenant-three', 'Tenant three', 'active'), (4, 'fx-tenant-four', 'Tenant four', 'active')"
    );
    for (const actor of [
      platformAdmin,
      customer,
      tenantFinance,
      otherTenantAdmin,
    ])
      await pool!.query(
        "INSERT INTO `users` (id, openId, tenantId, role, name, email) VALUES (?, ?, ?, ?, ?, ?)",
        [
          actor.id,
          `fx-native-${actor.id}`,
          actor.tenantId,
          actor.role,
          `Synthetic ${actor.role}`,
          `fx-${actor.id}@example.test`,
        ]
      );
    // Loaded per test so that, without the procedure, each case fails.
    app ??= await buildApp();
  });

  afterAll(async () => {
    boundary.db = null;
    try {
      await pool?.end();
    } finally {
      try {
        if (created) await admin?.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin?.end();
      }
    }
  });

  it("fix: records a Sanaa YER quote and a USD quote, each with provenance and an audit record", async () => {
    const before = Date.now();
    const yer = await caller(platformAdmin).exchangeRates.record(yerQuote());
    const usd = await caller(platformAdmin).exchangeRates.record({
      baseCurrency: "SAR",
      quoteCurrency: "USD",
      rate: "0.26660000",
      source: "bank",
      sourceReference: "Bank reference rate sheet 2026-11-16",
      validFrom: wholeSecond(before - 30 * 60_000),
      validTo: wholeSecond(before + 12 * hour),
    });
    expect(yer).toMatchObject({
      quoteCurrency: "YER",
      rate: "140.50000000",
      source: "cby_sanaa",
      version: 1,
      supersedesId: null,
      recordedBy: platformAdmin.id,
    });
    expect(usd).toMatchObject({ quoteCurrency: "USD", version: 1 });

    const stored = await quoteRows();
    expect(stored).toHaveLength(2);
    const expected = { YER: yer, USD: usd };
    for (const row of stored) {
      const result = expected[row.toCurrency as keyof typeof expected];
      expect(row).toMatchObject({
        id: result.id,
        fromCurrency: "SAR",
        rate: result.rate,
        source: result.source,
        sourceReference: result.sourceReference,
        recordedBy: platformAdmin.id,
        version: 1,
        supersedesId: null,
      });
      expect(row.validFrom).toEqual(result.validFrom);
      expect(row.validTo).toEqual(result.validTo);
      expect(row.createdAt).toEqual(result.recordedAt);
      expect((row.createdAt as Date).getTime()).toBeGreaterThanOrEqual(
        wholeSecond(before).getTime()
      );
    }
    expect(stored.find(row => row.toCurrency === "YER")).toMatchObject({
      sourceReference: "CBY Sanaa daily bulletin 318 of 2026-11-16",
    });

    const audit = await rateAudit();
    expect(audit).toHaveLength(2);
    for (const [entry, result] of [
      [audit[0], yer],
      [audit[1], usd],
    ] as const) {
      expect(entry).toMatchObject({
        eventId: result.auditEventId,
        eventType: "EXCHANGE_RATE_RECORDED",
        eventCategory: "system",
        outcome: "success",
        userId: platformAdmin.id,
        userRole: "admin",
        actorType: "admin",
        requestId: "req-fx-operator",
        resourceType: "exchange_rate",
        resourceId: String(result.id),
        previousValue: null,
      });
      expect(JSON.parse(String(entry.newValue))).toEqual({
        exchangeRateId: result.id,
        baseCurrency: "SAR",
        quoteCurrency: result.quoteCurrency,
        rate: result.rate,
        source: result.source,
        sourceReference: result.sourceReference,
        validFrom: result.validFrom.toISOString(),
        validTo: result.validTo!.toISOString(),
        version: 1,
        supersedesId: null,
        recordedBy: platformAdmin.id,
        recordedAt: result.recordedAt.toISOString(),
      });
      expect(entry.timestamp).toEqual(result.recordedAt);
    }
    // The privileged builder also records each completed call.
    expect(
      (await accessAudit()).map(entry => [entry.outcome, entry.userId])
    ).toEqual([
      ["success", platformAdmin.id],
      ["success", platformAdmin.id],
    ]);
  });

  it("fix: a correction is a new version that supersedes the old row, which stays unchanged", async () => {
    const original = await caller(platformAdmin).exchangeRates.record(
      yerQuote({ rate: "1405.00000000" })
    );
    const [before] = await rows("SELECT * FROM `exchange_rates` WHERE id=?", [
      original.id,
    ]);
    expect(
      (await caller(null).ibePublic.displayRate({ currency: "YER" }))?.rate
    ).toBe(1405);

    const correction = await caller(platformAdmin).exchangeRates.record(
      yerQuote({
        sourceReference: "CBY Sanaa daily bulletin 318, corrected entry",
        supersedesId: original.id,
      })
    );
    expect(correction).toMatchObject({
      version: 2,
      supersedesId: original.id,
      rate: "140.50000000",
    });
    const [after] = await rows("SELECT * FROM `exchange_rates` WHERE id=?", [
      original.id,
    ]);
    expect(after).toEqual(before);
    expect(await quoteRows()).toHaveLength(2);

    const audit = await rateAudit();
    expect(audit.map(entry => entry.eventType)).toEqual([
      "EXCHANGE_RATE_RECORDED",
      "EXCHANGE_RATE_CORRECTED",
    ]);
    expect(JSON.parse(String(audit[1].previousValue))).toMatchObject({
      exchangeRateId: original.id,
      rate: "1405.00000000",
      version: 1,
    });
    expect(JSON.parse(String(audit[1].newValue))).toMatchObject({
      exchangeRateId: correction.id,
      rate: "140.50000000",
      version: 2,
      supersedesId: original.id,
    });

    // The display reads the correction; history keeps both versions.
    expect(
      await caller(null).ibePublic.displayRate({ currency: "YER" })
    ).toMatchObject({ rate: 140.5, source: "cby_sanaa" });
    const history = await caller(platformAdmin).exchangeRates.history({
      quoteCurrency: "YER",
    });
    expect(
      history.map(row => [row.id, row.version, row.supersededById])
    ).toEqual([
      [correction.id, 2, null],
      [original.id, 1, correction.id],
    ]);

    // A corrected row cannot be corrected twice, nor across pairs.
    await expect(
      caller(platformAdmin).exchangeRates.record(
        yerQuote({ supersedesId: original.id })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller(platformAdmin).exchangeRates.record({
        ...yerQuote(),
        quoteCurrency: "USD",
        source: "bank",
        rate: "0.26660000",
        supersedesId: correction.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await quoteRows()).toHaveLength(2);
    expect(await rateAudit()).toHaveLength(2);
  });

  it("fix: simultaneous entries for one pair never share a version", async () => {
    for (const seeded of [false, true]) {
      if (seeded)
        await caller(platformAdmin).exchangeRates.record(
          yerQuote({ rate: "140.00000000" })
        );
      const outcomes = await Promise.allSettled(
        ["140.10000000", "140.20000000", "140.30000000"].map(rate =>
          caller(platformAdmin).exchangeRates.record(yerQuote({ rate }))
        )
      );
      for (const outcome of outcomes)
        if (outcome.status === "rejected")
          expect(outcome.reason).toMatchObject({ code: "CONFLICT" });
      expect(outcomes.some(outcome => outcome.status === "fulfilled")).toBe(
        true
      );
      const versions = (await quoteRows()).map(row => row.version);
      expect(new Set(versions).size).toBe(versions.length);
      expect(versions.length).toBe(
        (await rateAudit()).filter(
          entry => entry.eventType === "EXCHANGE_RATE_RECORDED"
        ).length
      );
    }
  });

  it("fix: refuses an unauthorised user and tenant staff, including another tenant's administrator", async () => {
    await expect(
      caller(null).exchangeRates.record(yerQuote())
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const [actor, tenantId] of [
      [customer, customer.tenantId],
      [tenantFinance, tenantFinance.tenantId],
      [otherTenantAdmin, otherTenantAdmin.tenantId],
      [otherTenantAdmin, 3],
    ] as const)
      await expect(
        caller(actor, tenantId).exchangeRates.record(yerQuote())
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(tenantFinance).exchangeRates.history({ quoteCurrency: "YER" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await quoteRows()).toEqual([]);
    expect(await rateAudit()).toEqual([]);
    expect(
      (await accessAudit()).map(entry => [
        entry.outcome,
        entry.userId,
        JSON.parse(String(entry.metadata)).errorCode,
      ])
    ).toEqual([
      ["failure", customer.id, "FORBIDDEN"],
      ["failure", tenantFinance.id, "FORBIDDEN"],
      ["failure", otherTenantAdmin.id, "FORBIDDEN"],
      ["failure", otherTenantAdmin.id, "FORBIDDEN"],
    ]);
  });

  it("fix: refuses a YER quote from any source but the Central Bank of Yemen (Sanaa), and that source for other pairs", async () => {
    await expect(
      caller(platformAdmin).exchangeRates.record(yerQuote({ source: "bank" }))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(platformAdmin).exchangeRates.record({
        ...yerQuote(),
        quoteCurrency: "USD",
        rate: "0.26660000",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const start = wholeSecond(Date.now());
    await expect(
      caller(platformAdmin).exchangeRates.record(
        yerQuote({ validFrom: start, validTo: start })
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await quoteRows()).toEqual([]);
  });

  it("fix: the display estimate shows the operator YER quote, and nothing for YER without one", async () => {
    const display = () =>
      caller(null).ibePublic.displayRate({ currency: "YER" });
    expect(await display()).toBeNull();
    const quote = await caller(platformAdmin).exchangeRates.record(yerQuote());
    expect(await display()).toEqual({
      fromCurrency: "SAR",
      toCurrency: "YER",
      rate: 140.5,
      source: "cby_sanaa",
      updatedAt: quote.validFrom,
      // The earlier of the publication's validity and the 24-hour expiry.
      expiresAt: quote.validTo,
    });
    // YER stays outside every conversion that prices an amount.
    const { convertCurrency } =
      await import("../services/currency/currency.service");
    await expect(convertCurrency(100, "SAR", "YER")).rejects.toThrow(
      "Unsupported currency: YER"
    );
  });

  it("fix: the staleness alarm raises for a stale quote of an entered pair and clears on a fresh quote", async () => {
    const status = await caller(platformAdmin).exchangeRates.refreshAlarms();
    expect(status.pairs.map(pair => pair.quoteCurrency)).toEqual([
      "USD",
      "EUR",
      "AED",
      "GBP",
      "KWD",
      "BHD",
      "QAR",
      "OMR",
      "EGP",
      "YER",
    ]);
    // A pair nobody has entered is not maintained and raises nothing.
    expect(status.pairs.every(pair => !pair.maintained && !pair.alarm)).toBe(
      true
    );
    expect(await alarms()).toEqual([]);
    const yerAlarm = async () =>
      (await alarms()).find(alarm => alarm.key === "fx-display-rate:SAR_YER");

    // A quote observed 25 hours ago is recorded but too old to display.
    const now = Date.now();
    const stale = await caller(platformAdmin).exchangeRates.record(
      yerQuote({
        validFrom: wholeSecond(now - 25 * hour),
        validTo: wholeSecond(now + hour),
      })
    );
    expect(await yerAlarm()).toMatchObject({
      status: "active",
      message: expect.stringContaining("no current operator quote"),
    });

    // A fresh quote clears the alarm for its pair only.
    const fresh = await caller(platformAdmin).exchangeRates.record(
      yerQuote({
        validFrom: wholeSecond(now - 60_000),
        validTo: wholeSecond(now + 30 * hour),
      })
    );
    expect(fresh.version).toBe(stale.version! + 1);
    expect(await yerAlarm()).toMatchObject({ status: "resolved" });
    expect(await alarms()).toHaveLength(1);

    // Once the fresh quote reaches the 24-hour display expiry, it alarms again.
    const { refreshDisplayRateAlarms } =
      await import("../services/currency/operator-rates.service");
    const current = await refreshDisplayRateAlarms(
      new Date(fresh.validFrom.getTime() + 24 * hour - 1000)
    );
    expect(
      current.pairs.find(pair => pair.quoteCurrency === "YER")
    ).toMatchObject({ alarm: false, quoteId: fresh.id });
    expect(await yerAlarm()).toMatchObject({ status: "resolved" });
    const later = await refreshDisplayRateAlarms(
      new Date(fresh.validFrom.getTime() + 24 * hour)
    );
    expect(
      later.pairs.find(pair => pair.quoteCurrency === "YER")
    ).toMatchObject({ alarm: true, quoteId: null });
    expect(await yerAlarm()).toMatchObject({ status: "active" });
  });

  // Fix round 1 (#319 Wave 1 slice A hardening).
  const record = (input: Record<string, unknown>) =>
    caller(platformAdmin).exchangeRates.record(
      input as Parameters<
        ReturnType<typeof caller>["exchangeRates"]["record"]
      >[0]
    );
  function usdQuote(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    return {
      baseCurrency: "SAR" as const,
      quoteCurrency: "USD" as const,
      rate: "0.26660000",
      source: "bank" as const,
      sourceReference: "Bank reference rate sheet 2026-11-16",
      validFrom: wholeSecond(now - hour),
      validTo: wholeSecond(now + 20 * hour),
      ...overrides,
    };
  }

  it("fix: refuses validity outside the MySQL TIMESTAMP range with BAD_REQUEST, never a server error", async () => {
    for (const [validFrom, validTo] of [
      ["1960-01-01T00:00:00Z", "1960-01-02T00:00:00Z"],
      ["1970-01-01T00:00:00Z", "1970-01-02T00:00:00Z"],
      ["2039-12-31T00:00:00Z", "2040-01-01T00:00:00Z"],
      ["2038-01-18T03:14:08Z", "2038-01-19T03:14:08Z"],
    ])
      await expect(
        record(
          yerQuote({
            validFrom: new Date(validFrom),
            validTo: new Date(validTo),
          })
        ),
        `${validFrom} to ${validTo}`
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("(the MySQL TIMESTAMP range)"),
      });
    expect(await quoteRows()).toEqual([]);
    // Both ends of the range are accepted.
    for (const [validFrom, validTo] of [
      ["1970-01-01T00:00:01Z", "1970-01-02T00:00:01Z"],
      ["2038-01-18T03:14:07Z", "2038-01-19T03:14:07Z"],
    ])
      await record(
        yerQuote({ validFrom: new Date(validFrom), validTo: new Date(validTo) })
      );
    expect((await quoteRows()).map(row => row.validTo)).toEqual([
      new Date("1970-01-02T00:00:01Z"),
      new Date("2038-01-19T03:14:07Z"),
    ]);
  });

  it("fix: refuses a validity window longer than 31 days with BAD_REQUEST", async () => {
    const start = wholeSecond(Date.now() - hour);
    const month = 31 * 24 * hour;
    await expect(
      record(
        yerQuote({
          validFrom: start,
          validTo: new Date(start.getTime() + month + 1000),
        })
      )
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(
        "A quote is valid for at most 31 days; record the reference rate again at least monthly"
      ),
    });
    expect(await quoteRows()).toEqual([]);
    const longest = await record(
      yerQuote({ validFrom: start, validTo: new Date(start.getTime() + month) })
    );
    expect(longest.validTo!.getTime() - longest.validFrom.getTime()).toBe(
      month
    );
  });

  it("fix: refuses a rate that is not a positive decimal fitting DECIMAL(18,8), with a clear message", async () => {
    const format =
      "Rate must be a plain decimal number with at most 10 digits before the point and 8 after it (DECIMAL(18,8))";
    for (const [rate, message] of [
      ["0", "Rate must be positive"],
      ["0.00000000", "Rate must be positive"],
      ["-1", format],
      ["1e3", format],
      ["NaN", format],
      ["Infinity", format],
      ["", format],
      ["12345678901", format],
      ["1.123456789", format],
      ["\u0661\u0664\u0660", format],
    ])
      await expect(record(yerQuote({ rate })), rate).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining(message),
      });
    expect(await quoteRows()).toEqual([]);
    // The largest and smallest rates the column holds are stored exactly.
    for (const rate of ["9999999999.99999999", "0.00000001"])
      await record(yerQuote({ rate }));
    expect((await quoteRows()).map(row => row.rate)).toEqual([
      "9999999999.99999999",
      "0.00000001",
    ]);
  });

  it("fix: a pair never entered raises nothing; an entered pair raises once it has no current quote and clears on a fresh one", async () => {
    const now = Date.now();
    // Rows without provenance (written in SQL, or before migration 0079) do
    // not make a pair maintained, whether current (EUR) or stale (GBP).
    await pool!.query(
      "INSERT INTO `exchange_rates` (fromCurrency, toCurrency, rate, source, validFrom, validTo) VALUES ('SAR', 'EUR', '0.24500000', 'bank', ?, ?), ('SAR', 'GBP', '0.21000000', 'bank', ?, ?)",
      [
        wholeSecond(now - hour),
        wholeSecond(now + hour),
        wholeSecond(now - 30 * hour),
        wholeSecond(now + hour),
      ]
    );
    // An alert left active for a pair nobody maintains is resolved.
    await pool!.query(
      "INSERT INTO `operations_alerts` (`key`, status, message) VALUES ('fx-display-rate:SAR_KWD', 'active', 'Raised before the maintained-pair rule')"
    );
    const before = await caller(platformAdmin).exchangeRates.refreshAlarms();
    expect(before.pairs.filter(pair => pair.maintained || pair.alarm)).toEqual(
      []
    );
    // The legacy EUR row still displays (slice B will require provenance).
    expect(
      before.pairs.find(pair => pair.quoteCurrency === "EUR")?.quoteId
    ).toEqual(expect.any(Number));
    expect(await alarms()).toEqual([
      {
        key: "fx-display-rate:SAR_KWD",
        status: "resolved",
        message: expect.stringContaining("not maintained"),
      },
    ]);

    // Entered once, with a quote that has already expired: the pair alarms.
    await record(
      usdQuote({
        validFrom: wholeSecond(now - 3 * hour),
        validTo: wholeSecond(now - 2 * hour),
      })
    );
    expect(await alarms()).toEqual([
      expect.objectContaining({ key: "fx-display-rate:SAR_KWD" }),
      {
        key: "fx-display-rate:SAR_USD",
        status: "active",
        message: expect.stringContaining("no current operator quote"),
      },
    ]);
    const entered = await caller(platformAdmin).exchangeRates.refreshAlarms();
    expect(
      entered.pairs
        .filter(pair => pair.maintained)
        .map(pair => [pair.quoteCurrency, pair.alarm])
    ).toEqual([["USD", true]]);

    // A fresh quote clears it; nothing else is active.
    await record(usdQuote());
    expect((await alarms()).map(alarm => [alarm.key, alarm.status])).toEqual([
      ["fx-display-rate:SAR_KWD", "resolved"],
      ["fx-display-rate:SAR_USD", "resolved"],
    ]);
  });

  it("control: a quote and its audit record commit together", async () => {
    const counts = async () => {
      const [quotes] = await rows("SELECT COUNT(*) AS c FROM `exchange_rates`");
      const [audits] = await rows(
        "SELECT COUNT(*) AS c FROM `audit_logs` WHERE eventType LIKE 'EXCHANGE_RATE_%'"
      );
      return { quotes: Number(quotes.c), audits: Number(audits.c) };
    };
    // A forced audit failure leaves no quote row...
    await pool!.query(
      "ALTER TABLE `audit_logs` ADD CONSTRAINT `fx_audit_refused` CHECK (eventType NOT IN ('EXCHANGE_RATE_RECORDED', 'EXCHANGE_RATE_CORRECTED'))"
    );
    try {
      await expect(record(yerQuote())).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      expect(await counts()).toEqual({ quotes: 0, audits: 0 });
    } finally {
      await pool!.query(
        "ALTER TABLE `audit_logs` DROP CHECK `fx_audit_refused`"
      );
    }
    // ...and a correction whose audit fails leaves only the corrected row.
    const original = await record(yerQuote());
    const before = await quoteRows();
    await pool!.query(
      "ALTER TABLE `audit_logs` ADD CONSTRAINT `fx_correction_refused` CHECK (eventType <> 'EXCHANGE_RATE_CORRECTED')"
    );
    try {
      await expect(
        record(yerQuote({ supersedesId: original.id, rate: "141.00000000" }))
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(await quoteRows()).toEqual(before);
    } finally {
      await pool!.query(
        "ALTER TABLE `audit_logs` DROP CHECK `fx_correction_refused`"
      );
    }
    // The audit row is written in the quote's own transaction: until that
    // transaction commits, another session sees neither of them.
    const real = boundary.db as {
      transaction: (
        run: (tx: unknown) => Promise<unknown>,
        config?: unknown
      ) => Promise<unknown>;
    };
    const beforeCommit: Array<{ quotes: number; audits: number }> = [];
    boundary.db = new Proxy(real, {
      get(target, property, receiver) {
        if (property !== "transaction")
          return Reflect.get(target, property, receiver);
        return (run: (tx: unknown) => Promise<unknown>, config?: unknown) =>
          target.transaction(async tx => {
            const result = await run(tx);
            if (result && typeof result === "object" && "toCurrency" in result)
              beforeCommit.push(await counts());
            return result;
          }, config);
      },
    });
    try {
      await record(
        yerQuote({ supersedesId: original.id, rate: "141.00000000" })
      );
    } finally {
      boundary.db = real;
    }
    expect(beforeCommit).toEqual([{ quotes: 1, audits: 1 }]);
    expect(await counts()).toEqual({ quotes: 2, audits: 2 });
  });

  it("control: a second correction of a quote names the correction to correct instead", async () => {
    // The unique supersedes index alone would answer a generic CONFLICT.
    const original = await record(yerQuote({ rate: "1405.00000000" }));
    const correction = await record(yerQuote({ supersedesId: original.id }));
    await expect(
      record(yerQuote({ supersedesId: original.id, rate: "140.60000000" }))
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: `Quote ${original.id} is already corrected by quote ${correction.id}; correct that quote instead`,
    });
    expect(await quoteRows()).toHaveLength(2);
  });
});
