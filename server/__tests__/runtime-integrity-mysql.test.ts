import { randomBytes } from "node:crypto";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
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
const state = vi.hoisted(() => ({
  db: null as MySql2Database<typeof schema> | null,
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/production.service", () => ({
  withCircuitBreaker: (_name: string, run: () => Promise<unknown>) => run(),
}));
import { checkPriceAlertsAndNotify } from "../services/favorites.service";
import { resendSMS } from "../services/sms.service";
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const tables = [
  schema.favoriteFlights,
  schema.favoritePriceObservations,
  schema.priceAlertHistory,
  schema.flights,
  schema.smsLogs,
];
nativeDescribe.sequential(
  "runtime integrity on disposable native MySQL",
  () => {
    let admin: mysql.Connection | undefined;
    let pool: mysql.Pool | undefined;
    let databaseName = "";
    let created = false;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const source = url.pathname.slice(1);
      if (
        !/^ais_[a-z0-9_]*test$/.test(source) ||
        !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "Explicit disposable loopback ais_*test database required"
        );
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      admin = await mysql.createConnection(options);
      databaseName = "ais_runtime_" + randomBytes(6).toString("hex");
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid table");
        await admin.query(
          `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
        );
      }
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 4,
      });
      state.db = drizzle(pool, { schema, mode: "default" });
    }, 30000);
    beforeEach(async () => {
      for (const table of tables) await state.db!.delete(table);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    afterAll(async () => {
      await pool?.end();
      if (created) await admin?.query(`DROP DATABASE \`${databaseName}\``);
      await admin?.end();
      state.db = null;
    });
    it("serializes concurrent favorite observations and records one drop intent", async () => {
      await state.db!.insert(schema.favoriteFlights).values({
        id: 1,
        userId: 1,
        originId: 1,
        destinationId: 2,
        enablePriceAlert: true,
        maxPrice: 40000,
        cabinClass: "economy",
      });
      await state.db!.insert(schema.flights).values({
        id: 1,
        flightNumber: "FIX1",
        airlineId: 1,
        originId: 1,
        destinationId: 2,
        departureTime: new Date(Date.now() + 86400000),
        arrivalTime: new Date(Date.now() + 90000000),
        economySeats: 100,
        businessSeats: 10,
        economyAvailable: 100,
        businessAvailable: 10,
        economyPrice: 30000,
        businessPrice: 60000,
      });
      await Promise.all([
        checkPriceAlertsAndNotify(),
        checkPriceAlertsAndNotify(),
      ]);
      expect(
        await state.db!.select().from(schema.favoritePriceObservations)
      ).toHaveLength(1);
      expect(
        await state.db!.select().from(schema.priceAlertHistory)
      ).toHaveLength(0);
      await state
        .db!.update(schema.flights)
        .set({ economyPrice: 20000 })
        .where(eq(schema.flights.id, 1));
      const outcomes = await Promise.all([
        checkPriceAlertsAndNotify(),
        checkPriceAlertsAndNotify(),
      ]);
      expect(outcomes.reduce((sum, value) => sum + value.alertsFound, 0)).toBe(
        1
      );
      expect(
        await state.db!.select().from(schema.priceAlertHistory)
      ).toHaveLength(1);
      expect(
        (await state.db!.select().from(schema.favoriteFlights))[0].lastAlertSent
      ).toBeNull();
    });
    it("claims one SMS retry across concurrent connections and keeps the original receipt", async () => {
      await state.db!.insert(schema.smsLogs).values({
        id: 1,
        phoneNumber: "+966500000000",
        message: "Synthetic only",
        type: "system",
        provider: "twilio",
        status: "failed",
      });
      vi.stubEnv("SMS_PROVIDER", "twilio");
      vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_SYNTHETIC");
      vi.stubEnv("TWILIO_AUTH_TOKEN", "synthetic");
      vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sid: "SM_NATIVE_FIXTURE" }),
      });
      vi.stubGlobal("fetch", fetch);
      const results = await Promise.allSettled([resendSMS(1), resendSMS(1)]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      const rows = await state.db!.select().from(schema.smsLogs);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "sent",
        retryCount: 1,
        providerMessageId: "SM_NATIVE_FIXTURE",
      });
      await expect(resendSMS(1)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }
);
