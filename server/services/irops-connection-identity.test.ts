import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getConnectionsAtRisk } from "./irops.service";

const dialect = new MySqlDialect();
const outbound = {
  userId: 5,
  bookingId: 10,
  bookingReference: "ALICE",
  segmentOrder: 1,
};
let inboundSegments: (typeof outbound)[];
let candidateRows: Array<{
  userId: number;
  bookingId: number;
  segmentOrder: number;
  flightNumber: string;
  departureTime: Date;
  originId: number;
  destinationId: number;
}>;
let affectedRows: (typeof outbound)[];
let passengerRows: Array<{
  id: number;
  bookingId: number;
  firstName: string;
  lastName: string;
}>;
const queries: string[] = [];
const db = {
  select: () => {
    let table = "";
    let joined = false;
    let predicate: SQL | undefined;
    const result = () => {
      const query = predicate
        ? dialect.sqlToQuery(predicate)
        : { sql: "", params: [] };
      queries.push(`${table}: ${query.sql}`);
      if (joined) {
        // Boundary fixture applies identity selection from the actual SQL;
        // it intentionally supplies both another purchaser-owned booking and
        // an earlier sector so the service must preserve itinerary identity.
        const identity = query.sql.includes("`booking_segments`.`bookingId` in")
          ? "bookingId"
          : "userId";
        const allowed = affectedRows.map(row => row[identity]);
        return candidateRows.filter(row => allowed.includes(row[identity]));
      }
      if (table === "flights")
        return [
          {
            departureTime: new Date("2030-01-01T08:00Z"),
            arrivalTime: new Date("2030-01-01T10:00Z"),
            destinationId: 2,
            status: "delayed",
          },
        ];
      if (table === "flight_disruptions")
        return [
          {
            delayMinutes: 90,
            originalDepartureTime: new Date("2030-01-01T08:00Z"),
          },
        ];
      if (table === "booking_segments") return inboundSegments;
      if (table === "bookings") return affectedRows;
      if (table === "airports")
        return [
          { id: 2, code: "BBB" },
          { id: 3, code: "CCC" },
        ];
      if (table === "passengers") return passengerRows;
      throw new Error(`Unhandled table ${table}`);
    };
    const q = {
      from(t: Parameters<typeof getTableName>[0]) {
        table = getTableName(t);
        return q;
      },
      innerJoin() {
        joined = true;
        return q;
      },
      where(p: SQL) {
        predicate = p;
        return q;
      },
      orderBy() {
        return q;
      },
      limit() {
        return q;
      },
      then(
        resolve: (rows: unknown[]) => unknown,
        reject: (error: unknown) => unknown
      ) {
        return Promise.resolve().then(result).then(resolve, reject);
      },
    };
    return q;
  },
};
vi.mock("../db", () => ({ getDb: () => db }));
beforeEach(() => {
  inboundSegments = [outbound];
  affectedRows = [outbound];
  passengerRows = [
    { id: 101, bookingId: 10, firstName: "Alice", lastName: "Fixture" },
  ];
  candidateRows = [
    {
      userId: 5,
      bookingId: 10,
      segmentOrder: 2,
      flightNumber: "NEXT",
      departureTime: new Date("2030-01-01T11:00Z"),
      originId: 2,
      destinationId: 3,
    },
  ];
  queries.length = 0;
});

it("does not attach another traveller's flight just because the purchaser is the same", async () => {
  candidateRows[0].bookingId = 20;
  expect(await getConnectionsAtRisk(1)).toEqual([]);
});

it("reports each booking's own passengers on its subsequent segment", async () => {
  affectedRows.push({ ...outbound, bookingId: 11, bookingReference: "BOB" });
  inboundSegments.push({ ...outbound, bookingId: 11 });
  passengerRows.push({
    id: 102,
    bookingId: 11,
    firstName: "Bob",
    lastName: "Fixture",
  });
  candidateRows.push({
    ...candidateRows[0],
    bookingId: 11,
    flightNumber: "BOB-NEXT",
  });
  const results = await getConnectionsAtRisk(1);
  expect(
    results.map(row => [row.passengerId, row.connectionFlightNumber])
  ).toEqual([
    [101, "NEXT"],
    [102, "BOB-NEXT"],
  ]);
  expect(
    queries.some(query => query.includes("`booking_segments`.`bookingId` in"))
  ).toBe(true);
});

it("does not mistake an earlier itinerary segment for an onward connection", async () => {
  inboundSegments[0] = { ...outbound, segmentOrder: 3 };
  expect(await getConnectionsAtRisk(1)).toEqual([]);
});

it("does not infer a connection for a legacy booking without an itinerary link", async () => {
  inboundSegments = [];
  candidateRows[0].bookingId = 20;
  expect(await getConnectionsAtRisk(1)).toEqual([]);
});
