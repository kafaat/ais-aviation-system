/**
 * IATA Resolution 753 tracking: licence plates (Resolution 740), idempotent
 * tracking points, derived status, flight close-out sets, the mishandling KPI
 * proxy and the public tracker's field allow-list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import {
  allocateLicensePlate,
  deriveBagTrackingStatus,
  formatLicensePlate,
  getFlightBaggageCloseOut,
  getMishandledBaggageKpi,
  isPhysicalScanProof,
  LicensePlateUnavailable,
  parseLicensePlate,
  readBagTrackingForFlight,
  reconcileCloseOut,
  recordBagTrackingEvent,
  tryAllocateLicensePlate,
  type RecordTrackingInput,
} from "../services/baggage-tracking.service";
import { baggageRouter } from "../routers/baggage";

const T0 = new Date("2026-11-03T08:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3600000);
let fixture: ReturnType<typeof transactionMemory>;

function seed(extra: Record<string, any[]> = {}) {
  fixture = transactionMemory({
    airlines: [
      { id: 1, code: "SV", numericCode: "065", name: "Saudia" },
      { id: 2, code: "XX", numericCode: null, name: "Unconfigured" },
    ],
    airports: [
      { id: 1, code: "RUH" },
      { id: 2, code: "JED" },
      { id: 3, code: "DXB" },
    ],
    flights: [
      {
        id: 11,
        airlineId: 1,
        flightNumber: "SV100",
        originId: 1,
        destinationId: 2,
        status: "completed",
        departureTime: hours(-12),
        arrivalTime: hours(-10),
      },
      {
        id: 12,
        airlineId: 1,
        flightNumber: "SV200",
        originId: 2,
        destinationId: 3,
        status: "scheduled",
        departureTime: hours(5),
        arrivalTime: hours(8),
      },
    ],
    bookings: [
      {
        id: 7,
        userId: 1,
        flightId: 11,
        status: "confirmed",
        paymentStatus: "paid",
        pnr: "ABC123",
        bookingReference: "ABC123",
        checkedIn: true,
      },
      {
        id: 8,
        userId: 2,
        flightId: 11,
        status: "confirmed",
        paymentStatus: "paid",
        pnr: "DEF456",
        bookingReference: "DEF456",
        checkedIn: false,
      },
    ],
    passengers: [
      { id: 70, bookingId: 7, firstName: "Amal", lastName: "Saleh" },
      { id: 80, bookingId: 8, firstName: "Omar", lastName: "Nasser" },
    ],
    baggage_items: [
      {
        id: 1,
        bookingId: 7,
        passengerId: 70,
        tagNumber: "0065000001",
        licensePlate: "0065000001",
        weight: "23.00",
        status: "checked_in",
      },
      {
        id: 2,
        bookingId: 8,
        passengerId: 80,
        tagNumber: "0065000002",
        licensePlate: "0065000002",
        weight: "18.50",
        status: "checked_in",
      },
      {
        id: 3,
        bookingId: 7,
        passengerId: 70,
        tagNumber: "AIS1234567",
        licensePlate: null,
        weight: "10.00",
        status: "checked_in",
      },
    ],
    ...extra,
  });
  boundary.db = fixture.db;
  return fixture;
}

function point(
  baggageId: number,
  trackingPoint: RecordTrackingInput["trackingPoint"],
  stationCode: string,
  observedAt: Date,
  overrides: Partial<RecordTrackingInput> = {}
): RecordTrackingInput {
  return {
    baggageId,
    flightId: 11,
    trackingPoint,
    stationCode,
    observedAt,
    sourceId: "handler-brs",
    deviceId: "scanner-1",
    actorType: "handler",
    actorId: "handler-brs",
    scanMethod: "scanner",
    origin: "handler",
    ...overrides,
  };
}

beforeEach(() => {
  seed();
});

describe("licence plates (IATA Resolution 740)", () => {
  it("formats a 10-digit plate: leading digit, 3-digit airline code, 6-digit serial", () => {
    expect(formatLicensePlate("065", 1)).toBe("0065000001");
    expect(formatLicensePlate("065", 999999)).toBe("0065999999");
    expect(formatLicensePlate("065", 42, 1)).toBe("1065000042");
    expect(parseLicensePlate("0065000042")).toEqual({
      leadingDigit: 0,
      interline: true,
      airlineNumericCode: "065",
      serial: 42,
    });
    expect(parseLicensePlate("AIS1234567")).toBeNull();
    expect(() => formatLicensePlate("65", 1)).toThrow(/three digits/);
    expect(() => formatLicensePlate("065", 0)).toThrow(/out of range/);
    expect(() => formatLicensePlate("065", 1000000)).toThrow(/out of range/);
  });

  it("allocates distinct, monotonically increasing serials under a row lock", async () => {
    const first = await allocateLicensePlate(fixture.db, 1);
    const second = await allocateLicensePlate(fixture.db, 1);
    expect(first).toMatchObject({
      licensePlate: "0065000001",
      serial: 1,
      numericCode: "065",
    });
    expect(second.licensePlate).toBe("0065000002");
    expect(fixture.lockedTables).toContain("bag_tag_sequences");
    expect(fixture.rows("bag_tag_sequences")).toEqual([
      expect.objectContaining({ airlineId: 1, nextSequence: 3 }),
    ]);
  });

  it("never hands two concurrent acceptances the same serial", async () => {
    seed({
      bag_tag_sequences: [
        { id: 1, airlineId: 1, numericCode: "065", nextSequence: 1 },
      ],
    });
    const results = await Promise.allSettled([
      allocateLicensePlate(fixture.db, 1),
      allocateLicensePlate(fixture.db, 1),
    ]);
    const plates = results.flatMap(r =>
      r.status === "fulfilled" ? [r.value.licensePlate] : []
    );
    expect(plates.length).toBeGreaterThan(0);
    expect(new Set(plates).size).toBe(plates.length);
    for (const r of results)
      if (r.status === "rejected")
        expect(r.reason).toMatchObject({ code: "CONFLICT" });
  });

  it("refuses allocation without an airline numeric code and when the range is exhausted", async () => {
    await expect(allocateLicensePlate(fixture.db, 2)).rejects.toBeInstanceOf(
      LicensePlateUnavailable
    );
    expect(await tryAllocateLicensePlate(fixture.db, 2)).toBeNull();
    await expect(allocateLicensePlate(fixture.db, 99)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    seed({
      bag_tag_sequences: [
        { id: 1, airlineId: 1, numericCode: "065", nextSequence: 1000000 },
      ],
    });
    await expect(allocateLicensePlate(fixture.db, 1)).rejects.toThrow(
      /exhausted/
    );
  });
});

describe("tracking points (IATA Resolution 753)", () => {
  it("treats the same bag, point and station within the window as one observation", async () => {
    const first = await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "RUH", hours(-14))
    );
    const replay = await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "ruh", hours(-14 + 10 / 60), {
        deviceId: "scanner-2",
      })
    );
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ eventId: first.eventId, duplicate: true });
    const later = await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "RUH", hours(-14 + 20 / 60))
    );
    const elsewhere = await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "JED", hours(-14))
    );
    expect(later.duplicate).toBe(false);
    expect(elsewhere.duplicate).toBe(false);
    expect(fixture.rows("bag_tracking_events")).toHaveLength(3);
    expect(fixture.rows("baggage_tracking")).toHaveLength(3);
    expect(fixture.rows("baggage_items")[0]).toMatchObject({
      status: "checked_in",
      lastLocation: "JED",
    });
  });

  it("rejects an unknown bag and a non-IATA station", async () => {
    await expect(
      recordBagTrackingEvent(fixture.db, point(99, "loading", "RUH", T0))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      recordBagTrackingEvent(fixture.db, point(1, "loading", "RIYADH", T0))
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("bag_tracking_events")).toHaveLength(0);
  });

  it("marks only a handler scanner read as physical-scan proof", async () => {
    expect(isPhysicalScanProof("handler", "scanner")).toBe(true);
    expect(isPhysicalScanProof("handler", "bsm")).toBe(false);
    expect(isPhysicalScanProof("system", "scanner")).toBe(false);
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "RUH", hours(-14), {
        origin: "system",
        scanMethod: "manual",
        actorType: "user",
        actorId: "5",
        sourceId: "ais-admin:5",
      })
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "loading", "RUH", hours(-13))
    );
    const [counter, ramp] = fixture.rows("bag_tracking_events");
    expect(counter).toMatchObject({
      origin: "system",
      scanMethod: "manual",
      physicalScanVerified: false,
      licensePlate: "0065000001",
    });
    expect(ramp).toMatchObject({
      origin: "handler",
      scanMethod: "scanner",
      physicalScanVerified: true,
    });
  });

  it("derives the bag status from the latest observed point", () => {
    expect(deriveBagTrackingStatus([])).toMatchObject({
      status: "not_tracked",
      lastPoint: null,
      corePointsObserved: 0,
    });
    const derived = deriveBagTrackingStatus([
      {
        trackingPoint: "loading",
        observedAt: hours(-13),
        physicalScanVerified: true,
      },
      {
        trackingPoint: "acceptance",
        observedAt: hours(-14),
        physicalScanVerified: false,
      },
      {
        trackingPoint: "arrival",
        observedAt: hours(-9),
        physicalScanVerified: true,
      },
    ]);
    expect(derived).toMatchObject({
      status: "arrived",
      lastPoint: "arrival",
      lastObservedAt: hours(-9),
      corePointsObserved: 3,
      physicalScanPoints: 2,
    });
    expect(derived.observedPoints).toEqual({
      acceptance: true,
      security: false,
      loading: true,
      transfer: false,
      arrival: true,
    });
    expect(
      deriveBagTrackingStatus([
        {
          trackingPoint: "transfer",
          observedAt: hours(-8),
          physicalScanVerified: false,
        },
        {
          trackingPoint: "arrival",
          observedAt: hours(-8),
          physicalScanVerified: false,
        },
      ]).status
    ).toBe("in_transfer");
  });
});

describe("flight close-out reconciliation", () => {
  async function journey() {
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "RUH", hours(-14))
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "loading", "RUH", hours(-13), { containerId: "AKE12345SV" })
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(2, "acceptance", "RUH", hours(-14))
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(2, "loading", "RUH", hours(-13))
    );
  }

  it("lists offload candidates and leaves boarding sets null without a boarding record", async () => {
    await journey();
    const result = await getFlightBaggageCloseOut(11);
    expect(result.flight).toMatchObject({
      id: 11,
      flightNumber: "SV100",
      originCode: "RUH",
      destinationCode: "JED",
    });
    expect(result.boardingEvidence).toBe("none");
    expect(result.acceptedNotLoaded.map(b => b.baggageId)).toEqual([3]);
    expect(result.acceptedNotLoaded[0]).toMatchObject({
      licensePlate: null,
      trackedOnFlight: false,
      accepted: true,
    });
    expect(result.loadedForNotBoarded).toBeNull();
    expect(result.boardedWithoutLoadedBags).toBeNull();
    expect(result.totals).toEqual({
      bags: 3,
      accepted: 3,
      loaded: 2,
      passengers: 2,
      boarded: null,
    });
  });

  it("applies the no-bag-without-passenger rule once boarding is provided", async () => {
    await journey();
    const result = await getFlightBaggageCloseOut(11, {
      boardedPassengerIds: [70],
    });
    expect(result.boardingEvidence).toBe("provided");
    expect(result.loadedForNotBoarded?.map(b => b.baggageId)).toEqual([2]);
    expect(result.loadedForNotBoarded?.[0]).toMatchObject({
      passengerSurname: "Nasser",
      pnr: "DEF456",
    });
    expect(result.boardedWithoutLoadedBags?.map(p => p.passengerId)).toEqual([
      70,
    ]);
    expect(result.boardedWithoutLoadedBags?.[0]).toMatchObject({
      surname: "Saleh",
      checkedIn: true,
    });
    expect(result.totals.boarded).toBe(1);
  });

  it("reconciles pure sets without a database", () => {
    const bags = [
      { baggageId: 1, passengerId: 70, accepted: true, loaded: true },
      { baggageId: 2, passengerId: 80, accepted: true, loaded: true },
      { baggageId: 3, passengerId: 70, accepted: true, loaded: false },
      { baggageId: 4, passengerId: 90, accepted: false, loaded: false },
    ].map(b => ({
      ...b,
      licensePlate: null,
      tagNumber: `T${b.baggageId}`,
      passengerSurname: "",
      pnr: "",
      trackedOnFlight: true,
      containerId: null,
    }));
    const people = [70, 80, 90].map(id => ({
      passengerId: id,
      surname: "",
      givenName: "",
      pnr: "",
      checkedIn: true,
    }));
    const result = reconcileCloseOut(bags, people, {
      source: "provided",
      passengerIds: [70, 90],
    });
    expect(result.acceptedNotLoaded.map(b => b.baggageId)).toEqual([3]);
    expect(result.loadedForNotBoarded?.map(b => b.baggageId)).toEqual([2]);
    expect(result.boardedWithoutLoadedBags?.map(p => p.passengerId)).toEqual([
      70,
    ]);
    expect(result.totals).toEqual({
      bags: 4,
      accepted: 3,
      loaded: 2,
      passengers: 3,
      boarded: 2,
    });
  });

  it("exposes a per-flight snapshot keyed by licence plate for BSM/BPM generation", async () => {
    await journey();
    const snapshot = await readBagTrackingForFlight(11);
    expect(snapshot.bags.map(b => b.licensePlate)).toEqual([
      "0065000001",
      "0065000002",
      null,
    ]);
    expect(snapshot.bags[0]).toMatchObject({
      pnr: "ABC123",
      passengerSurname: "Saleh",
      passengerGivenName: "Amal",
      weightKg: "23.00",
      flightIds: [11],
      derived: { status: "loaded", corePointsObserved: 2 },
    });
    expect(snapshot.events).toHaveLength(4);
    expect(
      snapshot.events.find(
        e => e.baggageId === 1 && e.trackingPoint === "loading"
      )
    ).toMatchObject({
      licensePlate: "0065000001",
      flightId: 11,
      stationCode: "RUH",
      containerId: "AKE12345SV",
      origin: "handler",
      physicalScanVerified: true,
    });
  });
});

describe("mishandled-bag KPI proxy", () => {
  it("counts tracked bags without an arrival event within the window per 1,000 passengers", async () => {
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "loading", "RUH", hours(-13))
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "arrival", "JED", hours(-9))
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(2, "loading", "RUH", hours(-13))
    );
    // Arrival after the 4-hour window still counts as mishandled.
    await recordBagTrackingEvent(
      fixture.db,
      point(2, "arrival", "JED", hours(-5))
    );
    const kpi = await getMishandledBaggageKpi({
      from: hours(-24),
      to: hours(24),
      now: T0,
    });
    expect(kpi.flights.map(f => f.flightId)).toEqual([11]);
    expect(kpi).toMatchObject({
      passengers: 2,
      bagsTracked: 2,
      bagsWithoutArrival: 1,
      perThousandPassengers: 500,
      benchmarks: { sita2025GlobalPerThousand: 4.9 },
    });
    const widened = await getMishandledBaggageKpi({
      from: hours(-24),
      to: hours(24),
      hoursAfterArrival: 6,
      now: T0,
    });
    expect(widened.bagsWithoutArrival).toBe(0);
    expect(widened.perThousandPassengers).toBe(0);
  });
});

describe("public licence-plate tracker", () => {
  const anonymous = () =>
    baggageRouter.createCaller({
      user: null,
      tenantId: null,
      req: { headers: {} },
      res: {},
    } as never);

  it("requires the surname or booking reference and returns only allow-listed fields", async () => {
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "acceptance", "RUH", hours(-14), {
        origin: "system",
        scanMethod: "manual",
        actorType: "user",
        actorId: "5",
      })
    );
    await recordBagTrackingEvent(
      fixture.db,
      point(1, "loading", "RUH", hours(-13))
    );
    await expect(
      anonymous().trackByLicensePlate({ licensePlate: "0065000001" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      anonymous().trackByLicensePlate({
        licensePlate: "0065000001",
        surname: "Nasser",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      anonymous().trackByLicensePlate({
        licensePlate: "0065000002",
        bookingReference: "ABC123",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tracked = await anonymous().trackByLicensePlate({
      licensePlate: "0065000001",
      surname: "saleh",
    });
    expect(Object.keys(tracked).sort()).toEqual([
      "lastObservedAt",
      "lastStationCode",
      "licensePlate",
      "points",
      "status",
    ]);
    expect(tracked).toMatchObject({
      licensePlate: "0065000001",
      status: "loaded",
      lastStationCode: "RUH",
    });
    expect(tracked.points.map(p => Object.keys(p).sort())).toEqual([
      ["observedAt", "physicalScanVerified", "stationCode", "trackingPoint"],
      ["observedAt", "physicalScanVerified", "stationCode", "trackingPoint"],
    ]);
    expect(tracked.points.map(p => p.physicalScanVerified)).toEqual([
      false,
      true,
    ]);
    const byReference = await anonymous().trackByLicensePlate({
      licensePlate: "0065000001",
      bookingReference: "abc123",
    });
    expect(byReference.status).toBe("loaded");
    for (const key of ["bookingId", "passengerId", "sourceId", "deviceId"])
      expect(JSON.stringify(tracked)).not.toContain(`"${key}"`);
  });
});
