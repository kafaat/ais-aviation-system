/**
 * IATA Bar Coded Boarding Pass (Resolution 792) "M1" encoding and decoding.
 *
 * Format-level only: field mapping, lengths, character set, Julian flight date
 * in the departure airport's civil day, and the security section layout. The
 * HMAC that fills the security data, and the online eligibility checks, live
 * in boarding-pass.service. Airport reader acceptance is an external step.
 */
import { decode, encode } from "bcbp";

export const BCBP_VERSION = 6;
export const BCBP_SECURITY_DATA_TYPE = "1";
/** Mandatory items M..passenger status occupy exactly 58 characters for one leg. */
export const BCBP_MANDATORY_LENGTH = 58;
const SECURITY_DATA_MAX = 100;
const ASCII_PRINTABLE = /^[\x20-\x7E]*$/;

export type BcbpCabinClass =
  | "economy"
  | "business"
  | "premium_economy"
  | "first";
export type BcbpPassengerType = "adult" | "child" | "infant";
/** W web, K kiosk, M mobile, O airline agent; per BCBP Implementation Guide. */
export type BcbpSource = "W" | "K" | "M" | "O";

export interface BcbpM1Fields {
  lastName: string;
  firstName: string;
  pnr: string;
  departureAirport: string;
  arrivalAirport: string;
  carrier: string;
  /** Airline flight number as stored, with or without the carrier prefix. */
  flightNumber: string;
  departureTime: Date;
  /** IANA zone of the departure airport, required for issuance and scanning. */
  departureTimeZone: string | null;
  cabinClass: string;
  seatNumber: string;
  sequence: number;
  passengerType?: BcbpPassengerType;
  ticketNumber?: string | null;
  issuedAt?: Date;
  source?: BcbpSource;
}

export interface DecodedBcbpM1 {
  passengerName: string;
  pnr: string;
  departureAirport: string;
  arrivalAirport: string;
  carrier: string;
  /** Four digit number plus optional suffix, e.g. "0123" or "0123A". */
  flightNumber: string;
  julianDate: string;
  compartmentCode: string;
  seatNumber: string;
  sequence: number;
  passengerStatus: string;
  version: number | undefined;
  /** Everything before the security section; the signed input. */
  base: string;
  mandatory: string;
  securityDataType: string | undefined;
  securityData: string | undefined;
}

export class BcbpFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BcbpFormatError";
  }
}

function latinName(value: string, field: "surname" | "given name"): string {
  if (field === "given name" && value === "") return "";
  const name = value
    .normalize("NFD")
    .replace(/([A-Za-z])[\u0300-\u036f]+/g, "$1")
    .replace(/['’.\-]/g, "")
    .replace(/ +/g, " ")
    .trim();
  if (!/^[A-Za-z ]+$/.test(name)) {
    throw new BcbpFormatError(
      `A document-matching Latin ${field} is required for the boarding pass`
    );
  }
  return name.toUpperCase();
}

/** SURNAME/GIVEN, Latin capitals only, given names truncated first, max 20. */
export function formatBcbpName(lastName: string, firstName: string): string {
  const surname = latinName(lastName, "surname");
  const given = latinName(firstName, "given name");
  if (!given) return surname.slice(0, 20);
  const head = surname.slice(0, 18);
  return `${head}/${given}`.slice(0, 20);
}

export function compartmentCode(cabinClass: string): string {
  switch (cabinClass) {
    case "first":
      return "F";
    case "business":
      return "J";
    case "premium_economy":
      return "W";
    case "economy":
      return "Y";
    default:
      throw new BcbpFormatError(`Cabin class ${cabinClass} has no compartment`);
  }
}

export function passengerDescription(type: BcbpPassengerType = "adult") {
  return type === "infant" ? "4" : type === "child" ? "3" : "0";
}

/** "12A" -> "012A"; non-numeric seats (e.g. INF) are kept upper case. */
export function formatBcbpSeat(seatNumber: string): string {
  const seat = seatNumber.trim().toUpperCase();
  const m = seat.match(/^(\d{1,3})([A-Z])$/);
  if (m) return `${m[1].padStart(3, "0")}${m[2]}`;
  if (!/^[A-Z0-9]{1,4}$/.test(seat))
    throw new BcbpFormatError(`Seat ${seatNumber} is not BCBP-encodable`);
  return seat;
}

/** "012A" -> "12A" for comparison with stored seat numbers. */
export function normalizeBcbpSeat(seat: string): string {
  const m = seat
    .trim()
    .toUpperCase()
    .match(/^(\d{1,3})([A-Z])$/);
  return m ? `${String(parseInt(m[1], 10))}${m[2]}` : seat.trim().toUpperCase();
}

export function formatBcbpSequence(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999)
    throw new BcbpFormatError("Check-in sequence must be 1..9999");
  return String(sequence).padStart(4, "0");
}

/** Strip the carrier prefix and zero-pad the numeric part to four digits. */
export function formatBcbpFlightNumber(
  flightNumber: string,
  carrier: string
): string {
  let rest = flightNumber.trim().toUpperCase();
  const code = carrier.trim().toUpperCase();
  if (code && rest.startsWith(code)) rest = rest.slice(code.length);
  else rest = rest.replace(/^[A-Z]{2}(?=\s*-?\s*\d)/, "");
  const m = rest.match(/^\s*-?\s*(\d{1,4})\s*([A-Z])?\s*$/);
  if (!m)
    throw new BcbpFormatError(
      `Flight number ${flightNumber} is not BCBP-encodable`
    );
  return `${m[1].padStart(4, "0")}${m[2] ?? ""}`;
}

function requireCode(value: string, pattern: RegExp, label: string): string {
  const code = value.trim().toUpperCase();
  if (!pattern.test(code))
    throw new BcbpFormatError(`${label} ${value} is not BCBP-encodable`);
  return code;
}

/**
 * Civil date of `instant` in the airport's zone, as a UTC-midnight Date (the
 * representation the bcbp library turns into a day-of-year).
 */
export function civilFlightDate(
  instant: Date,
  timeZone: string | null | undefined
): Date {
  if (!timeZone || /^[+-]/.test(timeZone)) {
    throw new BcbpFormatError("A departure airport time zone is required");
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) =>
      Number(parts.find(p => p.type === type)?.value);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BcbpFormatError("Invalid airport time zone or flight date");
  }
}

/** Three digit day of year (001..366) of a UTC-midnight civil date. */
export function julianDay(civilDate: Date): string {
  const start = Date.UTC(civilDate.getUTCFullYear(), 0, 0);
  const day = Math.round((civilDate.getTime() - start) / 86400000);
  return String(day).padStart(3, "0");
}

export function bcbpJulianDate(
  departureTime: Date,
  timeZone: string | null | undefined
): string {
  return julianDay(civilFlightDate(departureTime, timeZone));
}

function legFor(fields: BcbpM1Fields) {
  const carrier = requireCode(fields.carrier, /^[A-Z0-9]{2,3}$/, "Carrier");
  return {
    passengerName: formatBcbpName(fields.lastName, fields.firstName),
    leg: {
      operatingCarrierPNR: requireCode(fields.pnr, /^[A-Z0-9]{1,7}$/, "PNR"),
      departureAirport: requireCode(
        fields.departureAirport,
        /^[A-Z]{3}$/,
        "Departure airport"
      ),
      arrivalAirport: requireCode(
        fields.arrivalAirport,
        /^[A-Z]{3}$/,
        "Arrival airport"
      ),
      operatingCarrierDesignator: carrier,
      flightNumber: formatBcbpFlightNumber(fields.flightNumber, carrier),
      flightDate: civilFlightDate(
        fields.departureTime,
        fields.departureTimeZone
      ),
      compartmentCode: compartmentCode(fields.cabinClass),
      seatNumber: formatBcbpSeat(fields.seatNumber),
      checkInSequenceNumber: formatBcbpSequence(fields.sequence),
      passengerStatus: "1",
    },
    carrier,
  };
}

/** The 58 mandatory characters for the leg; used to compare a scan with state. */
export function bcbpMandatoryItems(fields: BcbpM1Fields): string {
  const { passengerName, leg } = legFor(fields);
  return encode({ data: { passengerName, legs: [leg] } }).slice(
    0,
    BCBP_MANDATORY_LENGTH
  );
}

/**
 * M1 string with version 6 conditional items and no security section.
 * Conditional items: passenger description, check-in and issuance source,
 * issuance date (Julian with year digit), document type B, issuer designator,
 * and the airline numeric code / serial number when a 13-digit ticket exists.
 */
export function encodeBcbpM1(fields: BcbpM1Fields): string {
  const { passengerName, leg, carrier } = legFor(fields);
  const ticket = fields.ticketNumber?.trim();
  const issued = civilFlightDate(fields.issuedAt ?? new Date(), "UTC");
  const bcbp = encode({
    meta: { versionNumber: BCBP_VERSION },
    data: {
      passengerName,
      passengerDescription: passengerDescription(fields.passengerType),
      checkInSource: fields.source ?? "W",
      boardingPassIssuanceSource: fields.source ?? "W",
      issuanceDate: issued,
      documentType: "B",
      boardingPassIssuerDesignator: carrier,
      legs: [
        {
          ...leg,
          ...(ticket && /^\d{13}$/.test(ticket)
            ? {
                airlineNumericCode: ticket.slice(0, 3),
                serialNumber: ticket.slice(3),
              }
            : {}),
        },
      ],
    },
  });
  if (!ASCII_PRINTABLE.test(bcbp))
    throw new BcbpFormatError("BCBP contains non-printable characters");
  return bcbp;
}

/** Append the security section: ^, type, two hex length digits, data. */
export function appendBcbpSecurityData(
  base: string,
  securityData: string,
  type: string = BCBP_SECURITY_DATA_TYPE
): string {
  if (
    securityData.length < 1 ||
    securityData.length > SECURITY_DATA_MAX ||
    !ASCII_PRINTABLE.test(securityData) ||
    type.length !== 1
  )
    throw new BcbpFormatError("Security data must be 1..100 printable chars");
  const size = securityData.length.toString(16).toUpperCase().padStart(2, "0");
  return `${base}^${type}${size}${securityData}`;
}

export function isBcbpBarcode(value: string): boolean {
  return /^M[1-4][\x20-\x7E]{58,}$/.test(value);
}

/** Parse and structurally validate a single-leg scan; throws BcbpFormatError. */
export function decodeBcbpM1(barcode: string): DecodedBcbpM1 {
  if (!ASCII_PRINTABLE.test(barcode))
    throw new BcbpFormatError("BCBP contains non-printable characters");
  if (barcode.length < BCBP_MANDATORY_LENGTH + 2 || barcode[0] !== "M")
    throw new BcbpFormatError("Not an IATA BCBP M-format barcode");
  if (barcode[1] !== "1")
    throw new BcbpFormatError(
      "Only single-leg (M1) boarding passes are accepted"
    );
  const conditionalSize = parseInt(barcode.slice(58, 60), 16);
  if (Number.isNaN(conditionalSize))
    throw new BcbpFormatError("Conditional item size is not hexadecimal");
  const baseLength = 60 + conditionalSize;
  if (barcode.length < baseLength)
    throw new BcbpFormatError("Conditional items are truncated");
  const base = barcode.slice(0, baseLength);
  const parsed = decode(barcode);
  const leg = parsed.data?.legs?.[0];
  if (!leg || parsed.meta?.electronicTicketIndicator !== "E")
    throw new BcbpFormatError("Electronic ticket indicator must be E");
  const need = (value: string | undefined, key: string): string => {
    if (!value) throw new BcbpFormatError(`Mandatory item ${key} is blank`);
    return value;
  };
  const julianDate = barcode.slice(44, 47);
  const sequenceText = (leg.checkInSequenceNumber ?? "").trim();
  if (!/^\d{3}$/.test(julianDate) || !/^\d{1,4}$/.test(sequenceText))
    throw new BcbpFormatError("Flight date or sequence is not numeric");
  let securityDataType: string | undefined;
  let securityData: string | undefined;
  const rest = barcode.slice(baseLength);
  if (rest.length) {
    if (rest[0] !== "^" || rest.length < 4)
      throw new BcbpFormatError("Malformed security section");
    const size = parseInt(rest.slice(2, 4), 16);
    if (Number.isNaN(size) || rest.length < 4 + size)
      throw new BcbpFormatError("Security data is truncated");
    securityDataType = rest[1];
    securityData = rest.slice(4, 4 + size).trimEnd();
  }
  return {
    passengerName: need(parsed.data?.passengerName, "passenger name"),
    pnr: need(leg.operatingCarrierPNR, "PNR"),
    departureAirport: need(leg.departureAirport, "departure airport"),
    arrivalAirport: need(leg.arrivalAirport, "arrival airport"),
    carrier: need(leg.operatingCarrierDesignator, "carrier"),
    flightNumber: need(leg.flightNumber, "flight number"),
    julianDate,
    compartmentCode: need(leg.compartmentCode, "compartment"),
    seatNumber: need(leg.seatNumber, "seat"),
    sequence: parseInt(sequenceText, 10),
    passengerStatus: need(leg.passengerStatus, "passenger status"),
    version: parsed.meta?.versionNumber,
    base,
    mandatory: barcode.slice(0, BCBP_MANDATORY_LENGTH),
    securityDataType,
    securityData,
  };
}
