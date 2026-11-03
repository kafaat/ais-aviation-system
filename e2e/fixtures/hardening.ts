import type { Page } from "@playwright/test";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { disposableDatabaseUrl } from "../disposable-database";
import { useBrowserSession } from "./browser-session";
import { rpc } from "./rpc";

export { rpc };

export async function sqlRows<T extends RowDataPacket>(
  sql: string,
  params: (number | string)[] = []
) {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    return (await db.execute<T[]>(sql, params))[0];
  } finally {
    await db.end();
  }
}
export async function fixtureFlight() {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    await db.beginTransaction();
    const [flight] = await db.execute<ResultSetHeader>(
      // Departs at 12:00 UTC two days out: the same civil day in UTC and in
      // every airport zone between UTC-11 and UTC+11, so a search for the UTC
      // date finds it whatever zone the seeded origin airport carries and
      // whatever hour the suite runs (it failed between 21:00 and 24:00 UTC,
      // when the Riyadh day had already turned).
      "INSERT INTO flights (flightNumber, airlineId, originId, destinationId, departureTime, arrivalTime, aircraftType, economySeats, businessSeats, economyPrice, businessPrice, economyAvailable, businessAvailable) SELECT flightNumber, airlineId, originId, destinationId, TIMESTAMP(DATE(UTC_TIMESTAMP()) + INTERVAL 2 DAY, '12:00:00'), TIMESTAMP(DATE(UTC_TIMESTAMP()) + INTERVAL 2 DAY, '14:00:00'), 'B737', 10, 2, 10000, 20000, 10, 2 FROM flights ORDER BY id LIMIT 1"
    );
    if (!flight.affectedRows) throw new Error("Seed flight missing");
    // The disposable seed uses small auto-increment IDs. Keep each fixture
    // identifiable in search while issuing an encodable carrier/flight number.
    if (flight.insertId > 9999)
      throw new Error("E2E flight number range exhausted");
    await db.execute(
      "UPDATE flights f JOIN airlines a ON a.id = f.airlineId SET f.flightNumber = CONCAT(a.code, LPAD(f.id, 4, '0'), 'T') WHERE f.id = ?",
      [flight.insertId]
    );
    await db.commit();
    // Search results for this route and day may already be cached by another
    // test in the run (the same route and 12:00 UTC day are shared by every
    // fixture flight). A cached result does not learn about new flights until
    // its TTL expires, so bump the search namespace version the way the admin
    // cache.invalidateFlightSearch procedure does. Harmless without Redis.
    await invalidateFlightSearchCache();
    return flight.insertId;
  } finally {
    await db.end();
  }
}
export async function ownedBooking(
  page: Page,
  funded = false,
  passengers = [
    { firstName: "Synthetic", lastName: "Journey", type: "adult" as const },
  ]
) {
  await useBrowserSession(page, "regular");
  const client = rpc(page),
    flightId = await fixtureFlight();
  const user = await client.auth.me.query();
  if (!user) throw new Error("Authentication failed");
  const command = {
    flightId,
    cabinClass: "economy" as const,
    sessionId: randomUUID(),
    idempotencyKey: randomUUID(),
    passengers,
  };
  const booking = await client.bookings.create.mutate(command);
  const db = await mysql.createConnection(disposableDatabaseUrl());
  try {
    await db.execute(
      "INSERT INTO user_credits (userId, amount, source) VALUES (?, ?, 'promo')",
      [user.id, booking.totalAmount]
    );
  } finally {
    await db.end();
  }
  if (funded)
    await client.vouchers.useCredits.mutate({
      bookingId: booking.bookingId,
      amount: booking.totalAmount,
    });
  return { booking, flightId, userId: user.id, command };
}

async function invalidateFlightSearchCache(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return;
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const prefix = process.env.CACHE_PREFIX || "ais";
    await redis.incr(`${prefix}:version:search`);
  } finally {
    redis.disconnect();
  }
}
