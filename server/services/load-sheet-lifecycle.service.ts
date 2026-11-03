import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  aircraftBalanceProfiles,
  aircraftRegistrations,
  aircraftTypes,
  auditLogs,
  flights,
  loadSheetDocuments,
  loadPlans,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { requireDemoCapability } from "./demo-capability";
import { tenantCondition } from "./tenant-scope.service";
import {
  calculateOperationalWeightBalance,
  createSignedLoadSheetDraft,
  verifySignedLoadSheetDraft,
  loadSheetInputsDigest,
} from "./operational-weight-balance.service";

type Tx = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];
type Actor = { userId: number; tenantId: number | null };
const id = z.number().int().positive();
export const assignmentInput = z.object({
  flightId: id,
  registrationId: id,
  expectedRegistrationId: id.nullable(),
  expectedEdition: z.number().int().nonnegative().optional(),
  expectedAssignmentEventId: id.nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
const loadInput = z
  .object({
    trafficLoadKg: z.number().nonnegative(),
    trafficIndex: z.number().finite(),
    takeoffFuelKg: z.number().nonnegative(),
    takeoffFuelIndex: z.number().finite(),
    tripFuelKg: z.number().nonnegative(),
    tripFuelIndex: z.number().finite(),
  })
  .strict();
export const sheetInput = z.object({
  flightId: id,
  registrationId: id,
  profileId: id,
  expectedAssignmentEventId: id.nullable().optional(),
  expectedEdition: z.number().int().nonnegative(),
  load: loadInput,
});
export const reviewInput = z.object({ flightId: id, edition: id });

async function database() {
  requireDemoCapability("weightBalance");
  const db = await getDb();
  if (!db) throw new Error("Load-sheet storage unavailable");
  return db;
}

async function lockFlight(tx: Tx, flightId: number, actor: Actor) {
  const [flight] = await tx
    .select()
    .from(flights)
    .where(
      and(
        eq(flights.id, flightId),
        tenantCondition(flights.tenantId, actor.tenantId)
      )
    )
    .limit(1)
    .for("update");
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  if (flight.status === "cancelled" || flight.status === "completed")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Flight is closed",
    });
  return flight;
}

/** Serialize simulated approval/finalization with assignment. No simulated plan
 * may stand in for dispatch acceptance when a controlled registration exists. */
export async function lockSimulatedLoadPlanFlight(tx: Tx, flightId: number) {
  const [flight] = await tx
    .select({ registrationId: flights.aircraftRegistrationId })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1)
    .for("update");
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  if (flight.registrationId != null)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Controlled aircraft requires load-sheet reevaluation and separate dispatch acceptance",
    });
}

async function latestSheet(tx: Tx, flightId: number) {
  const [latest] = await tx
    .select()
    .from(loadSheetDocuments)
    .where(eq(loadSheetDocuments.flightId, flightId))
    .orderBy(desc(loadSheetDocuments.edition))
    .limit(1)
    .for("update");
  return latest;
}

async function lastAssignment(tx: Tx, flightId: number) {
  const [receipt] = await tx
    .select({
      id: auditLogs.id,
      userId: auditLogs.userId,
      reason: auditLogs.changeDescription,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "flight"),
        eq(auditLogs.resourceId, String(flightId)),
        eq(auditLogs.eventType, "LOAD_SHEET_AIRCRAFT_ASSIGNED")
      )
    )
    .orderBy(desc(auditLogs.id))
    .limit(1);
  return receipt ?? null;
}

async function checkAssignmentReceipt(
  tx: Tx,
  flightId: number,
  expected: number | null | undefined
) {
  if (
    expected !== undefined &&
    ((await lastAssignment(tx, flightId))?.id ?? null) !== expected
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Aircraft assignment changed. Review the current flight.",
    });
}

// MySQL stores native JSON numbers in binary form and renders them on read.
// Preserve the exact bytes used to sign a document, independently of how a
// serializer chooses to display a floating-point CG or index value.
function documentJson(
  stored: Record<string, unknown>
): Record<string, unknown> {
  if (!("signedJson" in stored)) return stored;
  try {
    if (typeof stored.signedJson === "string") {
      const value: unknown = JSON.parse(stored.signedJson);
      if (value && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
    }
  } catch {
    /* Reject malformed stored evidence. */
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Invalid stored load-sheet document",
  });
}

export async function loadSheetReview(flightId: number, actor: Actor) {
  const db = await database();
  return db.transaction(async tx => {
    const flight = await lockFlight(tx, flightId, actor);
    const sheet = await latestSheet(tx, flightId);
    const evaluation = z
      .object({ calculation: z.object({ violations: z.array(z.string()) }) })
      .safeParse(sheet ? documentJson(sheet.result) : null);
    return {
      flightId,
      flightNumber: flight.flightNumber,
      registrationId: flight.aircraftRegistrationId,
      edition: sheet?.edition ?? 0,
      status: sheet?.status ?? null,
      assignment: await lastAssignment(tx, flightId),
      evaluatedBy: sheet?.signedBy ?? null,
      violations: evaluation.success
        ? evaluation.data.calculation.violations
        : [],
      dispatchAcceptanceRequired: true as const,
    };
  });
}

async function supersede(tx: Tx, flightId: number) {
  await tx
    .update(loadSheetDocuments)
    .set({ status: "superseded" })
    .where(
      and(
        eq(loadSheetDocuments.flightId, flightId),
        ne(loadSheetDocuments.status, "superseded")
      )
    );
}

export async function assignLoadSheetAircraft(
  input: z.infer<typeof assignmentInput>,
  actor: Actor
) {
  const db = await database();
  return db.transaction(async tx => {
    const flight = await lockFlight(tx, input.flightId, actor);
    if (flight.aircraftRegistrationId !== input.expectedRegistrationId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Flight aircraft assignment changed",
      });
    const [registration] = await tx
      .select()
      .from(aircraftRegistrations)
      .where(
        and(
          eq(aircraftRegistrations.id, input.registrationId),
          eq(aircraftRegistrations.airlineId, flight.airlineId)
        )
      )
      .limit(1)
      .for("update");
    if (!registration)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Aircraft registration not found for this airline",
      });
    if (input.registrationId !== flight.aircraftRegistrationId) {
      const latest = await latestSheet(tx, flight.id);
      await checkAssignmentReceipt(
        tx,
        flight.id,
        input.expectedAssignmentEventId
      );
      if (
        input.expectedEdition !== undefined &&
        input.expectedEdition !== (latest?.edition ?? 0)
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Load-sheet edition changed",
        });
      await supersede(tx, flight.id);
      await tx
        .update(loadPlans)
        .set({ status: "draft", withinLimits: false })
        .where(eq(loadPlans.flightId, flight.id));
      await tx
        .update(flights)
        .set({ aircraftRegistrationId: input.registrationId })
        .where(eq(flights.id, flight.id));
      await tx.insert(auditLogs).values({
        eventId: randomUUID(),
        eventType: "LOAD_SHEET_AIRCRAFT_ASSIGNED",
        eventCategory: "flight_management",
        outcome: "success",
        actorType: "admin",
        userId: actor.userId,
        resourceType: "flight",
        resourceId: String(flight.id),
        previousValue: JSON.stringify({
          registrationId: flight.aircraftRegistrationId,
          edition: latest?.edition ?? null,
        }),
        newValue: JSON.stringify({ registrationId: input.registrationId }),
        changeDescription: input.reason,
        metadata: JSON.stringify({ tenantId: actor.tenantId }),
      });
    }
    return { flightId: flight.id, registrationId: input.registrationId };
  });
}

function signingKey() {
  const key = process.env.AIS_LOAD_SHEET_DRAFT_KEY;
  if (!key || key.length < 32)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Load-sheet draft signing key unavailable",
    });
  return key;
}

async function controlledData(
  tx: Tx,
  flight: typeof flights.$inferSelect,
  profileId: number,
  now: Date
) {
  if (!flight.aircraftRegistrationId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Flight has no aircraft assignment",
    });
  const [reg] = await tx
    .select()
    .from(aircraftRegistrations)
    .where(
      and(
        eq(aircraftRegistrations.id, flight.aircraftRegistrationId),
        eq(aircraftRegistrations.airlineId, flight.airlineId)
      )
    )
    .limit(1)
    .for("update");
  if (!reg)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Assigned registration is unavailable",
    });
  const [p] = await tx
    .select()
    .from(aircraftBalanceProfiles)
    .where(
      and(
        eq(aircraftBalanceProfiles.id, profileId),
        eq(aircraftBalanceProfiles.aircraftTypeId, reg.aircraftTypeId),
        eq(aircraftBalanceProfiles.airlineId, flight.airlineId)
      )
    )
    .limit(1)
    .for("update");
  const [type] = await tx
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, reg.aircraftTypeId))
    .limit(1)
    .for("update");
  if (
    !p ||
    !type?.active ||
    ![type.name, type.code].includes(flight.aircraftType ?? "")
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Profile or scheduled type does not match the aircraft",
    });
  const controls = (row: typeof reg | typeof p) => {
    if (
      row.status !== "accepted" ||
      !row.evidenceId ||
      !row.approvedBy ||
      !row.approvedAt ||
      row.approvedAt > now ||
      row.effectiveFrom > now ||
      (row.effectiveTo && row.effectiveTo <= now)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Controlled aircraft data is not currently accepted",
      });
    return {
      status: row.status,
      evidenceId: row.evidenceId,
      approvedAt: row.approvedAt.toISOString(),
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
    };
  };
  return {
    registration: {
      ...controls(reg),
      registration: reg.registration,
      dataVersion: reg.dataVersion,
      dryOperatingWeightKg: Number(reg.dryOperatingWeightKg),
      dryOperatingIndex: Number(reg.dryOperatingIndex),
    },
    profile: {
      ...controls(p),
      version: p.version,
      referenceStationMm: Number(p.referenceStationMm),
      lemacMm: Number(p.lemacMm),
      macLengthMm: Number(p.macLengthMm),
      indexConstant: Number(p.indexConstant),
      indexCoefficient: Number(p.indexCoefficient),
      maxLmcWeightKg: Number(p.maxLmcWeightKg),
      maxLmcIndex: Number(p.maxLmcIndex),
      envelope: p.envelope,
    },
    limits: {
      maxTakeoffWeightKg: type.maxTakeoffWeight,
      maxZeroFuelWeightKg: type.maxZeroFuelWeight,
      maxLandingWeightKg: type.maxLandingWeight,
    },
  };
}

export async function evaluateLoadSheet(
  input: z.infer<typeof sheetInput>,
  actor: Actor
) {
  const db = await database();
  return db.transaction(async tx => {
    const flight = await lockFlight(tx, input.flightId, actor);
    const latest = await latestSheet(tx, flight.id);
    await checkAssignmentReceipt(
      tx,
      flight.id,
      input.expectedAssignmentEventId
    );
    if (
      flight.aircraftRegistrationId !== input.registrationId ||
      input.expectedEdition !== (latest?.edition ?? 0)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Aircraft or load-sheet edition changed",
      });
    const now = new Date();
    const inputs = {
      ...input.load,
      ...(await controlledData(tx, flight, input.profileId, now)),
      calculationAt: now.toISOString(),
    };
    const calculation = calculateOperationalWeightBalance(inputs);
    const edition = input.expectedEdition + 1;
    const draft = createSignedLoadSheetDraft({
      flightId: flight.id,
      edition,
      issuedAt: now.toISOString(),
      issuedBy: actor.userId,
      calculation,
      signingKey: signingKey(),
      source: {
        registrationId: input.registrationId,
        balanceProfileId: input.profileId,
        inputsDigest: loadSheetInputsDigest(inputs),
      },
    });
    await supersede(tx, flight.id);
    await tx.insert(loadSheetDocuments).values({
      flightId: flight.id,
      aircraftRegistrationId: input.registrationId,
      balanceProfileId: input.profileId,
      edition,
      status: calculation.releasable ? "signed_draft" : "draft",
      inputs: { signedJson: JSON.stringify(inputs) },
      result: { signedJson: JSON.stringify(draft.payload) },
      digestSha256: draft.digestSha256,
      signature: draft.signature,
      signedBy: actor.userId,
      signedAt: now,
    });
    return {
      edition,
      withinLimits: calculation.releasable,
      violations: calculation.violations,
      dispatchAcceptanceRequired: true as const,
    };
  });
}

export async function verifyCurrentLoadSheet(
  input: z.infer<typeof reviewInput>,
  actor: Actor
) {
  const db = await database();
  return db.transaction(async tx => {
    const flight = await lockFlight(tx, input.flightId, actor);
    const sheet = await latestSheet(tx, flight.id);
    if (
      !sheet ||
      sheet.edition !== input.edition ||
      sheet.aircraftRegistrationId !== flight.aircraftRegistrationId ||
      sheet.status !== "signed_draft" ||
      !sheet.signature
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The requested load sheet requires reevaluation",
      });
    const prior = documentJson(sheet.inputs);
    const payload = documentJson(sheet.result) as ReturnType<
      typeof createSignedLoadSheetDraft
    >["payload"];
    if (
      !verifySignedLoadSheetDraft(
        {
          payload,
          digestSha256: sheet.digestSha256,
          signature: sheet.signature,
        },
        signingKey()
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Load-sheet digest or signature mismatch",
      });
    if (
      !payload.source ||
      payload.source.inputsDigest !== loadSheetInputsDigest(prior)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Load-sheet source input digest mismatch",
      });
    if (
      payload.source.registrationId !== sheet.aircraftRegistrationId ||
      payload.source.balanceProfileId !== sheet.balanceProfileId ||
      payload.flightId !== flight.id ||
      payload.edition !== sheet.edition ||
      !payload.calculation.releasable
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Load-sheet signed flight, registration or edition mismatch",
      });
    const current = await controlledData(
      tx,
      flight,
      sheet.balanceProfileId,
      new Date()
    );
    if (
      !isDeepStrictEqual(current.registration, prior.registration) ||
      !isDeepStrictEqual(current.profile, prior.profile) ||
      !isDeepStrictEqual(current.limits, prior.limits) ||
      !isDeepStrictEqual(
        calculateOperationalWeightBalance({
          ...prior,
          ...current,
          calculationAt: new Date().toISOString(),
        }),
        payload.calculation
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Controlled aircraft data changed; reevaluate the load sheet",
      });
    return {
      edition: sheet.edition,
      registrationId: sheet.aircraftRegistrationId,
      digestSha256: sheet.digestSha256,
      dispatchAcceptanceRequired: true as const,
    };
  });
}
