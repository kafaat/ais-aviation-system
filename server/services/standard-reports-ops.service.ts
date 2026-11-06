import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  airports,
  baggageItems,
  bookings,
  fareClasses,
  flightFareClassInventory,
  flights,
  inventoryLocks,
  passengers,
  seatHolds,
  ticketCoupons,
} from "../../drizzle/schema";
import {
  apisData,
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../drizzle/operations-schema";
import {
  STANDARD_REPORT_ROW_LIMIT,
  type StandardReportColumn,
  type StandardReportDefinition,
  type StandardReportFilterKey,
  type StandardReportFilters,
  type StandardReportScope,
  type StandardReportTable,
} from "../../shared/standard-reports";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { manifestBaggageFlightCondition } from "./baggage-sector-scope";
import { assertFlightBaggageReconciled } from "./baggage-reconciliation.service";
import { generateOperationalDraft } from "./operational-messaging.service";
import { requireValue } from "./required-value";
import {
  dateColumn,
  numberColumn,
  reportTable,
  standardReportPeriod,
  textColumn,
} from "./standard-report-utils";

type ReportDb = Pick<SettlementTx, "select">;
type Membership = "manifest" | "holding" | "reservations" | "booked";
const READ_LIMIT = STANDARD_REPORT_ROW_LIMIT + 1;
const UTC_NOTE =
  "Departure-date filters use complete UTC days; times are UTC. All reads use one repeatable-read snapshot.";
const LOCAL_TICKET_NOTE =
  "Ticket and coupon fields describe AIS local documents. They do not certify external carrier issuance, uplift or settlement.";
const PERIOD_FILTERS: StandardReportFilterKey[] = [
  "startDate",
  "endDate",
  "flightId",
  "origin",
  "destination",
  "status",
];
const FLIGHT_FILTERS: StandardReportFilterKey[] = ["flightId"];

function definition(
  id: number,
  title: string,
  description: string,
  filters: StandardReportFilterKey[] = PERIOD_FILTERS,
  limitations: string[] = [],
  availability: StandardReportDefinition["availability"] = "available"
): StandardReportDefinition {
  return {
    id,
    title,
    category: "operations",
    availability,
    description,
    filters,
    limitations,
  };
}

export const operationsReportDefinitions: StandardReportDefinition[] = [
  definition(
    2,
    "APIS Data",
    "Flight passenger documents, dates of birth and document completeness, including passengers with missing data.",
    FLIGHT_FILTERS,
    [
      "This is a protected document report, not an authority submission or acknowledgment.",
    ]
  ),
  definition(
    3,
    "Confirmed Passengers",
    "Confirmed and completed sector members for a specific flight.",
    FLIGHT_FILTERS
  ),
  definition(
    5,
    "Daily Flight Load",
    "One UTC departure day with booked, checked-in, boarded, offloaded and recorded no-show counts.",
    ["startDate", "flightId", "origin", "destination", "status"],
    [
      "No-shows are reported only after an explicit DCS close. Boarding is local attendance evidence, not external ticket uplift.",
    ]
  ),
  definition(
    13,
    "FAX Information",
    "Airport FAX directory information.",
    [],
    [
      "No authoritative airport FAX directory is recorded; SSR/OSI APFAX is a different report.",
    ],
    "blocked"
  ),
  definition(
    14,
    "Flown Load",
    "Local DCS boarded passenger counts for flights with recorded off-block movement or completed status.",
    PERIOD_FILTERS,
    [
      "Only recorded boardings are counted. Completed flight status alone never implies a passenger flew or a coupon was uplifted.",
    ]
  ),
  definition(
    15,
    "Flight Availability 1 Day",
    "All flights in one UTC day with cabin capacity and effective availability after unexpired holds.",
    ["startDate", "flightId", "origin", "destination", "status"]
  ),
  definition(
    16,
    "Flight Availability 1 Week",
    "All flights in seven UTC days starting on the chosen date, including unexpired holds.",
    ["startDate", "flightId", "origin", "destination", "status"]
  ),
  definition(
    17,
    "Flight Manifest",
    "Passenger, booking, current local coupon, sector seat and attributed baggage details.",
    FLIGHT_FILTERS,
    [
      LOCAL_TICKET_NOTE,
      "Ambiguous or missing coupon identities are shown explicitly. Returned bags are excluded; unresolved physical registrations block the manifest.",
    ]
  ),
  definition(
    18,
    "Flight List",
    "Alternative flight passenger list using current sector membership.",
    FLIGHT_FILTERS
  ),
  definition(
    19,
    "Flight Count",
    "Passenger counts for one flight, with route, dates, cabin and passenger types.",
    FLIGHT_FILTERS
  ),
  definition(
    20,
    "Flight Count",
    "Passenger detail with distinct booking reference, PNR and passenger type.",
    FLIGHT_FILTERS
  ),
  definition(
    21,
    "Flight Group",
    "Inventory across an operational multi-leg flight group.",
    [],
    [
      "The system has booking itineraries but no authoritative operational flight-group identity. An itinerary is not a flight group.",
    ],
    "blocked"
  ),
  definition(
    22,
    "Flight ID",
    "Operational details of a flight by database identifier.",
    FLIGHT_FILTERS
  ),
  definition(
    23,
    "Flight Complete List",
    "Passengers retaining inventory, plus unallocated active holds clearly separated from named reservations.",
    FLIGHT_FILTERS,
    [
      "Unallocated holds have no passenger or PNR; they are shown with empty identity fields and their seat quantity.",
    ]
  ),
  definition(
    24,
    "Flight Passengers By Office",
    "Passengers grouped by the office that created the booking.",
    [],
    [
      "Historical booking-origin sales-office identity is not recorded; user and agency identity cannot substitute for it.",
    ],
    "blocked"
  ),
  definition(
    25,
    "Flight Passenger Table",
    "Passenger list selected by the flight database identifier.",
    FLIGHT_FILTERS
  ),
  definition(
    26,
    "Flight Times",
    "Departure and arrival times for flights from a specified origin airport during a UTC period.",
    PERIOD_FILTERS
  ),
  definition(
    27,
    "Flight Counts",
    "Distinct passenger and current local ticketed-passenger counts for each flight.",
    PERIOD_FILTERS,
    [LOCAL_TICKET_NOTE]
  ),
  definition(
    44,
    "Load Factors",
    "Recorded sold inventory divided by physical capacity; holds and effective availability are separate.",
    PERIOD_FILTERS,
    [
      "The load factor measures booked inventory, not flown passengers; zero-capacity flights have a null factor.",
    ]
  ),
  definition(
    45,
    "Load Overbookings",
    "Flights with recorded sold inventory at or above 100% of physical capacity.",
    PERIOD_FILTERS,
    [
      "Unexpired holds are displayed separately and do not turn into sold seats.",
    ]
  ),
  definition(
    48,
    "No Seat Plan",
    "Flights with missing or incomplete allocated seat inventory, or an invalid, mismatched or ambiguous allocated seat map.",
    PERIOD_FILTERS,
    [
      "A matching catalog map alone does not prove that it was allocated to a flight.",
    ]
  ),
  definition(
    49,
    "No Tickets",
    "Reservations holding inventory with no current local coupon for any passenger on that sector.",
    PERIOD_FILTERS,
    [
      LOCAL_TICKET_NOTE,
      "Legacy ticket numbers without coupon records are marked unverified and are not called proven unticketed.",
    ]
  ),
  definition(
    50,
    "No Ticket or Time Limit",
    "Inventory-holding reservations without a ticket or an authoritative ticketing time limit.",
    [],
    [
      "Commercial ticketing time limits are not recorded. Inventory-lock expiry is not a ticketing time limit.",
    ],
    "blocked"
  ),
  definition(
    53,
    "Passengers",
    "Passengers on a specific flight with cabin, type, booking reference and PNR.",
    FLIGHT_FILTERS
  ),
  definition(
    54,
    "Passenger Summary",
    "Passenger counts by flight, route, date, cabin and adult/child/infant type.",
    PERIOD_FILTERS
  ),
  definition(
    56,
    "PNL (Passenger Name List)",
    "Generate an operator-template PNL draft from authorized flight members and a configured route.",
    FLIGHT_FILTERS,
    [
      "The generated draft is downloadable report content. It is not persisted, queued, sent or acknowledged by this read operation.",
      "A configured Type-B address and valid Latin document names are required; carrier acceptance remains separate.",
    ],
    "partial"
  ),
  definition(
    57,
    "PNL Status",
    "Every flight in a departure period from an origin airport, with each recorded outbound PNL version and its actual transport status.",
    PERIOD_FILTERS,
    [
      "Flights without a stored PNL are shown as not_generated. Draft, sent and acknowledged are separate recorded states; this report does not send messages.",
    ]
  ),
  definition(
    64,
    "Passport Data",
    "Protected passport and travel-document details for passengers departing the specified origin airport in a UTC period.",
    PERIOD_FILTERS,
    [
      "Origin selects an airport by IATA code. Missing and unverified documents remain explicit; document records do not prove authority acceptance.",
    ]
  ),
  definition(
    72,
    "Reservations By Flight Date",
    "Reservations selected by sector departure date, including multi-sector bookings and their creation date.",
    PERIOD_FILTERS
  ),
  definition(
    73,
    "Reservations Without Tickets",
    "Inventory-holding reservations with missing or unverified current local passenger coupons in a departure period.",
    PERIOD_FILTERS,
    [
      LOCAL_TICKET_NOTE,
      "Missing coupon evidence and legacy unverified ticket identities are separate exception reasons.",
    ]
  ),
  definition(
    74,
    "Restricted Flights",
    "Commercial flight sale restrictions with their effective periods.",
    [],
    [
      "No authoritative flight-wide commercial restriction history is recorded; cancellation, sold-out capacity and restricted seats are different facts.",
    ],
    "blocked"
  ),
  definition(
    84,
    "RO Reports",
    "Full cabin and configured RBD inventory by flight, with holds, waitlist and effective physical availability.",
    PERIOD_FILTERS,
    [
      "Cabin totals and RBD subsets are separate levels and must not be added together. Waitlists are recorded by cabin, not by RBD.",
    ]
  ),
  definition(
    91,
    "Ticket Go Shows",
    "Passengers who actually boarded a flight different from their original ticketed flight.",
    [],
    [
      "Original ticket-flight attribution and accepted go-show linkage are not recorded together. Reaccommodation or a manual go-show flag alone does not establish this event.",
    ],
    "blocked"
  ),
  definition(
    92,
    "Ticket No Shows",
    "Passengers with a current open local coupon and no recorded check-in after explicit DCS close.",
    PERIOD_FILTERS,
    [
      LOCAL_TICKET_NOTE,
      "Current seats and DCS attendance/history are checked per passenger and sector. Offloaded, boarded, checked-in and ambiguous legacy booking-wide check-ins are not called no-shows.",
    ]
  ),
  definition(
    93,
    "Tickets without bookings",
    "Current open or checked-in local coupons with a missing, cancelled, deleted or removed booking sector.",
    PERIOD_FILTERS,
    [
      LOCAL_TICKET_NOTE,
      "Names are returned only when the passenger belongs to the same booking and tenant. Cross-tenant malformed booking links are excluded.",
    ]
  ),
];

const origin = alias(airports, "report_origin");
const destination = alias(airports, "report_destination");
const flightColumns: StandardReportColumn[] = [
  numberColumn("flightId", "Flight ID"),
  textColumn("flightNumber", "Flight number"),
  textColumn("origin", "Origin"),
  textColumn("destination", "Destination"),
  dateColumn("departureTime", "Departure UTC"),
  dateColumn("arrivalTime", "Arrival UTC"),
  textColumn("aircraftType", "Aircraft type"),
  textColumn("flightStatus", "Flight status"),
];
const personColumns: StandardReportColumn[] = [
  ...flightColumns,
  numberColumn("bookingId", "Booking ID"),
  textColumn("bookingReference", "Booking reference"),
  textColumn("pnr", "PNR"),
  numberColumn("passengerId", "Passenger ID"),
  textColumn("firstName", "Given name"),
  textColumn("lastName", "Surname"),
  textColumn("passengerType", "Passenger type"),
  textColumn("cabinClass", "Cabin"),
  textColumn("seatNumber", "Sector seat"),
  textColumn("attendance", "DCS attendance"),
];

// Explicitly qualified references stay qualified inside correlated SELECTs.
// Drizzle may otherwise shorten a column in a single-table SELECT and bind a
// nested `id` to the inner table instead of the intended outer row.
function col(table: string, name: string): SQL {
  return sql`${sql.identifier(table)}.${sql.identifier(name)}`;
}
function equalTenant(a: string, b: string): SQL {
  return sql`(${col(a, "tenantId")} = ${col(b, "tenantId")} OR (${col(a, "tenantId")} IS NULL AND ${col(b, "tenantId")} IS NULL))`;
}
function passengerOwner(p: string, b: string): SQL {
  return sql`${col(p, "bookingId")} = ${col(b, "id")} AND (${col(p, "tenantId")} IS NULL OR ${col(p, "tenantId")} = ${col(b, "tenantId")})`;
}
function nowSql(now: Date) {
  return now.toISOString().slice(0, 23).replace("T", " ");
}
function activeLock(lockId: SQL, f: string, now: Date): SQL {
  return sql`EXISTS (SELECT 1 FROM inventory_locks held_lock WHERE held_lock.id = ${lockId}
    AND held_lock.flightId = ${col(f, "id")} AND held_lock.status = 'active' AND held_lock.expiresAt > ${nowSql(now)})`;
}
function membership(
  mode: Membership,
  now: Date,
  b = "bookings",
  f = "flights"
): SQL {
  if (mode === "booked")
    return sql`(${membership("manifest", now, b, f)} OR ${membership("holding", now, b, f)})`;
  const states =
    mode === "manifest"
      ? sql`('confirmed','completed')`
      : mode === "holding"
        ? sql`('pending','confirmed')`
        : sql`('pending','confirmed','completed')`;
  const reservation =
    mode === "holding"
      ? sql`AND (${col(b, "seatsReserved")} = 1 OR ${activeLock(col(b, "inventoryLockId"), f, now)})`
      : sql``;
  const legReservation =
    mode === "holding"
      ? sql`AND (report_leg.seatsReserved = 1 OR ${activeLock(sql`report_leg.inventoryLockId`, f, now)})`
      : sql``;
  return sql`(${equalTenant(b, f)} AND ${col(b, "deletedAt")} IS NULL AND ${col(b, "status")} IN ${states}
    AND ((NOT EXISTS (SELECT 1 FROM booking_segments any_leg WHERE any_leg.bookingId = ${col(b, "id")})
      AND ${col(b, "flightId")} = ${col(f, "id")} ${reservation})
    OR EXISTS (SELECT 1 FROM booking_segments report_leg WHERE report_leg.bookingId = ${col(b, "id")}
      AND report_leg.flightId = ${col(f, "id")} AND report_leg.status IN ${states} ${legReservation})))`;
}
function currentCoupon(
  b: string,
  p: string,
  f: string,
  states = sql`('O','C','F')`
): SQL {
  return sql`EXISTS (SELECT 1 FROM ticket_coupons report_coupon
    WHERE report_coupon.bookingId = ${col(b, "id")} AND report_coupon.passengerId = ${col(p, "id")}
      AND report_coupon.flightId = ${col(f, "id")} AND report_coupon.status IN ${states}
      AND (${col(p, "ticketNumber")} IS NULL OR report_coupon.ticketNumber = ${col(p, "ticketNumber")}))`;
}
function dcsState(p: string, b: string, f: string, state: string): SQL {
  return sql`EXISTS (SELECT 1 FROM dcs_passenger_states report_dcs
    WHERE report_dcs.bookingId = ${col(b, "id")} AND report_dcs.passengerId = ${col(p, "id")}
      AND report_dcs.flightId = ${col(f, "id")} AND report_dcs.state = ${state}
      ${state === "boarded" ? sql`AND report_dcs.boardingDenied = 0` : sql``})`;
}
function closedFlight(f = "flights"): SQL {
  return sql`(${col(f, "dcsClosedAt")} IS NOT NULL OR EXISTS (SELECT 1 FROM dcs_flight_operations closed_dcs
    WHERE closed_dcs.flightId = ${col(f, "id")} AND closed_dcs.checkInState = 'closed'
      AND (closed_dcs.tenantId = ${col(f, "tenantId")} OR (closed_dcs.tenantId IS NULL AND ${col(f, "tenantId")} IS NULL))))`;
}
function checkedSeat(p: string, b: string, f: string): SQL {
  return sql`EXISTS (SELECT 1 FROM seat_inventory report_seat WHERE report_seat.bookingId = ${col(b, "id")}
    AND report_seat.passengerId = ${col(p, "id")} AND report_seat.flightId = ${col(f, "id")}
    AND report_seat.status = 'checked_in' AND report_seat.checkedInAt IS NOT NULL AND report_seat.checkInNonce IS NOT NULL)`;
}
function noShow(p: string, b: string, f: string): SQL {
  return sql`${closedFlight(f)} AND ${currentCoupon(b, p, f, sql`('O')`)}
    AND (${col(b, "checkedIn")} = 0
      OR EXISTS (SELECT 1 FROM dcs_passenger_states scoped_attendance WHERE scoped_attendance.bookingId = ${col(b, "id")} AND scoped_attendance.passengerId = ${col(p, "id")} AND scoped_attendance.flightId = ${col(f, "id")})
      OR EXISTS (SELECT 1 FROM seat_inventory scoped_check_in WHERE scoped_check_in.bookingId = ${col(b, "id")} AND scoped_check_in.passengerId = ${col(p, "id")} AND scoped_check_in.flightId = ${col(f, "id")}))
    AND NOT ${checkedSeat(p, b, f)}
    AND NOT EXISTS (SELECT 1 FROM dcs_passenger_states no_show_state WHERE no_show_state.bookingId = ${col(b, "id")}
      AND no_show_state.passengerId = ${col(p, "id")} AND no_show_state.flightId = ${col(f, "id")}
      AND (no_show_state.state IN ('checked_in','boarded','offloaded') OR no_show_state.boardingDenied = 1))
    AND NOT EXISTS (SELECT 1 FROM dcs_operation_events no_show_event WHERE no_show_event.bookingId = ${col(b, "id")}
      AND no_show_event.passengerId = ${col(p, "id")} AND no_show_event.flightId = ${col(f, "id")}
      AND (no_show_event.tenantId IS NULL OR no_show_event.tenantId = ${col(f, "tenantId")})
      AND (no_show_event.toState IN ('checked_in','boarded','offloaded') OR no_show_event.fromState IN ('checked_in','boarded'))) `;
}
function countPeople(
  now: Date,
  extra: SQL = sql`1=1`,
  mode: Membership = "manifest"
): SQL<number> {
  return sql<number>`(SELECT COUNT(*) FROM bookings report_booking
    INNER JOIN passengers report_person ON ${passengerOwner("report_person", "report_booking")}
    WHERE ${membership(mode, now, "report_booking")} AND ${extra})`.mapWith(
    Number
  );
}
function countHolds(cabin: "economy" | "business", now: Date): SQL<number> {
  return sql<number>`((SELECT COALESCE(SUM(hold_record.numberOfSeats),0) FROM inventory_locks hold_record
    WHERE hold_record.flightId = ${col("flights", "id")} AND hold_record.cabinClass = ${cabin}
      AND hold_record.status = 'active' AND hold_record.expiresAt > ${nowSql(now)})
    + (SELECT COALESCE(SUM(legacy_hold.seats),0) FROM seat_holds legacy_hold
      WHERE legacy_hold.flightId = ${col("flights", "id")} AND legacy_hold.cabinClass = ${cabin}
        AND legacy_hold.inventoryLockId IS NULL AND legacy_hold.status = 'active' AND legacy_hold.expiresAt > ${nowSql(now)}))`.mapWith(
    Number
  );
}
function scopedPeriod(id: number, filters: StandardReportFilters) {
  if ([5, 15, 16].includes(id)) {
    if (!filters.startDate)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select the report start date",
      });
    const period = standardReportPeriod({
      startDate: filters.startDate,
      endDate: filters.startDate,
    });
    return {
      start: period.start,
      end: new Date(
        requireValue(period.end).getTime() + (id === 16 ? 6 : 0) * 86_400_000
      ),
    };
  }
  return standardReportPeriod(filters);
}
function flightWhere(
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  extra?: SQL
) {
  const period = scopedPeriod(id, filters);
  if (
    filters.status &&
    id !== 57 &&
    !["scheduled", "delayed", "completed", "cancelled"].includes(filters.status)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Unknown flight status",
    });
  }
  return and(
    scope.tenantId === undefined
      ? undefined
      : eq(flights.tenantId, scope.tenantId),
    filters.flightId === undefined
      ? undefined
      : eq(flights.id, filters.flightId),
    period.start ? gte(flights.departureTime, period.start) : undefined,
    period.end ? lt(flights.departureTime, period.end) : undefined,
    filters.origin ? eq(origin.code, filters.origin.toUpperCase()) : undefined,
    filters.destination
      ? eq(destination.code, filters.destination.toUpperCase())
      : undefined,
    filters.status && id !== 57
      ? eq(flights.status, filters.status as typeof flights.$inferSelect.status)
      : undefined,
    extra
  );
}
function flightFields() {
  return {
    flightId: flights.id,
    flightNumber: flights.flightNumber,
    origin: origin.code,
    destination: destination.code,
    departureTime: flights.departureTime,
    arrivalTime: flights.arrivalTime,
    aircraftType: flights.aircraftType,
    flightStatus: flights.status,
  };
}
function assertBound(rows: unknown[]) {
  if (rows.length > STANDARD_REPORT_ROW_LIMIT)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The report exceeds 10000 rows. Narrow the filters; no rows were silently omitted.",
    });
}
async function readFlightRows(
  db: ReportDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const rows = await db
    .select({
      ...flightFields(),
      tenantId: flights.tenantId,
      airlineId: flights.airlineId,
      originTimezone: origin.timezone,
      destinationTimezone: destination.timezone,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyRecordedAvailable: flights.economyAvailable,
      businessRecordedAvailable: flights.businessAvailable,
      economyHeld: countHolds("economy", now),
      businessHeld: countHolds("business", now),
      stationOffBlocksAt: flights.stationOffBlocksAt,
      dcsClosed:
        sql<number>`CASE WHEN ${closedFlight()} THEN 1 ELSE 0 END`.mapWith(
          Number
        ),
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(flightWhere(id, filters, scope))
    .orderBy(asc(flights.departureTime), asc(flights.id))
    .limit(READ_LIMIT);
  assertBound(rows);
  return rows;
}
type FlightRow = Awaited<ReturnType<typeof readFlightRows>>[number];
function inventoryValues(row: FlightRow) {
  const capacity = row.economySeats + row.businessSeats;
  const sold =
    capacity - row.economyRecordedAvailable - row.businessRecordedAvailable;
  return {
    ...row,
    capacity,
    sold,
    held: row.economyHeld + row.businessHeld,
    economyAvailable: Math.max(
      0,
      row.economyRecordedAvailable - row.economyHeld
    ),
    businessAvailable: Math.max(
      0,
      row.businessRecordedAvailable - row.businessHeld
    ),
    loadFactorPercent:
      capacity > 0 ? Math.round((sold * 10000) / capacity) / 100 : null,
  };
}
const availabilityColumns: StandardReportColumn[] = [
  ...flightColumns,
  numberColumn("economySeats", "Economy capacity"),
  numberColumn("businessSeats", "Business capacity"),
  numberColumn("economyRecordedAvailable", "Economy recorded available"),
  numberColumn("businessRecordedAvailable", "Business recorded available"),
  numberColumn("economyHeld", "Economy active holds"),
  numberColumn("businessHeld", "Business active holds"),
  numberColumn("economyAvailable", "Economy effective available"),
  numberColumn("businessAvailable", "Business effective available"),
  numberColumn("capacity", "Physical capacity"),
  numberColumn("sold", "Recorded sold seats"),
  numberColumn("loadFactorPercent", "Booked load factor percent"),
];

async function readPeople(
  db: ReportDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date,
  mode: Membership = "manifest",
  extra?: SQL
) {
  const rows = await db
    .select({
      ...flightFields(),
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      bookingStatus: bookings.status,
      bookingCreatedAt: bookings.createdAt,
      passengerId: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      passengerType: passengers.type,
      cabinClass: bookings.cabinClass,
      ticketNumber: passengers.ticketNumber,
      seatNumber: sql<
        string | null
      >`(SELECT CASE COUNT(*) WHEN 0 THEN CASE WHEN NOT EXISTS
      (SELECT 1 FROM booking_segments seat_leg WHERE seat_leg.bookingId = ${col("bookings", "id")}) THEN ${col("passengers", "seatNumber")} END
      WHEN 1 THEN MAX(current_seat.seatNumber) END FROM seat_inventory current_seat
      WHERE current_seat.bookingId = ${col("bookings", "id")} AND current_seat.passengerId = ${col("passengers", "id")}
        AND current_seat.flightId = ${col("flights", "id")} AND current_seat.status IN ('occupied','checked_in'))`,
      attendance: sql<string>`CASE
      WHEN EXISTS (SELECT 1 FROM dcs_passenger_states denied WHERE denied.bookingId = ${col("bookings", "id")}
        AND denied.passengerId = ${col("passengers", "id")} AND denied.flightId = ${col("flights", "id")} AND denied.boardingDenied = 1) THEN 'boarding_denied'
      WHEN ${dcsState("passengers", "bookings", "flights", "boarded")} THEN 'boarded'
      WHEN ${dcsState("passengers", "bookings", "flights", "offloaded")} THEN 'offloaded'
      WHEN ${dcsState("passengers", "bookings", "flights", "checked_in")} OR ${checkedSeat("passengers", "bookings", "flights")} THEN 'checked_in'
      ELSE 'not_checked_in' END`,
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .innerJoin(bookings, membership(mode, now))
    .innerJoin(passengers, passengerOwner("passengers", "bookings"))
    .where(flightWhere(id, filters, scope, extra))
    .orderBy(
      asc(flights.departureTime),
      asc(flights.id),
      asc(bookings.id),
      asc(passengers.id)
    )
    .limit(READ_LIMIT);
  assertBound(rows);
  return rows;
}

async function passengerCounts(
  db: ReportDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const rows = await db
    .select({
      ...flightFields(),
      confirmedPassengers: countPeople(now),
      bookedPassengers: countPeople(now, sql`1=1`, "booked"),
      ticketedPassengers: countPeople(
        now,
        currentCoupon("report_booking", "report_person", "flights"),
        "booked"
      ),
      adults: countPeople(now, sql`report_person.type = 'adult'`),
      children: countPeople(now, sql`report_person.type = 'child'`),
      infants: countPeople(now, sql`report_person.type = 'infant'`),
      economyPassengers: countPeople(
        now,
        sql`report_booking.cabinClass = 'economy'`
      ),
      businessPassengers: countPeople(
        now,
        sql`report_booking.cabinClass = 'business'`
      ),
      checkedInPassengers: countPeople(
        now,
        sql`NOT ${dcsState("report_person", "report_booking", "flights", "offloaded")}
      AND (${checkedSeat("report_person", "report_booking", "flights")} OR ${dcsState("report_person", "report_booking", "flights", "checked_in")} OR ${dcsState("report_person", "report_booking", "flights", "boarded")})`
      ),
      boardedPassengers: countPeople(
        now,
        dcsState("report_person", "report_booking", "flights", "boarded")
      ),
      offloadedPassengers:
        sql<number>`(SELECT COUNT(*) FROM dcs_passenger_states offloaded_state
      INNER JOIN bookings offloaded_booking ON offloaded_booking.id = offloaded_state.bookingId AND ${equalTenant("offloaded_booking", "flights")}
      INNER JOIN passengers offloaded_person ON offloaded_person.id = offloaded_state.passengerId AND ${passengerOwner("offloaded_person", "offloaded_booking")}
      WHERE offloaded_state.flightId = ${col("flights", "id")} AND offloaded_state.state = 'offloaded')`.mapWith(
          Number
        ),
      noShowPassengers: sql<
        number | null
      >`CASE WHEN ${closedFlight()} THEN ${countPeople(now, noShow("report_person", "report_booking", "flights"))} ELSE NULL END`.mapWith(
        value => (value == null ? null : Number(value))
      ),
      unreconciledBoardings:
        sql<number>`(SELECT COUNT(*) FROM dcs_passenger_states orphan_boarding
      WHERE orphan_boarding.flightId = ${col("flights", "id")} AND orphan_boarding.state = 'boarded'
        AND (orphan_boarding.boardingDenied = 1 OR NOT EXISTS (SELECT 1 FROM bookings board_booking
          INNER JOIN passengers board_person ON board_person.id = orphan_boarding.passengerId AND ${passengerOwner("board_person", "board_booking")}
          WHERE board_booking.id = orphan_boarding.bookingId AND ${membership("manifest", now, "board_booking")})))`.mapWith(
          Number
        ),
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(
      flightWhere(
        id,
        filters,
        scope,
        id === 14
          ? sql`${flights.status} <> 'cancelled' AND (${flights.status} = 'completed' OR ${flights.stationOffBlocksAt} IS NOT NULL)`
          : undefined
      )
    )
    .orderBy(asc(flights.departureTime), asc(flights.id))
    .limit(READ_LIMIT);
  assertBound(rows);
  if ([5, 14].includes(id) && rows.some(row => row.unreconciledBoardings > 0)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "DCS boarding records cannot all be reconciled to authorized passenger-sector membership. Reconcile departure control before reporting flown loads.",
    });
  }
  const columns = [
    ...flightColumns,
    numberColumn("bookedPassengers", "Booked passengers"),
    numberColumn("confirmedPassengers", "Confirmed/completed passengers"),
    numberColumn("ticketedPassengers", "Current local ticketed passengers"),
    numberColumn("adults", "Adults"),
    numberColumn("children", "Children"),
    numberColumn("infants", "Infants"),
    numberColumn("economyPassengers", "Economy passengers"),
    numberColumn("businessPassengers", "Business passengers"),
    numberColumn(
      "checkedInPassengers",
      "Checked-in passengers including boarded"
    ),
    numberColumn("boardedPassengers", "Recorded boarded passengers"),
    numberColumn("offloadedPassengers", "Recorded offloaded passengers"),
    numberColumn("noShowPassengers", "No recorded check-in after DCS close"),
    numberColumn("unreconciledBoardings", "Unreconciled boarded records"),
  ];
  return reportTable(columns, rows, [
    UTC_NOTE,
    LOCAL_TICKET_NOTE,
    "No-show totals remain null until explicit DCS close; an offloaded passenger is not a no-show. Offload counts retain physical attendance history after booking cancellation.",
  ]);
}

async function documentReport(
  db: ReportDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const rows = await db
    .select({
      ...flightFields(),
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      passengerId: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      passengerType: passengers.type,
      documentGivenNames: apisData.givenNames,
      documentSurname: apisData.surname,
      dateOfBirth: sql<
        string | null
      >`COALESCE(${apisData.dateOfBirth}, CAST(${passengers.dateOfBirth} AS CHAR))`,
      documentType: sql<
        string | null
      >`CASE WHEN ${apisData.id} IS NOT NULL THEN ${apisData.documentType} WHEN ${passengers.passportNumber} IS NOT NULL THEN 'passport' ELSE NULL END`,
      documentNumber: sql<
        string | null
      >`COALESCE(${apisData.documentNumber},${passengers.passportNumber})`,
      expiryDate: sql<
        string | null
      >`COALESCE(${apisData.expiryDate}, CAST(${passengers.passportExpiry} AS CHAR))`,
      issuingCountry: apisData.issuingCountry,
      nationality: sql<
        string | null
      >`COALESCE(${apisData.nationality},${passengers.nationality})`,
      gender: apisData.gender,
      verificationStatus: sql<string>`CASE WHEN ${apisData.id} IS NOT NULL THEN ${apisData.status} WHEN ${passengers.passportNumber} IS NOT NULL THEN 'legacy_unverified' ELSE 'missing' END`,
      documentSource: sql<string>`CASE WHEN ${apisData.id} IS NOT NULL THEN 'apis_data' WHEN ${passengers.passportNumber} IS NOT NULL THEN 'passenger_record' ELSE 'missing' END`,
      validatedAt: apisData.validatedAt,
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .innerJoin(bookings, membership("manifest", now))
    .innerJoin(passengers, passengerOwner("passengers", "bookings"))
    .leftJoin(
      apisData,
      and(
        eq(apisData.passengerId, passengers.id),
        eq(apisData.bookingId, bookings.id)
      )
    )
    .where(flightWhere(id, filters, scope))
    .orderBy(
      asc(flights.departureTime),
      asc(flights.id),
      asc(bookings.id),
      asc(passengers.id)
    )
    .limit(READ_LIMIT);
  return reportTable(
    [
      ...flightColumns,
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      numberColumn("passengerId", "Passenger ID"),
      textColumn("firstName", "Given name"),
      textColumn("lastName", "Surname"),
      textColumn("passengerType", "Passenger type"),
      textColumn("documentGivenNames", "Document given names"),
      textColumn("documentSurname", "Document surname"),
      dateColumn("dateOfBirth", "Date of birth"),
      textColumn("documentType", "Document type"),
      textColumn("documentNumber", "Document number"),
      dateColumn("expiryDate", "Document expiry"),
      textColumn("issuingCountry", "Issuing country"),
      textColumn("nationality", "Nationality"),
      textColumn("gender", "Recorded gender"),
      textColumn("verificationStatus", "Document verification"),
      textColumn("documentSource", "Document source"),
      dateColumn("validatedAt", "Validated UTC"),
    ],
    rows,
    [
      UTC_NOTE,
      "Only documents belonging to the listed booking and passenger are joined. Missing documents and unverified legacy passenger fields remain explicit; no authority submission is performed.",
    ]
  );
}

async function fullManifest(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const flightId = requireValue(filters.flightId);
  await assertFlightBaggageReconciled(db, flightId);
  const people = await readPeople(db, 17, filters, scope, now);
  const coupons = await db
    .select({
      bookingId: ticketCoupons.bookingId,
      passengerId: ticketCoupons.passengerId,
      ticketNumber: ticketCoupons.ticketNumber,
      couponNumber: ticketCoupons.couponNumber,
      status: ticketCoupons.status,
    })
    .from(ticketCoupons)
    .innerJoin(bookings, eq(bookings.id, ticketCoupons.bookingId))
    .innerJoin(
      passengers,
      and(
        eq(passengers.id, ticketCoupons.passengerId),
        passengerOwner("passengers", "bookings")
      )
    )
    .innerJoin(flights, eq(flights.id, ticketCoupons.flightId))
    .where(
      and(
        eq(flights.id, flightId),
        membership("manifest", now),
        scope.tenantId === undefined
          ? undefined
          : eq(flights.tenantId, scope.tenantId)
      )
    )
    .orderBy(asc(ticketCoupons.id))
    .limit(READ_LIMIT);
  const bags = await db
    .select({
      bookingId: baggageItems.bookingId,
      passengerId: baggageItems.passengerId,
      tagNumber: baggageItems.tagNumber,
      weight: baggageItems.weight,
    })
    .from(baggageItems)
    .innerJoin(bookings, eq(bookings.id, baggageItems.bookingId))
    .innerJoin(
      passengers,
      and(
        eq(passengers.id, baggageItems.passengerId),
        passengerOwner("passengers", "bookings")
      )
    )
    .innerJoin(flights, eq(flights.id, flightId))
    .where(
      and(
        membership("manifest", now),
        manifestBaggageFlightCondition(flightId),
        scope.tenantId === undefined
          ? undefined
          : eq(flights.tenantId, scope.tenantId)
      )
    )
    .orderBy(asc(baggageItems.id))
    .limit(READ_LIMIT);
  assertBound(coupons);
  assertBound(bags);
  const key = (row: { bookingId: number; passengerId: number }) =>
    `${row.bookingId}:${row.passengerId}`;
  const couponGroups = new Map<string, typeof coupons>();
  const bagGroups = new Map<string, typeof bags>();
  for (const coupon of coupons) {
    const group = couponGroups.get(key(coupon)) ?? [];
    group.push(coupon);
    couponGroups.set(key(coupon), group);
  }
  for (const bag of bags) {
    const group = bagGroups.get(key(bag)) ?? [];
    group.push(bag);
    bagGroups.set(key(bag), group);
  }
  const rows = people.map(person => {
    const history = couponGroups.get(key(person)) ?? [];
    const matching = person.ticketNumber
      ? history.filter(c => c.ticketNumber === person.ticketNumber)
      : history.filter(c => ["O", "C", "F"].includes(c.status));
    const selected = matching.length === 1 ? matching[0] : null;
    const baggage = bagGroups.get(key(person)) ?? [];
    return {
      ...person,
      ticketNumber: selected?.ticketNumber ?? person.ticketNumber,
      couponNumber: selected?.couponNumber ?? null,
      couponStatus:
        selected?.status ?? (matching.length > 1 ? "ambiguous" : "unverified"),
      couponHistory: history
        .map(c => `${c.ticketNumber}/${c.couponNumber}/${c.status}`)
        .join("; "),
      baggagePieces: baggage.length,
      baggageWeightKg:
        Math.round(
          baggage.reduce((total, bag) => total + Number(bag.weight), 0) * 100
        ) / 100,
      baggageTags: baggage.map(bag => bag.tagNumber).join("; "),
    };
  });
  return reportTable(
    [
      ...personColumns,
      textColumn("ticketNumber", "Local ticket number"),
      numberColumn("couponNumber", "Coupon number"),
      textColumn("couponStatus", "Current coupon status"),
      textColumn(
        "couponHistory",
        "Sector coupon history (ticket/coupon/status)"
      ),
      numberColumn("baggagePieces", "Attributed checked bags"),
      numberColumn("baggageWeightKg", "Attributed bag weight kg"),
      textColumn("baggageTags", "Attributed bag tags"),
    ],
    rows,
    [
      UTC_NOTE,
      LOCAL_TICKET_NOTE,
      "Coupon identity is matched to the current passenger ticket pointer. Without a pointer, exactly one current sector coupon is required; conflicts remain ambiguous. Returned bags are excluded. Unscoped legacy bags require existing sole-flight or custody evidence.",
    ]
  );
}

async function holdingList(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const people = await readPeople(db, 23, filters, scope, now, "holding");
  const incompleteReservations = await db
    .select({
      ...flightFields(),
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      bookingStatus: bookings.status,
      cabinClass: bookings.cabinClass,
      expectedPassengers: bookings.numberOfPassengers,
      namedPassengers:
        sql<number>`(SELECT COUNT(*) FROM passengers reserved_person WHERE ${passengerOwner("reserved_person", "bookings")})`.mapWith(
          Number
        ),
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .innerJoin(bookings, membership("holding", now))
    .where(
      flightWhere(
        23,
        filters,
        scope,
        sql`(
      (NOT EXISTS (SELECT 1 FROM booking_segments reserved_leg WHERE reserved_leg.bookingId = ${col("bookings", "id")}) AND ${bookings.seatsReserved} = 1)
      OR EXISTS (SELECT 1 FROM booking_segments reserved_leg WHERE reserved_leg.bookingId = ${col("bookings", "id")}
        AND reserved_leg.flightId = ${col("flights", "id")} AND reserved_leg.status IN ('pending','confirmed') AND reserved_leg.seatsReserved = 1))
      AND (SELECT COUNT(*) FROM passengers reserved_person WHERE ${passengerOwner("reserved_person", "bookings")}) < ${bookings.numberOfPassengers}`
      )
    )
    .orderBy(asc(bookings.id))
    .limit(READ_LIMIT);
  const unassigned = await db
    .select({
      ...flightFields(),
      lockId: inventoryLocks.id,
      cabinClass: inventoryLocks.cabinClass,
      heldSeats: inventoryLocks.numberOfSeats,
      holdExpiresAt: inventoryLocks.expiresAt,
      namedPassengers:
        sql<number>`(SELECT COUNT(DISTINCT linked_hold_person.id) FROM bookings linked_hold_booking
        INNER JOIN passengers linked_hold_person ON ${passengerOwner("linked_hold_person", "linked_hold_booking")}
        WHERE ${membership("holding", now, "linked_hold_booking")}
          AND (linked_hold_booking.inventoryLockId = ${col("inventory_locks", "id")} OR EXISTS (SELECT 1 FROM booking_segments linked_hold_leg
            WHERE linked_hold_leg.bookingId = linked_hold_booking.id AND linked_hold_leg.flightId = ${col("flights", "id")}
              AND linked_hold_leg.inventoryLockId = ${col("inventory_locks", "id")} AND linked_hold_leg.status IN ('pending','confirmed'))))`.mapWith(
          Number
        ),
    })
    .from(inventoryLocks)
    .innerJoin(flights, eq(flights.id, inventoryLocks.flightId))
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(
      and(
        flightWhere(23, filters, scope),
        eq(inventoryLocks.status, "active"),
        sql`${inventoryLocks.expiresAt} > ${nowSql(now)}`
      )
    )
    .orderBy(asc(inventoryLocks.id))
    .limit(READ_LIMIT);
  const legacy = await db
    .select({
      ...flightFields(),
      lockId: seatHolds.id,
      cabinClass: seatHolds.cabinClass,
      heldSeats: seatHolds.seats,
      holdExpiresAt: seatHolds.expiresAt,
    })
    .from(seatHolds)
    .innerJoin(flights, eq(flights.id, seatHolds.flightId))
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(
      and(
        flightWhere(23, filters, scope),
        eq(seatHolds.status, "active"),
        sql`${seatHolds.inventoryLockId} IS NULL`,
        sql`${seatHolds.expiresAt} > ${nowSql(now)}`
      )
    )
    .orderBy(asc(seatHolds.id))
    .limit(READ_LIMIT);
  assertBound(incompleteReservations);
  assertBound(unassigned);
  assertBound(legacy);
  return reportTable(
    [
      ...personColumns,
      textColumn("rowKind", "Inventory holder"),
      textColumn("bookingStatus", "Booking status"),
      numberColumn("lockId", "Hold ID"),
      numberColumn("heldSeats", "Unnamed reserved or held seats"),
      dateColumn("holdExpiresAt", "Hold expiry UTC"),
    ],
    [
      ...people.map(row => ({
        ...row,
        rowKind: "passenger",
        heldSeats: null,
        lockId: null,
        holdExpiresAt: null,
      })),
      ...incompleteReservations.map(row => ({
        ...row,
        rowKind: "reservation_missing_passenger_identity",
        heldSeats: row.expectedPassengers - row.namedPassengers,
      })),
      ...unassigned
        .filter(row => row.heldSeats > row.namedPassengers)
        .map(row => ({
          ...row,
          heldSeats: row.heldSeats - row.namedPassengers,
          rowKind: "unallocated_inventory_lock",
        })),
      ...legacy.map(row => ({ ...row, rowKind: "unallocated_legacy_hold" })),
    ],
    [
      UTC_NOTE,
      "Reserved sectors and unexpired linked holds are included. Linked canonical hold aliases are not counted twice. Anonymous holds have no invented passenger names or booking references. A retained reservation with fewer verified passenger identities than its reserved quantity has an explicit unnamed-quantity row.",
    ]
  );
}

async function noTicketReport(
  db: ReportDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const rows = await db
    .select({
      ...flightFields(),
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      bookingStatus: bookings.status,
      bookingCreatedAt: bookings.createdAt,
      cabinClass: bookings.cabinClass,
      expectedPassengers: bookings.numberOfPassengers,
      passengerCount:
        sql<number>`(SELECT COUNT(*) FROM passengers ticket_person WHERE ${passengerOwner("ticket_person", "bookings")})`.mapWith(
          Number
        ),
      ticketedPassengers:
        sql<number>`(SELECT COUNT(*) FROM passengers ticket_person WHERE ${passengerOwner("ticket_person", "bookings")} AND ${currentCoupon("bookings", "ticket_person", "flights", sql`('O','C')`)})`.mapWith(
          Number
        ),
      legacyUnverifiedPassengers:
        sql<number>`(SELECT COUNT(*) FROM passengers ticket_person WHERE ${passengerOwner("ticket_person", "bookings")}
      AND ticket_person.ticketNumber IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ticket_coupons legacy_coupon
        WHERE legacy_coupon.bookingId = ${col("bookings", "id")} AND legacy_coupon.passengerId = ticket_person.id
          AND legacy_coupon.flightId = ${col("flights", "id")} AND legacy_coupon.ticketNumber = ticket_person.ticketNumber))`.mapWith(
          Number
        ),
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .innerJoin(bookings, membership("holding", now))
    .where(
      flightWhere(
        id,
        filters,
        scope,
        sql`(EXISTS (SELECT 1 FROM passengers missing_person WHERE ${passengerOwner("missing_person", "bookings")}
        AND NOT ${currentCoupon("bookings", "missing_person", "flights", sql`('O','C')`)})
        OR (SELECT COUNT(*) FROM passengers verified_person WHERE ${passengerOwner("verified_person", "bookings")}) < ${bookings.numberOfPassengers})
        ${
          id === 49
            ? sql`AND NOT EXISTS (SELECT 1 FROM passengers any_ticket_person WHERE ${passengerOwner("any_ticket_person", "bookings")}
          AND ${currentCoupon("bookings", "any_ticket_person", "flights", sql`('O','C')`)})`
            : sql``
        }`
      )
    )
    .orderBy(asc(flights.departureTime), asc(flights.id), asc(bookings.id))
    .limit(READ_LIMIT);
  return reportTable(
    [
      ...flightColumns,
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      textColumn("bookingStatus", "Booking status"),
      dateColumn("bookingCreatedAt", "Booking created UTC"),
      textColumn("cabinClass", "Cabin"),
      numberColumn("expectedPassengers", "Declared booking passengers"),
      numberColumn("passengerCount", "Recorded passengers"),
      numberColumn(
        "unnamedPassengerQuantity",
        "Declared passengers without verified identities"
      ),
      numberColumn("ticketedPassengers", "Current local ticketed passengers"),
      numberColumn(
        "missingCouponPassengers",
        "Passengers without current local coupon"
      ),
      numberColumn(
        "legacyUnverifiedPassengers",
        "Legacy identities without coupon evidence"
      ),
      textColumn("exceptionReason", "Exception reason"),
    ],
    rows.map(row => ({
      ...row,
      unnamedPassengerQuantity: Math.max(
        0,
        row.expectedPassengers - row.passengerCount
      ),
      missingCouponPassengers: row.passengerCount - row.ticketedPassengers,
      exceptionReason:
        row.legacyUnverifiedPassengers > 0
          ? "coupon_coverage_unverified"
          : row.passengerCount > row.ticketedPassengers
            ? "no_current_local_coupon"
            : "passenger_identity_incomplete",
    })),
    [
      UTC_NOTE,
      LOCAL_TICKET_NOTE,
      "Only sectors actually retaining inventory are included. Void, refunded and exchanged coupons do not grant current travel. Legacy passenger ticket numbers with no matching coupon are unverified, not proof that no external ticket exists.",
      "Expected passengers is the booking-declared quantity on a current inventory-holding sector; no separate segment passenger quantity is stored. Missing or inconsistent passenger identities remain an explicit unnamed quantity with unknown ticket coverage, not invented unticketed people or seats. Anonymous holds without a booking are reported by Flight Complete List.",
    ]
  );
}

async function noSeatPlan(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const rows = await db
    .select({
      ...flightFields(),
      expectedSeats:
        sql<number>`${flights.economySeats} + ${flights.businessSeats}`.mapWith(
          Number
        ),
      allocatedSeats:
        sql<number>`(SELECT COUNT(*) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")})`.mapWith(
          Number
        ),
      allocatedMaps:
        sql<number>`(SELECT COUNT(DISTINCT allocated_seat.seatMapId) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")})`.mapWith(
          Number
        ),
      allocatedEconomySeats:
        sql<number>`(SELECT COUNT(*) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")} AND allocated_seat.cabinClass = 'economy')`.mapWith(
          Number
        ),
      allocatedBusinessSeats:
        sql<number>`(SELECT COUNT(*) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")} AND allocated_seat.cabinClass = 'business')`.mapWith(
          Number
        ),
      invalidAllocatedSeats:
        sql<number>`(SELECT COUNT(*) FROM seat_inventory invalid_seat LEFT JOIN seat_maps configured_map ON configured_map.id = invalid_seat.seatMapId
      WHERE invalid_seat.flightId = ${col("flights", "id")} AND (configured_map.id IS NULL OR configured_map.active <> 1
        OR configured_map.airlineId <> ${col("flights", "airlineId")} OR configured_map.aircraftType <> ${col("flights", "aircraftType")} OR ${col("flights", "aircraftType")} IS NULL))`.mapWith(
          Number
        ),
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(
      flightWhere(
        48,
        filters,
        scope,
        sql`(NOT EXISTS (SELECT 1 FROM seat_inventory any_seat WHERE any_seat.flightId = ${col("flights", "id")})
      OR EXISTS (SELECT 1 FROM seat_inventory invalid_seat LEFT JOIN seat_maps configured_map ON configured_map.id = invalid_seat.seatMapId
        WHERE invalid_seat.flightId = ${col("flights", "id")} AND (configured_map.id IS NULL OR configured_map.active <> 1 OR configured_map.airlineId <> ${col("flights", "airlineId")}
          OR configured_map.aircraftType <> ${col("flights", "aircraftType")} OR ${col("flights", "aircraftType")} IS NULL))
      OR (SELECT COUNT(DISTINCT allocated_seat.seatMapId) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")}) > 1
      OR (SELECT COUNT(*) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")}) <> (${flights.economySeats} + ${flights.businessSeats})
      OR (SELECT COUNT(*) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")} AND allocated_seat.cabinClass = 'economy') <> ${flights.economySeats}
      OR (SELECT COUNT(*) FROM seat_inventory allocated_seat WHERE allocated_seat.flightId = ${col("flights", "id")} AND allocated_seat.cabinClass = 'business') <> ${flights.businessSeats})`
      )
    )
    .orderBy(asc(flights.departureTime), asc(flights.id))
    .limit(READ_LIMIT);
  return reportTable(
    [
      ...flightColumns,
      numberColumn("expectedSeats", "Flight physical capacity"),
      numberColumn("allocatedSeats", "Allocated seat rows"),
      numberColumn("allocatedEconomySeats", "Allocated economy seat rows"),
      numberColumn("allocatedBusinessSeats", "Allocated business seat rows"),
      numberColumn("allocatedMaps", "Allocated map identities"),
      numberColumn("invalidAllocatedSeats", "Invalid map seat rows"),
      textColumn("exceptionReason", "Exception reason"),
    ],
    rows.map(row => ({
      ...row,
      exceptionReason:
        row.allocatedSeats === 0
          ? "no_allocated_seat_inventory"
          : row.allocatedMaps > 1
            ? "multiple_allocated_maps"
            : row.invalidAllocatedSeats > 0
              ? "missing_inactive_or_mismatched_map"
              : "incomplete_or_mismatched_seat_inventory",
    })),
    [
      UTC_NOTE,
      "Catalog maps are not treated as flight allocations. Missing or incomplete inventory, conflicting map identities, cabin-capacity differences and inactive/carrier/aircraft mismatches are separate exceptions.",
    ]
  );
}

async function pnlStatus(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const statuses = [
    "not_generated",
    "draft",
    "queued",
    "sending",
    "sent",
    "received",
    "acknowledged",
    "rejected",
    "retry_scheduled",
    "failed",
  ];
  if (filters.status && !statuses.includes(filters.status))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown PNL status" });
  const rows = await db
    .select({
      ...flightFields(),
      transmissionId: operationalMessageTransmissions.id,
      messageDigest: operationalMessageTransmissions.messageDigest,
      pnlStatus: sql<string>`COALESCE(${operationalMessageTransmissions.status},'not_generated')`,
      generatedAt: operationalMessageTransmissions.createdAt,
      sentAt: operationalMessageTransmissions.sentAt,
      acknowledgedAt: operationalMessageTransmissions.acknowledgedAt,
      acknowledgmentCode: operationalMessageTransmissions.acknowledgmentCode,
      attemptCount: operationalMessageTransmissions.attemptCount,
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .leftJoin(
      operationalMessageTransmissions,
      and(
        eq(operationalMessageTransmissions.flightId, flights.id),
        eq(operationalMessageTransmissions.tenantId, flights.tenantId),
        eq(operationalMessageTransmissions.messageType, "PNL"),
        eq(operationalMessageTransmissions.direction, "outbound")
      )
    )
    .where(
      flightWhere(
        57,
        filters,
        scope,
        filters.status
          ? filters.status === "not_generated"
            ? sql`${operationalMessageTransmissions.id} IS NULL`
            : eq(
                operationalMessageTransmissions.status,
                filters.status as typeof operationalMessageTransmissions.$inferSelect.status
              )
          : undefined
      )
    )
    .orderBy(
      asc(flights.departureTime),
      asc(flights.id),
      asc(operationalMessageTransmissions.id)
    )
    .limit(READ_LIMIT);
  return reportTable(
    [
      ...flightColumns,
      numberColumn("transmissionId", "PNL version ID"),
      textColumn("messageDigest", "Message SHA-256"),
      textColumn("pnlStatus", "PNL status"),
      dateColumn("generatedAt", "Stored UTC"),
      dateColumn("sentAt", "Sent UTC"),
      dateColumn("acknowledgedAt", "Acknowledged UTC"),
      textColumn("acknowledgmentCode", "Acknowledgment code"),
      numberColumn("attemptCount", "Transport attempts"),
    ],
    rows,
    [
      UTC_NOTE,
      "One row per recorded outbound PNL version; flights with no stored PNL retain a not_generated row. No transport action or external acceptance is inferred from a draft.",
    ]
  );
}

async function pnlDraft(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date,
  flight: FlightRow
) {
  if (flight.tenantId == null)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A tenant-owned flight is required to select its PNL route",
    });
  const [route] = await db
    .select()
    .from(operationalMessageRoutes)
    .where(
      and(
        eq(operationalMessageRoutes.tenantId, flight.tenantId),
        eq(operationalMessageRoutes.stationCode, flight.origin),
        eq(operationalMessageRoutes.messageType, "PNL")
      )
    )
    .limit(1);
  if (!route)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Configure the airline's PNL route and Type-B addresses before generating a draft",
    });
  const people = await readPeople(db, 56, filters, scope, now);
  if (people.length > 999)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This operator PNL template supports at most 999 passengers; split-message acceptance is required",
    });
  let draft: ReturnType<typeof generateOperationalDraft>;
  try {
    draft = generateOperationalDraft({
      messageType: "PNL",
      route: {
        originAddress: route.originAddress,
        destinationAddress: route.destinationAddress,
        stationCode: route.stationCode,
        transportProfile: route.transportProfile,
        enabled: route.enabled,
        acceptedAt: route.acceptedAt?.toISOString() ?? null,
      },
      payload: {
        flightNumber: flight.flightNumber,
        flightDate: flight.departureTime.toISOString().slice(0, 10),
        origin: flight.origin,
        destination: flight.destination,
        passengers: people.map(person => ({
          recordLocator: person.pnr,
          surname: person.lastName.toUpperCase(),
          givenName: person.firstName.toUpperCase(),
          ...(person.seatNumber ? { seatNumber: person.seatNumber } : {}),
        })),
      },
    });
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "PNL data does not match the configured operator template. Verify Type-B addresses, flight designator, Latin passenger names and seat identifiers; no passenger was omitted or transliterated.",
    });
  }
  return reportTable(
    [
      ...flightColumns,
      numberColumn("passengerCount", "Passengers"),
      textColumn("draftStatus", "Draft status"),
      textColumn("messageDigest", "Message SHA-256"),
      textColumn("messageContent", "PNL operator-template draft"),
    ],
    [
      {
        ...flight,
        passengerCount: people.length,
        draftStatus: "generated_not_persisted",
        messageDigest: draft.messageDigest,
        messageContent: draft.messageContent,
      },
    ],
    [
      UTC_NOTE,
      "This read generates an operator-template draft only. It is not persisted, queued, sent or acknowledged. External carrier/profile acceptance is required before transmission.",
    ]
  );
}

async function inventoryReport(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date,
  base: FlightRow[]
) {
  const waitCounts = await db
    .select({
      flightId: flights.id,
      economyWaitlist:
        sql<number>`(SELECT COALESCE(SUM(wait_record.seats),0) FROM waitlist wait_record WHERE wait_record.flightId = ${col("flights", "id")} AND wait_record.cabinClass = 'economy' AND wait_record.status = 'waiting')`.mapWith(
          Number
        ),
      businessWaitlist:
        sql<number>`(SELECT COALESCE(SUM(wait_record.seats),0) FROM waitlist wait_record WHERE wait_record.flightId = ${col("flights", "id")} AND wait_record.cabinClass = 'business' AND wait_record.status = 'waiting')`.mapWith(
          Number
        ),
    })
    .from(flights)
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(flightWhere(84, filters, scope))
    .orderBy(asc(flights.departureTime), asc(flights.id))
    .limit(READ_LIMIT);
  const rbds = await db
    .select({
      ...flightFields(),
      cabinClass: fareClasses.cabinClass,
      fareClassId: fareClasses.id,
      rbd: fareClasses.code,
      classActive: fareClasses.active,
      capacity: flightFareClassInventory.capacity,
      recordedAvailable: flightFareClassInventory.availableSeats,
      held: sql<number>`(SELECT COALESCE(SUM(rbd_hold.numberOfSeats),0) FROM inventory_locks rbd_hold
      WHERE rbd_hold.flightId = ${col("flights", "id")} AND rbd_hold.fareClassId = ${col("fare_classes", "id")}
        AND rbd_hold.status = 'active' AND rbd_hold.expiresAt > ${nowSql(now)})`.mapWith(
        Number
      ),
    })
    .from(flightFareClassInventory)
    .innerJoin(flights, eq(flights.id, flightFareClassInventory.flightId))
    .innerJoin(
      fareClasses,
      and(
        eq(fareClasses.id, flightFareClassInventory.fareClassId),
        eq(fareClasses.airlineId, flights.airlineId)
      )
    )
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(flightWhere(84, filters, scope))
    .orderBy(asc(flights.departureTime), asc(flights.id), asc(fareClasses.id))
    .limit(READ_LIMIT);
  assertBound(waitCounts);
  assertBound(rbds);
  const waiting = new Map(waitCounts.map(row => [row.flightId, row]));
  const physical = new Map(
    base.map(row => [row.flightId, inventoryValues(row)])
  );
  const cabinRows = base.flatMap(row =>
    (["economy", "business"] as const).map(cabin => ({
      ...row,
      level: "cabin",
      cabinClass: cabin,
      rbd: null,
      fareClassId: null,
      capacity: cabin === "economy" ? row.economySeats : row.businessSeats,
      recordedAvailable:
        cabin === "economy"
          ? row.economyRecordedAvailable
          : row.businessRecordedAvailable,
      held: cabin === "economy" ? row.economyHeld : row.businessHeld,
      effectiveAvailable:
        cabin === "economy"
          ? requireValue(physical.get(row.flightId)).economyAvailable
          : requireValue(physical.get(row.flightId)).businessAvailable,
      waitlistedSeats:
        cabin === "economy"
          ? (waiting.get(row.flightId)?.economyWaitlist ?? 0)
          : (waiting.get(row.flightId)?.businessWaitlist ?? 0),
      classActive: true,
    }))
  );
  const classRows = rbds.map(row => {
    const flight = requireValue(physical.get(row.flightId));
    const cabinAvailable =
      row.cabinClass === "economy"
        ? flight.economyAvailable
        : row.cabinClass === "business"
          ? flight.businessAvailable
          : null;
    return {
      ...row,
      level: "rbd",
      effectiveAvailable: !row.classActive
        ? 0
        : cabinAvailable == null
          ? null
          : Math.max(
              0,
              Math.min(cabinAvailable, row.recordedAvailable - row.held)
            ),
      waitlistedSeats: null,
    };
  });
  return reportTable(
    [
      ...flightColumns,
      textColumn("level", "Inventory level"),
      textColumn("cabinClass", "Cabin"),
      numberColumn("fareClassId", "Fare class ID"),
      textColumn("rbd", "RBD"),
      { key: "classActive", label: "Class active", type: "boolean" },
      numberColumn("capacity", "Capacity"),
      numberColumn("recordedAvailable", "Recorded available"),
      numberColumn("sold", "Recorded sold seats"),
      numberColumn("held", "Active holds"),
      numberColumn("effectiveAvailable", "Effective physical available"),
      numberColumn("waitlistedSeats", "Waiting seats"),
    ],
    [...cabinRows, ...classRows].map(row => ({
      ...row,
      sold: row.capacity - row.recordedAvailable,
    })),
    [
      UTC_NOTE,
      "RBD rows are subsets of cabin inventory, not additional seats. RBD availability is capped by the physical cabin and active status; waitlists have no RBD attribution. Linked legacy hold aliases are excluded from cabin hold totals.",
    ]
  );
}

async function orphanTickets(
  db: ReportDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  now: Date
) {
  const rows = await db
    .select({
      ...flightFields(),
      couponId: ticketCoupons.id,
      ticketNumber: ticketCoupons.ticketNumber,
      couponNumber: ticketCoupons.couponNumber,
      couponStatus: ticketCoupons.status,
      bookingId: ticketCoupons.bookingId,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      passengerId: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      couponCreatedAt: ticketCoupons.createdAt,
      exceptionReason: sql<string>`CASE WHEN ${bookings.id} IS NULL THEN 'missing_booking' WHEN ${bookings.deletedAt} IS NOT NULL THEN 'deleted_booking'
      WHEN ${bookings.status} = 'cancelled' THEN 'cancelled_booking' ELSE 'missing_or_cancelled_sector' END`,
    })
    .from(ticketCoupons)
    .innerJoin(flights, eq(flights.id, ticketCoupons.flightId))
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .leftJoin(bookings, eq(bookings.id, ticketCoupons.bookingId))
    .leftJoin(
      passengers,
      and(
        eq(passengers.id, ticketCoupons.passengerId),
        passengerOwner("passengers", "bookings")
      )
    )
    .where(
      flightWhere(
        93,
        filters,
        scope,
        sql`${ticketCoupons.status} IN ('O','C')
      AND (${bookings.id} IS NULL OR ${equalTenant("bookings", "flights")})
      AND (${passengers.ticketNumber} IS NULL OR ${passengers.ticketNumber} = ${ticketCoupons.ticketNumber})
      AND (${bookings.id} IS NULL OR NOT ${membership("reservations", now)})`
      )
    )
    .orderBy(asc(flights.departureTime), asc(flights.id), asc(ticketCoupons.id))
    .limit(READ_LIMIT);
  return reportTable(
    [
      ...flightColumns,
      numberColumn("couponId", "Coupon ID"),
      textColumn("ticketNumber", "Local ticket number"),
      numberColumn("couponNumber", "Coupon number"),
      textColumn("couponStatus", "Coupon status"),
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      numberColumn("passengerId", "Verified passenger ID"),
      textColumn("firstName", "Verified given name"),
      textColumn("lastName", "Verified surname"),
      dateColumn("couponCreatedAt", "Coupon created UTC"),
      textColumn("exceptionReason", "Exception reason"),
    ],
    rows,
    [
      UTC_NOTE,
      LOCAL_TICKET_NOTE,
      "Period refers to the coupon flight's departure date. Refunded, void, exchanged and used coupons are excluded; passenger names require an exact same-booking tenant-safe match.",
    ]
  );
}

export async function getOperationsStandardReport(
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
): Promise<StandardReportTable | undefined> {
  const spec = operationsReportDefinitions.find(report => report.id === id);
  if (!spec) return undefined;
  if (spec.availability === "blocked")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: spec.limitations.join(" "),
    });
  if (
    spec.filters.length === 1 &&
    spec.filters[0] === "flightId" &&
    !filters.flightId
  )
    throw new TRPCError({ code: "BAD_REQUEST", message: "Select a flight ID" });
  if ([26, 57, 64].includes(id) && !filters.origin)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select the origin airport IATA code",
    });
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Report database is unavailable",
    });
  const now = new Date();
  return db.transaction(
    async tx => {
      const base = await readFlightRows(tx, id, filters, scope, now);
      if (filters.flightId && base.length === 0)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flight not found in the selected report scope",
        });
      if ([2, 64].includes(id))
        return documentReport(tx, id, filters, scope, now);
      if ([3, 18, 20, 25, 53].includes(id))
        return reportTable(
          personColumns,
          await readPeople(tx, id, filters, scope, now),
          [UTC_NOTE]
        );
      if ([5, 14, 19, 27, 54].includes(id))
        return passengerCounts(tx, id, filters, scope, now);
      if ([15, 16, 44, 45].includes(id))
        return reportTable(
          availabilityColumns,
          base
            .map(inventoryValues)
            .filter(
              row => id !== 45 || (row.capacity > 0 && row.sold >= row.capacity)
            ),
          [
            UTC_NOTE,
            "Recorded available inventory is reduced by active, unexpired canonical and unlinked legacy holds. Expired, converted and duplicate linked aliases are excluded. Load factors use sold inventory; zero-capacity factors remain null.",
          ]
        );
      if (id === 17) return fullManifest(tx, filters, scope, now);
      if (id === 22 || id === 26)
        return reportTable(
          [
            ...flightColumns,
            textColumn("originTimezone", "Origin time zone"),
            textColumn("destinationTimezone", "Destination time zone"),
          ],
          base,
          [UTC_NOTE]
        );
      if (id === 23) return holdingList(tx, filters, scope, now);
      if (id === 48) return noSeatPlan(tx, filters, scope);
      if ([49, 73].includes(id))
        return noTicketReport(tx, id, filters, scope, now);
      if (id === 56) return pnlDraft(tx, filters, scope, now, base[0]);
      if (id === 57) return pnlStatus(tx, filters, scope);
      if (id === 72)
        return reportTable(
          [
            ...personColumns,
            textColumn("bookingStatus", "Booking status"),
            dateColumn("bookingCreatedAt", "Booking created UTC"),
          ],
          await readPeople(tx, id, filters, scope, now, "reservations"),
          [
            UTC_NOTE,
            "The period is the actual flight-sector departure date, not the booking creation date. Cancelled or removed sectors are excluded; creation date is a separate column.",
          ]
        );
      if (id === 84) return inventoryReport(tx, filters, scope, now, base);
      if (id === 92)
        return reportTable(
          [
            ...personColumns,
            textColumn("ticketNumber", "Current local ticket number"),
          ],
          await readPeople(
            tx,
            id,
            filters,
            scope,
            now,
            "manifest",
            noShow("passengers", "bookings", "flights")
          ),
          [
            UTC_NOTE,
            LOCAL_TICKET_NOTE,
            "Requires explicit DCS close and an open local coupon. Existing check-in/boarding/offload states and history, checked-in seats and ambiguous booking-wide legacy check-ins prevent a no-show conclusion.",
          ]
        );
      if (id === 93) return orphanTickets(tx, filters, scope, now);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Report reader is not registered",
      });
    },
    { isolationLevel: "repeatable read" }
  );
}
