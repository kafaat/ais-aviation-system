import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  baggageItems,
  dcsOperationEvents,
  dcsPassengerStates,
  flights,
  passengers,
  seatInventory,
  ticketCoupons,
} from "../../drizzle/schema";
import {
  opsReportTables,
  seedOpsReportRows,
  type FixtureValue,
} from "./fixtures/standard-reports-ops.fixture";

const state = vi.hoisted(() => ({ db: null as unknown, getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: state.getDb }));
import {
  getOperationsStandardReport,
  operationsReportDefinitions,
} from "../services/standard-reports-ops.service";

let database: DatabaseSync;
const scope = { tenantId: 101, userId: 701 };
function insert(table: MySqlTable, values: Record<string, FixtureValue>) {
  const columns = Object.keys(values);
  // MySQL compares TIMESTAMP values as instants. SQLite's text fixture must use
  // the same precision as Drizzle's encoded parameters for midnight boundaries.
  const bound = Object.values(values).map(value =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? value + ".000"
      : value
  );
  database
    .prepare(
      `INSERT INTO \`${getTableName(table)}\` (${columns.map(column => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
    )
    .run(...bound);
}

beforeEach(async () => {
  database = new DatabaseSync(":memory:");
  for (const table of opsReportTables)
    database.exec(
      `CREATE TABLE \`${getTableName(table)}\` (${Object.values(
        getTableColumns(table)
      )
        .map(
          column =>
            `\`${column.name}\` ${column.dataType === "number" || column.dataType === "boolean" ? "INTEGER" : "TEXT"}${column.name === "id" ? " PRIMARY KEY" : ""}`
        )
        .join(",")})`
    );
  const queryDb = drizzle(async (query, params) => {
    const statement = database.prepare(query);
    statement.setReturnArrays(true);
    return {
      rows: statement.all(...(params as Array<string | number | null>)),
    };
  });
  state.db = {
    async transaction<T>(read: (tx: typeof queryDb) => Promise<T>) {
      database.exec("BEGIN");
      try {
        const result = await read(queryDb);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  state.getDb.mockReset().mockImplementation(() => state.db);
  await seedOpsReportRows(insert);
});
afterEach(() => {
  state.db = null;
  database.close();
});

describe("standard operational report readers on actual relational SQL", () => {
  it("lists each current sector member once and never follows the old primary flight or a foreign passenger", async () => {
    for (const id of [3, 18, 20, 25, 53]) {
      const result = await getOperationsStandardReport(
        id,
        { flightId: 1 },
        scope
      );
      expect(result?.rows.map(row => row.passengerId)).toEqual([100, 101]);
      expect(result?.rows[0]).toMatchObject({
        bookingReference: "BOOK10",
        pnr: "PNR010",
        passengerType: "adult",
        flightId: 1,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /OtherTenant|WrongPassengerTenant|WrongBookingTenant|Moved/
      );
    }
    expect(
      (await getOperationsStandardReport(3, { flightId: 2 }, scope))?.rows.map(
        row => row.passengerId
      )
    ).toEqual([110]);
  });

  it("denies foreign flight IDs before reading any passenger, and exposes no financial columns", async () => {
    await expect(
      getOperationsStandardReport(17, { flightId: 3 }, scope)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await getOperationsStandardReport(3, { flightId: 1 }, scope);
    expect(result?.columns.map(column => column.key)).not.toEqual(
      expect.arrayContaining([
        "totalAmount",
        "paymentStatus",
        "stripePaymentIntentId",
      ])
    );
  });

  it("reports all UTC day/week flights and canonical plus unlinked legacy holds without double counting", async () => {
    const day = await getOperationsStandardReport(
      15,
      { startDate: "2030-01-02" },
      scope
    );
    expect(day?.rows).toHaveLength(1);
    expect(day?.rows[0]).toMatchObject({
      flightId: 1,
      economyHeld: 5,
      businessHeld: 2,
      economyAvailable: 0,
      businessAvailable: 0,
      sold: 4,
      capacity: 7,
    });
    const week = await getOperationsStandardReport(
      16,
      { startDate: "2030-01-02" },
      scope
    );
    expect(week?.rows.map(row => row.flightId)).toEqual([1, 2]);
    insert(flights, {
      id: 4,
      tenantId: 101,
      airlineId: 1,
      originId: 1,
      destinationId: 2,
      flightNumber: "AIS104",
      aircraftType: "A320",
      departureTime: "2030-01-09 00:00:00",
      arrivalTime: "2030-01-09 02:00:00",
      status: "scheduled",
      economySeats: 0,
      businessSeats: 0,
      economyAvailable: 0,
      businessAvailable: 0,
    });
    expect(
      (
        await getOperationsStandardReport(
          16,
          { startDate: "2030-01-02" },
          scope
        )
      )?.rows.map(row => row.flightId)
    ).toEqual([1, 2]);
    const zero = await getOperationsStandardReport(44, { flightId: 4 }, scope);
    expect(zero?.rows[0].loadFactorPercent).toBeNull();
    database.exec(
      "UPDATE flights SET economyAvailable=0,businessAvailable=0 WHERE id=1"
    );
    expect(
      (await getOperationsStandardReport(45, {}, scope))?.rows.map(
        row => row.flightId
      )
    ).toEqual([1]);
  });

  it("counts actual passengers, current tickets, retained offload evidence and explicit DCS closure independently", async () => {
    const before = await getOperationsStandardReport(
      5,
      { startDate: "2030-01-02" },
      scope
    );
    expect(before?.rows[0]).toMatchObject({
      confirmedPassengers: 2,
      bookedPassengers: 3,
      ticketedPassengers: 2,
      adults: 1,
      children: 1,
      infants: 0,
      checkedInPassengers: 1,
      boardedPassengers: 0,
      offloadedPassengers: 1,
      noShowPassengers: null,
    });
    database.exec(
      "UPDATE dcs_flight_operations SET checkInState='closed' WHERE flightId=1"
    );
    const after = await getOperationsStandardReport(
      5,
      { startDate: "2030-01-02" },
      scope
    );
    expect(after?.rows[0].noShowPassengers).toBe(1);
    const noShows = await getOperationsStandardReport(92, {}, scope);
    expect(noShows?.rows.map(row => row.passengerId)).toEqual([100]);
    const flown = await getOperationsStandardReport(14, {}, scope);
    expect(
      flown?.rows.map(row => [row.flightId, row.boardedPassengers])
    ).toEqual([[2, 1]]);
  });

  it("does not call a historical check-in/offload a no-show or count an unreconciled boarding as flown", async () => {
    database.exec(
      "UPDATE dcs_flight_operations SET checkInState='closed' WHERE flightId=1"
    );
    insert(dcsOperationEvents, {
      id: 1,
      tenantId: 101,
      flightId: 1,
      bookingId: 10,
      passengerId: 100,
      fromState: "checked_in",
      toState: "not_checked_in",
      action: "undo_check_in",
    });
    expect((await getOperationsStandardReport(92, {}, scope))?.rows).toEqual(
      []
    );
    insert(dcsPassengerStates, {
      id: 9,
      bookingId: 13,
      passengerId: 130,
      flightId: 1,
      state: "boarded",
      boardingDenied: 0,
    });
    await expect(
      getOperationsStandardReport(5, { startDate: "2030-01-02" }, scope)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("uses exact APIS ownership, labels legacy data, and applies the origin and departure period", async () => {
    const result = await getOperationsStandardReport(2, { flightId: 1 }, scope);
    expect(result?.rows[0]).toMatchObject({
      passengerId: 100,
      documentNumber: "SAFE100",
      dateOfBirth: "1990-03-04",
      verificationStatus: "validated",
      documentSource: "apis_data",
    });
    expect(result?.rows[1]).toMatchObject({
      passengerId: 101,
      documentNumber: "LEGACY101",
      verificationStatus: "legacy_unverified",
      documentSource: "passenger_record",
    });
    expect(JSON.stringify(result)).not.toContain("DO-NOT-LEAK");
    const city = await getOperationsStandardReport(
      64,
      { origin: "RUH", startDate: "2030-01-03", endDate: "2030-01-03" },
      scope
    );
    expect(city?.rows.map(row => row.passengerId)).toEqual([110]);
    expect(city?.rows[0].verificationStatus).toBe("missing");
    expect(
      (await getOperationsStandardReport(64, { origin: "JED" }, scope))?.rows
    ).toEqual([]);
  });

  it("exports current local coupon and passenger-sector baggage without returned or foreign bags", async () => {
    const result = await getOperationsStandardReport(
      17,
      { flightId: 1 },
      scope
    );
    expect(result?.rows[0]).toMatchObject({
      passengerId: 100,
      ticketNumber: "1000000000100",
      couponNumber: 1,
      couponStatus: "O",
      baggagePieces: 1,
      baggageWeightKg: 10.5,
      baggageTags: "BAGLOCAL001",
    });
    expect(result?.rows[1]).toMatchObject({
      passengerId: 101,
      couponStatus: "C",
      seatNumber: "12A",
      baggagePieces: 1,
      baggageWeightKg: 5,
      baggageTags: "BAGLEGACY03",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /BAGRETURNED|BAGMOVED002|2000000009999/
    );
    const moved = await getOperationsStandardReport(17, { flightId: 2 }, scope);
    expect(moved?.rows[0]).toMatchObject({
      passengerId: 110,
      couponStatus: "F",
      baggageTags: "BAGMOVED002",
    });
  });

  it("blocks the manifest when a physical bag is attached to the wrong passenger booking", async () => {
    insert(baggageItems, {
      id: 999,
      bookingId: 10,
      passengerId: 120,
      flightId: 1,
      segmentId: 101,
      tagNumber: "WRONGOWNER",
      weight: "5.00",
      status: "checked_in",
    });
    await expect(
      getOperationsStandardReport(17, { flightId: 1 }, scope)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("shows holding passengers and remaining anonymous hold quantity while excluding released/expired memberships", async () => {
    const result = await getOperationsStandardReport(
      23,
      { flightId: 1 },
      scope
    );
    expect(
      result?.rows
        .filter(row => row.rowKind === "passenger")
        .map(row => row.passengerId)
    ).toEqual([100, 101, 160]);
    const holds =
      result?.rows.filter(row =>
        String(row.rowKind).startsWith("unallocated_")
      ) ?? [];
    expect(holds.map(row => [row.rowKind, row.lockId, row.heldSeats])).toEqual([
      ["unallocated_inventory_lock", 50, 2],
      ["unallocated_inventory_lock", 53, 1],
      ["unallocated_inventory_lock", 55, 2],
      ["unallocated_legacy_hold", 61, 1],
    ]);
    expect(
      holds.every(row => row.passengerId === null && row.pnr === null)
    ).toBe(true);
    expect(
      result?.rows.find(
        row => row.rowKind === "reservation_missing_passenger_identity"
      )
    ).toMatchObject({
      bookingId: 15,
      heldSeats: 1,
      passengerId: null,
      firstName: null,
    });
  });

  it("lists unissued and unverified coupon exceptions using retained sector inventory", async () => {
    const missing = await getOperationsStandardReport(49, {}, scope);
    expect(missing?.rows.map(row => row.bookingId)).toEqual([15, 16]);
    expect(missing?.rows.find(row => row.bookingId === 15)).toMatchObject({
      passengerCount: 0,
      unnamedPassengerQuantity: 1,
      exceptionReason: "passenger_identity_incomplete",
    });
    expect(missing?.rows.find(row => row.bookingId === 16)).toMatchObject({
      passengerCount: 1,
      ticketedPassengers: 0,
      exceptionReason: "no_current_local_coupon",
    });
    database.exec(
      "UPDATE passengers SET ticketNumber='1234567890123' WHERE id=160"
    );
    const unverified = await getOperationsStandardReport(73, {}, scope);
    expect(unverified?.rows.find(row => row.bookingId === 16)).toMatchObject({
      bookingId: 16,
      legacyUnverifiedPassengers: 1,
      exceptionReason: "coupon_coverage_unverified",
    });
    expect(JSON.stringify(unverified)).not.toMatch(
      /BOOK17|BAD013|WrongPassengerTenant/
    );
  });

  it("anti-joins valid current coupons to live sectors, retaining actual orphan reasons", async () => {
    const result = await getOperationsStandardReport(93, {}, scope);
    expect(
      result?.rows.map(row => [row.couponId, row.exceptionReason])
    ).toEqual([[6, "cancelled_booking"]]);
    insert(ticketCoupons, {
      id: 20,
      bookingId: 999,
      passengerId: 120,
      flightId: 1,
      ticketNumber: "1000000000999",
      couponNumber: 1,
      status: "O",
      createdAt: "2029-12-20 12:00:00",
    });
    const orphan = await getOperationsStandardReport(93, {}, scope);
    expect(orphan?.rows[1]).toMatchObject({
      couponId: 20,
      passengerId: null,
      firstName: null,
      lastName: null,
      exceptionReason: "missing_booking",
    });
  });

  it("uses travel date rather than creation date and returns empty reports with a stable schema", async () => {
    const result = await getOperationsStandardReport(
      72,
      { startDate: "2030-01-03", endDate: "2030-01-03" },
      scope
    );
    expect(result?.rows.map(row => row.bookingId)).toEqual([11]);
    expect(result?.rows[0]).toMatchObject({
      departureTime: "2030-01-03T00:00:00.000Z",
      bookingCreatedAt: "2029-12-20T12:00:00.000Z",
    });
    const empty = await getOperationsStandardReport(
      72,
      { startDate: "2030-02-01", endDate: "2030-02-02" },
      scope
    );
    expect(empty?.rows).toEqual([]);
    expect(empty?.columns.map(column => column.key)).toContain(
      "bookingCreatedAt"
    );
  });

  it("separates cabin totals and RBD subsets, caps effective RBD availability and prevents foreign class leakage", async () => {
    const result = await getOperationsStandardReport(
      84,
      { flightId: 1 },
      scope
    );
    expect(
      result?.rows.map(row => [row.level, row.cabinClass, row.rbd])
    ).toEqual([
      ["cabin", "economy", null],
      ["cabin", "business", null],
      ["rbd", "economy", "Y"],
      ["rbd", "business", "J"],
    ]);
    expect(result?.rows[0]).toMatchObject({
      held: 5,
      waitlistedSeats: 2,
      effectiveAvailable: 0,
    });
    expect(result?.rows[2]).toMatchObject({
      held: 3,
      waitlistedSeats: null,
      effectiveAvailable: 0,
    });
    expect(JSON.stringify(result)).not.toContain('"ZZ"');
  });

  it("distinguishes missing allocations and invalid maps from a catalog map that happens to match", async () => {
    const result = await getOperationsStandardReport(48, {}, scope);
    expect(
      result?.rows.map(row => [row.flightId, row.exceptionReason])
    ).toEqual([
      [1, "incomplete_or_mismatched_seat_inventory"],
      [2, "no_allocated_seat_inventory"],
    ]);
    for (let id = 2; id <= 7; id++)
      insert(seatInventory, {
        id,
        flightId: 1,
        seatMapId: 1,
        seatNumber: `${id}A`,
        cabinClass: id <= 5 ? "economy" : "business",
        status: "available",
      });
    expect(
      (await getOperationsStandardReport(48, {}, scope))?.rows.map(
        row => row.flightId
      )
    ).toEqual([2]);
    database.exec("UPDATE seat_maps SET active=0 WHERE id=1");
    const invalid = await getOperationsStandardReport(48, {}, scope);
    expect(invalid?.rows[0]).toMatchObject({
      flightId: 1,
      exceptionReason: "missing_inactive_or_mismatched_map",
    });
  });

  it("generates PNL content from actual authorized members without mutating transmission state", async () => {
    const result = await getOperationsStandardReport(
      56,
      { flightId: 1 },
      scope
    );
    expect(result?.rows[0]).toMatchObject({
      passengerCount: 2,
      draftStatus: "generated_not_persisted",
    });
    expect(result?.rows[0].messageContent).toContain("PNR010.PERSON/ALPHA");
    expect(result?.rows[0].messageContent).toContain("PNR010.PERSON/BRAVO");
    expect(String(result?.rows[0].messageContent)).not.toMatch(
      /MOVED|OTHER|WRONG/
    );
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM operational_message_transmissions"
        )
        .get()
    ).toMatchObject({ count: 3 });
    database.exec("UPDATE passengers SET firstName='اختبار' WHERE id=100");
    await expect(
      getOperationsStandardReport(56, { flightId: 1 }, scope)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("reads each PNL version, actual acknowledgments and not-generated flights without mixing tenants", async () => {
    const result = await getOperationsStandardReport(
      57,
      { origin: "RUH" },
      scope
    );
    expect(
      result?.rows.map(row => [row.flightId, row.pnlStatus, row.transmissionId])
    ).toEqual([
      [1, "draft", 1],
      [1, "acknowledged", 2],
      [2, "not_generated", null],
    ]);
    expect(result?.rows[0].sentAt).toBeNull();
    expect(result?.rows[1]).toMatchObject({
      sentAt: "2030-01-01T13:01:00.000Z",
      acknowledgedAt: "2030-01-01T13:02:00.000Z",
      acknowledgmentCode: "ACK",
    });
    expect(
      (
        await getOperationsStandardReport(
          57,
          { origin: "RUH", status: "not_generated" },
          scope
        )
      )?.rows.map(row => row.flightId)
    ).toEqual([2]);
  });

  it("requires source models or mandatory filters before any database read", async () => {
    state.getDb.mockClear();
    for (const id of [13, 21, 24, 50, 74, 91])
      await expect(
        getOperationsStandardReport(id, {}, scope)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      getOperationsStandardReport(17, {}, scope)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getOperationsStandardReport(64, {}, scope)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.getDb).not.toHaveBeenCalled();
    expect(await getOperationsStandardReport(1, {}, scope)).toBeUndefined();
  });

  it("executes every nonblocked catalog reader against relational data", async () => {
    for (const definition of operationsReportDefinitions.filter(
      report => report.availability !== "blocked"
    )) {
      const filters =
        definition.filters.length === 1
          ? { flightId: 1 }
          : { startDate: "2030-01-02", origin: "RUH" };
      const result = await getOperationsStandardReport(
        definition.id,
        filters,
        scope
      );
      expect(result, `${definition.id} ${definition.title}`).toBeDefined();
      expect(result?.columns.length).toBeGreaterThan(0);
    }
  });

  it("fails closed instead of truncating a passenger report beyond 10000 rows", async () => {
    database.exec("BEGIN");
    for (let id = 1000; id < 11000; id++)
      insert(passengers, {
        id,
        tenantId: 101,
        bookingId: 10,
        firstName: "Bounded",
        lastName: String(id),
        type: "adult",
      });
    database.exec("COMMIT");
    await expect(
      getOperationsStandardReport(3, { flightId: 1 }, scope)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("10000"),
    });
  });
});
