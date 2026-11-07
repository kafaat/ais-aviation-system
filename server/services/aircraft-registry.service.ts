/**
 * Aircraft registry: per type/variant AHM 560/565 balance datasets and per
 * registration DOW/DOI, limits and envelope references.
 *
 * No certified figures for a real type are shipped. Datasets arrive through
 * the validated JSON import below (or the clearly fictional training fixture,
 * which is refused in production and can never be operator-approved).
 */
import { and, desc, eq, lte, gte, or, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import {
  aircraftRegistrations,
  aircraftTypeBalanceData,
  airlines,
  type AircraftRegistration,
  type AircraftTypeBalanceData,
} from "../../drizzle/schema";
import {
  assertRegistrationMatchesType,
  registrationSchema,
  typeBalanceDataSchema,
  typeBalancePayloadSchema,
  WeightBalanceDataError,
  type RegistrationData,
  type TypeBalanceData,
} from "./weight-balance-engine";
import {
  TRAINING_REGISTRATION_AIS_TR1,
  TRAINING_REGISTRATION_AIS_TR2,
  TRAINING_TYPE_AIS_T1,
  TRAINING_TYPE_AIS_T1_HD,
} from "./weight-balance-training-fixture";
import { demoCapabilitiesEnabled } from "./demo-capability";

export type Actor = { id: number; name?: string | null };

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

function dataError(error: unknown): never {
  if (error instanceof WeightBalanceDataError || error instanceof z.ZodError)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof z.ZodError
          ? z.prettifyError(error)
          : (error as Error).message,
    });
  throw error;
}

// ============================================================================
// Type balance datasets
// ============================================================================

export const typeBalanceImportSchema = typeBalanceDataSchema
  .omit({ version: true })
  .extend({
    tenantId: z.number().int().positive().nullable().default(null),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable().default(null),
  })
  .strict();
export type TypeBalanceImport = z.infer<typeof typeBalanceImportSchema>;

export function toTypeBalanceData(
  row: AircraftTypeBalanceData
): TypeBalanceData {
  try {
    return typeBalanceDataSchema.parse({
      typeCode: row.typeCode,
      variant: row.variant,
      version: row.version,
      description: row.description,
      dataSource: row.dataSource,
      fictional: row.fictional,
      limits: {
        mtowKg: row.mtowKg,
        mlwKg: row.mlwKg,
        mzfwKg: row.mzfwKg,
        mrwKg: row.mrwKg,
        maxFuelKg: row.maxFuelKg,
      },
      lmcLimitKg: row.lmcLimitKg,
      payload: typeBalancePayloadSchema.parse(row.payload),
    });
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Balance dataset ${row.id} is no longer valid: ${
        error instanceof z.ZodError ? z.prettifyError(error) : String(error)
      }`,
    });
  }
}

function summariseType(row: AircraftTypeBalanceData) {
  const data = toTypeBalanceData(row);
  return {
    id: row.id,
    tenantId: row.tenantId,
    typeCode: row.typeCode,
    variant: row.variant,
    version: row.version,
    description: row.description,
    dataSource: row.dataSource,
    fictional: row.fictional,
    approvalStatus: row.approvalStatus,
    approvalReference: row.approvalReference,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    limits: data.limits,
    lmcLimitKg: row.lmcLimitKg,
    compartments: data.payload.compartments,
    cumulativeLimits: data.payload.cumulativeLimits,
    cabinZones: data.payload.cabinZones,
    envelopeRefs: data.payload.envelopes.map(e => e.ref),
    hasTrimTable: Boolean(data.payload.trimTable),
    index: data.payload.index,
    createdAt: row.createdAt,
  };
}
export type TypeBalanceSummary = ReturnType<typeof summariseType>;

export async function importTypeBalanceData(
  input: unknown,
  actor: Actor
): Promise<TypeBalanceSummary> {
  let parsed: TypeBalanceImport;
  try {
    parsed = typeBalanceImportSchema.parse(input);
  } catch (error) {
    return dataError(error);
  }
  if (parsed.fictional && !demoCapabilitiesEnabled())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Fictional training datasets are only accepted in development with AIS_ENABLE_DEMOS",
    });
  if (
    parsed.effectiveTo &&
    Date.parse(parsed.effectiveTo) <= Date.parse(parsed.effectiveFrom)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "effectiveTo must be after effectiveFrom",
    });
  const db = await requireDb();
  return db.transaction(async tx => {
    const [latest] = await tx
      .select({ version: aircraftTypeBalanceData.version })
      .from(aircraftTypeBalanceData)
      .where(
        and(
          eq(aircraftTypeBalanceData.typeCode, parsed.typeCode),
          eq(aircraftTypeBalanceData.variant, parsed.variant)
        )
      )
      .orderBy(desc(aircraftTypeBalanceData.version))
      .limit(1)
      .for("update");
    const version = (latest?.version ?? 0) + 1;
    const [result] = await tx.insert(aircraftTypeBalanceData).values({
      tenantId: parsed.tenantId,
      typeCode: parsed.typeCode,
      variant: parsed.variant,
      version,
      description: parsed.description,
      dataSource: parsed.dataSource,
      fictional: parsed.fictional,
      approvalStatus: "draft",
      approvalReference: null,
      effectiveFrom: new Date(parsed.effectiveFrom),
      effectiveTo: parsed.effectiveTo ? new Date(parsed.effectiveTo) : null,
      mtowKg: parsed.limits.mtowKg,
      mlwKg: parsed.limits.mlwKg,
      mzfwKg: parsed.limits.mzfwKg,
      mrwKg: parsed.limits.mrwKg ?? null,
      maxFuelKg: parsed.limits.maxFuelKg,
      lmcLimitKg: parsed.lmcLimitKg,
      payload: parsed.payload,
      createdBy: actor.id,
    });
    const id = Number(result.insertId);
    const [row] = await tx
      .select()
      .from(aircraftTypeBalanceData)
      .where(eq(aircraftTypeBalanceData.id, id))
      .limit(1);
    if (!row) throw new Error("Balance dataset identity unavailable");
    return summariseType(row);
  });
}

export async function listTypeBalanceData(filters?: {
  typeCode?: string;
  includeWithdrawn?: boolean;
}) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(aircraftTypeBalanceData)
    .where(
      and(
        filters?.typeCode
          ? eq(aircraftTypeBalanceData.typeCode, filters.typeCode)
          : undefined,
        filters?.includeWithdrawn
          ? undefined
          : sql`${aircraftTypeBalanceData.approvalStatus} <> 'withdrawn'`
      )
    )
    .orderBy(
      aircraftTypeBalanceData.typeCode,
      aircraftTypeBalanceData.variant,
      desc(aircraftTypeBalanceData.version)
    );
  return rows.map(summariseType);
}

export async function getTypeBalanceDataRow(id: number) {
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(aircraftTypeBalanceData)
    .where(eq(aircraftTypeBalanceData.id, id))
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Balance dataset ${id} not found`,
    });
  return row;
}

export async function getTypeBalanceDataDetail(id: number) {
  const row = await getTypeBalanceDataRow(id);
  return { ...summariseType(row), data: toTypeBalanceData(row) };
}

export async function setTypeBalanceApproval(
  id: number,
  decision: {
    approvalStatus: "operator_approved" | "withdrawn";
    approvalReference: string;
  },
  actor: Actor
) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(aircraftTypeBalanceData)
      .where(eq(aircraftTypeBalanceData.id, id))
      .limit(1)
      .for("update");
    if (!row)
      throw new TRPCError({ code: "NOT_FOUND", message: "Dataset not found" });
    if (decision.approvalStatus === "operator_approved" && row.fictional)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "A fictional training dataset cannot be operator-approved",
      });
    if (row.approvalStatus === "withdrawn")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Withdrawn datasets cannot be changed; import a new version",
      });
    await tx
      .update(aircraftTypeBalanceData)
      .set({
        approvalStatus: decision.approvalStatus,
        approvalReference:
          `${decision.approvalReference} (by ${actor.name ?? actor.id})`.slice(
            0,
            100
          ),
      })
      .where(eq(aircraftTypeBalanceData.id, id));
    const [updated] = await tx
      .select()
      .from(aircraftTypeBalanceData)
      .where(eq(aircraftTypeBalanceData.id, id))
      .limit(1);
    if (!updated) throw new Error("Dataset missing after update");
    return summariseType(updated);
  });
}

// ============================================================================
// Registrations
// ============================================================================

export const registrationImportSchema = registrationSchema
  .extend({
    tenantId: z.number().int().positive().nullable().default(null),
    airlineId: z.number().int().positive(),
    balanceDataId: z.number().int().positive(),
    weighingReference: z.string().trim().max(100).nullable().default(null),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable().default(null),
  })
  .strict();
export type RegistrationImport = z.infer<typeof registrationImportSchema>;

export function toRegistrationData(
  row: AircraftRegistration
): RegistrationData {
  try {
    return registrationSchema.parse({
      registration: row.registration,
      typeCode: row.typeCode,
      variant: row.variant,
      dowKg: row.dowKg,
      doi: Number(row.doi),
      limits: {
        mtowKg: row.mtowKg,
        mlwKg: row.mlwKg,
        mzfwKg: row.mzfwKg,
        mrwKg: row.mrwKg,
      },
      fuelCapacityKg: row.fuelCapacityKg,
      cabinConfigVersion: row.cabinConfigVersion,
      envelopeRef: row.envelopeRef,
    });
  } catch (error) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Registration record ${row.id} is no longer valid: ${
        error instanceof z.ZodError ? z.prettifyError(error) : String(error)
      }`,
    });
  }
}

function summariseRegistration(row: AircraftRegistration) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    airlineId: row.airlineId,
    registration: row.registration,
    balanceDataId: row.balanceDataId,
    typeCode: row.typeCode,
    variant: row.variant,
    dowKg: row.dowKg,
    doi: Number(row.doi),
    limits: {
      mtowKg: row.mtowKg,
      mlwKg: row.mlwKg,
      mzfwKg: row.mzfwKg,
      mrwKg: row.mrwKg,
    },
    fuelCapacityKg: row.fuelCapacityKg,
    cabinConfigVersion: row.cabinConfigVersion,
    envelopeRef: row.envelopeRef,
    weighingReference: row.weighingReference,
    approvalStatus: row.approvalStatus,
    approvalReference: row.approvalReference,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    createdAt: row.createdAt,
  };
}
export type RegistrationSummary = ReturnType<typeof summariseRegistration>;

export async function importRegistration(input: unknown, actor: Actor) {
  let parsed: RegistrationImport;
  try {
    parsed = registrationImportSchema.parse(input);
  } catch (error) {
    return dataError(error);
  }
  if (
    parsed.effectiveTo &&
    Date.parse(parsed.effectiveTo) <= Date.parse(parsed.effectiveFrom)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "effectiveTo must be after effectiveFrom",
    });
  const db = await requireDb();
  return db.transaction(async tx => {
    const [airline] = await tx
      .select({ id: airlines.id })
      .from(airlines)
      .where(eq(airlines.id, parsed.airlineId))
      .limit(1);
    if (!airline)
      throw new TRPCError({ code: "NOT_FOUND", message: "Operator not found" });
    const [typeRow] = await tx
      .select()
      .from(aircraftTypeBalanceData)
      .where(eq(aircraftTypeBalanceData.id, parsed.balanceDataId))
      .limit(1);
    if (!typeRow)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Balance dataset not found",
      });
    if (typeRow.approvalStatus === "withdrawn")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Balance dataset is withdrawn",
      });
    const {
      tenantId,
      airlineId,
      balanceDataId,
      weighingReference,
      effectiveFrom,
      effectiveTo,
      ...registration
    } = parsed;
    try {
      assertRegistrationMatchesType(toTypeBalanceData(typeRow), registration);
    } catch (error) {
      return dataError(error);
    }
    const [duplicate] = await tx
      .select({ id: aircraftRegistrations.id })
      .from(aircraftRegistrations)
      .where(
        and(
          eq(aircraftRegistrations.registration, registration.registration),
          eq(aircraftRegistrations.effectiveFrom, new Date(effectiveFrom))
        )
      )
      .limit(1);
    if (duplicate)
      throw new TRPCError({
        code: "CONFLICT",
        message: `${registration.registration} already has a record effective ${effectiveFrom}`,
      });
    const [result] = await tx.insert(aircraftRegistrations).values({
      tenantId,
      airlineId,
      registration: registration.registration,
      balanceDataId,
      typeCode: registration.typeCode,
      variant: registration.variant,
      dowKg: registration.dowKg,
      doi: registration.doi.toFixed(2),
      mtowKg: registration.limits.mtowKg ?? null,
      mlwKg: registration.limits.mlwKg ?? null,
      mzfwKg: registration.limits.mzfwKg ?? null,
      mrwKg: registration.limits.mrwKg ?? null,
      fuelCapacityKg: registration.fuelCapacityKg,
      cabinConfigVersion: registration.cabinConfigVersion,
      envelopeRef: registration.envelopeRef,
      weighingReference,
      approvalStatus: "draft",
      approvalReference: null,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      createdBy: actor.id,
    });
    const [row] = await tx
      .select()
      .from(aircraftRegistrations)
      .where(eq(aircraftRegistrations.id, Number(result.insertId)))
      .limit(1);
    if (!row) throw new Error("Registration identity unavailable");
    return summariseRegistration(row);
  });
}

export async function listRegistrations(filters?: {
  airlineId?: number;
  registration?: string;
  includeWithdrawn?: boolean;
}) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(aircraftRegistrations)
    .where(
      and(
        filters?.airlineId
          ? eq(aircraftRegistrations.airlineId, filters.airlineId)
          : undefined,
        filters?.registration
          ? eq(aircraftRegistrations.registration, filters.registration)
          : undefined,
        filters?.includeWithdrawn
          ? undefined
          : sql`${aircraftRegistrations.approvalStatus} <> 'withdrawn'`
      )
    )
    .orderBy(
      aircraftRegistrations.registration,
      desc(aircraftRegistrations.effectiveFrom)
    );
  return rows.map(summariseRegistration);
}

export async function getRegistrationRow(id: number) {
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(aircraftRegistrations)
    .where(eq(aircraftRegistrations.id, id))
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Aircraft registration record ${id} not found`,
    });
  return row;
}

export async function setRegistrationApproval(
  id: number,
  decision: {
    approvalStatus: "operator_approved" | "withdrawn";
    approvalReference: string;
  },
  actor: Actor
) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(aircraftRegistrations)
      .where(eq(aircraftRegistrations.id, id))
      .limit(1)
      .for("update");
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Registration not found",
      });
    if (row.approvalStatus === "withdrawn")
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Withdrawn registrations cannot be changed; import a new record",
      });
    if (decision.approvalStatus === "operator_approved") {
      const typeRow = await getTypeBalanceDataRow(row.balanceDataId);
      if (typeRow.fictional || typeRow.approvalStatus !== "operator_approved")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The registration's balance dataset must be operator-approved first",
        });
    }
    await tx
      .update(aircraftRegistrations)
      .set({
        approvalStatus: decision.approvalStatus,
        approvalReference:
          `${decision.approvalReference} (by ${actor.name ?? actor.id})`.slice(
            0,
            100
          ),
      })
      .where(eq(aircraftRegistrations.id, id));
    const [updated] = await tx
      .select()
      .from(aircraftRegistrations)
      .where(eq(aircraftRegistrations.id, id))
      .limit(1);
    if (!updated) throw new Error("Registration missing after update");
    return summariseRegistration(updated);
  });
}

// ============================================================================
// Resolution for a computation
// ============================================================================

export type ResolvedAircraft = {
  registrationRow: AircraftRegistration;
  typeRow: AircraftTypeBalanceData;
  registration: RegistrationData;
  type: TypeBalanceData;
  approval: {
    registration: AircraftRegistration["approvalStatus"];
    type: AircraftTypeBalanceData["approvalStatus"];
    operatorApproved: boolean;
  };
};

/** Loads both records, checks they are effective at `at` and mutually consistent. */
export async function resolveAircraft(
  registrationId: number,
  at: Date
): Promise<ResolvedAircraft> {
  const registrationRow = await getRegistrationRow(registrationId);
  const typeRow = await getTypeBalanceDataRow(registrationRow.balanceDataId);
  for (const [label, row] of [
    ["Registration", registrationRow],
    ["Balance dataset", typeRow],
  ] as const) {
    if (row.approvalStatus === "withdrawn")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${label} ${row.id} is withdrawn`,
      });
    if (
      row.effectiveFrom.getTime() > at.getTime() ||
      (row.effectiveTo && row.effectiveTo.getTime() <= at.getTime())
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${label} ${row.id} is not effective on ${at.toISOString().slice(0, 10)}`,
      });
  }
  const type = toTypeBalanceData(typeRow);
  const registration = toRegistrationData(registrationRow);
  try {
    assertRegistrationMatchesType(type, registration);
  } catch (error) {
    return dataError(error);
  }
  return {
    registrationRow,
    typeRow,
    registration,
    type,
    approval: {
      registration: registrationRow.approvalStatus,
      type: typeRow.approvalStatus,
      operatorApproved:
        registrationRow.approvalStatus === "operator_approved" &&
        typeRow.approvalStatus === "operator_approved",
    },
  };
}

/** Registrations effective at `at` for an operator, for selection lists. */
export async function listEffectiveRegistrations(airlineId: number, at: Date) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(aircraftRegistrations)
    .where(
      and(
        eq(aircraftRegistrations.airlineId, airlineId),
        sql`${aircraftRegistrations.approvalStatus} <> 'withdrawn'`,
        lte(aircraftRegistrations.effectiveFrom, at),
        or(
          isNull(aircraftRegistrations.effectiveTo),
          gte(aircraftRegistrations.effectiveTo, at)
        )
      )
    )
    .orderBy(aircraftRegistrations.registration);
  return rows.map(summariseRegistration);
}

// ============================================================================
// Fictional training fixture (development only)
// ============================================================================

/**
 * Seeds the fictional AIS-T1 datasets and two registrations for the given
 * operator. Refused outside development; the rows stay `draft` and `fictional`.
 */
export async function seedTrainingFixture(airlineId: number, actor: Actor) {
  if (!demoCapabilitiesEnabled())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Training fixtures are only available in development with AIS_ENABLE_DEMOS",
    });
  const existing = await listTypeBalanceData({ typeCode: "AIS-T1" });
  const ensureType = (data: TypeBalanceData) => {
    const found = existing.find(
      t => t.typeCode === data.typeCode && t.variant === data.variant
    );
    if (found) return Promise.resolve(found);
    const { version: _version, ...rest } = data;
    return importTypeBalanceData(
      { ...rest, effectiveFrom: "2026-01-01", effectiveTo: null },
      actor
    );
  };
  const base = await ensureType(TRAINING_TYPE_AIS_T1);
  const hd = await ensureType(TRAINING_TYPE_AIS_T1_HD);
  const registrations = await listRegistrations({ airlineId });
  const ensureRegistration = (
    data: RegistrationData,
    balanceDataId: number
  ) => {
    const found = registrations.find(r => r.registration === data.registration);
    if (found) return Promise.resolve(found);
    return importRegistration(
      {
        ...data,
        airlineId,
        balanceDataId,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        weighingReference: "fictional training weighing",
      },
      actor
    );
  };
  return {
    types: [base, hd],
    registrations: [
      await ensureRegistration(TRAINING_REGISTRATION_AIS_TR1, base.id),
      await ensureRegistration(TRAINING_REGISTRATION_AIS_TR2, hd.id),
    ],
  };
}
