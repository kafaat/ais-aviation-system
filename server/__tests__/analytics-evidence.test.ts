import { afterEach, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ getDb: () => null }));
import { summarizeRouteActivity } from "../services/intelligence/economics.agent";
import {
  getServiceStatus,
  getSystemHealth,
  recordMetric,
  checkSLACompliance,
  startSLAMonitoring,
  stopSLAMonitoring,
} from "../services/sla-monitoring.service";
afterEach(() => {
  stopSLAMonitoring();
  vi.useRealTimers();
});
it("counts flight capacity once, passengers by leg and allocated revenue only", () => {
  const flights = [1, 2].map(id => ({
    id,
    originId: id,
    destinationId: id + 1,
    economySeats: 100,
    businessSeats: 10,
  }));
  const bookings = [
    { id: 1, flightId: 1, numberOfPassengers: 3, totalAmount: 9000 },
    { id: 2, flightId: 1, numberOfPassengers: 2, totalAmount: 2000 },
  ];
  const segments = [
    { bookingId: 1, flightId: 1, segmentAmount: 4000 },
    { bookingId: 1, flightId: 2, segmentAmount: 5000 },
  ];
  const result = summarizeRouteActivity(flights, bookings, segments);
  expect(result.map(r => [r.totalSeats, r.bookedSeats, r.revenue])).toEqual([
    [110, 5, 6000],
    [110, 3, 5000],
  ]);
  expect(
    summarizeRouteActivity(flights, bookings, [
      { ...segments[0], segmentAmount: null },
      segments[1],
    ])[0].revenue
  ).toBeNull();
});
it("keeps missing and stale SLA observations unknown and never synthesizes uptime", () => {
  vi.useFakeTimers();
  expect(getSystemHealth().overallStatus).toBe("unknown");
  startSLAMonitoring(1);
  vi.advanceTimersByTime(60_000);
  expect(getServiceStatus("api")).toMatchObject({
    status: "unknown",
    uptime: null,
    lastChecked: null,
    observationScope: "process",
  });
  recordMetric("api", "uptime", 100);
  recordMetric("api", "response_time", 50);
  recordMetric("api", "error_rate", 0);
  recordMetric("api", "throughput", 10);
  expect(getServiceStatus("api").lastChecked).not.toBeNull();
  vi.advanceTimersByTime(11 * 60_000);
  expect(getServiceStatus("api").status).toBe("unknown");
  expect(
    checkSLACompliance("api").every(
      r => r.currentValue === null && r.isCompliant === null
    )
  ).toBe(true);
});
