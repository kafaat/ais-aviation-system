import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
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
import type { FlightStatusChangeData } from "../services/email.service";
import { flightNotificationEvent } from "./helpers/flight-notification-event";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof import("../db").getDb>,
  send: vi.fn<(data: FlightStatusChangeData) => Promise<boolean>>(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/email.service", () => ({
  sendFlightStatusChange: state.send,
}));
import { deliverFlightStatusEmails } from "../services/flight-event-delivery.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

nativeDescribe(
  "native flight email delivery receipts and tenant boundaries",
  () => {
    let admin: mysql.Connection | undefined;
    let pool: mysql.Pool | undefined;
    let databaseName = "";
    let databaseCreated = false;
    const receipts = async () => {
      if (!pool) throw new Error("Native fixture was not initialized");
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT consumer,status,attempts,processedAt,lastError,leaseToken FROM event_deliveries ORDER BY consumer"
      );
      return rows;
    };
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = url.pathname.slice(1);
      if (
        url.protocol !== "mysql:" ||
        !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "Native flight delivery fixtures require a loopback disposable _test database"
        );
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName = "ais_flight_mail_" + randomBytes(6).toString("hex");
      if (!/^ais_flight_mail_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid isolated database name");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      databaseCreated = true;
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 5,
      });
      // Clone the CI-migrated catalog (validated separately by the native matrix).
      // The consumer uses a reduced booking/user projection; this fixture does
      // not assert the rest of the recipient tables' schema or booking semantics.
      for (const table of [
        "flights",
        "airports",
        "event_inbox",
        "event_deliveries",
      ])
        await pool.query(
          `CREATE TABLE \`${table}\` LIKE \`${sourceDatabase}\`.\`${table}\``
        );
      await pool.query(
        "CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(320), name VARCHAR(255))"
      );
      await pool.query(
        "CREATE TABLE bookings (id INT PRIMARY KEY, userId INT NOT NULL, tenantId INT, bookingReference VARCHAR(6) NOT NULL)"
      );
      state.db = drizzle(pool, { schema, mode: "default" });
    });
    beforeEach(async () => {
      if (!pool) throw new Error("Native fixture was not initialized");
      for (const table of [
        "event_deliveries",
        "event_inbox",
        "bookings",
        "users",
        "flights",
        "airports",
      ])
        await pool.query("DELETE FROM " + table);
      await pool.query(
        "INSERT INTO users (id,email,name) VALUES (1,'first@example.test','First'),(2,'second@example.test','Second')"
      );
      await pool.query(
        "INSERT INTO bookings (id,userId,tenantId,bookingReference) VALUES (11,1,101,'ONE111'),(12,2,101,'TWO222')"
      );
      await pool.query(
        "INSERT INTO airports (id,code,name,city,country) VALUES (21,'RUH','Riyadh','Riyadh','SA'),(22,'JED','Jeddah','Jeddah','SA')"
      );
      await pool.query(
        "INSERT INTO flights (id,flightNumber,airlineId,tenantId,originId,destinationId,departureTime,arrivalTime,economySeats,businessSeats,economyPrice,businessPrice,economyAvailable,businessAvailable) VALUES (31,'SV031',1,101,21,22,'2026-11-05 10:00:00','2026-11-05 12:00:00',100,10,20000,40000,100,10)"
      );
      state.send.mockReset().mockResolvedValue(true);
    });
    afterAll(async () => {
      state.db = null;
      await pool?.end();
      if (admin) {
        if (databaseCreated) await admin.query("DROP DATABASE " + databaseName);
        await admin.end();
      }
    });

    it("preserves the successful passenger receipt while retrying only a failed provider acceptance", async () => {
      const event = flightNotificationEvent();
      state.send.mockImplementation(
        async data => data.passengerEmail !== "second@example.test"
      );
      await expect(deliverFlightStatusEmails(event)).rejects.toThrow(
        "Flight email delivery incomplete"
      );
      expect(await receipts()).toMatchObject([
        { consumer: "flight-email:11", status: "processed", attempts: 1 },
        {
          consumer: "flight-email:12",
          status: "failed",
          attempts: 1,
          processedAt: null,
        },
      ]);
      state.send.mockResolvedValue(true);
      await deliverFlightStatusEmails(event);
      await deliverFlightStatusEmails(event);
      expect(state.send).toHaveBeenCalledTimes(3);
      expect(
        state.send.mock.calls.filter(
          ([data]) => data.passengerEmail === "first@example.test"
        )
      ).toHaveLength(1);
      expect(
        state.send.mock.calls
          .filter(([data]) => data.passengerEmail === "second@example.test")
          .map(([data]) => data.idempotencyKey)
      ).toEqual([
        `${event.eventId}:flight-email:12`,
        `${event.eventId}:flight-email:12`,
      ]);
      expect(await receipts()).toMatchObject([
        { status: "processed", attempts: 1 },
        { status: "processed", attempts: 2, lastError: null },
      ]);
    });

    it("excludes a simultaneous consumer while the native receipt has an active lease", async () => {
      let release!: (accepted: boolean) => void;
      state.send.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      );
      const event = flightNotificationEvent([11]);
      const pending = deliverFlightStatusEmails(event);
      try {
        await vi.waitFor(() => expect(state.send).toHaveBeenCalledOnce());
        expect(await receipts()).toMatchObject([
          { status: "processing", attempts: 1, processedAt: null },
        ]);
        await expect(deliverFlightStatusEmails(event)).rejects.toThrow(
          "Flight email delivery incomplete"
        );
        expect(state.send).toHaveBeenCalledOnce();
      } finally {
        release?.(true);
        await pending;
      }
      await deliverFlightStatusEmails(event);
      expect(state.send).toHaveBeenCalledOnce();
      expect(await receipts()).toMatchObject([
        { status: "processed", attempts: 1, leaseToken: null },
      ]);
    });

    it.each([101, null])(
      "does not send another tenant's booking for event scope %s",
      async tenantId => {
        await pool!.query("UPDATE bookings SET tenantId=202 WHERE id=11");
        await expect(
          deliverFlightStatusEmails(flightNotificationEvent([11], tenantId))
        ).rejects.toThrow("Flight email delivery incomplete");
        expect(state.send).not.toHaveBeenCalled();
        expect(await receipts()).toMatchObject([
          { status: "failed", processedAt: null },
        ]);
      }
    );

    it("does not combine a matching booking with a foreign tenant flight", async () => {
      await pool!.query("UPDATE flights SET tenantId=202 WHERE id=31");
      await expect(
        deliverFlightStatusEmails(flightNotificationEvent([11]))
      ).rejects.toThrow("Flight email delivery incomplete");
      expect(state.send).not.toHaveBeenCalled();
      expect(await receipts()).toMatchObject([
        { status: "failed", processedAt: null },
      ]);
    });

    it("supports a legacy public booking only with a public source flight", async () => {
      await pool!.query("UPDATE bookings SET tenantId=NULL WHERE id=11");
      await pool!.query("UPDATE flights SET tenantId=NULL WHERE id=31");
      const event = flightNotificationEvent([11], null);
      await deliverFlightStatusEmails(event);
      await deliverFlightStatusEmails(event);
      expect(state.send).toHaveBeenCalledOnce();
      expect(await receipts()).toMatchObject([
        { status: "processed", attempts: 1 },
      ]);
    });

    it("rejects identity reuse with changed event contents and retains the original acceptance", async () => {
      const event = flightNotificationEvent([11]);
      await deliverFlightStatusEmails(event);
      await expect(
        deliverFlightStatusEmails({
          ...event,
          payload: { ...event.payload, reason: "changed payload" },
        })
      ).rejects.toThrow("Flight email delivery incomplete");
      expect(state.send).toHaveBeenCalledOnce();
      expect(await receipts()).toMatchObject([
        { status: "processed", attempts: 1 },
      ]);
    });
  }
);
