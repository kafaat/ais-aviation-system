// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
import {
  compartmentSchema,
  cumulativeLimitSchema,
  cabinZoneSchema,
  loadInputSchema,
  standardMassRuleSetSchema,
} from "../services/weight-balance-engine";

const number = z.number().finite();
const approvalStatus = z.enum(["draft", "operator_approved", "withdrawn"]);
const limitCheck = z.object({
  code: z.string(),
  description: z.string(),
  limitKg: number,
  actualKg: number,
  marginKg: number,
  ok: z.boolean(),
});
const phase = z.object({
  weightKg: number,
  index: number,
  macPct: number,
  fwdLimitMacPct: number.nullable(),
  aftLimitMacPct: number.nullable(),
  withinEnvelope: z.boolean(),
});

/**
 * Stable load sheet figures shape (engine `LoadSheetFigures`, schemaVersion 1).
 * Type B LDM/CPM producers read this through
 * `getFinalLoadSheetFigures` in server/services/load-sheet-figures.service.ts.
 */
export const loadSheetFiguresContract = z.object({
  schemaVersion: z.literal(1),
  aircraft: z.object({
    registration: z.string(),
    typeCode: z.string(),
    variant: z.string(),
    balanceDataVersion: number,
    cabinConfigVersion: z.string(),
    envelopeRef: z.string(),
    fictional: z.boolean(),
  }),
  inputs: loadInputSchema,
  dow: z.object({ weightKg: number, index: number }),
  passengers: z.object({
    total: number,
    seated: number,
    byCategory: z.object({
      male: number,
      female: number,
      child: number,
      infant: number,
    }),
    byZone: z.array(
      z.object({
        zone: z.string(),
        count: number,
        seats: number,
        weightKg: number,
        index: number,
      })
    ),
    weightKg: number,
    index: number,
    ruleSetId: z.string(),
    ruleSetConfirmation: z.enum([
      "requires_operator_confirmation",
      "operator_confirmed",
    ]),
  }),
  deadload: z.object({
    byCompartment: z.array(
      z.object({
        compartment: z.string(),
        baggagePieces: number,
        baggageKg: number,
        baggageWeighed: z.boolean(),
        cargoKg: number,
        mailKg: number,
        totalKg: number,
        maxKg: number,
        index: number,
      })
    ),
    baggageKg: number,
    cargoKg: number,
    mailKg: number,
    totalKg: number,
    index: number,
  }),
  trafficLoadKg: number,
  fuel: z.object({
    blockKg: number,
    taxiKg: number,
    takeoffKg: number,
    tripKg: number,
    landingKg: number,
    takeoffIndex: number,
    landingIndex: number,
  }),
  zfw: phase,
  tow: phase,
  law: phase,
  rampWeightKg: number,
  effectiveLimits: z.object({
    mzfwKg: number,
    mtowKg: number,
    mlwKg: number,
    mrwKg: number.nullable(),
    rtowKg: number.nullable(),
    performanceMlawKg: number.nullable(),
  }),
  structuralChecks: z.array(limitCheck),
  underload: z.object({
    allowedTrafficLoadKg: number,
    actualTrafficLoadKg: number,
    underloadKg: number,
    limitingFactor: z.enum(["MZFW", "MTOW", "MLW"]),
  }),
  trim: z.object({
    towMacPct: number,
    stabTrimUnits: number.nullable(),
    source: z.string(),
  }),
  lmc: z.object({
    limitKg: number,
    appliedKg: number,
    remainingKg: number,
    requiresNewLoadSheet: z.boolean(),
  }),
  breaches: z.array(z.string()),
  ok: z.boolean(),
});

const lmcEntry = z.object({
  sequence: number,
  kind: z.enum(["passenger", "baggage", "cargo", "mail"]),
  location: z.string(),
  category: z.enum(["male", "female", "child", "infant"]).optional(),
  deltaCount: number.optional(),
  deltaKg: number.optional(),
  description: z.string(),
  appliedKg: number,
  actorId: number,
  actorName: z.string().nullable(),
  appliedAt: z.string(),
});

const flightHeader = z.object({
  flightId: outputNumber,
  flightNumber: z.string(),
  airlineId: outputNumber,
  date: z.string(),
  departureTime: z.string(),
  origin: z.string(),
  destination: z.string(),
  crew: z.object({ cockpit: number, cabin: number }).nullable(),
});

export const loadSheetRecordContract = z.object({
  id: outputNumber,
  flightId: outputNumber,
  registrationId: outputNumber,
  balanceDataId: outputNumber,
  edition: outputNumber,
  basis: z.enum(["full", "lmc"]),
  status: z.enum([
    "preliminary",
    "final",
    "superseded",
    "superseded_by_aircraft_change",
  ]),
  baseEditionId: outputNumber.nullable(),
  dispatchApproved: z.boolean(),
  flight: flightHeader,
  figures: loadSheetFiguresContract,
  approval: z.object({
    registrationApproval: approvalStatus,
    typeApproval: approvalStatus,
    operatorApproved: z.boolean(),
    ruleSetConfirmation: z.enum([
      "requires_operator_confirmation",
      "operator_confirmed",
    ]),
  }),
  remarks: z.array(z.string()),
  lmcList: z.array(lmcEntry),
  digest: z.string(),
  preparedBy: outputNumber,
  preparedAt: z.date(),
  signedBy: outputNumber.nullable(),
  signedByName: z.string().nullable(),
  signedAt: z.date().nullable(),
  supersededAt: z.date().nullable(),
});

const typeSummary = z.object({
  id: outputNumber,
  tenantId: outputNumber.nullable(),
  typeCode: z.string(),
  variant: z.string(),
  version: outputNumber,
  description: z.string(),
  dataSource: z.string(),
  fictional: z.boolean(),
  approvalStatus,
  approvalReference: z.string().nullable(),
  effectiveFrom: z.date(),
  effectiveTo: z.date().nullable(),
  limits: z.object({
    mtowKg: number,
    mlwKg: number,
    mzfwKg: number,
    mrwKg: number.nullable().optional(),
    maxFuelKg: number,
  }),
  lmcLimitKg: number,
  compartments: z.array(compartmentSchema),
  cumulativeLimits: z.array(cumulativeLimitSchema),
  cabinZones: z.array(cabinZoneSchema),
  envelopeRefs: z.array(z.string()),
  hasTrimTable: z.boolean(),
  index: z.object({
    c: number,
    k: number,
    referenceStationM: number,
    lemacM: number,
    macLengthM: number,
  }),
  createdAt: z.date(),
});

const registrationSummary = z.object({
  id: outputNumber,
  tenantId: outputNumber.nullable(),
  airlineId: outputNumber,
  registration: z.string(),
  balanceDataId: outputNumber,
  typeCode: z.string(),
  variant: z.string(),
  dowKg: number,
  doi: number,
  limits: z.object({
    mtowKg: number.nullable(),
    mlwKg: number.nullable(),
    mzfwKg: number.nullable(),
    mrwKg: number.nullable(),
  }),
  fuelCapacityKg: number,
  cabinConfigVersion: z.string(),
  envelopeRef: z.string(),
  weighingReference: z.string().nullable(),
  approvalStatus,
  approvalReference: z.string().nullable(),
  effectiveFrom: z.date(),
  effectiveTo: z.date().nullable(),
  createdAt: z.date(),
});

const aircraftChangeReview = z.object({
  from: z.object({
    registration: z.string(),
    typeCode: z.string(),
    variant: z.string(),
  }),
  to: z.object({
    registration: z.string(),
    typeCode: z.string(),
    variant: z.string(),
  }),
  sameTypeAndVariant: z.boolean(),
  dataDifferences: z.array(z.string()),
  recomputed: loadSheetFiguresContract.nullable(),
  recomputeError: z.string().nullable(),
  checksStillValid: z.array(z.string()),
  checksRequiringReview: z.array(z.string()),
  requiresNewLoadSheet: z.literal(true),
});

export const responseContracts = {
  listTypeBalanceData: z.array(typeSummary),
  getTypeBalanceData: typeSummary.extend({
    data: z.object({
      typeCode: z.string(),
      variant: z.string(),
      version: number,
      description: z.string(),
      dataSource: z.string(),
      fictional: z.boolean(),
      limits: typeSummary.shape.limits,
      lmcLimitKg: number,
      payload: z.object({
        unitSystem: z.literal("kg_m"),
        index: typeSummary.shape.index,
        compartments: z.array(compartmentSchema),
        cumulativeLimits: z.array(cumulativeLimitSchema),
        cabinZones: z.array(cabinZoneSchema),
        fuelIndexTable: z.array(z.object({ fuelKg: number, index: number })),
        envelopes: z.array(
          z.object({
            ref: z.string(),
            zfw: z.array(
              z.object({
                weightKg: number,
                fwdMacPct: number,
                aftMacPct: number,
              })
            ),
            tow: z.array(
              z.object({
                weightKg: number,
                fwdMacPct: number,
                aftMacPct: number,
              })
            ),
            law: z.array(
              z.object({
                weightKg: number,
                fwdMacPct: number,
                aftMacPct: number,
              })
            ),
          })
        ),
        trimTable: z
          .array(z.object({ macPct: number, trimUnits: number }))
          .optional(),
      }),
    }),
  }),
  importTypeBalanceData: typeSummary,
  setTypeBalanceApproval: typeSummary,
  listRegistrations: z.array(registrationSummary),
  importRegistration: registrationSummary,
  setRegistrationApproval: registrationSummary,
  seedTrainingFixture: z.object({
    types: z.array(typeSummary),
    registrations: z.array(registrationSummary),
  }),
  listStandardMassRuleSets: z.array(standardMassRuleSetSchema),
  compute: loadSheetRecordContract,
  getLatest: loadSheetRecordContract.nullable(),
  listEditions: z.array(loadSheetRecordContract),
  getEdition: loadSheetRecordContract,
  sign: loadSheetRecordContract,
  applyLmc: loadSheetRecordContract,
  renderDocument: z.object({
    id: outputNumber,
    edition: outputNumber,
    status: loadSheetRecordContract.shape.status,
    dispatchApproved: z.boolean(),
    text: z.string(),
    remarks: z.array(z.string()),
  }),
  changeAircraft: z.object({
    auditId: outputNumber,
    invalidatedEditionIds: z.array(outputNumber),
    review: aircraftChangeReview,
    requiresNewLoadSheet: z.literal(true),
  }),
  listAircraftChanges: z.array(
    z.object({
      id: outputNumber,
      tenantId: outputNumber.nullable(),
      flightId: outputNumber,
      fromRegistrationId: outputNumber,
      toRegistrationId: outputNumber,
      invalidatedEditionIds: z.array(number),
      review: z.object({
        from: aircraftChangeReview.shape.from,
        to: aircraftChangeReview.shape.to,
        sameTypeAndVariant: z.boolean(),
        dataDifferences: z.array(z.string()),
        checksStillValid: z.array(z.string()),
        checksRequiringReview: z.array(z.string()),
        recomputeError: z.string().nullable(),
        recomputedOk: z.boolean().nullable(),
        referenceEditionId: number,
      }),
      reason: z.string(),
      changedBy: outputNumber,
      changedByName: z.string().nullable(),
      changedAt: z.date(),
    })
  ),
};
