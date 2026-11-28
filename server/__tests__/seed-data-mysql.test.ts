import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const native =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL;
const tables = [
  "users",
  "airlines",
  "airports",
  "flights",
  "currencies",
  "ancillary_services",
  "pricing_rules",
  "seasonal_pricing",
  "aircraft_types",
  "bookings",
  "payments",
  "payment_receipts",
  "financial_ledger",
];

describe.skipIf(!native)("reference-data seed on disposable MySQL", () => {
  const database = "ais_seed_" + randomBytes(6).toString("hex");
  let admin: Connection;
  let db: Connection;
  let created = false;
  let target: URL;

  function seed(mode = process.env.NODE_ENV) {
    return execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed-data.mjs"],
      {
        env: { ...process.env, NODE_ENV: mode, DATABASE_URL: target.href },
        stdio: "pipe",
        encoding: "utf8",
        timeout: 30000,
      }
    );
  }

  beforeAll(async () => {
    target = new URL(process.env.DATABASE_URL!);
    const source = target.pathname.slice(1);
    if (
      target.protocol !== "mysql:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
      !/^ais_[a-z0-9_]*test$/.test(source)
    )
      throw new Error(
        "Seed test requires an explicit loopback ais_*test schema"
      );
    admin = await mysql.createConnection(target.href);
    await admin.query("CREATE DATABASE " + database);
    created = true;
    target.pathname = "/" + database;
    db = await mysql.createConnection(target.href);
    for (const table of tables)
      await db.query(
        `CREATE TABLE \`${table}\` LIKE \`${source}\`.\`${table}\``
      );
    await db.query(
      "INSERT INTO users (openId, name) VALUES ('seed-existing-user', 'Existing test user')"
    );
    await db.query("ALTER TABLE airports AUTO_INCREMENT = 501");
    await db.query("ALTER TABLE airlines AUTO_INCREMENT = 801");
    seed();
  }, 45000);

  afterAll(async () => {
    await db?.end();
    if (created) await admin.query("DROP DATABASE " + database);
    await admin?.end();
  });

  it("resolves every route by code after a second seed advances the IDs again", async () => {
    const [[before]] = await db.query<RowDataPacket[]>(
      "SELECT MAX(id) AS lastId FROM airports"
    );
    seed();
    const [[after]] = await db.query<RowDataPacket[]>(
      "SELECT MIN(id) AS firstId FROM airports"
    );
    expect(after.firstId).toBeGreaterThan(before.lastId);
    const [users] = await db.query<RowDataPacket[]>(
      "SELECT openId, name FROM users"
    );
    expect(users).toEqual([
      { openId: "seed-existing-user", name: "Existing test user" },
    ]);
    const [rows] = await db.query<RowDataPacket[]>(`
      SELECT f.flightNumber, a.code AS airline, o.code AS origin, d.code AS destination
      FROM flights f
      LEFT JOIN airlines a ON a.id = f.airlineId
      LEFT JOIN airports o ON o.id = f.originId
      LEFT JOIN airports d ON d.id = f.destinationId
      ORDER BY f.flightNumber
    `);
    expect(
      rows.map(r =>
        [r.flightNumber, r.airline, r.origin, r.destination].join(" ")
      )
    ).toEqual([
      "EK789 EK RUH DXB",
      "IY210 IY SAH ADE",
      "IY601 IY JED SAH",
      "IY602 IY SAH JED",
      "IY603 IY JED ADE",
      "IY604 IY ADE JED",
      "MS456 MS JED CAI",
      "QR321 QR JED DOH",
      "SV1234 SV RUH JED",
      "SV567 SV DMM RUH",
      "WY607 WY MCT DXB",
      "WY812 WY RUH MCT",
      "WY813 WY MCT RUH",
      "WY814 WY JED MCT",
    ]);
  });

  async function checksum() {
    const [rows] = await db.query<RowDataPacket[]>(
      "CHECKSUM TABLE " + tables.join(", ") + " EXTENDED"
    );
    expect(rows).toHaveLength(tables.length);
    for (const row of rows) expect(row.Checksum).toEqual(expect.any(Number));
    return rows;
  }

  it("refuses production mode before changing any seeded rows", async () => {
    const before = await checksum();
    expect(() => seed("production")).toThrow("Refusing to seed in production");
    expect(await checksum()).toEqual(before);
  });

  it("rolls back every delete and insert when a later seed stage fails", async () => {
    const before = await checksum();
    await db.query(
      "CREATE TRIGGER seed_failure BEFORE INSERT ON seasonal_pricing FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected seed failure'"
    );
    try {
      expect(seed).toThrow("Injected seed failure");
      expect(await checksum()).toEqual(before);
    } finally {
      await db.query("DROP TRIGGER seed_failure");
    }
  });

  it.each([
    [
      "bookings",
      "INSERT INTO bookings (userId, flightId, bookingReference, pnr, totalAmount, cabinClass) VALUES (7, 9, 'SEED01', 'TEST01', 100, 'economy')",
    ],
    [
      "payments",
      "INSERT INTO payments (bookingId, amount, method) VALUES (9, 100, 'card')",
    ],
    [
      "payment_receipts",
      "INSERT INTO payment_receipts (paymentIntentId, kind, userId, targetId, amount, currency) VALUES ('seed-receipt', 'wallet_topup', 7, 9, 100, 'SAR')",
    ],
    [
      "financial_ledger",
      "INSERT INTO financial_ledger (type, amount) VALUES ('adjustment', 100)",
    ],
  ])(
    "preserves every reference and history table when %s contains a row",
    async (table, insert) => {
      await db.query(insert);
      try {
        const before = await checksum();
        expect(seed).toThrow(`Refusing to seed: ${table} contains history`);
        expect(await checksum()).toEqual(before);
      } finally {
        await db.query("DELETE FROM " + table);
      }
    }
  );
});
