import { describe, it, expect } from "vitest";
import { validateRotation } from "../services/aircraft-rotation.service";
import {
  flightCostSchema,
  costTotal,
} from "../services/flight-economics-evidence.service";
describe("tail continuity", () => {
  const a = {
    id: 1,
    originId: 1,
    destinationId: 2,
    departureTime: new Date("2026-09-15T10:00Z"),
    arrivalTime: new Date("2026-09-15T12:00Z"),
  };
  const b = {
    id: 2,
    originId: 2,
    destinationId: 3,
    departureTime: new Date("2026-09-15T13:00Z"),
    arrivalTime: new Date("2026-09-15T15:00Z"),
  };
  it("accepts a connected rotation with operator turnaround", () =>
    expect(() => validateRotation([b, a], 60)).not.toThrow());
  it("rejects overlapping or disconnected aircraft legs", () => {
    expect(() => validateRotation([a, b], 61)).toThrow();
    expect(() => validateRotation([a, { ...b, originId: 4 }], 30)).toThrow();
  });
});
describe("closed flight cost evidence", () => {
  const data = {
    version: "ERP-close-v1",
    reference: "synthetic-close",
    currency: "SAR",
    periodClosed: true,
    routeDistanceKm: 500,
    costs: {
      fuel: 100,
      crew: 200,
      maintenance: 300,
      airport: 400,
      navigation: 500,
      insurance: 600,
      overhead: 700,
    },
    recognizedRevenueMinor: null,
  };
  it("requires all components and retains unknown recognized revenue", () => {
    const p = flightCostSchema.parse(data);
    expect(costTotal(p)).toBe(2800);
    expect(p.recognizedRevenueMinor).toBeNull();
    expect(() =>
      flightCostSchema.parse({ ...data, costs: { fuel: 100 } })
    ).toThrow();
  });
  it("rejects non-closed, negative or foreign-currency snapshots", () => {
    for (const bad of [
      { periodClosed: false },
      { currency: "USD" },
      { routeDistanceKm: 0 },
      { costs: { ...data.costs, fuel: -1 } },
    ])
      expect(() => flightCostSchema.parse({ ...data, ...bad })).toThrow();
  });
});
