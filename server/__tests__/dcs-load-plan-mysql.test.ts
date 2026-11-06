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

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  approveLoadPlan,
  createLoadPlan,
  finalizeLoadPlan,
  getLoadPlan,
} from "../services/dcs.service";

const tables = [
  schema.flights,
  schema.aircraftTypes,
  schema.bookings,
  schema.bookingSegments,
  schema.passengers,
  schema.baggageItems,
  schema.baggageCustodyEvents,
  schema.loadPlans,
];
const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;
const input = { flightId: 11, aircraftTypeId: 1, fuelWeight: 1000 };
const transition = (action: "approve" | "finalize", id: number, actorId = 9) =>
  action === "approve"
    ? approveLoadPlan(id, actorId)
    : finalizeLoadPlan(id, actorId);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

// This barrier pauses a real SQL statement, not a mocked transaction or row.
// A contender must be observed waiting on the actual MySQL flight-row lock.
function holdStatement(connection: mysql.Connection, match: RegExp) {
  const entered = deferred();
  const released = deferred();
  const query = connection.query.bind(connection);
  let held = false;
  const spy = vi.spyOn(connection, "query").mockImplementation((async (
    ...args: Parameters<typeof connection.query>
  ) => {
    const statement = args[0];
    const text = typeof statement === "string" ? statement : statement.sql;
    if (!held && match.test(text)) {
      held = true;
      entered.resolve();
      await released.promise;
    }
    return query(...args);
  }) as typeof connection.query);
  return {
    entered: entered.promise,
    release: released.resolve,
    restore: () => spy.mockRestore(),
  };
}

nativeDescribe(
  "local simulated DCS load readiness on disposable native MySQL",
  () => {
    let admin: mysql.Connection | null = null;
    let pool: mysql.Pool | null = null;
    let db: MySql2Database<typeof schema>;
    let databaseName = "";
    let created = false;

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = url.pathname.slice(1);
      if (
        !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "Load-plan acceptance requires a loopback disposable _test database"
        );
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName = "ais_dcs_load_" + randomBytes(6).toString("hex");
      if (!/^ais_dcs_load_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid load-plan fixture identity");
      admin = await mysql.createConnection(options);
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      // Migrated native types/defaults/indexes, isolated from all source rows.
      // MySQL LIKE omits foreign keys; those remain a separate migration gate.
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid fixture table");
        await admin.query(
          `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
        );
      }
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 4,
      });
      db = drizzle(pool, { schema, mode: "default" });
      state.db = db;
      const [mode] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT @@SESSION.sql_mode AS sqlMode"
      );
      expect(String(mode[0]?.sqlMode)).toContain("STRICT_TRANS_TABLES");
      const [engines] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=?",
        [databaseName]
      );
      expect(engines).toHaveLength(tables.length);
      expect(engines.every(row => row.ENGINE === "InnoDB")).toBe(true);
    }, 60000);

    afterAll(async () => {
      state.db = null;
      if (pool) await pool.end();
      if (admin) {
        try {
          if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await admin.end();
        }
      }
    });

    beforeEach(async () => {
      // Opt into the local simulator only. No operator-approved aircraft data or
      // dispatch authority is represented by these synthetic fixtures.
      vi.stubEnv("AIS_ENABLE_DEMOS", "true");
      state.db = db;
      for (const table of tables)
        await pool!.query(`TRUNCATE TABLE \`${getTableName(table)}\``);
      await db.insert(schema.aircraftTypes).values({
        id: 1,
        code: "SYN",
        name: "Synthetic training aircraft",
        manufacturer: "Synthetic",
        operatingEmptyWeight: 10000,
        maxTakeoffWeight: 15000,
        maxLandingWeight: 14000,
        maxZeroFuelWeight: 13000,
        maxPayload: 3000,
        maxFuelCapacity: 2000,
        totalSeats: 4,
        economySeats: 4,
        businessSeats: 0,
        forwardCgLimit: "15",
        aftCgLimit: "35",
        active: true,
        cargoZones: '[{"zone":"FWD","maxWeight":2000}]',
      });
      await db.insert(schema.flights).values(
        [11, 12].map(id => ({
          id,
          tenantId: 1,
          airlineId: 1,
          flightNumber: `SYN${id}`,
          originId: id === 11 ? 1 : 2,
          destinationId: id === 11 ? 2 : 3,
          departureTime: new Date("2030-11-21T12:00:00Z"),
          arrivalTime: new Date("2030-11-21T14:00:00Z"),
          aircraftType: "SYN",
          aircraftRegistrationId: null,
          status: "scheduled" as const,
          economySeats: 4,
          economyAvailable: 3,
          economyPrice: 10000,
          businessSeats: 0,
          businessAvailable: 0,
          businessPrice: 20000,
        }))
      );
      await db.insert(schema.bookings).values({
        id: 3,
        userId: 7,
        tenantId: 1,
        flightId: 11,
        bookingReference: "L00003",
        pnr: "L00003",
        cabinClass: "economy",
        numberOfPassengers: 1,
        totalAmount: 10000,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
      });
      await db.insert(schema.passengers).values({
        id: 4,
        bookingId: 3,
        tenantId: 1,
        firstName: "Synthetic",
        lastName: "Traveler",
        type: "adult",
      });
      await db.insert(schema.baggageItems).values({
        id: 5,
        bookingId: 3,
        passengerId: 4,
        tagNumber: "0123000005",
        weight: "20.00",
        status: "checked_in",
        flightId: null,
        segmentId: null,
      });
    }, 30000);

    afterEach(() => {
      state.db = db;
      vi.unstubAllEnvs();
    });

    async function storedPlan(id: number) {
      const [plan] = await db
        .select()
        .from(schema.loadPlans)
        .where(eq(schema.loadPlans.id, id));
      expect(plan).toBeDefined();
      return plan;
    }

    async function waitForFlightLock(
      waitingConnection: mysql.Connection,
      blockingConnection: mysql.Connection,
      settled: () => boolean
    ) {
      const deadline = performance.now() + 5000;
      while (!settled() && performance.now() < deadline) {
        const [waits] = await admin!.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) AS count
         FROM performance_schema.data_lock_waits AS waits
         JOIN performance_schema.data_locks AS locks
           ON locks.ENGINE = waits.ENGINE
          AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
         JOIN performance_schema.threads AS requester
           ON requester.THREAD_ID = waits.REQUESTING_THREAD_ID
         JOIN performance_schema.threads AS blocker
           ON blocker.THREAD_ID = waits.BLOCKING_THREAD_ID
         WHERE locks.OBJECT_SCHEMA = ? AND locks.OBJECT_NAME = 'flights'
           AND requester.PROCESSLIST_ID = ? AND blocker.PROCESSLIST_ID = ?`,
          [
            databaseName,
            waitingConnection.threadId,
            blockingConnection.threadId,
          ]
        );
        if (Number(waits[0]?.count) > 0) return true;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return false;
    }

    it("approves and finalizes a fresh native calculation without rewriting replay actors or timestamps", async () => {
      const fresh = await createLoadPlan(input);
      expect(fresh.weights.passengers).toEqual({ count: 1, weight: 84 });
      expect(fresh.weights.baggage).toEqual({ count: 1, weight: 20 });
      expect(fresh.safety.withinLimits).toBe(true);
      await approveLoadPlan(fresh.id, 9);
      const approved = await storedPlan(fresh.id);
      expect(approved).toMatchObject({ status: "approved", approvedBy: 9 });
      expect(approved.approvedAt).toBeInstanceOf(Date);
      await expect(approveLoadPlan(fresh.id, 10)).resolves.toEqual({
        success: true,
      });
      expect(await storedPlan(fresh.id)).toEqual(approved);
      await finalizeLoadPlan(fresh.id, 9);
      const finalized = await storedPlan(fresh.id);
      expect(finalized).toMatchObject({
        status: "finalized",
        approvedBy: 9,
        finalizedBy: 9,
      });
      expect(finalized.finalizedAt).toBeInstanceOf(Date);
      await expect(finalizeLoadPlan(fresh.id, 10)).resolves.toEqual({
        success: true,
      });
      expect(await storedPlan(fresh.id)).toEqual(finalized);
      await expect(approveLoadPlan(fresh.id, 10)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await storedPlan(fresh.id)).toEqual(finalized);
    });

    it.each(["passenger", "baggage"] as const)(
      "rejects a late %s change without mutating the stale plan, then permits a fresh edition",
      async source => {
        const old = await createLoadPlan(input);
        const before = await storedPlan(old.id);
        if (source === "passenger")
          await db.insert(schema.passengers).values({
            id: 6,
            bookingId: 3,
            tenantId: 1,
            firstName: "Synthetic",
            lastName: "Child",
            type: "child",
          });
        else
          await db
            .update(schema.baggageItems)
            .set({ weight: "30.00" })
            .where(eq(schema.baggageItems.id, 5));
        await expect(approveLoadPlan(old.id, 9)).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining("inputs changed"),
        });
        expect(await storedPlan(old.id)).toEqual(before);
        const fresh = await createLoadPlan(input);
        if (source === "passenger")
          expect(fresh.weights.passengers).toEqual({ count: 2, weight: 119 });
        else expect(fresh.weights.baggage).toEqual({ count: 1, weight: 30 });
        await expect(approveLoadPlan(fresh.id, 9)).resolves.toEqual({
          success: true,
        });
        await expect(finalizeLoadPlan(fresh.id, 9)).resolves.toEqual({
          success: true,
        });
        expect(await storedPlan(old.id)).toEqual(before);
      }
    );

    it("refuses stale finalization after baggage changes following approval", async () => {
      const fresh = await createLoadPlan(input);
      await approveLoadPlan(fresh.id, 9);
      const before = await storedPlan(fresh.id);
      await db
        .update(schema.baggageItems)
        .set({ weight: "30.00" })
        .where(eq(schema.baggageItems.id, 5));
      await expect(finalizeLoadPlan(fresh.id, 10)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("inputs changed"),
      });
      expect(await storedPlan(fresh.id)).toEqual(before);
    });

    it("rechecks current aircraft limits instead of trusting a saved withinLimits flag", async () => {
      const fresh = await createLoadPlan(input);
      const before = await storedPlan(fresh.id);
      expect(before.withinLimits).toBe(true);
      await db
        .update(schema.aircraftTypes)
        .set({ maxTakeoffWeight: 10000 })
        .where(eq(schema.aircraftTypes.id, 1));
      await expect(approveLoadPlan(fresh.id, 9)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Current load exceeds"),
      });
      expect(await storedPlan(fresh.id)).toEqual(before);
    });

    it("selects the latest native ID when calculation timestamps tie and rejects the older plan", async () => {
      const first = await createLoadPlan(input);
      await approveLoadPlan(first.id, 9);
      const second = await createLoadPlan({ ...input, fuelWeight: 900 });
      await db
        .update(schema.loadPlans)
        .set({ createdAt: new Date("2030-11-20T12:00:00Z") })
        .where(eq(schema.loadPlans.flightId, 11));
      const before = await storedPlan(first.id);
      expect((await getLoadPlan(11))?.id).toBe(second.id);
      await expect(approveLoadPlan(first.id, 10)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("newer load calculation"),
      });
      await expect(finalizeLoadPlan(first.id, 10)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("newer load calculation"),
      });
      expect(await storedPlan(first.id)).toEqual(before);
      await expect(approveLoadPlan(second.id, 10)).resolves.toEqual({
        success: true,
      });
    });

    it("uses current sector membership for passengers and exact-sector baggage rather than the historical primary flight", async () => {
      await db.insert(schema.bookingSegments).values([
        {
          id: 30,
          bookingId: 3,
          flightId: 11,
          segmentOrder: 1,
          departureDate: new Date("2030-11-21T12:00:00Z"),
          status: "cancelled",
          seatsReserved: false,
        },
        {
          id: 31,
          bookingId: 3,
          flightId: 12,
          segmentOrder: 2,
          departureDate: new Date("2030-11-21T12:00:00Z"),
          status: "confirmed",
          seatsReserved: true,
        },
      ]);
      await db
        .update(schema.baggageItems)
        .set({ flightId: 12, segmentId: 31 })
        .where(eq(schema.baggageItems.id, 5));
      const historical = await createLoadPlan(input);
      expect(historical.weights.passengers).toEqual({ count: 0, weight: 0 });
      expect(historical.weights.baggage).toEqual({ count: 0, weight: 0 });
      const onward = await createLoadPlan({ ...input, flightId: 12 });
      expect(onward.weights.passengers).toEqual({ count: 1, weight: 84 });
      expect(onward.weights.baggage).toEqual({ count: 1, weight: 20 });
      await expect(approveLoadPlan(onward.id, 9)).resolves.toEqual({
        success: true,
      });
      const before = await storedPlan(onward.id);
      await db
        .update(schema.bookingSegments)
        .set({ status: "cancelled", seatsReserved: false })
        .where(eq(schema.bookingSegments.id, 31));
      await expect(finalizeLoadPlan(onward.id, 9)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("inputs changed"),
      });
      expect(await storedPlan(onward.id)).toEqual(before);
    });

    it.each(["approve", "finalize"] as const)(
      "waits for a competing calculation to publish, then rejects %s of the previous plan",
      async action => {
        const old = await createLoadPlan(input);
        if (action === "finalize") await approveLoadPlan(old.id, 9);
        const before = await storedPlan(old.id);
        const publisher = await pool!.getConnection();
        const reviewer = await pool!.getConnection();
        const gate = holdStatement(publisher, /^insert into `load_plans`/i);
        state.db = drizzle(publisher, { schema, mode: "default" });
        const publishing = createLoadPlan({ ...input, fuelWeight: 900 });
        let reviewing: Promise<{ success: boolean }> | undefined;
        let reviewSettled = false;
        try {
          await Promise.race([
            gate.entered,
            publishing.then(() => {
              throw new Error("Calculation did not reach its insert barrier");
            }),
          ]);
          state.db = drizzle(reviewer, { schema, mode: "default" });
          reviewing = transition(action, old.id, 10);
          const outcome = reviewing.then(
            value => {
              reviewSettled = true;
              return { value };
            },
            error => {
              reviewSettled = true;
              return { error };
            }
          );
          expect(
            await waitForFlightLock(reviewer, publisher, () => reviewSettled),
            "Reviewer must wait on the publisher's flight lock"
          ).toBe(true);
          expect(reviewSettled).toBe(false);
          gate.release();
          const fresh = await publishing;
          expect(await outcome).toMatchObject({
            error: {
              code: "CONFLICT",
              message: expect.stringContaining("newer load calculation"),
            },
          });
          expect(await storedPlan(old.id)).toEqual(before);
          expect(await storedPlan(fresh.id)).toMatchObject({
            status: "calculated",
            approvedBy: null,
            finalizedBy: null,
          });
        } finally {
          gate.release();
          await publishing.catch(() => undefined);
          await reviewing?.catch(() => undefined);
          gate.restore();
          state.db = db;
          publisher.release();
          reviewer.release();
        }
      },
      15000
    );

    it.each(["approve", "finalize"] as const)(
      "holds the flight lock through %s so a competing calculation cannot publish mid-transition",
      async action => {
        const old = await createLoadPlan(input);
        if (action === "finalize") await approveLoadPlan(old.id, 9);
        const reviewer = await pool!.getConnection();
        const publisher = await pool!.getConnection();
        const gate = holdStatement(reviewer, /^update `load_plans` set /i);
        state.db = drizzle(reviewer, { schema, mode: "default" });
        const reviewing = transition(action, old.id, 10);
        let publishing: ReturnType<typeof createLoadPlan> | undefined;
        let publishSettled = false;
        try {
          await Promise.race([
            gate.entered,
            reviewing.then(() => {
              throw new Error("Review did not reach its update barrier");
            }),
          ]);
          state.db = drizzle(publisher, { schema, mode: "default" });
          publishing = createLoadPlan({ ...input, fuelWeight: 900 });
          const outcome = publishing.then(
            value => {
              publishSettled = true;
              return { value };
            },
            error => {
              publishSettled = true;
              return { error };
            }
          );
          expect(
            await waitForFlightLock(publisher, reviewer, () => publishSettled),
            "Publisher must wait on the reviewer's flight lock"
          ).toBe(true);
          expect(publishSettled).toBe(false);
          gate.release();
          await expect(reviewing).resolves.toEqual({ success: true });
          const fresh = await publishing;
          await expect(outcome).resolves.toMatchObject({
            value: { id: fresh.id },
          });
          const completed = await storedPlan(old.id);
          expect(completed).toMatchObject(
            action === "approve"
              ? { status: "approved", approvedBy: 10, finalizedBy: null }
              : { status: "finalized", approvedBy: 9, finalizedBy: 10 }
          );
          state.db = db;
          expect((await getLoadPlan(11))?.id).toBe(fresh.id);
          await expect(transition(action, old.id, 9)).rejects.toMatchObject({
            code: "CONFLICT",
            message: expect.stringContaining("newer load calculation"),
          });
          expect(await storedPlan(old.id)).toEqual(completed);
          expect(await storedPlan(fresh.id)).toMatchObject({
            status: "calculated",
            approvedBy: null,
            finalizedBy: null,
          });
        } finally {
          gate.release();
          await reviewing.catch(() => undefined);
          await publishing?.catch(() => undefined);
          gate.restore();
          state.db = db;
          reviewer.release();
          publisher.release();
        }
      },
      15000
    );

    it("refuses the legacy simulation path after a controlled registration is assigned", async () => {
      const fresh = await createLoadPlan(input);
      const before = await storedPlan(fresh.id);
      await db
        .update(schema.flights)
        .set({ aircraftRegistrationId: 42 })
        .where(eq(schema.flights.id, 11));
      await expect(approveLoadPlan(fresh.id, 9)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("separate dispatch acceptance"),
      });
      await expect(createLoadPlan(input)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await storedPlan(fresh.id)).toEqual(before);
      expect(await db.select().from(schema.loadPlans)).toHaveLength(1);
    });

    it("keeps all simulation entry points disabled in production even with the demo opt-in", async () => {
      const fresh = await createLoadPlan(input);
      const before = await storedPlan(fresh.id);
      vi.stubEnv("NODE_ENV", "production");
      await expect(createLoadPlan(input)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(approveLoadPlan(fresh.id, 9)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(finalizeLoadPlan(fresh.id, 9)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(getLoadPlan(11)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await storedPlan(fresh.id)).toEqual(before);
      expect(await db.select().from(schema.loadPlans)).toHaveLength(1);
    });
  }
);
