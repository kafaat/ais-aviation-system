/**
 * Signed AIS passes. Signature checks alone are NOT boarding authorization.
 * Each issued pass carries two barcodes: an IATA Resolution 792 BCBP (M1)
 * string for airport PDF417 readers, whose security data is an HMAC over the
 * barcode and the pass digest, and the signed JWT (QR) as a second layer.
 */
import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "node:crypto";
import { calculateRequestHash } from "./idempotency-v2.service";
import { z } from "zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  airlines,
  airports,
  bookings,
  bookingSegments,
  flights,
  passengers,
  seatInventory,
} from "../../drizzle/schema";
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
import { assertDcsPassengerCanBoard } from "./dcs-state.service";
import {
  appendBcbpSecurityData,
  BCBP_SECURITY_DATA_TYPE,
  bcbpJulianDate,
  bcbpMandatoryItems,
  BcbpFormatError,
  decodeBcbpM1,
  encodeBcbpM1,
  formatBcbpFlightNumber,
  isBcbpBarcode,
  type BcbpM1Fields,
  type BcbpSource,
} from "./bcbp.service";

export const BOARDING_PASS_ISSUER = "ais-boarding";
export const BOARDING_PASS_AUDIENCE = "ais-gate";
const DEFAULT_EXPIRY_SECONDS = 48 * 60 * 60;
export type BoardingPassFormat = "jwt" | "bcbp";
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
  | {
      valid: true;
      data: BoardingPassPayload;
      expiresAt: number;
      format: BoardingPassFormat;
    }
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
    if (typeof decoded === "string" || !Number.isSafeInteger(decoded.exp))
      return { valid: false, reason: "Boarding pass expiry is required" };
    return {
      valid: true,
      data: boardingPassPayloadSchema.parse(decoded),
      expiresAt: Number(decoded.exp),
      format: "jwt",
    };
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
  await assertDcsPassengerCanBoard(tx, {
    bookingId: input.bookingId,
    passengerId: input.passengerId,
    flightId: c.flight.id,
  });
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
  return { payload, seat, context: c, passenger: p };
}
// Other departure documents use the same current passenger/sector eligibility.
export { activePayload as getCheckedInPassengerContext };

type Flight = typeof flights.$inferSelect;
/** Carrier designator, airport codes and departure zone for the BCBP leg. */
async function bcbpReference(tx: SettlementTx, flight: Flight) {
  const [airline] = await tx
    .select()
    .from(airlines)
    .where(eq(airlines.id, flight.airlineId));
  const [origin] = await tx
    .select()
    .from(airports)
    .where(eq(airports.id, flight.originId));
  const [destination] = await tx
    .select()
    .from(airports)
    .where(eq(airports.id, flight.destinationId));
  if (!airline || !origin || !destination)
    throw new Error("Flight reference data is incomplete");
  return {
    carrier: airline.code,
    departureAirport: origin.code,
    arrivalAirport: destination.code,
    departureTimeZone: origin.timezone,
    flightNumber: flight.flightNumber,
    departureTime: flight.departureTime,
  };
}
async function bcbpFields(
  tx: SettlementTx,
  active: Awaited<ReturnType<typeof activePayload>>,
  source: BcbpSource
): Promise<BcbpM1Fields> {
  const { passenger: p, seat, context: c } = active;
  return {
    ...(await bcbpReference(tx, c.flight)),
    lastName: p.lastName,
    firstName: p.firstName,
    pnr: c.booking.pnr,
    cabinClass: seat.cabinClass,
    seatNumber: seat.seatNumber,
    sequence: seat.boardingSequence ?? 0,
    passengerType: p.type,
    ticketNumber: p.ticketNumber,
    source,
  };
}
/**
 * BCBP security data (type 1): HMAC-SHA256 over the barcode up to the security
 * section and the current pass digest, so the airport-readable items are bound
 * to the same server state the JWT layer is bound to.
 */
export function bcbpSecurityData(
  base: string,
  passDigest: string,
  opts: { secret?: string } = {}
): string {
  return createHmac("sha256", getSecret(opts.secret))
    .update(`${base}\n${passDigest}`)
    .digest("hex");
}
export async function issueBoardingPass(
  input: { bookingId: number; passengerId: number; flightId?: number },
  ctx: { userId: number; role?: string },
  opts: { expiresInSeconds?: number; source?: BcbpSource } = {}
): Promise<{ token: string; payload: BoardingPassPayload; bcbp: string }> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  await assertBookingOwnership(input.bookingId, ctx.userId, ctx.role);
  return db.transaction(async tx => {
    const active = await activePayload(tx, input);
    const { payload, seat } = active;
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
    const fields = await bcbpFields(tx, active, opts.source ?? "W");
    let base: string;
    try {
      base = encodeBcbpM1(fields);
    } catch (error) {
      if (!(error instanceof BcbpFormatError)) throw error;
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: error.message,
      });
    }
    const bcbp = appendBcbpSecurityData(
      base,
      bcbpSecurityData(base, boardingPassDigest(payload))
    );
    await tx
      .update(seatInventory)
      .set({ boardingPassIssued: true })
      .where(eq(seatInventory.id, seat.id));
    return { token, payload, bcbp };
  });
}
/** Bind a short-lived admission to the current pass without copying the bearer token. */
export function boardingPassDigest(payload: BoardingPassPayload): string {
  return calculateRequestHash(boardingPassPayloadSchema.parse(payload));
}
export async function assertCurrentPassDigest(
  tx: SettlementTx,
  scope: {
    bookingId: number;
    passengerId: number;
    flightId: number;
    passDigest: string;
  }
) {
  const { payload, seat } = await activePayload(tx, scope);
  if (
    !seat.boardingPassIssued ||
    boardingPassDigest(payload) !== scope.passDigest
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Boarding pass revoked or itinerary changed",
    });
  return payload;
}

/** Manual desk boarding still rechecks funding, clearance, seat and nonce. */
export function assertDcsBoardingEligibility(
  tx: SettlementTx,
  scope: { bookingId: number; passengerId: number; flightId: number }
) {
  return activePayload(tx, scope);
}

/** Bind a scan to the selected manifest row inside the boarding transaction. */
export async function assertScopedBoardingPass(
  tx: SettlementTx,
  scope: { bookingId: number; passengerId: number; flightId: number },
  token: string
): Promise<BoardingPassFormat> {
  if (!isBcbpBarcode(token)) {
    const signed = verifyBoardingPass(token);
    if (
      !signed.valid ||
      signed.data.bookingId !== scope.bookingId ||
      signed.data.passengerId !== scope.passengerId ||
      signed.data.flightId !== scope.flightId
    )
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Boarding pass does not match this passenger and flight",
      });
    await assertCurrentPassDigest(tx, {
      ...scope,
      passDigest: boardingPassDigest(signed.data),
    });
    return "jwt";
  }
  let scan: ReturnType<typeof decodeBcbpM1>;
  try {
    scan = decodeBcbpM1(token);
  } catch {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unreadable boarding pass barcode",
    });
  }
  const active = await activePayload(tx, scope);
  const expected = bcbpMandatoryItems(await bcbpFields(tx, active, "W"));
  const signature = Buffer.from(
    bcbpSecurityData(scan.base, boardingPassDigest(active.payload))
  );
  const presented = Buffer.from(scan.securityData ?? "");
  if (
    scan.securityDataType !== BCBP_SECURITY_DATA_TYPE ||
    !active.seat.boardingPassIssued ||
    expected !== scan.mandatory ||
    signature.length !== presented.length ||
    !timingSafeEqual(signature, presented)
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Boarding pass revoked, altered or bound to another passenger",
    });
  return "bcbp";
}
function failureReason(error: unknown): string {
  return error instanceof TRPCError && error.code === "UNAUTHORIZED"
    ? error.message
    : "Current passenger or flight eligibility could not be confirmed";
}
const unauthorized = (message: string) =>
  new TRPCError({ code: "UNAUTHORIZED", message });
/**
 * A scanned BCBP is matched to the stored pass by PNR, operating carrier,
 * flight number, Julian date, airports and check-in sequence; the mandatory
 * items must re-encode identically from current state and the security data
 * must be the HMAC over the scanned barcode and the current pass digest.
 */
async function verifyActiveBcbp(barcode: string): Promise<VerifyResult> {
  let scan: ReturnType<typeof decodeBcbpM1>;
  try {
    scan = decodeBcbpM1(barcode);
  } catch (error) {
    return {
      valid: false,
      reason:
        error instanceof BcbpFormatError
          ? `Unreadable boarding pass barcode: ${error.message}`
          : "Unreadable boarding pass barcode",
    };
  }
  if (
    scan.securityDataType !== BCBP_SECURITY_DATA_TYPE ||
    !/^[a-f0-9]{64}$/.test(scan.securityData ?? "")
  )
    return { valid: false, reason: "Boarding pass security data is missing" };
  const db = getDb();
  if (!db) return { valid: false, reason: "Boarding verification unavailable" };
  try {
    return await db.transaction(async tx => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.pnr, scan.pnr), isNull(bookings.deletedAt)))
        .for("update");
      if (!booking)
        throw unauthorized(
          "Boarding pass does not match an active reservation"
        );
      const legs = await tx
        .select()
        .from(bookingSegments)
        .where(eq(bookingSegments.bookingId, booking.id))
        .orderBy(asc(bookingSegments.segmentOrder));
      const ids = legs.length
        ? legs
            .filter(l => l.status === "confirmed" || l.status === "pending")
            .map(l => l.flightId)
        : [booking.flightId];
      const itinerary = ids.length
        ? await tx.select().from(flights).where(inArray(flights.id, ids))
        : [];
      let flightId: number | undefined;
      for (const flight of itinerary) {
        const ref = await bcbpReference(tx, flight);
        if (
          ref.carrier.toUpperCase() === scan.carrier &&
          ref.departureAirport.toUpperCase() === scan.departureAirport &&
          ref.arrivalAirport.toUpperCase() === scan.arrivalAirport &&
          formatBcbpFlightNumber(ref.flightNumber, ref.carrier) ===
            scan.flightNumber &&
          bcbpJulianDate(ref.departureTime, ref.departureTimeZone) ===
            scan.julianDate
        ) {
          flightId = flight.id;
          break;
        }
      }
      if (!flightId)
        throw unauthorized("Boarding pass does not match a flight on this PNR");
      const [seat] = await tx
        .select()
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.flightId, flightId),
            eq(seatInventory.bookingId, booking.id),
            eq(seatInventory.status, "checked_in"),
            eq(seatInventory.boardingSequence, scan.sequence)
          )
        );
      if (!seat?.passengerId)
        throw unauthorized("Boarding pass sequence is not checked in");
      const active = await activePayload(tx, {
        bookingId: booking.id,
        passengerId: seat.passengerId,
        flightId,
      });
      const expected = bcbpMandatoryItems(await bcbpFields(tx, active, "W"));
      const signature = Buffer.from(
        bcbpSecurityData(scan.base, boardingPassDigest(active.payload))
      );
      const presented = Buffer.from(scan.securityData ?? "");
      if (
        !active.seat.boardingPassIssued ||
        expected !== scan.mandatory ||
        signature.length !== presented.length ||
        !timingSafeEqual(signature, presented)
      )
        throw unauthorized(
          "Boarding pass revoked, altered or itinerary changed"
        );
      const departure = Math.floor(
        Date.parse(active.payload.departureTime) / 1000
      );
      return {
        valid: true as const,
        data: active.payload,
        expiresAt: Math.min(
          departure,
          Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS
        ),
        format: "bcbp" as const,
      };
    });
  } catch (error) {
    return { valid: false, reason: failureReason(error) };
  }
}
/**
 * Current eligibility, revocation, documents and itinerary are checked online.
 * Accepts the signed JWT (QR layer) or a scanned IATA BCBP M1 string.
 */
export async function verifyActiveBoardingPass(
  token: string
): Promise<VerifyResult> {
  if (isBcbpBarcode(token)) return verifyActiveBcbp(token);
  const signed = verifyBoardingPass(token);
  if (!signed.valid) return signed;
  const db = getDb();
  if (!db) return { valid: false, reason: "Boarding verification unavailable" };
  try {
    return await db.transaction(async tx => {
      const payload = await assertCurrentPassDigest(tx, {
        ...signed.data,
        passDigest: boardingPassDigest(signed.data),
      });
      return {
        valid: true as const,
        data: payload,
        expiresAt: signed.expiresAt,
        format: "jwt" as const,
      };
    });
  } catch (error) {
    return { valid: false, reason: failureReason(error) };
  }
}
