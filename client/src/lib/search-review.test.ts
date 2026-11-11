import { expect, it } from "vitest";
import { flightSearchFormPath } from "./search-context";
import { flightDepartureHour } from "./flight-time";
it("keeps the alert route on the date-selection form", () => {
  expect(flightSearchFormPath(1, 2)).toBe("/?origin=1&destination=2");
  expect(flightSearchFormPath(1, 1)).toBe("/");
});
it("uses airport-local departure hour across midnight", () => {
  expect(flightDepartureHour("2026-11-03T22:00:00Z", "Asia/Riyadh")).toBe(1);
  expect(flightDepartureHour("2026-11-03T22:00:00Z", "America/New_York")).toBe(
    17
  );
  expect(Number.isNaN(flightDepartureHour("invalid", "Asia/Riyadh"))).toBe(
    true
  );
});
