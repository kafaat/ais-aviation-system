import {
  reserveAgencyCredit,
  requireCreditDisabledForTransfer,
} from "./agency-credit.service";
import { inventoryTransactionConfig } from "./inventory-capacity.service";
import { recordEvent } from "./outbox.service";
import { assertTenantOperational, isTenantActive } from "./tenant.service";
import { createBooking } from "./bookings.service";
import { withTransactionalIdempotency } from "./idempotency-v2.service";
import {
  requireOwnedAgency,
  agencyUnavailable,
  type AgencySessionOwner,
} from "./agent-session-authorization";
import type { SettlementTx } from "./booking-settlement.service";
/**
 * Travel Agent Service
 *
 * Provides functionality for travel agent API operations:
 * - Agent registration and management
 * - API credential generation and validation
 * - Flight search and booking operations
 * - Commission calculation and tracking
 *
 * @version 1.0.0
 */

import { TRPCError } from "@trpc/server";
import {
  and,
  or,
  eq,
  ne,
  gte,
  gt,
  isNull,
  lt,
  lte,
  inArray,
  desc,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  civilDateOf,
  civilDayWindowUtc,
  fallbackAirportTimeZone,
  isValidTimeZone,
} from "./civil-day";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { getDb } from "../db";
import {
  travelAgents,
  agentBookings,
  financialLedger,
  flights,
  bookings,
  airports,
  airlines,
  type TravelAgent,
  users,
  idempotencyRequests,
} from "../../drizzle/schema";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("travel-agent");

// ============ Types ============

export interface RegisterAgentInput {
  ownerUserId?: number;
  agencyName: string;
  iataNumber: string;
  contactName: string;
  email: string;
  phone: string;
  commissionRate?: number;
  dailyBookingLimit?: number;
  monthlyBookingLimit?: number;
}

export interface AgentCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface AgentSearchParams {
  originCode: string;
  destinationCode: string;
  departureDate: Date;
  returnDate?: Date;
  cabinClass?: "economy" | "business";
  passengers?: number;
}

export interface AgentBookingInput {
  idempotencyKey?: string;
  flightId: number;
  cabinClass: "economy" | "business";
  passengers: Array<{
    type: "adult" | "child" | "infant";
    title?: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: Date;
    passportNumber?: string;
    nationality?: string;
  }>;
  externalReference?: string;
  contactEmail: string;
  contactPhone: string;
}

export interface BookingFilters {
  status?: "pending" | "confirmed" | "cancelled" | "completed";
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface AgentStats {
  totalBookings: number;
  totalRevenue: number;
  totalCommission: number;
  pendingCommission: number;
  paidCommission: number;
  bookingsThisMonth: number;
  revenueThisMonth: number;
  commissionThisMonth: number;
}

// ============ Helper Functions ============

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  return `ais_agent_${randomBytes(24).toString("hex")}`;
}

/**
 * Generate a secure API secret
 */
function generateApiSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash an API secret for storage
 */
function hashApiSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Verify an API secret against stored hash
 */
function verifyApiSecret(secret: string, hash: string): boolean {
  const input = Buffer.from(hashApiSecret(secret), "hex");
  const stored = Buffer.from(hash, "hex");
  return input.length === stored.length && timingSafeEqual(input, stored);
}

// ============ Service Functions ============

/**
 * Register a new travel agent
 */
export async function registerAgent(
  input: RegisterAgentInput
): Promise<{ agent: TravelAgent; credentials: AgentCredentials }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  log.info(
    { agencyName: input.agencyName, iataNumber: input.iataNumber },
    "Registering new travel agent"
  );

  // Check if agent already exists
  const existing = await db
    .select()
    .from(travelAgents)
    .where(
      sql`${travelAgents.email} = ${input.email} OR ${travelAgents.iataNumber} = ${input.iataNumber}`
    )
    .limit(1);

  if (existing.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Agent with this email or IATA number already exists",
    });
  }

  // Generate API credentials
  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  const apiSecretHash = hashApiSecret(apiSecret);

  if (input.ownerUserId) await validateAgentOwner(input.ownerUserId);
  // Create agent
  const result = await db.insert(travelAgents).values({
    ownerUserId: input.ownerUserId,
    agencyName: input.agencyName,
    iataNumber: input.iataNumber,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    commissionRate: String(input.commissionRate ?? 5.0),
    dailyBookingLimit: input.dailyBookingLimit ?? 100,
    monthlyBookingLimit: input.monthlyBookingLimit ?? 2000,
    apiKey,
    apiSecret: apiSecretHash,
  });

  const agentId = result[0].insertId;

  // Fetch the created agent
  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.id, agentId));

  log.info(
    { agentId, agencyName: input.agencyName },
    "Travel agent registered successfully"
  );

  return {
    agent,
    credentials: {
      apiKey,
      apiSecret, // Return plain secret only once
    },
  };
}

/**
 * Generate new API credentials for an existing agent
 */
export async function generateApiCredentials(
  agentId: number
): Promise<AgentCredentials> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  log.info({ agentId }, "Generating new API credentials");

  // Verify agent exists
  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.id, agentId));

  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  }

  // Generate new credentials
  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  const apiSecretHash = hashApiSecret(apiSecret);

  // Update agent
  await db
    .update(travelAgents)
    .set({
      apiKey,
      apiSecret: apiSecretHash,
      updatedAt: new Date(),
    })
    .where(eq(travelAgents.id, agentId));

  log.info({ agentId }, "New API credentials generated");

  return {
    apiKey,
    apiSecret,
  };
}

/**
 * Validate API key and secret
 */
export async function validateApiKey(
  apiKey: string,
  apiSecret: string
): Promise<TravelAgent | null> {
  const db = await getDb();
  if (!db) return null;

  // Find agent by API key
  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.apiKey, apiKey));

  if (!agent) {
    log.warn({ apiKey: apiKey.substring(0, 20) + "..." }, "Invalid API key");
    return null;
  }

  // Verify secret
  if (!verifyApiSecret(apiSecret, agent.apiSecret)) {
    log.warn({ agentId: agent.id }, "Invalid API secret");
    return null;
  }

  // Check if agent is active
  if (!agent.isActive) {
    log.warn({ agentId: agent.id }, "Agent is inactive");
    return null;
  }

  // Update last active timestamp
  await db
    .update(travelAgents)
    .set({ lastActiveAt: new Date() })
    .where(eq(travelAgents.id, agent.id));

  return agent;
}

/**
 * Search flights for travel agent
 */
export async function searchFlightsForAgent(
  agentId: number,
  params: AgentSearchParams
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const passengerCount = params.passengers ?? 1;
  const cabinClass = params.cabinClass ?? "economy";
  if (
    !Number.isSafeInteger(passengerCount) ||
    passengerCount < 1 ||
    !["economy", "business"].includes(cabinClass)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid cabin or passenger count",
    });
  const agent = await getAgentById(agentId);
  if (!agent?.isActive || !agent.ownerUserId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Agency must have an active, verified account owner before searching",
    });
  const owner = await validateAgentOwner(agent.ownerUserId);

  log.info(
    { agentId, origin: params.originCode, destination: params.destinationCode },
    "Agent searching flights"
  );

  // Get airport IDs from codes
  const [originAirport] = await db
    .select()
    .from(airports)
    .where(eq(airports.code, params.originCode.toUpperCase()));

  const [destinationAirport] = await db
    .select()
    .from(airports)
    .where(eq(airports.code, params.destinationCode.toUpperCase()));

  if (!originAirport || !destinationAirport) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid airport code",
    });
  }

  // The requested day is a calendar day at the origin airport.
  const { start: startOfDay, end: endOfDay } = civilDayWindowUtc(
    civilDateOf(params.departureDate),
    isValidTimeZone(originAirport.timezone)
      ? originAirport.timezone
      : fallbackAirportTimeZone()
  );

  const results = await db
    .select({
      flight: flights,
      airline: airlines,
      origin: airports,
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .where(
      and(
        eq(flights.originId, originAirport.id),
        eq(flights.destinationId, destinationAirport.id),
        owner.tenantId == null
          ? isNull(flights.tenantId)
          : eq(flights.tenantId, owner.tenantId),
        gt(flights.departureTime, new Date()),
        gte(
          cabinClass === "business"
            ? flights.businessAvailable
            : flights.economyAvailable,
          passengerCount
        ),
        gte(flights.departureTime, startOfDay),
        lt(flights.departureTime, endOfDay),
        inArray(flights.status, ["scheduled", "delayed"])
      )
    )
    .orderBy(flights.departureTime);

  // Get destination airport details
  const [destAirport] = await db
    .select()
    .from(airports)
    .where(eq(airports.id, destinationAirport.id));

  // Format results
  return results.map(r => ({
    id: r.flight.id,
    flightNumber: r.flight.flightNumber,
    airline: {
      code: r.airline.code,
      name: r.airline.name,
    },
    origin: {
      code: originAirport.code,
      name: originAirport.name,
      city: originAirport.city,
    },
    destination: {
      code: destAirport.code,
      name: destAirport.name,
      city: destAirport.city,
    },
    departureTime: r.flight.departureTime,
    arrivalTime: r.flight.arrivalTime,
    aircraftType: r.flight.aircraftType,
    availability: {
      economy: {
        available: r.flight.economyAvailable,
        price: r.flight.economyPrice,
      },
      business: {
        available: r.flight.businessAvailable,
        price: r.flight.businessPrice,
      },
    },
  }));
}

/**
 * Create a booking for travel agent
 */
export async function createAgentBooking(
  agentId: number,
  input: AgentBookingInput,
  expectedOwner?: AgencySessionOwner
): Promise<{
  bookingId: number;
  bookingReference: string;
  commission: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  log.info({ agentId, flightId: input.flightId }, "Agent creating booking");

  // Get agent details
  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.id, agentId));

  if (
    expectedOwner &&
    (!agent?.isActive || agent.ownerUserId !== expectedOwner.userId)
  )
    agencyUnavailable();

  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  }

  if (!agent.isActive || !agent.ownerUserId)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Agency must have an active, verified account owner before booking",
    });
  const owner = await validateAgentOwner(agent.ownerUserId);
  if (
    expectedOwner &&
    (owner.id !== expectedOwner.userId ||
      owner.tenantId !== expectedOwner.tenantId)
  )
    agencyUnavailable();
  const key = input.idempotencyKey ?? input.externalReference;
  if (!key)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An idempotency key or unique external reference is required",
    });
  const execute = (transaction: SettlementTx) =>
    withTransactionalIdempotency(
      {
        transactionConfig: inventoryTransactionConfig,
        scope: `agent.booking.${agentId}`,
        key,
        userId: owner.id,
        request: input,
        run: async tx => {
          const [current] = await tx
            .select()
            .from(travelAgents)
            .where(eq(travelAgents.id, agentId))
            .limit(1)
            .for("update");
          if (!current?.isActive || current.ownerUserId !== owner.id)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Agency account changed",
            });
          const [currentOwner] = await tx
            .select()
            .from(users)
            .where(eq(users.id, owner.id))
            .limit(1)
            .for("share");
          if (!currentOwner || currentOwner.tenantId !== owner.tenantId)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Agency owner changed; retry with the current account",
            });
          if (expectedOwner) {
            // Preserve strict NULL-tenant isolation for the session portal too.
            // This runs only on a new command, so a replay is not blocked by
            // inventory that its own original booking already consumed.
            const [flight] = await tx
              .select({ tenantId: flights.tenantId })
              .from(flights)
              .where(eq(flights.id, input.flightId))
              .limit(1)
              .for("update");
            if (!flight || flight.tenantId !== expectedOwner.tenantId)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Flight not found",
              });
          }
          for (const [period, limit] of [
            ["day", current.dailyBookingLimit],
            ["month", current.monthlyBookingLimit],
          ] as const) {
            const since = new Date();
            since.setUTCHours(0, 0, 0, 0);
            if (period === "month") since.setUTCDate(1);
            const [usage] = await tx
              .select({ count: sql<number>`count(*)` })
              .from(agentBookings)
              .where(
                and(
                  eq(agentBookings.agentId, agentId),
                  gte(agentBookings.createdAt, since)
                )
              );
            if (Number(usage?.count ?? 0) >= limit)
              throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: `${period} booking limit exceeded`,
              });
          }
          const booking = await createBooking(
            {
              userId: owner.id,
              tenantId: owner.tenantId,
              flightId: input.flightId,
              cabinClass: input.cabinClass,
              passengers: input.passengers,
              sessionId: `agent:${agentId}:${key}`,
              idempotencyKey: `agent:${agentId}:${key}`,
            },
            tx
          );
          await reserveAgencyCredit(
            tx,
            agentId,
            { userId: owner.id, tenantId: owner.tenantId },
            booking.bookingId,
            booking.totalAmount
          );
          const commissionRate = Number(current.commissionRate);
          const commission = Math.round(
            (booking.totalAmount * commissionRate) / 100
          );
          await tx.insert(agentBookings).values({
            agentId,
            bookingId: booking.bookingId,
            commissionRate: String(commissionRate),
            commissionAmount: commission,
            bookingAmount: booking.totalAmount,
            externalReference: input.externalReference,
          });
          await tx
            .update(travelAgents)
            .set({
              totalBookings: sql`${travelAgents.totalBookings} + 1`,
              totalRevenue: sql`${travelAgents.totalRevenue} + ${booking.totalAmount}`,
              totalCommission: sql`${travelAgents.totalCommission} + ${commission}`,
            })
            .where(eq(travelAgents.id, agentId));
          return {
            bookingId: booking.bookingId,
            bookingReference: booking.bookingReference,
            commission,
          };
        },
      },
      transaction
    );
  // An agency API credential can survive an ownership transfer. Both entry
  // points must confirm the current debtor before replaying a cached result.
  const bookingOwner = expectedOwner ?? {
    userId: owner.id,
    tenantId: owner.tenantId,
  };
  return db.transaction(async tx => {
    await requireOwnedAgency(tx, bookingOwner, agentId, true);
    const [previousOwner] = await tx
      .select({ userId: idempotencyRequests.userId })
      .from(idempotencyRequests)
      .where(
        and(
          eq(idempotencyRequests.scope, `agent.booking.${agentId}`),
          eq(idempotencyRequests.idempotencyKey, key),
          ne(idempotencyRequests.userId, bookingOwner.userId)
        )
      )
      .limit(1);
    if (previousOwner)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Reservation command cannot be reused by this account",
      });
    return execute(tx);
  }, inventoryTransactionConfig);
}

async function validateAgentOwner(ownerUserId: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const [owner] = await database
    .select()
    .from(users)
    .where(eq(users.id, ownerUserId))
    .limit(1);
  if (!owner)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Agency owner must be an existing user",
    });
  if (owner.tenantId != null && !(await isTenantActive(owner.tenantId)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Agency tenant is not active",
    });
  return owner;
}

/** Administration must explicitly link historical agencies; never use userId=0. */
export async function assignAgentOwner(
  agentId: number,
  ownerUserId: number,
  actorId: number,
  onlyIfUnlinked = false
) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database.transaction(async tx => {
    const [agency] = await tx
      .select()
      .from(travelAgents)
      .where(eq(travelAgents.id, agentId))
      .limit(1)
      .for("update");
    if (!agency)
      throw new TRPCError({ code: "NOT_FOUND", message: "Agency not found" });
    if (
      onlyIfUnlinked &&
      agency.ownerUserId != null &&
      agency.ownerUserId !== ownerUserId
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Agency already has an owner",
      });
    const [owner] = await tx
      .select()
      .from(users)
      .where(eq(users.id, ownerUserId))
      .limit(1)
      .for("share");
    if (!owner)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Agency owner not found",
      });
    if (agency.ownerUserId != null && agency.ownerUserId !== ownerUserId) {
      await requireCreditDisabledForTransfer(tx, agentId);
      const [previous] = await tx
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(eq(users.id, agency.ownerUserId))
        .limit(1)
        .for("share");
      if (!previous || previous.tenantId !== owner.tenantId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot transfer agency ownership between tenants",
        });
    }
    if (agency.ownerUserId == null) {
      // An unlinked historical agency can already have sales. Preserve their tenant boundary.
      const [foreignBooking] = await tx
        .select({ id: bookings.id })
        .from(agentBookings)
        .innerJoin(bookings, eq(agentBookings.bookingId, bookings.id))
        .where(
          and(
            eq(agentBookings.agentId, agentId),
            sql`NOT (${bookings.tenantId} <=> ${owner.tenantId})`
          )
        )
        .limit(1);
      if (foreignBooking)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Agency bookings belong to another tenant",
        });
    }
    await assertTenantOperational(tx, owner.tenantId);
    await tx
      .update(travelAgents)
      .set({ ownerUserId })
      .where(eq(travelAgents.id, agentId));
    await recordEvent(tx, {
      aggregateType: "travel_agent",
      aggregateId: agentId,
      tenantId: owner.tenantId,
      eventType: "travel_agent.owner_assigned",
      payload: {
        agentId,
        previousOwnerId: agency.ownerUserId,
        ownerUserId,
        actorId,
      },
    });
    return { success: true as const };
  });
}

/**
 * Get bookings made by a travel agent
 */
export async function getAgentBookings(
  agentId: number,
  filters: BookingFilters = {}
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const page = filters.page ?? 1;
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  // Build conditions
  const conditions = [eq(agentBookings.agentId, agentId)];

  if (filters.startDate) {
    conditions.push(gte(agentBookings.createdAt, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(agentBookings.createdAt, filters.endDate));
  }

  if (filters.status) {
    conditions.push(eq(bookings.status, filters.status));
  }

  // Count exactly the joined, filtered rows that can appear on a page.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentBookings)
    .innerJoin(bookings, eq(agentBookings.bookingId, bookings.id))
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...conditions));

  // Get bookings with flight details
  const results = await db
    .select({
      agentBooking: agentBookings,
      booking: bookings,
      flight: flights,
    })
    .from(agentBookings)
    .innerJoin(bookings, eq(agentBookings.bookingId, bookings.id))
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .where(and(...conditions))
    .orderBy(desc(agentBookings.createdAt), desc(agentBookings.id))
    .limit(limit)
    .offset(offset);

  return {
    bookings: results.map(r => ({
      id: r.agentBooking.id,
      bookingId: r.booking.id,
      bookingReference: r.booking.bookingReference,
      pnr: r.booking.pnr,
      externalReference: r.agentBooking.externalReference,
      flightNumber: r.flight.flightNumber,
      departureTime: r.flight.departureTime,
      arrivalTime: r.flight.arrivalTime,
      status: r.booking.status,
      paymentStatus: r.booking.paymentStatus,
      cabinClass: r.booking.cabinClass,
      passengers: r.booking.numberOfPassengers,
      bookingAmount: r.agentBooking.bookingAmount,
      commissionRate: r.agentBooking.commissionRate,
      commissionAmount: r.agentBooking.commissionAmount,
      commissionStatus: r.agentBooking.commissionStatus,
      createdAt: r.agentBooking.createdAt,
    })),
    total: Number(count),
    page,
    limit,
  };
}

/**
 * Calculate commission for a booking amount
 */
export async function calculateCommission(
  agentId: number,
  bookingAmount: number
): Promise<{ commissionRate: number; commissionAmount: number }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.id, agentId));

  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  }

  const commissionRate = parseFloat(String(agent.commissionRate));
  const commissionAmount = Math.round((bookingAmount * commissionRate) / 100);

  return {
    commissionRate,
    commissionAmount,
  };
}

/**
 * Get statistics for a travel agent
 */
export async function getAgentStats(agentId: number): Promise<AgentStats> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get agent details
  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.id, agentId));

  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  }

  // Get commission statistics
  const commissionStats = await db
    .select({
      status: agentBookings.commissionStatus,
      total: sql<number>`SUM(${agentBookings.commissionAmount})`,
    })
    .from(agentBookings)
    .where(eq(agentBookings.agentId, agentId))
    .groupBy(agentBookings.commissionStatus);

  let pendingCommission = 0;
  let paidCommission = 0;

  for (const stat of commissionStats) {
    if (stat.status === "pending" || stat.status === "approved") {
      pendingCommission += Number(stat.total) || 0;
    } else if (stat.status === "paid") {
      paidCommission += Number(stat.total) || 0;
    }
  }

  // Get this month's statistics
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyStats = await db
    .select({
      bookings: sql<number>`COUNT(*)`,
      revenue: sql<number>`SUM(${agentBookings.bookingAmount})`,
      commission: sql<number>`SUM(${agentBookings.commissionAmount})`,
    })
    .from(agentBookings)
    .where(
      and(
        eq(agentBookings.agentId, agentId),
        gte(agentBookings.createdAt, startOfMonth)
      )
    );

  return {
    totalBookings: agent.totalBookings,
    totalRevenue: agent.totalRevenue,
    totalCommission: agent.totalCommission,
    pendingCommission,
    paidCommission,
    bookingsThisMonth: Number(monthlyStats[0]?.bookings) || 0,
    revenueThisMonth: Number(monthlyStats[0]?.revenue) || 0,
    commissionThisMonth: Number(monthlyStats[0]?.commission) || 0,
  };
}

/**
 * Get agent by ID
 */
export async function getAgentById(
  agentId: number
): Promise<TravelAgent | null> {
  const db = await getDb();
  if (!db) return null;

  const [agent] = await db
    .select()
    .from(travelAgents)
    .where(eq(travelAgents.id, agentId));

  return agent || null;
}

/**
 * List all travel agents (admin)
 */
export async function listAgents(
  options: {
    isActive?: boolean;
    page?: number;
    limit?: number;
  } = {}
): Promise<{ agents: TravelAgent[]; total: number }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];
  if (options.isActive !== undefined) {
    conditions.push(eq(travelAgents.isActive, options.isActive));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(travelAgents)
    .where(whereClause);

  const agents = await db
    .select()
    .from(travelAgents)
    .where(whereClause)
    .orderBy(desc(travelAgents.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    agents,
    total: Number(count),
  };
}

/**
 * Update agent status
 */
export async function updateAgentStatus(
  agentId: number,
  isActive: boolean
): Promise<void> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  await db
    .update(travelAgents)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(travelAgents.id, agentId));

  log.info({ agentId, isActive }, "Agent status updated");
}

/**
 * Update agent commission rate
 */
export async function updateAgentCommissionRate(
  agentId: number,
  commissionRate: number
): Promise<void> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (commissionRate < 0 || commissionRate > 50) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commission rate must be between 0 and 50",
    });
  }

  await db
    .update(travelAgents)
    .set({
      commissionRate: String(commissionRate),
      updatedAt: new Date(),
    })
    .where(eq(travelAgents.id, agentId));

  log.info({ agentId, commissionRate }, "Agent commission rate updated");
}

/**
 * Update commission payment status
 */
export async function updateCommissionStatus(
  agentBookingId: number,
  status: "pending" | "approved" | "paid" | "cancelled"
): Promise<void> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (status === "paid")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Agency payout settlement evidence is required; no accepted payout source is configured",
    });
  await db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(agentBookings)
      .where(eq(agentBookings.id, agentBookingId))
      .limit(1)
      .for("update");
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Agency commission not found",
      });
    if (row.commissionStatus === status) return;
    if (
      row.commissionStatus === "paid" ||
      row.commissionStatus === "cancelled" ||
      status === "pending"
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Commission status transition is not allowed",
      });

    if (status === "approved") {
      const [invoice] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, row.bookingId))
        .limit(1)
        .for("update");
      if (
        !invoice ||
        invoice.deletedAt ||
        !["confirmed", "completed"].includes(invoice.status) ||
        invoice.paymentStatus !== "paid" ||
        invoice.totalAmount !== row.bookingAmount
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Commission requires the original funded invoice",
        });

      // A paymentStatus flag can outlive a partial refund. Do not approve the
      // original commission for a changed or unreconciled invoice.
      const entries = await tx
        .select({
          type: financialLedger.type,
          amount: financialLedger.amount,
          currency: financialLedger.currency,
        })
        .from(financialLedger)
        .where(eq(financialLedger.bookingId, row.bookingId))
        .for("share");
      const charged = entries
        .filter(e => e.type === "charge")
        .reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0);
      if (
        charged <= 0 ||
        charged !== row.bookingAmount ||
        entries.some(
          e =>
            e.currency !== "SAR" || e.type !== "charge" || Number(e.amount) <= 0
        )
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Commission requires review of the posted funding and adjustments",
        });
    }
    await tx
      .update(agentBookings)
      .set({ commissionStatus: status })
      .where(eq(agentBookings.id, agentBookingId));
  });

  log.info({ agentBookingId, status }, "Commission status updated");
}

/**
 * Get all pending commissions (admin)
 */
export async function getPendingCommissions(includeApproved = false) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select({
      agentBooking: agentBookings,
      agent: travelAgents,
      booking: bookings,
    })
    .from(agentBookings)
    .innerJoin(travelAgents, eq(agentBookings.agentId, travelAgents.id))
    .innerJoin(bookings, eq(agentBookings.bookingId, bookings.id))
    .where(
      or(
        and(
          eq(agentBookings.commissionStatus, "pending"),
          eq(bookings.paymentStatus, "paid")
        ),
        includeApproved
          ? eq(agentBookings.commissionStatus, "approved")
          : undefined
      )
    )
    .orderBy(agentBookings.createdAt);

  return results.map(r => ({
    id: r.agentBooking.id,
    agentId: r.agent.id,
    agencyName: r.agent.agencyName,
    bookingReference: r.booking.bookingReference,
    bookingAmount: r.agentBooking.bookingAmount,
    commissionRate: r.agentBooking.commissionRate,
    commissionStatus: r.agentBooking.commissionStatus,
    commissionAmount: r.agentBooking.commissionAmount,
    createdAt: r.agentBooking.createdAt,
  }));
}
