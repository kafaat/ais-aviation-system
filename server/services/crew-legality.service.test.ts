import { describe, expect, it, vi } from "vitest";
import {
  CrewLegalityError,
  enforceCrewLegality,
  type LegalityGateDeps,
  type VerdictRecord,
} from "./crew-legality.service";
import { easaOroFtlRuleSet } from "./crew-ftl-rule-set";
import type { DutyPeriod, Sector } from "./crew-legality-engine";

const easa = easaOroFtlRuleSet();
const H = 3_600_000;
const sector: Sector = {
  flightId: 42,
  flightNumber: "SV100",
  departureAt: new Date("2026-10-11T05:00:00Z"),
  arrivalAt: new Date("2026-10-11T07:00:00Z"),
  originCode: "RUH",
  originTimeZone: "Asia/Riyadh",
  destinationCode: "JED",
  destinationTimeZone: "Asia/Riyadh",
};
const input = {
  crewMemberId: 7,
  airlineId: 1,
  tenantId: null,
  flightId: 42,
  reportAt: new Date(sector.departureAt.getTime() - H),
  releaseAt: new Date(sector.arrivalAt.getTime() + H / 2),
  actorId: 3,
  fallbackTimeZone: "Asia/Riyadh",
} as const;
/** Previous duty released 11 h before report at home base: REST_BEFORE fails. */
const shortRest: DutyPeriod = {
  kind: "fdp",
  reportAt: new Date("2026-10-10T14:00:00Z"),
  releaseAt: new Date("2026-10-10T17:00:00Z"),
  sectors: [
    {
      departureAt: new Date("2026-10-10T15:00:00Z"),
      arrivalAt: new Date("2026-10-10T16:30:00Z"),
      originCode: "JED",
      originTimeZone: "Asia/Riyadh",
      destinationCode: "RUH",
      destinationTimeZone: "Asia/Riyadh",
    },
  ],
};

function fakeDeps(options: {
  ruleSet?: { allowsOverride: boolean } | null;
  history?: DutyPeriod[];
  override?: { id: number; ruleCodes: string[] } | null;
}) {
  const persisted: VerdictRecord[] = [];
  const deps: LegalityGateDeps = {
    now: () => new Date("2026-10-01T00:00:00Z"),
    loadRuleSet: vi.fn(async () =>
      options.ruleSet === null
        ? null
        : {
            id: 11,
            doc: easa,
            allowsOverride: options.ruleSet?.allowsOverride ?? false,
          }
    ),
    loadCrewProfile: vi.fn(async () => ({
      homeBaseCode: "RUH",
      homeBaseTimeZone: "Asia/Riyadh",
    })),
    loadSector: vi.fn(async () => sector),
    loadHistory: vi.fn(async () => options.history ?? []),
    findOverride: vi.fn(async () => options.override ?? null),
    persistVerdict: vi.fn(async record => {
      persisted.push(record);
      return persisted.length;
    }),
    consumeOverride: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
  };
  return { deps, persisted };
}
const tx = {} as never;

describe("crew legality gate", () => {
  it("logs and publishes a legal verdict and lets the assignment proceed", async () => {
    const { deps, persisted } = fakeDeps({
      ruleSet: { allowsOverride: false },
    });
    const result = await enforceCrewLegality(
      tx,
      { ...input, path: "manual" },
      deps
    );
    expect(result.verdict.verdict).toBe("legal");
    expect(result.blocked).toBe(false);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      path: "manual",
      verdict: "legal",
      blocked: false,
      ruleSetId: 11,
    });
    expect(deps.publish).toHaveBeenCalledTimes(1);
    expect(deps.loadHistory).toHaveBeenCalledWith(
      7,
      42,
      expect.any(Date),
      expect.any(Date)
    );
  });

  it("blocks an illegal verdict, still logging it for audit", async () => {
    const { deps, persisted } = fakeDeps({
      ruleSet: { allowsOverride: true },
      history: [shortRest],
    });
    const attempt = enforceCrewLegality(
      tx,
      { ...input, path: "bulk_roster" },
      deps
    );
    await expect(attempt).rejects.toBeInstanceOf(CrewLegalityError);
    await expect(attempt).rejects.toThrow(/REST_BEFORE/);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      path: "bulk_roster",
      verdict: "illegal",
      blocked: true,
      overrideId: null,
    });
    expect(
      (persisted[0].summary as { failedRules: string[] }).failedRules
    ).toEqual(["REST_BEFORE"]);
    expect(deps.consumeOverride).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("honours a documented override only when the rule set allows overrides and it covers every failed rule", async () => {
    const override = { id: 5, ruleCodes: ["REST_BEFORE"] };
    const allowed = fakeDeps({
      ruleSet: { allowsOverride: true },
      history: [shortRest],
      override,
    });
    const result = await enforceCrewLegality(
      tx,
      { ...input, path: "standby_activation", standbyId: 9 },
      allowed.deps
    );
    expect(result).toMatchObject({ overrideId: 5, blocked: false });
    expect(allowed.persisted[0]).toMatchObject({
      verdict: "illegal",
      blocked: false,
      overrideId: 5,
      standbyId: 9,
    });
    expect(allowed.deps.consumeOverride).toHaveBeenCalledWith(5, 1);
    expect(allowed.deps.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          overrideId: 5,
          failedRules: ["REST_BEFORE"],
        }),
      })
    );

    const disallowed = fakeDeps({
      ruleSet: { allowsOverride: false },
      history: [shortRest],
      override,
    });
    await expect(
      enforceCrewLegality(tx, { ...input, path: "manual" }, disallowed.deps)
    ).rejects.toThrow(/blocked/);
    expect(disallowed.deps.findOverride).not.toHaveBeenCalled();

    const partial = fakeDeps({
      ruleSet: { allowsOverride: true },
      history: [shortRest],
      override: { id: 6, ruleCodes: ["FDP_MAX"] },
    });
    await expect(
      enforceCrewLegality(tx, { ...input, path: "recovery_swap" }, partial.deps)
    ).rejects.toThrow(/blocked/);
    expect(partial.persisted[0]).toMatchObject({
      blocked: true,
      overrideId: null,
      path: "recovery_swap",
    });
  });

  it("blocks every non-preview path when no operator-confirmed rule set is active", async () => {
    for (const path of [
      "manual",
      "bulk_roster",
      "recovery_swap",
      "standby_activation",
    ] as const) {
      const { deps, persisted } = fakeDeps({ ruleSet: null });
      await expect(
        enforceCrewLegality(tx, { ...input, path }, deps)
      ).rejects.toThrow(/no active operator-confirmed/);
      expect(persisted[0]).toMatchObject({
        path,
        verdict: "illegal",
        blocked: true,
        ruleSetId: null,
      });
    }
    const preview = fakeDeps({ ruleSet: null });
    const result = await enforceCrewLegality(
      tx,
      { ...input, path: "preview" },
      preview.deps
    );
    expect(result.verdict.verdict).toBe("illegal");
    expect(result.blocked).toBe(false);
  });

  it("previews never block but are logged", async () => {
    const { deps, persisted } = fakeDeps({
      ruleSet: { allowsOverride: false },
      history: [shortRest],
    });
    const result = await enforceCrewLegality(
      tx,
      { ...input, path: "preview" },
      deps
    );
    expect(result.verdict.verdict).toBe("illegal");
    expect(result.blocked).toBe(false);
    expect(persisted[0]).toMatchObject({ path: "preview", blocked: false });
  });

  it("merges the proposed sector into an existing duty with identical bounds", async () => {
    const sameDuty: DutyPeriod = {
      kind: "fdp",
      reportAt: input.reportAt,
      releaseAt: input.releaseAt,
      sectors: [
        {
          departureAt: new Date("2026-10-11T04:30:00Z"),
          arrivalAt: new Date("2026-10-11T04:50:00Z"),
          originCode: "DMM",
          originTimeZone: "Asia/Riyadh",
          destinationCode: "RUH",
          destinationTimeZone: "Asia/Riyadh",
        },
      ],
    };
    const { deps, persisted } = fakeDeps({
      ruleSet: { allowsOverride: false },
      history: [sameDuty],
    });
    const result = await enforceCrewLegality(
      tx,
      { ...input, path: "manual" },
      deps
    );
    expect(
      result.verdict.checks.find(c => c.code === "NO_OVERLAP")?.status
    ).toBe("pass");
    expect((persisted[0].summary as { sectors: number }).sectors).toBe(2);
  });
});
