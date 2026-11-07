/**
 * Weight & balance calculation engine (IATA AHM 560/565 data model).
 *
 * Pure functions only: no database, no environment, no clock. Every figure a
 * load sheet shows is derived here from a validated per-type balance dataset,
 * a registration record (DOW/DOI, limits, envelope reference) and the load.
 *
 * Index convention (AHM 560): ΔI = W × (arm − RefSta) / C; the dry operating
 * index DOI already includes the constant K, so every total index is
 *   I = DOI + Σ ΔI.
 * %MAC is recovered from an index and a weight with
 *   %MAC = [ C × (I − K) / W + (RefSta − LEMAC) ] / MAC × 100
 * (the first term is the CG arm relative to the reference station in metres,
 * so the bracket is the CG distance from LEMAC; dividing by MAC gives %MAC).
 *
 * The engine does not know whether a dataset is operator-approved. Approval,
 * signature and dispatch acceptance are recorded by the service layer.
 */
import { z } from "zod";

// ============================================================================
// Dataset schemas (AHM 560/565 scope)
// ============================================================================

const kg = z.number().finite().nonnegative();
const positiveKg = z.number().finite().positive();
const code = z.string().trim().min(1).max(10);

export const envelopePointSchema = z
  .object({
    weightKg: positiveKg,
    fwdMacPct: z.number().finite(),
    aftMacPct: z.number().finite(),
  })
  .strict()
  .refine(p => p.fwdMacPct < p.aftMacPct, {
    message: "Forward limit must be ahead of the aft limit",
  });

const ascending = <T>(key: (item: T) => number) => {
  return (items: T[]) =>
    items.every((item, i) => i === 0 || key(items[i - 1]) < key(item));
};

export const envelopeSchema = z
  .array(envelopePointSchema)
  .min(2)
  .refine(
    ascending((p: { weightKg: number }) => p.weightKg),
    {
      message: "Envelope points must be in strictly ascending weight order",
    }
  );

export const envelopeSetSchema = z
  .object({
    ref: z.string().trim().min(1).max(100),
    zfw: envelopeSchema,
    tow: envelopeSchema,
    law: envelopeSchema,
  })
  .strict();

export const compartmentSchema = z
  .object({
    code,
    name: z.string().max(100).optional(),
    armM: z.number().finite(),
    maxKg: positiveKg,
  })
  .strict();

export const cumulativeLimitSchema = z
  .object({
    code,
    compartments: z.array(code).min(2),
    maxKg: positiveKg,
  })
  .strict();

export const cabinZoneSchema = z
  .object({
    code,
    name: z.string().max(100).optional(),
    armM: z.number().finite(),
    seats: z.number().int().positive(),
    rows: z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      })
      .refine(r => r.from <= r.to, { message: "Row range is inverted" }),
    cabinClass: z.enum(["economy", "business"]),
  })
  .strict();

export const fuelIndexPointSchema = z
  .object({ fuelKg: kg, index: z.number().finite() })
  .strict();

export const trimPointSchema = z
  .object({ macPct: z.number().finite(), trimUnits: z.number().finite() })
  .strict();

const unique = <T>(key: (item: T) => string) => {
  return (items: T[]) => new Set(items.map(key)).size === items.length;
};

export const typeBalancePayloadSchema = z
  .object({
    unitSystem: z.literal("kg_m"),
    index: z
      .object({
        c: z.number().finite().positive(),
        k: z.number().finite(),
        referenceStationM: z.number().finite(),
        lemacM: z.number().finite(),
        macLengthM: z.number().finite().positive(),
      })
      .strict(),
    compartments: z
      .array(compartmentSchema)
      .min(1)
      .refine(
        unique((c: { code: string }) => c.code),
        { message: "Duplicate compartment code" }
      ),
    cumulativeLimits: z.array(cumulativeLimitSchema).default([]),
    cabinZones: z
      .array(cabinZoneSchema)
      .min(1)
      .refine(
        unique((zone: { code: string }) => zone.code),
        { message: "Duplicate zone code" }
      )
      .refine(
        zones =>
          zones.every((zone, i) =>
            zones.every(
              (other, j) =>
                i === j ||
                zone.rows.to < other.rows.from ||
                other.rows.to < zone.rows.from
            )
          ),
        { message: "Cabin zone row ranges overlap" }
      ),
    fuelIndexTable: z
      .array(fuelIndexPointSchema)
      .min(2)
      .refine(
        ascending((p: { fuelKg: number }) => p.fuelKg),
        {
          message: "Fuel index table must be in ascending quantity order",
        }
      )
      .refine(points => points[0].fuelKg === 0 && points[0].index === 0, {
        message: "Fuel index table must start at 0 kg / 0 index",
      }),
    envelopes: z
      .array(envelopeSetSchema)
      .min(1)
      .refine(
        unique((e: { ref: string }) => e.ref),
        { message: "Duplicate envelope reference" }
      ),
    trimTable: z
      .array(trimPointSchema)
      .min(2)
      .refine(
        ascending((p: { macPct: number }) => p.macPct),
        {
          message: "Trim table must be in ascending %MAC order",
        }
      )
      .optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const codes = new Set(payload.compartments.map(c => c.code));
    for (const limit of payload.cumulativeLimits)
      for (const c of limit.compartments)
        if (!codes.has(c))
          ctx.addIssue({
            code: "custom",
            message: `Cumulative limit ${limit.code} names unknown compartment ${c}`,
            path: ["cumulativeLimits"],
          });
  });
export type TypeBalancePayload = z.infer<typeof typeBalancePayloadSchema>;

export const structuralLimitsSchema = z
  .object({
    mtowKg: positiveKg,
    mlwKg: positiveKg,
    mzfwKg: positiveKg,
    mrwKg: positiveKg.nullable().optional(),
    maxFuelKg: positiveKg,
  })
  .strict()
  .refine(l => l.mzfwKg <= l.mtowKg && l.mlwKg <= l.mtowKg, {
    message: "MZFW and MLW cannot exceed MTOW",
  })
  .refine(l => l.mrwKg == null || l.mrwKg >= l.mtowKg, {
    message: "MRW cannot be below MTOW",
  });

export const typeBalanceDataSchema = z
  .object({
    typeCode: code,
    variant: z.string().trim().max(30).default(""),
    version: z.number().int().positive(),
    description: z.string().trim().min(1).max(255),
    dataSource: z.string().trim().min(1).max(255),
    fictional: z.boolean(),
    limits: structuralLimitsSchema,
    lmcLimitKg: positiveKg,
    payload: typeBalancePayloadSchema,
  })
  .strict();
export type TypeBalanceData = z.infer<typeof typeBalanceDataSchema>;

export const registrationSchema = z
  .object({
    registration: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,9}$/, "Registration mark format"),
    typeCode: code,
    variant: z.string().trim().max(30).default(""),
    dowKg: positiveKg,
    doi: z.number().finite(),
    limits: z
      .object({
        mtowKg: positiveKg.nullable().optional(),
        mlwKg: positiveKg.nullable().optional(),
        mzfwKg: positiveKg.nullable().optional(),
        mrwKg: positiveKg.nullable().optional(),
      })
      .strict()
      .default({}),
    fuelCapacityKg: positiveKg,
    cabinConfigVersion: z.string().trim().min(1).max(50),
    envelopeRef: z.string().trim().min(1).max(100),
  })
  .strict();
export type RegistrationData = z.infer<typeof registrationSchema>;

// ============================================================================
// Standard passenger and baggage masses
// ============================================================================

export const standardMassRuleSetSchema = z
  .object({
    id: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200),
    authority: z.enum(["EASA", "GACA", "FAA", "OPERATOR"]),
    sourceUrl: z.url(),
    effectiveFrom: z.iso.date(),
    masses: z
      .object({
        maleKg: kg,
        femaleKg: kg,
        childKg: kg,
        infantKg: kg,
        checkedBagKg: positiveKg,
        handBaggageIncluded: z.boolean(),
      })
      .strict(),
    confirmation: z.enum([
      "requires_operator_confirmation",
      "operator_confirmed",
    ]),
    confirmationReference: z.string().trim().max(200).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
export type StandardMassRuleSet = z.infer<typeof standardMassRuleSetSchema>;

/**
 * Catalogue of rule sets the operator can confirm. Figures are transcriptions
 * of public regulatory tables and remain "requires_operator_confirmation"
 * until the operator records its approved mass policy. The GACA entry carries
 * no figures: GACAR Part 121 standard masses were not retrieved and must be
 * supplied by the operator.
 */
export const standardMassRuleSets: StandardMassRuleSet[] = [
  {
    id: "easa-cat-pol-mab-100-20plus",
    name: "EASA AMC1 CAT.POL.MAB.100(e) Table 1/2, aeroplanes with 20 or more passenger seats",
    authority: "EASA",
    sourceUrl: "https://www.easa.europa.eu/en/downloads/19914/en",
    effectiveFrom: "2014-10-28",
    masses: {
      maleKg: 88,
      femaleKg: 70,
      childKg: 35,
      infantKg: 0,
      checkedBagKg: 13,
      handBaggageIncluded: true,
    },
    confirmation: "requires_operator_confirmation",
    note: "Infants carried on an adult's lap are included in the adult mass (0 kg separate). Checked baggage 13 kg is the 'within European region / all other' standard piece; domestic 11 kg and intercontinental 15 kg are separate rows the operator selects per route. Transcribed figures; verify against the cited AMC before confirmation.",
  },
  {
    id: "gaca-gacar-121-operator",
    name: "GACA (GACAR Part 121) operator-approved standard masses",
    authority: "GACA",
    sourceUrl: "https://gaca.gov.sa/web/en-gb/page/regulations",
    effectiveFrom: "2000-01-01",
    masses: {
      maleKg: 0,
      femaleKg: 0,
      childKg: 0,
      infantKg: 0,
      checkedBagKg: 1,
      handBaggageIncluded: true,
    },
    confirmation: "requires_operator_confirmation",
    note: "Placeholder with no figures: GACAR Part 121 standard mass tables were not retrieved. The operator must supply its approved values before this rule set can be used.",
  },
];

export function getStandardMassRuleSet(id: string) {
  const ruleSet = standardMassRuleSets.find(r => r.id === id);
  if (!ruleSet) throw new WeightBalanceDataError(`Unknown mass rule set ${id}`);
  return ruleSet;
}

export function assertRuleSetUsable(ruleSet: StandardMassRuleSet) {
  const m = ruleSet.masses;
  if (m.maleKg <= 0 || m.femaleKg <= 0 || m.childKg <= 0)
    throw new WeightBalanceDataError(
      `Mass rule set ${ruleSet.id} has no usable passenger masses; the operator must supply them`
    );
}

// ============================================================================
// Load input
// ============================================================================

export const passengerZoneLoadSchema = z
  .object({
    zone: code,
    male: z.number().int().nonnegative(),
    female: z.number().int().nonnegative(),
    child: z.number().int().nonnegative(),
    infant: z.number().int().nonnegative(),
  })
  .strict();

export const compartmentLoadSchema = z
  .object({
    compartment: code,
    baggagePieces: z.number().int().nonnegative(),
    /** Null when checked bags were not weighed; pieces × standard mass is used. */
    baggageKg: kg.nullable(),
    cargoKg: kg,
    mailKg: kg,
  })
  .strict();

export const fuelLoadSchema = z
  .object({
    blockKg: kg,
    taxiKg: kg,
    tripKg: kg,
  })
  .strict()
  .refine(f => f.taxiKg <= f.blockKg, { message: "Taxi fuel exceeds block" })
  .refine(f => f.tripKg <= f.blockKg - f.taxiKg, {
    message: "Trip fuel exceeds take-off fuel",
  });

export const loadInputSchema = z
  .object({
    passengersByZone: z.array(passengerZoneLoadSchema).refine(
      unique((p: { zone: string }) => p.zone),
      { message: "Duplicate zone" }
    ),
    deadload: z.array(compartmentLoadSchema).refine(
      unique((d: { compartment: string }) => d.compartment),
      {
        message: "Duplicate compartment",
      }
    ),
    fuel: fuelLoadSchema,
    performanceLimits: z
      .object({
        rtowKg: positiveKg.nullable().optional(),
        mlawKg: positiveKg.nullable().optional(),
      })
      .strict()
      .default({}),
    standardMasses: standardMassRuleSetSchema,
    crew: z
      .object({
        cockpit: z.number().int().nonnegative(),
        cabin: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LoadInput = z.infer<typeof loadInputSchema>;

export const lmcChangeSchema = z
  .object({
    kind: z.enum(["passenger", "baggage", "cargo", "mail"]),
    /** Cabin zone for passengers, compartment for deadload. */
    location: code,
    category: z.enum(["male", "female", "child", "infant"]).optional(),
    deltaCount: z.number().int().optional(),
    deltaKg: z.number().finite().optional(),
    description: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine(
    c =>
      c.kind === "passenger"
        ? c.category !== undefined && c.deltaCount !== undefined
        : c.deltaKg !== undefined,
    {
      message:
        "Passenger changes need category and count; deadload changes need a weight",
    }
  );
export type LmcChange = z.infer<typeof lmcChangeSchema>;

export type LmcEntry = LmcChange & {
  sequence: number;
  appliedKg: number;
  actorId: number;
  actorName: string | null;
  appliedAt: string;
};

// ============================================================================
// Result types
// ============================================================================

export class WeightBalanceDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeightBalanceDataError";
  }
}

export type LimitCheck = {
  code: string;
  description: string;
  limitKg: number;
  actualKg: number;
  marginKg: number;
  ok: boolean;
};

export type PhaseFigures = {
  weightKg: number;
  index: number;
  macPct: number;
  fwdLimitMacPct: number | null;
  aftLimitMacPct: number | null;
  withinEnvelope: boolean;
};

export type LoadSheetFigures = {
  schemaVersion: 1;
  aircraft: {
    registration: string;
    typeCode: string;
    variant: string;
    balanceDataVersion: number;
    cabinConfigVersion: string;
    envelopeRef: string;
    fictional: boolean;
  };
  inputs: LoadInput;
  dow: { weightKg: number; index: number };
  passengers: {
    total: number;
    seated: number;
    byCategory: { male: number; female: number; child: number; infant: number };
    byZone: Array<{
      zone: string;
      count: number;
      seats: number;
      weightKg: number;
      index: number;
    }>;
    weightKg: number;
    index: number;
    ruleSetId: string;
    ruleSetConfirmation: StandardMassRuleSet["confirmation"];
  };
  deadload: {
    byCompartment: Array<{
      compartment: string;
      baggagePieces: number;
      baggageKg: number;
      baggageWeighed: boolean;
      cargoKg: number;
      mailKg: number;
      totalKg: number;
      maxKg: number;
      index: number;
    }>;
    baggageKg: number;
    cargoKg: number;
    mailKg: number;
    totalKg: number;
    index: number;
  };
  trafficLoadKg: number;
  fuel: {
    blockKg: number;
    taxiKg: number;
    takeoffKg: number;
    tripKg: number;
    landingKg: number;
    takeoffIndex: number;
    landingIndex: number;
  };
  zfw: PhaseFigures;
  tow: PhaseFigures;
  law: PhaseFigures;
  rampWeightKg: number;
  effectiveLimits: {
    mzfwKg: number;
    mtowKg: number;
    mlwKg: number;
    mrwKg: number | null;
    rtowKg: number | null;
    performanceMlawKg: number | null;
  };
  structuralChecks: LimitCheck[];
  underload: {
    allowedTrafficLoadKg: number;
    actualTrafficLoadKg: number;
    underloadKg: number;
    limitingFactor: "MZFW" | "MTOW" | "MLW";
  };
  trim: { towMacPct: number; stabTrimUnits: number | null; source: string };
  lmc: {
    limitKg: number;
    appliedKg: number;
    remainingKg: number;
    requiresNewLoadSheet: boolean;
  };
  breaches: string[];
  ok: boolean;
};

// ============================================================================
// Helpers
// ============================================================================

const MAC_TOLERANCE = 1e-6;

export function round(value: number, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Linear interpolation on an ascending table; null outside its range. */
export function interpolate(
  table: ReadonlyArray<{ x: number; y: number }>,
  x: number
): number | null {
  if (table.length === 0) return null;
  const first = table[0];
  const last = table[table.length - 1];
  if (x < first.x - MAC_TOLERANCE || x > last.x + MAC_TOLERANCE) return null;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1];
    const b = table[i];
    if (x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

export function indexPerKg(armM: number, index: TypeBalancePayload["index"]) {
  return (armM - index.referenceStationM) / index.c;
}

export function indexDelta(
  weightKg: number,
  armM: number,
  index: TypeBalancePayload["index"]
) {
  return weightKg * indexPerKg(armM, index);
}

/** %MAC = [C(I − K)/W + (RefSta − LEMAC)] / MAC × 100 */
export function macPercentFromIndex(
  totalIndex: number,
  weightKg: number,
  index: TypeBalancePayload["index"]
) {
  if (weightKg <= 0)
    throw new WeightBalanceDataError("Weight must be positive for %MAC");
  const cgFromReference = (index.c * (totalIndex - index.k)) / weightKg;
  return (
    ((cgFromReference + (index.referenceStationM - index.lemacM)) /
      index.macLengthM) *
    100
  );
}

/** Inverse: the index at which a weight sits at the given %MAC. */
export function indexFromMacPercent(
  macPct: number,
  weightKg: number,
  index: TypeBalancePayload["index"]
) {
  const cgFromLemac = (macPct / 100) * index.macLengthM;
  const cgFromReference =
    cgFromLemac - (index.referenceStationM - index.lemacM);
  return index.k + (cgFromReference * weightKg) / index.c;
}

export function envelopeLimitsAt(
  envelope: z.infer<typeof envelopeSchema>,
  weightKg: number
) {
  const fwd = interpolate(
    envelope.map(p => ({ x: p.weightKg, y: p.fwdMacPct })),
    weightKg
  );
  const aft = interpolate(
    envelope.map(p => ({ x: p.weightKg, y: p.aftMacPct })),
    weightKg
  );
  return { fwd, aft };
}

export function fuelIndexAt(payload: TypeBalancePayload, fuelKg: number) {
  const value = interpolate(
    payload.fuelIndexTable.map(p => ({ x: p.fuelKg, y: p.index })),
    fuelKg
  );
  if (value === null)
    throw new WeightBalanceDataError(
      `Fuel quantity ${fuelKg} kg is outside the fuel index table`
    );
  return value;
}

export function effectiveLimits(
  type: TypeBalanceData,
  registration: RegistrationData,
  performance: LoadInput["performanceLimits"]
): LoadSheetFigures["effectiveLimits"] {
  const pick = (reg: number | null | undefined, typeValue: number) =>
    reg == null ? typeValue : Math.min(reg, typeValue);
  const mrw = registration.limits.mrwKg ?? type.limits.mrwKg ?? null;
  return {
    mzfwKg: pick(registration.limits.mzfwKg, type.limits.mzfwKg),
    mtowKg: pick(registration.limits.mtowKg, type.limits.mtowKg),
    mlwKg: pick(registration.limits.mlwKg, type.limits.mlwKg),
    mrwKg: mrw,
    rtowKg: performance.rtowKg ?? null,
    performanceMlawKg: performance.mlawKg ?? null,
  };
}

function resolveEnvelope(
  type: TypeBalanceData,
  registration: RegistrationData
) {
  const set = type.payload.envelopes.find(
    e => e.ref === registration.envelopeRef
  );
  if (!set)
    throw new WeightBalanceDataError(
      `Registration ${registration.registration} references envelope ${registration.envelopeRef} which is not in the ${type.typeCode}${type.variant ? `-${type.variant}` : ""} dataset`
    );
  return set;
}

function phase(
  weightKg: number,
  index: number,
  envelope: z.infer<typeof envelopeSchema>,
  constants: TypeBalancePayload["index"]
): PhaseFigures {
  const macPct = macPercentFromIndex(index, weightKg, constants);
  const { fwd, aft } = envelopeLimitsAt(envelope, weightKg);
  const withinEnvelope =
    fwd !== null &&
    aft !== null &&
    macPct >= fwd - MAC_TOLERANCE &&
    macPct <= aft + MAC_TOLERANCE;
  return {
    weightKg,
    index: round(index, 4),
    macPct: round(macPct, 4),
    fwdLimitMacPct: fwd === null ? null : round(fwd, 4),
    aftLimitMacPct: aft === null ? null : round(aft, 4),
    withinEnvelope,
  };
}

function check(
  code: string,
  description: string,
  limitKg: number,
  actualKg: number
): LimitCheck {
  const marginKg = round(limitKg - actualKg, 1);
  return {
    code,
    description,
    limitKg,
    actualKg: round(actualKg, 1),
    marginKg,
    ok: marginKg >= 0,
  };
}

// ============================================================================
// Main computation
// ============================================================================

export function assertRegistrationMatchesType(
  type: TypeBalanceData,
  registration: RegistrationData
) {
  if (
    registration.typeCode !== type.typeCode ||
    registration.variant !== type.variant
  )
    throw new WeightBalanceDataError(
      `Registration ${registration.registration} is ${registration.typeCode}${registration.variant ? `-${registration.variant}` : ""} but the dataset is ${type.typeCode}${type.variant ? `-${type.variant}` : ""}`
    );
  resolveEnvelope(type, registration);
  if (registration.fuelCapacityKg > type.limits.maxFuelKg)
    throw new WeightBalanceDataError(
      "Registration fuel capacity exceeds the type maximum fuel"
    );
}

export function computeLoadSheet(
  typeInput: TypeBalanceData,
  registrationInput: RegistrationData,
  loadInput: LoadInput
): LoadSheetFigures {
  const type = typeBalanceDataSchema.parse(typeInput);
  const registration = registrationSchema.parse(registrationInput);
  const load = loadInputSchema.parse(loadInput);
  assertRegistrationMatchesType(type, registration);
  assertRuleSetUsable(load.standardMasses);
  const constants = type.payload.index;
  const envelopeSet = resolveEnvelope(type, registration);
  const breaches: string[] = [];
  const structuralChecks: LimitCheck[] = [];
  const masses = load.standardMasses.masses;

  // --- Passengers by cabin zone -------------------------------------------
  const zonesByCode = new Map(type.payload.cabinZones.map(z => [z.code, z]));
  const byCategory = { male: 0, female: 0, child: 0, infant: 0 };
  let paxWeight = 0;
  let paxIndex = 0;
  const byZone = load.passengersByZone.map(p => {
    const zone = zonesByCode.get(p.zone);
    if (!zone)
      throw new WeightBalanceDataError(
        `Cabin zone ${p.zone} is not defined for ${type.typeCode}`
      );
    const weightKg =
      p.male * masses.maleKg +
      p.female * masses.femaleKg +
      p.child * masses.childKg +
      p.infant * masses.infantKg;
    const seated = p.male + p.female + p.child;
    const index = indexDelta(weightKg, zone.armM, constants);
    byCategory.male += p.male;
    byCategory.female += p.female;
    byCategory.child += p.child;
    byCategory.infant += p.infant;
    paxWeight += weightKg;
    paxIndex += index;
    structuralChecks.push(
      check(
        `ZONE:${zone.code}`,
        `Cabin zone ${zone.code} occupied seats vs ${zone.seats} installed`,
        zone.seats,
        seated
      )
    );
    return {
      zone: zone.code,
      count: seated + p.infant,
      seats: zone.seats,
      weightKg,
      index: round(index, 4),
    };
  });
  const seated = byCategory.male + byCategory.female + byCategory.child;

  // --- Deadload by compartment ---------------------------------------------
  const compartments = new Map(type.payload.compartments.map(c => [c.code, c]));
  const loadedByCompartment = new Map<string, number>();
  let baggageKg = 0;
  let cargoKg = 0;
  let mailKg = 0;
  let deadloadIndex = 0;
  const byCompartment = load.deadload.map(d => {
    const compartment = compartments.get(d.compartment);
    if (!compartment)
      throw new WeightBalanceDataError(
        `Compartment ${d.compartment} is not defined for ${type.typeCode}`
      );
    const weighed = d.baggageKg !== null;
    const bag = weighed
      ? (d.baggageKg as number)
      : d.baggagePieces * masses.checkedBagKg;
    const totalKg = bag + d.cargoKg + d.mailKg;
    const index = indexDelta(totalKg, compartment.armM, constants);
    baggageKg += bag;
    cargoKg += d.cargoKg;
    mailKg += d.mailKg;
    deadloadIndex += index;
    loadedByCompartment.set(compartment.code, totalKg);
    structuralChecks.push(
      check(
        `COMPARTMENT:${compartment.code}`,
        `Compartment ${compartment.code} maximum load`,
        compartment.maxKg,
        totalKg
      )
    );
    return {
      compartment: compartment.code,
      baggagePieces: d.baggagePieces,
      baggageKg: bag,
      baggageWeighed: weighed,
      cargoKg: d.cargoKg,
      mailKg: d.mailKg,
      totalKg,
      maxKg: compartment.maxKg,
      index: round(index, 4),
    };
  });
  for (const limit of type.payload.cumulativeLimits) {
    const actual = limit.compartments.reduce(
      (sum, c) => sum + (loadedByCompartment.get(c) ?? 0),
      0
    );
    structuralChecks.push(
      check(
        `CUMULATIVE:${limit.code}`,
        `Combined load in compartments ${limit.compartments.join("+")}`,
        limit.maxKg,
        actual
      )
    );
  }
  const deadloadKg = baggageKg + cargoKg + mailKg;

  // --- Weight chain --------------------------------------------------------
  const trafficLoadKg = paxWeight + deadloadKg;
  const zfwKg = registration.dowKg + trafficLoadKg;
  const zfi = registration.doi + paxIndex + deadloadIndex;
  const takeoffFuel = load.fuel.blockKg - load.fuel.taxiKg;
  const landingFuel = takeoffFuel - load.fuel.tripKg;
  const towKg = zfwKg + takeoffFuel;
  const lawKg = zfwKg + landingFuel;
  const rampWeightKg = zfwKg + load.fuel.blockKg;
  const takeoffFuelIndex = fuelIndexAt(type.payload, takeoffFuel);
  const landingFuelIndex = fuelIndexAt(type.payload, landingFuel);
  const toi = zfi + takeoffFuelIndex;
  const li = zfi + landingFuelIndex;

  const limits = effectiveLimits(type, registration, load.performanceLimits);
  structuralChecks.push(
    check("MZFW", "Maximum zero fuel weight", limits.mzfwKg, zfwKg),
    check("MTOW", "Maximum take-off weight (structural)", limits.mtowKg, towKg),
    check("MLW", "Maximum landing weight (structural)", limits.mlwKg, lawKg)
  );
  if (limits.mrwKg !== null)
    structuralChecks.push(
      check("MRW", "Maximum ramp weight", limits.mrwKg, rampWeightKg)
    );
  if (limits.rtowKg !== null)
    structuralChecks.push(
      check("RTOW", "Performance-limited take-off weight", limits.rtowKg, towKg)
    );
  if (limits.performanceMlawKg !== null)
    structuralChecks.push(
      check(
        "PLAW",
        "Performance-limited landing weight",
        limits.performanceMlawKg,
        lawKg
      )
    );
  structuralChecks.push(
    check(
      "FUEL_CAPACITY",
      "Block fuel vs registration fuel capacity",
      Math.min(registration.fuelCapacityKg, type.limits.maxFuelKg),
      load.fuel.blockKg
    )
  );

  // --- Balance -------------------------------------------------------------
  const zfw = phase(zfwKg, zfi, envelopeSet.zfw, constants);
  const tow = phase(towKg, toi, envelopeSet.tow, constants);
  const law = phase(lawKg, li, envelopeSet.law, constants);
  for (const [name, p] of [
    ["ZFW", zfw],
    ["TOW", tow],
    ["LAW", law],
  ] as const) {
    if (p.fwdLimitMacPct === null || p.aftLimitMacPct === null)
      breaches.push(`ENVELOPE:${name}: weight outside the certified envelope`);
    else if (!p.withinEnvelope)
      breaches.push(
        `ENVELOPE:${name}: ${p.macPct.toFixed(2)}% MAC outside ${p.fwdLimitMacPct.toFixed(2)}–${p.aftLimitMacPct.toFixed(2)}`
      );
  }
  for (const c of structuralChecks)
    if (!c.ok)
      breaches.push(
        `${c.code}: ${c.actualKg} exceeds ${c.limitKg} by ${Math.abs(c.marginKg)}`
      );

  // --- Underload -----------------------------------------------------------
  const towLimit = Math.min(limits.mtowKg, limits.rtowKg ?? Infinity);
  const lawLimit = Math.min(limits.mlwKg, limits.performanceMlawKg ?? Infinity);
  const candidates = [
    { factor: "MZFW" as const, allowed: limits.mzfwKg - registration.dowKg },
    {
      factor: "MTOW" as const,
      allowed: towLimit - registration.dowKg - takeoffFuel,
    },
    {
      factor: "MLW" as const,
      allowed: lawLimit - registration.dowKg - landingFuel,
    },
  ];
  const limiting = candidates.reduce((min, c) =>
    c.allowed < min.allowed ? c : min
  );

  // --- Trim ----------------------------------------------------------------
  let stabTrimUnits: number | null = null;
  let trimSource = "no trim table in dataset";
  if (type.payload.trimTable) {
    const value = interpolate(
      type.payload.trimTable.map(p => ({ x: p.macPct, y: p.trimUnits })),
      tow.macPct
    );
    stabTrimUnits = value === null ? null : round(value, 2);
    trimSource =
      value === null
        ? "take-off %MAC outside the trim table"
        : `type trim table (${type.payload.trimTable.length} points)`;
  }

  return {
    schemaVersion: 1,
    aircraft: {
      registration: registration.registration,
      typeCode: type.typeCode,
      variant: type.variant,
      balanceDataVersion: type.version,
      cabinConfigVersion: registration.cabinConfigVersion,
      envelopeRef: registration.envelopeRef,
      fictional: type.fictional,
    },
    inputs: load,
    dow: { weightKg: registration.dowKg, index: registration.doi },
    passengers: {
      total: seated + byCategory.infant,
      seated,
      byCategory,
      byZone,
      weightKg: paxWeight,
      index: round(paxIndex, 4),
      ruleSetId: load.standardMasses.id,
      ruleSetConfirmation: load.standardMasses.confirmation,
    },
    deadload: {
      byCompartment,
      baggageKg,
      cargoKg,
      mailKg,
      totalKg: deadloadKg,
      index: round(deadloadIndex, 4),
    },
    trafficLoadKg,
    fuel: {
      blockKg: load.fuel.blockKg,
      taxiKg: load.fuel.taxiKg,
      takeoffKg: takeoffFuel,
      tripKg: load.fuel.tripKg,
      landingKg: landingFuel,
      takeoffIndex: round(takeoffFuelIndex, 4),
      landingIndex: round(landingFuelIndex, 4),
    },
    zfw,
    tow,
    law,
    rampWeightKg,
    effectiveLimits: limits,
    structuralChecks,
    underload: {
      allowedTrafficLoadKg: round(limiting.allowed, 1),
      actualTrafficLoadKg: trafficLoadKg,
      underloadKg: round(limiting.allowed - trafficLoadKg, 1),
      limitingFactor: limiting.factor,
    },
    trim: { towMacPct: tow.macPct, stabTrimUnits, source: trimSource },
    lmc: {
      limitKg: type.lmcLimitKg,
      appliedKg: 0,
      remainingKg: type.lmcLimitKg,
      requiresNewLoadSheet: false,
    },
    breaches,
    ok: breaches.length === 0,
  };
}

// ============================================================================
// Last-minute changes
// ============================================================================

/** Weight effect of one change under the rule set used by the load sheet. */
export function lmcWeightDelta(change: LmcChange, masses: StandardMassRuleSet) {
  if (change.kind === "passenger") {
    const perHead = {
      male: masses.masses.maleKg,
      female: masses.masses.femaleKg,
      child: masses.masses.childKg,
      infant: masses.masses.infantKg,
    }[change.category as NonNullable<LmcChange["category"]>];
    return (change.deltaCount ?? 0) * perHead;
  }
  return change.deltaKg ?? 0;
}

export function applyChangesToLoad(
  load: LoadInput,
  changes: LmcChange[]
): LoadInput {
  const next: LoadInput = structuredClone(load);
  for (const change of changes) {
    if (change.kind === "passenger") {
      let zone = next.passengersByZone.find(p => p.zone === change.location);
      if (!zone) {
        zone = {
          zone: change.location,
          male: 0,
          female: 0,
          child: 0,
          infant: 0,
        };
        next.passengersByZone.push(zone);
      }
      const category = change.category as NonNullable<LmcChange["category"]>;
      zone[category] += change.deltaCount ?? 0;
      if (zone[category] < 0)
        throw new WeightBalanceDataError(
          `LMC removes more ${category} passengers from ${zone.zone} than are loaded`
        );
      continue;
    }
    let compartment = next.deadload.find(
      d => d.compartment === change.location
    );
    if (!compartment) {
      compartment = {
        compartment: change.location,
        baggagePieces: 0,
        baggageKg: 0,
        cargoKg: 0,
        mailKg: 0,
      };
      next.deadload.push(compartment);
    }
    const delta = change.deltaKg ?? 0;
    if (change.kind === "baggage") {
      // Baggage LMC is always a weighed figure; convert standard-mass bags first.
      const current =
        compartment.baggageKg ??
        compartment.baggagePieces * load.standardMasses.masses.checkedBagKg;
      compartment.baggageKg = current + delta;
      if (compartment.baggageKg < 0)
        throw new WeightBalanceDataError(
          `LMC removes more baggage from ${compartment.compartment} than is loaded`
        );
    } else {
      const key = change.kind === "cargo" ? "cargoKg" : "mailKg";
      compartment[key] += delta;
      if (compartment[key] < 0)
        throw new WeightBalanceDataError(
          `LMC removes more ${change.kind} from ${compartment.compartment} than is loaded`
        );
    }
  }
  return next;
}

/**
 * Recompute a signed load sheet with the accumulated LMC list. The LMC total
 * is the sum of absolute weight changes (conservative reading of the per-type
 * limit); once it exceeds the limit a new load sheet is required and the
 * figures are returned with `lmc.requiresNewLoadSheet = true`.
 */
export function applyLastMinuteChanges(
  type: TypeBalanceData,
  registration: RegistrationData,
  baseFigures: LoadSheetFigures,
  lmcList: LmcEntry[]
): LoadSheetFigures {
  const load = applyChangesToLoad(baseFigures.inputs, lmcList);
  const figures = computeLoadSheet(type, registration, load);
  const appliedKg = round(
    lmcList.reduce((sum, c) => sum + Math.abs(c.appliedKg), 0),
    1
  );
  const requiresNewLoadSheet = appliedKg > type.lmcLimitKg;
  if (requiresNewLoadSheet)
    figures.breaches.push(
      `LMC: cumulative change ${appliedKg} kg exceeds the ${type.lmcLimitKg} kg limit; a new load sheet is required`
    );
  return {
    ...figures,
    lmc: {
      limitKg: type.lmcLimitKg,
      appliedKg,
      remainingKg: round(type.lmcLimitKg - appliedKg, 1),
      requiresNewLoadSheet,
    },
    ok: figures.breaches.length === 0,
  };
}

// ============================================================================
// Aircraft change review
// ============================================================================

export type AircraftChangeReview = {
  from: { registration: string; typeCode: string; variant: string };
  to: { registration: string; typeCode: string; variant: string };
  sameTypeAndVariant: boolean;
  dataDifferences: string[];
  recomputed: LoadSheetFigures | null;
  recomputeError: string | null;
  checksStillValid: string[];
  checksRequiringReview: string[];
  requiresNewLoadSheet: true;
};

/**
 * Re-evaluate an issued load sheet's load under another registration and list
 * what the dispatcher must re-review. A new preliminary load sheet is always
 * required after an aircraft change; this only tells the controller why.
 */
export function reviewAircraftChange(
  previous: { type: TypeBalanceData; registration: RegistrationData },
  next: { type: TypeBalanceData; registration: RegistrationData },
  figures: LoadSheetFigures
): AircraftChangeReview {
  const differences: string[] = [];
  const label = (t: TypeBalanceData) =>
    `${t.typeCode}${t.variant ? `-${t.variant}` : ""} v${t.version}`;
  if (
    previous.type.typeCode !== next.type.typeCode ||
    previous.type.variant !== next.type.variant ||
    previous.type.version !== next.type.version
  )
    differences.push(
      `Balance dataset ${label(previous.type)} → ${label(next.type)}`
    );
  if (previous.registration.dowKg !== next.registration.dowKg)
    differences.push(
      `DOW ${previous.registration.dowKg} → ${next.registration.dowKg} kg`
    );
  if (previous.registration.doi !== next.registration.doi)
    differences.push(
      `DOI ${previous.registration.doi} → ${next.registration.doi}`
    );
  if (previous.registration.envelopeRef !== next.registration.envelopeRef)
    differences.push(
      `Envelope ${previous.registration.envelopeRef} → ${next.registration.envelopeRef}`
    );
  if (
    previous.registration.cabinConfigVersion !==
    next.registration.cabinConfigVersion
  )
    differences.push(
      `Cabin configuration ${previous.registration.cabinConfigVersion} → ${next.registration.cabinConfigVersion}`
    );
  const prevLimits = effectiveLimits(previous.type, previous.registration, {});
  const nextLimits = effectiveLimits(next.type, next.registration, {});
  for (const key of ["mzfwKg", "mtowKg", "mlwKg", "mrwKg"] as const)
    if (prevLimits[key] !== nextLimits[key])
      differences.push(
        `${key.replace("Kg", "").toUpperCase()} ${prevLimits[key] ?? "–"} → ${nextLimits[key] ?? "–"} kg`
      );
  const prevComp = new Map(
    previous.type.payload.compartments.map(c => [c.code, c])
  );
  for (const c of next.type.payload.compartments) {
    const before = prevComp.get(c.code);
    if (!before) differences.push(`Compartment ${c.code} added`);
    else if (before.maxKg !== c.maxKg || before.armM !== c.armM)
      differences.push(
        `Compartment ${c.code} max ${before.maxKg} → ${c.maxKg} kg, arm ${before.armM} → ${c.armM} m`
      );
    prevComp.delete(c.code);
  }
  for (const code of prevComp.keys())
    differences.push(`Compartment ${code} no longer exists`);
  const prevZones = new Map(
    previous.type.payload.cabinZones.map(z => [z.code, z])
  );
  for (const zone of next.type.payload.cabinZones) {
    const before = prevZones.get(zone.code);
    if (!before) differences.push(`Cabin zone ${zone.code} added`);
    else if (before.seats !== zone.seats || before.armM !== zone.armM)
      differences.push(
        `Cabin zone ${zone.code} seats ${before.seats} → ${zone.seats}, arm ${before.armM} → ${zone.armM} m`
      );
    prevZones.delete(zone.code);
  }
  for (const code of prevZones.keys())
    differences.push(`Cabin zone ${code} no longer exists`);

  let recomputed: LoadSheetFigures | null = null;
  let recomputeError: string | null = null;
  try {
    recomputed = computeLoadSheet(next.type, next.registration, figures.inputs);
  } catch (error) {
    recomputeError = error instanceof Error ? error.message : String(error);
  }
  const stillValid: string[] = [];
  const review: string[] = [];
  if (recomputed) {
    for (const c of recomputed.structuralChecks)
      (c.ok ? stillValid : review).push(
        `${c.code}: ${c.actualKg}/${c.limitKg} kg`
      );
    for (const [name, p] of [
      ["ZFW", recomputed.zfw],
      ["TOW", recomputed.tow],
      ["LAW", recomputed.law],
    ] as const)
      (p.withinEnvelope ? stillValid : review).push(
        `ENVELOPE:${name}: ${p.macPct}% MAC`
      );
    if (recomputed.underload.underloadKg < 0)
      review.push(
        `UNDERLOAD: traffic load exceeds allowed by ${Math.abs(recomputed.underload.underloadKg)} kg (${recomputed.underload.limitingFactor})`
      );
  } else {
    review.push(`RECOMPUTE: ${recomputeError}`);
  }
  return {
    from: {
      registration: previous.registration.registration,
      typeCode: previous.type.typeCode,
      variant: previous.type.variant,
    },
    to: {
      registration: next.registration.registration,
      typeCode: next.type.typeCode,
      variant: next.type.variant,
    },
    sameTypeAndVariant:
      previous.type.typeCode === next.type.typeCode &&
      previous.type.variant === next.type.variant,
    dataDifferences: differences,
    recomputed,
    recomputeError,
    checksStillValid: stillValid,
    checksRequiringReview: review,
    requiresNewLoadSheet: true,
  };
}

// ============================================================================
// Printable load sheet
// ============================================================================

export type LoadSheetHeader = {
  flightNumber: string;
  date: string;
  origin: string;
  destination: string;
  edition: number;
  status: string;
  basis: "full" | "lmc";
  preparedBy: string;
  preparedAt: string;
  signedBy: string | null;
  signedAt: string | null;
  dispatchApproved: boolean;
  crew: { cockpit: number; cabin: number } | null;
};

const pad = (value: string | number, width: number) =>
  String(value).padStart(width);

/** Fixed-width load sheet in the conventional LOADSHEET layout. */
export function renderLoadSheetText(
  header: LoadSheetHeader,
  figures: LoadSheetFigures,
  lmcList: LmcEntry[]
) {
  const lines: string[] = [];
  const banner = header.dispatchApproved
    ? "LOADSHEET"
    : "LOADSHEET - NOT DISPATCH-APPROVED - TRAINING/EVALUATION ONLY";
  lines.push(banner);
  if (figures.aircraft.fictional)
    lines.push("FICTIONAL TRAINING AIRCRAFT TYPE - NO CERTIFIED DATA");
  lines.push(
    `${header.status.toUpperCase()} EDN ${header.edition} ${header.basis === "lmc" ? "(LMC)" : ""}`.trim()
  );
  lines.push(
    `${header.flightNumber}/${header.date} ${header.origin} ${header.destination} ${figures.aircraft.registration} ${figures.aircraft.typeCode}${figures.aircraft.variant ? `-${figures.aircraft.variant}` : ""} CONF ${figures.aircraft.cabinConfigVersion}`
  );
  if (header.crew)
    lines.push(`CREW ${header.crew.cockpit}/${header.crew.cabin}`);
  lines.push(
    `PAX ${figures.passengers.byCategory.male}/${figures.passengers.byCategory.female}/${figures.passengers.byCategory.child}/${figures.passengers.byCategory.infant} TTL ${figures.passengers.total} (${figures.passengers.ruleSetId})`
  );
  lines.push("");
  lines.push(
    `DRY OPERATING WEIGHT      ${pad(figures.dow.weightKg, 8)}  DOI ${figures.dow.index}`
  );
  lines.push(
    `PASSENGER WEIGHT          ${pad(figures.passengers.weightKg, 8)}`
  );
  lines.push(`BAGGAGE                   ${pad(figures.deadload.baggageKg, 8)}`);
  lines.push(`CARGO                     ${pad(figures.deadload.cargoKg, 8)}`);
  lines.push(`MAIL                      ${pad(figures.deadload.mailKg, 8)}`);
  lines.push(`TOTAL TRAFFIC LOAD        ${pad(figures.trafficLoadKg, 8)}`);
  lines.push(
    `ZERO FUEL WEIGHT ACTUAL   ${pad(figures.zfw.weightKg, 8)}  MAX ${pad(figures.effectiveLimits.mzfwKg, 8)}  ${figures.zfw.withinEnvelope ? "" : "ENV!"}`.trimEnd()
  );
  lines.push(`TAKE OFF FUEL             ${pad(figures.fuel.takeoffKg, 8)}`);
  lines.push(
    `TAKE OFF WEIGHT ACTUAL    ${pad(figures.tow.weightKg, 8)}  MAX ${pad(Math.min(figures.effectiveLimits.mtowKg, figures.effectiveLimits.rtowKg ?? Infinity), 8)}  ${figures.tow.withinEnvelope ? "" : "ENV!"}`.trimEnd()
  );
  lines.push(`TRIP FUEL                 ${pad(figures.fuel.tripKg, 8)}`);
  lines.push(
    `LANDING WEIGHT ACTUAL     ${pad(figures.law.weightKg, 8)}  MAX ${pad(Math.min(figures.effectiveLimits.mlwKg, figures.effectiveLimits.performanceMlawKg ?? Infinity), 8)}  ${figures.law.withinEnvelope ? "" : "ENV!"}`.trimEnd()
  );
  lines.push(
    `UNDERLOAD BEFORE LMC      ${pad(figures.underload.underloadKg, 8)}  (${figures.underload.limitingFactor})`
  );
  lines.push("");
  lines.push(
    `BALANCE  ZFW ${figures.zfw.macPct.toFixed(2)}%MAC (${figures.zfw.fwdLimitMacPct ?? "-"}/${figures.zfw.aftLimitMacPct ?? "-"})  TOW ${figures.tow.macPct.toFixed(2)}%MAC (${figures.tow.fwdLimitMacPct ?? "-"}/${figures.tow.aftLimitMacPct ?? "-"})  LAW ${figures.law.macPct.toFixed(2)}%MAC (${figures.law.fwdLimitMacPct ?? "-"}/${figures.law.aftLimitMacPct ?? "-"})`
  );
  lines.push(
    `INDEX    ZFI ${figures.zfw.index}  TOI ${figures.tow.index}  LI ${figures.law.index}`
  );
  lines.push(
    `STAB TRIM ${figures.trim.stabTrimUnits ?? "N/A"} (${figures.trim.source})`
  );
  lines.push("");
  lines.push(
    "LOAD IN COMPARTMENTS " +
      figures.deadload.byCompartment
        .map(c => `${c.compartment}/${c.totalKg}`)
        .join(" ")
  );
  lines.push(
    "PAX IN ZONES " +
      figures.passengers.byZone.map(z => `${z.zone}/${z.count}`).join(" ")
  );
  if (lmcList.length) {
    lines.push("");
    lines.push(`LMC (${figures.lmc.appliedKg}/${figures.lmc.limitKg} kg)`);
    for (const lmc of lmcList)
      lines.push(
        `  ${lmc.sequence}. ${lmc.kind.toUpperCase()} ${lmc.location} ${lmc.appliedKg >= 0 ? "+" : ""}${lmc.appliedKg} kg ${lmc.description} (${lmc.actorName ?? lmc.actorId} ${lmc.appliedAt})`
      );
  }
  if (figures.breaches.length) {
    lines.push("");
    lines.push("LIMIT BREACHES");
    for (const b of figures.breaches) lines.push(`  ${b}`);
  }
  lines.push("");
  lines.push(`PREPARED BY ${header.preparedBy} ${header.preparedAt}`);
  lines.push(
    header.signedBy
      ? `SIGNED BY ${header.signedBy} ${header.signedAt}`
      : "UNSIGNED - PRELIMINARY"
  );
  return lines.join("\n");
}
