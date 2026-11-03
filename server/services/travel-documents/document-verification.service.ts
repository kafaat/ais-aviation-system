/**
 * Pre-boarding document verification: evaluates a passenger's documents
 * against entry/transit rules at check-in, records every result and any
 * agent override as evidence, and refuses boarding-pass issuance on `no_go`
 * or `manual_review` unless an authorised role has overridden it for the
 * same documents and itinerary.
 *
 * DOCUMENT_VERIFICATION_MODE: "enforce" (default) blocks; "advisory" records
 * the verdict without blocking; "off" skips evaluation. ENTRY_RULES_ALLOW_
 * UNCONFIRMED=true lets unconfirmed/fictional rules yield `go` outside
 * production only, for rehearsals.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  airports,
  documentVerificationResults,
  entryRequirementRules,
  flights,
} from "../../../drizzle/schema";
import { apisData } from "../../../drizzle/operations-schema";
import { getDb } from "../../db";
import type { SettlementTx } from "../booking-settlement.service";
import { documentContext } from "../travel-clearance.service";
import {
  entryRuleInputSchema,
  evaluateEntryRequirements,
  type EntryRule,
  type EntryRulesSource,
  type ItineraryLeg,
  type TravellerDocument,
  type VerificationOutcome,
} from "./entry-rules";

export const OVERRIDE_ROLES = [
  "admin",
  "super_admin",
  "airline_admin",
  "ops",
] as const;

export type VerificationMode = "enforce" | "advisory" | "off";

export function verificationMode(
  env: NodeJS.ProcessEnv = process.env
): VerificationMode {
  const mode = env.DOCUMENT_VERIFICATION_MODE;
  if (mode === "advisory" || mode === "off") return mode;
  return "enforce";
}

function allowUnconfirmedRules(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV !== "production" &&
    env.ENTRY_RULES_ALLOW_UNCONFIRMED === "true"
  );
}

/** Rules source backed by `entry_requirement_rules`. */
export class TableEntryRulesSource implements EntryRulesSource {
  readonly name = "rules_table";
  constructor(
    private readonly tx: SettlementTx,
    private readonly tenantId: number | null
  ) {}
  async rulesFor(query: {
    destinationCountries: string[];
    at: Date;
  }): Promise<EntryRule[]> {
    if (!query.destinationCountries.length) return [];
    const rows = await this.tx
      .select()
      .from(entryRequirementRules)
      .where(
        and(
          inArray(
            entryRequirementRules.destinationCountry,
            query.destinationCountries
          ),
          eq(entryRequirementRules.isActive, true)
        )
      );
    return rows
      .filter(r => r.tenantId === null || r.tenantId === this.tenantId)
      .map(toEntryRule);
  }
}

function toEntryRule(
  row: typeof entryRequirementRules.$inferSelect
): EntryRule {
  return {
    id: row.id,
    isActive: row.isActive,
    destinationCountry: row.destinationCountry,
    nationality: row.nationality as EntryRule["nationality"],
    documentType: row.documentType as EntryRule["documentType"],
    visaRequirement: row.visaRequirement,
    transitWithoutVisaHours: row.transitWithoutVisaHours,
    passportValidityMonths: row.passportValidityMonths,
    blankPagesRequired: row.blankPagesRequired,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    effectiveFrom: new Date(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? new Date(row.effectiveTo) : null,
    confirmationStatus: row.confirmationStatus,
    notes: row.notes,
  };
}

const importSchema = z.array(entryRuleInputSchema).min(1).max(500);

/** Validated import. Fictional fixtures are refused in production; nothing is
 * marked confirmed by the importer, the caller states the status it holds. */
export async function importEntryRules(
  rules: unknown,
  actor: { userId: number; tenantId: number | null },
  env: NodeJS.ProcessEnv = process.env
) {
  const parsed = importSchema.parse(rules);
  if (
    env.NODE_ENV === "production" &&
    parsed.some(r => r.confirmationStatus === "fictional_fixture")
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Fictional fixtures cannot be imported in production",
    });
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const ids: number[] = [];
  for (const rule of parsed) {
    const [inserted] = await db.insert(entryRequirementRules).values({
      tenantId: actor.tenantId,
      destinationCountry: rule.destinationCountry,
      nationality: rule.nationality,
      documentType: rule.documentType,
      visaRequirement: rule.visaRequirement,
      transitWithoutVisaHours: rule.transitWithoutVisaHours,
      passportValidityMonths: rule.passportValidityMonths,
      blankPagesRequired: rule.blankPagesRequired,
      sourceName: rule.sourceName,
      sourceUrl: rule.sourceUrl,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      confirmationStatus: rule.confirmationStatus,
      notes: rule.notes ?? null,
      isActive: true,
      createdBy: actor.userId,
    });
    ids.push(Number(inserted.insertId));
  }
  return { imported: ids.length, ids };
}

export async function listEntryRules(
  tenantId: number | null,
  destinationCountry?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(entryRequirementRules)
    .where(
      destinationCountry
        ? eq(entryRequirementRules.destinationCountry, destinationCountry)
        : undefined
    )
    .orderBy(
      asc(entryRequirementRules.destinationCountry),
      asc(entryRequirementRules.nationality)
    );
  return rows
    .filter(r => r.tenantId === null || r.tenantId === tenantId)
    .map(r => ({
      ...toEntryRule(r),
      effectiveFrom: new Date(r.effectiveFrom).toISOString(),
      effectiveTo: r.effectiveTo ? new Date(r.effectiveTo).toISOString() : null,
      notes: r.notes ?? null,
    }));
}

/** Loads the passenger's documents and the journey starting at `flightId`
 * (later legs follow when they connect) and evaluates them. Nothing is
 * written; callers decide whether to record. */
export async function evaluatePassengerDocuments(
  tx: SettlementTx,
  input: {
    bookingId: number;
    passengerId: number;
    flightId: number;
    now?: Date;
    source?: EntryRulesSource;
  }
) {
  const now = input.now ?? new Date();
  const context = await documentContext(tx, input.bookingId, input.passengerId);
  const start = context.legs.findIndex(l => l.id === input.flightId);
  if (start < 0)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight is not part of this passenger's itinerary",
    });
  const journey = context.legs.slice(start);
  const airportIds = [
    ...new Set(journey.flatMap(f => [f.originId, f.destinationId])),
  ];
  const airportRows = await tx
    .select({
      id: airports.id,
      country: airports.country,
    })
    .from(airports)
    .where(inArray(airports.id, airportIds));
  const countries = new Map(
    airportRows.map(a => [a.id, a.country.trim().toUpperCase()])
  );
  const legs: ItineraryLeg[] = journey.map(f => {
    const originCountry = countries.get(f.originId);
    const destinationCountry = countries.get(f.destinationId);
    if (
      !originCountry ||
      !destinationCountry ||
      !/^[A-Z]{2,3}$/.test(originCountry) ||
      !/^[A-Z]{2,3}$/.test(destinationCountry)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Airport country codes are required for document verification",
      });
    return {
      originCountry,
      destinationCountry,
      departureTime: new Date(f.departureTime),
      // Legacy rows without an arrival time are treated as arriving at departure.
      arrivalTime: new Date(f.arrivalTime ?? f.departureTime),
    };
  });
  const [apis] = await tx
    .select()
    .from(apisData)
    .where(eq(apisData.passengerId, input.passengerId))
    .limit(1);
  const document = travellerDocument(context.passenger, apis ?? null);
  const stopsCountries = [...new Set(legs.map(l => l.destinationCountry))];
  const source =
    input.source ?? new TableEntryRulesSource(tx, context.booking.tenantId);
  const rules = await source.rulesFor({
    destinationCountries: stopsCountries,
    nationality: document?.nationality ?? null,
    documentType: document?.documentType ?? null,
    at: now,
  });
  const outcome = evaluateEntryRequirements(document, legs, rules, {
    now,
    requireConfirmedSource: !allowUnconfirmedRules(),
  });
  return {
    outcome,
    context,
    document,
    legs,
    source: source.name,
  };
}

function travellerDocument(
  passenger: {
    passportNumber: string | null;
    passportExpiry: Date | null;
    nationality: string | null;
  },
  apis: typeof apisData.$inferSelect | null
): TravellerDocument | null {
  const visasHeld =
    apis?.documentType === "visa" ? [{ country: apis.issuingCountry }] : [];
  if (apis && apis.documentType !== "visa")
    return {
      documentType: apis.documentType,
      documentNumber: apis.documentNumber,
      nationality: apis.nationality.toUpperCase(),
      issuingCountry: apis.issuingCountry.toUpperCase(),
      expiryDate: new Date(apis.expiryDate),
      visasHeld,
    };
  if (passenger.passportNumber || passenger.nationality)
    return {
      documentType: "passport",
      documentNumber: passenger.passportNumber,
      nationality: passenger.nationality?.toUpperCase() ?? null,
      issuingCountry: null,
      expiryDate: passenger.passportExpiry
        ? new Date(passenger.passportExpiry)
        : null,
      visasHeld,
    };
  return null;
}

export async function recordVerification(
  tx: SettlementTx,
  evaluation: Awaited<ReturnType<typeof evaluatePassengerDocuments>>,
  input: {
    flightId: number;
    trigger: "check_in" | "preview";
    evaluatedBy: number | null;
    now?: Date;
  }
) {
  const [inserted] = await tx.insert(documentVerificationResults).values({
    tenantId: evaluation.context.booking.tenantId,
    bookingId: evaluation.context.booking.id,
    passengerId: evaluation.context.passenger.id,
    flightId: input.flightId,
    verdict: evaluation.outcome.verdict,
    reasons: evaluation.outcome.reasons,
    rulesApplied: evaluation.outcome.rulesApplied,
    rulesSource: evaluation.source,
    documentDigest: evaluation.context.documentDigest,
    itineraryDigest: evaluation.context.itineraryDigest,
    trigger: input.trigger,
    evaluatedBy: input.evaluatedBy,
    evaluatedAt: input.now ?? new Date(),
  });
  return Number(inserted.insertId);
}

/** The newest override that still matches the passenger's current documents
 * and itinerary; a changed passport or routing invalidates it. */
export async function activeOverride(
  tx: SettlementTx,
  input: {
    passengerId: number;
    flightId: number;
    documentDigest: string;
    itineraryDigest: string;
  }
) {
  const rows = await tx
    .select()
    .from(documentVerificationResults)
    .where(
      and(
        eq(documentVerificationResults.passengerId, input.passengerId),
        eq(documentVerificationResults.flightId, input.flightId)
      )
    )
    .orderBy(desc(documentVerificationResults.id))
    .limit(50);
  return (
    rows.find(
      r =>
        r.overrideVerdict === "go" &&
        r.documentDigest === input.documentDigest &&
        r.itineraryDigest === input.itineraryDigest
    ) ?? null
  );
}

/**
 * Check-in hook. Evaluates, records, and throws PRECONDITION_FAILED when the
 * verdict is not `go` and no matching override exists. Returns the recorded
 * result id and whether an override was applied.
 */
export async function assertBoardingDocuments(
  tx: SettlementTx,
  input: {
    bookingId: number;
    passengerId: number;
    flightId: number;
    actorId?: number | null;
    now?: Date;
  }
) {
  const mode = verificationMode();
  if (mode === "off")
    return { verdict: "go" as const, resultId: null, overrideId: null };
  const evaluation = await evaluatePassengerDocuments(tx, input);
  const resultId = await recordVerification(tx, evaluation, {
    flightId: input.flightId,
    trigger: "check_in",
    evaluatedBy: input.actorId ?? null,
    now: input.now,
  });
  const { verdict, reasons } = evaluation.outcome;
  if (verdict === "go" || mode === "advisory")
    return { verdict, resultId, overrideId: null };
  const override = await activeOverride(tx, {
    passengerId: input.passengerId,
    flightId: input.flightId,
    documentDigest: evaluation.context.documentDigest,
    itineraryDigest: evaluation.context.itineraryDigest,
  });
  if (override) return { verdict, resultId, overrideId: override.id };
  const blocking = reasons
    .filter(r => r.severity !== "info")
    .map(r => r.message)
    .join("; ");
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      verdict === "no_go"
        ? `Boarding pass refused: travel documents do not meet entry requirements (${blocking}). An authorised agent may override with a recorded reason.`
        : `Boarding pass withheld pending manual document review (${blocking}).`,
  });
}

export async function previewVerification(input: {
  bookingId: number;
  passengerId: number;
  flightId: number;
  evaluatedBy: number | null;
  tenantId: number | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const evaluation = await evaluatePassengerDocuments(tx, input);
    if (
      input.tenantId !== null &&
      evaluation.context.booking.tenantId !== input.tenantId
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Booking outside tenant",
      });
    const resultId = await recordVerification(tx, evaluation, {
      flightId: input.flightId,
      trigger: "preview",
      evaluatedBy: input.evaluatedBy,
    });
    const override = await activeOverride(tx, {
      passengerId: input.passengerId,
      flightId: input.flightId,
      documentDigest: evaluation.context.documentDigest,
      itineraryDigest: evaluation.context.itineraryDigest,
    });
    return serializeResult({
      id: resultId,
      verdict: evaluation.outcome.verdict,
      reasons: evaluation.outcome.reasons,
      rulesApplied: evaluation.outcome.rulesApplied,
      rulesSource: evaluation.source,
      evaluatedAt: new Date(),
      override,
      mode: verificationMode(),
      countriesEvaluated: evaluation.outcome.countriesEvaluated,
    });
  });
}

function serializeResult(input: {
  id: number;
  verdict: VerificationOutcome["verdict"];
  reasons: VerificationOutcome["reasons"];
  rulesApplied: number[];
  rulesSource: string;
  evaluatedAt: Date;
  override: typeof documentVerificationResults.$inferSelect | null;
  mode: VerificationMode;
  countriesEvaluated: string[];
}) {
  return {
    resultId: input.id,
    verdict: input.verdict,
    reasons: input.reasons.map(r => ({
      code: r.code,
      message: r.message,
      severity: r.severity,
      country: r.country ?? null,
      ruleId: r.ruleId ?? null,
    })),
    rulesApplied: input.rulesApplied,
    rulesSource: input.rulesSource,
    countriesEvaluated: input.countriesEvaluated,
    evaluatedAt: input.evaluatedAt.toISOString(),
    mode: input.mode,
    boardingAllowed:
      input.mode !== "enforce" ||
      input.verdict === "go" ||
      input.override !== null,
    override: input.override
      ? {
          resultId: input.override.id,
          overrideBy: input.override.overrideBy,
          overrideRole: input.override.overrideRole,
          overrideReason: input.override.overrideReason,
          overriddenAt: input.override.overriddenAt?.toISOString() ?? null,
        }
      : null,
  };
}

/** Records an authorised override on a `no_go`/`manual_review` result. The
 * override is bound to the documents and itinerary digests of that result. */
export async function overrideVerification(input: {
  resultId: number;
  reason: string;
  actor: { userId: number; role: string; tenantId: number | null };
}) {
  if (!(OVERRIDE_ROLES as readonly string[]).includes(input.actor.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Role is not authorised to override document verification",
    });
  const reason = input.reason.trim();
  if (reason.length < 10)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An override needs a recorded reason of at least 10 characters",
    });
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [result] = await tx
      .select()
      .from(documentVerificationResults)
      .where(eq(documentVerificationResults.id, input.resultId))
      .for("update");
    if (!result)
      throw new TRPCError({ code: "NOT_FOUND", message: "Result not found" });
    if (
      input.actor.tenantId !== null &&
      result.tenantId !== input.actor.tenantId
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Result outside tenant",
      });
    if (result.verdict === "go")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A go verdict needs no override",
      });
    if (result.overrideVerdict)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Result already overridden",
      });
    const [flight] = await tx
      .select({ departureTime: flights.departureTime })
      .from(flights)
      .where(eq(flights.id, result.flightId))
      .limit(1);
    if (!flight || flight.departureTime.getTime() <= Date.now())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Flight has departed; override not recorded",
      });
    const now = new Date();
    await tx
      .update(documentVerificationResults)
      .set({
        overrideVerdict: "go",
        overrideBy: input.actor.userId,
        overrideRole: input.actor.role,
        overrideReason: reason,
        overriddenAt: now,
      })
      .where(eq(documentVerificationResults.id, input.resultId));
    return {
      resultId: result.id,
      passengerId: result.passengerId,
      flightId: result.flightId,
      overrideBy: input.actor.userId,
      overrideRole: input.actor.role,
      overrideReason: reason,
      overriddenAt: now.toISOString(),
    };
  });
}

export async function listVerificationResults(input: {
  flightId?: number;
  bookingId?: number;
  tenantId: number | null;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(documentVerificationResults)
    .where(
      input.flightId
        ? eq(documentVerificationResults.flightId, input.flightId)
        : input.bookingId
          ? eq(documentVerificationResults.bookingId, input.bookingId)
          : undefined
    )
    .orderBy(desc(documentVerificationResults.id))
    .limit(input.limit ?? 200);
  return rows
    .filter(r => input.tenantId === null || r.tenantId === input.tenantId)
    .map(r => ({
      resultId: r.id,
      bookingId: r.bookingId,
      passengerId: r.passengerId,
      flightId: r.flightId,
      verdict: r.verdict,
      reasons: r.reasons.map(reason => ({
        code: reason.code,
        message: reason.message,
        severity: reason.severity,
      })),
      rulesSource: r.rulesSource,
      trigger: r.trigger,
      evaluatedAt: new Date(r.evaluatedAt).toISOString(),
      overrideBy: r.overrideBy ?? null,
      overrideRole: r.overrideRole ?? null,
      overrideReason: r.overrideReason ?? null,
      overriddenAt: r.overriddenAt
        ? new Date(r.overriddenAt).toISOString()
        : null,
    }));
}
