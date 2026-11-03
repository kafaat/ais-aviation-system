import { describe, expect, it, vi } from "vitest";
import {
  airlines,
  codeshareAgreements,
  codeshareAllotments,
  flights,
  type CodeshareAgreement,
} from "../../drizzle/schema";
import { codeshareRouter } from "./codeshare";
import type { TrpcContext } from "../_core/context";

const getDb = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ getDb }));
const marketing = { id: 1, name: "Marketing", code: "XM", logo: null };
const operating = { id: 2, name: "Operating", code: "XO", logo: null };
const day = (n: number) => new Date(Date.UTC(2027, 0, n));
const origin = { id: 3, name: "City A", city: "A", code: "AAA" };
const destination = { id: 4, name: "City B", city: "B", code: "BBB" };
const flight = {
  flightId: 5,
  flightNumber: "XO001",
  departureTime: day(10),
  arrivalTime: day(11),
  aircraftType: null,
  economyPrice: 100,
  businessPrice: 200,
  status: "scheduled",
  economyAvailable: 4,
  businessAvailable: 2,
  operatingAirline: operating,
  origin,
  destination,
};
function agreement(id: number, overrides: Partial<CodeshareAgreement> = {}) {
  return {
    id,
    agreementReference: String(id),
    operatingAirlineId: operating.id,
    agreementType: "hard_block",
    blockSize: 1,
    validFrom: day(1),
    validUntil: null,
    routeScope: "specific_routes",
    routes: JSON.stringify([
      { originId: origin.id, destinationId: destination.id },
    ]),
    ...overrides,
  };
}

type Allocation = {
  allotmentId: number;
  agreementId: number;
  flightId: number;
  marketingFlightNumber: string;
  cabinClass: "economy" | "business";
  seatLimit: number;
  occupied: number;
};
async function search(
  rows: ReturnType<typeof agreement>[],
  allocations: Allocation[] = []
) {
  const flightQuery = {
    innerJoin: () => flightQuery,
    where: () => ({ orderBy: () => [flight] }),
  };
  getDb.mockResolvedValue({
    select: () => ({
      from: (table: unknown) => {
        if (table === codeshareAgreements) return { where: () => rows };
        if (table === codeshareAllotments) return { where: () => allocations };
        if (table === flights) return flightQuery;
        if (table === airlines)
          return { where: () => ({ limit: () => [marketing] }) };
        throw new Error("Unexpected codeshare reader");
      },
    }),
  });
  const caller = codeshareRouter.createCaller({ user: null } as TrpcContext);
  return (await caller.getCodeshareFlights({ airlineId: marketing.id })).data;
}

describe("public codeshare flight selection", () => {
  it("uses the same single matching agreement regardless of source row order", async () => {
    const rows = [
      agreement(1, { routeScope: "all_routes" }),
      agreement(2, {
        routes: JSON.stringify([{ originId: 4, destinationId: 3 }]),
      }),
      agreement(3, { validUntil: day(9) }),
      agreement(4, { validFrom: day(2), validUntil: day(10) }),
      agreement(5, { validFrom: day(2) }),
    ];
    for (const ordered of [rows.slice(), rows.slice().reverse()]) {
      expect(
        (await search(ordered)).map(row => [
          row.flightId,
          row.agreementReference,
        ])
      ).toEqual([[5, "4"]]);
    }
  });
  it("quotes only the matching agreement, capped by cabin inventory and local commitments", async () => {
    const allocated = {
      allotmentId: 7,
      agreementId: 1,
      flightId: flight.flightId,
      marketingFlightNumber: "XM71",
      cabinClass: "business" as const,
      seatLimit: 6,
      occupied: 2,
    };
    const contract = agreement(1, { blockSize: 8 });
    const [result] = await search(
      [contract],
      [
        allocated,
        { ...allocated, agreementId: 99, allotmentId: 8 },
        {
          ...allocated,
          allotmentId: 9,
          cabinClass: "economy",
          seatLimit: 2,
          occupied: 1,
        },
      ]
    );
    expect(result.partnerSeatsAvailable).toBe(3);
    expect(
      result.saleOptions.map(row => [row.allotmentId, row.seatsAvailable])
    ).toEqual([
      [7, 2],
      [9, 1],
    ]);
    const [reduced] = await search(
      [agreement(1, { blockSize: 5 })],
      [allocated]
    );
    expect(reduced.partnerSeatsAvailable).toBe(0);
  });
  it.each([null, "{", "null", "{}", "[null]", "[]"])(
    "denies a restricted agreement whose route list is %s",
    async routes => {
      expect(await search([agreement(1, { routes })])).toEqual([]);
    }
  );
  it("skips blocks with no allocation and retains a matching free-sale fallback", async () => {
    const rows = [
      agreement(1, { blockSize: 0 }),
      agreement(2, { blockSize: null }),
    ];
    expect(await search(rows)).toEqual([]);
    const result = await search([
      ...rows,
      agreement(3, {
        agreementType: "free_sale",
        blockSize: null,
        routeScope: "all_routes",
        routes: null,
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agreementReference: "3",
      economyAvailable: 4,
      partnerSeatsAvailable: null,
    });
  });
});
