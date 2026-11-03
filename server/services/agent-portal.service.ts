import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, gt, inArray, isNull, lt } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import {
  agentBookings,
  airports,
  bookings,
  flights,
  travelAgents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  AgentPortalBooking,
  AgentPortalSearch,
} from "../contracts/agent-portal";
import {
  requireOwnedAgency,
  assertAgencySessionAccount,
  type AgencySessionOwner,
} from "./agent-session-authorization";
import {
  civilDayWindowUtc,
  fallbackAirportTimeZone,
  isValidTimeZone,
} from "./civil-day";
import { countActiveHolds } from "./inventory-capacity.service";
import { agencyCreditBalance } from "./agency-credit.service";
import { createAgentBooking } from "./travel-agent.service";

function database() {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Agency service unavailable",
    });
  return db;
}
function tenantScope(column: AnyMySqlColumn, tenantId: number | null) {
  return tenantId === null ? isNull(column) : eq(column, tenantId);
}

export function listSessionAgencies(actor: AgencySessionOwner) {
  return database().transaction(async tx => {
    await assertAgencySessionAccount(tx, actor);
    return tx
      .select({
        id: travelAgents.id,
        agencyName: travelAgents.agencyName,
        iataNumber: travelAgents.iataNumber,
        contactEmail: travelAgents.email,
        contactPhone: travelAgents.phone,
      })
      .from(travelAgents)
      .where(
        and(
          eq(travelAgents.ownerUserId, actor.userId),
          eq(travelAgents.isActive, true)
        )
      )
      .orderBy(asc(travelAgents.agencyName), asc(travelAgents.id));
  });
}

export function searchSessionAgencyFlights(
  actor: AgencySessionOwner,
  input: AgentPortalSearch
) {
  return database().transaction(async tx => {
    await requireOwnedAgency(tx, actor, input.agencyId);
    const airportRows = await tx
      .select({
        id: airports.id,
        code: airports.code,
        city: airports.city,
        timezone: airports.timezone,
      })
      .from(airports)
      .where(inArray(airports.code, [input.originCode, input.destinationCode]));
    const origin = airportRows.find(
      airport => airport.code === input.originCode
    );
    const destination = airportRows.find(
      airport => airport.code === input.destinationCode
    );
    if (!origin || !destination)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose valid airports",
      });
    const { start, end } = civilDayWindowUtc(
      input.departureDate,
      isValidTimeZone(origin.timezone)
        ? origin.timezone
        : fallbackAirportTimeZone()
    );
    const seatColumn =
      input.cabinClass === "economy"
        ? flights.economyAvailable
        : flights.businessAvailable;
    const priceColumn =
      input.cabinClass === "economy"
        ? flights.economyPrice
        : flights.businessPrice;
    const candidates = await tx
      .select({
        id: flights.id,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        recordedSeats: seatColumn,
        adultBaseFare: priceColumn,
      })
      .from(flights)
      .where(
        and(
          tenantScope(flights.tenantId, actor.tenantId),
          eq(flights.originId, origin.id),
          eq(flights.destinationId, destination.id),
          gte(flights.departureTime, start),
          lt(flights.departureTime, end),
          gt(flights.departureTime, new Date()),
          inArray(flights.status, ["scheduled", "delayed"]),
          gte(seatColumn, input.passengers)
        )
      )
      .orderBy(asc(flights.departureTime), asc(flights.id))
      .limit(100);
    const result = [];
    for (const flight of candidates) {
      const held = await countActiveHolds(
        tx,
        flight.id,
        input.cabinClass,
        undefined,
        false
      );
      const availableSeats = Math.max(0, flight.recordedSeats - held);
      if (availableSeats < input.passengers) continue;
      result.push({
        id: flight.id,
        flightNumber: flight.flightNumber,
        departureTime: flight.departureTime,
        arrivalTime: flight.arrivalTime,
        origin: {
          code: origin.code,
          city: origin.city,
          timezone: origin.timezone,
        },
        destination: {
          code: destination.code,
          city: destination.city,
          timezone: destination.timezone,
        },
        cabinClass: input.cabinClass,
        availableSeats,
        adultBaseFare: flight.adultBaseFare,
        currency: "SAR" as const,
      });
    }
    return result;
  });
}

export function getSessionAgencyDashboard(
  actor: AgencySessionOwner,
  agencyId: number,
  page: number
) {
  return database().transaction(async tx => {
    await requireOwnedAgency(tx, actor, agencyId);
    // The legacy agent statistics include historical sales from previous
    // owners. Intersect the agency ledger with CURRENT account ownership and
    // tenant before producing either rows or totals.
    const ledger = await tx
      .select({
        bookingId: agentBookings.bookingId,
        commissionAmount: agentBookings.commissionAmount,
      })
      .from(agentBookings)
      .where(eq(agentBookings.agentId, agencyId));
    const ids = ledger.map(row => row.bookingId);
    const bookingRows = ids.length
      ? await tx
          .select({
            bookingId: bookings.id,
            flightId: bookings.flightId,
            bookingReference: bookings.bookingReference,
            status: bookings.status,
            paymentStatus: bookings.paymentStatus,
            totalAmount: bookings.totalAmount,
            createdAt: bookings.createdAt,
          })
          .from(bookings)
          .where(
            and(
              inArray(bookings.id, ids),
              eq(bookings.userId, actor.userId),
              tenantScope(bookings.tenantId, actor.tenantId),
              isNull(bookings.deletedAt)
            )
          )
          .orderBy(desc(bookings.createdAt), desc(bookings.id))
      : [];
    const flightIds = [...new Set(bookingRows.map(row => row.flightId))];
    const flightRows = flightIds.length
      ? await tx
          .select({
            id: flights.id,
            flightNumber: flights.flightNumber,
            departureTime: flights.departureTime,
          })
          .from(flights)
          .where(
            and(
              inArray(flights.id, flightIds),
              tenantScope(flights.tenantId, actor.tenantId)
            )
          )
      : [];
    const flightsById = new Map(flightRows.map(row => [row.id, row]));
    const commissions = new Map(
      ledger.map(row => [row.bookingId, row.commissionAmount])
    );
    const owned = bookingRows.flatMap(row => {
      const flight = flightsById.get(row.flightId);
      return flight
        ? [
            {
              bookingId: row.bookingId,
              bookingReference: row.bookingReference,
              flightNumber: flight.flightNumber,
              departureTime: flight.departureTime,
              status: row.status,
              paymentStatus: row.paymentStatus,
              totalAmount: row.totalAmount,
              commissionAmount: commissions.get(row.bookingId) ?? 0,
              createdAt: row.createdAt,
            },
          ]
        : [];
    });
    const pageSize = 20 as const;
    return {
      credit: await agencyCreditBalance(tx, agencyId, actor),
      bookings: owned.slice((page - 1) * pageSize, page * pageSize),
      total: owned.length,
      page,
      pageSize,
      stats: {
        totalBookings: owned.length,
        pendingBookings: owned.filter(row => row.status === "pending").length,
        confirmedBookings: owned.filter(row => row.status === "confirmed")
          .length,
        recordedBookingAmount: owned.reduce(
          (sum, row) => sum + row.totalAmount,
          0
        ),
        recordedCommissionAmount: owned.reduce(
          (sum, row) => sum + row.commissionAmount,
          0
        ),
      },
      currency: "SAR" as const,
    };
  });
}

export function createSessionAgencyBooking(
  actor: AgencySessionOwner,
  input: AgentPortalBooking
) {
  const { agencyId, ...command } = input;
  // Same pricing, limits, holds, durable response and ledger authority as the
  // API. expectedOwner closes the session-to-agency relink race.
  return createAgentBooking(agencyId, command, actor);
}
