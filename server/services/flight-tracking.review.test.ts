import { beforeEach, describe, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const state = vi.hoisted(() => ({ db: null as any, values: vi.fn() }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  getActiveFlights,
  recordFlightPosition,
} from "./flight-tracking.service";
const position = {
  flightId: 1,
  latitude: "0",
  longitude: "0",
  altitude: 100,
  heading: 0,
  groundSpeed: 10,
  phase: "cruising" as const,
  progressPercent: "50",
};
beforeEach(() => {
  state.values.mockReset().mockResolvedValue([{ insertId: 1 }]);
  state.db = { insert: () => ({ values: state.values }) };
});
describe("flight tracking integrity", () => {
  it.each([
    { latitude: "999" },
    { latitude: "NaN" },
    { latitude: "" },
    { longitude: "181" },
    { progressPercent: "101" },
    { progressPercent: "-1" },
  ])("rejects invalid telemetry %s before insertion", async patch => {
    await expect(
      recordFlightPosition({ ...position, ...patch })
    ).rejects.toThrow();
    expect(state.values).not.toHaveBeenCalled();
  });
  it.each([
    [-90, -180, 0],
    [90, 180, 100],
  ])("accepts domain endpoints %s", async (lat, lon, progress) => {
    await expect(
      recordFlightPosition({
        ...position,
        latitude: String(lat),
        longitude: String(lon),
        progressPercent: String(progress),
      })
    ).resolves.toEqual({ id: 1 });
  });
  it("includes fresh delayed flights while excluding terminal states and stale positions", async () => {
    const rows = ["scheduled", "delayed", "cancelled", "completed"].map(
      (status, i) => ({
        ...position,
        flightId: i + 1,
        status,
        recordedAt: new Date(),
        flightNumber: `F${i}`,
        originCode: "A",
        destinationCode: "B",
      })
    );
    rows.push({
      ...rows[1],
      flightId: 5,
      recordedAt: new Date(Date.now() - 3600000),
    });
    let predicate: any;
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: (p: any) => {
        predicate = p;
        return chain;
      },
      orderBy: () => {
        const q = new MySqlDialect().sqlToQuery(predicate);
        return rows.filter(
          row =>
            q.params.includes(row.status) &&
            row.recordedAt.getTime() >= Date.now() - 600000
        );
      },
    };
    state.db = { select: () => chain };
    expect((await getActiveFlights()).map(r => r.flightId)).toEqual([1, 2]);
  });
});
