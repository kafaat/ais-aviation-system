// Loads the rule catalogue, confirmations and dated FX records, builds the
// claim context from booking and flight records, and runs the pure engine.
// Nothing here awards: the compensation service keeps reviewer approval.
import { desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  airlines,
  airports,
  bookings,
  exchangeRates,
  flights,
  passengers,
  passengerRightsRules,
  passengerRightsRuleSets,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { resolveClaimFlight } from "./booking-flight-membership.service";
import {
  CLAIM_TYPES,
  evaluateClaim,
  PASSENGER_RIGHTS_RULE_SETS,
  type ClaimContext,
  type ClaimFacts,
  type ClaimType,
  type Evaluation,
  type FxRecord,
  type ItineraryContext,
  type Jurisdiction,
  type Rule,
  type RuleConfirmation,
  type RuleSet,
  type TicketValue,
} from "../../shared/passenger-rights";

import type { StructuredValue } from "../contracts/primitives";

type Db = NonNullable<ReturnType<typeof getDb>>;
type Reader = Pick<Db, "select">;

/** JSON-shaped copy (drops undefined) so response contracts can allowlist it. */
export function asStructured<T>(value: T): Record<string, StructuredValue> {
  return JSON.parse(JSON.stringify(value ?? {})) as Record<
    string,
    StructuredValue
  >;
}

/** Evaluation with facts in contract shape. */
export function serializeEvaluation(evaluation: Evaluation) {
  return {
    ...evaluation,
    inputs: {
      ...evaluation.inputs,
      facts: asStructured(evaluation.inputs.facts),
    },
  };
}

export {
  CLAIM_TYPE_BY_STORED,
  JURISDICTION_BY_REGULATION,
  type RegulationType,
  type StoredClaimType,
} from "../../shared/passenger-rights/stored";
import {
  CLAIM_TYPE_BY_STORED,
  JURISDICTION_BY_REGULATION,
  type RegulationType,
  type StoredClaimType,
} from "../../shared/passenger-rights/stored";

// ---------------------------------------------------------------------------
// Rule catalogue: database rows when seeded, built-in definitions otherwise.
// ---------------------------------------------------------------------------

type StoredDefinition = Pick<
  Rule,
  | "thresholds"
  | "amount"
  | "reduction"
  | "care"
  | "timeLimits"
  | "exclusions"
  | "exclusionChecks"
  | "sources"
  | "note"
>;

function definitionOf(rule: Rule): StoredDefinition {
  return {
    thresholds: rule.thresholds,
    amount: rule.amount,
    reduction: rule.reduction,
    care: rule.care,
    timeLimits: rule.timeLimits,
    exclusions: rule.exclusions,
    exclusionChecks: rule.exclusionChecks,
    sources: rule.sources,
    note: rule.note,
  };
}

export interface RuleCatalog {
  source: "database" | "built-in";
  ruleSets: RuleSet[];
  confirmations: RuleConfirmation[];
}

export async function loadRuleCatalog(reader: Reader): Promise<RuleCatalog> {
  const setRows = await reader.select().from(passengerRightsRuleSets);
  if (!setRows.length)
    return {
      source: "built-in",
      ruleSets: PASSENGER_RIGHTS_RULE_SETS,
      confirmations: [],
    };
  const ruleRows = await reader.select().from(passengerRightsRules);
  const confirmations: RuleConfirmation[] = [];
  const ruleSets: RuleSet[] = setRows.map(set => ({
    jurisdiction: set.jurisdiction as Jurisdiction,
    version: set.version,
    effectiveFrom: set.effectiveFrom?.toISOString() ?? null,
    effectiveTo: set.effectiveTo?.toISOString() ?? null,
    sourceUrl: set.sourceUrl,
    sourceKind: set.sourceKind,
    confirmationStatus: set.confirmationStatus,
    governingLanguage: set.governingLanguage,
    notes: set.notes ?? "",
    rules: ruleRows
      .filter(rule => rule.ruleSetId === set.id && rule.isActive)
      .map(rule => {
        if (rule.confirmedAt)
          confirmations.push({
            ruleCode: rule.ruleCode,
            confirmedAt: rule.confirmedAt.toISOString(),
            reference: rule.confirmationReference ?? "",
            decision: "confirmed",
          });
        if (rule.rejectedAt)
          confirmations.push({
            ruleCode: rule.ruleCode,
            confirmedAt: rule.rejectedAt.toISOString(),
            reference: rule.confirmationReference ?? "",
            decision: "rejected",
          });
        const definition = rule.definition as StoredDefinition;
        return {
          code: rule.ruleCode,
          jurisdiction: rule.jurisdiction as Jurisdiction,
          claimTypes: (rule.claimTypes as string[]).filter(
            (t): t is ClaimType =>
              (CLAIM_TYPES as readonly string[]).includes(t)
          ),
          title: rule.title,
          article: rule.article ?? undefined,
          confirmationStatus: rule.confirmationStatus,
          disputeGroup: rule.disputeGroup ?? undefined,
          candidate: rule.candidate ?? undefined,
          ...definition,
        } satisfies Rule;
      }),
  }));
  return { source: "database", ruleSets, confirmations };
}

/** Idempotent upsert of the built-in seed. Confirmations already recorded are kept. */
export async function syncRuleCatalog(actorId: number) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  let inserted = 0;
  let updated = 0;
  await db.transaction(async tx => {
    for (const set of PASSENGER_RIGHTS_RULE_SETS) {
      const [existing] = await tx
        .select({ id: passengerRightsRuleSets.id })
        .from(passengerRightsRuleSets)
        .where(eq(passengerRightsRuleSets.jurisdiction, set.jurisdiction));
      const setValues = {
        version: set.version,
        effectiveFrom: set.effectiveFrom ? new Date(set.effectiveFrom) : null,
        effectiveTo: set.effectiveTo ? new Date(set.effectiveTo) : null,
        sourceUrl: set.sourceUrl,
        sourceKind: set.sourceKind,
        confirmationStatus: set.confirmationStatus,
        governingLanguage: set.governingLanguage,
        notes: set.notes,
      };
      let setId = existing?.id;
      if (setId === undefined) {
        const [row] = await tx
          .insert(passengerRightsRuleSets)
          .values({ jurisdiction: set.jurisdiction, ...setValues });
        setId = row.insertId;
      } else {
        await tx
          .update(passengerRightsRuleSets)
          .set(setValues)
          .where(eq(passengerRightsRuleSets.id, setId));
      }
      for (const rule of set.rules) {
        const [current] = await tx
          .select({ id: passengerRightsRules.id })
          .from(passengerRightsRules)
          .where(eq(passengerRightsRules.ruleCode, rule.code));
        const values = {
          ruleSetId: setId,
          jurisdiction: rule.jurisdiction,
          claimTypes: rule.claimTypes,
          title: rule.title,
          article: rule.article ?? null,
          definition: definitionOf(rule),
          confirmationStatus: rule.confirmationStatus,
          disputeGroup: rule.disputeGroup ?? null,
          candidate: rule.candidate ?? null,
        };
        if (!current) {
          await tx
            .insert(passengerRightsRules)
            .values({ ruleCode: rule.code, ...values });
          inserted += 1;
        } else {
          await tx
            .update(passengerRightsRules)
            .set(values)
            .where(eq(passengerRightsRules.id, current.id));
          updated += 1;
        }
      }
    }
  });
  return { inserted, updated, actorId, syncedAt: new Date().toISOString() };
}

export async function listRuleCatalog() {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const catalog = await loadRuleCatalog(db);
  const confirmationByCode = new Map(
    catalog.confirmations.map(c => [c.ruleCode, c])
  );
  return {
    source: catalog.source,
    ruleSets: catalog.ruleSets.map(set => ({
      jurisdiction: set.jurisdiction,
      version: set.version,
      effectiveFrom: set.effectiveFrom,
      effectiveTo: set.effectiveTo,
      sourceUrl: set.sourceUrl,
      sourceKind: set.sourceKind,
      confirmationStatus: set.confirmationStatus,
      governingLanguage: set.governingLanguage,
      notes: set.notes,
      rules: set.rules.map(rule => ({
        code: rule.code,
        claimTypes: rule.claimTypes,
        title: rule.title,
        article: rule.article ?? null,
        amount: asStructured(rule.amount),
        thresholds: rule.thresholds ? asStructured(rule.thresholds) : null,
        timeLimits: rule.timeLimits ? asStructured(rule.timeLimits) : null,
        exclusions: rule.exclusions ?? [],
        sources: rule.sources,
        confirmationStatus: rule.confirmationStatus,
        disputeGroup: rule.disputeGroup ?? null,
        candidate: rule.candidate ?? null,
        note: rule.note ?? null,
        confirmation: confirmationByCode.get(rule.code) ?? null,
        requiresConfirmation:
          rule.confirmationStatus === "secondary" ||
          rule.confirmationStatus === "disputed",
      })),
    })),
  };
}

/** Operator confirmation (or rejection) of a secondary or disputed value. */
export async function confirmRule(input: {
  ruleCode: string;
  decision: "confirmed" | "rejected";
  reference: string;
  actorId: number;
}) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [rule] = await db
    .select()
    .from(passengerRightsRules)
    .where(eq(passengerRightsRules.ruleCode, input.ruleCode));
  if (!rule)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Rule is not in the catalogue; sync the seed first",
    });
  if (rule.confirmationStatus === "official")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Official values do not take operator confirmation",
    });
  if (rule.confirmationStatus === "not_yet_applicable")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Rule set is not yet applicable",
    });
  const now = new Date();
  await db
    .update(passengerRightsRules)
    .set(
      input.decision === "confirmed"
        ? {
            confirmedAt: now,
            confirmedBy: input.actorId,
            confirmationReference: input.reference,
            rejectedAt: null,
            rejectedBy: null,
          }
        : {
            rejectedAt: now,
            rejectedBy: input.actorId,
            confirmationReference: input.reference,
            confirmedAt: null,
            confirmedBy: null,
          }
    )
    .where(eq(passengerRightsRules.id, rule.id));
  return {
    ruleCode: input.ruleCode,
    decision: input.decision,
    reference: input.reference,
    at: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Claim context from records
// ---------------------------------------------------------------------------

export interface FlightRecordContext {
  flightId: number;
  flightNumber: string;
  scheduledDepartureUtc: string;
  scheduledArrivalUtc: string;
  itinerary: ItineraryContext;
}

export async function loadFlightContext(
  reader: Reader,
  flightId: number,
  distanceKm?: { value: number; source: string }
): Promise<FlightRecordContext> {
  const [flight] = await reader
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!flight) throw new TRPCError({ code: "NOT_FOUND", message: "Flight" });
  const ports = await reader
    .select()
    .from(airports)
    .where(inArray(airports.id, [flight.originId, flight.destinationId]));
  const origin = ports.find(p => p.id === flight.originId);
  const destination = ports.find(p => p.id === flight.destinationId);
  if (!origin || !destination)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Airport record missing for jurisdiction determination",
    });
  const [airline] = await reader
    .select()
    .from(airlines)
    .where(eq(airlines.id, flight.airlineId))
    .limit(1);
  if (!airline?.country)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Operating carrier country is required for jurisdiction determination",
    });
  const distance =
    distanceKm ??
    (() => {
      const km = haversineBetweenCodes(origin.code, destination.code);
      return km === null
        ? undefined
        : { value: km, source: "haversine:airport-coordinate-table" };
    })();
  return {
    flightId: flight.id,
    flightNumber: flight.flightNumber,
    scheduledDepartureUtc: flight.departureTime.toISOString(),
    scheduledArrivalUtc: flight.arrivalTime.toISOString(),
    itinerary: {
      operatingCarrier: { code: airline.code, country: airline.country },
      departure: { airport: origin.code, country: origin.country },
      arrival: { airport: destination.code, country: destination.country },
      scheduledDepartureUtc: flight.departureTime.toISOString(),
      scheduledArrivalUtc: flight.arrivalTime.toISOString(),
      distanceKm: distance,
    },
  };
}

/** Per-passenger share of the booking total; fare components are not yet available. */
export async function bookingTicketValue(
  reader: Reader,
  bookingId: number
): Promise<TicketValue | null> {
  const [booking] = await reader
    .select({ totalAmount: bookings.totalAmount })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return null;
  const travellers = await reader
    .select({ id: passengers.id })
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));
  const count = Math.max(1, travellers.length);
  return {
    minorUnits: Math.floor(booking.totalAmount / count),
    currency: "SAR",
    basis: "booking_total_per_passenger",
    reference: `booking:${bookingId}:total/${count}`,
  };
}

/** Dated FX quotes into the settlement currency; a specific record when the reviewer names one. */
export async function loadFxRecords(
  reader: Reader,
  settlementCurrency: string,
  fxRecordId?: number
): Promise<FxRecord[]> {
  const rows = await reader
    .select()
    .from(exchangeRates)
    .where(
      fxRecordId === undefined
        ? eq(exchangeRates.toCurrency, settlementCurrency)
        : eq(exchangeRates.id, fxRecordId)
    )
    .orderBy(desc(exchangeRates.validFrom))
    .limit(200);
  return rows.map(row => ({
    id: row.id,
    fromCurrency: row.fromCurrency,
    toCurrency: row.toCurrency,
    rate: row.rate,
    validFrom: row.validFrom.toISOString(),
    source: row.source ?? "exchange_rates",
  }));
}

// ---------------------------------------------------------------------------
// Passenger preview (non-binding) and reviewer evaluation
// ---------------------------------------------------------------------------

export interface PreviewFacts {
  arrivalDelayMinutes?: number;
  departureDelayMinutes?: number;
  baggageDelayDays?: number;
  tarmacMinutes?: number;
  involuntaryDeniedBoarding?: boolean;
}

export async function previewEntitlements(input: {
  bookingId: number;
  flightId?: number;
  claimType: StoredClaimType;
  regulationType?: RegulationType;
  facts: PreviewFacts;
  userId: number;
}) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const flightId = await resolveClaimFlight(
    input.bookingId,
    input.userId,
    input.flightId
  );
  const [record, catalog, ticketValue, fxRecords] = await Promise.all([
    loadFlightContext(db, flightId),
    loadRuleCatalog(db),
    bookingTicketValue(db, input.bookingId),
    loadFxRecords(db, "SAR"),
  ]);
  const ref = { reference: "passenger-entered; unverified" };
  const f = input.facts;
  const facts: ClaimFacts = {
    arrivalDelayMinutes:
      f.arrivalDelayMinutes === undefined
        ? undefined
        : { value: f.arrivalDelayMinutes, ...ref },
    departureDelayMinutes:
      f.departureDelayMinutes === undefined
        ? undefined
        : { value: f.departureDelayMinutes, ...ref },
    baggage:
      f.baggageDelayDays === undefined
        ? undefined
        : { delayDays: f.baggageDelayDays, ...ref },
    tarmacMinutes:
      f.tarmacMinutes === undefined
        ? undefined
        : { value: f.tarmacMinutes, ...ref },
    deniedBoarding:
      input.claimType === "denied_boarding"
        ? { involuntary: f.involuntaryDeniedBoarding ?? true, ...ref }
        : undefined,
    cancellation: input.claimType === "cancellation" ? ref : undefined,
    downgrade: input.claimType === "downgrade" ? ref : undefined,
  };
  const evaluation = evaluateClaim(
    {
      claimType: CLAIM_TYPE_BY_STORED[input.claimType],
      itinerary: record.itinerary,
      facts,
      ticketValue: ticketValue ?? undefined,
      settlementCurrency: "SAR",
      fxRecords,
      evaluatedAt: new Date().toISOString(),
      confirmations: catalog.confirmations,
      jurisdictions: input.regulationType
        ? [JURISDICTION_BY_REGULATION[input.regulationType]]
        : undefined,
    },
    catalog.ruleSets
  );
  return {
    nonBinding: true as const,
    disclaimer:
      "Indicative only. Entitlement and amount are decided on review of evidence; disputed or secondary-source values are shown but not awardable until confirmed.",
    flightId,
    flightNumber: record.flightNumber,
    ruleSource: catalog.source,
    evaluation: serializeEvaluation(redactPreview(evaluation)),
  };
}

/** The passenger sees determinations and amounts, not FX record ids or reviewer facts. */
function redactPreview(evaluation: Evaluation) {
  return {
    ...evaluation,
    inputs: {
      ...evaluation.inputs,
      fxRecordIds: [],
    },
    entitlements: evaluation.entitlements.map(e => ({
      ...e,
      settlement: e.settlement && {
        ...e.settlement,
        fxRecordId: null,
        fxSource: null,
      },
    })),
  };
}

export interface ReviewerFacts {
  actualArrivalUtc?: string;
  departureDelayMinutes?: number;
  cancellation?: { noticeDays?: number; reroutedArrivalDelayMinutes?: number };
  deniedBoarding?: {
    involuntary: boolean;
    alternativeArrivalDelayMinutes?: number;
    alternativeDepartureWithinMinutes?: number;
  };
  downgrade?: boolean;
  baggage?: {
    delayDays?: number;
    receiptsMinorUnits?: number;
    receiptsCurrency?: string;
  };
  tarmacMinutes?: number;
  careExpenses?: { receiptsMinorUnits: number; receiptsCurrency: string };
  refundTrigger?: { triggeredAt: string; tenderClass: "card" | "other" };
  extraordinaryCircumstances?: boolean;
  passengerCaused?: boolean;
}

export interface ReviewEvaluationInput {
  flightId: number;
  bookingId: number;
  claimType: StoredClaimType;
  regulationType: RegulationType;
  settlementCurrency: string;
  facts: ReviewerFacts;
  factsReference: string;
  ticketValue?: TicketValue;
  distanceKm?: number;
  distanceReference?: string;
  fxRecordId?: number;
  now: Date;
}

/**
 * Builds the reviewer context. Arrival delay is measured against the flight
 * record, never a typed schedule, so the award cannot contradict the system.
 */
export async function evaluateForReview(
  reader: Reader,
  input: ReviewEvaluationInput
): Promise<{
  evaluation: Evaluation;
  context: ClaimContext;
  ruleSource: string;
}> {
  const distance =
    input.distanceKm !== undefined
      ? {
          value: input.distanceKm,
          source: input.distanceReference ?? "reviewer",
        }
      : undefined;
  const [record, catalog, fxRecords] = await Promise.all([
    loadFlightContext(reader, input.flightId, distance),
    loadRuleCatalog(reader),
    loadFxRecords(reader, input.settlementCurrency, input.fxRecordId),
  ]);
  if (input.fxRecordId !== undefined && !fxRecords.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Named FX record does not exist",
    });
  const f = input.facts;
  const ref = { reference: input.factsReference };
  let arrivalDelay: ClaimFacts["arrivalDelayMinutes"];
  if (f.actualArrivalUtc !== undefined) {
    const actual = Date.parse(f.actualArrivalUtc);
    if (!Number.isFinite(actual) || actual > input.now.getTime())
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Actual arrival must be a past timestamp",
      });
    const minutes = (actual - Date.parse(record.scheduledArrivalUtc)) / 60_000;
    arrivalDelay = {
      value: Math.max(0, minutes),
      reference: `${input.factsReference}; scheduled from flight record ${record.scheduledArrivalUtc}`,
    };
  }
  const ticketValue =
    input.ticketValue ??
    (await bookingTicketValue(reader, input.bookingId)) ??
    undefined;
  const facts: ClaimFacts = {
    arrivalDelayMinutes: arrivalDelay,
    departureDelayMinutes:
      f.departureDelayMinutes === undefined
        ? undefined
        : { value: f.departureDelayMinutes, ...ref },
    cancellation: f.cancellation ? { ...f.cancellation, ...ref } : undefined,
    deniedBoarding: f.deniedBoarding
      ? { ...f.deniedBoarding, ...ref }
      : undefined,
    downgrade: f.downgrade ? ref : undefined,
    baggage: f.baggage ? { ...f.baggage, ...ref } : undefined,
    tarmacMinutes:
      f.tarmacMinutes === undefined
        ? undefined
        : { value: f.tarmacMinutes, ...ref },
    careExpenses: f.careExpenses ? { ...f.careExpenses, ...ref } : undefined,
    refundTrigger: f.refundTrigger ? { ...f.refundTrigger, ...ref } : undefined,
    extraordinaryCircumstances: f.extraordinaryCircumstances,
    passengerCaused: f.passengerCaused,
  };
  const context: ClaimContext = {
    claimType: CLAIM_TYPE_BY_STORED[input.claimType],
    itinerary: record.itinerary,
    facts,
    ticketValue,
    settlementCurrency: input.settlementCurrency,
    fxRecords,
    evaluatedAt: input.now.toISOString(),
    confirmations: catalog.confirmations,
    jurisdictions: [JURISDICTION_BY_REGULATION[input.regulationType]],
  };
  return {
    evaluation: evaluateClaim(context, catalog.ruleSets),
    context,
    ruleSource: catalog.source,
  };
}

// ---------------------------------------------------------------------------
// Distance: well-known airport coordinates (same table the legacy path used)
// ---------------------------------------------------------------------------

const AIRPORT_COORDS: Record<string, { lat: number; lng: number }> = {
  JED: { lat: 21.6796, lng: 39.1565 },
  RUH: { lat: 24.9576, lng: 46.6988 },
  DMM: { lat: 26.4712, lng: 49.7979 },
  MED: { lat: 24.5534, lng: 39.705 },
  AHB: { lat: 18.2404, lng: 42.6567 },
  CAI: { lat: 30.1219, lng: 31.4056 },
  DXB: { lat: 25.2532, lng: 55.3657 },
  LHR: { lat: 51.47, lng: -0.4543 },
  CDG: { lat: 49.0097, lng: 2.5479 },
  JFK: { lat: 40.6413, lng: -73.7781 },
  IST: { lat: 41.2753, lng: 28.7519 },
  KUL: { lat: 2.7456, lng: 101.7099 },
  BOM: { lat: 19.0896, lng: 72.8656 },
  SIN: { lat: 1.3644, lng: 103.9915 },
  FRA: { lat: 50.0379, lng: 8.5622 },
  AMS: { lat: 52.3105, lng: 4.7683 },
};

export function haversineBetweenCodes(a: string, b: string): number | null {
  const from = AIRPORT_COORDS[a];
  const to = AIRPORT_COORDS[b];
  if (!from || !to) return null;
  return haversineDistance(from.lat, from.lng, to.lat, to.lng);
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRadians = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
