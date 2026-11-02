import { describe, it, expect } from "vitest";
import {
  civilDateAt,
  dayOffset,
  formatDayOffset,
  formatFlightDate,
  formatFlightTime,
  isValidTimeZone,
  resolveTimeZone,
} from "./flight-time";

// 20:30Z is 23:30 in Riyadh (UTC+3) and 00:30 the next day in Dubai (UTC+4).
const riyadhLateEvening = new Date("2026-11-15T20:30:00.000Z");

describe("formatFlightTime", () => {
  it("renders the wall clock of the airport zone, not the process zone", () => {
    expect(formatFlightTime(riyadhLateEvening, "Asia/Riyadh")).toBe("23:30");
    expect(formatFlightTime(riyadhLateEvening, "Asia/Dubai")).toBe("00:30");
    expect(formatFlightTime(riyadhLateEvening, "America/New_York")).toBe(
      "15:30"
    );
    expect(formatFlightTime(riyadhLateEvening, "UTC")).toBe("20:30");
  });

  it("uses a 24-hour clock with Latin digits by default", () => {
    expect(formatFlightTime("2026-11-15T21:05:00.000Z", "Asia/Riyadh")).toBe(
      "00:05"
    );
    expect(formatFlightTime("2026-11-15T09:00:00.000Z", "Asia/Riyadh")).toBe(
      "12:00"
    );
  });

  it("accepts ISO strings and epoch milliseconds", () => {
    expect(formatFlightTime(riyadhLateEvening.getTime(), "Asia/Riyadh")).toBe(
      "23:30"
    );
    expect(
      formatFlightTime(riyadhLateEvening.toISOString(), "Asia/Riyadh")
    ).toBe("23:30");
  });

  it("falls back to the viewer's zone when the airport zone is missing or invalid", () => {
    const local = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(riyadhLateEvening);
    expect(formatFlightTime(riyadhLateEvening, null)).toBe(local);
    expect(formatFlightTime(riyadhLateEvening, undefined)).toBe(local);
    expect(formatFlightTime(riyadhLateEvening, "")).toBe(local);
    expect(formatFlightTime(riyadhLateEvening, "Mars/Olympus_Mons")).toBe(
      local
    );
  });

  it("returns an empty string for an invalid date instead of throwing", () => {
    expect(formatFlightTime("not a date", "Asia/Riyadh")).toBe("");
    expect(formatFlightTime(new Date(Number.NaN), "Asia/Riyadh")).toBe("");
  });

  it("survives an unknown locale tag", () => {
    expect(
      formatFlightTime(riyadhLateEvening, "Asia/Riyadh", "not-a-locale!!")
    ).toBe("23:30");
  });
});

describe("formatFlightDate", () => {
  it("renders the civil date at the airport", () => {
    expect(formatFlightDate(riyadhLateEvening, "Asia/Riyadh", "en-GB")).toBe(
      "15 Nov 2026"
    );
    // Already the 16th in Dubai.
    expect(formatFlightDate(riyadhLateEvening, "Asia/Dubai", "en-GB")).toBe(
      "16 Nov 2026"
    );
  });

  it("accepts a custom shape", () => {
    expect(
      formatFlightDate(riyadhLateEvening, "Asia/Riyadh", "en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      // ICU versions differ on the comma after the weekday.
    ).toMatch(/^Sunday,? 15 November 2026$/);
  });

  it("formats in the requested locale", () => {
    const arabic = formatFlightDate(riyadhLateEvening, "Asia/Riyadh", "ar");
    expect(arabic.length).toBeGreaterThan(0);
    expect(arabic).not.toBe(
      formatFlightDate(riyadhLateEvening, "Asia/Riyadh", "en-GB")
    );
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatFlightDate("garbage", "Asia/Riyadh")).toBe("");
  });
});

describe("civilDateAt", () => {
  it("gives YYYY-MM-DD in the airport zone", () => {
    expect(civilDateAt(riyadhLateEvening, "Asia/Riyadh")).toBe("2026-11-15");
    expect(civilDateAt(riyadhLateEvening, "Asia/Dubai")).toBe("2026-11-16");
    expect(civilDateAt(riyadhLateEvening, "Pacific/Honolulu")).toBe(
      "2026-11-15"
    );
  });
});

describe("dayOffset", () => {
  it("is 0 for a same-day arrival", () => {
    // RUH 08:00 -> JED 09:45, both UTC+3.
    expect(
      dayOffset(
        "2026-11-15T05:00:00.000Z",
        "Asia/Riyadh",
        "2026-11-15T06:45:00.000Z",
        "Asia/Riyadh"
      )
    ).toBe(0);
  });

  it("is +1 when a short hop crosses midnight at the destination", () => {
    // RUH 23:30 (20:30Z) -> DXB 02:15 next day (22:15Z).
    const departure = new Date("2026-11-15T20:30:00.000Z");
    const arrival = new Date("2026-11-15T22:15:00.000Z");
    expect(formatFlightTime(departure, "Asia/Riyadh")).toBe("23:30");
    expect(formatFlightTime(arrival, "Asia/Dubai")).toBe("02:15");
    expect(dayOffset(departure, "Asia/Riyadh", arrival, "Asia/Dubai")).toBe(1);
  });

  it("is 0 for an overnight westbound long haul that lands the same local day", () => {
    // JED 01:30 (14 Nov 22:30Z) -> JFK 08:00 same civil day (14 Nov 13:00Z + ...)
    // Depart Jeddah 15 Nov 01:30 local = 14 Nov 22:30Z. Arrive New York
    // 15 Nov 07:45 local (UTC-5) = 15 Nov 12:45Z. Fourteen hours in the air,
    // still the 15th at both ends.
    const departure = new Date("2026-11-14T22:30:00.000Z");
    const arrival = new Date("2026-11-15T12:45:00.000Z");
    expect(formatFlightTime(departure, "Asia/Riyadh")).toBe("01:30");
    expect(formatFlightTime(arrival, "America/New_York")).toBe("07:45");
    expect(
      dayOffset(departure, "Asia/Riyadh", arrival, "America/New_York")
    ).toBe(0);
  });

  it("is +1 for an eastbound overnight long haul", () => {
    // JFK 22:00 15 Nov (03:00Z 16 Nov) -> RUH 17:30 16 Nov (14:30Z 16 Nov).
    const departure = new Date("2026-11-16T03:00:00.000Z");
    const arrival = new Date("2026-11-16T14:30:00.000Z");
    expect(formatFlightTime(departure, "America/New_York")).toBe("22:00");
    expect(formatFlightTime(arrival, "Asia/Riyadh")).toBe("17:30");
    expect(
      dayOffset(departure, "America/New_York", arrival, "Asia/Riyadh")
    ).toBe(1);
  });

  it("is +2 when the trip spans two local midnights", () => {
    // LAX 23:50 15 Nov (07:50Z 16 Nov) -> SYD 10:30 17 Nov (23:30Z 16 Nov).
    const departure = new Date("2026-11-16T07:50:00.000Z");
    const arrival = new Date("2026-11-16T23:30:00.000Z");
    expect(formatFlightTime(departure, "America/Los_Angeles")).toBe("23:50");
    expect(formatFlightTime(arrival, "Australia/Sydney")).toBe("10:30");
    expect(
      dayOffset(departure, "America/Los_Angeles", arrival, "Australia/Sydney")
    ).toBe(2);
  });

  it("is -1 when crossing the date line eastward", () => {
    // SYD 10:00 16 Nov (23:00Z 15 Nov) -> LAX 06:30 16 Nov... make it land
    // the 15th: depart SYD 16 Nov 10:00 local (15 Nov 23:00Z), arrive LAX
    // 15 Nov 19:45 local (16 Nov 03:45Z).
    const departure = new Date("2026-11-15T23:00:00.000Z");
    const arrival = new Date("2026-11-16T03:45:00.000Z");
    expect(civilDateAt(departure, "Australia/Sydney")).toBe("2026-11-16");
    expect(civilDateAt(arrival, "America/Los_Angeles")).toBe("2026-11-15");
    expect(
      dayOffset(departure, "Australia/Sydney", arrival, "America/Los_Angeles")
    ).toBe(-1);
  });

  it("falls back to the viewer's zone for both ends when zones are missing", () => {
    const departure = new Date("2026-11-15T20:30:00.000Z");
    const arrival = new Date("2026-11-15T22:15:00.000Z");
    const expected =
      Math.round(
        (Date.UTC(
          arrival.getFullYear(),
          arrival.getMonth(),
          arrival.getDate()
        ) -
          Date.UTC(
            departure.getFullYear(),
            departure.getMonth(),
            departure.getDate()
          )) /
          86_400_000
      ) || 0;
    expect(dayOffset(departure, null, arrival, undefined)).toBe(expected);
  });

  it("is 0 when a date is invalid", () => {
    expect(
      dayOffset("bad", "Asia/Riyadh", riyadhLateEvening, "Asia/Dubai")
    ).toBe(0);
  });
});

describe("formatDayOffset", () => {
  it("marks later and earlier days, and nothing for the same day", () => {
    expect(formatDayOffset(0)).toBe("");
    expect(formatDayOffset(1)).toBe("+1");
    expect(formatDayOffset(2)).toBe("+2");
    expect(formatDayOffset(-1)).toBe("-1");
    expect(formatDayOffset(Number.NaN)).toBe("");
  });
});

describe("zone validation", () => {
  it("accepts IANA zones and rejects everything else", () => {
    expect(isValidTimeZone("Asia/Riyadh")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("resolves to undefined (viewer zone) when unusable", () => {
    expect(resolveTimeZone("Asia/Riyadh")).toBe("Asia/Riyadh");
    expect(resolveTimeZone("Nowhere/Land")).toBeUndefined();
    expect(resolveTimeZone(null)).toBeUndefined();
  });
});

describe("process time zone independence", () => {
  // The CI runner's TZ must not leak in: run this file under
  // TZ=America/New_York and TZ=Asia/Riyadh and these stay identical.
  it("gives the same airport-local output whatever TZ the process runs in", () => {
    expect(formatFlightTime(riyadhLateEvening, "Asia/Riyadh")).toBe("23:30");
    expect(civilDateAt(riyadhLateEvening, "Asia/Dubai")).toBe("2026-11-16");
    expect(
      dayOffset(
        riyadhLateEvening,
        "Asia/Riyadh",
        "2026-11-15T22:15:00.000Z",
        "Asia/Dubai"
      )
    ).toBe(1);
  });
});
