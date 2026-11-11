import crypto from "node:crypto";
import mysql, { type Pool, type Connection } from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { eq, getTableName } from "drizzle-orm";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
const state = vi.hoisted(() => ({
  db: null as MySql2Database<typeof schema> | null,
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  addPassenger,
  setDefaultPassenger,
  deletePassenger,
  getUserPassengers,
} from "../services/saved-passengers.service";
import {
  upsertUserPreferences,
  getUserPreferences,
} from "../services/user-preferences.service";
import {
  blockIpAddress,
  unblockIpAddress,
  isIpBlocked,
} from "../services/account-lock.service";
import { awardBonusMiles } from "../services/loyalty.service";
import { addToWaitlist } from "../services/waitlist.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const tables = [
  schema.users,
  schema.savedPassengers,
  schema.userPreferences,
  schema.ipBlacklist,
  schema.flights,
  schema.waitlist,
  schema.loyaltyAccounts,
  schema.milesTransactions,
  schema.loyaltyCreditLots,
  schema.loyaltyPolicyProfiles,
];

nativeDescribe("identity integrity on disposable MySQL", () => {
  let pool: Pool;
  let admin: Connection;
  let databaseName: string;
  let created = false;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const source = url.pathname.slice(1);
    if (
      url.protocol !== "mysql:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^ais_[a-z0-9_]*test$/.test(source)
    )
      throw new Error("Requires explicit loopback ais_*test source schema");
    const options = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_identity_" + crypto.randomBytes(6).toString("hex");
    admin = await mysql.createConnection(options);
    await admin.query("CREATE DATABASE " + databaseName);
    created = true;
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 8,
    });
    for (const table of tables) {
      const name = getTableName(table);
      await pool.query(
        `CREATE TABLE \`${name}\` LIKE \`${source}\`.\`${name}\``
      );
    }
    state.db = drizzle(pool, { schema, mode: "default" });
  });
  afterAll(async () => {
    await pool?.end();
    if (created) await admin.query("DROP DATABASE " + databaseName);
    await admin?.end();
    state.db = null;
  });
  beforeEach(async () => {
    for (const table of [...tables].reverse()) await state.db!.delete(table);
    await state.db!.insert(schema.users).values([
      { id: 1, openId: "identity-owner", tenantId: 7 },
      { id: 2, openId: "identity-other", tenantId: 8 },
    ]);
  });
  it("serializes simultaneous first passenger insertions and default switches", async () => {
    const rows = await Promise.all([
      addPassenger(1, { firstName: "A", lastName: "One" }),
      addPassenger(1, { firstName: "B", lastName: "Two" }),
    ]);
    expect((await getUserPassengers(1)).filter(p => p.isDefault)).toHaveLength(
      1
    );
    await Promise.all(rows.map(p => setDefaultPassenger(p.id, 1)));
    expect((await getUserPassengers(1)).filter(p => p.isDefault)).toHaveLength(
      1
    );
  });
  it("rolls back a failed default insert after clearing the old default", async () => {
    const first = await addPassenger(1, { firstName: "A", lastName: "One" });
    await pool.query(
      "CREATE TRIGGER reject_saved_insert BEFORE INSERT ON saved_passengers FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected failure'"
    );
    try {
      await expect(
        addPassenger(1, { firstName: "B", lastName: "Two", isDefault: true })
      ).rejects.toThrow();
      expect(
        (await getUserPassengers(1)).filter(p => p.isDefault).map(p => p.id)
      ).toEqual([first.id]);
    } finally {
      await pool.query("DROP TRIGGER reject_saved_insert");
    }
  });
  it("serializes deletion of a default against another default selection", async () => {
    const a = await addPassenger(1, { firstName: "A", lastName: "One" });
    const b = await addPassenger(1, { firstName: "B", lastName: "Two" });
    await Promise.all([deletePassenger(a.id, 1), setDefaultPassenger(b.id, 1)]);
    expect(
      (await getUserPassengers(1)).filter(p => p.isDefault).map(p => p.id)
    ).toEqual([b.id]);
  });
  it("merges concurrent first writes to disjoint preference fields", async () => {
    await Promise.all([
      upsertUserPreferences(1, { passportNumber: "SYNTHETIC" }),
      upsertUserPreferences(1, { smsNotifications: true }),
    ]);
    expect(await getUserPreferences(1)).toMatchObject({
      passportNumber: "SYNTHETIC",
      smsNotifications: true,
    });
  });
  it("reuses an IP row after unblock and clears previous unlock metadata", async () => {
    await blockIpAddress("192.0.2.1", "first", "fixture");
    await unblockIpAddress("192.0.2.1", "fixture");
    await blockIpAddress("192.0.2.1", "second", "fixture", 30);
    const rows = await state.db!.select().from(schema.ipBlacklist);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isActive: true,
      reason: "second",
      unblockedAt: null,
      unblockedBy: null,
    });
    expect(await isIpBlocked("192.0.2.1")).toBe(true);
  });
  it("concurrent shorter blocks never replace a permanent active block", async () => {
    await Promise.all([
      blockIpAddress("192.0.2.2", "permanent", "fixture"),
      blockIpAddress("192.0.2.2", "short", "fixture", 5),
    ]);
    const [row] = await state.db!.select().from(schema.ipBlacklist);
    expect(row).toMatchObject({
      isActive: true,
      reason: "permanent",
      autoUnblockAt: null,
    });
  });
  it("rejects absent and foreign bonus recipients without orphan rows", async () => {
    await expect(awardBonusMiles(999, 100, "fixture", 7)).rejects.toMatchObject(
      { code: "NOT_FOUND" }
    );
    await expect(awardBonusMiles(2, 100, "fixture", 7)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await state.db!.select().from(schema.loyaltyAccounts)).toHaveLength(
      0
    );
    expect(
      await state.db!.select().from(schema.milesTransactions)
    ).toHaveLength(0);
    expect(
      await state.db!.select().from(schema.loyaltyCreditLots)
    ).toHaveLength(0);
  });
  it("concurrent valid bonus grants conserve balance and lots", async () => {
    await Promise.all([
      awardBonusMiles(1, 30, "A", 7),
      awardBonusMiles(1, 50, "B", 7),
    ]);
    const [account] = await state.db!.select().from(schema.loyaltyAccounts);
    expect(account.currentMilesBalance).toBe(80);
    const lots = await state.db!.select().from(schema.loyaltyCreditLots);
    expect(lots.reduce((sum, lot) => sum + lot.remainingMiles, 0)).toBe(80);
  });
  it("admits only one concurrent waitlist request and refuses offered readmission", async () => {
    await state.db!.insert(schema.flights).values({
      id: 1,
      flightNumber: "TS001",
      airlineId: 1,
      originId: 1,
      destinationId: 2,
      departureTime: new Date(Date.now() + 86400000),
      arrivalTime: new Date(Date.now() + 90000000),
      economySeats: 1,
      businessSeats: 0,
      economyPrice: 100,
      businessPrice: 200,
      economyAvailable: 0,
      businessAvailable: 0,
    });
    const results = await Promise.allSettled([
      addToWaitlist(1, 1, 1, "economy"),
      addToWaitlist(1, 1, 1, "economy"),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const rows = await state.db!.select().from(schema.waitlist);
    expect(rows).toHaveLength(1);
    await state
      .db!.update(schema.waitlist)
      .set({ status: "offered" })
      .where(eq(schema.waitlist.id, rows[0].id));
    await expect(addToWaitlist(1, 1, 1, "economy")).rejects.toThrow(
      "already on the waitlist"
    );
  });
});
