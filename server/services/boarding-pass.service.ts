/**
 * Boarding Pass Service (cryptographically signed, offline-verifiable)
 *
 * AIS already renders a boarding-pass PDF/QR, but the barcode payload is plain
 * text (PNR|ticket|name) — forgeable and not verifiable. This service issues a
 * SIGNED boarding-pass token (JWT, HS256) that a gate scanner can verify
 * OFFLINE (pure crypto, no DB round-trip) and that cannot be tampered with.
 *
 * Inspired by the Lufthansa-style BoardingPassService pattern, implemented
 * natively on AIS's existing tables (bookings, passengers, flights).
 *
 * Security model:
 *  - Signed with a dedicated BOARDING_PASS_SECRET (falls back to JWT_SECRET).
 *  - issuer/audience pinned so a boarding token can't be confused with an auth
 *    token, and vice-versa.
 *  - Short-lived (default 48h) so a leaked pass can't be replayed indefinitely.
 */

import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { bookings, passengers, flights } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { assertBookingOwnership } from "./access-control.service";

export const BOARDING_PASS_ISSUER = "ais-boarding";
export const BOARDING_PASS_AUDIENCE = "ais-gate";
const DEFAULT_EXPIRY_SECONDS = 48 * 60 * 60; // 48h

function getSecret(override?: string): string {
  const secret =
    override ||
    process.env.BOARDING_PASS_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "dev-insecure-boarding-pass-secret");
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "BOARDING_PASS_SECRET (or JWT_SECRET) is required",
    });
  }
  return secret;
}

export interface BoardingPassPayload {
  bookingId: number;
  bookingReference: string;
  passengerId: number;
  passengerName: string;
  flightNumber: string;
  originId: number;
  destinationId: number;
  departureTime: string; // ISO
  seatNumber: string | null;
  cabinClass: string | null;
  sequence: number | null;
}

export type VerifyResult =
  | { valid: true; data: BoardingPassPayload }
  | { valid: false; reason: string };

// ---------------------------------------------------------------------------
// Pure crypto core (unit-testable without a database)
// ---------------------------------------------------------------------------

/** Sign a boarding-pass payload into a tamper-proof token. */
export function signBoardingPass(
  payload: BoardingPassPayload,
  opts: { secret?: string; expiresInSeconds?: number } = {}
): string {
  return jwt.sign(payload, getSecret(opts.secret), {
    issuer: BOARDING_PASS_ISSUER,
    audience: BOARDING_PASS_AUDIENCE,
    expiresIn: opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
  });
}

/**
 * Verify a boarding-pass token. Pure crypto — safe to run offline at the gate.
 * Never throws; returns a discriminated result so callers branch cleanly.
 */
export function verifyBoardingPass(
  token: string,
  opts: { secret?: string } = {}
): VerifyResult {
  try {
    const decoded = jwt.verify(token, getSecret(opts.secret), {
      issuer: BOARDING_PASS_ISSUER,
      audience: BOARDING_PASS_AUDIENCE,
    }) as jwt.JwtPayload & BoardingPassPayload;

    return {
      valid: true,
      data: {
        bookingId: decoded.bookingId,
        bookingReference: decoded.bookingReference,
        passengerId: decoded.passengerId,
        passengerName: decoded.passengerName,
        flightNumber: decoded.flightNumber,
        originId: decoded.originId,
        destinationId: decoded.destinationId,
        departureTime: decoded.departureTime,
        seatNumber: decoded.seatNumber ?? null,
        cabinClass: decoded.cabinClass ?? null,
        sequence: decoded.sequence ?? null,
      },
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, reason: "Boarding pass expired" };
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return { valid: false, reason: "Invalid or tampered boarding pass" };
    }
    return { valid: false, reason: "Boarding pass verification failed" };
  }
}

// ---------------------------------------------------------------------------
// DB-backed issuance
// ---------------------------------------------------------------------------

/**
 * Issue a signed boarding pass for a passenger on a booking. Enforces that the
 * caller owns the booking and that the passenger actually belongs to it.
 */
export async function issueBoardingPass(
  input: { bookingId: number; passengerId: number },
  ctx: { userId: number; role?: string },
  opts: { expiresInSeconds?: number } = {}
): Promise<{ token: string; payload: BoardingPassPayload }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Ownership: caller must own the booking (admins bypass).
  await assertBookingOwnership(input.bookingId, ctx.userId, ctx.role);

  const [booking] = await db
    .select({
      bookingReference: bookings.bookingReference,
      flightId: bookings.flightId,
      cabinClass: bookings.cabinClass,
      paymentStatus: bookings.paymentStatus,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }
  if (booking.paymentStatus !== "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Boarding pass can only be issued for a paid booking",
    });
  }

  const [passenger] = await db
    .select({
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      seatNumber: passengers.seatNumber,
      bookingId: passengers.bookingId,
    })
    .from(passengers)
    .where(
      and(
        eq(passengers.id, input.passengerId),
        eq(passengers.bookingId, input.bookingId)
      )
    )
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found on this booking",
    });
  }

  const [flight] = await db
    .select({
      flightNumber: flights.flightNumber,
      originId: flights.originId,
      destinationId: flights.destinationId,
      departureTime: flights.departureTime,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  const payload: BoardingPassPayload = {
    bookingId: input.bookingId,
    bookingReference: booking.bookingReference,
    passengerId: input.passengerId,
    passengerName: `${passenger.firstName} ${passenger.lastName}`.trim(),
    flightNumber: flight.flightNumber,
    originId: flight.originId,
    destinationId: flight.destinationId,
    departureTime: flight.departureTime.toISOString(),
    seatNumber: passenger.seatNumber ?? null,
    cabinClass: booking.cabinClass ?? null,
    sequence: null,
  };

  const token = signBoardingPass(payload, {
    expiresInSeconds: opts.expiresInSeconds,
  });

  return { token, payload };
}
