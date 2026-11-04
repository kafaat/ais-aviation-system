import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookings,
  bookingSegments,
  compensationClaims,
  flights,
  passengers,
} from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  autoAssessEligibility,
  createClaim,
  processClaim,
} from "./compensation.service";

describe("compensation ownership and review authority on relational rows", () => {
  let fixture: ReturnType<typeof authorityRelationalFixture>;
  const filing = {
    bookingId: 1,
    userId: 7,
    regulationType: "local" as const,
    claimType: "delay" as const,
  };
  const evidence = {
    policyReference: "file:reviewed-policy",
    fxReference: "file:dated-conversion",
    distanceReference: "file:route-distance",
    distanceKm: 900,
  };
  const approval = {
    claimId: 1,
    actorId: 42,
    decision: "approved" as const,
    approvedAmount: 12_345,
    evidence,
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-07-01T00:00:00Z"));
    fixture = authorityRelationalFixture([
      bookings,
      bookingSegments,
      passengers,
      compensationClaims,
      flights,
    ]);
    state.db = fixture.db;
    fixture.insert(bookings, {
      id: 1,
      userId: 7,
      flightId: 11,
      status: "cancelled",
      deletedAt: "2030-01-01 00:00:00",
    });
    fixture.insert(bookings, { id: 2, userId: 8, flightId: 22 });
    fixture.insert(passengers, { id: 10, bookingId: 1 });
    fixture.insert(passengers, { id: 20, bookingId: 2 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    state.db = null;
    fixture.close();
  });

  function seedClaim(status = "under_review") {
    fixture.insert(compensationClaims, {
      id: 1,
      bookingId: 1,
      flightId: 11,
      passengerId: 10,
      regulationType: "local",
      claimType: "delay",
      status,
      calculatedAmount: 0,
    });
  }

  // Inject only a database read failure. Ownership, predicates, inserts and
  // rollback still execute against stored rows through production Drizzle SQL.
  function failClaimRead(allowedReads = 0) {
    let reads = 0;
    const select = fixture.db.select.bind(fixture.db);
    vi.spyOn(fixture.db, "select").mockImplementation(fields => {
      const query = select(fields);
      const from = query.from.bind(query);
      vi.spyOn(query, "from").mockImplementation(table => {
        if (table === compensationClaims && reads++ >= allowedReads)
          throw new Error("claim readback unavailable");
        return from(table);
      });
      return query;
    });
  }

  it("files an unpriced review on an owned historical cancelled booking while holding its parent lock", async () => {
    const result = await createClaim({ ...filing, reason: "Arrival dispute" });
    expect(result).toMatchObject({
      bookingId: 1,
      flightId: 11,
      passengerId: 10,
      status: "under_review",
      calculatedAmount: null,
      approvedAmount: null,
      currency: "SAR",
      reason: "Arrival dispute",
    });
    expect(fixture.rows(compensationClaims)).toHaveLength(1);
    expect(fixture.rows(bookings)[0]).toMatchObject({ status: "cancelled" });
    expect(fixture.queries.every(query => query.inTransaction)).toBe(true);
    expect(fixture.queries[0].sql).toMatch(/from `bookings` .* for update$/i);
  });

  it.each([
    { bookingId: 2 },
    { bookingId: 999 },
    { userId: 8 },
    { flightId: 22 },
    { passengerId: 20 },
  ])(
    "rejects an unowned or unrelated filing %o without a claim",
    async changed => {
      await expect(
        createClaim({ ...filing, ...changed })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(fixture.rows(compensationClaims)).toHaveLength(0);
      expect(fixture.rows(passengers)).toHaveLength(2);
    }
  );

  it("requires a disrupted segment and preserves claims on a cancelled historical leg", async () => {
    fixture.insert(bookingSegments, {
      id: 1,
      bookingId: 1,
      flightId: 31,
      segmentOrder: 1,
      status: "cancelled",
    });
    fixture.insert(bookingSegments, {
      id: 2,
      bookingId: 1,
      flightId: 32,
      segmentOrder: 2,
      status: "confirmed",
    });
    await expect(createClaim(filing)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Choose the disrupted flight for this multi-segment booking",
    });
    await expect(
      createClaim({ ...filing, flightId: 11 })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      createClaim({ ...filing, flightId: 31 })
    ).resolves.toMatchObject({
      flightId: 31,
      status: "under_review",
    });
    expect(fixture.rows(compensationClaims)).toHaveLength(1);
  });

  it("requires a passenger choice for a group and accepts only a member", async () => {
    fixture.insert(passengers, { id: 12, bookingId: 1 });
    await expect(createClaim(filing)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Choose the passenger for this claim",
    });
    await expect(
      createClaim({ ...filing, passengerId: 12 })
    ).resolves.toMatchObject({
      passengerId: 12,
    });
    expect(fixture.rows(compensationClaims)).toHaveLength(1);
  });

  it("preserves the existing nullable passenger contract for a booking with no passenger rows", async () => {
    fixture.sqlite.exec("DELETE FROM passengers WHERE bookingId = 1");
    await expect(createClaim(filing)).resolves.toMatchObject({
      passengerId: null,
    });
  });

  it("rolls back an inserted claim when its final read fails", async () => {
    failClaimRead();
    await expect(createClaim(filing)).rejects.toThrow(
      "claim readback unavailable"
    );
    expect(fixture.rows(compensationClaims)).toHaveLength(0);
    expect(fixture.rows(bookings)).toHaveLength(2);
    expect(fixture.rows(passengers)).toHaveLength(2);
  });

  it("keeps eligibility unresolved and does not acquire a write lock for a read-only enquiry", async () => {
    await expect(autoAssessEligibility(1, "delay", 7)).resolves.toMatchObject({
      eligible: null,
      estimatedAmount: null,
      flightDistance: null,
      delayMinutes: null,
      assessmentStatus: "needs_review",
      flightId: 11,
    });
    expect(fixture.queries.every(query => !query.inTransaction)).toBe(true);
    expect(fixture.queries.some(query => /for update/i.test(query.sql))).toBe(
      false
    );
    await expect(autoAssessEligibility(1, "delay", 8)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixture.rows(compensationClaims)).toHaveLength(0);
  });

  it.each([
    ["pending", "approved"],
    ["under_review", "partial"],
    ["appealed", "approved"],
  ] as const)(
    "resolves %s through a recorded %s decision once",
    async (status, decision) => {
      seedClaim(status);
      const result = await processClaim({ ...approval, decision });
      expect(result).toMatchObject({
        status: "approved",
        calculatedAmount: 0,
        approvedAmount: 12_345,
        flightDistance: 900,
        denialReason: null,
        resolvedAt: new Date("2030-07-01T00:00:00Z"),
        reviewEvidence: {
          ...evidence,
          actorId: 42,
          reviewedAt: "2030-07-01T00:00:00.000Z",
        },
      });
      await expect(processClaim(approval)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(fixture.rows(compensationClaims)[0].approvedAmount).toBe(12_345);
      expect(fixture.queries.every(query => query.inTransaction)).toBe(true);
      expect(fixture.queries[0].sql).toMatch(/for update$/i);
    }
  );

  it.each(["approved", "denied", "paid"])(
    "cannot replace a resolved %s claim",
    async status => {
      seedClaim(status);
      const before = fixture.rows(compensationClaims);
      await expect(processClaim(approval)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(fixture.rows(compensationClaims)).toEqual(before);
    }
  );

  it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid manual amount %s without changing the claim",
    async approvedAmount => {
      seedClaim();
      const before = fixture.rows(compensationClaims);
      await expect(
        processClaim({ ...approval, approvedAmount })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(fixture.rows(compensationClaims)).toEqual(before);
    }
  );

  it("requires policy, conversion and distance evidence for a positive approval", async () => {
    seedClaim();
    await expect(
      processClaim({ ...approval, evidence: undefined })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(fixture.rows(compensationClaims)[0].status).toBe("under_review");
  });

  it.each([
    { distanceKm: 0 },
    { distanceKm: -1 },
    { distanceKm: 1.5 },
    { policyReference: " " },
    { fxReference: "" },
    { distanceReference: "\t" },
  ])("rejects incomplete review evidence %o", async changed => {
    seedClaim();
    const before = fixture.rows(compensationClaims);
    await expect(
      processClaim({ ...approval, evidence: { ...evidence, ...changed } })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(fixture.rows(compensationClaims)).toEqual(before);
  });

  it("requires a reason for denial and clears an obsolete appealed award without paying it", async () => {
    seedClaim("appealed");
    fixture.sqlite.exec(
      "UPDATE compensation_claims SET approvedAmount = 123, denialReason = 'old reason'"
    );
    await expect(
      processClaim({
        claimId: 1,
        actorId: 42,
        decision: "denied",
        denialReason: " ",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      processClaim({
        claimId: 1,
        actorId: 42,
        decision: "denied",
        denialReason: "Evidence review denies claim",
        approvedAmount: 999,
      })
    ).resolves.toMatchObject({
      status: "denied",
      approvedAmount: null,
      paidAt: null,
      denialReason: "Evidence review denies claim",
      reviewEvidence: { actorId: 42 },
    });
  });

  it("rolls back a review decision when the final read fails", async () => {
    seedClaim();
    const before = fixture.rows(compensationClaims);
    failClaimRead(1);
    await expect(processClaim(approval)).rejects.toThrow(
      "claim readback unavailable"
    );
    expect(fixture.rows(compensationClaims)).toEqual(before);
  });

  it("reports a missing claim without creating a review", async () => {
    await expect(processClaim(approval)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixture.rows(compensationClaims)).toHaveLength(0);
  });

  it("fails closed when the database is unavailable", async () => {
    state.db = null;
    await expect(createClaim(filing)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await expect(processClaim(approval)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    await expect(autoAssessEligibility(1, "delay", 7)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(fixture.rows(compensationClaims)).toHaveLength(0);
  });
});
