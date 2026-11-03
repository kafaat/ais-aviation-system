/**
 * PNRGOV UN/EDIFACT draft builder.
 *
 * Target: IATA/WCO/ICAO "PNRGOV EDIFACT Implementation Guide" version 21.1
 * (the version the 2026-11 market-gap research cites). The guide PDF could not
 * be retrieved from this environment, so the segment layouts below follow
 * the published message structure (UNB/UNH/MSG/ORG/TVL/EQN, Group 1 SRC/RCI/
 * SSR/DAT/IFT/ADD, Group 2 TIF/SSR/TKT/MON/FOP, Group 5 TVL/RPI, UNT/UNZ) as
 * known from earlier guide versions and standard SSR free-text formats. Every
 * segment whose exact component order was not re-checked against 21.1 is
 * listed in `UNVERIFIED_SEGMENT_DETAILS` and must be confirmed against the
 * guide and the NPSC technical specification before acceptance testing.
 *
 * The builder is pure: it receives already-loaded booking data and returns
 * the message plus a statement of which groups were populated and which
 * cannot be from the data the system currently holds. Records that contain
 * non-UNOA characters are collected and reported per PNR/passenger, following
 * the PAXLST draft, rather than aborting silently.
 */
import { TRPCError } from "@trpc/server";
import {
  EdifactFieldError,
  ddmmmyy,
  edifactDate6,
  edifactTime,
  localCivil,
  segment,
  unoaElement,
} from "./edifact";

export const PNRGOV_DEFAULT_MESSAGE_VERSION = "21:1";

export type PnrgovDocumentType = "passport" | "national_id" | "visa";

export interface PnrgovDocument {
  documentType: PnrgovDocumentType;
  documentNumber: string;
  issuingCountry: string;
  nationality: string;
  /** Civil date (YYYY-MM-DD) or Date. */
  dateOfBirth: string | Date | null;
  gender: "M" | "F" | "U";
  expiryDate: string | Date | null;
  surname: string;
  givenNames: string;
  residenceCountry?: string | null;
  residenceAddress?: string | null;
  destinationAddress?: string | null;
  redressNumber?: string | null;
  knownTravelerNumber?: string | null;
}

export interface PnrgovPassenger {
  passengerId: number;
  surname: string;
  givenNames: string;
  type: "adult" | "child" | "infant";
  ticketNumber: string | null;
  seatNumber: string | null;
  checkedIn: boolean;
  document: PnrgovDocument | null;
}

export interface PnrgovLeg {
  flightNumber: string;
  carrierCode: string;
  origin: { code: string; timezone: string };
  destination: { code: string; timezone: string };
  departureTime: Date;
  arrivalTime: Date;
  /** Reservation booking designator when known (RBD letter). */
  bookingDesignator?: string | null;
  status: string;
}

export interface PnrgovPayment {
  method: string;
  status: string;
  amountMinor: number;
  currency: string;
}

export interface PnrgovBooking {
  recordLocator: string;
  createdAt: Date;
  updatedAt: Date;
  status: string;
  cabinClass: string;
  totalAmountMinor: number;
  currency: string;
  contactEmail: string | null;
  payments: PnrgovPayment[];
  passengers: PnrgovPassenger[];
  /** The full itinerary of the PNR, including legs other than the pushed flight. */
  legs: PnrgovLeg[];
}

export interface PnrgovInput {
  sender: { carrierCode: string; locationCode: string };
  /** UNB recipient identification, e.g. the authority code agreed with the NPSC. */
  recipient: string;
  interchangeControlReference: string;
  messageReference: string;
  messageVersion?: string;
  flight: PnrgovLeg;
  bookings: PnrgovBooking[];
  generatedAt: Date;
}

export interface PnrgovGroupReport {
  group: string;
  segments: string[];
  status: "populated" | "partial" | "unavailable";
  note: string;
}

export interface PnrgovDraft {
  message: string;
  segmentCount: number;
  pnrCount: number;
  passengerCount: number;
  documentedPassengerCount: number;
  groups: PnrgovGroupReport[];
  unverified: readonly string[];
}

/** Layout details not re-checked against guide 21.1 in this environment. */
export const UNVERIFIED_SEGMENT_DETAILS = [
  "UNB syntax identifier IATA:1 and recipient code format agreed with the authority",
  "UNH message version/release 21:1 accepted by the NPSC",
  "MSG function code 22 for scheduled pushes (ad hoc request/response codes not modelled)",
  "RCI composite order (carrier:record locator) and optional PNR timestamp components",
  "DAT qualifiers 700 (PNR creation) and 710 (last transaction)",
  "TIF passenger type codes A/C/I and traveller reference numbering",
  "SSR CTCE email encoding (// for @) and SSR DOCA residence/destination address free text",
  "TKT ticket document type code T and MON qualifier T for the total amount",
  "FOP form-of-payment codes (CC/CA/MS) without account identifiers",
  "RPI passenger count and status code HK at segment level",
] as const;

const PASSENGER_TYPE: Record<PnrgovPassenger["type"], string> = {
  adult: "A",
  child: "C",
  infant: "I",
};

const DOCUMENT_CODE: Record<PnrgovDocumentType, string> = {
  passport: "P",
  national_id: "I",
  visa: "V",
};

/** Form-of-payment codes carried in FOP; no account data is ever emitted. */
export function formOfPaymentCode(method: string): string {
  switch (method) {
    case "card":
    case "mada":
    case "apple_pay":
      return "CC";
    case "bank_transfer":
      return "CA";
    default:
      return "MS";
  }
}

class RecordError extends Error {
  constructor(
    readonly recordLocator: string,
    readonly passengerId: number | null,
    readonly field: string
  ) {
    super("PNRGOV record contains unsupported UNOA characters");
  }
}

function flightNumberDigits(flightNumber: string, carrier: string): string {
  const trimmed = flightNumber.toUpperCase().startsWith(carrier.toUpperCase())
    ? flightNumber.slice(carrier.length)
    : flightNumber;
  const digits = trimmed.replace(/^\s+/, "");
  if (!/^[0-9]{1,4}[A-Z]?$/.test(digits))
    throw new EdifactFieldError("flightNumber");
  return digits;
}

function tvl(leg: PnrgovLeg): string {
  const dep = localCivil(leg.departureTime, leg.origin.timezone);
  const arr = localCivil(leg.arrivalTime, leg.destination.timezone);
  return segment(
    "TVL",
    [dep.ddmmyy, dep.hhmm, arr.ddmmyy, arr.hhmm],
    unoaElement(leg.origin.code, "origin"),
    unoaElement(leg.destination.code, "destination"),
    unoaElement(leg.carrierCode, "carrier"),
    flightNumberDigits(leg.flightNumber, leg.carrierCode),
    leg.bookingDesignator
      ? unoaElement(leg.bookingDesignator, "bookingDesignator")
      : undefined
  );
}

function pnrTimestamp(date: Date): string[] {
  return [edifactDate6(date), edifactTime(date)];
}

function docsFreeText(doc: PnrgovDocument, carrier: string): string {
  const parts = [
    "",
    DOCUMENT_CODE[doc.documentType],
    unoaElement(doc.issuingCountry, "issuingCountry"),
    unoaElement(doc.documentNumber, "documentNumber"),
    unoaElement(doc.nationality, "nationality"),
    doc.dateOfBirth ? ddmmmyy(doc.dateOfBirth) : "",
    doc.gender,
    doc.expiryDate ? ddmmmyy(doc.expiryDate) : "",
    unoaElement(doc.surname, "surname"),
    unoaElement(doc.givenNames, "givenNames"),
  ];
  return segment(
    "SSR",
    "DOCS",
    "HK",
    "1",
    carrier,
    parts.join("/").replace(/\/+$/, "")
  );
}

function docaSegments(doc: PnrgovDocument, carrier: string): string[] {
  const out: string[] = [];
  if (doc.residenceCountry && doc.residenceAddress)
    out.push(
      segment(
        "SSR",
        "DOCA",
        "HK",
        "1",
        carrier,
        `/R/${unoaElement(doc.residenceCountry, "residenceCountry")}/${unoaElement(doc.residenceAddress, "residenceAddress")}`
      )
    );
  if (doc.destinationAddress)
    out.push(
      segment(
        "SSR",
        "DOCA",
        "HK",
        "1",
        carrier,
        `/D//${unoaElement(doc.destinationAddress, "destinationAddress")}`
      )
    );
  return out;
}

function amount(minor: number): string {
  return (minor / 100).toFixed(2);
}

function pnrGroup(
  booking: PnrgovBooking,
  carrier: string,
  report: Set<string>
): string[] {
  const lines: string[] = [];
  const locator = unoaElement(booking.recordLocator, "recordLocator");
  // Group 1: PNR level
  lines.push(segment("SRC"));
  lines.push(segment("RCI", [carrier, locator]));
  if (booking.contactEmail) {
    try {
      lines.push(
        segment(
          "SSR",
          "CTCE",
          "HK",
          "1",
          carrier,
          unoaElement(booking.contactEmail.replace("@", "//"), "contactEmail")
        )
      );
      report.add("ssr_ctce");
    } catch (error) {
      if (!(error instanceof EdifactFieldError)) throw error;
      // A contact address outside UNOA is omitted, not a reason to withhold
      // the PNR: the authority receives the passenger record without it.
    }
  }
  lines.push(segment("DAT", ["700", ...pnrTimestamp(booking.createdAt)]));
  lines.push(segment("DAT", ["710", ...pnrTimestamp(booking.updatedAt)]));

  // Group 2: passengers
  for (const [index, pax] of booking.passengers.entries()) {
    try {
      lines.push(
        segment("TIF", unoaElement(pax.surname, "surname"), [
          unoaElement(pax.givenNames, "givenNames"),
          PASSENGER_TYPE[pax.type],
          String(index + 1),
        ])
      );
      if (pax.document) {
        lines.push(docsFreeText(pax.document, carrier));
        report.add("ssr_docs");
        const doca = docaSegments(pax.document, carrier);
        if (doca.length) report.add("ssr_doca");
        lines.push(...doca);
      }
      if (pax.ticketNumber) {
        lines.push(
          segment("TKT", [unoaElement(pax.ticketNumber, "ticketNumber"), "T"])
        );
        report.add("tkt");
        if (booking.passengers.length === 1) {
          lines.push(
            segment("MON", [
              "T",
              amount(booking.totalAmountMinor),
              unoaElement(booking.currency, "currency"),
            ])
          );
          report.add("mon");
        }
      }
    } catch (error) {
      if (error instanceof EdifactFieldError)
        throw new RecordError(
          booking.recordLocator,
          pax.passengerId,
          error.field
        );
      throw error;
    }
  }
  const settled = booking.payments.filter(p => p.status === "completed");
  for (const payment of settled) {
    lines.push(segment("FOP", formOfPaymentCode(payment.method)));
    report.add("fop");
  }

  // Group 5: itinerary segments of this PNR
  for (const leg of booking.legs) {
    lines.push(tvl(leg));
    lines.push(segment("RPI", String(booking.passengers.length), "HK"));
    for (const pax of booking.passengers)
      if (pax.seatNumber) {
        lines.push(
          segment(
            "SSR",
            "SEAT",
            "HK",
            "1",
            carrier,
            unoaElement(pax.seatNumber, "seatNumber")
          )
        );
        report.add("ssr_seat");
      }
  }
  return lines;
}

export function generatePNRGOV(input: PnrgovInput): PnrgovDraft {
  const carrier = unoaElement(input.sender.carrierCode, "carrierCode");
  const version = (input.messageVersion ?? PNRGOV_DEFAULT_MESSAGE_VERSION)
    .split(":")
    .map(v => unoaElement(v, "messageVersion"));
  if (version.length !== 2) throw new EdifactFieldError("messageVersion");
  const lines: string[] = [];
  lines.push(
    segment(
      "UNB",
      ["IATA", "1"],
      carrier,
      unoaElement(input.recipient, "recipient"),
      [edifactDate6(input.generatedAt), edifactTime(input.generatedAt)],
      unoaElement(
        input.interchangeControlReference,
        "interchangeControlReference"
      )
    )
  );
  const messageRef = unoaElement(input.messageReference, "messageReference");
  lines.push(
    segment("UNH", messageRef, ["PNRGOV", version[0], version[1], "IA"])
  );
  lines.push(segment("MSG", [undefined, "22"]));
  lines.push(
    segment("ORG", [
      carrier,
      unoaElement(input.sender.locationCode, "locationCode"),
    ])
  );
  lines.push(tvl(input.flight));
  lines.push(segment("EQN", String(input.bookings.length)));

  const populated = new Set<string>();
  const rejected: RecordError[] = [];
  const body: string[] = [];
  for (const booking of input.bookings) {
    try {
      body.push(...pnrGroup(booking, carrier, populated));
    } catch (error) {
      if (error instanceof RecordError) rejected.push(error);
      else if (error instanceof EdifactFieldError)
        rejected.push(
          new RecordError(booking.recordLocator, null, error.field)
        );
      else throw error;
    }
  }
  if (rejected.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${rejected.length} PNR record(s) contain characters outside UNOA or unsupported values; transliterate before drafting: ${rejected
        .map(r =>
          r.passengerId === null
            ? `PNR ${r.recordLocator} (${r.field})`
            : `PNR ${r.recordLocator} passenger ${r.passengerId} (${r.field})`
        )
        .join(", ")}`,
    });
  lines.push(...body);
  lines.push(segment("UNT", String(lines.length), messageRef));
  lines.push(
    segment(
      "UNZ",
      "1",
      unoaElement(
        input.interchangeControlReference,
        "interchangeControlReference"
      )
    )
  );

  const passengers = input.bookings.flatMap(b => b.passengers);
  return {
    message: lines.join("\n"),
    segmentCount: lines.length,
    pnrCount: input.bookings.length,
    passengerCount: passengers.length,
    documentedPassengerCount: passengers.filter(p => p.document).length,
    groups: groupReport(populated, input.bookings),
    unverified: UNVERIFIED_SEGMENT_DETAILS,
  };
}

function groupReport(
  populated: Set<string>,
  bookings: PnrgovBooking[]
): PnrgovGroupReport[] {
  const multi = bookings.some(b => b.passengers.length > 1);
  return [
    {
      group: "Header",
      segments: ["UNB", "UNH", "MSG", "ORG", "TVL", "EQN"],
      status: "populated",
      note: "Carrier, authority recipient, push flight and PNR count from flights/airlines/airports",
    },
    {
      group: "Group 1 PNR",
      segments: ["SRC", "RCI", "DAT"],
      status: "populated",
      note: "Record locator and PNR creation/last-update timestamps from bookings",
    },
    {
      group: "Group 1 contact",
      segments: ["SSR CTCE"],
      status: populated.has("ssr_ctce") ? "populated" : "partial",
      note: "Booker e-mail from users; no phone (CTCM) or postal address (ADD) is stored on the booking",
    },
    {
      group: "Group 1 remarks",
      segments: ["IFT", "ADD", "EBD", "ORG (booking office)"],
      status: "unavailable",
      note: "No OSI/remarks, PNR contact address, excess-baggage or booking-office records exist in the data model",
    },
    {
      group: "Group 2 passenger",
      segments: ["TIF", "SSR DOCS", "SSR DOCA"],
      status: populated.has("ssr_docs") ? "populated" : "partial",
      note: "Names and type from passengers; DOCS/DOCA from validated apis_data when present",
    },
    {
      group: "Group 2 frequent traveller",
      segments: ["FTI"],
      status: "unavailable",
      note: "Loyalty accounts are not linked to passengers on the PNR",
    },
    {
      group: "Group 3 ticket",
      segments: ["TKT", "MON", "PTK", "TXD"],
      status: populated.has("tkt") ? "partial" : "unavailable",
      note: `Ticket number from passengers.ticketNumber; MON only for single-passenger PNRs${
        multi ? " (multi-passenger PNRs present: MON omitted)" : ""
      } because per-passenger fare, fare basis (PTK) and taxes (TXD) are not stored (depends on fare-component workstream)`,
    },
    {
      group: "Group 4 form of payment",
      segments: ["FOP"],
      status: populated.has("fop") ? "partial" : "unavailable",
      note: "Payment method code only (CC/CA/MS); card vendor and masked account are not transmitted",
    },
    {
      group: "Group 5 itinerary",
      segments: ["TVL", "RPI", "SSR SEAT"],
      status: "populated",
      note: "All PNR legs from booking_segments/flights; seat from seat_inventory when assigned",
    },
    {
      group: "Group 5 operational",
      segments: ["APD", "TRI", "TBD", "ABI"],
      status: "unavailable",
      note: "Aircraft equipment code, check-in/boarding indicators and bag-tag details need the DCS/baggage workstreams' verified records",
    },
    {
      group: "Travel agent",
      segments: ["TRA", "TRI"],
      status: "unavailable",
      note: "Agency bookings are not represented on the PNR in a PNRGOV-mappable form",
    },
    {
      group: "History",
      segments: ["SRC (split/history)", "RCI (other systems)"],
      status: "unavailable",
      note: "No PNR history or split-PNR lineage is stored",
    },
  ];
}
