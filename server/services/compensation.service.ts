import {
  gacaArrivalAward,
  GACA_PASSENGER_RIGHTS,
} from "../../shared/gaca-arrival-delay";
import { resolveClaimFlight } from "./booking-flight-membership.service";
import {
  evaluateForReview,
  haversineBetweenCodes,
  JURISDICTION_BY_REGULATION,
  type RegulationType,
  type ReviewerFacts,
  type StoredClaimType,
} from "./passenger-rights.service";
import {
  awardableEntitlement,
  type TicketValue,
} from "../../shared/passenger-rights";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  passengers,
  compensationClaims,
} from "../../drizzle/schema";
import { eq, sql, type SQL } from "drizzle-orm";

// ============================================================================
// API types for the migrated compensation tables
// ============================================================================

export interface CompensationClaim {
  id: number;
  bookingId: number;
  flightId: number;
  passengerId: number | null;
  regulationType: RegulationType;
  claimType: StoredClaimType;
  flightDistance: number | null;
  delayMinutes: number | null;
  calculatedAmount: number | null; // SAR cents; NULL until supported by approved evidence
  approvedAmount: number | null;
  currency: string;
  status:
    | "pending"
    | "under_review"
    | "approved"
    | "denied"
    | "paid"
    | "appealed";
  reason: string | null;
  denialReason: string | null;
  filedAt: Date;
  resolvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompensationRule {
  id: number;
  regulationType: "eu261" | "dot" | "local";
  claimType: "delay" | "cancellation" | "denied_boarding" | "downgrade";
  minDelay: number | null;
  maxDelay: number | null;
  distanceMin: number | null;
  distanceMax: number | null;
  compensationAmount: number; // in the rule's currency (EUR cents for EU261, USD cents for DOT)
  currency: string;
  conditions: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: Date;
}

export interface CompensationStats {
  totalClaims: number;
  pendingClaims: number;
  approvedClaims: number;
  deniedClaims: number;
  paidClaims: number;
  appealedClaims: number;
  totalCalculated: number;
  unassessedClaims: number;
  totalApproved: number;
  totalPaid: number;
  avgProcessingDays: number;
}

// ============================================================================
// Persisted claims and rules; calculations require recorded review evidence.
// ============================================================================

// We use raw SQL to interact with `compensation_claims` and `compensation_rules`
// tables. The service assumes these tables exist (created via migration).

const CLAIMS_TABLE = "compensation_claims";
const RULES_TABLE = "compensation_rules";

// ============================================================================
// Flight Distance Calculation (Haversine)
// ============================================================================

/**
 * Great-circle distance between two airports from the shared coordinate table.
 * Falls back to a labelled estimate when coordinates are unknown; the review
 * path records the source so an estimate is never mistaken for evidence.
 */
export async function calculateFlightDistance(
  originId: number,
  destinationId: number
): Promise<number> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [origin] = await db
    .select({ id: airports.id, code: airports.code, country: airports.country })
    .from(airports)
    .where(eq(airports.id, originId))
    .limit(1);

  const [destination] = await db
    .select({ id: airports.id, code: airports.code, country: airports.country })
    .from(airports)
    .where(eq(airports.id, destinationId))
    .limit(1);

  if (!origin || !destination) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Airport not found for distance calculation",
    });
  }

  const km = haversineBetweenCodes(origin.code, destination.code);
  if (km !== null) return km;
  // Fallback: a default estimate based on whether domestic or international
  return origin.country === destination.country ? 800 : 3000;
}

// ============================================================================
// Claim CRUD Operations
// ============================================================================

/**
 * Create a new compensation claim
 */
export async function createClaim(input: {
  bookingId: number;
  flightId?: number;
  passengerId?: number;
  regulationType: RegulationType;
  claimType: StoredClaimType;
  reason?: string;
  userId: number;
}): Promise<CompensationClaim> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const flightId = await resolveClaimFlight(
    input.bookingId,
    input.userId,
    input.flightId
  );
  const travellers = await db
    .select({ id: passengers.id })
    .from(passengers)
    .where(eq(passengers.bookingId, input.bookingId));
  if (
    input.passengerId !== undefined &&
    !travellers.some(p => p.id === input.passengerId)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger is not part of this booking",
    });
  if (input.passengerId === undefined && travellers.length > 1)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose the passenger for this claim",
    });
  const [inserted] = await db.insert(compensationClaims).values({
    bookingId: input.bookingId,
    flightId,
    passengerId: input.passengerId ?? travellers[0]?.id ?? null,
    regulationType: input.regulationType,
    claimType: input.claimType,
    status: "under_review",
    calculatedAmount: null,
    reason: input.reason ?? null,
  });
  const [claim] = await db
    .select()
    .from(compensationClaims)
    .where(eq(compensationClaims.id, inserted.insertId));
  return claim;
}

export interface RightsEvidence {
  ruleCode: string;
  scopeAndExceptionReview: string;
  factsReference: string;
  facts: ReviewerFacts;
  ticketValue?: TicketValue;
  distanceKm?: number;
  distanceReference?: string;
  fxRecordId?: number;
}

/**
 * Process (approve/deny) a compensation claim (admin)
 */
export async function processClaim(input: {
  claimId: number;
  decision: "approved" | "denied" | "partial";
  approvedAmount?: number;
  denialReason?: string;
  evidence?: {
    policyReference: string;
    fxReference: string;
    distanceReference: string;
    distanceKm: number;
  };
  gacaArrivalEvidence?: {
    scopeAndExceptionReview: string;
    arrivalReference: string;
    scheduledArrivalUtc: string;
    actualArrivalUtc: string;
    fxReference: string;
    sarPerXdrMillionths: number;
  };
  /** Engine-backed basis: one rule of the filed jurisdiction, with recorded facts. */
  rightsEvidence?: RightsEvidence;
  actorId: number;
}): Promise<CompensationClaim> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return await db.transaction(async tx => {
    const [claim] = await tx
      .select()
      .from(compensationClaims)
      .where(eq(compensationClaims.id, input.claimId))
      .for("update");
    if (!claim) throw new TRPCError({ code: "NOT_FOUND" });
    if (!["pending", "under_review", "appealed"].includes(claim.status))
      throw new TRPCError({
        code: "CONFLICT",
        message: "Claim already resolved",
      });
    const approval = input.decision !== "denied";
    const gaca = input.gacaArrivalEvidence;
    const rights = input.rightsEvidence;
    let award;
    let rightsReview:
      | {
          evaluation: Awaited<
            ReturnType<typeof evaluateForReview>
          >["evaluation"];
          settlementMinorUnits: number;
          delayMinutes: number | undefined;
          distanceKm: number | undefined;
          ruleSource: string;
        }
      | undefined;
    if (rights) {
      if (
        gaca ||
        input.evidence ||
        input.approvedAmount !== undefined ||
        input.decision !== "approved"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Select a single basis for a full engine-assessed award",
        });
      if (
        !rights.ruleCode.startsWith(
          `${JURISDICTION_BY_REGULATION[claim.regulationType]}.`
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Rule does not belong to the claim's filed jurisdiction",
        });
      if (
        [rights.scopeAndExceptionReview, rights.factsReference].some(
          v => !v?.trim()
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scope review and facts references are required",
        });
      const now = new Date();
      const review = await evaluateForReview(tx, {
        flightId: claim.flightId,
        bookingId: claim.bookingId,
        claimType: claim.claimType,
        regulationType: claim.regulationType,
        settlementCurrency: claim.currency,
        facts: rights.facts,
        factsReference: rights.factsReference,
        ticketValue: rights.ticketValue,
        distanceKm: rights.distanceKm,
        distanceReference: rights.distanceReference,
        fxRecordId: rights.fxRecordId,
        now,
      });
      const outcome = awardableEntitlement(review.evaluation, rights.ruleCode);
      if (!outcome.ok)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Engine evaluation does not support an award: ${outcome.reason}`,
        });
      const settlement = outcome.entitlement.settlement;
      if (!settlement || settlement.currency !== claim.currency)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Settlement currency differs from the claim currency",
        });
      rightsReview = {
        evaluation: review.evaluation,
        settlementMinorUnits: settlement.minorUnits,
        delayMinutes: review.context.facts.arrivalDelayMinutes?.value,
        distanceKm: review.context.itinerary.distanceKm?.value,
        ruleSource: review.ruleSource,
      };
    }
    if (gaca) {
      if (
        claim.regulationType !== "local" ||
        claim.claimType !== "delay" ||
        claim.currency !== "SAR" ||
        input.decision !== "approved" ||
        input.evidence ||
        input.approvedAmount !== undefined
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Select a single basis for a full local delay award",
        });
      }
      if (new Date(gaca.actualArrivalUtc).getTime() > Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Actual arrival cannot be in the future",
        });
      }
      // The reviewer types the booked arrival; the claim already names the
      // flight. An award that contradicts the system's own schedule is not
      // auditable, so the typed value must match the flight record.
      const [flight] = await tx
        .select({ arrivalTime: flights.arrivalTime })
        .from(flights)
        .where(eq(flights.id, claim.flightId))
        .limit(1);
      if (
        flight &&
        Math.abs(
          Date.parse(gaca.scheduledArrivalUtc) - flight.arrivalTime.getTime()
        ) > 60_000
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Booked arrival does not match the flight record (${flight.arrivalTime.toISOString()})`,
        });
      }
      try {
        award = gacaArrivalAward(
          gaca.scheduledArrivalUtc,
          gaca.actualArrivalUtc,
          gaca.sarPerXdrMillionths
        );
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid arrival or conversion evidence",
        });
      }
      if (!award.halalas) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No positive article 10(6) delay award",
        });
      }
    }
    if (
      approval &&
      !award &&
      !rightsReview &&
      (!input.evidence ||
        !Number.isSafeInteger(input.approvedAmount) ||
        (input.approvedAmount ?? 0) <= 0)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Approval requires an amount and recorded policy, distance and currency evidence",
      });
    if (!approval && !input.denialReason?.trim())
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Denial requires a reason",
      });
    if (
      input.evidence &&
      (!Number.isSafeInteger(input.evidence.distanceKm) ||
        input.evidence.distanceKm <= 0 ||
        [
          input.evidence.policyReference,
          input.evidence.fxReference,
          input.evidence.distanceReference,
        ].some(v => !v?.trim()))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid compensation evidence",
      });
    await tx
      .update(compensationClaims)
      .set({
        status: approval ? "approved" : "denied",
        approvedAmount: approval
          ? (award?.halalas ??
            rightsReview?.settlementMinorUnits ??
            input.approvedAmount)
          : null,
        ...(award && {
          calculatedAmount: award.halalas,
          delayMinutes: Math.floor(award.minutes),
        }),
        ...(rightsReview && {
          calculatedAmount: rightsReview.settlementMinorUnits,
          ...(rightsReview.delayMinutes !== undefined && {
            delayMinutes: Math.floor(rightsReview.delayMinutes),
          }),
        }),
        denialReason: approval ? null : input.denialReason,
        flightDistance:
          input.evidence?.distanceKm ??
          rightsReview?.distanceKm ??
          claim.flightDistance,
        reviewEvidence: {
          ...input.evidence,
          ...(gaca &&
            award && {
              article: "GACA 10(6)",
              source: GACA_PASSENGER_RIGHTS,
              ...gaca,
              tariffXdr: award.sdr,
            }),
          ...(rights &&
            rightsReview && {
              basis: "passenger-rights-engine",
              ruleCode: rights.ruleCode,
              ruleSource: rightsReview.ruleSource,
              scopeAndExceptionReview: rights.scopeAndExceptionReview,
              factsReference: rights.factsReference,
              fxRecordId: rights.fxRecordId ?? null,
              evaluation: JSON.parse(JSON.stringify(rightsReview.evaluation)),
            }),
          actorId: input.actorId,
          reviewedAt: new Date().toISOString(),
        },
        resolvedAt: new Date(),
      })
      .where(eq(compensationClaims.id, claim.id));
    const [updated] = await tx
      .select()
      .from(compensationClaims)
      .where(eq(compensationClaims.id, claim.id));
    return updated;
  });
}

/** Reviewer trace stored with the decision (admin). */
export async function getClaimEvaluation(claimId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [claim] = await db
    .select({
      id: compensationClaims.id,
      status: compensationClaims.status,
      reviewEvidence: compensationClaims.reviewEvidence,
    })
    .from(compensationClaims)
    .where(eq(compensationClaims.id, claimId))
    .limit(1);
  if (!claim) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    claimId: claim.id,
    status: claim.status,
    reviewEvidence:
      claim.reviewEvidence == null
        ? null
        : (JSON.parse(JSON.stringify(claim.reviewEvidence)) as Record<
            string,
            unknown
          >),
  };
}

/**
 * Get all claims for a booking
 */
export async function getClaimsByBooking(
  bookingId: number,
  userId?: number
): Promise<CompensationClaim[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // If userId is provided, check booking ownership
  if (userId) {
    const [booking] = await db
      .select({ id: bookings.id, userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    }

    if (booking.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }
  }

  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE bookingId = ${bookingId}
        ORDER BY createdAt DESC`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (claimRows[0] ?? []).map(mapRowToClaim);
}

/**
 * Get all claims for a flight (admin)
 */
export async function getClaimsByFlight(
  flightId: number
): Promise<CompensationClaim[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE flightId = ${flightId}
        ORDER BY createdAt DESC`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (claimRows[0] ?? []).map(mapRowToClaim);
}

/**
 * Get a single claim by ID
 */
export async function getClaimById(
  claimId: number,
  userId?: number
): Promise<CompensationClaim> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE id = ${claimId}
        LIMIT 1`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  const claim = claimRows[0]?.[0];

  if (!claim) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compensation claim not found",
    });
  }

  // If userId provided, verify ownership through booking
  if (userId) {
    const [booking] = await db
      .select({ userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.id, claim.bookingId as number))
      .limit(1);

    if (!booking || booking.userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }
  }

  return mapRowToClaim(claim as Record<string, unknown>);
}

/**
 * Calculate total compensation liability for a disrupted flight
 */
export async function calculateTotalLiability(flightId: number): Promise<{
  flightId: number;
  flightNumber: string;
  totalClaims: number;
  totalCalculated: number;
  unassessedClaims: number;
  totalApproved: number;
  totalPaid: number;
  statusBreakdown: Record<string, number>;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get flight info
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  const rows = await db.execute(
    sql`SELECT
          COUNT(*) as totalClaims,
          COALESCE(SUM(calculatedAmount), 0) as totalCalculated,
        SUM(CASE WHEN calculatedAmount IS NULL THEN 1 ELSE 0 END) as unassessedClaims,
          COALESCE(SUM(CASE WHEN status IN ('approved', 'paid') THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalApproved,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalPaid
        FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE flightId = ${flightId}`
  );
  const aggregateRows = rows as unknown as Array<
    Array<{
      totalClaims: number | bigint;
      totalCalculated: number | bigint;
      unassessedClaims: number | bigint;
      totalApproved: number | bigint;
      totalPaid: number | bigint;
    }>
  >;
  const agg = aggregateRows[0]?.[0];

  // Status breakdown
  const statusRows = await db.execute(
    sql`SELECT status, COUNT(*) as cnt
        FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE flightId = ${flightId}
        GROUP BY status`
  );
  const statusData = statusRows as unknown as Array<
    Array<{ status: string; cnt: number | bigint }>
  >;
  const statusBreakdown: Record<string, number> = {};
  for (const row of statusData[0] ?? []) {
    statusBreakdown[row.status] = Number(row.cnt);
  }

  return {
    flightId,
    flightNumber: flight.flightNumber,
    totalClaims: Number(agg?.totalClaims ?? 0),
    totalCalculated: Number(agg?.totalCalculated ?? 0),
    unassessedClaims: Number(agg?.unassessedClaims ?? 0),
    totalApproved: Number(agg?.totalApproved ?? 0),
    totalPaid: Number(agg?.totalPaid ?? 0),
    statusBreakdown,
  };
}

/**
 * Auto-assess eligibility for compensation based on booking and disruption info
 */
export async function autoAssessEligibility(
  bookingId: number,
  _disruptionType: StoredClaimType,
  userId: number,
  requestedFlightId?: number
) {
  const flightId = await resolveClaimFlight(
    bookingId,
    userId,
    requestedFlightId
  );
  return {
    eligible: null,
    regulationType: null,
    estimatedAmount: null,
    currency: "SAR",
    reason:
      "Approved policy, route-distance and currency-conversion evidence are required for an assessment",
    flightDistance: null,
    delayMinutes: null,
    flightId,
    assessmentStatus: "needs_review" as const,
  };
}

/**
 * Get all claims with filters and pagination (admin)
 */
export async function getAllClaims(input: {
  status?: string;
  regulationType?: string;
  page: number;
  limit: number;
}): Promise<{
  claims: CompensationClaim[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const offset = (input.page - 1) * input.limit;

  // Build WHERE conditions using parameterized queries
  const conditions: SQL[] = [];
  if (input.status) {
    conditions.push(sql`status = ${input.status}`);
  }
  if (input.regulationType) {
    conditions.push(sql`regulationType = ${input.regulationType}`);
  }

  const whereClause =
    conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

  // Get total count
  const countRows = await db.execute(
    sql`SELECT COUNT(*) as total FROM ${sql.raw(CLAIMS_TABLE)} ${whereClause}`
  );
  const countData = countRows as unknown as Array<
    Array<{ total: number | bigint }>
  >;
  const total = Number(countData[0]?.[0]?.total ?? 0);

  // Get paginated claims
  const dataRows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)} ${whereClause} ORDER BY createdAt DESC LIMIT ${input.limit} OFFSET ${offset}`
  );
  const claimData = dataRows as unknown as Array<
    Array<Record<string, unknown>>
  >;
  const claims = (claimData[0] ?? []).map(mapRowToClaim);

  return {
    claims,
    total,
    page: input.page,
    totalPages: Math.ceil(total / input.limit),
  };
}

/**
 * Get claims filed by a specific user
 */
export async function getClaimsByUser(
  userId: number
): Promise<CompensationClaim[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get user's booking IDs
  const userBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.userId, userId));

  if (userBookings.length === 0) return [];

  const bookingIds = userBookings.map(b => b.id);

  // Fetch claims for those bookings using parameterized IN clause
  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)} WHERE bookingId IN (${sql.join(
      bookingIds.map(id => sql`${id}`),
      sql`, `
    )}) ORDER BY createdAt DESC`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (claimRows[0] ?? []).map(mapRowToClaim);
}

/**
 * Get aggregate compensation statistics (admin)
 */
export async function getCompensationStats(dateRange?: {
  from: Date;
  to: Date;
}): Promise<CompensationStats> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const dateFilter = dateRange
    ? sql`WHERE createdAt >= ${dateRange.from} AND createdAt <= ${dateRange.to}`
    : sql``;

  const rows = await db.execute(
    sql`SELECT
        COUNT(*) as totalClaims,
        SUM(CASE WHEN status IN ('pending','under_review') THEN 1 ELSE 0 END) as pendingClaims,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedClaims,
        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as deniedClaims,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paidClaims,
        SUM(CASE WHEN status = 'appealed' THEN 1 ELSE 0 END) as appealedClaims,
        COALESCE(SUM(calculatedAmount), 0) as totalCalculated,
        SUM(CASE WHEN calculatedAmount IS NULL THEN 1 ELSE 0 END) as unassessedClaims,
        COALESCE(SUM(CASE WHEN status IN ('approved', 'paid') THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalApproved,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalPaid,
        COALESCE(AVG(CASE WHEN resolvedAt IS NOT NULL THEN DATEDIFF(resolvedAt, filedAt) END), 0) as avgProcessingDays
      FROM ${sql.raw(CLAIMS_TABLE)} ${dateFilter}`
  );

  const statsRows = rows as unknown as Array<
    Array<Record<string, number | bigint | null>>
  >;
  const s = statsRows[0]?.[0];

  return {
    totalClaims: Number(s?.totalClaims ?? 0),
    pendingClaims: Number(s?.pendingClaims ?? 0),
    approvedClaims: Number(s?.approvedClaims ?? 0),
    deniedClaims: Number(s?.deniedClaims ?? 0),
    paidClaims: Number(s?.paidClaims ?? 0),
    appealedClaims: Number(s?.appealedClaims ?? 0),
    totalCalculated: Number(s?.totalCalculated ?? 0),
    unassessedClaims: Number(s?.unassessedClaims ?? 0),
    totalApproved: Number(s?.totalApproved ?? 0),
    totalPaid: Number(s?.totalPaid ?? 0),
    avgProcessingDays: Number(s?.avgProcessingDays ?? 0),
  };
}

/**
 * Get compensation rules (admin)
 */
export async function getCompensationRules(): Promise<CompensationRule[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const rows = await db.execute(
    sql.raw(`SELECT * FROM ${RULES_TABLE} ORDER BY regulationType, distanceMin`)
  );
  const ruleRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (ruleRows[0] ?? []).map(mapRowToRule);
}

/**
 * Update a compensation rule (admin)
 */
export async function updateCompensationRule(input: {
  id: number;
  compensationAmount?: number;
  minDelay?: number;
  maxDelay?: number;
  distanceMin?: number;
  distanceMax?: number;
  isActive?: boolean;
  conditions?: Record<string, unknown>;
}): Promise<CompensationRule> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const setClauses: SQL[] = [];
  if (input.compensationAmount !== undefined) {
    setClauses.push(sql`compensationAmount = ${input.compensationAmount}`);
  }
  if (input.minDelay !== undefined) {
    setClauses.push(sql`minDelay = ${input.minDelay}`);
  }
  if (input.maxDelay !== undefined) {
    setClauses.push(sql`maxDelay = ${input.maxDelay}`);
  }
  if (input.distanceMin !== undefined) {
    setClauses.push(sql`distanceMin = ${input.distanceMin}`);
  }
  if (input.distanceMax !== undefined) {
    setClauses.push(sql`distanceMax = ${input.distanceMax}`);
  }
  if (input.isActive !== undefined) {
    setClauses.push(sql`isActive = ${input.isActive ? 1 : 0}`);
  }
  if (input.conditions !== undefined) {
    setClauses.push(sql`\`conditions\` = ${JSON.stringify(input.conditions)}`);
  }

  if (setClauses.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No fields to update",
    });
  }

  await db.execute(
    sql`UPDATE ${sql.raw(RULES_TABLE)} SET ${sql.join(setClauses, sql`, `)} WHERE id = ${input.id}`
  );

  // Re-fetch
  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(RULES_TABLE)} WHERE id = ${input.id} LIMIT 1`
  );
  const ruleRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  const updated = ruleRows[0]?.[0];

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compensation rule not found",
    });
  }

  return mapRowToRule(updated);
}

// ============================================================================
// Helper: Map raw database row to typed objects
// ============================================================================

function mapRowToClaim(row: Record<string, unknown>): CompensationClaim {
  return {
    id: Number(row.id),
    bookingId: Number(row.bookingId),
    flightId: Number(row.flightId),
    passengerId: row.passengerId ? Number(row.passengerId) : null,
    regulationType: row.regulationType as CompensationClaim["regulationType"],
    claimType: row.claimType as CompensationClaim["claimType"],
    flightDistance: row.flightDistance ? Number(row.flightDistance) : null,
    delayMinutes: row.delayMinutes ? Number(row.delayMinutes) : null,
    calculatedAmount:
      row.calculatedAmount == null ? null : Number(row.calculatedAmount),
    approvedAmount: row.approvedAmount ? Number(row.approvedAmount) : null,
    currency: (row.currency as string) ?? "SAR",
    status: row.status as CompensationClaim["status"],
    reason: (row.reason as string) ?? null,
    denialReason: (row.denialReason as string) ?? null,
    filedAt: row.filedAt ? new Date(row.filedAt as string) : new Date(),
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt as string) : null,
    paidAt: row.paidAt ? new Date(row.paidAt as string) : null,
    createdAt: row.createdAt ? new Date(row.createdAt as string) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string) : new Date(),
  };
}

function mapRowToRule(row: Record<string, unknown>): CompensationRule {
  let conditions: Record<string, unknown> | null = null;
  if (row.conditions) {
    try {
      conditions =
        typeof row.conditions === "string"
          ? JSON.parse(row.conditions)
          : (row.conditions as Record<string, unknown>);
    } catch {
      conditions = null;
    }
  }

  return {
    id: Number(row.id),
    regulationType: row.regulationType as CompensationRule["regulationType"],
    claimType: row.claimType as CompensationRule["claimType"],
    minDelay: row.minDelay ? Number(row.minDelay) : null,
    maxDelay: row.maxDelay ? Number(row.maxDelay) : null,
    distanceMin: row.distanceMin ? Number(row.distanceMin) : null,
    distanceMax: row.distanceMax ? Number(row.distanceMax) : null,
    compensationAmount: Number(row.compensationAmount ?? 0),
    currency: (row.currency as string) ?? "EUR",
    conditions,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt ? new Date(row.createdAt as string) : new Date(),
  };
}
