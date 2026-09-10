/** Seed core records at the previous release and compare every pre-existing column after upgrade. */
import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const [mode, artifact] = process.argv.slice(2);
if (
  !["seed", "verify"].includes(mode) ||
  !artifact ||
  !process.env.DATABASE_URL
)
  throw new Error(
    "Usage: migration-preservation-check.ts seed|verify artifact.json; DATABASE_URL required"
  );
const db = await mysql.createConnection(process.env.DATABASE_URL);
const id = 987001;
const tables = [
  "users",
  "airlines",
  "airports",
  "flights",
  "bookings",
  "passengers",
  "payments",
];
const bookingCases = [
  { status: "confirmed", payment: "paid", reserved: true },
  { status: "completed", payment: "paid", reserved: true },
  { status: "cancelled", payment: "paid", reserved: false },
  { status: "confirmed", payment: "pending", reserved: false },
];
const walletCases = [
  { balance: 12345, status: "active", expected: "frozen" },
  { balance: 0, status: "active", expected: "active" },
  { balance: 12345, status: "frozen", expected: "frozen" },
  { balance: -50, status: "active", expected: "active" },
  { balance: 12345, status: "closed", expected: "closed" },
];
const financialRows = async (table: "bookings" | "wallets", count: number) => {
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM \`${table}\` WHERE id > ? AND id <= ? ORDER BY id`,
    [id, id + count]
  );
  return JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
};
try {
  if (mode === "seed") {
    await db.beginTransaction();
    await db.execute(
      "INSERT INTO users (id, openId, name, email, role) VALUES (?, 'upgrade-preservation', 'Upgrade Fixture', 'upgrade@example.test', 'user')",
      [id]
    );
    await db.execute(
      "INSERT INTO airlines (id, code, name) VALUES (?, 'ZX', 'Upgrade Fixture')",
      [id]
    );
    await db.execute(
      "INSERT INTO airports (id, code, name, city, country) VALUES (?, 'ZZZ', 'Upgrade Fixture', 'Test', 'Test')",
      [id]
    );
    await db.execute(
      "INSERT INTO flights (id, flightNumber, airlineId, originId, destinationId, departureTime, arrivalTime, economyPrice, businessPrice, economySeats, businessSeats, economyAvailable, businessAvailable, status) VALUES (?, 'ZX123', ?, ?, ?, '2030-01-01 10:00:00', '2030-01-01 12:00:00', 12345, 24690, 10, 5, 10, 5, 'scheduled')",
      [id, id, id, id]
    );
    await db.execute(
      "INSERT INTO bookings (id, userId, flightId, bookingReference, pnr, status, totalAmount, cabinClass, numberOfPassengers) VALUES (?, ?, ?, 'UPGR01', 'UPGR02', 'pending', 12345, 'economy', 1)",
      [id, id, id]
    );
    await db.execute(
      "INSERT INTO passengers (id, bookingId, type, firstName, lastName) VALUES (?, ?, 'adult', 'Upgrade', 'Fixture')",
      [id, id]
    );
    await db.execute(
      "INSERT INTO payments (id, bookingId, amount, method, status) VALUES (?, ?, 12345, 'card', 'pending')",
      [id, id]
    );
    for (const [offset, item] of bookingCases.entries())
      await db.execute(
        "INSERT INTO bookings (id, userId, flightId, bookingReference, pnr, status, paymentStatus, totalAmount, cabinClass, numberOfPassengers) VALUES (?, ?, ?, ?, ?, ?, ?, 12345, 'economy', 1)",
        [
          id + offset + 1,
          id,
          id,
          `UPGF0${offset}`,
          `UPGP0${offset}`,
          item.status,
          item.payment,
        ]
      );
    for (const [offset, item] of walletCases.entries())
      await db.execute(
        "INSERT INTO wallets (id, userId, balance, status) VALUES (?, ?, ?, ?)",
        [id + offset + 1, id + offset + 1, item.balance, item.status]
      );
    await db.commit();
    const snapshot: Record<string, unknown> = {};
    for (const table of tables) {
      const [rows] = await db.execute(
        `SELECT * FROM \`${table}\` WHERE id = ?`,
        [id]
      );
      snapshot[table] = rows;
    }
    snapshot.financialBookings = await financialRows(
      "bookings",
      bookingCases.length
    );
    snapshot.financialWallets = await financialRows(
      "wallets",
      walletCases.length
    );
    await writeFile(artifact, JSON.stringify(snapshot, null, 2));
    console.info("Seeded and snapshotted seven nonempty core tables");
  } else {
    const before = JSON.parse(await readFile(artifact, "utf8"));
    for (const table of tables) {
      const [rows] = await db.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM \`${table}\` WHERE id = ?`,
        [id]
      );
      if (rows.length !== 1) throw new Error(`Lost core fixture in ${table}`);
      const current = JSON.parse(JSON.stringify(rows[0]));
      for (const [column, value] of Object.entries(before[table][0]))
        if (JSON.stringify(current[column]) !== JSON.stringify(value))
          throw new Error(`Changed original value ${table}.${column}`);
    }
    const financial = {
      bookings: await financialRows("bookings", bookingCases.length),
      wallets: await financialRows("wallets", walletCases.length),
    };
    assert.equal(financial.bookings.length, bookingCases.length);
    assert.equal(financial.wallets.length, walletCases.length);
    for (const [table, key] of [
      ["bookings", "financialBookings"],
      ["wallets", "financialWallets"],
    ] as const) {
      for (const [index, row] of financial[table].entries()) {
        for (const [column, value] of Object.entries(before[key][index])) {
          if (
            column === "updatedAt" ||
            (table === "wallets" && column === "status") ||
            (table === "bookings" && column === "seatsReserved")
          )
            continue;
          assert.deepEqual(
            row[column],
            value,
            `Preserve financial ${table}.${column}`
          );
        }
      }
    }
    for (const [index, row] of financial.bookings.entries())
      assert.equal(Boolean(row.seatsReserved), bookingCases[index].reserved);
    for (const [index, row] of financial.wallets.entries()) {
      assert.equal(row.status, walletCases[index].expected);
      assert.equal(row.balance, walletCases[index].balance);
    }
    console.info(
      "All original column values survived the upgrade in seven core tables"
    );
    console.info(
      "Legacy wallet freezing and paid booking inventory backfill verified without changing funds or unrelated rows"
    );
  }
} finally {
  await db.end();
}
