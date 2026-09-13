/** Signed AIS passes. Signature checks alone are NOT boarding authorization. */
import jwt from "jsonwebtoken";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { passengers, seatInventory } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { assertBookingOwnership } from "./access-control.service";
import {
  assertDepartureOpen,
  lockDepartureContext,
} from "./departure-control.service";
import {
  assertTravelClearance,
  documentContext,
} from "./travel-clearance.service";
import type { SettlementTx } from "./booking-settlement.service";

export const BOARDING_PASS_ISSUER = "ais-boarding";
export const BOARDING_PASS_AUDIENCE = "ais-gate";
const DEFAULT_EXPIRY_SECONDS = 48 * 60 * 60;
export const boardingPassPayloadSchema = z.object({
  bookingId: z.number().int().positive(),
  bookingReference: z.string(),
  passengerId: z.number().int().positive(),
  passengerName: z.string(),
  flightId: z.number().int().positive(),
  flightNumber: z.string(),
  originId: z.number().int().positive(),
  destinationId: z.number().int().positive(),
  departureTime: z.iso.datetime(),
  seatNumber: z.string().min(1),
  cabinClass: z.string(),
  sequence: z.number().int().positive(),
  checkInNonce: z.uuid(),
  documentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  itineraryDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type BoardingPassPayload = z.infer<typeof boardingPassPayloadSchema>;
export type VerifyResult =
  | { valid: true; data: BoardingPassPayload }
  | { valid: false; reason: string };
function getSecret(override?: string): string {
  const secret =
    override ||
    process.env.BOARDING_PASS_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "dev-insecure-boarding-pass-secret");
  if (!secret)
    throw new Error("BOARDING_PASS_SECRET (or JWT_SECRET) is required");
  return secret;
}
export function signBoardingPass(
  payload: BoardingPassPayload,
  opts: { secret?: string; expiresInSeconds?: number } = {}
): string {
  return jwt.sign(
    boardingPassPayloadSchema.parse(payload),
    getSecret(opts.secret),
    {
      algorithm: "HS256",
      issuer: BOARDING_PASS_ISSUER,
      audience: BOARDING_PASS_AUDIENCE,
      expiresIn: opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
    }
  );
}
/** Cryptographic integrity only. Admission callers must use verifyActiveBoardingPass. */
export function verifyBoardingPass(
  token: string,
  opts: { secret?: string } = {}
): VerifyResult {
  try {
    const decoded = jwt.verify(token, getSecret(opts.secret), {
      algorithms: ["HS256"],
      issuer: BOARDING_PASS_ISSUER,
      audience: BOARDING_PASS_AUDIENCE,
    });
    return { valid: true, data: boardingPassPayloadSchema.parse(decoded) };
  } catch (error) {
    return {
      valid: false,
      reason:
        error instanceof jwt.TokenExpiredError
          ? "Boarding pass expired"
          : "Invalid or tampered boarding pass",
    };
  }
}
async function activePayload(
  tx: SettlementTx,
  input: { bookingId: number; passengerId: number; flightId?: number }
) {
  const c = await lockDepartureContext(tx, input.bookingId, input.flightId);
  assertDepartureOpen(c, "boarding");
  const [p] = await tx
    .select()
    .from(passengers)
    .where(
      and(
        eq(passengers.id, input.passengerId),
        eq(passengers.bookingId, input.bookingId)
      )
    )
    .for("update");
  if (!p) throw new Error("Passenger not found on this booking");
  await assertTravelClearance(tx, input.bookingId, input.passengerId);
  const docs = await documentContext(tx, input.bookingId, input.passengerId);
  const [seat] = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, c.flight.id),
        eq(seatInventory.bookingId, input.bookingId),
        eq(seatInventory.passengerId, input.passengerId),
        eq(seatInventory.status, "checked_in")
      )
    )
    .for("update");
  if (
    !seat?.checkInNonce ||
    !seat.checkedInAt ||
    !seat.boardingSequence ||
    seat.cabinClass !== c.booking.cabinClass
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Passenger must have a current checked-in seat on this flight",
    });
  const payload: BoardingPassPayload = {
    bookingId: input.bookingId,
    bookingReference: c.booking.bookingReference,
    passengerId: p.id,
    passengerName: `${p.firstName} ${p.lastName}`.trim(),
    flightId: c.flight.id,
    flightNumber: c.flight.flightNumber,
    originId: c.flight.originId,
    destinationId: c.flight.destinationId,
    departureTime: c.flight.departureTime.toISOString(),
    seatNumber: seat.seatNumber,
    cabinClass: seat.cabinClass,
    sequence: seat.boardingSequence,
    checkInNonce: seat.checkInNonce,
    documentDigest: docs.documentDigest,
    itineraryDigest: docs.itineraryDigest,
  };
  return { payload, seat };
}
export async function issueBoardingPass(
  input: { bookingId: number; passengerId: number; flightId?: number },
  ctx: { userId: number; role?: string },
  opts: { expiresInSeconds?: number } = {}
): Promise<{ token: string; payload: BoardingPassPayload }> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  await assertBookingOwnership(input.bookingId, ctx.userId, ctx.role);
  return db.transaction(async tx => {
    const { payload, seat } = await activePayload(tx, input);
    const secondsToDeparture = Math.floor(
      (Date.parse(payload.departureTime) - Date.now()) / 1000
    );
    const token = signBoardingPass(payload, {
      expiresInSeconds: Math.min(
        opts.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
        DEFAULT_EXPIRY_SECONDS,
        secondsToDeparture
      ),
    });
    await tx
      .update(seatInventory)
      .set({ boardingPassIssued: true })
      .where(eq(seatInventory.id, seat.id));
    return { token, payload };
  });
}
/** Current eligibility, revocation, documents and itinerary are checked online. */
export async function verifyActiveBoardingPass(
  token: string
): Promise<VerifyResult> {
  const signed = verifyBoardingPass(token);
  if (!signed.valid) return signed;
  const db = getDb();
  if (!db) return { valid: false, reason: "Boarding verification unavailable" };
  try {
    return await db.transaction(async tx => {
      const { payload, seat } = await activePayload(tx, signed.data);
      if (
        !seat.boardingPassIssued ||
        JSON.stringify(payload) !== JSON.stringify(signed.data)
      )
        return {
          valid: false as const,
          reason: "Boarding pass revoked or itinerary changed",
        };
      return { valid: true as const, data: payload };
    });
  } catch {
    return {
      valid: false,
      reason: "Current passenger or flight eligibility could not be confirmed",
    };
  }
}
