import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
let fixture: ReturnType<typeof transactionMemory>;
let database: any;
vi.mock("../db", () => ({ getDb: () => database }));
import { searchFlightsForAgent } from "./travel-agent.service";
const params = {
  originCode: "AAA",
  destinationCode: "BBB",
  departureDate: new Date("2030-01-01"),
  cabinClass: "business" as const,
  passengers: 2,
};
describe("agency search inventory and tenant boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
    fixture = transactionMemory({
      travel_agents: [{ id: 1, ownerUserId: 7, isActive: true }],
      users: [{ id: 7, tenantId: 3 }],
      tenants: [{ id: 3, status: "active" }],
      airports: [
        { id: 1, code: "AAA", timezone: "UTC" },
        { id: 2, code: "BBB", timezone: "UTC" },
      ],
      flights: [
        {
          id: 1,
          tenantId: 3,
          businessAvailable: 2,
          economyAvailable: 0,
          departureTime: new Date("2030-01-01T18:00:00Z"),
        },
        {
          id: 2,
          tenantId: 4,
          businessAvailable: 2,
          departureTime: new Date("2030-01-01T18:00:00Z"),
        },
        {
          id: 3,
          tenantId: 3,
          businessAvailable: 1,
          economyAvailable: 20,
          departureTime: new Date("2030-01-01T18:00:00Z"),
        },
        {
          id: 4,
          tenantId: 3,
          businessAvailable: 5,
          departureTime: new Date("2030-01-01T10:00:00Z"),
        },
        {
          id: 5,
          tenantId: null,
          businessAvailable: 2,
          departureTime: new Date("2030-01-01T18:00:00Z"),
        },
      ].map(f => ({
        ...f,
        originId: 1,
        destinationId: 2,
        status: "scheduled",
      })),
    });
    // SQL predicate boundary double; joins only attach display data, not access policy.
    database = {
      ...fixture.db,
      select: () => {
        const chain = fixture.db.select();
        let flightQuery = false;
        const proxy: any = new Proxy(chain, {
          get(target, key) {
            if (key === "innerJoin") return () => proxy;
            if (key === "from")
              return (table: any) => {
                flightQuery = getTableName(table) === "flights";
                target.from(table);
                return proxy;
              };
            if (key === "then")
              return (resolve: any, reject: any) =>
                target.then(
                  (rows: any[]) =>
                    resolve(
                      flightQuery
                        ? rows.map(flight => ({
                            flight,
                            airline: { code: "TT", name: "Test" },
                          }))
                        : rows
                    ),
                  reject
                );
            const value = target[key];
            return typeof value === "function"
              ? (...args: any[]) => {
                  const result = value(...args);
                  return result === target ? proxy : result;
                }
              : value;
          },
        });
        return proxy;
      },
    };
  });
  afterEach(() => vi.useRealTimers());
  it("returns only the owner's future flights with enough selected-cabin seats", async () => {
    expect((await searchFlightsForAgent(1, params)).map(f => f.id)).toEqual([
      1,
    ]);
  });
  it("defaults to economy and one passenger", async () => {
    const { cabinClass: _cabin, passengers: _party, ...request } = params;
    expect((await searchFlightsForAgent(1, request)).map(f => f.id)).toEqual([
      3,
    ]);
  });
  it("refuses a suspended owner tenant", async () => {
    fixture.rows("tenants")[0].status = "suspended";
    await expect(searchFlightsForAgent(1, params)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("keeps null-tenant agencies isolated from named tenants", async () => {
    fixture.rows("users")[0].tenantId = null;
    expect((await searchFlightsForAgent(1, params)).map(f => f.id)).toEqual([
      5,
    ]);
  });
  it("refuses unlinked agencies", async () => {
    fixture.rows("travel_agents")[0].ownerUserId = null;
    await expect(searchFlightsForAgent(1, params)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("refuses inactive agencies", async () => {
    fixture.rows("travel_agents")[0].isActive = false;
    await expect(searchFlightsForAgent(1, params)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it.each([0, -1, 1.5])("refuses invalid party size %s", async passengers => {
    await expect(
      searchFlightsForAgent(1, { ...params, passengers })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
