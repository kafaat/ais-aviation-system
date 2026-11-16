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
      // becomes a converted amount.
      const refused = await response("convertCurrency", { ...pair, amount: 1 });
      expect(refused.status).toBe(400);
      expect(refused.body.error?.json?.data?.code).toBe("BAD_REQUEST");
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

  it("fix: the staleness alarm raises for missing and stale quotes and clears on a fresh quote", async () => {
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
    expect(status.pairs.every(pair => pair.alarm)).toBe(true);
    const missing = await alarms();
    expect(missing).toHaveLength(10);
    expect(missing.every(alarm => alarm.status === "active")).toBe(true);
    const yerAlarm = async () =>
      (await alarms()).find(alarm => alarm.key === "fx-display-rate:SAR_YER");
    expect(await yerAlarm()).toMatchObject({
      status: "active",
      message: expect.stringContaining("no current operator quote"),
    });

    // A quote observed 25 hours ago is recorded but too old to display.
    const now = Date.now();
    const stale = await caller(platformAdmin).exchangeRates.record(
      yerQuote({
        validFrom: wholeSecond(now - 25 * hour),
        validTo: wholeSecond(now + hour),
      })
    );
    expect(await yerAlarm()).toMatchObject({ status: "active" });

    // A fresh quote clears the alarm for its pair only.
    const fresh = await caller(platformAdmin).exchangeRates.record(
      yerQuote({
        validFrom: wholeSecond(now - 60_000),
        validTo: wholeSecond(now + 30 * hour),
      })
    );
    expect(fresh.version).toBe(stale.version! + 1);
    expect(await yerAlarm()).toMatchObject({ status: "resolved" });
    expect(
      (await alarms()).filter(alarm => alarm.status === "active")
    ).toHaveLength(9);

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
});
