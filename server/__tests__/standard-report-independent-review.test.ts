import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookings } from "../../drizzle/schema";
import {
  opsReportTables,
  seedOpsReportRows,
  type FixtureValue,
} from "./fixtures/standard-reports-ops.fixture";

const source = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => source.db }));
import { getOperationsStandardReport } from "../services/standard-reports-ops.service";
import { getStandardReportDefinitions } from "../services/standard-reports.service";

let database: DatabaseSync;
const scope = { tenantId: 101, userId: 701 };

function insert(table: MySqlTable, values: Record<string, FixtureValue>) {
  const columns = Object.keys(values);
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
  const reader = drizzle(async (query, params) => {
    const statement = database.prepare(query);
    statement.setReturnArrays(true);
    return {
      rows: statement.all(...(params as Array<string | number | null>)),
    };
  });
  source.db = {
    async transaction<T>(read: (tx: typeof reader) => Promise<T>) {
      database.exec("BEGIN");
      try {
        const result = await read(reader);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  await seedOpsReportRows(insert);
});

afterEach(() => {
  source.db = null;
  database.close();
});

describe("independent reporting acceptance review", () => {
  it("keeps 99 catalog entries distinct from 71 runnable and 36 marked available", () => {
    const definitions = getStandardReportDefinitions();
    expect(definitions).toHaveLength(99);
    expect(new Set(definitions.map(report => report.id)).size).toBe(99);
    expect(
      definitions.filter(report => report.availability === "available")
    ).toHaveLength(36);
    expect(
      definitions.filter(report => report.availability === "partial")
    ).toHaveLength(35);
    expect(
      definitions.filter(report => report.availability === "blocked")
    ).toHaveLength(28);
    expect(
      definitions.filter(report => report.availability !== "blocked")
    ).toHaveLength(71);
  });

  it.each([49, 73])(
    "report %i includes retained inventory with no verified passenger identities",
    async reportId => {
      insert(bookings, {
        id: 30,
        tenantId: 101,
        userId: 701,
        flightId: 1,
        status: "confirmed",
        paymentStatus: "pending",
        seatsReserved: 1,
        cabinClass: "economy",
        numberOfPassengers: 2,
        checkedIn: 0,
        bookingReference: "UNNAMED30",
        pnr: "NONAME",
        createdAt: "2029-12-20 12:00:00",
      });
      const report = await getOperationsStandardReport(reportId, {}, scope);
      expect(report?.rows.find(row => row.bookingId === 30)).toMatchObject({
        bookingReference: "UNNAMED30",
        passengerCount: 0,
        ticketedPassengers: 0,
        expectedPassengers: 2,
        unnamedPassengerQuantity: 2,
        exceptionReason: "passenger_identity_incomplete",
      });
      expect(JSON.stringify(report)).not.toMatch(
        /OtherTenant|WrongPassengerTenant|WrongBookingTenant/
      );
    }
  );

  it("report 73 includes reserved quantity beyond the verified ticketed identities", async () => {
    database.exec("UPDATE bookings SET numberOfPassengers=3 WHERE id=10");
    const report = await getOperationsStandardReport(73, {}, scope);
    expect(report?.rows.find(row => row.bookingId === 10)).toMatchObject({
      bookingReference: "BOOK10",
      passengerCount: 2,
      ticketedPassengers: 2,
      expectedPassengers: 3,
      unnamedPassengerQuantity: 1,
      exceptionReason: "passenger_identity_incomplete",
    });
    expect(
      (await getOperationsStandardReport(49, {}, scope))?.rows.some(
        row => row.bookingId === 10
      )
    ).toBe(false);
    database.exec(
      "UPDATE booking_segments SET seatsReserved=0 WHERE bookingId=10"
    );
    expect(
      (await getOperationsStandardReport(73, {}, scope))?.rows.some(
        row => row.bookingId === 10
      )
    ).toBe(false);
  });
});
