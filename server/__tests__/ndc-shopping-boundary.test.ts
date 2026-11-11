import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({
  rows: [] as any[],
  error: null as Error | null,
  retail: vi.fn(),
  inserted: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => {
      let table: any;
      const q: any = {
        from(t: any) {
          table = t;
          return q;
        },
        innerJoin: () => q,
        where: () => q,
        orderBy: () => q,
        then: (resolve: any, reject: any) =>
          Promise.resolve()
            .then(() => {
              if (state.error) throw state.error;
              return getTableName(table) === "flights" ? state.rows : [];
            })
            .then(resolve, reject),
      };
      return q;
    },
    insert: () => ({ values: state.inserted }),
  }),
}));
vi.mock("../services/retail-offer.service", async original => ({
  ...(await original<any>()),
  createRetailOffer: state.retail,
}));
import { searchOffers } from "../services/ndc.service";
const request = {
  originId: 1,
  destinationId: 2,
  departureDate: "2030-01-01",
  cabinClass: "economy" as const,
  passengerCount: 1,
};
const flight = (id: number, hour: number) => ({
  id,
  departureTime: new Date(`2030-01-01T${hour}:00:00Z`),
  arrivalTime: new Date("2030-01-01T22:00:00Z"),
  economyAvailable: 2,
  businessAvailable: 2,
  airline: { code: "AA", name: "Test" },
  origin: { code: "AAA" },
  destination: { code: "BBB" },
});
describe("NDC shopping boundaries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
    state.error = null;
    state.rows = [];
    state.inserted.mockReset();
    state.retail.mockReset().mockResolvedValue({
      id: "R",
      totalAmount: 100,
      expiresAt: new Date("2030-01-01T13:00:00Z"),
      payload: { baseAmount: 100, taxesAndFees: 0, policy: {} },
    });
  });
  afterEach(() => vi.useRealTimers());
  it("rejects unsupported return itineraries without persisting an outbound offer", async () => {
    state.rows = [flight(2, 18)];
    await expect(
      searchOffers({ ...request, returnDate: "2030-01-02" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.inserted).not.toHaveBeenCalled();
  });
  it("skips departed instances while offering the future departure", async () => {
    state.rows = [flight(1, 10), flight(2, 18)];
    const offers = await searchOffers(request);
    expect(offers).toHaveLength(1);
    expect(state.retail).toHaveBeenCalledTimes(1);
    expect(state.retail).toHaveBeenCalledWith(
      expect.objectContaining({ flightId: 2 })
    );
  });
  it("does not hide database failures as empty availability", async () => {
    state.error = new Error("database read failed");
    await expect(searchOffers(request)).rejects.toThrow("database read failed");
  });
  it("does not hide offer persistence failures", async () => {
    state.rows = [flight(2, 18)];
    state.inserted.mockRejectedValueOnce(new Error("offer write failed"));
    await expect(searchOffers(request)).rejects.toThrow("offer write failed");
  });
});
