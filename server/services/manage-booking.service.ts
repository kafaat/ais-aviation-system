import { createHash, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import {
  airports,
  bookings,
  bookingSegments,
  flights,
  passengers,
  tenants,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  normalizeBookingSurname,
  publicBookingLookupInput,
  PUBLIC_BOOKING_LOOKUP_FAILURE,
  type PublicBookingLookupInput,
  type PublicBookingLookupResult,
} from "../contracts/manage-booking";

function unavailable(): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: PUBLIC_BOOKING_LOOKUP_FAILURE,
  });
}

function tenantPredicate(column: AnyMySqlColumn, tenantId: number | null) {
  return tenantId === null ? isNull(column) : eq(column, tenantId);
}

function surnameDigest(value: string) {
  return createHash("sha256").update(normalizeBookingSurname(value)).digest();
}

/**
 * A reference/surname pair grants only this read-only itinerary projection.
 * It never creates an account session or grants authority to change/pay a booking.
 * The deployment chooses the public tenant; clients cannot select it.
 */
export async function lookupPublicBooking(
  rawInput: PublicBookingLookupInput,
  actor: { tenantId: number | null } | null
): Promise<PublicBookingLookupResult> {
  const parsed = publicBookingLookupInput.safeParse(rawInput);
  if (!parsed.success) unavailable();
  const input = parsed.data;
  const configuredSlug = process.env.PUBLIC_BOOKING_TENANT_SLUG?.trim() ?? "";
  const database = getDb();
  if (!database)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: PUBLIC_BOOKING_LOOKUP_FAILURE,
    });

  try {
    return await database.transaction(async tx => {
      // Explicit legacy NULL scope is not a wildcard. No host/header or
      // client-supplied tenant ID can switch this public interface's scope.
      let tenantId: number | null = null;
      if (configuredSlug) {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(configuredSlug)) unavailable();
        const tenantRows = await tx
          .select({ id: tenants.id, status: tenants.status })
          .from(tenants)
          .where(eq(tenants.slug, configuredSlug.toLowerCase()))
          .limit(2);
        if (tenantRows.length !== 1 || tenantRows[0].status !== "active")
          unavailable();
        tenantId = tenantRows[0].id;
      }
      if (actor && actor.tenantId !== tenantId) unavailable();

      const matchingBookings = await tx
        .select({
          id: bookings.id,
          flightId: bookings.flightId,
          bookingReference: bookings.bookingReference,
          status: bookings.status,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.bookingReference, input.bookingReference),
            tenantPredicate(bookings.tenantId, tenantId),
            isNull(bookings.deletedAt)
          )
        )
        .limit(2);
      // Never pick an arbitrary result if historical data is ambiguous.
      if (matchingBookings.length !== 1) unavailable();
      const booking = matchingBookings[0];

      const passengerNames = await tx
        .select({ lastName: passengers.lastName })
        .from(passengers)
        .where(
          and(
            eq(passengers.bookingId, booking.id),
            tenantPredicate(passengers.tenantId, tenantId)
          )
        );
      const suppliedSurname = surnameDigest(input.surname);
      let surnameMatches = false;
      for (const passenger of passengerNames) {
        // Compare every stored surname; never return any passenger's name.
        const matches = timingSafeEqual(
          surnameDigest(passenger.lastName),
          suppliedSurname
        );
        surnameMatches = matches || surnameMatches;
      }
      if (!surnameMatches) unavailable();

      const storedSegments = await tx
        .select({
          flightId: bookingSegments.flightId,
          status: bookingSegments.status,
        })
        .from(bookingSegments)
        .where(eq(bookingSegments.bookingId, booking.id))
        .orderBy(asc(bookingSegments.segmentOrder), asc(bookingSegments.id));
      // Legacy direct bookings have no segment rows. This read fallback does
      // not create operational sectors or claim to repair the sale producer.
      const segments = storedSegments.length
        ? storedSegments
        : [{ flightId: booking.flightId, status: booking.status }];
      const flightIds = [...new Set(segments.map(segment => segment.flightId))];
      const flightRows = await tx
        .select({
          id: flights.id,
          flightNumber: flights.flightNumber,
          originId: flights.originId,
          destinationId: flights.destinationId,
          departureTime: flights.departureTime,
          arrivalTime: flights.arrivalTime,
          status: flights.status,
        })
        .from(flights)
        .where(
          and(
            inArray(flights.id, flightIds),
            tenantPredicate(flights.tenantId, tenantId)
          )
        );
      // A corrupt or foreign-tenant leg must not produce a partial itinerary.
      if (flightRows.length !== flightIds.length) unavailable();
      const airportIds = [
        ...new Set(
          flightRows.flatMap(flight => [flight.originId, flight.destinationId])
        ),
      ];
      const airportRows = await tx
        .select({
          id: airports.id,
          code: airports.code,
          city: airports.city,
          timezone: airports.timezone,
        })
        .from(airports)
        .where(inArray(airports.id, airportIds));
      const flightById = new Map(flightRows.map(flight => [flight.id, flight]));
      const airportById = new Map(
        airportRows.map(airport => [airport.id, airport])
      );

      return {
        bookingReference: booking.bookingReference,
        status: booking.status,
        itinerary: segments.map(segment => {
          const flight = flightById.get(segment.flightId);
          if (!flight) unavailable();
          const origin = airportById.get(flight.originId);
          const destination = airportById.get(flight.destinationId);
          if (!origin || !destination) unavailable();
          return {
            flightNumber: flight.flightNumber,
            departureTime: flight.departureTime.toISOString(),
            arrivalTime: flight.arrivalTime.toISOString(),
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
            flightStatus: flight.status,
            segmentStatus: segment.status,
          };
        }),
      };
    });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") throw error;
    // Do not propagate database errors containing predicates or personal data.
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: PUBLIC_BOOKING_LOOKUP_FAILURE,
    });
  }
}
