import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias, type AnyMySqlColumn } from "drizzle-orm/mysql-core";
import {
  airlines,
  airports,
  ancillaryServices,
  auditLogs,
  bookingAncillaries,
  bookingFareComponents,
  bookingModifications,
  bookings,
  bookingSegments,
  bookingStatusHistory,
  currencies,
  exchangeRates,
  fareClasses,
  fareRules,
  financialLedger,
  flights,
  loyaltyAccounts,
  milesTransactions,
  passengers,
  paymentHistory,
  payments,
  ticketCoupons,
  users,
} from "../../drizzle/schema";
import {
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../drizzle/operations-schema";
import {
  STANDARD_REPORT_ROW_LIMIT,
  type StandardReportDefinition,
  type StandardReportFilterKey,
  type StandardReportFilters,
  type StandardReportScope,
  type StandardReportTable,
} from "../../shared/standard-reports";
import { getDb } from "../db";
import { DISPLAY_CURRENCIES } from "../../shared/ibe-search";
import { SUPPORTED_CURRENCIES } from "./currency/currency.service";
import { getRoleCapabilities, getRoleDisplayName } from "./rbac.service";
import { SMS_TEMPLATES } from "./sms.service";
import {
  dateColumn,
  numberColumn,
  reportTable,
  standardReportPeriod,
  textColumn,
} from "./standard-report-utils";

const LIMIT = STANDARD_REPORT_ROW_LIMIT + 1;
type Reader = Pick<
  NonNullable<Awaited<ReturnType<typeof getDb>>>,
  "select" | "selectDistinct"
>;
type Row = Record<string, unknown>;
const dates: StandardReportFilterKey[] = ["startDate", "endDate"];

function definition(
  id: number,
  title: string,
  description: string,
  filters: StandardReportFilterKey[],
  limitations: string[] = [],
  availability: StandardReportDefinition["availability"] = limitations.length
    ? "partial"
    : "available"
): StandardReportDefinition {
  return {
    id,
    title,
    category: "commercial",
    availability,
    description,
    filters,
    limitations,
  };
}

const externalGds =
  "Requires accepted provider booking receipts and their explicit AIS booking, ticket and sector links. Technical GDS messages and local agency bookings are not accepted GDS sales.";

export const commercialReportDefinitions: StandardReportDefinition[] = [
  definition(
    1,
    "Agent Details",
    "All users in the permitted tenant, with their declared role and role capabilities; no credentials are exported.",
    ["status"],
    [
      "Internal sales-office assignments are not recorded. Office is unknown; the role description does not override endpoint-specific authorization.",
    ]
  ),
  definition(
    4,
    "Currencies",
    "Configured currency catalog and every persisted exchange-rate record, with source, validity and explicit missing current rates.",
    []
  ),
  definition(
    11,
    "Fares Departing City",
    "Filed fare-class rules applicable to the specified origin airport, including unrestricted rules and each rule's validity and pricing terms.",
    [...dates, "origin"],
    [
      "The system stores relative fare-class/rule pricing, not an independently filed final fare amount. This is a configuration report, not a passenger quote. Tenant attribution uses airlines with flights owned by that tenant.",
    ]
  ),
  definition(
    12,
    "Fares City Pair",
    "Filed fare-class rules for the specified directional airport pair, including route-wide rules.",
    [...dates, "origin", "destination"],
    [
      "The system stores relative fare-class/rule pricing, not an independently filed final fare amount. This is a configuration report, not a passenger quote. Tenant attribution uses airlines with flights owned by that tenant.",
    ]
  ),
  definition(
    29,
    "Frequent Flyer Activity",
    "Every recorded miles transaction in the UTC creation period, including member, type, signed miles and balance after the transaction.",
    [...dates, "status"]
  ),
  definition(
    30,
    "Frequent Flyer Membership",
    "Members whose recorded membership start falls in the UTC period; member ID is the user's ID.",
    [...dates, "status"]
  ),
  definition(
    31,
    "Frequent Flyer Transactions",
    "All recorded transactions for the selected member (user ID), optionally restricted by UTC creation period and transaction type.",
    [...dates, "memberId", "status"]
  ),
  ...[
    [32, "GDS Bookings"],
    [33, "GDS Etickets"],
    [34, "GDS ID"],
    [35, "GDS PNR Quantity"],
    [36, "GDS Segments"],
    [37, "GDS Travel Agent ID"],
  ].map(([id, title]) =>
    definition(
      Number(id),
      String(title),
      externalGds,
      [],
      [externalGds],
      "blocked"
    )
  ),
  definition(
    41,
    "Issues Offices",
    "Internal ticket-issuing offices.",
    [],
    [
      "No issuing-office entity or immutable issuing-office attribution is recorded. Travel agencies and provider office identifiers cannot substitute for it.",
    ],
    "blocked"
  ),
  definition(
    42,
    "Last Record Locator",
    "Newest non-deleted booking in scope, ordered by creation time then booking ID. Includes pending, confirmed, completed and cancelled bookings.",
    []
  ),
  definition(
    46,
    "Message Table",
    "Configured operational Type-B message routes and the application's SMS template catalog, with configuration and acceptance state kept separate.",
    [],
    [
      "There is no unified persisted registry of email templates. SMS templates do not prove that a delivery provider is configured or accepted.",
    ]
  ),
  definition(
    47,
    "Migration Report",
    "Booking import batch errors.",
    [],
    [
      "No booking-import batch/source-row/error workflow is recorded. Database schema migrations and forensic audits are different operations.",
    ],
    "blocked"
  ),
  definition(
    51,
    "Sales Offices",
    "Internal sales offices.",
    [],
    [
      "No tenant-owned sales-office entity is recorded. Travel agencies are distinct from airline sales offices.",
    ],
    "blocked"
  ),
  definition(
    52,
    "Sales Office Credit Limits",
    "Credit limits assigned to internal sales offices.",
    [],
    [
      "No sales-office credit account or office assignment exists. Agency and corporate credit are separate accounts.",
    ],
    "blocked"
  ),
  definition(
    58,
    "PNR 50",
    "Latest 50 non-deleted bookings in scope, ordered by creation time then booking ID. Fewer rows are returned when fewer exist.",
    []
  ),
  definition(
    59,
    "PNR Full (Passenger Name Record)",
    "Unified local booking snapshot: booking, passengers, sectors, local coupons, payments, fare components, ancillary purchases and recorded history, with an explicit record type per row.",
    ["bookingReference"],
    [
      "Only allowlisted local business fields are included. Provider credentials, payment payloads, raw audit values and passenger travel documents are excluded. External issuance and unrecorded historic events are not inferred.",
    ]
  ),
  definition(
    60,
    "PNR History",
    "Unified local timeline of booking creation, state transitions, payment events, servicing requests, ledger entries and booking audit events. The period filters event time.",
    [...dates, "bookingReference"],
    [
      "The report preserves source identifiers and separate events; it does not claim that every historical action produced an event. Raw audit values, provider payloads and free-text error details are excluded.",
    ]
  ),
  definition(
    61,
    "PNR from Credit Card Authorization",
    "Find a booking by the card issuer's authorization code.",
    [],
    [
      "No authoritative card authorization code is recorded. Payment-intent IDs and gateway transaction IDs are not authorization codes.",
    ],
    "blocked"
  ),
  definition(
    62,
    "PNR Table",
    "Unified local booking snapshots for all current booking-sector members of the selected flight. Legacy bookings are included only when they have no sector rows.",
    ["flightId"],
    [
      "Uses the same allowlisted local fields as PNR Full. External issuance and unrecorded historical events are not inferred.",
    ]
  ),
  definition(
    63,
    "Product Sales",
    "Every funded ancillary purchase, by its recorded funding time, including product, booking, quantity, snapshot prices and current cancellation/refund state.",
    [...dates, "bookingReference", "status"],
    [
      "Rows are funded purchases, including authorized no-charge purchases. Product-level cash collections and net refund allocation are not independently recorded. Historic rows without funding evidence are excluded; sale-currency snapshots are unavailable and catalog currency is labelled separately.",
    ]
  ),
  definition(
    65,
    "PNR's on Queues",
    "Membership of bookings in operational reservation queues.",
    [],
    [
      "No reservation queue or PNR queue-membership workflow exists. Background job queues are not reservation queues.",
    ],
    "blocked"
  ),
  definition(
    97,
    "VRS Messages",
    "Recorded outbound Type-B message transmissions created in the UTC period, retaining draft, sending and acknowledgment states separately.",
    [...dates, "flightId", "status"],
    [
      "No complete generated-email ledger exists. These are Type-B transmission metadata, not a combined email/TTY history; content and provider payloads are excluded.",
    ]
  ),
];

function tenantCondition(column: AnyMySqlColumn, scope: StandardReportScope) {
  return scope.tenantId === undefined ? undefined : eq(column, scope.tenantId);
}

function sameTenant(left: AnyMySqlColumn, right: AnyMySqlColumn) {
  return or(eq(left, right), and(isNull(left), isNull(right)));
}

/** Legacy child rows inherit ownership from their booking only when unset. */
function ownedNullableTenant(child: AnyMySqlColumn) {
  return or(isNull(child), eq(child, bookings.tenantId));
}

function ownedOptionalPassenger(db: Reader, passengerId: AnyMySqlColumn) {
  return or(
    isNull(passengerId),
    exists(
      db
        .select({ one: sql`1` })
        .from(passengers)
        .where(
          and(
            eq(passengers.id, passengerId),
            eq(passengers.bookingId, bookings.id),
            ownedNullableTenant(passengers.tenantId)
          )
        )
    )
  );
}

function periodConditions(
  column: AnyMySqlColumn,
  filters: StandardReportFilters
) {
  const { start, end } = standardReportPeriod(filters);
  return [
    start ? gte(column, start) : undefined,
    end ? lt(column, end) : undefined,
  ];
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined || value === "") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${label} is required for this report`,
    });
  }
  return value;
}

function checkedStatus<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Status must be one of: ${allowed.join(", ")}`,
    });
  return value as T;
}

function ensureCapacity(rows: unknown[]) {
  if (rows.length > STANDARD_REPORT_ROW_LIMIT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The report exceeds 10000 rows. Narrow the report filters; no rows were silently omitted.",
    });
  }
}

async function userReport(
  db: Reader,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const status = checkedStatus(filters.status, users.role.enumValues);
  const rows = await db
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(
      and(
        tenantCondition(users.tenantId, scope),
        status ? eq(users.role, status) : undefined
      )
    )
    .orderBy(asc(users.id))
    .limit(LIMIT);
  return reportTable(
    [
      numberColumn("userId", "User ID"),
      numberColumn("tenantId", "Tenant ID"),
      textColumn("name", "Name"),
      textColumn("email", "Email"),
      textColumn("role", "Role"),
      textColumn("roleName", "Role name"),
      textColumn("capabilities", "Declared role capabilities"),
      textColumn("salesOffice", "Sales office (unrecorded)"),
      dateColumn("createdAt", "Created at (UTC)"),
      dateColumn("lastSignedIn", "Last sign-in (UTC)"),
    ],
    rows.map(row => ({
      ...row,
      roleName: getRoleDisplayName(row.role),
      capabilities: getRoleCapabilities(row.role).join("; "),
      salesOffice: null,
    }))
  );
}

async function currenciesReport(db: Reader) {
  const now = new Date();
  type Configuration = {
    code: string;
    currencyId: number | null;
    currencyName: string | null;
    catalogActive: boolean | null;
    configuredBaseCurrency: boolean | null;
    configurationSource: string;
  };
  const configurations = new Map<string, Configuration>(
    SUPPORTED_CURRENCIES.map(currency => [
      currency.code,
      {
        code: currency.code,
        currencyId: null,
        currencyName: currency.name,
        catalogActive: currency.isActive,
        configuredBaseCurrency: null,
        configurationSource: "application_currency_catalog",
      },
    ])
  );
  for (const code of DISPLAY_CURRENCIES) {
    if (!configurations.has(code))
      configurations.set(code, {
        code,
        currencyId: null,
        currencyName: null,
        catalogActive: null,
        configuredBaseCurrency: null,
        configurationSource: "application_display_catalog",
      });
  }
  const stored = await db
    .select({
      code: currencies.code,
      currencyId: currencies.id,
      currencyName: currencies.name,
      catalogActive: currencies.isActive,
      configuredBaseCurrency: currencies.isBaseCurrency,
    })
    .from(currencies)
    .orderBy(asc(currencies.code), asc(currencies.id))
    .limit(LIMIT);
  ensureCapacity(stored);
  for (const currency of stored)
    configurations.set(currency.code, {
      ...currency,
      configurationSource: "currencies",
    });
  const configurationFields = (code: string) =>
    configurations.get(code) ?? {
      code,
      currencyId: null,
      currencyName: null,
      catalogActive: null,
      configuredBaseCurrency: null,
      configurationSource: "exchange_rate_only",
    };
  const rates = await db
    .select({
      rateId: exchangeRates.id,
      fromCurrency: exchangeRates.fromCurrency,
      toCurrency: exchangeRates.toCurrency,
      rate: exchangeRates.rate,
      source: exchangeRates.source,
      validFrom: exchangeRates.validFrom,
      validTo: exchangeRates.validTo,
    })
    .from(exchangeRates)
    .orderBy(
      asc(exchangeRates.fromCurrency),
      asc(exchangeRates.toCurrency),
      desc(exchangeRates.validFrom),
      desc(exchangeRates.id)
    )
    .limit(LIMIT);
  ensureCapacity(rates);
  const rows: Row[] = rates.map(rate => ({
    ...rate,
    ...configurationFields(rate.toCurrency),
    status:
      rate.validFrom > now
        ? "future"
        : rate.validTo && rate.validTo <= now
          ? "expired"
          : "current",
  }));
  for (const currency of [...configurations.values()].sort((a, b) =>
    a.code.localeCompare(b.code)
  )) {
    if (currency.code === "SAR") {
      rows.push({
        ...currency,
        rateId: null,
        fromCurrency: "SAR",
        toCurrency: "SAR",
        rate: "1",
        source: "identity",
        validFrom: null,
        validTo: null,
        status: "identity",
      });
    } else if (
      !rates.some(
        rate =>
          rate.fromCurrency === "SAR" &&
          rate.toCurrency === currency.code &&
          rate.validFrom <= now &&
          (!rate.validTo || rate.validTo > now)
      )
    ) {
      rows.push({
        ...currency,
        rateId: null,
        fromCurrency: "SAR",
        toCurrency: currency.code,
        rate: null,
        source: null,
        validFrom: null,
        validTo: null,
        status: "missing_current_rate",
      });
    }
  }
  return reportTable(
    [
      numberColumn("rateId", "Rate record ID"),
      textColumn("fromCurrency", "Base currency"),
      textColumn("toCurrency", "Quote currency"),
      numberColumn("currencyId", "Stored currency configuration ID"),
      textColumn("currencyName", "Catalog currency name"),
      { key: "catalogActive", label: "Catalog active", type: "boolean" },
      {
        key: "configuredBaseCurrency",
        label: "Stored base currency flag",
        type: "boolean",
      },
      textColumn("configurationSource", "Currency configuration source"),
      textColumn("rate", "Quote units per base unit (exact decimal)"),
      textColumn("source", "Recorded source"),
      dateColumn("validFrom", "Valid from (UTC)"),
      dateColumn("validTo", "Valid until, exclusive (UTC)"),
      textColumn("status", "Validity state"),
    ],
    rows,
    [
      "Currency configuration is shared across the platform. All persisted rate versions are shown; overlapping current records are not silently resolved.",
      "Persisted currency names, active flags and base flags take precedence over application catalog defaults. Application-only entries and rate-only currencies identify their source explicitly; a display-list entry does not establish an activation flag. SAR is the application's conversion base for missing-rate checks, independently of stored base flags.",
      `Validity is evaluated at ${now.toISOString()}. No fallback or calculated cross-rate is presented as a configured rate.`,
    ]
  );
}

async function fareReport(
  db: Reader,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const originCode = required(
    filters.origin,
    "Origin airport code"
  ).toUpperCase();
  const destinationCode =
    id === 12
      ? required(filters.destination, "Destination airport code").toUpperCase()
      : undefined;
  const originAirport = await db
    .select({ id: airports.id })
    .from(airports)
    .where(eq(airports.code, originCode))
    .limit(1);
  if (!originAirport.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Origin airport was not found",
    });
  const destinationAirport = destinationCode
    ? await db
        .select({ id: airports.id })
        .from(airports)
        .where(eq(airports.code, destinationCode))
        .limit(1)
    : [];
  if (destinationCode && !destinationAirport.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Destination airport was not found",
    });
  let tenantAirlineIds: number[] | undefined;
  if (scope.tenantId !== undefined) {
    const owned = await db
      .selectDistinct({ airlineId: flights.airlineId })
      .from(flights)
      .where(eq(flights.tenantId, scope.tenantId))
      .limit(LIMIT);
    ensureCapacity(owned);
    tenantAirlineIds = owned.map(row => row.airlineId);
  }
  const { start, end } = standardReportPeriod(filters);
  const origin = alias(airports, "fare_report_origin");
  const destination = alias(airports, "fare_report_destination");
  const rows =
    tenantAirlineIds?.length === 0
      ? []
      : await db
          .select({
            ruleId: fareRules.id,
            airline: airlines.code,
            fareClassId: fareClasses.id,
            fareClass: fareClasses.code,
            fareClassName: fareClasses.name,
            cabin: fareClasses.cabinClass,
            fareFamily: fareClasses.fareFamily,
            classMultiplier: fareClasses.basePriceMultiplier,
            classActive: fareClasses.active,
            ruleName: fareRules.ruleName,
            category: fareRules.ruleCategory,
            origin: origin.code,
            destination: destination.code,
            validFrom: fareRules.validFrom,
            validTo: fareRules.validUntil,
            ruleAdjustmentMinor: fareRules.priceAdjustment,
            ruleMultiplier: fareRules.priceMultiplier,
            active: fareRules.active,
          })
          .from(fareRules)
          .innerJoin(
            fareClasses,
            and(
              eq(fareClasses.id, fareRules.fareClassId),
              eq(fareClasses.airlineId, fareRules.airlineId)
            )
          )
          .innerJoin(airlines, eq(airlines.id, fareRules.airlineId))
          .leftJoin(origin, eq(origin.id, fareRules.originAirportId))
          .leftJoin(
            destination,
            eq(destination.id, fareRules.destinationAirportId)
          )
          .where(
            and(
              or(
                isNull(fareRules.originAirportId),
                eq(fareRules.originAirportId, originAirport[0].id)
              ),
              destinationCode
                ? or(
                    isNull(fareRules.destinationAirportId),
                    eq(fareRules.destinationAirportId, destinationAirport[0].id)
                  )
                : undefined,
              tenantAirlineIds
                ? inArray(fareRules.airlineId, tenantAirlineIds)
                : undefined,
              start
                ? or(
                    isNull(fareRules.validUntil),
                    gte(fareRules.validUntil, start)
                  )
                : undefined,
              end ? lt(fareRules.validFrom, end) : undefined
            )
          )
          .orderBy(asc(airlines.code), asc(fareClasses.code), asc(fareRules.id))
          .limit(LIMIT);
  return reportTable(
    [
      numberColumn("ruleId", "Rule ID"),
      textColumn("airline", "Airline"),
      numberColumn("fareClassId", "Fare class ID"),
      textColumn("fareClass", "Fare class"),
      textColumn("fareClassName", "Fare name"),
      textColumn("cabin", "Cabin"),
      textColumn("fareFamily", "Fare family"),
      textColumn("classMultiplier", "Class base-price multiplier"),
      { key: "classActive", label: "Class active", type: "boolean" },
      textColumn("ruleName", "Rule name"),
      textColumn("category", "Rule category"),
      textColumn("origin", "Filed origin (null = all)"),
      textColumn("destination", "Filed destination (null = all)"),
      dateColumn("validFrom", "Valid from (UTC)"),
      dateColumn("validTo", "Valid until (UTC)"),
      numberColumn(
        "ruleAdjustmentMinor",
        "Rule price adjustment (SAR minor units)"
      ),
      textColumn("ruleMultiplier", "Rule price multiplier"),
      { key: "active", label: "Rule active", type: "boolean" },
    ],
    rows,
    [
      "Origin and destination filters use airport IATA codes and preserve direction. Null route endpoints mean all airports.",
      "The period selects rules whose validity overlaps the selected complete UTC days. Active and inactive filed rules are retained and labelled; conditions and quoted final prices are not inferred.",
    ]
  );
}

async function loyaltyReport(
  db: Reader,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  if (id === 30) {
    const tier = checkedStatus(filters.status, loyaltyAccounts.tier.enumValues);
    const rows = await db
      .select({
        membershipId: loyaltyAccounts.id,
        memberId: users.id,
        name: users.name,
        tier: loyaltyAccounts.tier,
        memberSince: loyaltyAccounts.memberSince,
        lastActivityAt: loyaltyAccounts.lastActivityAt,
        currentMilesBalance: loyaltyAccounts.currentMilesBalance,
        totalMilesEarned: loyaltyAccounts.totalMilesEarned,
      })
      .from(loyaltyAccounts)
      .innerJoin(users, eq(users.id, loyaltyAccounts.userId))
      .where(
        and(
          tenantCondition(users.tenantId, scope),
          ...periodConditions(loyaltyAccounts.memberSince, filters),
          tier ? eq(loyaltyAccounts.tier, tier) : undefined
        )
      )
      .orderBy(desc(loyaltyAccounts.memberSince), desc(loyaltyAccounts.id))
      .limit(LIMIT);
    return reportTable(
      [
        numberColumn("membershipId", "Membership ID"),
        numberColumn("memberId", "Member (user) ID"),
        textColumn("name", "Member name"),
        textColumn("tier", "Tier"),
        dateColumn("memberSince", "Membership started (UTC)"),
        dateColumn("lastActivityAt", "Last activity (UTC)"),
        numberColumn("currentMilesBalance", "Current miles"),
        numberColumn("totalMilesEarned", "Lifetime miles earned"),
      ],
      rows
    );
  }
  const memberId =
    id === 31 ? required(filters.memberId, "Member (user) ID") : undefined;
  const status = checkedStatus(
    filters.status,
    milesTransactions.type.enumValues
  );
  const rows = await db
    .select({
      transactionId: milesTransactions.id,
      membershipId: milesTransactions.loyaltyAccountId,
      memberId: milesTransactions.userId,
      name: users.name,
      type: milesTransactions.type,
      miles: milesTransactions.amount,
      balanceAfter: milesTransactions.balanceAfter,
      createdAt: milesTransactions.createdAt,
      expiresAt: milesTransactions.expiresAt,
    })
    .from(milesTransactions)
    .innerJoin(users, eq(users.id, milesTransactions.userId))
    .innerJoin(
      loyaltyAccounts,
      and(
        eq(loyaltyAccounts.id, milesTransactions.loyaltyAccountId),
        eq(loyaltyAccounts.userId, milesTransactions.userId)
      )
    )
    .where(
      and(
        tenantCondition(users.tenantId, scope),
        ...periodConditions(milesTransactions.createdAt, filters),
        memberId ? eq(milesTransactions.userId, memberId) : undefined,
        status ? eq(milesTransactions.type, status) : undefined
      )
    )
    .orderBy(desc(milesTransactions.createdAt), desc(milesTransactions.id))
    .limit(LIMIT);
  return reportTable(
    [
      numberColumn("transactionId", "Transaction ID"),
      numberColumn("membershipId", "Membership ID"),
      numberColumn("memberId", "Member (user) ID"),
      textColumn("name", "Member name"),
      textColumn("type", "Transaction type"),
      numberColumn("miles", "Signed miles"),
      numberColumn("balanceAfter", "Miles balance after"),
      dateColumn("createdAt", "Transaction time (UTC)"),
      dateColumn("expiresAt", "Expiry (UTC)"),
    ],
    rows,
    [
      "Membership ownership is validated against the transaction's user ID. The period applies to each transaction, not the member's join date.",
    ]
  );
}

const bookingColumns = [
  numberColumn("bookingId", "Booking ID"),
  textColumn("bookingReference", "Booking reference"),
  textColumn("pnr", "PNR"),
  numberColumn("userId", "Owner user ID"),
  numberColumn("flightId", "Primary flight ID"),
  textColumn("status", "Booking status"),
  textColumn("paymentStatus", "Payment status"),
  numberColumn("numberOfPassengers", "Declared passengers"),
  textColumn("cabinClass", "Cabin"),
  numberColumn("totalAmountMinor", "Booking amount (SAR minor units)"),
  dateColumn("createdAt", "Created at (UTC)"),
];

const bookingSelection = {
  bookingId: bookings.id,
  bookingReference: bookings.bookingReference,
  pnr: bookings.pnr,
  userId: bookings.userId,
  flightId: bookings.flightId,
  status: bookings.status,
  paymentStatus: bookings.paymentStatus,
  numberOfPassengers: bookings.numberOfPassengers,
  cabinClass: bookings.cabinClass,
  totalAmountMinor: bookings.totalAmount,
  createdAt: bookings.createdAt,
};

async function latestBookings(
  db: Reader,
  id: number,
  scope: StandardReportScope
) {
  const rows = await db
    .select(bookingSelection)
    .from(bookings)
    .where(
      and(tenantCondition(bookings.tenantId, scope), isNull(bookings.deletedAt))
    )
    .orderBy(desc(bookings.createdAt), desc(bookings.id))
    .limit(id === 42 ? 1 : 50);
  return reportTable(bookingColumns, rows, [
    "Soft-deleted bookings are excluded. All business statuses, including cancelled, are retained. Equal creation times are resolved by descending booking ID.",
  ]);
}

async function messageConfiguration(db: Reader, scope: StandardReportScope) {
  const routes = await db
    .select({
      id: operationalMessageRoutes.id,
      tenantId: operationalMessageRoutes.tenantId,
      station: operationalMessageRoutes.stationCode,
      type: operationalMessageRoutes.messageType,
      originAddress: operationalMessageRoutes.originAddress,
      destinationAddress: operationalMessageRoutes.destinationAddress,
      transportProfile: operationalMessageRoutes.transportProfile,
      enabled: operationalMessageRoutes.enabled,
      acceptedAt: operationalMessageRoutes.acceptedAt,
    })
    .from(operationalMessageRoutes)
    .where(tenantCondition(operationalMessageRoutes.tenantId, scope))
    .orderBy(
      asc(operationalMessageRoutes.tenantId),
      asc(operationalMessageRoutes.stationCode),
      asc(operationalMessageRoutes.id)
    )
    .limit(LIMIT);
  const rows: Row[] = routes.map(route => ({
    ...route,
    channel: "type_b",
    source: "operational_message_routes",
    configurationState: route.enabled ? "enabled" : "disabled",
  }));
  for (const template of Object.values(SMS_TEMPLATES)) {
    rows.push({
      id: template.id,
      channel: "sms",
      type: template.nameEn,
      source: "application_sms_template",
      configurationState: "template_defined",
      enabled: null,
      acceptedAt: null,
    });
  }
  return reportTable(
    [
      textColumn("id", "Configuration ID"),
      numberColumn("tenantId", "Tenant ID"),
      textColumn("channel", "Channel"),
      textColumn("type", "Message type/template"),
      textColumn("station", "Station"),
      textColumn("originAddress", "Origin address"),
      textColumn("destinationAddress", "Destination address"),
      textColumn("transportProfile", "Transport profile name"),
      textColumn("source", "Configuration source"),
      textColumn("configurationState", "Configuration state"),
      { key: "enabled", label: "Route enabled", type: "boolean" },
      dateColumn("acceptedAt", "Route accepted at (UTC)"),
    ],
    rows,
    [
      "A defined template is not a delivery receipt. No credentials, transport secrets or message bodies are included.",
    ]
  );
}

const bookingIdRef = sql`${sql.identifier("bookings")}.${sql.identifier("id")}`;

async function matchingBookings(
  db: Reader,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const conditions: Array<SQL | undefined> = [
    tenantCondition(bookings.tenantId, scope),
    isNull(bookings.deletedAt),
  ];
  if (id === 62) {
    const flightId = required(filters.flightId, "Flight ID");
    const flight = await db
      .select({ id: flights.id, tenantId: flights.tenantId })
      .from(flights)
      .where(
        and(eq(flights.id, flightId), tenantCondition(flights.tenantId, scope))
      )
      .limit(1);
    if (!flight.length)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight was not found in the reporting scope",
      });
    conditions.push(
      flight[0].tenantId === null
        ? isNull(bookings.tenantId)
        : eq(bookings.tenantId, flight[0].tenantId),
      or(
        sql`EXISTS (SELECT 1 FROM ${bookingSegments} WHERE ${bookingSegments.bookingId} = ${bookingIdRef} AND ${bookingSegments.flightId} = ${flightId} AND ${bookingSegments.status} IN ('pending', 'confirmed', 'completed'))`,
        and(
          eq(bookings.flightId, flightId),
          sql`NOT EXISTS (SELECT 1 FROM ${bookingSegments} WHERE ${bookingSegments.bookingId} = ${bookingIdRef})`
        )
      )
    );
  } else {
    const reference = required(
      filters.bookingReference,
      "Booking reference or PNR"
    );
    conditions.push(
      or(eq(bookings.bookingReference, reference), eq(bookings.pnr, reference))
    );
  }
  const rows = await db
    .select(bookingSelection)
    .from(bookings)
    .where(and(...conditions))
    .orderBy(asc(bookings.id))
    .limit(LIMIT);
  ensureCapacity(rows);
  return rows;
}

const detailColumns = [
  textColumn("recordType", "Record type"),
  textColumn("source", "Source"),
  textColumn("recordId", "Source record ID"),
  numberColumn("bookingId", "Booking ID"),
  textColumn("bookingReference", "Booking reference"),
  textColumn("pnr", "PNR"),
  numberColumn("userId", "User/actor ID"),
  numberColumn("flightId", "Flight ID"),
  numberColumn("passengerId", "Passenger ID"),
  textColumn("name", "Name/type"),
  textColumn("status", "Status/event"),
  textColumn("previousStatus", "Previous status"),
  dateColumn("occurredAt", "Recorded time (UTC)"),
  textColumn("origin", "Origin"),
  textColumn("destination", "Destination"),
  dateColumn("departureAt", "Departure (UTC)"),
  dateColumn("arrivalAt", "Arrival (UTC)"),
  textColumn("cabinClass", "Cabin"),
  textColumn("passengerType", "Passenger type"),
  textColumn("seatNumber", "Seat"),
  textColumn("documentNumber", "Local ticket number"),
  numberColumn("couponNumber", "Coupon number"),
  numberColumn("quantity", "Quantity/passengers"),
  numberColumn("amountMinor", "Amount (minor units)"),
  textColumn("amountMajor", "Ledger amount (exact major units)"),
  textColumn("currency", "Currency"),
  textColumn("paymentMethod", "Payment method"),
];

async function bookingTimeline(
  db: Reader,
  bookingRows: Awaited<ReturnType<typeof matchingBookings>>,
  filters: StandardReportFilters
) {
  if (!bookingRows.length) return [];
  const ids = bookingRows.map(row => row.bookingId);
  const { start, end } = standardReportPeriod(filters);
  const result: Row[] = bookingRows
    .filter(
      row => (!start || row.createdAt >= start) && (!end || row.createdAt < end)
    )
    .map<Row>(row => ({
      ...row,
      recordType: "booking_created",
      source: "bookings",
      recordId: row.bookingId,
      occurredAt: row.createdAt,
      amountMinor: row.totalAmountMinor,
      currency: "SAR",
      status: "created",
    }));
  const states = await db
    .select({
      recordId: bookingStatusHistory.id,
      bookingId: bookingStatusHistory.bookingId,
      occurredAt: bookingStatusHistory.transitionedAt,
      status: bookingStatusHistory.newStatus,
      previousStatus: bookingStatusHistory.previousStatus,
      userId: bookingStatusHistory.changedBy,
    })
    .from(bookingStatusHistory)
    .where(
      and(
        inArray(bookingStatusHistory.bookingId, ids),
        ...periodConditions(bookingStatusHistory.transitionedAt, filters)
      )
    )
    .orderBy(
      asc(bookingStatusHistory.transitionedAt),
      asc(bookingStatusHistory.id)
    )
    .limit(LIMIT);
  result.push(
    ...states.map(row => ({
      ...row,
      recordType: "booking_state",
      source: "booking_status_history",
    }))
  );
  ensureCapacity(result);
  const events = await db
    .select({
      recordId: paymentHistory.id,
      bookingId: paymentHistory.bookingId,
      occurredAt: paymentHistory.createdAt,
      status: paymentHistory.event,
      previousStatus: paymentHistory.fromStatus,
      amountMinor: paymentHistory.amount,
      currency: paymentHistory.currency,
      userId: paymentHistory.userId,
    })
    .from(paymentHistory)
    .innerJoin(bookings, eq(bookings.id, paymentHistory.bookingId))
    .innerJoin(
      payments,
      and(
        eq(payments.id, paymentHistory.paymentId),
        eq(payments.bookingId, paymentHistory.bookingId),
        ownedNullableTenant(payments.tenantId)
      )
    )
    .where(
      and(
        inArray(paymentHistory.bookingId, ids),
        ...periodConditions(paymentHistory.createdAt, filters)
      )
    )
    .orderBy(asc(paymentHistory.createdAt), asc(paymentHistory.id))
    .limit(LIMIT);
  result.push(
    ...events.map(row => ({
      ...row,
      recordType: "payment_event",
      source: "payment_history",
    }))
  );
  ensureCapacity(result);
  const modifications = await db
    .select({
      recordId: bookingModifications.id,
      bookingId: bookingModifications.bookingId,
      occurredAt: bookingModifications.createdAt,
      status: bookingModifications.status,
      name: bookingModifications.modificationType,
      flightId: bookingModifications.newFlightId,
      amountMinor: bookingModifications.totalCost,
      userId: bookingModifications.userId,
    })
    .from(bookingModifications)
    .where(
      and(
        inArray(bookingModifications.bookingId, ids),
        ...periodConditions(bookingModifications.createdAt, filters)
      )
    )
    .orderBy(asc(bookingModifications.createdAt), asc(bookingModifications.id))
    .limit(LIMIT);
  result.push(
    ...modifications.map(row => ({
      ...row,
      recordType: "servicing_request",
      source: "booking_modifications",
      currency: "SAR",
    }))
  );
  ensureCapacity(result);
  const ledger = await db
    .select({
      recordId: financialLedger.id,
      bookingId: financialLedger.bookingId,
      occurredAt: financialLedger.transactionDate,
      status: financialLedger.type,
      amountMajor: financialLedger.amount,
      currency: financialLedger.currency,
    })
    .from(financialLedger)
    .where(
      and(
        inArray(financialLedger.bookingId, ids),
        ...periodConditions(financialLedger.transactionDate, filters)
      )
    )
    .orderBy(asc(financialLedger.transactionDate), asc(financialLedger.id))
    .limit(LIMIT);
  result.push(
    ...ledger.map(row => ({
      ...row,
      recordType: "financial_ledger",
      source: "financial_ledger",
    }))
  );
  ensureCapacity(result);
  const audit = await db
    .select({
      recordId: auditLogs.id,
      resourceId: auditLogs.resourceId,
      occurredAt: auditLogs.timestamp,
      name: auditLogs.eventType,
      status: auditLogs.outcome,
      userId: auditLogs.userId,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "booking"),
        inArray(auditLogs.resourceId, ids.map(String)),
        ...periodConditions(auditLogs.timestamp, filters)
      )
    )
    .orderBy(asc(auditLogs.timestamp), asc(auditLogs.id))
    .limit(LIMIT);
  result.push(
    ...audit.map(({ resourceId, ...row }) => ({
      ...row,
      bookingId: Number(resourceId),
      recordType: "audit_event",
      source: "audit_logs",
    }))
  );
  ensureCapacity(result);
  const references = new Map(bookingRows.map(row => [row.bookingId, row]));
  return result
    .map<Row>(row => ({
      ...row,
      bookingReference: references.get(Number(row.bookingId))?.bookingReference,
      pnr: references.get(Number(row.bookingId))?.pnr,
    }))
    .sort(
      (a, b) =>
        new Date(a.occurredAt as Date).getTime() -
          new Date(b.occurredAt as Date).getTime() ||
        String(a.source).localeCompare(String(b.source)) ||
        String(a.recordId).localeCompare(String(b.recordId), "en", {
          numeric: true,
        })
    );
}

async function pnrReport(
  db: Reader,
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const bookingRows = await matchingBookings(db, id, filters, scope);
  if (id === 60)
    return reportTable(
      detailColumns,
      await bookingTimeline(db, bookingRows, filters),
      [
        "Each row is an event from its named source. A servicing row is dated when its request was created; its current status is not presented as a historically timestamped completion.",
      ]
    );
  if (!bookingRows.length) return reportTable(detailColumns, []);
  const ids = bookingRows.map(row => row.bookingId);
  const result: Row[] = bookingRows.map(row => ({
    ...row,
    recordType: "booking",
    source: "bookings",
    recordId: row.bookingId,
    occurredAt: row.createdAt,
    amountMinor: row.totalAmountMinor,
    currency: "SAR",
    quantity: row.numberOfPassengers,
  }));
  const passengerRows = await db
    .select({
      recordId: passengers.id,
      passengerId: passengers.id,
      bookingId: passengers.bookingId,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      passengerType: passengers.type,
      seatNumber: passengers.seatNumber,
      documentNumber: passengers.ticketNumber,
      occurredAt: passengers.createdAt,
    })
    .from(passengers)
    .innerJoin(bookings, eq(bookings.id, passengers.bookingId))
    .where(
      and(
        inArray(passengers.bookingId, ids),
        ownedNullableTenant(passengers.tenantId)
      )
    )
    .orderBy(asc(passengers.bookingId), asc(passengers.id))
    .limit(LIMIT);
  result.push(
    ...passengerRows.map(({ firstName, lastName, ...row }) => ({
      ...row,
      name: `${firstName} ${lastName}`,
      recordType: "passenger",
      source: "passengers",
    }))
  );
  ensureCapacity(result);
  const origin = alias(airports, "pnr_report_origin");
  const destination = alias(airports, "pnr_report_destination");
  const sectors = await db
    .select({
      recordId: bookingSegments.id,
      bookingId: bookingSegments.bookingId,
      flightId: flights.id,
      name: flights.flightNumber,
      status: bookingSegments.status,
      quantity: bookingSegments.segmentOrder,
      amountMinor: bookingSegments.segmentAmount,
      origin: origin.code,
      destination: destination.code,
      departureAt: flights.departureTime,
      arrivalAt: flights.arrivalTime,
      occurredAt: bookingSegments.createdAt,
    })
    .from(bookingSegments)
    .innerJoin(bookings, eq(bookings.id, bookingSegments.bookingId))
    .innerJoin(
      flights,
      and(
        eq(flights.id, bookingSegments.flightId),
        sameTenant(flights.tenantId, bookings.tenantId)
      )
    )
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(inArray(bookingSegments.bookingId, ids))
    .orderBy(
      asc(bookingSegments.bookingId),
      asc(bookingSegments.segmentOrder),
      asc(bookingSegments.id)
    )
    .limit(LIMIT);
  result.push(
    ...sectors.map(row => ({
      ...row,
      recordType: "segment",
      source: "booking_segments",
      currency: "SAR",
    }))
  );
  ensureCapacity(result);
  const legacy = await db
    .select({
      bookingId: bookings.id,
      flightId: flights.id,
      name: flights.flightNumber,
      status: bookings.status,
      origin: origin.code,
      destination: destination.code,
      departureAt: flights.departureTime,
      arrivalAt: flights.arrivalTime,
    })
    .from(bookings)
    .innerJoin(
      flights,
      and(
        eq(flights.id, bookings.flightId),
        sameTenant(flights.tenantId, bookings.tenantId)
      )
    )
    .innerJoin(origin, eq(origin.id, flights.originId))
    .innerJoin(destination, eq(destination.id, flights.destinationId))
    .where(
      and(
        inArray(bookings.id, ids),
        sql`NOT EXISTS (SELECT 1 FROM ${bookingSegments} WHERE ${bookingSegments.bookingId} = ${bookingIdRef})`
      )
    )
    .orderBy(asc(bookings.id))
    .limit(LIMIT);
  result.push(
    ...legacy.map(row => ({
      ...row,
      recordId: row.bookingId,
      recordType: "legacy_sector",
      source: "bookings",
      quantity: 1,
    }))
  );
  ensureCapacity(result);
  const coupons = await db
    .select({
      recordId: ticketCoupons.id,
      bookingId: ticketCoupons.bookingId,
      passengerId: ticketCoupons.passengerId,
      flightId: ticketCoupons.flightId,
      documentNumber: ticketCoupons.ticketNumber,
      couponNumber: ticketCoupons.couponNumber,
      status: ticketCoupons.status,
      occurredAt: ticketCoupons.createdAt,
    })
    .from(ticketCoupons)
    .innerJoin(bookings, eq(bookings.id, ticketCoupons.bookingId))
    .innerJoin(
      passengers,
      and(
        eq(passengers.id, ticketCoupons.passengerId),
        eq(passengers.bookingId, ticketCoupons.bookingId),
        ownedNullableTenant(passengers.tenantId)
      )
    )
    .innerJoin(
      flights,
      and(
        eq(flights.id, ticketCoupons.flightId),
        sameTenant(flights.tenantId, bookings.tenantId)
      )
    )
    .where(inArray(ticketCoupons.bookingId, ids))
    .orderBy(asc(ticketCoupons.bookingId), asc(ticketCoupons.id))
    .limit(LIMIT);
  result.push(
    ...coupons.map(row => ({
      ...row,
      recordType: "local_coupon",
      source: "ticket_coupons",
    }))
  );
  ensureCapacity(result);
  const paymentRows = await db
    .select({
      recordId: payments.id,
      bookingId: payments.bookingId,
      amountMinor: payments.amount,
      currency: payments.currency,
      paymentMethod: payments.method,
      status: payments.status,
      occurredAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(
        inArray(payments.bookingId, ids),
        ownedNullableTenant(payments.tenantId)
      )
    )
    .orderBy(asc(payments.bookingId), asc(payments.id))
    .limit(LIMIT);
  result.push(
    ...paymentRows.map(row => ({
      ...row,
      recordType: "payment",
      source: "payments",
    }))
  );
  ensureCapacity(result);
  const fares = await db
    .select({
      recordId: bookingFareComponents.id,
      bookingId: bookingFareComponents.bookingId,
      passengerId: bookingFareComponents.passengerId,
      flightId: bookingFareComponents.flightId,
      name: bookingFareComponents.code,
      status: bookingFareComponents.componentType,
      amountMinor: bookingFareComponents.amount,
      currency: bookingFareComponents.currency,
      occurredAt: bookingFareComponents.createdAt,
      reversedAt: bookingFareComponents.reversedAt,
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
    .where(
      and(
        inArray(bookingFareComponents.bookingId, ids),
        ownedNullableTenant(bookingFareComponents.tenantId),
        ownedOptionalPassenger(db, bookingFareComponents.passengerId)
      )
    )
    .orderBy(
      asc(bookingFareComponents.bookingId),
      asc(bookingFareComponents.id)
    )
    .limit(LIMIT);
  result.push(
    ...fares.map(({ reversedAt, ...row }) => ({
      ...row,
      recordType: reversedAt ? "reversed_fare_component" : "fare_component",
      source: "booking_fare_components",
    }))
  );
  ensureCapacity(result);
  const ancillaryRows = await db
    .select({
      recordId: bookingAncillaries.id,
      bookingId: bookingAncillaries.bookingId,
      passengerId: bookingAncillaries.passengerId,
      name: ancillaryServices.name,
      quantity: bookingAncillaries.quantity,
      amountMinor: bookingAncillaries.totalPrice,
      status: bookingAncillaries.status,
      occurredAt: bookingAncillaries.createdAt,
    })
    .from(bookingAncillaries)
    .innerJoin(bookings, eq(bookings.id, bookingAncillaries.bookingId))
    .innerJoin(
      ancillaryServices,
      eq(ancillaryServices.id, bookingAncillaries.ancillaryServiceId)
    )
    .where(
      and(
        inArray(bookingAncillaries.bookingId, ids),
        ownedOptionalPassenger(db, bookingAncillaries.passengerId)
      )
    )
    .orderBy(asc(bookingAncillaries.bookingId), asc(bookingAncillaries.id))
    .limit(LIMIT);
  result.push(
    ...ancillaryRows.map(row => ({
      ...row,
      recordType: "ancillary_purchase",
      source: "booking_ancillaries",
      currency: null,
    }))
  );
  ensureCapacity(result);
  result.push(...(await bookingTimeline(db, bookingRows, {})));
  const references = new Map(bookingRows.map(row => [row.bookingId, row]));
  return reportTable(
    detailColumns,
    result.map(row => ({
      ...row,
      bookingReference: references.get(Number(row.bookingId))?.bookingReference,
      pnr: references.get(Number(row.bookingId))?.pnr,
    })),
    [
      "Record types prevent passenger/sector/payment joins from multiplying monetary rows. Segment quantity denotes segment order; booking quantity denotes declared passengers.",
      "Children are included only through their owning booking. Nullable legacy tenant fields inherit that booking's ownership; explicit tenant or passenger/booking conflicts are excluded even in a global report.",
      "Fare components retain their recorded component codes and reversal state; they are not an approved tax-code registry. Local coupon state is not external carrier acceptance.",
      "Ancillary currency is unknown where the purchase did not capture it; current catalog currency is not retroactively substituted. No booking total is apportioned across passengers or sectors without recorded allocation.",
    ]
  );
}

function recordedFundingKind(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = (value as Record<string, unknown>).kind;
  return typeof kind === "string" &&
    [
      "collected_modification",
      "authorized_no_charge",
      "internal_booking",
      "split_booking",
      "collected_booking",
    ].includes(kind)
    ? kind
    : null;
}

async function productSales(
  db: Reader,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const status = checkedStatus(
    filters.status,
    bookingAncillaries.status.enumValues
  );
  const rows = await db
    .select({
      purchaseId: bookingAncillaries.id,
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      productId: ancillaryServices.id,
      productCode: ancillaryServices.code,
      productName: ancillaryServices.name,
      category: ancillaryServices.category,
      catalogCurrency: ancillaryServices.currency,
      quantity: bookingAncillaries.quantity,
      unitPriceMinor: bookingAncillaries.unitPrice,
      totalPriceMinor: bookingAncillaries.totalPrice,
      status: bookingAncillaries.status,
      bookedAt: bookingAncillaries.createdAt,
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
        tenantCondition(bookings.tenantId, scope),
        sql`${bookingAncillaries.fundedAt} IS NOT NULL`,
        ...periodConditions(bookingAncillaries.fundedAt, filters),
        status ? eq(bookingAncillaries.status, status) : undefined,
        filters.bookingReference
          ? or(
              eq(bookings.bookingReference, filters.bookingReference),
              eq(bookings.pnr, filters.bookingReference)
            )
          : undefined
      )
    )
    .orderBy(asc(bookingAncillaries.fundedAt), asc(bookingAncillaries.id))
    .limit(LIMIT);
  return reportTable(
    [
      numberColumn("purchaseId", "Purchase ID"),
      numberColumn("bookingId", "Booking ID"),
      textColumn("bookingReference", "Booking reference"),
      textColumn("pnr", "PNR"),
      numberColumn("productId", "Product ID"),
      textColumn("productCode", "Product code"),
      textColumn("productName", "Product"),
      textColumn("category", "Category"),
      numberColumn("quantity", "Quantity"),
      numberColumn("unitPriceMinor", "Unit price snapshot (minor units)"),
      numberColumn("totalPriceMinor", "Total price snapshot (minor units)"),
      textColumn("saleCurrency", "Sale currency snapshot (unrecorded)"),
      textColumn("catalogCurrency", "Current catalog currency"),
      textColumn("fundingKind", "Recorded funding kind"),
      textColumn("status", "Current purchase state"),
      dateColumn("bookedAt", "Purchase created (UTC)"),
      dateColumn("fundedAt", "Funded at (UTC)"),
    ],
    rows.map(({ fundingReference, ...row }) => ({
      ...row,
      saleCurrency: null,
      fundingKind: recordedFundingKind(fundingReference),
    })),
    [
      "The date range is based on fundedAt, not booking creation. Cancelled and refunded purchases remain visible unless a status filter is selected.",
      "No payment-intent IDs, funding payloads, product-level net revenue or inferred refund amounts are exported.",
    ]
  );
}

async function generatedMessages(
  db: Reader,
  filters: StandardReportFilters,
  scope: StandardReportScope
) {
  const status = checkedStatus(
    filters.status,
    operationalMessageTransmissions.status.enumValues
  );
  const rows = await db
    .select({
      transmissionId: operationalMessageTransmissions.id,
      tenantId: operationalMessageTransmissions.tenantId,
      flightId: operationalMessageTransmissions.flightId,
      messageType: operationalMessageTransmissions.messageType,
      status: operationalMessageTransmissions.status,
      attempts: operationalMessageTransmissions.attemptCount,
      createdAt: operationalMessageTransmissions.createdAt,
      sentAt: operationalMessageTransmissions.sentAt,
      acknowledgedAt: operationalMessageTransmissions.acknowledgedAt,
      acknowledgmentCode: operationalMessageTransmissions.acknowledgmentCode,
      providerMessageId: operationalMessageTransmissions.providerMessageId,
      messageDigest: operationalMessageTransmissions.messageDigest,
    })
    .from(operationalMessageTransmissions)
    .where(
      and(
        tenantCondition(operationalMessageTransmissions.tenantId, scope),
        eq(operationalMessageTransmissions.direction, "outbound"),
        ...periodConditions(operationalMessageTransmissions.createdAt, filters),
        filters.flightId
          ? eq(operationalMessageTransmissions.flightId, filters.flightId)
          : undefined,
        status ? eq(operationalMessageTransmissions.status, status) : undefined
      )
    )
    .orderBy(
      asc(operationalMessageTransmissions.createdAt),
      asc(operationalMessageTransmissions.id)
    )
    .limit(LIMIT);
  return reportTable(
    [
      numberColumn("transmissionId", "Transmission ID"),
      numberColumn("tenantId", "Tenant ID"),
      numberColumn("flightId", "Flight ID"),
      textColumn("messageType", "Type-B message type"),
      textColumn("status", "Current state"),
      numberColumn("attempts", "Attempts"),
      dateColumn("createdAt", "Generated at (UTC)"),
      dateColumn("sentAt", "Sent at (UTC)"),
      dateColumn("acknowledgedAt", "Acknowledged at (UTC)"),
      textColumn("acknowledgmentCode", "Acknowledgment code"),
      textColumn("providerMessageId", "Provider message ID"),
      textColumn("messageDigest", "Message digest"),
    ],
    rows,
    [
      "Draft/generated, sent and acknowledged are separate recorded states. The report does not promote drafts or transport attempts to external acceptance.",
    ]
  );
}

/** Executes allowlisted commercial reports in one consistent read snapshot. */
export async function getCommercialStandardReport(
  id: number,
  filters: StandardReportFilters,
  scope: StandardReportScope
): Promise<StandardReportTable | undefined> {
  const report = commercialReportDefinitions.find(item => item.id === id);
  if (!report) return undefined;
  if (report.availability === "blocked")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: report.limitations.join(" "),
    });
  for (const [key, value] of Object.entries(filters)) {
    if (
      value !== undefined &&
      !report.filters.includes(key as StandardReportFilterKey)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Filter ${key} is not supported by this report`,
      });
    }
  }
  standardReportPeriod(filters);
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Reporting database is unavailable",
    });
  return db.transaction(
    async tx => {
      let table: StandardReportTable;
      switch (id) {
        case 1:
          table = await userReport(tx, filters, scope);
          break;
        case 4:
          table = await currenciesReport(tx);
          break;
        case 11:
        case 12:
          table = await fareReport(tx, id, filters, scope);
          break;
        case 29:
        case 30:
        case 31:
          table = await loyaltyReport(tx, id, filters, scope);
          break;
        case 42:
        case 58:
          table = await latestBookings(tx, id, scope);
          break;
        case 46:
          table = await messageConfiguration(tx, scope);
          break;
        case 59:
        case 60:
        case 62:
          table = await pnrReport(tx, id, filters, scope);
          break;
        case 63:
          table = await productSales(tx, filters, scope);
          break;
        case 97:
          table = await generatedMessages(tx, filters, scope);
          break;
        default:
          return undefined;
      }
      return { ...table, notes: [...report.limitations, ...table.notes] };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
