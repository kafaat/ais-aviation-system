import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  eq,
  exists,
  gte,
  getTableColumns,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import {
  agentBookings,
  airports,
  ancillaryServices,
  aviationEvidence,
  bookingAncillaries,
  bookingFareComponents,
  bookings,
  financialLedger,
  flights,
  outbox,
  passengers,
  payments,
  ticketCoupons,
  travelAgents,
} from "../../drizzle/schema";
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
import {
  dateColumn,
  numberColumn,
  reportTable,
  standardReportPeriod,
  textColumn,
} from "./standard-report-utils";

type ReadDb = Pick<NonNullable<ReturnType<typeof getDb>>, "select">;
const limit = STANDARD_REPORT_ROW_LIMIT + 1;
const origin = alias(airports, "finance_report_origin");
const destination = alias(airports, "finance_report_destination");
const periodKeys: StandardReportFilterKey[] = ["startDate", "endDate"];
const couponKeys: StandardReportFilterKey[] = [
  ...periodKeys,
  "flightId",
  "bookingReference",
  "ticketNumber",
  "couponNumber",
  "origin",
  "destination",
  "status",
];
const routeKeys: StandardReportFilterKey[] = [
  ...periodKeys,
  "flightId",
  "origin",
  "destination",
];
const localDocumentNote =
  "Ticket numbers and coupon states are AIS local document records. Local creation can materialize a legacy document; it does not prove an external carrier issue time or acceptance.";
const componentNote =
  "Amounts are integer minor units in the stated currency. Fare components are commercial source lines, not approved tax determinations. OFFER_TAX_ESTIMATE remains an estimate. Booking-level or ambiguously mapped lines are never copied onto every coupon.";
const officeNote =
  "The system has no authoritative sales/issue-office relationship. Office is unknown; an agency or sales channel is not substituted for an office.";
const upliftNote =
  "Only an F coupon with exactly one matching persisted coupon_uplift receipt is included. Check-in, boarding and completed flight status alone are insufficient. Production uplift ingestion remains subject to external acceptance.";
const revenueNote =
  "Booked, local-document and uplift amounts describe separately dated commercial component values. They are not recognized accounting revenue. Bookings without a fare-component snapshot cannot contribute a value; this is not the full invoice or ledger total. Revenue recognition remains unknown pending funding, tax, loyalty allocation and accepted carrier evidence reconciliation.";

function definition(
  id: number,
  title: string,
  description: string,
  filters: StandardReportFilterKey[],
  limitations: string[] = [],
  availability: StandardReportDefinition["availability"] = "partial"
): StandardReportDefinition {
  return {
    id,
    title,
    category: "finance",
    availability,
    description,
    filters,
    limitations,
  };
}

/** Availability describes the full reference example, independently of whether a useful local reader exists. */
export const financeReportDefinitions: StandardReportDefinition[] = [
  definition(
    6,
    "Eticket Status",
    "Current coupon states for a specified local ticket number.",
    ["ticketNumber", "couponNumber", "status"],
    [localDocumentNote],
    "available"
  ),
  definition(
    7,
    "ETL Processing",
    "Accepted handler ETL receipts and their processed coupons.",
    [],
    [
      "Production handler ETL acceptance and the daily accepted/rejected receipt register are not available.",
    ],
    "blocked"
  ),
  definition(
    8,
    "Eticket Values",
    "Local documents created in a UTC period with their traceable fare-component lines.",
    couponKeys,
    [localDocumentNote, componentNote]
  ),
  definition(
    9,
    "Eticket Value (PNR)",
    "All local ticket coupons and monetary source lines for a specified PNR or booking reference.",
    ["bookingReference"],
    [localDocumentNote, componentNote]
  ),
  definition(
    10,
    "Expired Tickets",
    "Documents whose authoritative validity period has expired.",
    [],
    [
      "Document validity dates and the operator's expiry policy are not recorded. Booking or payment expiry is not ticket expiry.",
    ],
    "blocked"
  ),
  definition(
    28,
    "Form Of Payments",
    "Payment records by creation period and method, with current attempt status.",
    [...periodKeys, "bookingReference", "status"],
    [officeNote, "Payment attempts are separate from settled ledger movements."]
  ),
  definition(
    38,
    "Interline Etickets",
    "Accepted IATA IET documents and bookings.",
    [],
    [
      "Accepted interline issue receipts and coupon mappings are not available.",
    ],
    "blocked"
  ),
  definition(
    39,
    "Interline IDEC Files",
    "Transactions in an accepted IDEC file.",
    [],
    [
      "An accepted IDEC specification, importer and partner file receipt are required.",
    ],
    "blocked"
  ),
  definition(
    40,
    "Interline Values",
    "Actual interline coupon values and settlement shares.",
    [],
    [
      "Accepted interline coupon and settlement evidence is required; a prorate estimate is insufficient.",
    ],
    "blocked"
  ),
  definition(
    43,
    "Lifted Tickets",
    "Local coupons with recorded uplift proof, selected by flight departure date.",
    [
      ...periodKeys,
      "flightId",
      "bookingReference",
      "ticketNumber",
      "origin",
      "destination",
    ],
    [upliftNote]
  ),
  definition(
    55,
    "Payments",
    "All authorized payment records in a UTC creation period, including method, provider and current status.",
    [...periodKeys, "bookingReference", "status"],
    [
      "A payment record is not proof of settlement. Use the ledger-movement report for cash and non-cash settlement.",
    ],
    "available"
  ),
  definition(
    66,
    "Remittances",
    "Receipted transfers from a sales office.",
    [],
    ["No authoritative sales-office remittance register exists."],
    "blocked"
  ),
  definition(
    67,
    "Revenue Post Departure",
    "Uplifted local coupon component values by flight date, retaining their proof references.",
    [
      ...periodKeys,
      "flightId",
      "bookingReference",
      "ticketNumber",
      "origin",
      "destination",
    ],
    [officeNote, upliftNote, componentNote, revenueNote]
  ),
  definition(
    68,
    "Refunds",
    "Posted refund and partial-refund ledger entries by transaction date, keeping cash and non-cash tenders distinct.",
    [...periodKeys, "bookingReference"],
    [officeNote]
  ),
  definition(
    69,
    "Reported Sales By Office",
    "Local document fare-component lines by record creation period; office attribution is explicitly unavailable.",
    couponKeys,
    [officeNote, localDocumentNote, componentNote]
  ),
  definition(
    70,
    "Reported Sales System Wide",
    "All posted booking ledger movements by transaction date, including charges and their refund reversals.",
    [...periodKeys, "bookingReference"],
    [
      "This is a settlement movement register. A settlement does not establish the ticket sale/issue event required for full equivalence.",
    ]
  ),
  definition(
    71,
    "Reported Excess Baggage Sales",
    "Funded baggage product line items with their recorded funding reference and lifecycle state.",
    [...periodKeys, "bookingReference", "status"],
    [
      officeNote,
      "The product catalogue identifies baggage but does not classify airport excess-weight sales. Excess classification and net item refund allocation remain unknown.",
    ]
  ),
  definition(
    75,
    "Revenue System Wide",
    "Separately dated booking, local-document and evidenced uplift component values, grouped by UTC Monday-start week.",
    routeKeys,
    [localDocumentNote, componentNote, revenueNote]
  ),
  definition(
    76,
    "Revenue Daily Flight",
    "Separately dated booking, local-document and evidenced uplift component values, grouped by UTC day.",
    routeKeys,
    [localDocumentNote, componentNote, revenueNote]
  ),
  definition(
    77,
    "Revenue By Route",
    "All route/day groups for separately dated component values; no top-route truncation.",
    routeKeys,
    [localDocumentNote, componentNote, revenueNote]
  ),
  definition(
    78,
    "Revenue By Flight",
    "Separately dated component values for every matching flight identity.",
    routeKeys,
    [localDocumentNote, componentNote, revenueNote]
  ),
  definition(
    79,
    "Revenue By Passenger",
    "Passenger/sector component lines with independent booking, local-document and uplift dates.",
    routeKeys,
    [localDocumentNote, componentNote, revenueNote]
  ),
  definition(
    80,
    "Revenue Flight Number",
    "Component values by dated flight identity, filterable by flight ID and departure city/airport.",
    routeKeys,
    [localDocumentNote, componentNote, revenueNote]
  ),
  definition(
    81,
    "Revenue By Route",
    "Recorded uplift component values grouped by sector route and observation date.",
    routeKeys,
    [upliftNote, componentNote, revenueNote]
  ),
  definition(
    82,
    "Revenue Tickets",
    "Local ticket component values with document identity and explicit unknown office attribution.",
    couponKeys,
    [officeNote, componentNote, revenueNote]
  ),
  definition(
    83,
    "Revenue By Route And Month",
    "Monthly route component values; the reference's sales-office dimension remains unavailable.",
    routeKeys,
    [officeNote, componentNote, revenueNote]
  ),
  definition(
    85,
    "Sales",
    "Local document creation records with the actual linked agency, coupon and traceable component values.",
    couponKeys,
    [
      localDocumentNote,
      componentNote,
      "Agency attribution uses the unique agent-booking relation; it is not a GDS or office attribution.",
    ]
  ),
  definition(
    86,
    "Sales All",
    "Local ticket document records and components by their recorded creation date.",
    couponKeys,
    [
      localDocumentNote,
      componentNote,
      "Original sale timestamps and every exchange/reversal-to-document monetary mapping remain unavailable.",
    ]
  ),
  definition(
    87,
    "Sales by City",
    "Sales grouped by the city of the actual point of sale.",
    [],
    [
      "No authoritative point-of-sale city is stored. A flight's origin city cannot replace it.",
    ],
    "blocked"
  ),
  definition(
    88,
    "Tax Codes",
    "Configured operator-approved tax codes and effective policies.",
    [],
    [
      "The application has offer tax estimates, not an operator-approved tax-code registry.",
    ],
    "blocked"
  ),
  definition(
    89,
    "Ticket Calculation",
    "All recorded local coupon calculations and source components, including unmapped and reversed lines.",
    couponKeys,
    [localDocumentNote, componentNote]
  ),
  definition(
    90,
    "Ticket Coupons",
    "Details of one ticket/coupon, its current state, monetary source lines and matching uplift receipt.",
    ["ticketNumber", "couponNumber"],
    [
      localDocumentNote,
      componentNote,
      "A complete immutable history of every coupon state is not yet recorded.",
    ]
  ),
  definition(
    94,
    "Ticket Status",
    "Current states of local coupons whose document rows were created during the selected UTC period.",
    couponKeys,
    [
      localDocumentNote,
      "This is current status by local record creation date, not a historical status-at-cutoff reconstruction.",
    ]
  ),
  definition(
    95,
    "Ticket Used",
    "Used local coupons with one matching uplift receipt; a partially used document remains identifiable by coupon number.",
    [
      ...periodKeys,
      "flightId",
      "bookingReference",
      "ticketNumber",
      "origin",
      "destination",
    ],
    [upliftNote]
  ),
  definition(
    96,
    "Tickets Voided",
    "Persisted coupon-void events by event time, retaining a prior V transition after a subsequent refund.",
    [
      ...periodKeys,
      "bookingReference",
      "ticketNumber",
      "couponNumber",
      "flightId",
    ],
    [
      "Reads retained transactional outbox closure receipts. Legacy changes without receipts and pruned outbox history cannot be reconstructed; current V state is not substituted for a void event.",
    ]
  ),
  definition(
    98,
    "Web Bookings without Credit Card Authorizations",
    "IBE bookings missing a required card authorization.",
    [],
    [
      "A trusted IBE channel and card authorization register are required. A provider payment ID or pending state is not an authorization code.",
    ],
    "blocked"
  ),
  definition(
    99,
    "Web Bookings On TTL",
    "IBE bookings holding inventory under an actual ticketing time limit.",
    [],
    [
      "An authoritative IBE channel and ticketing deadline are not recorded. Inventory lock or checkout expiry is not substituted for a commercial ticketing time limit.",
    ],
    "blocked"
  ),
];

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function bounded<T>(rows: T[]): T[] {
  if (rows.length >= limit)
    badRequest(
      "The report exceeds 10000 source rows. Narrow the filters; no rows were silently omitted."
    );
  return rows;
}
function scopeCondition(column: AnyColumn, scope: StandardReportScope) {
  return scope.tenantId === undefined ? undefined : eq(column, scope.tenantId);
}
function sameTenant(left: AnyColumn, right: AnyColumn) {
  return or(eq(left, right), and(isNull(left), isNull(right)));
}
function ownedNullableTenant(child: AnyColumn) {
  return or(isNull(child), eq(child, bookings.tenantId));
}
function dates(column: AnyColumn, filters: StandardReportFilters) {
  const period = standardReportPeriod(filters);
  return and(
    period.start ? gte(column, period.start) : undefined,
    period.end ? lt(column, period.end) : undefined
  );
}
function referenceFilter(filters: StandardReportFilters) {
  const reference = filters.bookingReference?.toUpperCase();
  return reference
    ? or(eq(bookings.bookingReference, reference), eq(bookings.pnr, reference))
    : undefined;
}
function routeFilter(filters: StandardReportFilters) {
  return and(
    filters.flightId ? eq(flights.id, filters.flightId) : undefined,
    filters.origin
      ? or(
          eq(origin.code, filters.origin.toUpperCase()),
          eq(origin.city, filters.origin)
        )
      : undefined,
    filters.destination
      ? or(
          eq(destination.code, filters.destination.toUpperCase()),
          eq(destination.city, filters.destination)
        )
      : undefined
  );
}
function integerAmount(value: unknown): number {
  const n = Number(value);
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    typeof value === "boolean" ||
    !Number.isSafeInteger(n)
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A monetary source value requires reconciliation",
    });
  }
  return n;
}
/** Parse decimal database values without floating-point multiplication. */
function ledgerMinor(value: string) {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A ledger amount requires reconciliation",
    });
  const amount = Number(match[2]) * 100 + Number(match[3]);
  return integerAmount(match[1] ? -amount : amount);
}
function object(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function presentString(value: unknown) {
  return typeof value === "string" && value.length ? value : null;
}
function periodContains(
  at: Date | null | undefined,
  filters: StandardReportFilters
) {
  if (!at) return false;
  const { start, end } = standardReportPeriod(filters);
  return (!start || at >= start) && (!end || at < end);
}

async function loadCoupons(
  db: ReadDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  dateBasis: "created" | "departure" | "none" = "created",
  bookingIds?: number[]
) {
  if (bookingIds && !bookingIds.length) return [];
  return bounded(
    await db
      .select({
        couponId: ticketCoupons.id,
        ticketNumber: ticketCoupons.ticketNumber,
        couponNumber: ticketCoupons.couponNumber,
        status: ticketCoupons.status,
        couponCreatedAt: ticketCoupons.createdAt,
        statusUpdatedAt: ticketCoupons.updatedAt,
        bookingId: bookings.id,
        tenantId: bookings.tenantId,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        bookingCreatedAt: bookings.createdAt,
        bookingStatus: bookings.status,
        passengerId: passengers.id,
        firstName: passengers.firstName,
        lastName: passengers.lastName,
        flightId: flights.id,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        origin: origin.code,
        destination: destination.code,
        agencyId: agentBookings.agentId,
        agencyName: travelAgents.agencyName,
      })
      .from(ticketCoupons)
      .innerJoin(bookings, eq(bookings.id, ticketCoupons.bookingId))
      .innerJoin(
        flights,
        and(
          eq(flights.id, ticketCoupons.flightId),
          sameTenant(flights.tenantId, bookings.tenantId)
        )
      )
      .innerJoin(
        passengers,
        and(
          eq(passengers.id, ticketCoupons.passengerId),
          eq(passengers.bookingId, bookings.id),
          ownedNullableTenant(passengers.tenantId)
        )
      )
      .innerJoin(origin, eq(origin.id, flights.originId))
      .innerJoin(destination, eq(destination.id, flights.destinationId))
      .leftJoin(agentBookings, eq(agentBookings.bookingId, bookings.id))
      .leftJoin(travelAgents, eq(travelAgents.id, agentBookings.agentId))
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          bookingIds ? inArray(bookings.id, bookingIds) : undefined,
          referenceFilter(filters),
          routeFilter(filters),
          filters.ticketNumber
            ? eq(ticketCoupons.ticketNumber, filters.ticketNumber)
            : undefined,
          filters.couponNumber
            ? eq(ticketCoupons.couponNumber, filters.couponNumber)
            : undefined,
          filters.status
            ? eq(
                ticketCoupons.status,
                filters.status as typeof ticketCoupons.$inferSelect.status
              )
            : undefined,
          dateBasis === "none"
            ? undefined
            : dates(
                dateBasis === "departure"
                  ? flights.departureTime
                  : ticketCoupons.createdAt,
                filters
              )
        )
      )
      .orderBy(asc(ticketCoupons.createdAt), asc(ticketCoupons.id))
      .limit(limit)
  );
}
type CouponRow = Awaited<ReturnType<typeof loadCoupons>>[number];

async function loadComponents(
  db: ReadDb,
  scope: StandardReportScope,
  filters: StandardReportFilters = {},
  bookingIds?: number[],
  includeRevenuePeriod = false
) {
  if (bookingIds && !bookingIds.length) return [];
  const periodCoupon = alias(ticketCoupons, "finance_period_coupon");
  const periodUplift = alias(aviationEvidence, "finance_period_uplift");
  return bounded(
    await db
      .select({
        componentId: bookingFareComponents.id,
        bookingId: bookingFareComponents.bookingId,
        passengerId: bookingFareComponents.passengerId,
        flightId: bookingFareComponents.flightId,
        componentType: bookingFareComponents.componentType,
        code: bookingFareComponents.code,
        amountMinor: bookingFareComponents.amount,
        currency: bookingFareComponents.currency,
        source: bookingFareComponents.source,
        sourceReference: bookingFareComponents.sourceReference,
        policyVersion: bookingFareComponents.policyVersion,
        recordedAt: bookingFareComponents.createdAt,
        reversedAt: bookingFareComponents.reversedAt,
        bookingCreatedAt: bookings.createdAt,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        tenantId: bookings.tenantId,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        origin: origin.code,
        destination: destination.code,
      })
      .from(bookingFareComponents)
      .innerJoin(bookings, eq(bookings.id, bookingFareComponents.bookingId))
      .innerJoin(
        flights,
        and(
          eq(flights.id, bookingFareComponents.flightId),
          sameTenant(flights.tenantId, bookings.tenantId)
        )
      )
      .innerJoin(origin, eq(origin.id, flights.originId))
      .innerJoin(destination, eq(destination.id, flights.destinationId))
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          ownedNullableTenant(bookingFareComponents.tenantId),
          or(
            isNull(bookingFareComponents.passengerId),
            exists(
              db
                .select({ one: sql`1` })
                .from(passengers)
                .where(
                  and(
                    eq(passengers.id, bookingFareComponents.passengerId),
                    eq(passengers.bookingId, bookings.id),
                    ownedNullableTenant(passengers.tenantId)
                  )
                )
            )
          ),
          referenceFilter(filters),
          routeFilter(filters),
          bookingIds ? inArray(bookings.id, bookingIds) : undefined,
          includeRevenuePeriod
            ? or(
                dates(bookings.createdAt, filters),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(periodCoupon)
                    .where(
                      and(
                        eq(periodCoupon.bookingId, bookings.id),
                        eq(
                          periodCoupon.flightId,
                          bookingFareComponents.flightId
                        ),
                        dates(periodCoupon.createdAt, filters)
                      )
                    )
                ),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(periodUplift)
                    .where(
                      and(
                        eq(periodUplift.kind, "coupon_uplift"),
                        sameTenant(periodUplift.tenantId, bookings.tenantId),
                        eq(
                          periodUplift.flightId,
                          bookingFareComponents.flightId
                        ),
                        sql`COALESCE(JSON_EXTRACT(${periodUplift.ingestSnapshot}, '$.bookingId'), JSON_EXTRACT(${periodUplift.payload}, '$.bookingId')) = ${bookings.id}`,
                        dates(periodUplift.observedAt, filters)
                      )
                    )
                )
              )
            : undefined
        )
      )
      .orderBy(asc(bookingFareComponents.id))
      .limit(limit)
  );
}
type ComponentRow = Awaited<ReturnType<typeof loadComponents>>[number];

async function loadUplift(
  db: ReadDb,
  coupons: CouponRow[],
  scope: StandardReportScope
) {
  if (!coupons.length)
    return new Map<number, (typeof aviationEvidence.$inferSelect)[]>();
  const proofCoupon = alias(ticketCoupons, "finance_uplift_coupon");
  const proofBooking = alias(bookings, "finance_uplift_booking");
  const proofFlight = alias(flights, "finance_uplift_flight");
  // Use the same complete reference object as the in-memory verifier. A
  // partially populated ingest snapshot must not borrow payload fields.
  const reference = sql`CASE WHEN LOWER(JSON_TYPE(${aviationEvidence.ingestSnapshot})) = 'object'
    THEN ${aviationEvidence.ingestSnapshot} ELSE ${aviationEvidence.payload} END`;
  const referenceId = (field: "couponId" | "bookingId" | "passengerId") =>
    sql`JSON_EXTRACT(${reference}, ${`$.${field}`})`;
  const rows = bounded(
    await db
      .select(getTableColumns(aviationEvidence))
      .from(aviationEvidence)
      .innerJoin(
        proofCoupon,
        and(
          sql`${referenceId("couponId")} = ${proofCoupon.id}`,
          sql`${referenceId("bookingId")} = ${proofCoupon.bookingId}`,
          sql`${referenceId("passengerId")} = ${proofCoupon.passengerId}`,
          eq(aviationEvidence.flightId, proofCoupon.flightId)
        )
      )
      .innerJoin(
        proofBooking,
        and(
          eq(proofBooking.id, proofCoupon.bookingId),
          sameTenant(aviationEvidence.tenantId, proofBooking.tenantId)
        )
      )
      .innerJoin(
        proofFlight,
        and(
          eq(proofFlight.id, proofCoupon.flightId),
          sameTenant(proofFlight.tenantId, proofBooking.tenantId)
        )
      )
      .where(
        and(
          eq(aviationEvidence.kind, "coupon_uplift"),
          scopeCondition(aviationEvidence.tenantId, scope),
          inArray(
            proofCoupon.id,
            coupons.map(coupon => coupon.couponId)
          ),
          sql`LOWER(JSON_TYPE(${referenceId("couponId")})) = 'integer'`,
          sql`LOWER(JSON_TYPE(${referenceId("bookingId")})) = 'integer'`,
          sql`LOWER(JSON_TYPE(${referenceId("passengerId")})) = 'integer'`,
          gte(aviationEvidence.observedAt, proofCoupon.createdAt),
          gte(aviationEvidence.observedAt, proofFlight.departureTime)
        )
      )
      .orderBy(asc(aviationEvidence.observedAt), asc(aviationEvidence.id))
      .limit(limit)
  );
  const grouped = new Map<number, (typeof aviationEvidence.$inferSelect)[]>();
  const byId = new Map(coupons.map(c => [c.couponId, c]));
  for (const row of rows) {
    const ref = object(row.ingestSnapshot) ?? object(row.payload);
    const coupon =
      ref && typeof ref.couponId === "number"
        ? byId.get(ref.couponId)
        : undefined;
    if (
      !coupon ||
      !ref ||
      row.tenantId !== coupon.tenantId ||
      row.flightId !== coupon.flightId ||
      ref.bookingId !== coupon.bookingId ||
      ref.passengerId !== coupon.passengerId ||
      row.observedAt < coupon.departureTime ||
      row.observedAt < coupon.couponCreatedAt
    )
      continue;
    const proofs = grouped.get(coupon.couponId) ?? [];
    proofs.push(row);
    grouped.set(coupon.couponId, proofs);
  }
  return grouped;
}

const couponColumns: StandardReportColumn[] = [
  numberColumn("couponId", "Coupon ID"),
  textColumn("ticketNumber", "Local ticket number"),
  numberColumn("couponNumber", "Coupon number"),
  textColumn("bookingReference", "Booking reference"),
  textColumn("pnr", "PNR"),
  numberColumn("passengerId", "Passenger ID"),
  textColumn("firstName", "First name"),
  textColumn("lastName", "Last name"),
  numberColumn("flightId", "Flight ID"),
  textColumn("flightNumber", "Flight number"),
  textColumn("origin", "Origin"),
  textColumn("destination", "Destination"),
  dateColumn("departureTime", "Departure UTC"),
  textColumn("status", "Current coupon status"),
  dateColumn("couponCreatedAt", "Local document row created UTC"),
  dateColumn("statusUpdatedAt", "Current state updated UTC"),
  textColumn("issuer", "Document source"),
  textColumn("externalIssueReceipt", "Accepted external issue receipt"),
];
const componentColumns: StandardReportColumn[] = [
  numberColumn("componentId", "Fare component ID"),
  textColumn("componentType", "Component type"),
  textColumn("code", "Component code"),
  numberColumn("amountMinor", "Component amount (minor units)"),
  textColumn("currency", "Currency"),
  textColumn("mapping", "Coupon mapping"),
  textColumn("source", "Component source"),
  textColumn("sourceReference", "Source reference"),
  textColumn("policyVersion", "Source policy version"),
  dateColumn("recordedAt", "Component recorded UTC"),
  dateColumn("reversedAt", "Component reversed UTC"),
];
const proofColumns: StandardReportColumn[] = [
  numberColumn("upliftEvidenceId", "Recorded uplift evidence ID"),
  textColumn("upliftSourceId", "Uplift source"),
  textColumn("upliftSourceEventId", "Uplift source event"),
  dateColumn("upliftObservedAt", "Uplift observed UTC"),
  dateColumn("upliftReceivedAt", "Uplift received UTC"),
];

function couponOutput(c: CouponRow) {
  return { ...c, issuer: "AIS local document", externalIssueReceipt: null };
}
function proofOutput(
  proofs: (typeof aviationEvidence.$inferSelect)[] | undefined
) {
  const proof = proofs?.length === 1 ? proofs[0] : undefined;
  return {
    upliftEvidenceId: proof?.id ?? null,
    upliftSourceId: proof?.sourceId ?? null,
    upliftSourceEventId: proof?.sourceEventId ?? null,
    upliftObservedAt: proof?.observedAt ?? null,
    upliftReceivedAt: proof?.receivedAt ?? null,
  };
}
async function legacyDocumentRows(
  db: ReadDb,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  if (
    !filters.ticketNumber ||
    filters.couponNumber ||
    (filters.status && filters.status !== "unverified")
  )
    return [];
  const legacyCoupon = alias(ticketCoupons, "finance_legacy_coupon");
  const rows = bounded(
    await db
      .select({
        ticketNumber: passengers.ticketNumber,
        passengerId: passengers.id,
        firstName: passengers.firstName,
        lastName: passengers.lastName,
        bookingId: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
      })
      .from(passengers)
      .innerJoin(bookings, eq(bookings.id, passengers.bookingId))
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          ownedNullableTenant(passengers.tenantId),
          eq(passengers.ticketNumber, filters.ticketNumber),
          notExists(
            db
              .select({ one: sql`1` })
              .from(legacyCoupon)
              .where(eq(legacyCoupon.ticketNumber, passengers.ticketNumber))
          )
        )
      )
      .orderBy(asc(passengers.id))
      .limit(limit)
  );
  return rows.map(row => ({
    ...row,
    status: "unverified",
    issuer: "AIS legacy local document",
    externalIssueReceipt: null,
  }));
}
function pairKey(
  bookingId: number,
  flightId: number,
  passengerId: number | null
) {
  return `${bookingId}/${flightId}/${passengerId ?? "unassigned"}`;
}

/** Each monetary source line occurs once. A missing coupon mapping remains visibly missing. */
function componentRows(
  coupons: CouponRow[],
  components: ComponentRow[],
  proofs: Map<number, (typeof aviationEvidence.$inferSelect)[]>,
  allRelatedCoupons: CouponRow[] = coupons
) {
  const byPair = new Map<string, CouponRow[]>();
  for (const coupon of allRelatedCoupons) {
    const key = pairKey(coupon.bookingId, coupon.flightId, coupon.passengerId);
    const matches = byPair.get(key) ?? [];
    matches.push(coupon);
    byPair.set(key, matches);
  }
  const includedSectors = new Set(
    coupons.map(c => `${c.bookingId}/${c.flightId}`)
  );
  const includedPairs = new Set(
    coupons.map(c => pairKey(c.bookingId, c.flightId, c.passengerId))
  );
  const covered = new Set<number>();
  const rows: Record<string, unknown>[] = [];
  for (const component of components) {
    if (!includedSectors.has(`${component.bookingId}/${component.flightId}`))
      continue;
    const matches =
      byPair.get(
        pairKey(component.bookingId, component.flightId, component.passengerId)
      ) ?? [];
    // A document-specific search cannot assign the whole booking or a different
    // passenger's source lines to the requested ticket.
    if (
      component.passengerId !== null &&
      !includedPairs.has(
        pairKey(component.bookingId, component.flightId, component.passengerId)
      )
    )
      continue;
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match) covered.add(match.couponId);
    rows.push({
      ...(match
        ? couponOutput(match)
        : {
            ...component,
            couponId: null,
            ticketNumber: null,
            couponNumber: null,
            issuer: "AIS local document",
            externalIssueReceipt: null,
          }),
      ...component,
      amountMinor: integerAmount(component.amountMinor),
      mapping: match
        ? "passenger_and_sector"
        : component.passengerId === null
          ? "booking_level_unallocated"
          : "ambiguous_documents",
      ...proofOutput(match ? proofs.get(match.couponId) : undefined),
      officeId: null,
      recognizedRevenueMinor: null,
    });
  }
  for (const coupon of coupons) {
    if (!covered.has(coupon.couponId))
      rows.push({
        ...couponOutput(coupon),
        mapping: "no_unique_component_mapping",
        ...proofOutput(proofs.get(coupon.couponId)),
        officeId: null,
        recognizedRevenueMinor: null,
      });
  }
  return rows;
}

async function couponReport(
  db: ReadDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  notes: string[]
) {
  const upliftOnly = [43, 67, 95].includes(id);
  const coupons = await loadCoupons(
    db,
    filters,
    scope,
    upliftOnly ? (id === 95 ? "none" : "departure") : "created"
  );
  const proofs = await loadUplift(db, coupons, scope);
  const selected = upliftOnly
    ? coupons.filter(
        c =>
          c.status === "F" &&
          proofs.get(c.couponId)?.length === 1 &&
          (id !== 95 ||
            periodContains(proofs.get(c.couponId)?.[0].observedAt, filters))
      )
    : coupons;
  if ([6, 43, 94, 95].includes(id)) {
    const legacy = id === 6 ? await legacyDocumentRows(db, filters, scope) : [];
    return reportTable(
      [...couponColumns, ...proofColumns],
      [
        ...selected.map(c => ({
          ...couponOutput(c),
          ...proofOutput(proofs.get(c.couponId)),
        })),
        ...legacy,
      ],
      legacy.length
        ? [
            ...notes,
            "Legacy document numbers without materialized coupons have unknown coupon identities, sectors, creation dates and status. Reading this report does not create or update a document.",
          ]
        : notes
    );
  }
  const components = await loadComponents(db, scope, {}, [
    ...new Set(selected.map(c => c.bookingId)),
  ]);
  const relatedCoupons = await loadCoupons(db, {}, scope, "none", [
    ...new Set(selected.map(c => c.bookingId)),
  ]);
  return reportTable(
    [
      ...couponColumns,
      ...componentColumns,
      ...proofColumns,
      numberColumn("agencyId", "Agency ID"),
      textColumn("agencyName", "Agency name"),
      numberColumn("officeId", "Sales office (unknown)"),
      numberColumn(
        "recognizedRevenueMinor",
        "Recognized accounting revenue (unknown)"
      ),
    ],
    componentRows(selected, components, proofs, relatedCoupons),
    notes
  );
}

async function paymentReport(
  db: ReadDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  notes: string[]
) {
  const rows = bounded(
    await db
      .select({
        paymentId: payments.id,
        bookingId: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        amountMinor: payments.amount,
        currency: payments.currency,
        method: payments.method,
        provider: payments.provider,
        status: payments.status,
        transactionId: payments.transactionId,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
      })
      .from(payments)
      .innerJoin(
        bookings,
        and(
          eq(bookings.id, payments.bookingId),
          ownedNullableTenant(payments.tenantId)
        )
      )
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          dates(payments.createdAt, filters),
          referenceFilter(filters),
          filters.status
            ? eq(
                payments.status,
                filters.status as typeof payments.$inferSelect.status
              )
            : undefined
        )
      )
      .orderBy(asc(payments.createdAt), asc(payments.id))
      .limit(limit)
  );
  return reportTable(
    [
      numberColumn("paymentId", "Payment ID"),
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      numberColumn("amountMinor", "Amount (minor units)"),
      textColumn("currency", "Currency"),
      textColumn("method", "Payment method"),
      textColumn("provider", "Payment provider"),
      textColumn("status", "Current payment status"),
      textColumn("transactionId", "Provider transaction reference"),
      dateColumn("createdAt", "Created UTC"),
      dateColumn("updatedAt", "Updated UTC"),
      numberColumn("officeId", "Sales office (unknown)"),
    ],
    rows.map(row => ({
      ...row,
      amountMinor: integerAmount(row.amountMinor),
      officeId: null,
    })),
    notes
  );
}

async function ledgerReport(
  db: ReadDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  notes: string[]
) {
  const rows = bounded(
    await db
      .select({
        ledgerId: financialLedger.id,
        bookingId: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        type: financialLedger.type,
        amount: financialLedger.amount,
        currency: financialLedger.currency,
        transactionDate: financialLedger.transactionDate,
        createdAt: financialLedger.createdAt,
        metadata: financialLedger.metadata,
      })
      .from(financialLedger)
      .innerJoin(bookings, eq(bookings.id, financialLedger.bookingId))
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          dates(financialLedger.transactionDate, filters),
          referenceFilter(filters),
          id === 68
            ? inArray(financialLedger.type, ["refund", "partial_refund"])
            : undefined
        )
      )
      .orderBy(asc(financialLedger.transactionDate), asc(financialLedger.id))
      .limit(limit)
  );
  return reportTable(
    [
      numberColumn("ledgerId", "Ledger entry ID"),
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      textColumn("type", "Movement type"),
      numberColumn("amountMinor", "Posted amount (minor units)"),
      numberColumn(
        "signedSettlementMinor",
        "Signed settlement amount (minor units)"
      ),
      textColumn("currency", "Currency"),
      textColumn("tender", "Tender classification"),
      textColumn("fundingClass", "Cash/non-cash class"),
      dateColumn("transactionDate", "Transaction UTC"),
      dateColumn("createdAt", "Recorded UTC"),
      numberColumn("officeId", "Sales office (unknown)"),
    ],
    rows.map(row => {
      const metadata = object(row.metadata);
      const tender = presentString(metadata?.tender);
      const amountMinor = ledgerMinor(row.amount);
      const classified =
        ["charge", "refund", "partial_refund"].includes(row.type) &&
        amountMinor >= 0;
      return {
        ...row,
        amountMinor,
        signedSettlementMinor: classified
          ? row.type === "charge"
            ? amountMinor
            : -amountMinor
          : null,
        tender,
        fundingClass: classified
          ? ["corporate_credit", "user_credit"].includes(tender ?? "")
            ? "non_cash"
            : "cash"
          : "unclassified",
        officeId: null,
      };
    }),
    notes
  );
}

async function baggageReport(
  db: ReadDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  notes: string[]
) {
  const rows = bounded(
    await db
      .select({
        itemId: bookingAncillaries.id,
        bookingId: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        passengerId: bookingAncillaries.passengerId,
        segmentId: bookingAncillaries.segmentId,
        scopeState: bookingAncillaries.scopeState,
        productCode: ancillaryServices.code,
        productName: ancillaryServices.name,
        quantity: bookingAncillaries.quantity,
        unitPriceMinor: bookingAncillaries.unitPrice,
        totalPriceMinor: bookingAncillaries.totalPrice,
        status: bookingAncillaries.status,
        fundedAt: bookingAncillaries.fundedAt,
        fundingReference: bookingAncillaries.fundingReference,
      })
      .from(bookingAncillaries)
      .innerJoin(bookings, eq(bookings.id, bookingAncillaries.bookingId))
      .innerJoin(
        ancillaryServices,
        eq(ancillaryServices.id, bookingAncillaries.ancillaryServiceId)
      )
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          eq(ancillaryServices.category, "baggage"),
          dates(bookingAncillaries.fundedAt, filters),
          referenceFilter(filters),
          filters.status
            ? eq(
                bookingAncillaries.status,
                filters.status as typeof bookingAncillaries.$inferSelect.status
              )
            : undefined
        )
      )
      .orderBy(asc(bookingAncillaries.fundedAt), asc(bookingAncillaries.id))
      .limit(limit)
  );
  return reportTable(
    [
      numberColumn("itemId", "Baggage item ID"),
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      numberColumn("passengerId", "Passenger ID"),
      numberColumn("segmentId", "Booking segment ID"),
      textColumn("scopeState", "Sector scope"),
      textColumn("productCode", "Baggage product code"),
      textColumn("productName", "Product name"),
      numberColumn("quantity", "Quantity"),
      numberColumn("unitPriceMinor", "Unit price (minor units)"),
      numberColumn("totalPriceMinor", "Line value (minor units)"),
      textColumn("currency", "Currency"),
      textColumn("status", "Item lifecycle status"),
      dateColumn("fundedAt", "Funding recorded UTC"),
      textColumn("fundingKind", "Funding kind"),
      textColumn("fundingReference", "Funding reference"),
      textColumn("excessClassification", "Excess classification (unknown)"),
      numberColumn("officeId", "Sales office (unknown)"),
    ],
    rows.map(row => {
      const funding = object(row.fundingReference);
      return {
        ...row,
        unitPriceMinor: integerAmount(row.unitPriceMinor),
        totalPriceMinor: integerAmount(row.totalPriceMinor),
        currency: "SAR",
        fundingKind: presentString(funding?.kind),
        fundingReference:
          presentString(funding?.paymentIntentId) ??
          (typeof funding?.ledgerId === "number"
            ? `ledger:${funding.ledgerId}`
            : presentString(funding?.executionEventId)),
        excessClassification: null,
        officeId: null,
      };
    }),
    notes
  );
}

async function voidReport(
  db: ReadDb,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  notes: string[]
) {
  const events = bounded(
    await db
      .select({
        eventId: outbox.eventId,
        eventType: outbox.eventType,
        createdAt: outbox.createdAt,
        payload: outbox.payload,
        bookingId: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
      })
      .from(outbox)
      .innerJoin(
        bookings,
        and(
          sql`JSON_EXTRACT(${outbox.payload}, '$.bookingId') = ${bookings.id}`,
          sameTenant(outbox.tenantId, bookings.tenantId)
        )
      )
      .where(
        and(
          scopeCondition(bookings.tenantId, scope),
          inArray(outbox.eventType, ["booking.cancelled", "payment.refunded"]),
          dates(outbox.createdAt, filters),
          referenceFilter(filters)
        )
      )
      .orderBy(asc(outbox.createdAt), asc(outbox.id))
      .limit(limit)
  );
  const bookingIds = [...new Set(events.map(event => event.bookingId))];
  if (!bookingIds.length)
    return reportTable(
      [
        ...couponColumns,
        textColumn("voidEventId", "Void event ID"),
        dateColumn("voidedAt", "Voided UTC"),
        textColumn("previousStatus", "State before void"),
        textColumn("voidStatus", "Recorded void status"),
      ],
      [],
      notes
    );
  const coupons = await loadCoupons(
    db,
    { ...filters, startDate: undefined, endDate: undefined },
    scope,
    "none",
    bookingIds
  );
  const byId = new Map(
    coupons
      .filter(c => bookingIds.includes(c.bookingId))
      .map(c => [c.couponId, c])
  );
  const rows: Record<string, unknown>[] = [];
  for (const event of events) {
    const transitions = object(event.payload)?.localCouponTransitions;
    if (!Array.isArray(transitions)) continue;
    for (const value of transitions) {
      const transition = object(value);
      const coupon =
        typeof transition?.couponId === "number"
          ? byId.get(transition.couponId)
          : undefined;
      if (
        !coupon ||
        !transition ||
        transition.status !== "V" ||
        transition.passengerId !== coupon.passengerId ||
        transition.flightId !== coupon.flightId ||
        transition.couponNumber !== coupon.couponNumber ||
        coupon.bookingId !== event.bookingId
      )
        continue;
      rows.push({
        ...couponOutput(coupon),
        voidEventId: event.eventId,
        voidedAt: event.createdAt,
        previousStatus: presentString(transition.previousStatus),
        voidStatus: "V",
      });
    }
  }
  return reportTable(
    [
      ...couponColumns,
      textColumn("voidEventId", "Void event ID"),
      dateColumn("voidedAt", "Voided UTC"),
      textColumn("previousStatus", "State before void"),
      textColumn("voidStatus", "Recorded void status"),
    ],
    rows,
    notes
  );
}

function day(at: Date) {
  return at.toISOString().slice(0, 10);
}
function monday(at: Date) {
  const start = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return day(start);
}
/** A bounded, reproducible source-line projection; it never spreads a booking total over its passengers or flights. */
async function revenueReport(
  db: ReadDb,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope,
  notes: string[]
) {
  const components = await loadComponents(db, scope, filters, undefined, true);
  const coupons = await loadCoupons(
    db,
    { ...filters, startDate: undefined, endDate: undefined },
    scope,
    "none",
    [...new Set(components.map(component => component.bookingId))]
  );
  const proofs = await loadUplift(db, coupons, scope);
  const byPair = new Map<string, CouponRow[]>();
  for (const coupon of coupons) {
    const key = pairKey(coupon.bookingId, coupon.flightId, coupon.passengerId);
    const set = byPair.get(key) ?? [];
    set.push(coupon);
    byPair.set(key, set);
  }
  const details = components
    .map(component => {
      const matches =
        byPair.get(
          pairKey(
            component.bookingId,
            component.flightId,
            component.passengerId
          )
        ) ?? [];
      const coupon =
        matches.length === 1 && matches[0].status !== "unverified"
          ? matches[0]
          : undefined;
      const receipt =
        coupon?.status === "F" && proofs.get(coupon.couponId)?.length === 1
          ? proofs.get(coupon.couponId)?.[0]
          : undefined;
      const amount = integerAmount(component.amountMinor);
      const current = component.reversedAt === null;
      const bookedInPeriod = periodContains(
        component.bookingCreatedAt,
        filters
      );
      const ticketedInPeriod = coupon
        ? periodContains(coupon.couponCreatedAt, filters)
        : false;
      const flownInPeriod = receipt
        ? periodContains(receipt.observedAt, filters)
        : false;
      return {
        ...component,
        ...(coupon && {
          couponId: coupon.couponId,
          ticketNumber: coupon.ticketNumber,
          couponNumber: coupon.couponNumber,
          firstName: coupon.firstName,
          lastName: coupon.lastName,
          status: coupon.status,
        }),
        bookingDate: component.bookingCreatedAt,
        localDocumentDate: coupon?.couponCreatedAt ?? null,
        upliftDate: receipt?.observedAt ?? null,
        bookedAmountMinor: current && bookedInPeriod ? amount : null,
        localDocumentAmountMinor: current && ticketedInPeriod ? amount : null,
        upliftAmountMinor: current && flownInPeriod ? amount : null,
        amountMinor: amount,
        mapping:
          component.passengerId === null
            ? "booking_level_unallocated"
            : matches.length > 1
              ? "ambiguous_documents"
              : coupon
                ? "passenger_and_sector"
                : "no_verified_local_document",
        upliftEvidenceId: receipt?.id ?? null,
        recognizedRevenueMinor: null,
        bookedInPeriod,
        ticketedInPeriod,
        flownInPeriod,
      };
    })
    .filter(row =>
      id === 81
        ? row.flownInPeriod
        : row.bookedInPeriod || row.ticketedInPeriod || row.flownInPeriod
    );
  if (id === 79)
    return reportTable(
      [
        numberColumn("componentId", "Component ID"),
        textColumn("bookingReference", "Booking reference"),
        textColumn("pnr", "PNR"),
        numberColumn("passengerId", "Passenger ID"),
        textColumn("firstName", "First name"),
        textColumn("lastName", "Last name"),
        numberColumn("flightId", "Flight ID"),
        textColumn("flightNumber", "Flight number"),
        textColumn("origin", "Origin"),
        textColumn("destination", "Destination"),
        textColumn("ticketNumber", "Local ticket number"),
        numberColumn("couponNumber", "Coupon number"),
        textColumn("componentType", "Component type"),
        textColumn("code", "Component code"),
        textColumn("currency", "Currency"),
        dateColumn("bookingDate", "Booking created UTC"),
        dateColumn("localDocumentDate", "Local document recorded UTC"),
        dateColumn("upliftDate", "Uplift observed UTC"),
        numberColumn(
          "bookedAmountMinor",
          "Booking component value in period (minor)"
        ),
        numberColumn(
          "localDocumentAmountMinor",
          "Local document value in period (minor)"
        ),
        numberColumn(
          "upliftAmountMinor",
          "Evidenced uplift value in period (minor)"
        ),
        textColumn("mapping", "Coupon mapping"),
        numberColumn("upliftEvidenceId", "Uplift evidence ID"),
        dateColumn("reversedAt", "Source component reversed UTC"),
        numberColumn(
          "recognizedRevenueMinor",
          "Recognized accounting revenue (unknown)"
        ),
      ],
      details,
      notes
    );
  const groups = new Map<string, Record<string, string | number | null>>();
  type GroupContext = Pick<
    ComponentRow,
    | "currency"
    | "flightId"
    | "flightNumber"
    | "departureTime"
    | "origin"
    | "destination"
  >;
  function addEvent(
    row: GroupContext,
    basis: string,
    at: Date,
    amount: number | null,
    sourceLines: number
  ) {
    if (
      !periodContains(at, filters) ||
      (id === 81 && basis !== "recorded_uplift")
    )
      return;
    const bucket =
      id === 75 ? monday(at) : id === 83 ? day(at).slice(0, 7) : day(at);
    const byFlight = id === 78 || id === 80;
    const byRoute = [77, 81, 83].includes(id);
    const key = JSON.stringify([
      bucket,
      basis,
      row.currency,
      byFlight ? row.flightId : null,
      byRoute ? row.origin : null,
      byRoute ? row.destination : null,
    ]);
    const group = groups.get(key) ?? {
      period: bucket,
      basis,
      currency: row.currency,
      flightId: byFlight ? row.flightId : null,
      flightNumber: byFlight ? row.flightNumber : null,
      departureTime: byFlight ? row.departureTime.toISOString() : null,
      origin: byFlight || byRoute ? row.origin : null,
      destination: byFlight || byRoute ? row.destination : null,
      amountMinor: 0,
      sourceLines: 0,
      unresolvedLines: 0,
      recognizedRevenueMinor: null,
      officeId: null,
    };
    group.sourceLines = Number(group.sourceLines) + sourceLines;
    if (amount === null) {
      group.unresolvedLines = Number(group.unresolvedLines) + 1;
      group.amountMinor = null;
    } else if (group.amountMinor !== null)
      group.amountMinor = integerAmount(Number(group.amountMinor) + amount);
    groups.set(key, group);
  }
  for (const component of components) {
    addEvent(
      component,
      "booked",
      component.bookingCreatedAt,
      component.reversedAt === null
        ? integerAmount(component.amountMinor)
        : null,
      1
    );
  }
  // Document/uplift groups include unresolved coupons as null, rather than
  // silently summing only the subset of passengers whose fares happen to map.
  const componentsByPair = new Map<string, ComponentRow[]>();
  const componentsBySector = new Map<string, ComponentRow[]>();
  for (const component of components) {
    const key = pairKey(
      component.bookingId,
      component.flightId,
      component.passengerId
    );
    const pair = componentsByPair.get(key) ?? [];
    pair.push(component);
    componentsByPair.set(key, pair);
    const sectorKey = `${component.bookingId}/${component.flightId}`;
    const sector = componentsBySector.get(sectorKey) ?? [];
    sector.push(component);
    componentsBySector.set(sectorKey, sector);
  }
  for (const coupon of coupons) {
    const matches =
      componentsByPair.get(
        pairKey(coupon.bookingId, coupon.flightId, coupon.passengerId)
      ) ?? [];
    const sector =
      componentsBySector.get(`${coupon.bookingId}/${coupon.flightId}`) ?? [];
    const uniqueDocument =
      byPair.get(pairKey(coupon.bookingId, coupon.flightId, coupon.passengerId))
        ?.length === 1 && coupon.status !== "unverified";
    const unallocated = sector.some(
      component => component.passengerId === null
    );
    const currencies = [
      ...new Set(
        (matches.length ? matches : sector).map(component => component.currency)
      ),
    ];
    if (!currencies.length) currencies.push("UNKNOWN");
    const receipt =
      coupon.status === "F" && proofs.get(coupon.couponId)?.length === 1
        ? proofs.get(coupon.couponId)?.[0]
        : undefined;
    for (const currency of currencies) {
      const lines = matches.filter(
        component => component.currency === currency
      );
      const amount =
        uniqueDocument &&
        !unallocated &&
        lines.length &&
        lines.every(
          component =>
            component.reversedAt === null &&
            component.componentType !== "unclassified"
        )
          ? integerAmount(
              lines.reduce(
                (sum, component) => sum + integerAmount(component.amountMinor),
                0
              )
            )
          : null;
      const context = { ...coupon, currency };
      addEvent(
        context,
        "local_document",
        coupon.couponCreatedAt,
        amount,
        lines.length
      );
      if (receipt)
        addEvent(
          context,
          "recorded_uplift",
          receipt.observedAt,
          amount,
          lines.length
        );
    }
  }
  return reportTable(
    [
      textColumn(
        "period",
        id === 75
          ? "UTC week starting Monday"
          : id === 83
            ? "UTC month"
            : "UTC day"
      ),
      textColumn("basis", "Independent event basis"),
      textColumn("currency", "Currency"),
      numberColumn("flightId", "Flight ID"),
      textColumn("flightNumber", "Flight number"),
      dateColumn("departureTime", "Flight departure UTC"),
      textColumn("origin", "Origin"),
      textColumn("destination", "Destination"),
      numberColumn("amountMinor", "Commercial component value (minor units)"),
      numberColumn("sourceLines", "Source component lines"),
      numberColumn("unresolvedLines", "Unresolved source records"),
      numberColumn(
        "recognizedRevenueMinor",
        "Recognized accounting revenue (unknown)"
      ),
      numberColumn("officeId", "Sales office (unknown)"),
    ],
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value),
    notes
  );
}

function validateRequest(
  def: StandardReportDefinition,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId <= 0 ||
    (scope.tenantId !== undefined &&
      (!Number.isSafeInteger(scope.tenantId) || scope.tenantId <= 0))
  )
    badRequest("Invalid reporting scope");
  for (const [key, value] of Object.entries(filters)) {
    if (
      value !== undefined &&
      !def.filters.includes(key as StandardReportFilterKey)
    )
      badRequest(`Filter ${key} is not supported by this report`);
  }
  standardReportPeriod(filters);
  if (
    def.filters.includes("startDate") &&
    ![89, 95].includes(def.id) &&
    (!filters.startDate || !filters.endDate)
  )
    badRequest("Choose both report period dates (UTC)");
  if (
    filters.bookingReference &&
    !/^[A-Z0-9]{6}$/i.test(filters.bookingReference)
  )
    badRequest("A six-character booking reference or PNR is required");
  if (filters.ticketNumber && !/^\d{13}$/.test(filters.ticketNumber))
    badRequest("A 13-digit local ticket number is required");
  if (
    filters.couponNumber !== undefined &&
    (!Number.isSafeInteger(filters.couponNumber) || filters.couponNumber <= 0)
  )
    badRequest("Invalid coupon number");
  if (
    filters.flightId !== undefined &&
    (!Number.isSafeInteger(filters.flightId) || filters.flightId <= 0)
  )
    badRequest("Invalid flight ID");
  if ([6, 90].includes(def.id) && !filters.ticketNumber)
    badRequest("Specify a ticket number");
  if (def.id === 90 && !filters.couponNumber)
    badRequest("Specify a coupon number");
  if (def.id === 9 && !filters.bookingReference)
    badRequest("Specify a booking reference or PNR");
  if (filters.status) {
    const statuses = [28, 55].includes(def.id)
      ? ["pending", "completed", "failed", "refunded"]
      : def.id === 71
        ? ["active", "cancelled", "refunded"]
        : ["O", "C", "F", "R", "E", "V", "unverified"];
    if (!statuses.includes(filters.status))
      badRequest("Unsupported status for this report");
  }
}

/** Caller enforces finance capability; this reader enforces tenant identity on every source relation. */
export async function getFinanceStandardReport(
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
): Promise<StandardReportTable | undefined> {
  const def = financeReportDefinitions.find(report => report.id === id);
  if (!def) return undefined;
  if (def.availability === "blocked")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: def.limitations.join(" "),
    });
  validateRequest(def, filters, scope);
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Reporting database is unavailable",
    });
  const notes = [
    def.description,
    ...def.limitations,
    "Date-only filters are complete UTC days; the end bound is exclusive at the next midnight. Amounts in different currencies are never combined.",
  ];
  return await db.transaction(
    tx => {
      if ([28, 55].includes(id))
        return paymentReport(tx, filters, scope, notes);
      if ([68, 70].includes(id))
        return ledgerReport(tx, id, filters, scope, notes);
      if (id === 71) return baggageReport(tx, filters, scope, notes);
      if (id === 96) return voidReport(tx, filters, scope, notes);
      if ([75, 76, 77, 78, 79, 80, 81, 83].includes(id))
        return revenueReport(tx, id, filters, scope, notes);
      return couponReport(tx, id, filters, scope, notes);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
