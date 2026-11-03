import { describe, expect, it } from "vitest";
import {
  computePushSchedule,
  pendingPushes,
  pnrgovScheduleInputSchema,
} from "../services/apis-pnrgov-schedule";

describe("PNRGOV push schedule", () => {
  it("computes instants relative to departure with Riyadh local labels", () => {
    // 03:00 local Riyadh on 5 Nov 2026 = 00:00Z.
    const departure = new Date("2026-11-05T00:00:00Z");
    const pushes = computePushSchedule(departure, "Asia/Riyadh");
    expect(pushes.map(p => p.offsetMinutes)).toEqual([-1440, -720, -60, 0]);
    expect(pushes[0].scheduledAt.toISOString()).toBe(
      "2026-11-04T00:00:00.000Z"
    );
    expect(pushes[0].localLabel).toBe("2026-11-04T03:00");
    expect(pushes[3].localLabel).toBe("2026-11-05T03:00");
    expect(pushes.map(p => p.localMinutesToDeparture)).toEqual([
      1440, 720, 60, 0,
    ]);
  });

  it("keeps the push instant exact across a DST change and shows the wall-clock skew", () => {
    // London leaves BST at 01:00Z on 25 Oct 2026. Departure 26 Oct 10:00 local (GMT, 10:00Z).
    const departure = new Date("2026-10-26T10:00:00Z");
    const [dayBefore] = computePushSchedule(
      departure,
      "Europe/London",
      [-1440]
    );
    expect(dayBefore.scheduledAt.toISOString()).toBe(
      "2026-10-25T10:00:00.000Z"
    );
    // 10:00Z on 25 Oct is already GMT, so the label is 10:00; the wall-clock
    // interval equals the real one here. The night before the change differs:
    const [night] = computePushSchedule(departure, "Europe/London", [-2160]); // 36h
    expect(night.scheduledAt.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(night.localLabel).toBe("2026-10-24T23:00"); // still BST
    expect(night.localMinutesToDeparture).toBe(2100); // 35h on the wall clock
  });

  it("separates pushes still ahead from missed ones", () => {
    const departure = new Date("2026-11-05T00:00:00Z");
    const pushes = computePushSchedule(departure, "Asia/Riyadh");
    const { due, missed } = pendingPushes(
      pushes,
      new Date("2026-11-04T13:00:00Z")
    );
    expect(missed.map(p => p.offsetMinutes)).toEqual([-1440, -720]);
    expect(due.map(p => p.offsetMinutes)).toEqual([-60, 0]);
  });

  it("validates schedule configuration", () => {
    expect(() =>
      computePushSchedule(new Date(), "Asia/Riyadh", [-60, -60])
    ).toThrow(/distinct/);
    expect(() => computePushSchedule(new Date(), "Not/AZone")).toThrow(
      /time zone/
    );
    const parsed = pnrgovScheduleInputSchema.parse({
      destinationCountry: "xa",
      authorityCode: "XANPSC",
      offsetsMinutes: [0, -1440],
      timingSource: "placeholder pending NPSC specification",
    });
    expect(parsed.destinationCountry).toBe("XA");
    expect(parsed.messageVersion).toBe("21:1");
    expect(parsed.isActive).toBe(true);
  });
});
