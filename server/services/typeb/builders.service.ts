/**
 * Builders: read AIS operational data and shape it into Type B payloads.
 *
 * Reads only. Passenger lists come from the same manifest membership rule the
 * DCS uses (flight-state.service), baggage from baggage.service, aircraft
 * registration from the rotation assignment. Load figures for the LDM are
 * explicit parameters (or defaults derived from bookings) because weight and
 * balance is owned by another workstream; nothing here recomputes it.
 */
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../db";
import {
  aircraftRotations,
  airlines,
  airports,
  baggageCustodyEvents,
  bookings,
  flights,
  passengers,
  specialServices,
} from "../../../drizzle/schema";
import { getBaggageById } from "../baggage.service";
import { manifestBookingCondition } from "../flight-state.service";
import { TypeBGatewayError } from "./gateway.service";
import type {
  AdlPayload,
  BsmPayload,
  CabinConfiguration,
  LdmPayload,
  MvtMovement,
  MvtPayload,
  PnlPassenger,
  PnlPayload,
  SsrElement,
} from "./model";
import { designatorFromFlightNumber } from "./text";
import { LICENSE_PLATE } from "./bsm";

function db() {
  const handle = getDb();
  if (!handle)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return handle;
}

export interface FlightContext {
  id: number;
  tenantId: number | null;
  flightNumber: string;
  designator: { carrier: string; number: string; suffix?: string };
  departureTime: Date;
  arrivalTime: Date;
  status: string;
  origin: string;
  destination: string;
  airlineCode: string;
  configuration: CabinConfiguration[];
  registration: string | null;
}

export async function loadFlightContext(
  flightId: number,
  tenantId: number | null
): Promise<FlightContext> {
  const handle = db();
  const [row] = await handle
    .select({
      id: flights.id,
      tenantId: flights.tenantId,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      status: flights.status,
      originId: flights.originId,
      destinationId: flights.destinationId,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      airlineCode: airlines.code,
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .where(eq(flights.id, flightId))
    .limit(1);
  if (!row || (tenantId !== null && row.tenantId !== tenantId))
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  const stations = await handle
    .select({ id: airports.id, code: airports.code })
    .from(airports)
    .where(inArray(airports.id, [row.originId, row.destinationId]));
  const origin = stations.find(s => s.id === row.originId)?.code;
  const destination = stations.find(s => s.id === row.destinationId)?.code;
  if (!origin || !destination)
    throw new TypeBGatewayError("Flight stations are not resolvable");
  const [rotation] = await handle
    .select({ tailNumber: aircraftRotations.tailNumber })
    .from(aircraftRotations)
    .where(eq(aircraftRotations.flightId, flightId))
    .limit(1);
  const configuration: CabinConfiguration[] = [];
  if (row.businessSeats > 0)
    configuration.push({ classCode: "C", seats: row.businessSeats });
  configuration.push({ classCode: "Y", seats: row.economySeats });
  return {
    id: row.id,
    tenantId: row.tenantId,
    flightNumber: row.flightNumber,
    designator: designatorFromFlightNumber(row.flightNumber, row.airlineCode),
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    status: row.status,
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
    airlineCode: row.airlineCode,
    configuration,
    registration: rotation?.tailNumber ?? null,
  };
}

const cabinLetter = (cabin: string) => (cabin === "business" ? "C" : "Y");

function ssrFrom(code: string, details: string | null): SsrElement {
  let text: string | undefined;
  if (details) {
    try {
      const parsed = JSON.parse(details) as Record<string, unknown>;
      const note = parsed.note ?? parsed.notes ?? parsed.description;
      if (typeof note === "string") text = note.slice(0, 40);
    } catch {
      text = details.slice(0, 40);
    }
  }
  return { code: code.toUpperCase().slice(0, 4), text };
}

/** Manifest passengers of a flight as PNL name elements (reads only). */
export async function listPnlPassengers(
  flight: FlightContext,
  bookingIds?: number[]
): Promise<PnlPassenger[]> {
  const handle = db();
  const where = bookingIds
    ? and(manifestBookingCondition(flight.id), inArray(bookings.id, bookingIds))
    : manifestBookingCondition(flight.id);
  const rows = await handle
    .select({
      bookingId: bookings.id,
      pnr: bookings.pnr,
      cabinClass: bookings.cabinClass,
      passengerId: passengers.id,
      type: passengers.type,
      title: passengers.title,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      seatNumber: passengers.seatNumber,
      ticketNumber: passengers.ticketNumber,
    })
    .from(bookings)
    .innerJoin(passengers, eq(bookings.id, passengers.bookingId))
    .where(where);
  if (!rows.length) return [];
  const ssrRows = await handle
    .select({
      passengerId: specialServices.passengerId,
      serviceCode: specialServices.serviceCode,
      details: specialServices.details,
    })
    .from(specialServices)
    .where(
      and(
        inArray(
          specialServices.passengerId,
          rows.map(r => r.passengerId)
        ),
        inArray(specialServices.status, ["pending", "confirmed"])
      )
    );
  const titleOf = (title: string | null): PnlPassenger["title"] => {
    const t = title?.toUpperCase().replace(/\./g, "");
    return t === "MRS" || t === "MS" || t === "DR" || t === "MISS" ? t : "MR";
  };
  return rows.map(r => ({
    surname: r.lastName,
    givenNames: r.firstName,
    title: titleOf(r.title),
    type: r.type,
    locator: r.pnr,
    destination: flight.destination,
    classCode: cabinLetter(r.cabinClass),
    seat: r.seatNumber ?? undefined,
    ticketNumber:
      r.ticketNumber && /^\d{13}$/.test(r.ticketNumber)
        ? r.ticketNumber
        : undefined,
    ssrs: ssrRows
      .filter(s => s.passengerId === r.passengerId)
      .map(s => ssrFrom(s.serviceCode, s.details)),
  }));
}

export async function buildPnlPayload(
  flight: FlightContext
): Promise<PnlPayload> {
  return {
    type: "PNL",
    flight: flight.designator,
    departureDate: flight.departureTime,
    boardPoint: flight.origin,
    configuration: flight.configuration,
    passengers: await listPnlPassengers(flight),
  };
}

/** ADL for one booking: ADD when it joined the manifest, DEL when it left. */
export async function buildAdlPayload(
  flight: FlightContext,
  bookingId: number,
  action: "ADD" | "DEL" | "CHG"
): Promise<AdlPayload | null> {
  const handle = db();
  // A cancelled booking no longer satisfies the manifest condition, so read
  // its passengers directly for the DEL list.
  const names =
    action === "DEL"
      ? await handle
          .select({
            pnr: bookings.pnr,
            cabinClass: bookings.cabinClass,
            type: passengers.type,
            title: passengers.title,
            firstName: passengers.firstName,
            lastName: passengers.lastName,
          })
          .from(bookings)
          .innerJoin(passengers, eq(bookings.id, passengers.bookingId))
          .where(eq(bookings.id, bookingId))
          .then(rows =>
            rows.map<PnlPassenger>(r => ({
              surname: r.lastName,
              givenNames: r.firstName,
              title:
                r.title?.toUpperCase() === "MRS"
                  ? "MRS"
                  : r.title?.toUpperCase() === "MS"
                    ? "MS"
                    : "MR",
              type: r.type,
              locator: r.pnr,
              destination: flight.destination,
              classCode: cabinLetter(r.cabinClass),
            }))
          )
      : await listPnlPassengers(flight, [bookingId]);
  if (!names.length) return null;
  return {
    type: "ADL",
    flight: flight.designator,
    departureDate: flight.departureTime,
    boardPoint: flight.origin,
    add: action === "ADD" ? names : [],
    change: action === "CHG" ? names : [],
    delete: action === "DEL" ? names : [],
  };
}

export function buildMvtPayload(
  flight: FlightContext,
  movement: MvtMovement,
  options: { registration?: string; remarks?: string[] } = {}
): MvtPayload {
  const registration = options.registration ?? flight.registration;
  if (!registration)
    throw new TypeBGatewayError(
      "Aircraft registration is required for an MVT (assign a rotation or pass it explicitly)"
    );
  return {
    type: "MVT",
    flight: flight.designator,
    date:
      movement.kind === "AA"
        ? movement.onBlocks
        : movement.kind === "AD"
          ? movement.offBlocks
          : flight.departureTime,
    registration,
    station: movement.kind === "AA" ? flight.destination : flight.origin,
    movement,
    remarks: options.remarks,
  };
}

export interface LdmFigures {
  registration?: string;
  crew: { cockpit: number; cabin: number; extra?: number };
  passengers?: { adults: number; children: number; infants: number };
  paxByClass?: number[];
  padByClass?: number[];
  totalLoadKg: number;
  compartments: Array<{ compartment: string; weightKg: number }>;
  baggage?: { pieces: number; weightKg: number };
  cargoKg?: number;
  mailKg?: number;
  totals?: LdmPayload["totals"];
  remarks?: string[];
}

/** LDM from explicit load figures; passenger counts default to the manifest. */
export async function buildLdmPayload(
  flight: FlightContext,
  figures: LdmFigures
): Promise<LdmPayload> {
  const registration = figures.registration ?? flight.registration;
  if (!registration)
    throw new TypeBGatewayError(
      "Aircraft registration is required for an LDM (assign a rotation or pass it explicitly)"
    );
  let passengers = figures.passengers;
  let paxByClass = figures.paxByClass;
  if (!passengers || !paxByClass) {
    const names = await listPnlPassengers(flight);
    passengers ??= {
      adults: names.filter(n => n.type === "adult").length,
      children: names.filter(n => n.type === "child").length,
      infants: names.filter(n => n.type === "infant").length,
    };
    paxByClass ??= flight.configuration.map(
      c =>
        names.filter(n => n.type !== "infant" && n.classCode === c.classCode)
          .length
    );
  }
  return {
    type: "LDM",
    flight: flight.designator,
    departureDate: flight.departureTime,
    registration,
    configuration: flight.configuration,
    crew: figures.crew,
    destinations: [
      {
        station: flight.destination,
        passengers,
        totalLoadKg: figures.totalLoadKg,
        compartments: figures.compartments,
        paxByClass,
        padByClass: figures.padByClass,
        baggage: figures.baggage,
        cargoKg: figures.cargoKg,
        mailKg: figures.mailKg,
      },
    ],
    totals: figures.totals,
    remarks: figures.remarks,
  };
}

export type BsmBuildResult =
  | { payload: BsmPayload; flightId: number; tenantId: number | null }
  | { skipped: string };

/**
 * BSM for an accepted bag. Tags that are not ten-digit IATA licence plates
 * are reported as skipped (not failed): the sortation system cannot use them
 * and the Res. 753 workstream owns tag allocation.
 */
export async function buildBsmPayload(
  baggageId: number,
  flightId: number,
  options: { action?: "CHG" | "DEL"; station?: string } = {}
): Promise<BsmBuildResult> {
  const bag = await getBaggageById(baggageId);
  if (!bag)
    throw new TRPCError({ code: "NOT_FOUND", message: "Bag not found" });
  if (!LICENSE_PLATE.test(bag.tagNumber))
    return {
      skipped: `Tag ${bag.tagNumber} is not a 10-digit IATA licence plate; BSM not generated`,
    };
  const handle = db();
  const [pax] = await handle
    .select({
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      seatNumber: passengers.seatNumber,
      pnr: bookings.pnr,
      cabinClass: bookings.cabinClass,
      tenantId: bookings.tenantId,
      checkedIn: bookings.checkedIn,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(eq(passengers.id, bag.passengerId))
    .limit(1);
  if (!pax) throw new TypeBGatewayError("Bag has no passenger");
  const flight = await loadFlightContext(flightId, pax.tenantId);
  const [custody] = await handle
    .select({ stage: baggageCustodyEvents.stage })
    .from(baggageCustodyEvents)
    .where(
      and(
        eq(baggageCustodyEvents.baggageId, bag.id),
        eq(baggageCustodyEvents.flightId, flightId),
        eq(baggageCustodyEvents.stage, "transfer")
      )
    )
    .limit(1);
  const weight = Math.round(Number(bag.weight));
  return {
    flightId,
    tenantId: pax.tenantId,
    payload: {
      type: "BSM",
      action: options.action,
      version: {
        indicator: custody ? "T" : "L",
        station: (options.station ?? flight.origin).toUpperCase(),
      },
      outbound: {
        flight: flight.designator,
        date: flight.departureTime,
        station: flight.destination,
        classCode: cabinLetter(pax.cabinClass),
      },
      licensePlates: [{ plate: bag.tagNumber }],
      passengerStatus: {
        checkedIn: pax.checkedIn,
        seat:
          pax.seatNumber && /^\d{1,3}[A-K]$/i.test(pax.seatNumber)
            ? pax.seatNumber
            : undefined,
        cabinClass: cabinLetter(pax.cabinClass),
      },
      passenger: { surname: pax.lastName, givenNames: pax.firstName },
      locator: pax.pnr,
      baggage: {
        unit: "K",
        pieces: 1,
        weight: Number.isFinite(weight) && weight >= 0 ? weight : 0,
      },
    },
  };
}
