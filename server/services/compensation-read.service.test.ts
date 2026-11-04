import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQLInputValue } from "node:sqlite";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { bookings, compensationClaims, flights } from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  calculateTotalLiability,
  getAllClaims,
  getClaimById,
  getClaimsByBooking,
  getClaimsByFlight,
  getClaimsByUser,
  getCompensationStats,
} from "./compensation.service";

describe("compensation read authority over stored claim rows", () => {
  let fixture: ReturnType<typeof authorityRelationalFixture>;

  beforeEach(() => {
    fixture = authorityRelationalFixture([
      bookings,
      compensationClaims,
      flights,
    ]);
    state.db = fixture.db;
    // The shared fixture models Drizzle's typed-row protocol. These legacy
    // reports use mysql2's raw [rows, fields] protocol instead: execute their
    // production parameterized SQL, returning its real result rows unchanged.
    const dialect = new MySqlDialect();
    Object.defineProperty(fixture.db, "execute", {
      value: async (query: SQL) => {
        const compiled = dialect.sqlToQuery(query);
        const params = compiled.params.map(value =>
          value instanceof Date
            ? value.toISOString().replace("T", " ").replace(/Z$/, "")
            : value
        ) as SQLInputValue[];
        return [fixture.sqlite.prepare(compiled.sql).all(...params), []];
      },
    });
    // UTC calendar-day difference only; no claim of MySQL dialect parity.
    fixture.sqlite.function("DATEDIFF", (end, start) => {
      if (typeof end !== "string" || typeof start !== "string") return null;
      return (
        (Date.parse(end.slice(0, 10)) - Date.parse(start.slice(0, 10))) /
        86_400_000
      );
    });
    fixture.insert(bookings, {
      id: 1,
      userId: 7,
      flightId: 11,
      status: "cancelled",
      deletedAt: "2030-01-01 00:00:00",
    });
    fixture.insert(bookings, { id: 2, userId: 8, flightId: 22 });
    fixture.insert(bookings, { id: 3, userId: 7, flightId: 11 });
    fixture.insert(flights, { id: 11, flightNumber: "TEST11" });
    fixture.insert(flights, { id: 22, flightNumber: "TEST22" });
    fixture.insert(flights, { id: 33, flightNumber: "TEST33" });
    const common = {
      passengerId: 10,
      claimType: "delay",
      regulationType: "local",
      currency: "SAR",
      filedAt: "2030-01-01 00:00:00",
      updatedAt: "2030-01-07 00:00:00",
    };
    for (const row of [
      {
        id: 101,
        bookingId: 1,
        flightId: 11,
        status: "under_review",
        calculatedAmount: null,
        createdAt: "2030-01-01 00:00:00",
      },
      {
        id: 102,
        bookingId: 1,
        flightId: 11,
        status: "approved",
        calculatedAmount: 10000,
        approvedAmount: 8000,
        resolvedAt: "2030-01-04 00:00:00",
        createdAt: "2030-01-02 00:00:00",
      },
      {
        id: 103,
        bookingId: 3,
        flightId: 11,
        status: "paid",
        calculatedAmount: 6000,
        paidAt: "2030-01-06 00:00:00",
        resolvedAt: "2030-01-06 00:00:00",
        createdAt: "2030-01-03 00:00:00",
      },
      {
        id: 104,
        bookingId: 2,
        flightId: 22,
        regulationType: "dot",
        status: "denied",
        calculatedAmount: 3000,
        approvedAmount: 999,
        createdAt: "2030-01-04 00:00:00",
      },
      {
        id: 105,
        bookingId: 1,
        flightId: 11,
        regulationType: "eu261",
        status: "appealed",
        calculatedAmount: 0,
        createdAt: "2030-01-05 00:00:00",
      },
    ])
      fixture.insert(compensationClaims, { ...common, ...row });
  });

  afterEach(() => {
    state.db = null;
    fixture.close();
  });

  it("returns only an owner's claims across their bookings, including historical bookings", async () => {
    expect((await getClaimsByUser(7)).map(claim => claim.id)).toEqual([
      105, 103, 102, 101,
    ]);
    expect((await getClaimsByUser(8)).map(claim => claim.id)).toEqual([104]);
    expect(await getClaimsByUser(999)).toEqual([]);
    const zero = await getClaimById(105, 7);
    expect(zero.calculatedAmount).toBe(0);
    expect((await getClaimById(101, 7)).calculatedAmount).toBeNull();
    expect(zero).not.toHaveProperty("reviewEvidence");
  });

  it("checks detail ownership and does not leak a foreign, missing or orphaned booking claim", async () => {
    await expect(getClaimById(104, 7)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getClaimById(999, 7)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    fixture.sqlite.exec("DELETE FROM bookings WHERE id = 1");
    await expect(getClaimById(101, 7)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await getClaimById(101)).id).toBe(101);
  });

  it("scopes booking and flight listings with independent ownership checks", async () => {
    expect((await getClaimsByBooking(1, 7)).map(claim => claim.id)).toEqual([
      105, 102, 101,
    ]);
    await expect(getClaimsByBooking(1, 8)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getClaimsByBooking(999, 7)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await getClaimsByBooking(2)).map(claim => claim.id)).toEqual([104]);
    expect((await getClaimsByFlight(11)).map(claim => claim.id)).toEqual([
      105, 103, 102, 101,
    ]);
    expect(await getClaimsByFlight(999)).toEqual([]);
  });

  it("filters and paginates stored claims without treating filter text as SQL", async () => {
    const first = await getAllClaims({
      regulationType: "local",
      page: 1,
      limit: 2,
    });
    expect(first).toMatchObject({ total: 3, page: 1, totalPages: 2 });
    expect(first.claims.map(claim => claim.id)).toEqual([103, 102]);
    expect(
      (
        await getAllClaims({ regulationType: "local", page: 2, limit: 2 })
      ).claims.map(claim => claim.id)
    ).toEqual([101]);
    expect(
      (
        await getAllClaims({
          status: "paid",
          regulationType: "local",
          page: 1,
          limit: 20,
        })
      ).claims.map(claim => claim.id)
    ).toEqual([103]);
    expect((await getAllClaims({ page: 1, limit: 20 })).total).toBe(5);
    expect(
      await getAllClaims({ status: "approved' OR 1=1 --", page: 1, limit: 20 })
    ).toEqual({ claims: [], total: 0, page: 1, totalPages: 0 });
  });

  it("distinguishes assessed, unassessed, approved and paid flight liabilities", async () => {
    expect(await calculateTotalLiability(11)).toEqual({
      flightId: 11,
      flightNumber: "TEST11",
      totalClaims: 4,
      totalCalculated: 16000,
      unassessedClaims: 1,
      totalApproved: 14000,
      totalPaid: 6000,
      statusBreakdown: { under_review: 1, approved: 1, paid: 1, appealed: 1 },
    });
    expect(await calculateTotalLiability(33)).toMatchObject({
      totalClaims: 0,
      totalCalculated: 0,
      unassessedClaims: 0,
      totalApproved: 0,
      totalPaid: 0,
      statusBreakdown: {},
    });
    await expect(calculateTotalLiability(999)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("reports totals by claim state and binds inclusive review date boundaries", async () => {
    expect(await getCompensationStats()).toEqual({
      totalClaims: 5,
      pendingClaims: 1,
      approvedClaims: 1,
      deniedClaims: 1,
      paidClaims: 1,
      appealedClaims: 1,
      totalCalculated: 19000,
      unassessedClaims: 1,
      totalApproved: 14000,
      totalPaid: 6000,
      avgProcessingDays: 4,
    });
    expect(
      await getCompensationStats({
        from: new Date("2030-01-02T00:00:00Z"),
        to: new Date("2030-01-03T00:00:00Z"),
      })
    ).toMatchObject({
      totalClaims: 2,
      approvedClaims: 1,
      paidClaims: 1,
      pendingClaims: 0,
      unassessedClaims: 0,
      totalApproved: 14000,
    });
    expect(
      await getCompensationStats({
        from: new Date("2040-01-01T00:00:00Z"),
        to: new Date("2040-01-02T00:00:00Z"),
      })
    ).toMatchObject({
      totalClaims: 0,
      pendingClaims: 0,
      totalCalculated: 0,
      unassessedClaims: 0,
      totalApproved: 0,
      totalPaid: 0,
      avgProcessingDays: 0,
    });
  });

  it("reports database unavailability before exposing any claim data", async () => {
    state.db = null;
    for (const read of [
      () => getClaimsByUser(7),
      () => getClaimById(101, 7),
      () => getClaimsByBooking(1, 7),
      () => getClaimsByFlight(11),
      () => getAllClaims({ page: 1, limit: 20 }),
      () => calculateTotalLiability(11),
      () => getCompensationStats(),
    ])
      await expect(read()).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
  });
});
