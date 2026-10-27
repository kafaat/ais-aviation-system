/**
 * The search day is a calendar day at the origin airport. These assertions
 * are pure UTC arithmetic, so they must hold whatever TZ the test process
 * runs under (CI runs them under UTC; run `TZ=Asia/Riyadh pnpm exec vitest
 * run server/__tests__/civil-day-window.test.ts` to confirm locally).
 */
import { describe, expect, it } from "vitest";
import {
  civilDateOf,
  civilDayWindowUtc,
  isValidTimeZone,
  zoneOffsetMs,
} from "../services/civil-day";

describe("civilDateOf", () => {
  it("passes a civil date through and rejects anything else", () => {
    expect(civilDateOf("2026-11-15")).toBe("2026-11-15");
    // A legacy ISO instant is read like a Date (local midnight in Riyadh).
    expect(civilDateOf("2026-11-14T21:00:00.000Z")).toBe("2026-11-15");
    expect(() => civilDateOf("not a date")).toThrow(RangeError);
    expect(() => civilDateOf("2026-13-45")).toThrow(RangeError);
    expect(() => civilDateOf(new Date("nonsense"))).toThrow(RangeError);
  });

  it("maps a browser's local midnight for one calendar day to that day from any zone", () => {
    // 15 Nov 2026 at local midnight, as encoded by browsers in each zone.
    const encodings = {
      riyadh: new Date("2026-11-14T21:00:00.000Z"), // UTC+3
      london: new Date("2026-11-15T00:00:00.000Z"), // UTC+0
      newYork: new Date("2026-11-15T05:00:00.000Z"), // UTC-5
      tokyo: new Date("2026-11-14T15:00:00.000Z"), // UTC+9
      honolulu: new Date("2026-11-15T10:00:00.000Z"), // UTC-10
    };
    for (const encoded of Object.values(encodings))
      expect(civilDateOf(encoded)).toBe("2026-11-15");
  });
});

describe("civilDayWindowUtc", () => {
  it("covers exactly the Riyadh calendar day, end exclusive", () => {
    const { start, end } = civilDayWindowUtc("2026-11-15", "Asia/Riyadh");
    expect(start.toISOString()).toBe("2026-11-14T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-15T21:00:00.000Z");
  });

  it("handles a daylight-saving transition inside the day", () => {
    // Europe/London moves from GMT to BST at 01:00 UTC on 29 March 2026:
    // the civil day is 23 hours long.
    const { start, end } = civilDayWindowUtc("2026-03-29", "Europe/London");
    expect(start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(civilDayWindowUtc("2026-10-25", "Europe/London")).toEqual({
      start: new Date("2026-10-24T23:00:00.000Z"),
      end: new Date("2026-10-26T00:00:00.000Z"),
    });
  });

  it("treats UTC as the identity", () => {
    expect(civilDayWindowUtc("2026-02-28", "UTC")).toEqual({
      start: new Date("2026-02-28T00:00:00.000Z"),
      end: new Date("2026-03-01T00:00:00.000Z"),
    });
  });
});

describe("zone helpers", () => {
  it("reports offsets east and west of Greenwich", () => {
    const instant = new Date("2026-07-01T12:00:00.000Z");
    expect(zoneOffsetMs(instant, "Asia/Riyadh")).toBe(3 * 3600_000);
    expect(zoneOffsetMs(instant, "America/New_York")).toBe(-4 * 3600_000);
    expect(zoneOffsetMs(instant, "UTC")).toBe(0);
  });

  it("recognises valid IANA zones only", () => {
    expect(isValidTimeZone("Asia/Riyadh")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
