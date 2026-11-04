import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import { retainedPurgeSources } from "./fixtures/booking-purge.fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { purgeDeletedBookings } from "../services/soft-delete.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

nativeDescribe.sequential(
  "booking purge with retained native MySQL evidence",
  () => {
    let admin: mysql.Connection | undefined;
    let connection: mysql.Connection | undefined;
    let db: MySql2Database<typeof schema>;
    let databaseName = "";
    let created = false;
    const tables = [
      schema.bookings,
      schema.passengers,
      ...retainedPurgeSources.map(source => source.table),
    ];

    beforeAll(async () => {
      const source = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = source.pathname.slice(1);
      if (
        source.protocol !== "mysql:" ||
        !/^ais_[a-z0-9_]*test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
      )
        throw new Error(
          "Native purge acceptance requires a loopback disposable ais_*test source"
        );
      const options = {
        host: source.hostname.replace(/^\[|\]$/g, ""),
        port: Number(source.port || 3306),
        user: decodeURIComponent(source.username),
        password: decodeURIComponent(source.password),
        timezone: "Z",
      };
      databaseName = "ais_purge_" + randomBytes(6).toString("hex");
      if (!/^ais_purge_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid owned purge schema name");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      created = true;
      connection = await mysql.createConnection({
        ...options,
        database: databaseName,
      });
      await connection.query("SET SESSION time_zone = '+00:00'");
      // Copy the migration-verified columns, indexes, engines and defaults, never
      // source rows. LIKE does not copy foreign keys; the first two cases prove
      // service eligibility rather than relying on an implicit financial FK.
      // Preserve the runner's strict SQL mode throughout.
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name))
          throw new Error("Invalid fixture table name");
        await connection.query(
          `CREATE TABLE \`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
        );
      }
      db = drizzle(connection, { schema, mode: "default" });
      state.db = db;
    }, 40_000);

    beforeEach(async () => {
      await connection!.query("DROP TABLE IF EXISTS purge_retained_reference");
      for (const table of [...tables].reverse())
        await connection!.query(`DELETE FROM \`${getTableName(table)}\``);
    });

    afterAll(async () => {
      state.db = null;
      try {
        await connection?.end();
      } finally {
        if (admin) {
          try {
            if (created) await admin.query("DROP DATABASE " + databaseName);
          } finally {
            await admin.end();
          }
        }
      }
    }, 20_000);

    async function seedBookings(count: number) {
      const deletedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await db.insert(schema.bookings).values(
        Array.from({ length: count }, (_, index) => ({
          id: index + 1,
          userId: 101,
          flightId: 201,
          bookingReference: "B" + (index + 1).toString().padStart(5, "0"),
          pnr: "P" + (index + 1).toString().padStart(5, "0"),
          status: "cancelled" as const,
          totalAmount: 12_000,
          cabinClass: "economy" as const,
          deletedAt,
        }))
      );
      await db.insert(schema.passengers).values(
        Array.from({ length: count }, (_, index) => ({
          id: (index + 1) * 10,
          bookingId: index + 1,
          firstName: "Synthetic",
          lastName: "Purge Fixture",
        }))
      );
    }

    async function remainingOwnership() {
      return {
        bookings: (
          await db
            .select({ id: schema.bookings.id })
            .from(schema.bookings)
            .orderBy(schema.bookings.id)
        ).map(row => row.id),
        passengers: (
          await db
            .select({ bookingId: schema.passengers.bookingId })
            .from(schema.passengers)
            .orderBy(schema.passengers.bookingId)
        ).map(row => row.bookingId),
      };
    }

    async function retainedRows() {
      return {
        payments: await db.select().from(schema.payments),
        ledger: await db.select().from(schema.financialLedger),
        credits: await db.select().from(schema.userCredits),
        coupons: await db.select().from(schema.ticketCoupons),
        checkout: await db.select().from(schema.bookingCheckoutRequests),
        offers: await db.select().from(schema.retailOffers),
      };
    }

    it("skips committed money, credit, document and invoice authorities while purging an unreferenced booking", async () => {
      await seedBookings(7);
      await db.insert(schema.payments).values({
        bookingId: 1,
        amount: 12_000,
        method: "card",
        status: "refunded",
      });
      await db.insert(schema.financialLedger).values({
        bookingId: 2,
        type: "charge",
        amount: "120.00",
      });
      await db.insert(schema.userCredits).values({
        bookingId: 3,
        userId: 101,
        amount: 12_000,
        source: "refund",
        usedAmount: 12_000,
      });
      await db.insert(schema.ticketCoupons).values({
        // Preserve passenger-owned evidence even when its booking field disagrees.
        bookingId: 999,
        passengerId: 40,
        flightId: 201,
        ticketNumber: "0010000000004",
        couponNumber: 1,
        status: "V",
      });
      await db.insert(schema.bookingCheckoutRequests).values({
        bookingId: 5,
        userId: 101,
        requestId: "synthetic-purge-checkout",
        invoiceHash: "a".repeat(64),
        requestPayload: "{}",
        status: "expired",
      });
      await db.insert(schema.retailOffers).values({
        id: "00000000-0000-0000-0000-000000000006",
        flightId: 201,
        channel: "direct",
        cabinClass: "economy",
        payload: { synthetic: true },
        digest: "b".repeat(64),
        totalAmount: 12_000,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        consumedBookingId: 6,
      });
      const before = await retainedRows();

      expect(await purgeDeletedBookings()).toEqual({ purgedCount: 1 });
      expect(await remainingOwnership()).toEqual({
        bookings: [1, 2, 3, 4, 5, 6],
        passengers: [1, 2, 3, 4, 5, 6],
      });
      expect(await retainedRows()).toEqual(before);
    });

    it("preserves legacy inline payment and ticket evidence without a new receipt row", async () => {
      await seedBookings(6);
      await db
        .update(schema.bookings)
        .set({ paymentStatus: "paid" })
        .where(eq(schema.bookings.id, 1));
      await db
        .update(schema.bookings)
        .set({ paymentStatus: "refunded" })
        .where(eq(schema.bookings.id, 2));
      await db
        .update(schema.bookings)
        .set({ stripePaymentIntentId: "pi_synthetic_retained" })
        .where(eq(schema.bookings.id, 3));
      await db
        .update(schema.bookings)
        .set({ stripeCheckoutSessionId: "cs_synthetic_retained" })
        .where(eq(schema.bookings.id, 4));
      await db
        .update(schema.passengers)
        .set({ ticketNumber: "0010000000005" })
        .where(eq(schema.passengers.id, 50));

      expect(await purgeDeletedBookings()).toEqual({ purgedCount: 1 });
      expect(await remainingOwnership()).toEqual({
        bookings: [1, 2, 3, 4, 5],
        passengers: [1, 2, 3, 4, 5],
      });
      expect(await db.select().from(schema.payments)).toHaveLength(0);
      expect(await db.select().from(schema.ticketCoupons)).toHaveLength(0);
    });

    it("rolls back both deletes when a further native restrictive reference rejects the batch", async () => {
      await seedBookings(2);
      // This deliberately sits outside the enumerated financial authorities.
      await connection!.query(
        "CREATE TABLE purge_retained_reference (id INT PRIMARY KEY, bookingId INT NOT NULL, " +
          "CONSTRAINT purge_retained_booking_fk FOREIGN KEY (bookingId) " +
          "REFERENCES bookings(id) ON DELETE RESTRICT) ENGINE=InnoDB"
      );
      await connection!.execute(
        "INSERT INTO purge_retained_reference (id, bookingId) VALUES (?, ?)",
        [1, 2]
      );

      await expect(purgeDeletedBookings()).rejects.toMatchObject({
        cause: { code: "ER_ROW_IS_REFERENCED_2" },
      });
      expect(await remainingOwnership()).toEqual({
        bookings: [1, 2],
        passengers: [1, 2],
      });
      const [references] = await connection!.query<mysql.RowDataPacket[]>(
        "SELECT id, bookingId FROM purge_retained_reference"
      );
      expect(references).toEqual([{ id: 1, bookingId: 2 }]);
      await connection!.query("DELETE FROM purge_retained_reference");
      expect(await purgeDeletedBookings()).toEqual({ purgedCount: 2 });
      expect(await remainingOwnership()).toEqual({
        bookings: [],
        passengers: [],
      });
    });
  }
);
