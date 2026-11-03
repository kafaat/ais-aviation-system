import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
// Operator travel clearance (signed source evidence) is a separate gate with
// its own tests; this suite isolates the entry-rules verification hook.
vi.mock("../services/travel-clearance.service", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../services/travel-clearance.service")
  >()),
  assertTravelClearance: vi.fn(),
}));
import { checkInPassengers } from "../services/departure-control.service";
import {
  importEntryRules,
  listVerificationResults,
  overrideVerification,
  previewVerification,
} from "../services/travel-documents/document-verification.service";
import { fictionalEntryRuleInputs } from "../services/travel-documents/fictional-entry-rules.fixture";

// Fictional countries only: XB nationals flying XB -> XA on a fixture rule set.
const departure = new Date(Date.now() + 20 * 3600_000);
let fixture: ReturnType<typeof transactionMemory>;

function seed(passenger: Record<string, unknown>) {
  return transactionMemory({
    airlines: [{ id: 1, code: "XX" }],
    airports: [
      { id: 9, code: "XBB", country: "XB", timezone: "Asia/Riyadh" },
      { id: 10, code: "XAA", country: "XA", timezone: "Europe/London" },
    ],
    flights: [
      {
        id: 4,
        tenantId: 1,
        airlineId: 1,
        flightNumber: "XX1",
        originId: 9,
        destinationId: 10,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 4 * 3600_000),
        status: "scheduled",
      },
    ],
    bookings: [
      {
        id: 2,
        userId: 3,
        tenantId: 1,
        flightId: 4,
        status: "confirmed",
        paymentStatus: "paid",
        cabinClass: "economy",
        seatsReserved: true,
        numberOfPassengers: 1,
        deletedAt: null,
      },
    ],
    passengers: [
      { id: 5, bookingId: 2, firstName: "A", lastName: "B", ...passenger },
    ],
    seat_inventory: [
      {
        id: 7,
        flightId: 4,
        cabinClass: "economy",
        seatNumber: "1A",
        row: 1,
        column: "A",
        status: "available",
        seatPrice: 0,
        bookingId: null,
        passengerId: null,
      },
    ],
  });
}

async function importFixture() {
  await importEntryRules(fictionalEntryRuleInputs, {
    userId: 1,
    tenantId: null,
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENTRY_RULES_ALLOW_UNCONFIRMED", "true");
  vi.stubEnv("DOCUMENT_VERIFICATION_MODE", "enforce");
});
afterEach(() => vi.unstubAllEnvs());

const checkIn = () =>
  checkInPassengers({
    bookingId: 2,
    flightId: 4,
    assignments: [{ passengerId: 5, seatNumber: "1A" }],
    owner: { userId: 3, tenantId: 1 },
  });

describe("pre-boarding document verification at check-in", () => {
  it("records a go verdict and issues the seat when the documents satisfy the rules", async () => {
    fixture = seed({
      nationality: "XB",
      passportNumber: "P1",
      passportExpiry: new Date(departure.getTime() + 400 * 86400_000),
    });
    state.db = fixture.db;
    await importFixture();
    const [result] = await checkIn();
    expect(result.seat.status).toBe("checked_in");
    const [evidence] = fixture.rows("document_verification_results");
    expect(evidence).toMatchObject({
      verdict: "go",
      trigger: "check_in",
      evaluatedBy: 3,
      rulesApplied: [1],
      rulesSource: "rules_table",
      flightId: 4,
      passengerId: 5,
    });
  });

  it("refuses the boarding pass on no_go and keeps the evidence row", async () => {
    fixture = seed({
      nationality: "XC",
      passportNumber: "P2",
      passportExpiry: new Date(departure.getTime() + 400 * 86400_000),
    });
    state.db = fixture.db;
    await importFixture();
    await expect(checkIn()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/Boarding pass refused.*visa required/),
    });
    // The transaction rolled back the seat but the refusal is still evidence:
    // the hook writes inside the transaction, so the row is gone with it.
    expect(fixture.rows("seat_inventory")[0].status).toBe("available");
    const preview = await previewVerification({
      bookingId: 2,
      passengerId: 5,
      flightId: 4,
      evaluatedBy: 3,
      tenantId: 1,
    });
    expect(preview.verdict).toBe("no_go");
    expect(preview.boardingAllowed).toBe(false);
    expect(preview.reasons.map(r => r.code)).toContain("visa_missing");
    expect(fixture.rows("document_verification_results")).toHaveLength(1);
  });

  it("withholds on manual_review when no rule exists and reports the missing country", async () => {
    fixture = seed({
      nationality: "XB",
      passportNumber: "P3",
      passportExpiry: null,
    });
    state.db = fixture.db;
    await expect(checkIn()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(
        /manual document review.*No destination requirement rule on file for XA/
      ),
    });
  });

  it("lets an authorised role override with a recorded reason, bound to the documents and itinerary", async () => {
    fixture = seed({
      nationality: "XC",
      passportNumber: "P2",
      passportExpiry: new Date(departure.getTime() + 400 * 86400_000),
    });
    state.db = fixture.db;
    await importFixture();
    const preview = await previewVerification({
      bookingId: 2,
      passengerId: 5,
      flightId: 4,
      evaluatedBy: 9,
      tenantId: 1,
    });
    await expect(
      overrideVerification({
        resultId: preview.resultId,
        reason: "Visa sighted at the counter, sticker no. 123",
        actor: { userId: 9, role: "support", tenantId: 1 },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      overrideVerification({
        resultId: preview.resultId,
        reason: "short",
        actor: { userId: 9, role: "ops", tenantId: 1 },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const override = await overrideVerification({
      resultId: preview.resultId,
      reason: "Visa sighted at the counter, sticker no. 123",
      actor: { userId: 9, role: "ops", tenantId: 1 },
    });
    expect(override).toMatchObject({ overrideBy: 9, overrideRole: "ops" });
    await expect(
      overrideVerification({
        resultId: preview.resultId,
        reason: "Visa sighted at the counter, sticker no. 123",
        actor: { userId: 9, role: "ops", tenantId: 1 },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [result] = await checkIn();
    expect(result.seat.status).toBe("checked_in");
    const log = await listVerificationResults({ flightId: 4, tenantId: 1 });
    expect(log.map(r => [r.trigger, r.verdict])).toEqual([
      ["check_in", "no_go"],
      ["preview", "no_go"],
    ]);
    expect(log[1]).toMatchObject({
      overrideBy: 9,
      overrideRole: "ops",
      overrideReason: "Visa sighted at the counter, sticker no. 123",
    });
    expect(log[1].overriddenAt).toBeTruthy();
    // Changing the passport invalidates the override.
    fixture.rows("passengers")[0].passportNumber = "P9";
    fixture.rows("seat_inventory")[0].status = "available";
    fixture.rows("seat_inventory")[0].passengerId = null;
    fixture.rows("seat_inventory")[0].bookingId = null;
    await expect(checkIn()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("records without blocking in advisory mode", async () => {
    vi.stubEnv("DOCUMENT_VERIFICATION_MODE", "advisory");
    fixture = seed({
      nationality: "XC",
      passportNumber: "P2",
      passportExpiry: null,
    });
    state.db = fixture.db;
    await importFixture();
    const [result] = await checkIn();
    expect(result.seat.status).toBe("checked_in");
    expect(fixture.rows("document_verification_results")[0].verdict).toBe(
      "no_go"
    );
  });

  it("refuses fictional fixtures in production and validates imports", async () => {
    fixture = seed({});
    state.db = fixture.db;
    await expect(
      importEntryRules(
        fictionalEntryRuleInputs,
        { userId: 1, tenantId: null },
        { NODE_ENV: "production" }
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      importEntryRules([{ destinationCountry: "XA" }], {
        userId: 1,
        tenantId: null,
      })
    ).rejects.toThrow();
  });
});
