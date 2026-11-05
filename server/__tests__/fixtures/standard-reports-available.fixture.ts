import type { MySqlTable } from "drizzle-orm/mysql-core";
import type {
  StandardReportFilters,
  ReportCell,
} from "../../../shared/standard-reports";
import {
  bookings,
  currencies,
  exchangeRates,
  loyaltyAccounts,
  milesTransactions,
  users,
} from "../../../drizzle/schema";
import type { FixtureInsert } from "./standard-reports-ops.fixture";

export interface AvailableReportCase {
  id: number;
  family: "operations" | "finance" | "commercial";
  filters: StandardReportFilters;
  columns: string[];
  rows: ReportCell[][];
  period?: {
    day: string;
    days?: number;
    table: string;
    column: string;
    id: number;
    rowKey: string;
    original: string;
    targetRows: number;
  };
  arrange?: string;
  restore?: string;
  foreignRows?: ReportCell[][];
  foreignFilters?: StandardReportFilters;
  sharedAcrossTenants?: boolean;
}

const period = (id = 1, targetRows = 1, days = 1) => ({
  day: id === 2 ? "2030-01-03" : "2030-01-02",
  days,
  table: "flights",
  column: "departureTime",
  id,
  rowKey: "flightId",
  original: id === 2 ? "2030-01-03 00:00:00" : "2030-01-02 10:00:00",
  targetRows,
});
const flight = { flightId: 1 };
const day = { ...flight, startDate: "2030-01-02", endDate: "2030-01-02" };
const peopleColumns = [
  "flightId",
  "bookingId",
  "passengerId",
  "firstName",
  "passengerType",
];
const peopleRows: ReportCell[][] = [
  [1, 10, 100, "Alpha", "adult"],
  [1, 10, 101, "Bravo", "child"],
];
const countColumns = [
  "flightId",
  "confirmedPassengers",
  "bookedPassengers",
  "ticketedPassengers",
  "adults",
  "children",
  "infants",
  "checkedInPassengers",
  "boardedPassengers",
  "offloadedPassengers",
  "noShowPassengers",
];
const countRows: ReportCell[][] = [[1, 2, 3, 2, 1, 1, 0, 1, 0, 1, null]];
const availabilityColumns = [
  "flightId",
  "economySeats",
  "businessSeats",
  "economyRecordedAvailable",
  "businessRecordedAvailable",
  "economyHeld",
  "businessHeld",
  "economyAvailable",
  "businessAvailable",
  "capacity",
  "sold",
  "loadFactorPercent",
];
const availabilityRows: ReportCell[][] = [
  [1, 5, 2, 2, 1, 5, 2, 0, 0, 7, 4, 57.14],
];
const documentColumns = [
  "flightId",
  "passengerId",
  "documentNumber",
  "verificationStatus",
];
const documentRows: ReportCell[][] = [
  [1, 100, "SAFE100", "validated"],
  [1, 101, "LEGACY101", "legacy_unverified"],
];
const routeColumns = [
  "flightId",
  "flightNumber",
  "origin",
  "destination",
  "departureTime",
  "arrivalTime",
];
const routeRows: ReportCell[][] = [
  [
    1,
    "AIS101",
    "RUH",
    "JED",
    "2030-01-02T10:00:00.000Z",
    "2030-01-02T12:00:00.000Z",
  ],
];
const missingColumns = [
  "flightId",
  "bookingId",
  "expectedPassengers",
  "passengerCount",
  "ticketedPassengers",
  "unnamedPassengerQuantity",
  "missingCouponPassengers",
  "exceptionReason",
];
const missingRows: ReportCell[][] = [
  [1, 15, 1, 0, 0, 1, 0, "passenger_identity_incomplete"],
  [1, 16, 3, 1, 0, 2, 1, "no_current_local_coupon"],
];

/** Expected identities and quantities are derived from the synthetic fixture,
 * never captured from the report implementation or an approved external feed. */
export const availableReportCases: AvailableReportCase[] = [
  {
    id: 2,
    family: "operations",
    filters: flight,
    columns: documentColumns,
    rows: documentRows,
  },
  ...[3, 18, 20, 25, 53].map(id => ({
    id,
    family: "operations" as const,
    filters: flight,
    columns: peopleColumns,
    rows: peopleRows,
  })),
  ...[5, 19, 27, 54].map(id => ({
    id,
    family: "operations" as const,
    filters:
      id === 19
        ? flight
        : id === 5
          ? { ...flight, startDate: day.startDate }
          : day,
    columns: countColumns,
    rows: countRows,
    ...(id === 19 ? {} : { period: period() }),
  })),
  {
    id: 14,
    family: "operations",
    filters: { flightId: 2, startDate: "2030-01-03", endDate: "2030-01-03" },
    columns: countColumns,
    rows: [[2, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0]],
    period: period(2),
  },
  ...[15, 16, 44].map(id => ({
    id,
    family: "operations" as const,
    filters: id === 44 ? day : { ...flight, startDate: day.startDate },
    columns: availabilityColumns,
    rows: availabilityRows,
    period: period(1, 1, id === 16 ? 7 : 1),
  })),
  {
    id: 45,
    family: "operations",
    filters: day,
    columns: availabilityColumns,
    rows: [[1, 5, 2, 0, 0, 5, 2, 0, 0, 7, 7, 100]],
    period: period(),
    arrange:
      "UPDATE flights SET economyAvailable=0,businessAvailable=0 WHERE id=1",
    restore:
      "UPDATE flights SET economyAvailable=2,businessAvailable=1 WHERE id=1",
  },
  {
    id: 17,
    family: "operations",
    filters: flight,
    columns: [
      "flightId",
      "passengerId",
      "ticketNumber",
      "couponStatus",
      "baggagePieces",
      "baggageWeightKg",
    ],
    rows: [
      [1, 100, "1000000000100", "O", 1, 10.5],
      [1, 101, "1000000000101", "C", 1, 5],
    ],
  },
  {
    id: 22,
    family: "operations",
    filters: flight,
    columns: routeColumns,
    rows: routeRows,
  },
  {
    id: 26,
    family: "operations",
    filters: { ...day, origin: "RUH" },
    columns: routeColumns,
    rows: routeRows,
    period: period(),
  },
  {
    id: 23,
    family: "operations",
    filters: flight,
    columns: [
      "flightId",
      "rowKind",
      "bookingId",
      "passengerId",
      "lockId",
      "heldSeats",
    ],
    rows: [
      [1, "passenger", 10, 100, null, null],
      [1, "passenger", 10, 101, null, null],
      [1, "passenger", 16, 160, null, null],
      [1, "reservation_missing_passenger_identity", 15, null, null, 1],
      [1, "unallocated_inventory_lock", null, null, 50, 2],
      [1, "unallocated_inventory_lock", null, null, 53, 1],
      [1, "unallocated_inventory_lock", null, null, 55, 2],
      [1, "unallocated_legacy_hold", null, null, 61, 1],
    ],
  },
  {
    id: 48,
    family: "operations",
    filters: day,
    columns: ["flightId", "exceptionReason"],
    rows: [[1, "incomplete_or_mismatched_seat_inventory"]],
    period: period(),
  },
  ...[49, 73].map(id => ({
    id,
    family: "operations" as const,
    filters: day,
    columns: missingColumns,
    rows: missingRows,
    period: period(1, 2),
  })),
  {
    id: 57,
    family: "operations",
    filters: { ...day, origin: "RUH" },
    columns: ["flightId", "transmissionId", "pnlStatus"],
    rows: [
      [1, 1, "draft"],
      [1, 2, "acknowledged"],
    ],
    period: period(1, 2),
  },
  {
    id: 64,
    family: "operations",
    filters: { ...day, origin: "RUH" },
    columns: documentColumns,
    rows: documentRows,
    period: period(1, 2),
  },
  {
    id: 72,
    family: "operations",
    filters: { flightId: 2, startDate: "2030-01-03", endDate: "2030-01-03" },
    columns: ["flightId", "bookingId", "passengerId", "bookingCreatedAt"],
    rows: [[2, 11, 110, "2029-12-20T12:00:00.000Z"]],
    period: period(2),
  },
  {
    id: 84,
    family: "operations",
    filters: day,
    columns: [
      "flightId",
      "level",
      "cabinClass",
      "rbd",
      "capacity",
      "sold",
      "held",
      "effectiveAvailable",
      "waitlistedSeats",
    ],
    rows: [
      [1, "cabin", "economy", null, 5, 3, 5, 0, 2],
      [1, "cabin", "business", null, 2, 1, 2, 0, 0],
      [1, "rbd", "economy", "Y", 4, 2, 3, 0, null],
      [1, "rbd", "business", "J", 2, 1, 1, 0, null],
    ],
    period: period(1, 4),
  },
  {
    id: 92,
    family: "operations",
    filters: day,
    columns: ["flightId", "bookingId", "passengerId", "ticketNumber"],
    rows: [[1, 10, 100, "1000000000100"]],
    period: period(),
    arrange:
      "UPDATE dcs_flight_operations SET checkInState='closed' WHERE flightId=1",
    restore:
      "UPDATE dcs_flight_operations SET checkInState='open' WHERE flightId=1",
  },
  {
    id: 93,
    family: "operations",
    filters: day,
    columns: ["flightId", "couponId", "exceptionReason"],
    rows: [[1, 6, "cancelled_booking"]],
    period: period(),
  },
  {
    id: 6,
    family: "finance",
    filters: { ticketNumber: "0010000000001" },
    columns: ["couponId", "passengerId", "flightId", "couponNumber", "status"],
    rows: [
      [100, 1, 1, 1, "F"],
      [101, 1, 2, 2, "C"],
    ],
    foreignRows: [],
  },
  {
    id: 55,
    family: "finance",
    filters: { startDate: "2026-10-01", endDate: "2026-10-01" },
    columns: ["paymentId", "bookingId", "amountMinor", "currency", "status"],
    rows: [[1, 1, 12000, "SAR", "completed"]],
    foreignRows: [[2, 2, 99999, "SAR", "completed"]],
    period: {
      day: "2026-10-01",
      table: "payments",
      column: "createdAt",
      id: 1,
      rowKey: "paymentId",
      original: "2026-10-01 00:00:00",
      targetRows: 1,
    },
  },
  {
    id: 4,
    family: "commercial",
    filters: {},
    columns: ["fromCurrency", "toCurrency", "rate", "status"],
    sharedAcrossTenants: true,
    rows: [
      ["SAR", "EUR", "0.30000000", "future"],
      ["SAR", "USD", "0.25000000", "current"],
      ["SAR", "USD", "0.20000000", "expired"],
      ...["AED", "BHD", "EGP", "EUR", "GBP", "KWD", "OMR", "QAR"].map(code => [
        "SAR",
        code,
        null,
        "missing_current_rate",
      ]),
      ["SAR", "SAR", "1", "identity"],
      ["SAR", "YER", null, "missing_current_rate"],
    ],
  },
  {
    id: 29,
    family: "commercial",
    filters: { startDate: "2030-01-02", endDate: "2030-01-02" },
    columns: ["transactionId", "memberId", "type", "miles", "balanceAfter"],
    rows: [
      [1002, 1, "redeem", -600, 1400],
      [1005, 3, "earn", 900, 900],
      [1001, 1, "earn", 2000, 2000],
    ],
    foreignRows: [[1003, 2, "bonus", 9999, 9999]],
    period: {
      day: "2030-01-02",
      table: "miles_transactions",
      column: "createdAt",
      id: 1001,
      rowKey: "transactionId",
      original: "2030-01-02 00:00:00",
      targetRows: 1,
    },
  },
  {
    id: 30,
    family: "commercial",
    filters: { startDate: "2030-01-02", endDate: "2030-01-02" },
    columns: [
      "membershipId",
      "memberId",
      "tier",
      "currentMilesBalance",
      "totalMilesEarned",
    ],
    rows: [
      [30, 3, "silver", 700, 900],
      [10, 1, "gold", 1400, 2000],
    ],
    foreignRows: [[20, 2, "bronze", 9999, 9999]],
    period: {
      day: "2030-01-02",
      table: "loyalty_accounts",
      column: "memberSince",
      id: 10,
      rowKey: "membershipId",
      original: "2030-01-02 00:00:00",
      targetRows: 1,
    },
  },
  {
    id: 31,
    family: "commercial",
    filters: { startDate: "2030-01-02", endDate: "2030-01-02", memberId: 1 },
    columns: ["transactionId", "memberId", "type", "miles", "balanceAfter"],
    rows: [
      [1002, 1, "redeem", -600, 1400],
      [1001, 1, "earn", 2000, 2000],
    ],
    foreignRows: [],
    period: {
      day: "2030-01-02",
      table: "miles_transactions",
      column: "createdAt",
      id: 1001,
      rowKey: "transactionId",
      original: "2030-01-02 00:00:00",
      targetRows: 1,
    },
  },
  {
    id: 42,
    family: "commercial",
    filters: {},
    columns: ["bookingId", "bookingReference", "status", "totalAmountMinor"],
    rows: [[60, "C00060", "cancelled", 6000]],
    foreignRows: [[2, "REF002", "confirmed", 99999]],
  },
  {
    id: 58,
    family: "commercial",
    filters: {},
    columns: ["bookingId", "bookingReference", "status", "totalAmountMinor"],
    rows: Array.from({ length: 50 }, (_, index) => {
      const id = 60 - index;
      return [
        id,
        `C${String(id).padStart(5, "0")}`,
        id === 60 ? "cancelled" : id === 55 ? "pending" : "confirmed",
        id * 100,
      ];
    }),
    foreignRows: [[2, "REF002", "confirmed", 99999]],
  },
];

export const commercialAvailableTables: MySqlTable[] = [
  users,
  loyaltyAccounts,
  milesTransactions,
  currencies,
  exchangeRates,
];

/** Additional rows share the finance fixture's owner/foreign booking identities. */
export async function seedCommercialAvailableRows(insert: FixtureInsert) {
  for (const [id, tenantId, name] of [
    [1, 101, "Member One"],
    [2, 202, "Foreign Member"],
    [3, 101, "Member Two"],
  ] as const)
    await insert(users, {
      id,
      tenantId,
      name,
      openId: `cap-member-${id}`,
      role: "user",
    });
  for (const [id, userId, tier, balance, earned, since] of [
    [10, 1, "gold", 1400, 2000, "2030-01-02 00:00:00"],
    [20, 2, "bronze", 9999, 9999, "2030-01-02 12:00:00"],
    [30, 3, "silver", 700, 900, "2030-01-02 23:59:59"],
  ] as const)
    await insert(loyaltyAccounts, {
      id,
      userId,
      tier,
      currentMilesBalance: balance,
      totalMilesEarned: earned,
      memberSince: since,
      lastActivityAt: "2030-01-02 23:59:59",
    });
  for (const [id, userId, account, type, amount, balance, at] of [
    [1001, 1, 10, "earn", 2000, 2000, "2030-01-02 00:00:00"],
    [1002, 1, 10, "redeem", -600, 1400, "2030-01-02 23:59:59"],
    [1003, 2, 20, "bonus", 9999, 9999, "2030-01-02 12:00:00"],
    [1004, 1, 10, "bonus", 5, 1405, "2030-01-03 00:00:00"],
    [1005, 3, 30, "earn", 900, 900, "2030-01-02 12:00:00"],
    [1006, 1, 20, "bonus", 999, 999, "2030-01-02 12:00:00"],
  ] as const)
    await insert(milesTransactions, {
      id,
      userId,
      loyaltyAccountId: account,
      type,
      amount,
      balanceAfter: balance,
      createdAt: at,
      description: "Synthetic CAP fixture",
    });
  await insert(currencies, {
    id: 1,
    code: "USD",
    name: "Recorded USD",
    symbol: "$",
    isActive: 1,
    isBaseCurrency: 0,
  });
  await insert(currencies, {
    id: 2,
    code: "SAR",
    name: "Recorded SAR",
    symbol: "SAR",
    isActive: 1,
    isBaseCurrency: 1,
  });
  for (const [id, to, rate, from, until] of [
    [1, "USD", "0.25000000", "2020-01-01 00:00:00", "2037-01-01 00:00:00"],
    [2, "USD", "0.20000000", "2010-01-01 00:00:00", "2019-01-01 00:00:00"],
    [3, "EUR", "0.30000000", "2035-01-01 00:00:00", "2037-01-01 00:00:00"],
  ] as const)
    await insert(exchangeRates, {
      id,
      fromCurrency: "SAR",
      toCurrency: to,
      rate,
      validFrom: from,
      validTo: until,
      source: "synthetic-manual",
    });
  for (let id = 10; id <= 60; id++)
    await insert(bookings, {
      id,
      tenantId: 101,
      userId: 1,
      flightId: 1,
      bookingReference: `C${String(id).padStart(5, "0")}`,
      pnr: `C${String(id).padStart(5, "0")}`,
      status: id === 60 ? "cancelled" : id === 55 ? "pending" : "confirmed",
      totalAmount: id * 100,
      createdAt: "2030-01-02 10:00:00",
      deletedAt: null,
    });
  await insert(bookings, {
    id: 61,
    tenantId: 101,
    userId: 1,
    flightId: 1,
    bookingReference: "DELETE",
    pnr: "DELETE",
    status: "confirmed",
    totalAmount: 999999,
    createdAt: "2031-01-01 00:00:00",
    deletedAt: "2031-01-01 01:00:00",
  });
}
