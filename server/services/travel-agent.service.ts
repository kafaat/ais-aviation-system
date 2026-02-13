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
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { getDb } from "../db";
import {
  travelAgents,
  agentBookings,
  flights,
  bookings,
  airports,
  airlines,
  type TravelAgent,
} from "../../drizzle/schema";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("travel-agent");

// ============ Types ============

export interface RegisterAgentInput {
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
  const inputHash = hashApiSecret(secret);
  return inputHash === hash;
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

  // Create agent
  const result = await db.insert(travelAgents).values({
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

  const agentId = (result as any).insertId || result[0]?.insertId;

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
): Promise<any[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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

  // Build search query
  const startOfDay = new Date(params.departureDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(params.departureDate);
  endOfDay.setHours(23, 59, 59, 999);

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
        gte(flights.departureTime, startOfDay),
        lte(flights.departureTime, endOfDay),
        eq(flights.status, "scheduled")
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
  input: AgentBookingInput
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

  if (!agent) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
  }

  // Check daily booking limit
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayBookings = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentBookings)
    .where(
      and(
        eq(agentBookings.agentId, agentId),
        gte(agentBookings.createdAt, todayStart)
      )
    );

  if ((todayBookings[0]?.count ?? 0) >= agent.dailyBookingLimit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Daily booking limit exceeded",
    });
  }

  // Check monthly booking limit
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyBookings = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentBookings)
    .where(
      and(
        eq(agentBookings.agentId, agentId),
        gte(agentBookings.createdAt, monthStart)
      )
    );

  if ((monthlyBookings[0]?.count ?? 0) >= agent.monthlyBookingLimit) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Monthly booking limit exceeded",
    });
  }

  // Get flight details
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, input.flightId));

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Check availability
  const availableSeats =
    input.cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;

  if (availableSeats < input.passengers.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Not enough seats available",
    });
  }

  // Calculate price
  const pricePerSeat =
    input.cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;
  const totalAmount = pricePerSeat * input.passengers.length;

  // Calculate commission
  const commissionRate = parseFloat(String(agent.commissionRate));
  const commissionAmount = Math.round((totalAmount * commissionRate) / 100);

  // Generate booking reference
  const bookingReference = generateBookingReference();
  const pnr = generateBookingReference();

  // Create booking (using a placeholder user ID for agent bookings)
  const bookingResult = await db.insert(bookings).values({
    userId: 0, // System user for agent bookings
    flightId: input.flightId,
    bookingReference,
    pnr,
    status: "pending",
    totalAmount,
    cabinClass: input.cabinClass,
    numberOfPassengers: input.passengers.length,
  });

  const bookingId =
    (bookingResult as any).insertId || bookingResult[0]?.insertId;

  // Create agent booking record
  await db.insert(agentBookings).values({
    agentId,
    bookingId,
    commissionRate: String(commissionRate),
    commissionAmount,
    bookingAmount: totalAmount,
    externalReference: input.externalReference,
  });

  // Update agent statistics
  await db
    .update(travelAgents)
    .set({
      totalBookings: sql`${travelAgents.totalBookings} + 1`,
      totalRevenue: sql`${travelAgents.totalRevenue} + ${totalAmount}`,
      totalCommission: sql`${travelAgents.totalCommission} + ${commissionAmount}`,
    })
    .where(eq(travelAgents.id, agentId));

  // Update flight availability
  if (input.cabinClass === "economy") {
    await db
      .update(flights)
      .set({
        economyAvailable: sql`${flights.economyAvailable} - ${input.passengers.length}`,
      })
      .where(eq(flights.id, input.flightId));
  } else {
    await db
      .update(flights)
      .set({
        businessAvailable: sql`${flights.businessAvailable} - ${input.passengers.length}`,
      })
      .where(eq(flights.id, input.flightId));
  }

  log.info(
    { agentId, bookingId, commission: commissionAmount },
    "Agent booking created"
  );

  return {
    bookingId,
    bookingReference,
    commission: commissionAmount,
  };
}

/**
 * Generate a unique booking reference
 */
function generateBookingReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Get bookings made by a travel agent
 */
export async function getAgentBookings(
  agentId: number,
  filters: BookingFilters = {}
): Promise<{ bookings: any[]; total: number; page: number; limit: number }> {
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

  // Get total count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentBookings)
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
    .orderBy(desc(agentBookings.createdAt))
    .limit(limit)
    .offset(offset);

  // Filter by booking status if provided
  let filteredResults = results;
  if (filters.status) {
    filteredResults = results.filter(r => r.booking.status === filters.status);
  }

  return {
    bookings: filteredResults.map(r => ({
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

  const conditions: any[] = [];
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

  const updateData: any = {
    commissionStatus: status,
    updatedAt: new Date(),
  };

  if (status === "paid") {
    updateData.commissionPaidAt = new Date();
  }

  await db
    .update(agentBookings)
    .set(updateData)
    .where(eq(agentBookings.id, agentBookingId));

  log.info({ agentBookingId, status }, "Commission status updated");
}

/**
 * Get all pending commissions (admin)
 */
export async function getPendingCommissions(): Promise<any[]> {
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
      and(
        eq(agentBookings.commissionStatus, "pending"),
        eq(bookings.paymentStatus, "paid")
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
    commissionAmount: r.agentBooking.commissionAmount,
    createdAt: r.agentBooking.createdAt,
  }));
}
