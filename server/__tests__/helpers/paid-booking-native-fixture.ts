import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../../../drizzle/schema";

/** Owned native tables preserve migrated types and uniqueness. CREATE TABLE
 * LIKE omits foreign keys; migration replay verifies those separately. */
export async function createPaidBookingNativeFixture(
  prefix: "ais_api_process" | "ais_confirmation"
) {
  const source = new URL(process.env.DATABASE_URL ?? "");
  const sourceDatabase = source.pathname.slice(1);
  if (
    process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
    process.env.NODE_ENV !== "test" ||
    source.protocol !== "mysql:" ||
    !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
  )
    throw new Error(
      "Paid booking acceptance requires a loopback disposable database"
    );
  const options = {
    host: source.hostname.replace(/^\[|\]$/g, ""),
    port: Number(source.port || 3306),
    user: decodeURIComponent(source.username),
    password: decodeURIComponent(source.password),
    timezone: "Z",
  };
  const databaseName = `${prefix}_${randomBytes(6).toString("hex")}`;
  const admin = await mysql.createConnection(options);
  let created = false;
  let pool: mysql.Pool | undefined;
  async function close() {
    try {
      await pool?.end();
    } finally {
      try {
        if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin.end();
      }
    }
  }
  try {
    const [tables] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",
      [sourceDatabase]
    );
    const names = tables.map(row => String(row.name));
    if (!names.length || names.some(name => !/^[A-Za-z0-9_]+$/.test(name)))
      throw new Error("Invalid migrated table catalog");
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    for (const name of names)
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
      );
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 10,
    });
    const db = drizzle(pool, { schema, mode: "default" });
    source.pathname = "/" + databaseName;
    return {
      admin,
      pool,
      db,
      databaseName,
      databaseUrl: source.toString(),
      close,
      async reset() {
        for (const name of names)
          await pool!.query(`TRUNCATE TABLE \`${name}\``);
      },
      async seed() {
        await db.insert(schema.tenants).values({
          id: 3,
          slug: "native-confirmation",
          name: "Native confirmation",
          status: "active",
        });
        await db.insert(schema.users).values({
          id: 9,
          openId: "native-confirmation-owner",
          tenantId: 3,
          role: "user",
          name: "Synthetic Owner",
          email: "owner@example.test",
        });
        await db
          .insert(schema.airlines)
          .values({ id: 3, code: "NM", name: "Native Mail Airline" });
        await db.insert(schema.airports).values([
          {
            id: 1,
            code: "NMA",
            name: "Origin",
            city: "Origin",
            country: "SA",
            timezone: "UTC",
          },
          {
            id: 2,
            code: "NMB",
            name: "Destination",
            city: "Destination",
            country: "SA",
            timezone: "UTC",
          },
        ]);
        await db.insert(schema.flights).values(
          [41, 42].map(id => ({
            id,
            tenantId: 3,
            airlineId: 3,
            flightNumber: `NM0${id}`,
            originId: 1,
            destinationId: 2,
            departureTime: new Date(
              `2030-06-${id === 41 ? "10" : "11"}T12:00:00Z`
            ),
            arrivalTime: new Date(
              `2030-06-${id === 41 ? "10" : "11"}T14:00:00Z`
            ),
            economySeats: 8,
            economyAvailable: 8,
            economyPrice: 10000,
            businessSeats: 2,
            businessAvailable: 2,
            businessPrice: 20000,
          }))
        );
        await db.insert(schema.bookings).values({
          id: 71,
          tenantId: 3,
          userId: 9,
          flightId: 41,
          bookingReference: "NM0071",
          pnr: "PN0071",
          totalAmount: 20000,
          cabinClass: "economy",
          numberOfPassengers: 2,
          status: "pending",
          paymentStatus: "pending",
        });
        await db.insert(schema.passengers).values(
          [81, 82].map(id => ({
            id,
            bookingId: 71,
            tenantId: 3,
            firstName: id === 81 ? "Alpha" : "Beta",
            lastName: "Native",
            type: "adult" as const,
          }))
        );
      },
      async financialSnapshot() {
        return {
          bookings: await db.select().from(schema.bookings),
          flights: await db.select().from(schema.flights),
          ledger: await db.select().from(schema.financialLedger),
          receipts: await db.select().from(schema.paymentReceipts),
          payments: await db.select().from(schema.payments),
          confirmations: await db
            .select()
            .from(schema.outbox)
            .where(eq(schema.outbox.eventType, "booking.confirmed")),
        };
      },
      async waitForBlockedTransactions(count: number) {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const [rows] = await admin.query<mysql.RowDataPacket[]>(
            "SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=?",
            [databaseName]
          );
          if (Number(rows[0]?.waiting) >= count) return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error(
          `Expected ${count} actual InnoDB waiters in the owned schema`
        );
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type PaidBookingNativeFixture = Awaited<
  ReturnType<typeof createPaidBookingNativeFixture>
>;
