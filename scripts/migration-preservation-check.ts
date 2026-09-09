/** Seed core records at the previous release and compare every pre-existing column after upgrade. */
import mysql from "mysql2/promise";
import { readFile, writeFile } from "node:fs/promises";
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
    await db.commit();
    const snapshot: Record<string, unknown> = {};
    for (const table of tables) {
      const [rows] = await db.execute(
        `SELECT * FROM \`${table}\` WHERE id = ?`,
        [id]
      );
      snapshot[table] = rows;
    }
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
    console.info(
      "All original column values survived the upgrade in seven core tables"
    );
  }
} finally {
  await db.end();
}
