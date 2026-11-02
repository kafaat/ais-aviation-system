import { transactionMemory } from "./__tests__/helpers/transaction-memory";
import { processClaim } from "./services/compensation.service";

import { describe, expect, it, vi } from "vitest";
import { arrivalDelayTariffXdr } from "../shared/gaca-arrival-delay";

describe("GACA article 10 arrival-delay tariff in SDR", () => {
  it.each([
    [0, 0],
    [179.99, 0],
    [180, 50],
    [360, 50],
    [360.01, 150],
  ])("maps %s elapsed minutes to %s SDR", (minutes, expected) => {
    expect(arrivalDelayTariffXdr(minutes)).toBe(expected);
  });

  it.each([NaN, Infinity, -1])("rejects invalid delay %s", minutes => {
    expect(() => arrivalDelayTariffXdr(minutes)).toThrow(RangeError);
  });
});

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb }));

const evidence = {
  scopeAndExceptionReview: "file:operator-route-review",
  arrivalReference: "file:booked-and-actual-arrival",
  scheduledArrivalUtc: "2025-01-01T06:00:00Z",
  actualArrivalUtc: "2025-01-01T12:00:01Z",
  fxReference: "file:dated-test-quote",
  sarPerXdrMillionths: 5_123_456,
};
const approval = {
  claimId: 1,
  actorId: 2,
  decision: "approved" as const,
  gacaArrivalEvidence: evidence,
};
function setup(regulationType = "local") {
  const fixture = transactionMemory({
    compensation_claims: [
      {
        id: 1,
        claimType: "delay",
        status: "under_review",
        currency: "SAR",
        regulationType,
      },
    ],
  });
  getDb.mockReturnValue(fixture.db);
  return fixture;
}
describe("GACA assessed claim transaction", () => {
  it("prices from recorded evidence, preserves the basis and rejects replay", async () => {
    setup();
    const reviewed = await processClaim(approval);
    expect(reviewed).toMatchObject({
      status: "approved",
      approvedAmount: 76852,
      calculatedAmount: 76852,
      reviewEvidence: { tariffXdr: 150, ...evidence, actorId: 2 },
    });
    await expect(processClaim(approval)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("rejects a client amount override and leaves the claim reviewable", async () => {
    setup();
    await expect(
      processClaim({ ...approval, approvedAmount: 42 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(processClaim(approval)).resolves.toMatchObject({
      status: "approved",
    });
  });
  it("rejects a mismatched claim type or jurisdiction", async () => {
    setup("eu261");
    await expect(processClaim(approval)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it.each([
    { scheduledArrivalUtc: "2022-01-01T00:00:00Z" },
    { actualArrivalUtc: "2099-01-01T00:00:00Z" },
    { sarPerXdrMillionths: 0 },
  ])("rejects unsupported arrival or rate evidence %o", async changed => {
    setup();
    await expect(
      processClaim({
        ...approval,
        gacaArrivalEvidence: { ...evidence, ...changed },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("does not approve a positive award on sub-threshold evidence", async () => {
    setup();
    await expect(
      processClaim({
        ...approval,
        gacaArrivalEvidence: {
          ...evidence,
          actualArrivalUtc: evidence.scheduledArrivalUtc,
        },
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
