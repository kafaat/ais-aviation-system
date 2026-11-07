import type { TrpcContext } from "../_core/context";
import { compensationRouter } from "../routers/compensation";
import { transactionMemory } from "./helpers/transaction-memory";
import { processClaim } from "../services/compensation.service";
import {
  evaluateForReview,
  loadRuleCatalog,
} from "../services/passenger-rights.service";
import {
  openRefundDeadline,
  settleRefundDeadlines,
  listRefundDeadlines,
} from "../services/passenger-rights-refund.service";
import { describe, expect, it, vi } from "vitest";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

const NOW = Date.now();
const scheduledArrival = new Date("2025-06-01T10:00:00Z");
function claimRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    bookingId: 8,
    passengerId: 20,
    flightId: 19,
    flightDistance: null,
    delayMinutes: null,
    calculatedAmount: null,
    approvedAmount: null,
    reason: null,
    denialReason: null,
    reviewEvidence: null,
    paidAt: null,
    filedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "under_review",
    currency: "SAR",
    ...overrides,
  };
}
function setup(input: {
  claim: Record<string, unknown>;
  route?: { dep: string; arr: string; carrier: string };
  fx?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
}) {
  const route = input.route ?? { dep: "SA", arr: "SA", carrier: "SA" };
  const fixture = transactionMemory({
    compensation_claims: [claimRow(input.claim)],
    flights: [
      {
        id: 19,
        flightNumber: "SV1010",
        airlineId: 3,
        originId: 1,
        destinationId: 2,
        departureTime: new Date("2025-06-01T06:00:00Z"),
        arrivalTime: scheduledArrival,
      },
    ],
    airports: [
      { id: 1, code: "JED", country: route.dep, city: "A", name: "A" },
      { id: 2, code: "RUH", country: route.arr, city: "B", name: "B" },
    ],
    airlines: [{ id: 3, code: "SV", country: route.carrier, name: "Saudia" }],
    bookings: [{ id: 8, userId: 4, totalAmount: 240_000 }],
    passengers: [
      { id: 20, bookingId: 8 },
      { id: 21, bookingId: 8 },
    ],
    exchange_rates: input.fx ?? [
      {
        id: 11,
        fromCurrency: "XDR",
        toCurrency: "SAR",
        rate: "5.12345600",
        source: "imf:test",
        validFrom: new Date("2025-01-01T00:00:00Z"),
        updatedAt: new Date("2025-01-01T00:00:00Z"),
      },
    ],
    passenger_rights_rule_sets: [],
    passenger_rights_rules: [],
    passenger_rights_refund_deadlines: [],
    ...(input.rules && {
      passenger_rights_rule_sets: [
        {
          id: 1,
          jurisdiction: "KSA-GACA-2023",
          version: "test",
          effectiveFrom: new Date("2023-11-19T21:00:00Z"),
          effectiveTo: null,
          sourceUrl: "https://gaca.gov.sa/test",
          sourceKind: "official",
          confirmationStatus: "secondary",
          governingLanguage: "ar",
          notes: "",
        },
      ],
      passenger_rights_rules: input.rules,
    }),
  });
  getDb.mockReturnValue(fixture.db);
  return fixture;
}
const actualArrivalUtc = new Date(
  scheduledArrival.getTime() + 361 * 60_000
).toISOString();
const rightsEvidence = {
  ruleCode: "KSA-GACA-2023.arrival_delay.10-6.tier2",
  scopeAndExceptionReview: "file:operator-route-review",
  factsReference: "file:actual-arrival-aodb",
  facts: { actualArrivalUtc },
  fxRecordId: 11,
};
const approval = {
  claimId: 1,
  actorId: 2,
  decision: "approved" as const,
  rightsEvidence,
};

describe("engine-backed claim review", () => {
  it("awards a GACA 10(6) delay from the flight record and a named FX record, storing the trace", async () => {
    setup({ claim: { regulationType: "local", claimType: "delay" } });
    const reviewed = await processClaim(approval);
    expect(reviewed).toMatchObject({
      status: "approved",
      approvedAmount: 76_852,
      calculatedAmount: 76_852,
      delayMinutes: 361,
    });
    const evidence = reviewed.reviewEvidence as Record<string, unknown>;
    expect(evidence).toMatchObject({
      basis: "passenger-rights-engine",
      ruleCode: rightsEvidence.ruleCode,
      ruleSource: "built-in",
      fxRecordId: 11,
      actorId: 2,
    });
    const evaluation = evidence.evaluation as {
      jurisdictions: Array<{ jurisdiction: string; status: string }>;
      entitlements: Array<{ ruleCode: string; status: string }>;
      inputs: { fxRecordIds: number[] };
      rulesConsidered: string[];
    };
    expect(evaluation.inputs.fxRecordIds).toEqual([11]);
    expect(evaluation.rulesConsidered).toEqual([
      "KSA-GACA-2023.arrival_delay.10-6.tier1",
      "KSA-GACA-2023.arrival_delay.10-6.tier2",
    ]);
    expect(
      evaluation.jurisdictions.find(j => j.jurisdiction === "KSA-GACA-2023")
    ).toMatchObject({ status: "applicable" });
    expect(
      evaluation.jurisdictions.find(j => j.jurisdiction === "EU261-2004")
    ).toMatchObject({ status: "not_applicable" });
    await expect(processClaim(approval)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("refuses a rule outside the filed jurisdiction, mixed bases and client amounts", async () => {
    setup({ claim: { regulationType: "local", claimType: "delay" } });
    await expect(
      processClaim({
        ...approval,
        rightsEvidence: {
          ...rightsEvidence,
          ruleCode: "EU261-2004.art7.short",
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      processClaim({ ...approval, approvedAmount: 1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      processClaim({ ...approval, decision: "partial" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(processClaim(approval)).resolves.toMatchObject({
      status: "approved",
    });
  });

  it("does not award when the FX record is missing or the delay is below threshold", async () => {
    setup({
      claim: { regulationType: "local", claimType: "delay" },
      fx: [],
    });
    await expect(
      processClaim({
        ...approval,
        rightsEvidence: { ...rightsEvidence, fxRecordId: undefined },
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("fx_required"),
    });
    await expect(processClaim(approval)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("FX record"),
    });
    setup({ claim: { regulationType: "local", claimType: "delay" } });
    await expect(
      processClaim({
        ...approval,
        rightsEvidence: {
          ...rightsEvidence,
          facts: {
            actualArrivalUtc: new Date(
              scheduledArrival.getTime() + 100 * 60_000
            ).toISOString(),
          },
        },
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      processClaim({
        ...approval,
        rightsEvidence: {
          ...rightsEvidence,
          facts: { actualArrivalUtc: new Date(NOW + 86_400_000).toISOString() },
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("withholds a secondary-source percentage award until the operator confirms the rule", async () => {
    const rule = {
      id: 1,
      ruleSetId: 1,
      ruleCode: "KSA-GACA-2023.denied_boarding.percentage",
      jurisdiction: "KSA-GACA-2023",
      claimTypes: ["denied_boarding"],
      title: "Denied boarding 200%",
      article: null,
      definition: {
        amount: { kind: "percentage_of_ticket", percent: 200 },
        sources: [
          { url: "https://argaam.test", title: "Argaam", kind: "secondary" },
        ],
        exclusionChecks: { voluntaryDeniedBoarding: true },
      },
      confirmationStatus: "secondary",
      disputeGroup: null,
      candidate: null,
      isActive: true,
      confirmedAt: null,
      confirmedBy: null,
      confirmationReference: null,
      rejectedAt: null,
      rejectedBy: null,
    };
    const evidence = {
      ruleCode: rule.ruleCode,
      scopeAndExceptionReview: "file:scope-review",
      factsReference: "file:dnb-report",
      facts: { deniedBoarding: { involuntary: true } },
    };
    setup({
      claim: { regulationType: "local", claimType: "denied_boarding" },
      rules: [rule],
    });
    await expect(
      processClaim({
        claimId: 1,
        actorId: 2,
        decision: "approved",
        rightsEvidence: evidence,
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("needs_confirmation"),
    });
    setup({
      claim: { regulationType: "local", claimType: "denied_boarding" },
      rules: [
        {
          ...rule,
          confirmedAt: new Date("2026-11-01T00:00:00Z"),
          confirmedBy: 9,
          confirmationReference: "legal:article-check",
        },
      ],
    });
    const reviewed = await processClaim({
      claimId: 1,
      actorId: 2,
      decision: "approved",
      rightsEvidence: evidence,
    });
    // 200% of the per-passenger share of the booking total (240,000 / 2 passengers)
    expect(reviewed.approvedAmount).toBe(240_000);
    expect(reviewed.reviewEvidence).toMatchObject({ ruleSource: "database" });
  });

  it("refuses disputed baggage-delay candidates until exactly one is confirmed", async () => {
    const base = {
      ruleSetId: 1,
      jurisdiction: "KSA-GACA-2023",
      claimTypes: ["baggage_delay"],
      article: null,
      confirmationStatus: "disputed",
      disputeGroup: "ksa-baggage-delay-daily",
      isActive: true,
      confirmedAt: null,
      confirmedBy: null,
      confirmationReference: null,
      rejectedAt: null,
      rejectedBy: null,
    };
    const candidates = [
      {
        ...base,
        id: 1,
        ruleCode: "KSA-GACA-2023.baggage_delay.daily.A",
        title: "A",
        candidate: "A",
        definition: {
          thresholds: { delayDays: { gte: 1 } },
          amount: {
            kind: "daily_capped",
            currency: "SAR",
            firstDayMinorUnits: 74_000,
            dailyMinorUnits: 30_000,
            maxDays: 5,
          },
          sources: [],
        },
      },
      {
        ...base,
        id: 2,
        ruleCode: "KSA-GACA-2023.baggage_delay.daily.B-domestic",
        title: "B",
        candidate: "B",
        definition: {
          thresholds: { delayDays: { gte: 1 }, routeScope: "domestic" },
          amount: {
            kind: "daily_capped",
            currency: "SAR",
            dailyMinorUnits: 10_000,
            maxDays: 5,
          },
          sources: [],
        },
      },
    ];
    const evidence = {
      ruleCode: "KSA-GACA-2023.baggage_delay.daily.A",
      scopeAndExceptionReview: "file:scope-review",
      factsReference: "file:pir-and-delivery",
      facts: { baggage: { delayDays: 2 } },
    };
    setup({
      claim: { regulationType: "local", claimType: "baggage_delay" },
      rules: candidates,
    });
    await expect(
      processClaim({
        claimId: 1,
        actorId: 2,
        decision: "approved",
        rightsEvidence: evidence,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("blocked_disputed"),
    });
    setup({
      claim: { regulationType: "local", claimType: "baggage_delay" },
      rules: [
        {
          ...candidates[0],
          confirmedAt: new Date(),
          confirmationReference: "ar-text",
        },
        candidates[1],
      ],
    });
    const reviewed = await processClaim({
      claimId: 1,
      actorId: 2,
      decision: "approved",
      rightsEvidence: evidence,
    });
    expect(reviewed.approvedAmount).toBe(74_000 + 30_000);
  });

  it("flags EU261 as not applicable for a Saudi carrier flying into the EU", async () => {
    const fixture = setup({
      claim: { regulationType: "eu261", claimType: "delay" },
      route: { dep: "SA", arr: "FR", carrier: "SA" },
    });
    const review = await evaluateForReview(fixture.db, {
      flightId: 19,
      bookingId: 8,
      claimType: "delay",
      regulationType: "eu261",
      settlementCurrency: "SAR",
      facts: { actualArrivalUtc },
      factsReference: "file:aodb",
      distanceKm: 4_500,
      distanceReference: "gcmap",
      now: new Date(NOW),
    });
    expect(
      review.evaluation.jurisdictions.find(j => j.jurisdiction === "EU261-2004")
    ).toMatchObject({
      status: "not_applicable",
      reasons: [expect.stringContaining("non-Community carrier")],
    });
    expect(review.evaluation.entitlements).toEqual([]);
    expect((await loadRuleCatalog(fixture.db)).source).toBe("built-in");
  });
});

describe("US DOT refund deadlines", () => {
  it("opens a card deadline seven business days out and lists it as overdue after the date", async () => {
    const fixture = setup({
      claim: { regulationType: "dot", claimType: "cancellation" },
    });
    const opened = await openRefundDeadline(fixture.db, {
      bookingId: 8,
      trigger: "carrier_cancellation",
      tenderClass: "card",
      triggeredAt: new Date("2026-11-06T15:00:00Z"), // Friday
      openedBy: 2,
    });
    expect(opened.dueAt.toISOString()).toBe("2026-11-17T15:00:00.000Z");
    expect(opened.basis).toMatch(/federal holidays not modelled/);
    expect(
      await listRefundDeadlines({
        overdueOnly: true,
        now: new Date("2026-11-17T14:00:00Z"),
      })
    ).toEqual([]);
    const overdue = await listRefundDeadlines({
      overdueOnly: true,
      now: new Date("2026-11-18T00:00:00Z"),
    });
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({
      bookingId: 8,
      overdue: true,
      completedAt: null,
    });
  });

  it("settles open deadlines against the refund receipt and records lateness", async () => {
    const fixture = setup({
      claim: { regulationType: "dot", claimType: "cancellation" },
    });
    await openRefundDeadline(fixture.db, {
      bookingId: 8,
      trigger: "significant_change",
      tenderClass: "other",
      triggeredAt: new Date("2026-11-01T00:00:00Z"),
      openedBy: 2,
    });
    const settled = await settleRefundDeadlines(fixture.db, {
      bookingId: 8,
      ledgerId: 77,
      completedAt: new Date("2026-11-25T00:00:00Z"),
      tenderClass: "other",
      actorId: 2,
    });
    expect(settled).toEqual([{ id: 1, metOnTime: false }]);
    const rows = await listRefundDeadlines({ overdueOnly: false });
    expect(rows[0]).toMatchObject({
      ledgerId: 77,
      metOnTime: false,
      overdue: false,
    });
    // A refund with no prior row but a declared trigger still leaves a settled row.
    const created = await settleRefundDeadlines(fixture.db, {
      bookingId: 8,
      ledgerId: 78,
      completedAt: new Date("2026-11-26T00:00:00Z"),
      tenderClass: "other",
      trigger: "carrier_cancellation",
      actorId: 2,
    });
    expect(created).toEqual([{ id: 2, metOnTime: true }]);
  });
});

describe("compensation router contracts", () => {
  function caller(role: "admin" | "user") {
    return compensationRouter.createCaller({
      user: { id: 2, role },
    } as TrpcContext);
  }
  it("validates engine evidence input and hides the trace from the claim record", async () => {
    setup({ claim: { regulationType: "local", claimType: "delay" } });
    await expect(caller("user").processClaim(approval)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller("admin").processClaim({
        ...approval,
        rightsEvidence: { ...rightsEvidence, factsReference: "x" },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const result = await caller("admin").processClaim(approval);
    expect(result.approvedAmount).toBe(76_852);
    expect(result).not.toHaveProperty("reviewEvidence");
    const trace = await caller("admin").getClaimEvaluation({ claimId: 1 });
    expect(trace.reviewEvidence).toMatchObject({
      ruleCode: rightsEvidence.ruleCode,
    });
    await expect(
      caller("user").getClaimEvaluation({ claimId: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("exposes the built-in catalogue with provenance when the tables are empty", async () => {
    setup({ claim: { regulationType: "local", claimType: "delay" } });
    const catalog = await caller("admin").getRuleCatalog();
    expect(catalog.source).toBe("built-in");
    const ksa = catalog.ruleSets.find(s => s.jurisdiction === "KSA-GACA-2023");
    const disputed = ksa?.rules.filter(
      r => r.confirmationStatus === "disputed"
    );
    expect(disputed?.map(r => r.candidate).sort()).toEqual(["A", "B", "B"]);
    expect(ksa?.rules.every(r => r.sources.length > 0)).toBe(true);
    const amended = catalog.ruleSets.find(
      s => s.jurisdiction === "EU261-2026-amended"
    );
    expect(amended).toMatchObject({
      effectiveFrom: null,
      confirmationStatus: "not_yet_applicable",
    });
  });
});
