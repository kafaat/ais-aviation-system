import { randomBytes } from "node:crypto";
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
import {
  updateBaggageStatus,
  reportLostBaggage,
  markBaggageFound,
} from "../services/baggage.service";
import {
  bulkUpdateServiceStatus,
  updateServiceStatus,
} from "../services/special-services.service";
import { validateAPISData } from "../services/apis.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;
const tables = [
  "baggage_items",
  "baggage_tracking",
  "bookings",
  "passengers",
  "booking_segments",
  "flights",
  "special_services",
  "apis_data",
];

/** Real InnoDB transaction acceptance. Tables retain the migration-verified
 * columns/indexes; CREATE TABLE LIKE does not copy foreign keys or triggers.
 * Injected triggers below test failure atomicity, not operator/device acceptance. */
nativeDescribe.sequential(
  "reviewed operations on disposable native MySQL",
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
      databaseName = "ais_operations_review_" + randomBytes(6).toString("hex");
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      for (const table of tables)
        await admin.query(
          `CREATE TABLE \`${databaseName}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``
        );
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 5,
      });
      state.db = drizzle(pool, { schema, mode: "default" });
    }, 30000);
    beforeEach(async () => {
      await pool!.query("DROP TRIGGER IF EXISTS fail_baggage_history");
      await pool!.query("DROP TRIGGER IF EXISTS fail_second_service");
      for (const table of tables) await pool!.query(`DELETE FROM \`${table}\``);
    });
    afterEach(() => vi.useRealTimers());
    afterAll(async () => {
      try {
        await pool?.end();
      } finally {
        try {
          if (created) await admin?.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await admin?.end();
          state.db = null;
        }
      }
    });

    const baggageCommands = [
      {
        name: "scan",
        before: "checked_in" as const,
        after: "security_screening",
        run: () =>
          updateBaggageStatus({
            tagNumber: "0650000001",
            location: "Screening",
            status: "security_screening",
          }),
      },
      {
        name: "lost report",
        before: "checked_in" as const,
        after: "lost",
        run: () =>
          reportLostBaggage({
            tagNumber: "0650000001",
            description: "Synthetic missing baggage",
          }),
      },
      {
        name: "found report",
        before: "lost" as const,
        after: "found",
        run: () =>
          markBaggageFound({ tagNumber: "0650000001", foundLocation: "Store" }),
      },
    ];
    for (const command of baggageCommands) {
      it(`rolls back ${command.name} when native history insertion fails, then retries once`, async () => {
        await state.db!.insert(schema.baggageItems).values({
          id: 1,
          bookingId: 1,
          passengerId: 1,
          tagNumber: "0650000001",
          weight: "10.00",
          status: command.before,
          lastLocation: "Counter",
        });
        const [before] = await state.db!.select().from(schema.baggageItems);
        await pool!.query(
          "CREATE TRIGGER fail_baggage_history BEFORE INSERT ON baggage_tracking FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected native history failure'"
        );
        await expect(command.run()).rejects.toThrow();
        expect(await state.db!.select().from(schema.baggageItems)).toEqual([
          before,
        ]);
        expect(
          await state.db!.select().from(schema.baggageTracking)
        ).toHaveLength(0);
        await pool!.query("DROP TRIGGER fail_baggage_history");
        await command.run();
        expect(
          (await state.db!.select().from(schema.baggageItems))[0].status
        ).toBe(command.after);
        const history = await state.db!.select().from(schema.baggageTracking);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
          baggageId: 1,
          status: command.after,
        });
      });
      it(`keeps signed handback unchanged during ${command.name}`, async () => {
        await state.db!.insert(schema.baggageItems).values({
          id: 1,
          bookingId: 1,
          passengerId: 1,
          tagNumber: "0650000001",
          weight: "10.00",
          status: command.before,
          returnEventId: 9,
          returnEvidenceId: 10,
        });
        const [before] = await state.db!.select().from(schema.baggageItems);
        await expect(command.run()).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await state.db!.select().from(schema.baggageItems)).toEqual([
          before,
        ]);
        expect(
          await state.db!.select().from(schema.baggageTracking)
        ).toHaveLength(0);
      });
    }

    async function seedServices(secondPassenger = false) {
      const departureTime = new Date(Date.now() + 86400000);
      await state.db!.insert(schema.flights).values({
        id: 3,
        flightNumber: "SSR3",
        airlineId: 1,
        originId: 1,
        destinationId: 2,
        departureTime,
        arrivalTime: new Date(Date.now() + 90000000),
        economySeats: 100,
        businessSeats: 10,
        economyAvailable: 100,
        businessAvailable: 10,
        economyPrice: 10000,
        businessPrice: 20000,
      });
      await state.db!.insert(schema.bookings).values({
        id: 1,
        userId: 1,
        flightId: 3,
        bookingReference: "SSR001",
        pnr: "SSR001",
        status: "confirmed",
        totalAmount: 10000,
        cabinClass: "economy",
      });
      await state.db!.insert(schema.passengers).values([
        { id: 1, bookingId: 1, firstName: "Synthetic", lastName: "One" },
        { id: 2, bookingId: 1, firstName: "Synthetic", lastName: "Two" },
      ]);
      await state.db!.insert(schema.bookingSegments).values({
        id: 2,
        bookingId: 1,
        flightId: 3,
        segmentOrder: 1,
        departureDate: departureTime,
        status: "confirmed",
      });
      await state.db!.insert(schema.specialServices).values(
        [1, 2].map(id => ({
          id,
          bookingId: 1,
          passengerId: secondPassenger ? id : 1,
          flightId: 3,
          bookingSegmentId: 2,
          serviceType: "meal" as const,
          serviceCode: "VGML",
          status: "cancelled" as const,
        }))
      );
    }

    it("serializes competing SSR reactivations after both wait on the itinerary lock", async () => {
      await seedServices();
      const blocker = await pool!.getConnection();
      let results:
        Promise<PromiseSettledResult<{ success: boolean }>[]> | undefined;
      let observed = false;
      try {
        await blocker.beginTransaction();
        await blocker.query("SELECT id FROM bookings WHERE id=1 FOR UPDATE");
        results = Promise.allSettled([
          updateServiceStatus(1, "confirmed"),
          updateServiceStatus(2, "confirmed"),
        ]);
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const [rows] = await admin!.query<mysql.RowDataPacket[]>(
            "SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='bookings'",
            [databaseName]
          );
          if (Number(rows[0]?.waiting) >= 2) {
            observed = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      } finally {
        await blocker.rollback();
        blocker.release();
        await results;
      }
      expect(
        observed,
        "Both service writers must actually wait on InnoDB"
      ).toBe(true);
      const outcomes = await results!;
      expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(r => r.status === "rejected")).toHaveLength(1);
      expect(outcomes.find(r => r.status === "rejected")).toMatchObject({
        reason: { code: "BAD_REQUEST" },
      });
      expect(
        (await state.db!.select().from(schema.specialServices))
          .map(r => r.status)
          .sort()
      ).toEqual(["cancelled", "confirmed"]);
    }, 15000);

    it("rolls back the first SSR activation when a duplicate later in the batch is rejected", async () => {
      await seedServices();
      await expect(
        bulkUpdateServiceStatus([1, 2], "confirmed")
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (await state.db!.select().from(schema.specialServices)).map(
          r => r.status
        )
      ).toEqual(["cancelled", "cancelled"]);
    });

    it("rolls back the entire SSR batch after a native second-row write failure", async () => {
      await seedServices(true);
      await pool!.query(
        "CREATE TRIGGER fail_second_service BEFORE UPDATE ON special_services FOR EACH ROW BEGIN IF NEW.id = 2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Injected second service failure'; END IF; END"
      );
      await expect(
        bulkUpdateServiceStatus([1, 2], "confirmed")
      ).rejects.toThrow();
      expect(
        (await state.db!.select().from(schema.specialServices)).map(
          r => r.status
        )
      ).toEqual(["cancelled", "cancelled"]);
      await pool!.query("DROP TRIGGER fail_second_service");
      expect(
        await bulkUpdateServiceStatus([1, 2, 2, 999], "confirmed")
      ).toEqual({ success: true, updated: 2 });
    });

    it("withdraws expired unchanged APIS validation while retaining historical submission evidence", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
      await pool!.query(
        "INSERT INTO apis_data (passenger_id,booking_id,document_type,document_number,issuing_country,nationality,date_of_birth,gender,expiry_date,given_names,surname,status,submitted_at) VALUES (1,1,'passport','ABC12345','SA','SA','1990-01-01','M','2030-01-02','Synthetic','Passenger','complete','2029-12-31 12:00:00')"
      );
      expect(await validateAPISData(1)).toMatchObject({
        valid: true,
        status: "validated",
      });
      const [initial] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT * FROM apis_data WHERE passenger_id=1"
      );
      expect(initial[0].validated_at).not.toBeNull();
      vi.setSystemTime(new Date("2030-01-02T12:00:00Z"));
      expect(await validateAPISData(1)).toMatchObject({
        valid: false,
        status: "complete",
        validatedAt: null,
      });
      const [final] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT * FROM apis_data WHERE passenger_id=1"
      );
      expect(final[0]).toMatchObject({
        status: "complete",
        validated_at: null,
        document_number: initial[0].document_number,
      });
      expect(final[0].submitted_at).toEqual(initial[0].submitted_at);
    });
  }
);
