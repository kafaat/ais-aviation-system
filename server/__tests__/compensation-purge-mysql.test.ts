import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { getTableName } from "drizzle-orm";
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
import { createClaim } from "../services/compensation.service";
import { purgeDeletedBookings } from "../services/soft-delete.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

// Pause immediately before a real SQL statement. Queries, transactions and
// native locks still run on MySQL; the gate only controls the competing order.
function holdStatement(connection: mysql.Connection, match: RegExp) {
  const entered = deferred();
  const released = deferred();
  const query = connection.query.bind(connection);
  const spy = vi.spyOn(connection, "query").mockImplementation((async (
    ...args: Parameters<typeof connection.query>
  ) => {
    const statement = args[0];
    const sql = typeof statement === "string" ? statement : statement.sql;
    if (match.test(sql)) {
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

nativeDescribe.sequential(
  "compensation filing against native MySQL booking purge",
  () => {
    let admin: mysql.Connection | undefined;
    let claimant: mysql.Connection | undefined;
    let purger: mysql.Connection | undefined;
    let claimDb: MySql2Database<typeof schema>;
    let purgeDb: MySql2Database<typeof schema>;
    let databaseName = "";
    let created = false;
    const tables = [
      schema.bookings,
      schema.passengers,
      schema.bookingSegments,
      ...retainedPurgeSources.map(source => source.table),
    ];
    const filing = {
      bookingId: 1,
      userId: 101,
      regulationType: "local" as const,
      claimType: "delay" as const,
    };

    beforeAll(async () => {
      const source = new URL(process.env.DATABASE_URL!);
      const sourceDatabase = source.pathname.slice(1);
      if (
        source.protocol !== "mysql:" ||
        !/^ais_[a-z0-9_]*test$/.test(sourceDatabase) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname)
      )
        throw new Error(
          "Native compensation acceptance requires a loopback disposable ais_*test source"
        );
      const options = {
        host: source.hostname.replace(/^\[|\]$/g, ""),
        port: Number(source.port || 3306),
        user: decodeURIComponent(source.username),
        password: decodeURIComponent(source.password),
        timezone: "Z",
      };
      databaseName = "ais_claim_purge_" + randomBytes(6).toString("hex");
      if (!/^ais_claim_purge_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid owned compensation schema name");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      created = true;
      claimant = await mysql.createConnection({
        ...options,
        database: databaseName,
      });
      purger = await mysql.createConnection({
        ...options,
        database: databaseName,
      });
      for (const connection of [claimant, purger]) {
        await connection.query("SET SESSION time_zone = '+00:00'");
        await connection.query("SET SESSION innodb_lock_wait_timeout = 10");
      }
      // Copy the migration-verified structure and indexes, never source data.
      // LIKE omits foreign keys: the race must be prevented by the writer's
      // parent lock and the purge guard, not by an incidental constraint.
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name))
          throw new Error("Invalid fixture table name");
        await claimant.query(
          `CREATE TABLE \`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
        );
      }
      claimDb = drizzle(claimant, { schema, mode: "default" });
      purgeDb = drizzle(purger, { schema, mode: "default" });
    }, 40_000);

    beforeEach(async () => {
      state.db = claimDb;
      for (const table of [...tables].reverse())
        await claimant!.query(`DELETE FROM \`${getTableName(table)}\``);
      await claimDb.insert(schema.bookings).values({
        id: 1,
        userId: 101,
        flightId: 201,
        bookingReference: "C00001",
        pnr: "C00001",
        status: "cancelled",
        totalAmount: 12_000,
        cabinClass: "economy",
        deletedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      });
      await claimDb.insert(schema.passengers).values({
        id: 10,
        bookingId: 1,
        firstName: "Synthetic",
        lastName: "Compensation Fixture",
      });
    });

    afterAll(async () => {
      state.db = null;
      try {
        await Promise.allSettled([claimant?.end(), purger?.end()]);
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

    async function waitForBookingWaiter() {
      // Observe an actual InnoDB lock wait rather than infer contention from a
      // timer or a promise that has not settled. Only this owned schema counts.
      const deadline = performance.now() + 5_000;
      let actual = 0;
      do {
        const [rows] = await admin!.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(DISTINCT waits.REQUESTING_THREAD_ID) AS count
           FROM performance_schema.data_lock_waits AS waits
           JOIN performance_schema.data_locks AS locks
             ON locks.ENGINE = waits.ENGINE
            AND locks.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
          WHERE locks.OBJECT_SCHEMA = ? AND locks.OBJECT_NAME = 'bookings'`,
          [databaseName]
        );
        actual = Number(rows[0].count);
        if (actual === 1) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      } while (performance.now() < deadline);
      expect(actual, "one native contender waiting on the owned booking").toBe(
        1
      );
    }

    async function remaining() {
      return {
        bookings: await claimDb
          .select({ id: schema.bookings.id })
          .from(schema.bookings),
        passengers: await claimDb
          .select({ id: schema.passengers.id })
          .from(schema.passengers),
        claims: await claimDb.select().from(schema.compensationClaims),
      };
    }

    it("makes purge wait for a claim holding the parent lock, then preserves its new evidence", async () => {
      const gate = holdStatement(
        claimant!,
        /^insert into `compensation_claims`/i
      );
      const filingResult = createClaim(filing);
      let purgeResult: Promise<{ purgedCount: number }> | undefined;
      try {
        await Promise.race([
          gate.entered,
          filingResult.then(() => {
            throw new Error("Claim did not reach insertion gate");
          }),
        ]);
        state.db = purgeDb;
        purgeResult = purgeDeletedBookings(90);
        await waitForBookingWaiter();
        gate.release();
        await expect(filingResult).resolves.toMatchObject({
          bookingId: 1,
          passengerId: 10,
          status: "under_review",
        });
        await expect(purgeResult).resolves.toEqual({ purgedCount: 0 });
        expect(await remaining()).toMatchObject({
          bookings: [{ id: 1 }],
          passengers: [{ id: 10 }],
          claims: [{ bookingId: 1, passengerId: 10, calculatedAmount: null }],
        });
      } finally {
        gate.release();
        await Promise.allSettled([filingResult, purgeResult]);
        gate.restore();
      }
    }, 15_000);

    it("makes a claim wait for purge, then rejects the deleted owner without inserting an orphan", async () => {
      const gate = holdStatement(purger!, /^delete from `passengers`/i);
      state.db = purgeDb;
      const purgeResult = purgeDeletedBookings(90);
      let filingResult: ReturnType<typeof createClaim> | undefined;
      try {
        await Promise.race([
          gate.entered,
          purgeResult.then(() => {
            throw new Error("Purge did not reach deletion gate");
          }),
        ]);
        state.db = claimDb;
        filingResult = createClaim(filing);
        // Observe both outcomes immediately so cleanup remains safe on regressions.
        const outcome = filingResult.then(
          value => ({ value }),
          error => ({ error })
        );
        await waitForBookingWaiter();
        gate.release();
        await expect(purgeResult).resolves.toEqual({ purgedCount: 1 });
        expect(await outcome).toMatchObject({ error: { code: "NOT_FOUND" } });
        expect(await remaining()).toEqual({
          bookings: [],
          passengers: [],
          claims: [],
        });
      } finally {
        gate.release();
        await Promise.allSettled([filingResult, purgeResult]);
        gate.restore();
      }
    }, 15_000);

    it("rolls back an inserted claim on readback failure and releases the parent for a later purge", async () => {
      const query = claimant!.query.bind(claimant!);
      let readbackFailed = false;
      const spy = vi.spyOn(claimant!, "query").mockImplementation((async (
        ...args: Parameters<mysql.Connection["query"]>
      ) => {
        const statement = args[0];
        const sql = typeof statement === "string" ? statement : statement.sql;
        if (/^select .* from `compensation_claims`/i.test(sql)) {
          readbackFailed = true;
          throw new Error("synthetic claim readback failure");
        }
        return query(...args);
      }) as mysql.Connection["query"]);
      try {
        await expect(createClaim(filing)).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }
      expect(readbackFailed).toBe(true);
      expect(await remaining()).toEqual({
        bookings: [{ id: 1 }],
        passengers: [{ id: 10 }],
        claims: [],
      });
      state.db = purgeDb;
      await expect(purgeDeletedBookings(90)).resolves.toEqual({
        purgedCount: 1,
      });
      expect(await remaining()).toEqual({
        bookings: [],
        passengers: [],
        claims: [],
      });
    });
  }
);
