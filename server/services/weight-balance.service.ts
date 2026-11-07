/**
 * Weight & balance load control on AHM 560/565 registry data.
 *
 * Reads the aircraft registry (type balance dataset + registration DOW/DOI),
 * the flight's confirmed passengers and checked baggage, runs the pure engine
 * and persists immutable load sheet editions with signature, LMC and aircraft
 * change audit. Every export stays behind the development gate until an
 * operator records dispatch acceptance in the capability catalog; the
 * persisted record carries `dispatchApproved: false` until then.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireDemoCapability } from "./demo-capability";
import { getDb } from "../db";
import {
  airports,
  baggageItems,
  bookings,
  crewAssignments,
  flights,
  loadSheetAircraftChanges,
  loadSheets,
  passengers,
  users,
  type LoadSheet,
} from "../../drizzle/schema";
import {
  applyLastMinuteChanges,
  computeLoadSheet as runEngine,
  getStandardMassRuleSet,
  lmcChangeSchema,
  lmcWeightDelta,
  loadInputSchema,
  renderLoadSheetText,
  reviewAircraftChange,
  standardMassRuleSets,
  WeightBalanceDataError,
  type AircraftChangeReview,
  type LmcEntry,
  type LoadInput,
  type LoadSheetFigures,
  type StandardMassRuleSet,
} from "./weight-balance-engine";
import {
  resolveAircraft,
  type Actor,
  type ResolvedAircraft,
} from "./aircraft-registry.service";

import {
  ACTIVE_LOAD_SHEET_STATUSES as ACTIVE_STATUSES,
  isDispatchAccepted,
  loadSheetDigest,
  toLoadSheetRecord as toRecord,
  type LoadSheetFlightHeader,
  type LoadSheetRecord,
  type StoredLoadSheet,
} from "./load-sheet-figures.service";

const GATE = "Weight and balance load control";
export type { LoadSheetRecord };

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}
type Db = Awaited<ReturnType<typeof requireDb>>;

async function actorName(db: Db, actor: Actor) {
  if (actor.name) return actor.name;
  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  return user?.name ?? user?.email ?? null;
}

// ============================================================================
// Flight facts
// ============================================================================

async function loadFlightHeader(
  db: Db,
  flightId: number
): Promise<LoadSheetFlightHeader & { tenantId: number | null }> {
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Flight ${flightId} not found`,
    });
  const [origin] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);
  const [destination] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);
  const crewRows = await db
    .select({ role: crewAssignments.role })
    .from(crewAssignments)
    .where(
      and(
        eq(crewAssignments.flightId, flightId),
        inArray(crewAssignments.status, ["assigned", "confirmed", "onboard"])
      )
    );
  const cockpit = crewRows.filter(c =>
    ["captain", "first_officer"].includes(c.role)
  ).length;
  const cabin = crewRows.length - cockpit;
  return {
    flightId,
    flightNumber: flight.flightNumber,
    airlineId: flight.airlineId,
    tenantId: flight.tenantId,
    date: flight.departureTime.toISOString().slice(0, 10),
    departureTime: flight.departureTime.toISOString(),
    origin: origin?.code ?? "???",
    destination: destination?.code ?? "???",
    crew: crewRows.length ? { cockpit, cabin } : null,
  };
}

function seatRow(seat: string | null) {
  const match = seat?.match(/^(\d{1,3})/);
  return match ? Number(match[1]) : null;
}

/**
 * Confirmed passengers by cabin zone and checked bags from the booking system.
 * Gender is inferred from the title because the passenger record has no
 * gender field; the remark makes that visible on the load sheet.
 */
async function loadSystemTraffic(
  db: Db,
  flightId: number,
  aircraft: ResolvedAircraft
) {
  const remarks: string[] = [];
  const bookingRows = await db
    .select({
      id: bookings.id,
      cabinClass: bookings.cabinClass,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.flightId, flightId),
        inArray(bookings.status, ["confirmed", "completed"])
      )
    );
  const bookingIds = bookingRows.map(b => b.id);
  const cabinByBooking = new Map(bookingRows.map(b => [b.id, b.cabinClass]));
  const zones = aircraft.type.payload.cabinZones;
  const byZone = new Map(
    zones.map(z => [
      z.code,
      { zone: z.code, male: 0, female: 0, child: 0, infant: 0 },
    ])
  );
  let unseated = 0;
  let titleInferred = 0;
  if (bookingIds.length) {
    const paxRows = await db
      .select({
        bookingId: passengers.bookingId,
        type: passengers.type,
        title: passengers.title,
        seatNumber: passengers.seatNumber,
      })
      .from(passengers)
      .where(inArray(passengers.bookingId, bookingIds));
    for (const pax of paxRows) {
      const row = seatRow(pax.seatNumber);
      let zone = row
        ? zones.find(z => row >= z.rows.from && row <= z.rows.to)
        : undefined;
      if (!zone) {
        unseated += 1;
        const cabin = cabinByBooking.get(pax.bookingId) ?? "economy";
        zone = zones.find(z => z.cabinClass === cabin) ?? zones[0];
      }
      const bucket = byZone.get(zone.code);
      if (!bucket) continue;
      if (pax.type === "child") bucket.child += 1;
      else if (pax.type === "infant") bucket.infant += 1;
      else {
        titleInferred += 1;
        const title = (pax.title ?? "").toLowerCase();
        if (["mrs", "ms", "miss", "mme", "mlle"].includes(title))
          bucket.female += 1;
        else bucket.male += 1;
      }
    }
  }
  if (unseated)
    remarks.push(
      `${unseated} passenger(s) without a seat assignment placed in the default zone of their cabin`
    );
  if (titleInferred)
    remarks.push(
      `Adult gender inferred from title for ${titleInferred} passenger(s); confirm with the check-in system`
    );
  let baggagePieces = 0;
  let baggageKg = 0;
  if (bookingIds.length) {
    const bags = await db
      .select({ weight: baggageItems.weight, status: baggageItems.status })
      .from(baggageItems)
      .where(inArray(baggageItems.bookingId, bookingIds));
    for (const bag of bags) {
      if (bag.status === "lost") continue;
      baggagePieces += 1;
      baggageKg += Number(bag.weight);
    }
  }
  return {
    passengersByZone: [...byZone.values()].filter(
      z => z.male + z.female + z.child + z.infant > 0
    ),
    baggage: { pieces: baggagePieces, weighedKg: Math.round(baggageKg) },
    remarks,
  };
}

// ============================================================================
// Compute and persist
// ============================================================================

export const computeRequestSchema = z
  .object({
    flightId: z.number().int().positive(),
    registrationId: z.number().int().positive(),
    ruleSetId: z.string().min(1).max(60),
    /** Operator confirmation of the rule set, recorded on the load sheet. */
    ruleSetConfirmationReference: z.string().trim().max(200).optional(),
    passengerSource: z.enum(["system", "manual"]).default("system"),
    passengersByZone: loadInputSchema.shape.passengersByZone.optional(),
    /** Compartment that receives the system's checked bags (pieces and weighed kg). */
    systemBaggageCompartment: z.string().trim().min(1).max(10).optional(),
    deadload: loadInputSchema.shape.deadload.default([]),
    fuel: loadInputSchema.shape.fuel,
    performanceLimits: loadInputSchema.shape.performanceLimits,
  })
  .strict();
export type ComputeRequest = z.infer<typeof computeRequestSchema>;

function engineError(error: unknown): never {
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

function persistEdition(
  db: Db,
  input: {
    flightId: number;
    tenantId: number | null;
    aircraft: ResolvedAircraft;
    stored: StoredLoadSheet;
    lmcList: LmcEntry[];
    basis: LoadSheet["basis"];
    baseEditionId: number | null;
    status: "preliminary" | "final";
    actor: Actor;
    signer: { id: number; name: string | null } | null;
  }
) {
  return db.transaction(async tx => {
    const active = await tx
      .select()
      .from(loadSheets)
      .where(eq(loadSheets.flightId, input.flightId))
      .orderBy(desc(loadSheets.edition))
      .for("update");
    const edition = (active[0]?.edition ?? 0) + 1;
    const now = new Date();
    const toSupersede = active
      .filter(s => (ACTIVE_STATUSES as readonly string[]).includes(s.status))
      .map(s => s.id);
    if (toSupersede.length)
      await tx
        .update(loadSheets)
        .set({ status: "superseded", supersededAt: now })
        .where(inArray(loadSheets.id, toSupersede));
    const [result] = await tx.insert(loadSheets).values({
      tenantId: input.tenantId,
      flightId: input.flightId,
      registrationId: input.aircraft.registrationRow.id,
      balanceDataId: input.aircraft.typeRow.id,
      edition,
      basis: input.basis,
      baseEditionId: input.baseEditionId,
      status: input.status,
      dispatchApproved:
        isDispatchAccepted() && input.stored.approval.operatorApproved,
      figures: input.stored as unknown as Record<string, unknown>,
      lmcList: input.lmcList as unknown as Record<string, unknown>[],
      digest: loadSheetDigest(input.stored, input.lmcList),
      preparedBy: input.actor.id,
      preparedAt: now,
      signedBy: input.signer?.id ?? null,
      signedByName: input.signer?.name ?? null,
      signedAt: input.signer ? now : null,
    });
    const [row] = await tx
      .select()
      .from(loadSheets)
      .where(eq(loadSheets.id, Number(result.insertId)))
      .limit(1);
    if (!row) throw new Error("Load sheet identity unavailable");
    return toRecord(row);
  });
}

/**
 * Compute a new preliminary load sheet edition for a flight on a registration.
 * Supersedes every earlier active edition of the flight.
 */
export async function computeLoadSheet(request: ComputeRequest, actor: Actor) {
  requireDemoCapability(GATE);
  const parsed = computeRequestSchema.parse(request);
  const db = await requireDb();
  const header = await loadFlightHeader(db, parsed.flightId);
  const aircraft = await resolveAircraft(
    parsed.registrationId,
    new Date(header.departureTime)
  );
  if (aircraft.registrationRow.airlineId !== header.airlineId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${aircraft.registration.registration} belongs to another operator than flight ${header.flightNumber}`,
    });
  const ruleSet = getStandardMassRuleSet(parsed.ruleSetId);
  const standardMasses: StandardMassRuleSet =
    parsed.ruleSetConfirmationReference
      ? {
          ...ruleSet,
          confirmation: "operator_confirmed",
          confirmationReference: parsed.ruleSetConfirmationReference,
        }
      : ruleSet;
  const remarks: string[] = [];
  let passengersByZone = parsed.passengersByZone ?? [];
  const deadload = structuredClone(parsed.deadload);
  if (parsed.passengerSource === "system" || parsed.systemBaggageCompartment) {
    const traffic = await loadSystemTraffic(db, parsed.flightId, aircraft);
    if (parsed.passengerSource === "system")
      passengersByZone = traffic.passengersByZone;
    if (parsed.systemBaggageCompartment) {
      const target =
        deadload.find(d => d.compartment === parsed.systemBaggageCompartment) ??
        (deadload.push({
          compartment: parsed.systemBaggageCompartment,
          baggagePieces: 0,
          baggageKg: null,
          cargoKg: 0,
          mailKg: 0,
        }),
        deadload[deadload.length - 1]);
      target.baggagePieces += traffic.baggage.pieces;
      // Weighed system bags are added to any weighed manual figure; when
      // nothing was weighed the engine falls back to pieces × standard mass.
      const weighed = (target.baggageKg ?? 0) + traffic.baggage.weighedKg;
      target.baggageKg = weighed > 0 ? weighed : null;
      if (traffic.baggage.pieces === 0)
        remarks.push("No checked baggage recorded in the booking system");
    }
    remarks.push(...traffic.remarks);
  }
  if (standardMasses.confirmation !== "operator_confirmed")
    remarks.push(
      `Standard masses ${standardMasses.id} are not operator-confirmed`
    );
  if (!aircraft.approval.operatorApproved)
    remarks.push(
      `Aircraft data not operator-approved (registration ${aircraft.approval.registration}, dataset ${aircraft.approval.type})`
    );
  if (aircraft.type.fictional)
    remarks.push("Fictional training aircraft type; never valid for dispatch");
  if (!isDispatchAccepted())
    remarks.push(
      "Load control capability not dispatch-accepted; document is for training/evaluation"
    );
  const load: LoadInput = {
    passengersByZone,
    deadload,
    fuel: parsed.fuel,
    performanceLimits: parsed.performanceLimits,
    standardMasses,
    crew: header.crew ?? undefined,
  };
  let figures: LoadSheetFigures;
  try {
    figures = runEngine(aircraft.type, aircraft.registration, load);
  } catch (error) {
    return engineError(error);
  }
  const { tenantId, ...flight } = header;
  const stored: StoredLoadSheet = {
    flight,
    figures,
    approval: {
      registrationApproval: aircraft.approval.registration,
      typeApproval: aircraft.approval.type,
      operatorApproved: aircraft.approval.operatorApproved,
      ruleSetConfirmation: standardMasses.confirmation,
    },
    remarks,
  };
  return persistEdition(db, {
    flightId: parsed.flightId,
    tenantId,
    aircraft,
    stored,
    lmcList: [],
    basis: "full",
    baseEditionId: null,
    status: "preliminary",
    actor,
    signer: null,
  });
}

// ============================================================================
// Reads
// ============================================================================

export async function getLatestLoadSheet(flightId: number) {
  requireDemoCapability(GATE);
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(loadSheets)
    .where(eq(loadSheets.flightId, flightId))
    .orderBy(desc(loadSheets.edition))
    .limit(1);
  return row ? toRecord(row) : null;
}

export async function listLoadSheetEditions(flightId: number) {
  requireDemoCapability(GATE);
  const db = await requireDb();
  const rows = await db
    .select()
    .from(loadSheets)
    .where(eq(loadSheets.flightId, flightId))
    .orderBy(desc(loadSheets.edition));
  return rows.map(toRecord);
}

export async function getLoadSheetEdition(id: number) {
  requireDemoCapability(GATE);
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(loadSheets)
    .where(eq(loadSheets.id, id))
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Load sheet ${id} not found`,
    });
  return toRecord(row);
}

export function listStandardMassRuleSets() {
  requireDemoCapability(GATE);
  return standardMassRuleSets;
}

export async function renderLoadSheetDocument(id: number) {
  requireDemoCapability(GATE);
  const record = await getLoadSheetEdition(id);
  const db = await requireDb();
  const preparer = await actorName(db, { id: record.preparedBy });
  return {
    id: record.id,
    edition: record.edition,
    status: record.status,
    dispatchApproved: record.dispatchApproved,
    text: renderLoadSheetText(
      {
        flightNumber: record.flight.flightNumber,
        date: record.flight.date,
        origin: record.flight.origin,
        destination: record.flight.destination,
        edition: record.edition,
        status: record.status,
        basis: record.basis,
        preparedBy: preparer ?? String(record.preparedBy),
        preparedAt: record.preparedAt.toISOString(),
        signedBy: record.signedByName,
        signedAt: record.signedAt?.toISOString() ?? null,
        dispatchApproved: record.dispatchApproved,
        crew: record.flight.crew,
      },
      record.figures,
      record.lmcList
    ),
    remarks: record.remarks,
  };
}

// ============================================================================
// Signing
// ============================================================================

/** Freezes a preliminary edition as final with the signer's identity. */
export async function signLoadSheet(id: number, actor: Actor) {
  requireDemoCapability(GATE);
  const db = await requireDb();
  const name = await actorName(db, actor);
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(loadSheets)
      .where(eq(loadSheets.id, id))
      .limit(1)
      .for("update");
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Load sheet not found",
      });
    const record = toRecord(row);
    if (record.status !== "preliminary")
      throw new TRPCError({
        code: "CONFLICT",
        message: `Edition ${record.edition} is ${record.status}; only a preliminary edition can be signed`,
      });
    if (!record.figures.ok)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Edition ${record.edition} has limit breaches and cannot be signed: ${record.figures.breaches.join("; ")}`,
      });
    const now = new Date();
    await tx
      .update(loadSheets)
      .set({
        status: "final",
        signedBy: actor.id,
        signedByName: name,
        signedAt: now,
      })
      .where(eq(loadSheets.id, id));
    const [updated] = await tx
      .select()
      .from(loadSheets)
      .where(eq(loadSheets.id, id))
      .limit(1);
    if (!updated) throw new Error("Load sheet missing after signing");
    return toRecord(updated);
  });
}

// ============================================================================
// Last-minute changes
// ============================================================================

export const lmcRequestSchema = z
  .object({
    flightId: z.number().int().positive(),
    changes: z.array(lmcChangeSchema).min(1).max(20),
  })
  .strict();

/**
 * Applies LMCs to the flight's final load sheet as a new signed LMC edition.
 * Refused when the cumulative LMC exceeds the type limit or the recomputed
 * figures breach a limit; a new full load sheet is then required.
 */
export async function applyLastMinuteChange(
  request: z.infer<typeof lmcRequestSchema>,
  actor: Actor
) {
  requireDemoCapability(GATE);
  const parsed = lmcRequestSchema.parse(request);
  const db = await requireDb();
  const current = await getLatestLoadSheet(parsed.flightId);
  if (!current || current.status !== "final")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "LMC requires a signed final load sheet",
    });
  const aircraft = await resolveAircraft(
    current.registrationId,
    new Date(current.flight.departureTime)
  );
  const name = await actorName(db, actor);
  const now = new Date().toISOString();
  const base =
    current.basis === "lmc" && current.baseEditionId
      ? await getLoadSheetEdition(current.baseEditionId)
      : current;
  const lmcList: LmcEntry[] = [
    ...current.lmcList,
    ...parsed.changes.map((change, i) => ({
      ...change,
      sequence: current.lmcList.length + i + 1,
      appliedKg: lmcWeightDelta(change, base.figures.inputs.standardMasses),
      actorId: actor.id,
      actorName: name,
      appliedAt: now,
    })),
  ];
  let figures: LoadSheetFigures;
  try {
    figures = applyLastMinuteChanges(
      aircraft.type,
      aircraft.registration,
      base.figures,
      lmcList
    );
  } catch (error) {
    return engineError(error);
  }
  if (figures.lmc.requiresNewLoadSheet || !figures.ok)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `LMC rejected: ${figures.breaches.join("; ")}`,
    });
  const flightRow = await loadFlightHeader(db, parsed.flightId);
  return persistEdition(db, {
    flightId: parsed.flightId,
    tenantId: flightRow.tenantId,
    aircraft,
    stored: {
      flight: base.flight,
      figures,
      approval: base.approval,
      remarks: [
        ...base.remarks,
        `LMC edition based on edition ${base.edition}`,
      ],
    },
    lmcList,
    basis: "lmc",
    baseEditionId: base.id,
    status: "final",
    actor,
    signer: { id: actor.id, name },
  });
}

// ============================================================================
// Aircraft change
// ============================================================================

export const aircraftChangeRequestSchema = z
  .object({
    flightId: z.number().int().positive(),
    newRegistrationId: z.number().int().positive(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type AircraftChangeResult = {
  auditId: number;
  invalidatedEditionIds: number[];
  review: AircraftChangeReview;
  requiresNewLoadSheet: true;
};

/**
 * Registration swap after a load sheet exists: every active edition becomes
 * `superseded_by_aircraft_change`, the load is re-evaluated under the new
 * registration's data and the swap is recorded with actor, time and reason.
 */
export async function changeAircraft(
  request: z.infer<typeof aircraftChangeRequestSchema>,
  actor: Actor
): Promise<AircraftChangeResult> {
  requireDemoCapability(GATE);
  const parsed = aircraftChangeRequestSchema.parse(request);
  const db = await requireDb();
  const header = await loadFlightHeader(db, parsed.flightId);
  const editions = await listLoadSheetEditions(parsed.flightId);
  const active = editions.filter(e =>
    (ACTIVE_STATUSES as readonly string[]).includes(e.status)
  );
  const reference = active[0] ?? editions[0];
  if (!reference)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No load sheet exists for this flight; compute one on the new registration instead",
    });
  if (reference.registrationId === parsed.newRegistrationId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The flight is already planned on that registration",
    });
  const departure = new Date(header.departureTime);
  const previous = await resolveAircraft(reference.registrationId, departure);
  const next = await resolveAircraft(parsed.newRegistrationId, departure);
  if (next.registrationRow.airlineId !== header.airlineId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${next.registration.registration} belongs to another operator`,
    });
  const review = reviewAircraftChange(previous, next, reference.figures);
  const name = await actorName(db, actor);
  return db.transaction(async tx => {
    const now = new Date();
    const invalidated = active.map(e => e.id);
    if (invalidated.length)
      await tx
        .update(loadSheets)
        .set({ status: "superseded_by_aircraft_change", supersededAt: now })
        .where(inArray(loadSheets.id, invalidated));
    const auditReview: AircraftChangeAuditReview = {
      from: review.from,
      to: review.to,
      sameTypeAndVariant: review.sameTypeAndVariant,
      dataDifferences: review.dataDifferences,
      checksStillValid: review.checksStillValid,
      checksRequiringReview: review.checksRequiringReview,
      recomputeError: review.recomputeError,
      recomputedOk: review.recomputed?.ok ?? null,
      referenceEditionId: reference.id,
    };
    const [result] = await tx.insert(loadSheetAircraftChanges).values({
      tenantId: header.tenantId,
      flightId: parsed.flightId,
      fromRegistrationId: reference.registrationId,
      toRegistrationId: parsed.newRegistrationId,
      invalidatedEditionIds: invalidated,
      review: auditReview as unknown as Record<string, unknown>,
      reason: parsed.reason,
      changedBy: actor.id,
      changedByName: name,
      changedAt: now,
    });
    return {
      auditId: Number(result.insertId),
      invalidatedEditionIds: invalidated,
      review,
      requiresNewLoadSheet: true as const,
    };
  });
}

/** Persisted summary of an aircraft change review (the `review` JSON column). */
export type AircraftChangeAuditReview = Pick<
  AircraftChangeReview,
  | "from"
  | "to"
  | "sameTypeAndVariant"
  | "dataDifferences"
  | "checksStillValid"
  | "checksRequiringReview"
  | "recomputeError"
> & { recomputedOk: boolean | null; referenceEditionId: number };

export async function listAircraftChanges(flightId: number) {
  requireDemoCapability(GATE);
  const db = await requireDb();
  const rows = await db
    .select()
    .from(loadSheetAircraftChanges)
    .where(eq(loadSheetAircraftChanges.flightId, flightId))
    .orderBy(desc(loadSheetAircraftChanges.changedAt));
  return rows.map(row => ({
    ...row,
    review: row.review as unknown as AircraftChangeAuditReview,
  }));
}
