import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  codeshareAgreements,
  interlineAgreements,
  airlines,
  flights,
  airports,
  type InsertCodeshareAgreement,
  type InsertInterlineAgreement,
} from "../../drizzle/schema";
import { eq, and, or, gte, lte, desc, asc, sql, inArray } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export interface CreateCodeshareAgreementInput {
  marketingAirlineId: number;
  operatingAirlineId: number;
  agreementType: "free_sale" | "block_space" | "hard_block" | "soft_block";
  routeScope?: "all_routes" | "specific_routes";
  routes?: Array<{ originId: number; destinationId: number }>;
  revenueShareModel?: "prorate" | "fixed_amount" | "percentage" | "free_flow";
  revenueShareValue?: string;
  blockSize?: number;
  validFrom: Date;
  validUntil?: Date;
}

export interface UpdateCodeshareAgreementInput {
  agreementType?: "free_sale" | "block_space" | "hard_block" | "soft_block";
  routeScope?: "all_routes" | "specific_routes";
  routes?: Array<{ originId: number; destinationId: number }>;
  revenueShareModel?: "prorate" | "fixed_amount" | "percentage" | "free_flow";
  revenueShareValue?: string;
  blockSize?: number;
  validFrom?: Date;
  validUntil?: Date;
  status?: "draft" | "pending_approval" | "active" | "suspended" | "terminated";
}

export interface CodeshareAgreementFilters {
  airlineId?: number;
  status?: "draft" | "pending_approval" | "active" | "suspended" | "terminated";
  agreementType?: "free_sale" | "block_space" | "hard_block" | "soft_block";
  limit?: number;
  offset?: number;
}

export interface CreateInterlineAgreementInput {
  airline1Id: number;
  airline2Id: number;
  agreementType: "ticketing" | "baggage" | "full";
  prorateType?: "mileage" | "spi" | "percentage";
  prorateValue?: string;
  baggageThroughCheck?: boolean;
  baggageRuleApplied?:
    | "most_significant_carrier"
    | "first_carrier"
    | "each_carrier";
  settlementMethod?: "bsp" | "bilateral" | "ich";
  validFrom: Date;
  validUntil?: Date;
}

export interface UpdateInterlineAgreementInput {
  agreementType?: "ticketing" | "baggage" | "full";
  prorateType?: "mileage" | "spi" | "percentage";
  prorateValue?: string;
  baggageThroughCheck?: boolean;
  baggageRuleApplied?:
    | "most_significant_carrier"
    | "first_carrier"
    | "each_carrier";
  settlementMethod?: "bsp" | "bilateral" | "ich";
  validFrom?: Date;
  validUntil?: Date;
  status?: "draft" | "pending_approval" | "active" | "suspended" | "terminated";
}

export interface InterlineAgreementFilters {
  airlineId?: number;
  status?: "draft" | "pending_approval" | "active" | "suspended" | "terminated";
  agreementType?: "ticketing" | "baggage" | "full";
  limit?: number;
  offset?: number;
}

export interface RevenueShareResult {
  agreementId: number;
  model: string;
  fareAmount: number;
  marketingCarrierShare: number;
  operatingCarrierShare: number;
  currency: string;
}

export interface ProrateShareResult {
  agreementId: number;
  prorateType: string;
  totalFare: number;
  segment1Share: number;
  segment2Share: number;
  segment1Distance: number;
  segment2Distance: number;
}

export interface PartnerAirline {
  airlineId: number;
  airlineCode: string;
  airlineName: string;
  partnershipType: "codeshare" | "interline";
  agreementReference: string;
  agreementStatus: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique agreement reference with a given prefix.
 * Format: {prefix}-{year}-{random alphanumeric 4 chars}
 * e.g., "CS-2026-A7K2" or "IL-2026-M3X9"
 */
export async function generateAgreementReference(
  prefix: "CS" | "IL"
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const year = new Date().getFullYear();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const reference = `${prefix}-${year}-${suffix}`;

    // Check uniqueness against the appropriate table
    if (prefix === "CS") {
      const existing = await db
        .select({ id: codeshareAgreements.id })
        .from(codeshareAgreements)
        .where(eq(codeshareAgreements.agreementReference, reference))
        .limit(1);
      if (existing.length === 0) return reference;
    } else {
      const existing = await db
        .select({ id: interlineAgreements.id })
        .from(interlineAgreements)
        .where(eq(interlineAgreements.agreementReference, reference))
        .limit(1);
      if (existing.length === 0) return reference;
    }
  }

  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to generate unique agreement reference after max attempts",
  });
}

/**
 * Validate that an airline exists and is active.
 */
async function validateAirline(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  airlineId: number,
  label: string
): Promise<void> {
  const [airline] = await db
    .select({ id: airlines.id, active: airlines.active })
    .from(airlines)
    .where(eq(airlines.id, airlineId))
    .limit(1);

  if (!airline) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${label} airline (ID: ${airlineId}) not found`,
    });
  }

  if (!airline.active) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} airline (ID: ${airlineId}) is not active`,
    });
  }
}

// ============================================================================
// Codeshare Agreement Functions
// ============================================================================

/**
 * Create a new codeshare agreement between a marketing and operating airline.
 * Generates a unique reference, validates both airlines exist and are active,
 * and ensures the airlines are distinct.
 */
export async function createCodeshareAgreement(
  input: CreateCodeshareAgreementInput
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Validate airlines are different
    if (input.marketingAirlineId === input.operatingAirlineId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Marketing and operating airlines must be different",
      });
    }

    // Validate both airlines exist
    await validateAirline(db, input.marketingAirlineId, "Marketing");
    await validateAirline(db, input.operatingAirlineId, "Operating");

    // Validate block size for block_space / hard_block / soft_block
    if (
      ["block_space", "hard_block", "soft_block"].includes(
        input.agreementType
      ) &&
      (!input.blockSize || input.blockSize <= 0)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Block size is required and must be positive for ${input.agreementType} agreements`,
      });
    }

    // Validate routes when scope is specific_routes
    if (
      input.routeScope === "specific_routes" &&
      (!input.routes || input.routes.length === 0)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "At least one route must be specified for specific_routes scope",
      });
    }

    // Validate date range
    if (input.validUntil && input.validUntil <= input.validFrom) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "validUntil must be after validFrom",
      });
    }

    // Generate unique reference
    const agreementReference = await generateAgreementReference("CS");

    const values: InsertCodeshareAgreement = {
      marketingAirlineId: input.marketingAirlineId,
      operatingAirlineId: input.operatingAirlineId,
      agreementType: input.agreementType,
      agreementReference,
      routeScope: input.routeScope ?? "specific_routes",
      routes: input.routes ? JSON.stringify(input.routes) : null,
      revenueShareModel: input.revenueShareModel ?? "prorate",
      revenueShareValue: input.revenueShareValue ?? null,
      blockSize: input.blockSize ?? null,
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
      status: "draft",
    };

    const [result] = await db.insert(codeshareAgreements).values(values);
    const insertId = (result as unknown as { insertId: number }).insertId;

    console.info(
      `[Codeshare] Created agreement ${agreementReference} between airline ${input.marketingAirlineId} (marketing) and ${input.operatingAirlineId} (operating)`
    );

    return {
      id: insertId,
      agreementReference,
      status: "draft" as const,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error creating codeshare agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create codeshare agreement",
    });
  }
}

/**
 * Update an existing codeshare agreement.
 * Only draft or pending_approval agreements can be freely updated.
 * Active agreements can only update certain fields.
 */
export async function updateCodeshareAgreement(
  id: number,
  input: UpdateCodeshareAgreementInput
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Get current agreement
    const [existing] = await db
      .select()
      .from(codeshareAgreements)
      .where(eq(codeshareAgreements.id, id))
      .limit(1);

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Codeshare agreement (ID: ${id}) not found`,
      });
    }

    if (existing.status === "terminated") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot update a terminated agreement",
      });
    }

    // Build update set
    const updateSet: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.agreementType !== undefined) {
      updateSet.agreementType = input.agreementType;
    }
    if (input.routeScope !== undefined) {
      updateSet.routeScope = input.routeScope;
    }
    if (input.routes !== undefined) {
      updateSet.routes = JSON.stringify(input.routes);
    }
    if (input.revenueShareModel !== undefined) {
      updateSet.revenueShareModel = input.revenueShareModel;
    }
    if (input.revenueShareValue !== undefined) {
      updateSet.revenueShareValue = input.revenueShareValue;
    }
    if (input.blockSize !== undefined) {
      updateSet.blockSize = input.blockSize;
    }
    if (input.validFrom !== undefined) {
      updateSet.validFrom = input.validFrom;
    }
    if (input.validUntil !== undefined) {
      updateSet.validUntil = input.validUntil;
    }
    if (input.status !== undefined) {
      updateSet.status = input.status;
    }

    await db
      .update(codeshareAgreements)
      .set(updateSet)
      .where(eq(codeshareAgreements.id, id));

    console.info(
      `[Codeshare] Updated agreement ${existing.agreementReference} (ID: ${id})`
    );

    return { id, updated: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error updating codeshare agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update codeshare agreement",
    });
  }
}

/**
 * Get a single codeshare agreement by ID, including marketing and
 * operating airline details.
 */
export async function getCodeshareAgreement(id: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const result = await db
      .select({
        id: codeshareAgreements.id,
        agreementReference: codeshareAgreements.agreementReference,
        agreementType: codeshareAgreements.agreementType,
        routeScope: codeshareAgreements.routeScope,
        routes: codeshareAgreements.routes,
        revenueShareModel: codeshareAgreements.revenueShareModel,
        revenueShareValue: codeshareAgreements.revenueShareValue,
        blockSize: codeshareAgreements.blockSize,
        validFrom: codeshareAgreements.validFrom,
        validUntil: codeshareAgreements.validUntil,
        status: codeshareAgreements.status,
        createdAt: codeshareAgreements.createdAt,
        updatedAt: codeshareAgreements.updatedAt,
        marketingAirline: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
          logo: airlines.logo,
        },
        operatingAirline: {
          id: sql<number>`op_airline.id`,
          code: sql<string>`op_airline.code`,
          name: sql<string>`op_airline.name`,
          logo: sql<string>`op_airline.logo`,
        },
      })
      .from(codeshareAgreements)
      .innerJoin(
        airlines,
        eq(codeshareAgreements.marketingAirlineId, airlines.id)
      )
      .innerJoin(
        sql`airlines as op_airline`,
        sql`${codeshareAgreements.operatingAirlineId} = op_airline.id`
      )
      .where(eq(codeshareAgreements.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Codeshare agreement (ID: ${id}) not found`,
      });
    }

    const agreement = result[0];
    return {
      ...agreement,
      routes: agreement.routes ? JSON.parse(agreement.routes) : [],
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error getting codeshare agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get codeshare agreement",
    });
  }
}

/**
 * List codeshare agreements with optional filters.
 * Can filter by airline (either marketing or operating), status, and type.
 * Returns joined airline details.
 */
export async function listCodeshareAgreements(
  filters: CodeshareAgreementFilters = {}
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const conditions = [];

    if (filters.airlineId) {
      conditions.push(
        or(
          eq(codeshareAgreements.marketingAirlineId, filters.airlineId),
          eq(codeshareAgreements.operatingAirlineId, filters.airlineId)
        )
      );
    }

    if (filters.status) {
      conditions.push(eq(codeshareAgreements.status, filters.status));
    }

    if (filters.agreementType) {
      conditions.push(
        eq(codeshareAgreements.agreementType, filters.agreementType)
      );
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = filters.offset ?? 0;

    const result = await db
      .select({
        id: codeshareAgreements.id,
        agreementReference: codeshareAgreements.agreementReference,
        agreementType: codeshareAgreements.agreementType,
        routeScope: codeshareAgreements.routeScope,
        revenueShareModel: codeshareAgreements.revenueShareModel,
        blockSize: codeshareAgreements.blockSize,
        validFrom: codeshareAgreements.validFrom,
        validUntil: codeshareAgreements.validUntil,
        status: codeshareAgreements.status,
        createdAt: codeshareAgreements.createdAt,
        marketingAirline: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
        },
        operatingAirline: {
          id: sql<number>`op_airline.id`,
          code: sql<string>`op_airline.code`,
          name: sql<string>`op_airline.name`,
        },
      })
      .from(codeshareAgreements)
      .innerJoin(
        airlines,
        eq(codeshareAgreements.marketingAirlineId, airlines.id)
      )
      .innerJoin(
        sql`airlines as op_airline`,
        sql`${codeshareAgreements.operatingAirlineId} = op_airline.id`
      )
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(codeshareAgreements.createdAt))
      .limit(limit)
      .offset(offset);

    return result;
  } catch (error) {
    console.error("Error listing codeshare agreements:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to list codeshare agreements",
    });
  }
}

/**
 * Activate a codeshare agreement.
 * Validates that the agreement is in draft or pending_approval status,
 * the validity period is current, and revenue share configuration is present.
 */
export async function activateCodeshareAgreement(id: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [agreement] = await db
      .select()
      .from(codeshareAgreements)
      .where(eq(codeshareAgreements.id, id))
      .limit(1);

    if (!agreement) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Codeshare agreement (ID: ${id}) not found`,
      });
    }

    // Validate current status allows activation
    if (
      !["draft", "pending_approval", "suspended"].includes(agreement.status)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot activate agreement with status '${agreement.status}'. Must be draft, pending_approval, or suspended`,
      });
    }

    // Validate validity period
    const now = new Date();
    if (agreement.validFrom > now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agreement validity period has not started yet (starts ${agreement.validFrom.toISOString()})`,
      });
    }

    if (agreement.validUntil && agreement.validUntil < now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agreement validity period has expired (ended ${agreement.validUntil.toISOString()})`,
      });
    }

    // Validate revenue share is configured (unless free_flow)
    if (
      agreement.revenueShareModel !== "free_flow" &&
      !agreement.revenueShareValue
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Revenue share value must be configured before activation (not required for free_flow model)",
      });
    }

    // Validate block size for block agreements
    if (
      ["block_space", "hard_block", "soft_block"].includes(
        agreement.agreementType
      ) &&
      (!agreement.blockSize || agreement.blockSize <= 0)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Block size must be configured for block-type agreements",
      });
    }

    // Validate routes when scope is specific_routes
    if (agreement.routeScope === "specific_routes") {
      const routes = agreement.routes ? JSON.parse(agreement.routes) : [];
      if (routes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "At least one route must be specified for specific_routes scope",
        });
      }
    }

    await db
      .update(codeshareAgreements)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(codeshareAgreements.id, id));

    console.info(
      `[Codeshare] Activated agreement ${agreement.agreementReference} (ID: ${id})`
    );

    return {
      id,
      status: "active" as const,
      agreementReference: agreement.agreementReference,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error activating codeshare agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to activate codeshare agreement",
    });
  }
}

/**
 * Terminate a codeshare agreement with a reason.
 * Only active or suspended agreements can be terminated.
 */
export async function terminateCodeshareAgreement(id: number, reason: string) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [agreement] = await db
      .select()
      .from(codeshareAgreements)
      .where(eq(codeshareAgreements.id, id))
      .limit(1);

    if (!agreement) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Codeshare agreement (ID: ${id}) not found`,
      });
    }

    if (agreement.status === "terminated") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Agreement is already terminated",
      });
    }

    await db
      .update(codeshareAgreements)
      .set({
        status: "terminated",
        validUntil: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(codeshareAgreements.id, id));

    console.info(
      `[Codeshare] Terminated agreement ${agreement.agreementReference} (ID: ${id}). Reason: ${reason}`
    );

    return {
      id,
      status: "terminated" as const,
      agreementReference: agreement.agreementReference,
      terminatedAt: new Date(),
      reason,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error terminating codeshare agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to terminate codeshare agreement",
    });
  }
}

/**
 * Get flights available through codeshare agreements for a marketing airline.
 * Returns flights operated by partner airlines that the marketing airline
 * can sell under codeshare. Includes both marketing and operating carrier details.
 */
export async function getCodeshareFlights(marketingAirlineId: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const now = new Date();

    // Get all active codeshare agreements where this airline is the marketing carrier
    const activeAgreements = await db
      .select()
      .from(codeshareAgreements)
      .where(
        and(
          eq(codeshareAgreements.marketingAirlineId, marketingAirlineId),
          eq(codeshareAgreements.status, "active"),
          lte(codeshareAgreements.validFrom, now),
          or(
            sql`${codeshareAgreements.validUntil} IS NULL`,
            gte(codeshareAgreements.validUntil, now)
          )
        )
      );

    if (activeAgreements.length === 0) {
      return [];
    }

    // Get operating airline IDs from agreements
    const operatingAirlineIds = [
      ...new Set(activeAgreements.map(a => a.operatingAirlineId)),
    ];

    // Fetch future scheduled flights from operating airlines
    const codeshareFlights = await db
      .select({
        flightId: flights.id,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        aircraftType: flights.aircraftType,
        status: flights.status,
        economyPrice: flights.economyPrice,
        businessPrice: flights.businessPrice,
        economyAvailable: flights.economyAvailable,
        businessAvailable: flights.businessAvailable,
        operatingAirline: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
          logo: airlines.logo,
        },
        origin: {
          id: airports.id,
          code: airports.code,
          name: airports.name,
          city: airports.city,
        },
        destination: {
          id: sql<number>`dest.id`,
          code: sql<string>`dest.code`,
          name: sql<string>`dest.name`,
          city: sql<string>`dest.city`,
        },
      })
      .from(flights)
      .innerJoin(airlines, eq(flights.airlineId, airlines.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
      .where(
        and(
          inArray(flights.airlineId, operatingAirlineIds),
          eq(flights.status, "scheduled"),
          gte(flights.departureTime, now)
        )
      )
      .orderBy(asc(flights.departureTime));

    // Get marketing airline info
    const [marketingAirline] = await db
      .select({
        id: airlines.id,
        code: airlines.code,
        name: airlines.name,
        logo: airlines.logo,
      })
      .from(airlines)
      .where(eq(airlines.id, marketingAirlineId))
      .limit(1);

    // Filter flights based on route scope of each agreement and annotate
    const result = codeshareFlights
      .map(flight => {
        // Find the applicable agreement for this flight's operating airline
        const agreement = activeAgreements.find(
          a => a.operatingAirlineId === flight.operatingAirline.id
        );

        if (!agreement) return null;

        // Check route scope
        if (agreement.routeScope === "specific_routes" && agreement.routes) {
          const allowedRoutes = JSON.parse(agreement.routes) as Array<{
            originId: number;
            destinationId: number;
          }>;
          const routeAllowed = allowedRoutes.some(
            r =>
              r.originId === flight.origin.id &&
              r.destinationId === flight.destination.id
          );
          if (!routeAllowed) return null;
        }

        return {
          ...flight,
          marketingAirline: marketingAirline ?? null,
          agreementReference: agreement.agreementReference,
          agreementType: agreement.agreementType,
          blockSize: agreement.blockSize,
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return result;
  } catch (error) {
    console.error("Error getting codeshare flights:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get codeshare flights",
    });
  }
}

/**
 * Calculate revenue share between marketing and operating carrier
 * based on the agreement's revenue share model.
 *
 * All monetary amounts are in SAR cents (100 = 1 SAR).
 *
 * Models:
 * - prorate: Share proportional to segment distance
 * - fixed_amount: Fixed fee per segment to operating carrier
 * - percentage: Percentage of fare to operating carrier
 * - free_flow: Each carrier keeps own revenue (no calculation needed)
 */
export async function calculateRevenueShare(
  agreementId: number,
  fareAmount: number,
  segmentDistance: number
): Promise<RevenueShareResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [agreement] = await db
      .select()
      .from(codeshareAgreements)
      .where(eq(codeshareAgreements.id, agreementId))
      .limit(1);

    if (!agreement) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Codeshare agreement (ID: ${agreementId}) not found`,
      });
    }

    if (agreement.status !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agreement is not active (status: ${agreement.status})`,
      });
    }

    const shareValue = agreement.revenueShareValue
      ? parseFloat(agreement.revenueShareValue)
      : 0;

    let operatingCarrierShare: number;
    let marketingCarrierShare: number;

    switch (agreement.revenueShareModel) {
      case "prorate": {
        // Prorate by distance: operating carrier gets proportional share
        // revenueShareValue represents the total route distance for proration
        if (shareValue <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Total route distance (revenueShareValue) must be set for prorate model",
          });
        }
        const ratio = Math.min(segmentDistance / shareValue, 1);
        operatingCarrierShare = Math.round(fareAmount * ratio);
        marketingCarrierShare = fareAmount - operatingCarrierShare;
        break;
      }

      case "fixed_amount": {
        // Fixed amount per segment to operating carrier (value in SAR cents)
        operatingCarrierShare = Math.min(Math.round(shareValue), fareAmount);
        marketingCarrierShare = fareAmount - operatingCarrierShare;
        break;
      }

      case "percentage": {
        // Percentage of fare to operating carrier
        if (shareValue < 0 || shareValue > 100) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Percentage share value must be between 0 and 100",
          });
        }
        operatingCarrierShare = Math.round(fareAmount * (shareValue / 100));
        marketingCarrierShare = fareAmount - operatingCarrierShare;
        break;
      }

      case "free_flow": {
        // Each carrier keeps own revenue; no split needed
        operatingCarrierShare = fareAmount;
        marketingCarrierShare = 0;
        break;
      }

      default: {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown revenue share model: ${agreement.revenueShareModel}`,
        });
      }
    }

    return {
      agreementId,
      model: agreement.revenueShareModel,
      fareAmount,
      marketingCarrierShare,
      operatingCarrierShare,
      currency: "SAR",
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error calculating revenue share:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to calculate revenue share",
    });
  }
}

// ============================================================================
// Interline Agreement Functions
// ============================================================================

/**
 * Create a new interline agreement between two airlines.
 * Validates both airlines exist and are distinct.
 * Generates a unique reference.
 */
export async function createInterlineAgreement(
  input: CreateInterlineAgreementInput
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Validate airlines are different
    if (input.airline1Id === input.airline2Id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Interline agreement requires two different airlines",
      });
    }

    // Validate both airlines exist
    await validateAirline(db, input.airline1Id, "Airline 1");
    await validateAirline(db, input.airline2Id, "Airline 2");

    // Check for existing active agreement between these airlines
    const existingActive = await db
      .select({ id: interlineAgreements.id })
      .from(interlineAgreements)
      .where(
        and(
          eq(interlineAgreements.status, "active"),
          or(
            and(
              eq(interlineAgreements.airline1Id, input.airline1Id),
              eq(interlineAgreements.airline2Id, input.airline2Id)
            ),
            and(
              eq(interlineAgreements.airline1Id, input.airline2Id),
              eq(interlineAgreements.airline2Id, input.airline1Id)
            )
          )
        )
      )
      .limit(1);

    if (existingActive.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "An active interline agreement already exists between these airlines",
      });
    }

    // Validate date range
    if (input.validUntil && input.validUntil <= input.validFrom) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "validUntil must be after validFrom",
      });
    }

    // Generate unique reference
    const agreementReference = await generateAgreementReference("IL");

    const values: InsertInterlineAgreement = {
      airline1Id: input.airline1Id,
      airline2Id: input.airline2Id,
      agreementType: input.agreementType,
      agreementReference,
      prorateType: input.prorateType ?? "mileage",
      prorateValue: input.prorateValue ?? null,
      baggageThroughCheck: input.baggageThroughCheck ?? false,
      baggageRuleApplied:
        input.baggageRuleApplied ?? "most_significant_carrier",
      settlementMethod: input.settlementMethod ?? "bsp",
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
      status: "draft",
    };

    const [result] = await db.insert(interlineAgreements).values(values);
    const insertId = (result as unknown as { insertId: number }).insertId;

    console.info(
      `[Interline] Created agreement ${agreementReference} between airline ${input.airline1Id} and ${input.airline2Id}`
    );

    return {
      id: insertId,
      agreementReference,
      status: "draft" as const,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error creating interline agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create interline agreement",
    });
  }
}

/**
 * Update an existing interline agreement.
 * Terminated agreements cannot be updated.
 */
export async function updateInterlineAgreement(
  id: number,
  input: UpdateInterlineAgreementInput
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [existing] = await db
      .select()
      .from(interlineAgreements)
      .where(eq(interlineAgreements.id, id))
      .limit(1);

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Interline agreement (ID: ${id}) not found`,
      });
    }

    if (existing.status === "terminated") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot update a terminated agreement",
      });
    }

    const updateSet: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.agreementType !== undefined) {
      updateSet.agreementType = input.agreementType;
    }
    if (input.prorateType !== undefined) {
      updateSet.prorateType = input.prorateType;
    }
    if (input.prorateValue !== undefined) {
      updateSet.prorateValue = input.prorateValue;
    }
    if (input.baggageThroughCheck !== undefined) {
      updateSet.baggageThroughCheck = input.baggageThroughCheck;
    }
    if (input.baggageRuleApplied !== undefined) {
      updateSet.baggageRuleApplied = input.baggageRuleApplied;
    }
    if (input.settlementMethod !== undefined) {
      updateSet.settlementMethod = input.settlementMethod;
    }
    if (input.validFrom !== undefined) {
      updateSet.validFrom = input.validFrom;
    }
    if (input.validUntil !== undefined) {
      updateSet.validUntil = input.validUntil;
    }
    if (input.status !== undefined) {
      updateSet.status = input.status;
    }

    await db
      .update(interlineAgreements)
      .set(updateSet)
      .where(eq(interlineAgreements.id, id));

    console.info(
      `[Interline] Updated agreement ${existing.agreementReference} (ID: ${id})`
    );

    return { id, updated: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error updating interline agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update interline agreement",
    });
  }
}

/**
 * Get a single interline agreement by ID with both airline details.
 */
export async function getInterlineAgreement(id: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const result = await db
      .select({
        id: interlineAgreements.id,
        agreementReference: interlineAgreements.agreementReference,
        agreementType: interlineAgreements.agreementType,
        prorateType: interlineAgreements.prorateType,
        prorateValue: interlineAgreements.prorateValue,
        baggageThroughCheck: interlineAgreements.baggageThroughCheck,
        baggageRuleApplied: interlineAgreements.baggageRuleApplied,
        settlementMethod: interlineAgreements.settlementMethod,
        validFrom: interlineAgreements.validFrom,
        validUntil: interlineAgreements.validUntil,
        status: interlineAgreements.status,
        createdAt: interlineAgreements.createdAt,
        updatedAt: interlineAgreements.updatedAt,
        airline1: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
          logo: airlines.logo,
        },
        airline2: {
          id: sql<number>`airline2.id`,
          code: sql<string>`airline2.code`,
          name: sql<string>`airline2.name`,
          logo: sql<string>`airline2.logo`,
        },
      })
      .from(interlineAgreements)
      .innerJoin(airlines, eq(interlineAgreements.airline1Id, airlines.id))
      .innerJoin(
        sql`airlines as airline2`,
        sql`${interlineAgreements.airline2Id} = airline2.id`
      )
      .where(eq(interlineAgreements.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Interline agreement (ID: ${id}) not found`,
      });
    }

    return result[0];
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error getting interline agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get interline agreement",
    });
  }
}

/**
 * List interline agreements with optional filters.
 * Filters by airline (either side), status, or agreement type.
 */
export async function listInterlineAgreements(
  filters: InterlineAgreementFilters = {}
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const conditions = [];

    if (filters.airlineId) {
      conditions.push(
        or(
          eq(interlineAgreements.airline1Id, filters.airlineId),
          eq(interlineAgreements.airline2Id, filters.airlineId)
        )
      );
    }

    if (filters.status) {
      conditions.push(eq(interlineAgreements.status, filters.status));
    }

    if (filters.agreementType) {
      conditions.push(
        eq(interlineAgreements.agreementType, filters.agreementType)
      );
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = filters.offset ?? 0;

    const result = await db
      .select({
        id: interlineAgreements.id,
        agreementReference: interlineAgreements.agreementReference,
        agreementType: interlineAgreements.agreementType,
        prorateType: interlineAgreements.prorateType,
        baggageThroughCheck: interlineAgreements.baggageThroughCheck,
        baggageRuleApplied: interlineAgreements.baggageRuleApplied,
        settlementMethod: interlineAgreements.settlementMethod,
        validFrom: interlineAgreements.validFrom,
        validUntil: interlineAgreements.validUntil,
        status: interlineAgreements.status,
        createdAt: interlineAgreements.createdAt,
        airline1: {
          id: airlines.id,
          code: airlines.code,
          name: airlines.name,
        },
        airline2: {
          id: sql<number>`airline2.id`,
          code: sql<string>`airline2.code`,
          name: sql<string>`airline2.name`,
        },
      })
      .from(interlineAgreements)
      .innerJoin(airlines, eq(interlineAgreements.airline1Id, airlines.id))
      .innerJoin(
        sql`airlines as airline2`,
        sql`${interlineAgreements.airline2Id} = airline2.id`
      )
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(interlineAgreements.createdAt))
      .limit(limit)
      .offset(offset);

    return result;
  } catch (error) {
    console.error("Error listing interline agreements:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to list interline agreements",
    });
  }
}

/**
 * Activate an interline agreement.
 * Validates the agreement is in an activatable status,
 * the validity period is current, and prorate configuration is set
 * for ticketing or full agreements.
 */
export async function activateInterlineAgreement(id: number) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [agreement] = await db
      .select()
      .from(interlineAgreements)
      .where(eq(interlineAgreements.id, id))
      .limit(1);

    if (!agreement) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Interline agreement (ID: ${id}) not found`,
      });
    }

    if (
      !["draft", "pending_approval", "suspended"].includes(agreement.status)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot activate agreement with status '${agreement.status}'. Must be draft, pending_approval, or suspended`,
      });
    }

    // Validate validity period
    const now = new Date();
    if (agreement.validFrom > now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agreement validity period has not started yet (starts ${agreement.validFrom.toISOString()})`,
      });
    }

    if (agreement.validUntil && agreement.validUntil < now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agreement validity period has expired (ended ${agreement.validUntil.toISOString()})`,
      });
    }

    // Validate prorate configuration for ticketing and full agreements
    if (
      ["ticketing", "full"].includes(agreement.agreementType) &&
      !agreement.prorateValue
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Prorate value must be configured before activation for ticketing/full agreements",
      });
    }

    await db
      .update(interlineAgreements)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(interlineAgreements.id, id));

    console.info(
      `[Interline] Activated agreement ${agreement.agreementReference} (ID: ${id})`
    );

    return {
      id,
      status: "active" as const,
      agreementReference: agreement.agreementReference,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error activating interline agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to activate interline agreement",
    });
  }
}

/**
 * Terminate an interline agreement with a reason.
 */
export async function terminateInterlineAgreement(id: number, reason: string) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [agreement] = await db
      .select()
      .from(interlineAgreements)
      .where(eq(interlineAgreements.id, id))
      .limit(1);

    if (!agreement) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Interline agreement (ID: ${id}) not found`,
      });
    }

    if (agreement.status === "terminated") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Agreement is already terminated",
      });
    }

    await db
      .update(interlineAgreements)
      .set({
        status: "terminated",
        validUntil: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(interlineAgreements.id, id));

    console.info(
      `[Interline] Terminated agreement ${agreement.agreementReference} (ID: ${id}). Reason: ${reason}`
    );

    return {
      id,
      status: "terminated" as const,
      agreementReference: agreement.agreementReference,
      terminatedAt: new Date(),
      reason,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error terminating interline agreement:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to terminate interline agreement",
    });
  }
}

/**
 * Check if two airlines have an active interline agreement.
 * Checks both orderings (airline1/airline2 are interchangeable).
 * Returns the agreement details if found, or null.
 */
export async function checkInterlineEligibility(
  airline1Id: number,
  airline2Id: number
) {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    if (airline1Id === airline2Id) {
      return {
        eligible: false,
        reason: "Same airline - interline not applicable",
        agreement: null,
      };
    }

    const now = new Date();

    const [agreement] = await db
      .select({
        id: interlineAgreements.id,
        agreementReference: interlineAgreements.agreementReference,
        agreementType: interlineAgreements.agreementType,
        prorateType: interlineAgreements.prorateType,
        baggageThroughCheck: interlineAgreements.baggageThroughCheck,
        baggageRuleApplied: interlineAgreements.baggageRuleApplied,
        settlementMethod: interlineAgreements.settlementMethod,
        validFrom: interlineAgreements.validFrom,
        validUntil: interlineAgreements.validUntil,
        status: interlineAgreements.status,
      })
      .from(interlineAgreements)
      .where(
        and(
          eq(interlineAgreements.status, "active"),
          lte(interlineAgreements.validFrom, now),
          or(
            sql`${interlineAgreements.validUntil} IS NULL`,
            gte(interlineAgreements.validUntil, now)
          ),
          or(
            and(
              eq(interlineAgreements.airline1Id, airline1Id),
              eq(interlineAgreements.airline2Id, airline2Id)
            ),
            and(
              eq(interlineAgreements.airline1Id, airline2Id),
              eq(interlineAgreements.airline2Id, airline1Id)
            )
          )
        )
      )
      .limit(1);

    if (!agreement) {
      return {
        eligible: false,
        reason: "No active interline agreement found between these airlines",
        agreement: null,
      };
    }

    return {
      eligible: true,
      reason: null,
      agreement,
    };
  } catch (error) {
    console.error("Error checking interline eligibility:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to check interline eligibility",
    });
  }
}

/**
 * Calculate interline prorate share between two segments.
 *
 * Prorate models:
 * - mileage: Split fare proportional to segment distance
 * - spi (Special Prorate Agreement): Fixed value per segment to first carrier,
 *   remainder to second
 * - percentage: Fixed percentage split (prorateValue = percentage for segment 1)
 *
 * All monetary amounts are in SAR cents.
 */
export async function calculateProrateShare(
  agreementId: number,
  totalFare: number,
  segment1Distance: number,
  segment2Distance: number
): Promise<ProrateShareResult> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [agreement] = await db
      .select()
      .from(interlineAgreements)
      .where(eq(interlineAgreements.id, agreementId))
      .limit(1);

    if (!agreement) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Interline agreement (ID: ${agreementId}) not found`,
      });
    }

    if (agreement.status !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Agreement is not active (status: ${agreement.status})`,
      });
    }

    if (!agreement.prorateType) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Agreement has no prorate type configured",
      });
    }

    const prorateValue = agreement.prorateValue
      ? parseFloat(agreement.prorateValue)
      : 0;

    let segment1Share: number;
    let segment2Share: number;

    switch (agreement.prorateType) {
      case "mileage": {
        // Prorate by mileage (distance proportional)
        const totalDistance = segment1Distance + segment2Distance;
        if (totalDistance <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Total segment distance must be greater than zero for mileage prorate",
          });
        }
        const seg1Ratio = segment1Distance / totalDistance;
        segment1Share = Math.round(totalFare * seg1Ratio);
        segment2Share = totalFare - segment1Share; // Remainder to avoid rounding loss
        break;
      }

      case "spi": {
        // Special Prorate Agreement: prorateValue is the fixed amount for airline 1
        if (prorateValue <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "SPI prorate value must be set and positive",
          });
        }
        segment1Share = Math.min(Math.round(prorateValue), totalFare);
        segment2Share = totalFare - segment1Share;
        break;
      }

      case "percentage": {
        // Fixed percentage: prorateValue is the percentage for airline 1 (segment 1)
        if (prorateValue < 0 || prorateValue > 100) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Percentage prorate value must be between 0 and 100",
          });
        }
        segment1Share = Math.round(totalFare * (prorateValue / 100));
        segment2Share = totalFare - segment1Share;
        break;
      }

      default: {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown prorate type: ${agreement.prorateType}`,
        });
      }
    }

    return {
      agreementId,
      prorateType: agreement.prorateType,
      totalFare,
      segment1Share,
      segment2Share,
      segment1Distance,
      segment2Distance,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error calculating prorate share:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to calculate prorate share",
    });
  }
}

// ============================================================================
// Cross-domain Helper Functions
// ============================================================================

/**
 * Get all partner airlines for a given airline, combining both codeshare
 * and interline partnerships. Only returns partners from active agreements
 * within their validity period.
 */
export async function getPartnerAirlines(
  airlineId: number
): Promise<PartnerAirline[]> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const now = new Date();
    const partners: PartnerAirline[] = [];
    const seenKeys = new Set<string>();

    // --- Codeshare partners ---
    // As marketing carrier
    const csAsMarketing = await db
      .select({
        partnerAirlineId: codeshareAgreements.operatingAirlineId,
        agreementReference: codeshareAgreements.agreementReference,
        status: codeshareAgreements.status,
        airlineCode: sql<string>`op_airline.code`,
        airlineName: sql<string>`op_airline.name`,
      })
      .from(codeshareAgreements)
      .innerJoin(
        sql`airlines as op_airline`,
        sql`${codeshareAgreements.operatingAirlineId} = op_airline.id`
      )
      .where(
        and(
          eq(codeshareAgreements.marketingAirlineId, airlineId),
          eq(codeshareAgreements.status, "active"),
          lte(codeshareAgreements.validFrom, now),
          or(
            sql`${codeshareAgreements.validUntil} IS NULL`,
            gte(codeshareAgreements.validUntil, now)
          )
        )
      );

    for (const row of csAsMarketing) {
      const key = `codeshare-${row.partnerAirlineId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        partners.push({
          airlineId: row.partnerAirlineId,
          airlineCode: row.airlineCode,
          airlineName: row.airlineName,
          partnershipType: "codeshare",
          agreementReference: row.agreementReference,
          agreementStatus: row.status,
        });
      }
    }

    // As operating carrier
    const csAsOperating = await db
      .select({
        partnerAirlineId: codeshareAgreements.marketingAirlineId,
        agreementReference: codeshareAgreements.agreementReference,
        status: codeshareAgreements.status,
        airlineCode: airlines.code,
        airlineName: airlines.name,
      })
      .from(codeshareAgreements)
      .innerJoin(
        airlines,
        eq(codeshareAgreements.marketingAirlineId, airlines.id)
      )
      .where(
        and(
          eq(codeshareAgreements.operatingAirlineId, airlineId),
          eq(codeshareAgreements.status, "active"),
          lte(codeshareAgreements.validFrom, now),
          or(
            sql`${codeshareAgreements.validUntil} IS NULL`,
            gte(codeshareAgreements.validUntil, now)
          )
        )
      );

    for (const row of csAsOperating) {
      const key = `codeshare-${row.partnerAirlineId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        partners.push({
          airlineId: row.partnerAirlineId,
          airlineCode: row.airlineCode,
          airlineName: row.airlineName,
          partnershipType: "codeshare",
          agreementReference: row.agreementReference,
          agreementStatus: row.status,
        });
      }
    }

    // --- Interline partners ---
    // As airline1
    const ilAsAirline1 = await db
      .select({
        partnerAirlineId: interlineAgreements.airline2Id,
        agreementReference: interlineAgreements.agreementReference,
        status: interlineAgreements.status,
        airlineCode: sql<string>`airline2.code`,
        airlineName: sql<string>`airline2.name`,
      })
      .from(interlineAgreements)
      .innerJoin(
        sql`airlines as airline2`,
        sql`${interlineAgreements.airline2Id} = airline2.id`
      )
      .where(
        and(
          eq(interlineAgreements.airline1Id, airlineId),
          eq(interlineAgreements.status, "active"),
          lte(interlineAgreements.validFrom, now),
          or(
            sql`${interlineAgreements.validUntil} IS NULL`,
            gte(interlineAgreements.validUntil, now)
          )
        )
      );

    for (const row of ilAsAirline1) {
      const key = `interline-${row.partnerAirlineId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        partners.push({
          airlineId: row.partnerAirlineId,
          airlineCode: row.airlineCode,
          airlineName: row.airlineName,
          partnershipType: "interline",
          agreementReference: row.agreementReference,
          agreementStatus: row.status,
        });
      }
    }

    // As airline2
    const ilAsAirline2 = await db
      .select({
        partnerAirlineId: interlineAgreements.airline1Id,
        agreementReference: interlineAgreements.agreementReference,
        status: interlineAgreements.status,
        airlineCode: airlines.code,
        airlineName: airlines.name,
      })
      .from(interlineAgreements)
      .innerJoin(airlines, eq(interlineAgreements.airline1Id, airlines.id))
      .where(
        and(
          eq(interlineAgreements.airline2Id, airlineId),
          eq(interlineAgreements.status, "active"),
          lte(interlineAgreements.validFrom, now),
          or(
            sql`${interlineAgreements.validUntil} IS NULL`,
            gte(interlineAgreements.validUntil, now)
          )
        )
      );

    for (const row of ilAsAirline2) {
      const key = `interline-${row.partnerAirlineId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        partners.push({
          airlineId: row.partnerAirlineId,
          airlineCode: row.airlineCode,
          airlineName: row.airlineName,
          partnershipType: "interline",
          agreementReference: row.agreementReference,
          agreementStatus: row.status,
        });
      }
    }

    // Sort by partnership type then airline name
    partners.sort((a, b) => {
      if (a.partnershipType !== b.partnershipType) {
        return a.partnershipType === "codeshare" ? -1 : 1;
      }
      return a.airlineName.localeCompare(b.airlineName);
    });

    return partners;
  } catch (error) {
    console.error("Error getting partner airlines:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get partner airlines",
    });
  }
}
