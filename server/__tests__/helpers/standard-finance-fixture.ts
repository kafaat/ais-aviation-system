import { getTableColumns, getTableName } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import {
  agentBookings,
  airports,
  ancillaryServices,
  auditLogs,
  aviationEvidence,
  bookingAncillaries,
  bookingFareComponents,
  bookingModifications,
  bookings,
  bookingSegments,
  bookingStatusHistory,
  financialLedger,
  flights,
  outbox,
  passengers,
  paymentHistory,
  payments,
  ticketCoupons,
  travelAgents,
} from "../../../drizzle/schema";

export const financeFixtureTables = [
  agentBookings,
  airports,
  ancillaryServices,
  auditLogs,
  aviationEvidence,
  bookingAncillaries,
  bookingFareComponents,
  bookingModifications,
  bookings,
  bookingSegments,
  bookingStatusHistory,
  financialLedger,
  flights,
  outbox,
  passengers,
  paymentHistory,
  payments,
  ticketCoupons,
  travelAgents,
];
export type FixtureValues = Record<string, string | number | null>;
export const october = { startDate: "2026-10-01", endDate: "2026-10-31" };
export const financeScope = { tenantId: 101, userId: 9001 };
export function fixtureTableDdl(table: MySqlTable, native: boolean) {
  return `CREATE TABLE \`${getTableName(table)}\` (${Object.values(
    getTableColumns(table)
  )
    .map(
      column =>
        `\`${column.name}\` ${native ? column.getSQLType() : column.dataType === "number" || column.dataType === "boolean" ? "INTEGER" : "TEXT"}`
    )
    .join(",")})`;
}
export function fixtureInsert(table: MySqlTable, values: FixtureValues) {
  const names = Object.keys(values);
  return {
    sql: `INSERT INTO \`${getTableName(table)}\` (${names.map(name => `\`${name}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
    // SQLite compares its timestamp text lexically; use the same millisecond
    // precision that Drizzle's Date encoder supplies to the real predicates.
    params: Object.values(values).map(value =>
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? value + ".000"
        : value
    ),
  };
}
export function coupon(
  id: number,
  overrides: FixtureValues = {}
): FixtureValues {
  return {
    id,
    bookingId: 1,
    passengerId: 1,
    flightId: 1,
    ticketNumber: "0010000000001",
    couponNumber: 1,
    status: "F",
    createdAt: "2026-10-05 10:00:00",
    updatedAt: "2026-10-10 13:00:00",
    ...overrides,
  };
}
export function component(
  id: number,
  overrides: FixtureValues = {}
): FixtureValues {
  return {
    id,
    bookingId: 1,
    tenantId: 101,
    passengerId: 1,
    flightId: 1,
    componentType: "base_fare",
    code: "AIR_FARE",
    amount: 10000,
    currency: "SAR",
    source: "retail_offer",
    sourceReference: "synthetic-offer-1",
    policyVersion: "synthetic-policy",
    createdAt: "2026-10-01 09:00:00",
    reversedAt: null,
    ...overrides,
  };
}
export function uplift(
  id: number,
  overrides: FixtureValues = {}
): FixtureValues {
  return {
    id,
    sourceId: "synthetic-operator",
    sourceEventId: `synthetic-uplift-${id}`,
    tenantId: 101,
    flightId: 1,
    kind: "coupon_uplift",
    payload: JSON.stringify({ couponId: 100, bookingId: 1, passengerId: 1 }),
    digest: "a".repeat(64),
    observedAt: "2026-10-10 13:00:00",
    receivedAt: "2026-10-10 13:01:00",
    ingestSnapshot: null,
    ...overrides,
  };
}
export function payment(
  id: number,
  overrides: FixtureValues = {}
): FixtureValues {
  return {
    id,
    tenantId: 101,
    bookingId: 1,
    amount: 12000,
    currency: "SAR",
    method: "card",
    provider: "stripe",
    status: "completed",
    transactionId: `synthetic-payment-${id}`,
    createdAt: "2026-10-01 00:00:00",
    updatedAt: "2026-10-01 00:01:00",
    ...overrides,
  };
}
export function voidEvent(
  id: number,
  overrides: FixtureValues = {}
): FixtureValues {
  return {
    id,
    eventId: `synthetic-void-${id}`,
    aggregateType: "booking",
    aggregateId: "1",
    eventType: "booking.cancelled",
    tenantId: 101,
    payload: JSON.stringify({
      bookingId: 1,
      localCouponTransitions: [
        {
          couponId: 100,
          passengerId: 1,
          flightId: 1,
          couponNumber: 1,
          previousStatus: "O",
          status: "V",
        },
      ],
    }),
    createdAt: "2026-10-07 23:59:59",
    ...overrides,
  };
}

/** All identities, names and source receipts are synthetic; no provider is called. */
export const baseFinanceRows: Array<[MySqlTable, FixtureValues]> = [
  [airports, { id: 1, code: "JED", city: "Jeddah" }],
  [airports, { id: 2, code: "RUH", city: "Riyadh" }],
  [airports, { id: 3, code: "DXB", city: "Dubai" }],
  [
    flights,
    {
      id: 1,
      tenantId: 101,
      flightNumber: "SYN101",
      originId: 1,
      destinationId: 2,
      departureTime: "2026-10-10 10:00:00",
      status: "completed",
    },
  ],
  [
    flights,
    {
      id: 2,
      tenantId: 101,
      flightNumber: "SYN102",
      originId: 2,
      destinationId: 3,
      departureTime: "2026-10-20 10:00:00",
      status: "scheduled",
    },
  ],
  [
    flights,
    {
      id: 3,
      tenantId: 202,
      flightNumber: "FOREIGN",
      originId: 1,
      destinationId: 3,
      departureTime: "2026-10-10 10:00:00",
      status: "completed",
    },
  ],
  [
    bookings,
    {
      id: 1,
      tenantId: 101,
      userId: 1,
      flightId: 1,
      bookingReference: "REF001",
      pnr: "PNR001",
      status: "confirmed",
      totalAmount: 25000,
      createdAt: "2026-10-01 09:00:00",
      deletedAt: null,
    },
  ],
  [
    bookings,
    {
      id: 2,
      tenantId: 202,
      userId: 2,
      flightId: 3,
      bookingReference: "REF002",
      pnr: "PNR002",
      status: "confirmed",
      totalAmount: 99999,
      createdAt: "2026-10-01 09:00:00",
      deletedAt: null,
    },
  ],
  [
    passengers,
    {
      id: 1,
      tenantId: 101,
      bookingId: 1,
      firstName: "Synthetic",
      lastName: "Traveller One",
    },
  ],
  [
    passengers,
    {
      id: 2,
      tenantId: 101,
      bookingId: 1,
      firstName: "Synthetic",
      lastName: "Traveller Two",
    },
  ],
  [
    passengers,
    {
      id: 3,
      tenantId: 202,
      bookingId: 2,
      firstName: "Foreign",
      lastName: "Traveller",
    },
  ],
  [ticketCoupons, coupon(100)],
  [ticketCoupons, coupon(101, { flightId: 2, couponNumber: 2, status: "C" })],
  [
    ticketCoupons,
    coupon(102, { passengerId: 2, ticketNumber: "0010000000002", status: "O" }),
  ],
  [
    ticketCoupons,
    coupon(200, {
      bookingId: 2,
      passengerId: 3,
      flightId: 3,
      ticketNumber: "0020000000001",
    }),
  ],
  [bookingFareComponents, component(1)],
  [
    bookingFareComponents,
    component(2, {
      componentType: "tax",
      code: "OFFER_TAX_ESTIMATE",
      amount: 1000,
    }),
  ],
  [bookingFareComponents, component(3, { flightId: 2, amount: 6000 })],
  [bookingFareComponents, component(4, { passengerId: 2, amount: 8000 })],
  [
    bookingFareComponents,
    component(20, {
      bookingId: 2,
      tenantId: 202,
      passengerId: 3,
      flightId: 3,
      amount: 99999,
    }),
  ],
  [aviationEvidence, uplift(1)],
  [payments, payment(1)],
  [payments, payment(2, { tenantId: 202, bookingId: 2, amount: 99999 })],
  [
    financialLedger,
    {
      id: 1001,
      bookingId: 1,
      type: "charge",
      amount: "250.00",
      currency: "SAR",
      metadata: "{}",
      transactionDate: "2026-10-02 12:00:00",
      createdAt: "2026-10-02 12:00:00",
    },
  ],
  [
    financialLedger,
    {
      id: 1002,
      bookingId: 1,
      type: "partial_refund",
      amount: "23.45",
      currency: "SAR",
      metadata: "{}",
      transactionDate: "2026-10-09 23:59:59",
      createdAt: "2026-10-09 23:59:59",
    },
  ],
  [
    financialLedger,
    {
      id: 1003,
      bookingId: 1,
      type: "refund",
      amount: "10.00",
      currency: "SAR",
      metadata: '{"tender":"corporate_credit"}',
      transactionDate: "2026-10-10 00:00:00",
      createdAt: "2026-10-10 00:00:00",
    },
  ],
  [
    financialLedger,
    {
      id: 1004,
      bookingId: 2,
      type: "refund",
      amount: "999.99",
      currency: "SAR",
      metadata: "{}",
      transactionDate: "2026-10-10 00:00:00",
      createdAt: "2026-10-10 00:00:00",
    },
  ],
];
