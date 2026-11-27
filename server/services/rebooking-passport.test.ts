import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { responseContracts } from "../contracts/rebooking";
import { getRebookData, quickRebook } from "./rebooking.service";

const fixture = vi.hoisted(() => ({
  getDb: vi.fn(),
  getFlightById: vi.fn(),
}));
vi.mock("../db", () => fixture);

const originalExpiry = new Date("2030-01-01T00:00:00Z");
const oldPassenger = {
  type: "adult",
  title: null,
  firstName: "Test",
  lastName: "Traveler",
  dateOfBirth: null,
  passportNumber: "X12345678",
  passportExpiry: originalExpiry,
  nationality: "SA",
};

beforeEach(() => {
  // Preserve column projection: an omitted SELECT field must not appear on the returned row.
  const tables: Record<string, Record<string, unknown>[]> = {
    bookings: [
      {
        id: 3,
        bookingReference: "REBOOK",
        userId: 7,
        tenantId: 2,
        flightId: 1,
        cabinClass: "economy",
        status: "completed",
      },
    ],
    users: [{ id: 7, tenantId: 2 }],
    passengers: [oldPassenger, { ...oldPassenger, passportExpiry: null }],
    flights: [
      {
        id: 1,
        tenantId: 2,
        airlineId: 1,
        originId: 11,
        destinationId: 12,
        originCode: "RUH",
        destinationCode: "JED",
        originCity: "Riyadh",
        destinationCity: "Jeddah",
      },
    ],
  };
  const database = {
    transaction: async <T>(run: (tx: unknown) => Promise<T>) => run(database),
    select: (projection?: Record<string, unknown>) => ({
      from: (table: Table) => {
        const rows = (tables[getTableName(table)] ?? []).map(row =>
          projection
            ? Object.fromEntries(
                Object.keys(projection).map(key => [key, row[key]])
              )
            : row
        );
        const query = {
          where: () => query,
          innerJoin: () => query,
          for: () => query,
          orderBy: () => query,
          limit: () => query,
          then: (resolve: (value: typeof rows) => unknown) =>
            Promise.resolve(rows).then(resolve),
        };
        return query;
      },
    }),
  };
  fixture.getDb.mockReturnValue(database);
  fixture.getFlightById.mockResolvedValue({
    departureTime: new Date("2030-06-01T12:00:00Z"),
  });
});

it("publishes the actual and unknown original expiry in the owned rebooking response", async () => {
  const details = responseContracts.getRebookData.parse(
    await getRebookData(3, 7)
  );
  expect(details.passengers[0]).toHaveProperty(
    "passportExpiry",
    originalExpiry
  );
  expect(details.passengers[1]).toHaveProperty("passportExpiry", null);
});

it("validates the copied passport against the selected new flight in the normal booking service", async () => {
  await expect(quickRebook(3, 9, 7, 2)).rejects.toThrow(
    "is not valid on the travel date"
  );
  expect(fixture.getFlightById).toHaveBeenCalledWith(9);
});
