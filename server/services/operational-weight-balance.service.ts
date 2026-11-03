import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const envelopePointSchema = z.object({
  phase: z.enum(["zfw", "tow", "law"]),
  weightKg: z.number().positive(),
  forwardMacPercent: z.number().min(-100).max(200),
  aftMacPercent: z.number().min(-100).max(200),
});

const controlledDataSchema = z.object({
  status: z.literal("accepted"),
  evidenceId: z.number().int().positive(),
  approvedAt: z.iso.datetime(),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable(),
});

export const operationalWeightBalanceInputSchema = z
  .object({
    calculationAt: z.iso.datetime(),
    registration: controlledDataSchema.extend({
      registration: z.string().trim().min(3).max(20),
      dataVersion: z.string().min(1).max(50),
      dryOperatingWeightKg: z.number().positive(),
      dryOperatingIndex: z.number().finite(),
    }),
    profile: controlledDataSchema.extend({
      version: z.string().min(1).max(50),
      referenceStationMm: z.number().finite(),
      lemacMm: z.number().finite(),
      macLengthMm: z.number().positive(),
      indexConstant: z.number().finite(),
      indexCoefficient: z.number().nonnegative(),
      maxLmcWeightKg: z.number().nonnegative(),
      maxLmcIndex: z.number().nonnegative(),
      envelope: z.array(envelopePointSchema).min(6),
    }),
    trafficLoadKg: z.number().nonnegative(),
    trafficIndex: z.number().finite(),
    takeoffFuelKg: z.number().nonnegative(),
    takeoffFuelIndex: z.number().finite(),
    tripFuelKg: z.number().nonnegative(),
    tripFuelIndex: z.number().finite(),
    limits: z.object({
      maxZeroFuelWeightKg: z.number().positive(),
      maxTakeoffWeightKg: z.number().positive(),
      maxLandingWeightKg: z.number().positive(),
    }),
    previous: z
      .object({
        zeroFuelWeightKg: z.number().positive(),
        takeoffWeightKg: z.number().positive(),
        landingWeightKg: z.number().positive(),
        zeroFuelIndex: z.number().finite(),
        takeoffIndex: z.number().finite(),
        landingIndex: z.number().finite(),
      })
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const instant = Date.parse(input.calculationAt);
    for (const [path, controlled] of [
      ["registration", input.registration],
      ["profile", input.profile],
    ] as const) {
      if (
        instant < Date.parse(controlled.effectiveFrom) ||
        (controlled.effectiveTo !== null &&
          instant >= Date.parse(controlled.effectiveTo))
      )
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: "Controlled data is outside its effective interval",
        });
    }
    if (input.tripFuelKg > input.takeoffFuelKg)
      ctx.addIssue({
        code: "custom",
        path: ["tripFuelKg"],
        message: "Trip fuel cannot exceed takeoff fuel",
      });
    for (const phase of ["zfw", "tow", "law"] as const) {
      const points = input.profile.envelope
        .filter(point => point.phase === phase)
        .sort((a, b) => a.weightKg - b.weightKg);
      if (points.length < 2)
        ctx.addIssue({
          code: "custom",
          path: ["profile", "envelope"],
          message: `${phase.toUpperCase()} envelope needs at least two points`,
        });
      for (let i = 0; i < points.length; i++) {
        if (points[i].forwardMacPercent >= points[i].aftMacPercent)
          ctx.addIssue({
            code: "custom",
            path: ["profile", "envelope"],
            message: `${phase.toUpperCase()} envelope has reversed limits`,
          });
        if (i > 0 && points[i - 1].weightKg === points[i].weightKg)
          ctx.addIssue({
            code: "custom",
            path: ["profile", "envelope"],
            message: `${phase.toUpperCase()} envelope has duplicate weights`,
          });
      }
    }
  });

export type OperationalWeightBalanceInput = z.infer<
  typeof operationalWeightBalanceInputSchema
>;

type Phase = "zfw" | "tow" | "law";

function interpolateEnvelope(
  phase: Phase,
  weightKg: number,
  envelope: OperationalWeightBalanceInput["profile"]["envelope"]
) {
  const points = envelope
    .filter(point => point.phase === phase)
    .sort((a, b) => a.weightKg - b.weightKg);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || weightKg < first.weightKg || weightKg > last.weightKg)
    return null;
  const upperIndex = points.findIndex(point => point.weightKg >= weightKg);
  if (upperIndex === 0) {
    const { forwardMacPercent, aftMacPercent } = points[0];
    return { forwardMacPercent, aftMacPercent };
  }
  const lower = points[upperIndex - 1];
  const upper = points[upperIndex];
  const fraction =
    (weightKg - lower.weightKg) / (upper.weightKg - lower.weightKg);
  return {
    forwardMacPercent:
      lower.forwardMacPercent +
      fraction * (upper.forwardMacPercent - lower.forwardMacPercent),
    aftMacPercent:
      lower.aftMacPercent +
      fraction * (upper.aftMacPercent - lower.aftMacPercent),
  };
}

/** AHM 560 index-to-%MAC relationship with operator-supplied constants. */
export function calculateMacPercent(
  weightKg: number,
  index: number,
  profile: Pick<
    OperationalWeightBalanceInput["profile"],
    | "referenceStationMm"
    | "lemacMm"
    | "macLengthMm"
    | "indexConstant"
    | "indexCoefficient"
  >
) {
  if (!Number.isFinite(weightKg) || weightKg <= 0)
    throw new Error("A positive finite weight is required");
  return (
    (profile.indexCoefficient * (index - profile.indexConstant)) / weightKg +
    ((profile.referenceStationMm - profile.lemacMm) / profile.macLengthMm) * 100
  );
}

export function calculateOperationalWeightBalance(raw: unknown) {
  const input = operationalWeightBalanceInputSchema.parse(raw);
  const zeroFuelWeightKg =
    input.registration.dryOperatingWeightKg + input.trafficLoadKg;
  const takeoffWeightKg = zeroFuelWeightKg + input.takeoffFuelKg;
  const landingWeightKg = takeoffWeightKg - input.tripFuelKg;
  const zeroFuelIndex =
    input.registration.dryOperatingIndex + input.trafficIndex;
  const takeoffIndex = zeroFuelIndex + input.takeoffFuelIndex;
  const landingIndex = takeoffIndex - input.tripFuelIndex;

  const phaseValues = {
    zfw: { weightKg: zeroFuelWeightKg, index: zeroFuelIndex },
    tow: { weightKg: takeoffWeightKg, index: takeoffIndex },
    law: { weightKg: landingWeightKg, index: landingIndex },
  } as const;
  const phases = (
    Object.entries(phaseValues) as Array<
      [Phase, { weightKg: number; index: number }]
    >
  ).map(([phase, value]) => {
    const macPercent = calculateMacPercent(
      value.weightKg,
      value.index,
      input.profile
    );
    const limits = interpolateEnvelope(
      phase,
      value.weightKg,
      input.profile.envelope
    );
    return {
      phase,
      ...value,
      macPercent,
      limits,
      withinEnvelope:
        limits !== null &&
        macPercent >= limits.forwardMacPercent &&
        macPercent <= limits.aftMacPercent,
    };
  });

  const weightMarginsKg = {
    zfw: input.limits.maxZeroFuelWeightKg - zeroFuelWeightKg,
    tow: input.limits.maxTakeoffWeightKg - takeoffWeightKg,
    law: input.limits.maxLandingWeightKg - landingWeightKg,
  };
  const underloadKg = Math.min(...Object.values(weightMarginsKg));
  const lmc = input.previous
    ? {
        maxWeightChangeKg: Math.max(
          Math.abs(zeroFuelWeightKg - input.previous.zeroFuelWeightKg),
          Math.abs(takeoffWeightKg - input.previous.takeoffWeightKg),
          Math.abs(landingWeightKg - input.previous.landingWeightKg)
        ),
        maxIndexChange: Math.max(
          Math.abs(zeroFuelIndex - input.previous.zeroFuelIndex),
          Math.abs(takeoffIndex - input.previous.takeoffIndex),
          Math.abs(landingIndex - input.previous.landingIndex)
        ),
      }
    : null;
  const lmcWithinLimit =
    lmc === null ||
    (lmc.maxWeightChangeKg <= input.profile.maxLmcWeightKg &&
      lmc.maxIndexChange <= input.profile.maxLmcIndex);
  const violations = [
    ...Object.entries(weightMarginsKg)
      .filter(([, margin]) => margin < 0)
      .map(([phase]) => `${phase.toUpperCase()} weight limit exceeded`),
    ...phases
      .filter(phase => !phase.withinEnvelope)
      .map(
        phase => `${phase.phase.toUpperCase()} is outside the approved envelope`
      ),
    ...(lmcWithinLimit
      ? []
      : ["Last-minute change exceeds the approved limit"]),
  ];
  return {
    controlledData: {
      registration: input.registration.registration,
      registrationVersion: input.registration.dataVersion,
      registrationEvidenceId: input.registration.evidenceId,
      profileVersion: input.profile.version,
      profileEvidenceId: input.profile.evidenceId,
    },
    weights: { zeroFuelWeightKg, takeoffWeightKg, landingWeightKg },
    indices: { zeroFuelIndex, takeoffIndex, landingIndex },
    phases,
    weightMarginsKg,
    underloadKg,
    lmc: lmc === null ? null : { ...lmc, withinLimit: lmcWithinLimit },
    releasable: violations.length === 0,
    violations,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function createSignedLoadSheetDraft(input: {
  flightId: number;
  edition: number;
  issuedAt: string;
  issuedBy: number;
  calculation: ReturnType<typeof calculateOperationalWeightBalance>;
  signingKey: string;
}) {
  if (input.signingKey.length < 32)
    throw new Error(
      "Load-sheet signing key must contain at least 32 characters"
    );
  if (!Number.isInteger(input.edition) || input.edition < 1)
    throw new Error("Load-sheet edition must be a positive integer");
  const payload = {
    documentType: "LOAD_SHEET_DRAFT",
    flightId: input.flightId,
    edition: input.edition,
    issuedAt: new Date(input.issuedAt).toISOString(),
    issuedBy: input.issuedBy,
    calculation: input.calculation,
    dispatchAcceptanceRequired: true,
  } as const;
  const canonical = canonicalJson(payload);
  const digestSha256 = createHash("sha256").update(canonical).digest("hex");
  const signature = createHmac("sha256", input.signingKey)
    .update(digestSha256)
    .digest("hex");
  return { payload, digestSha256, signature };
}

export function verifySignedLoadSheetDraft(
  draft: ReturnType<typeof createSignedLoadSheetDraft>,
  signingKey: string
) {
  const canonical = canonicalJson(draft.payload);
  const digest = createHash("sha256").update(canonical).digest("hex");
  const signature = createHmac("sha256", signingKey)
    .update(digest)
    .digest("hex");
  return (
    digest === draft.digestSha256 &&
    signature.length === draft.signature.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(draft.signature))
  );
}
