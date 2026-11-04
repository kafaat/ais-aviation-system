import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import {
  agentBookings,
  airports,
  ancillaryServices,
  aviationEvidence,
  bookingAncillaries,
  bookingFareComponents,
  financialLedger,
  flights,
  outbox,
  passengers,
  payments,
  ticketCoupons,
  travelAgents,
} from "../../drizzle/schema";
import {
  baseFinanceRows,
  component,
  coupon,
  financeFixtureTables,
  financeScope,
  fixtureInsert,
  fixtureTableDdl,
  october,
  payment,
  uplift,
  voidEvent,
  type FixtureValues,
} from "./helpers/standard-finance-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  financeReportDefinitions,
  getFinanceStandardReport,
} from "../services/standard-reports-finance.service";

let database: DatabaseSync;
function insert(table: MySqlTable, values: FixtureValues) {
  const entry = fixtureInsert(table, values);
  database.prepare(entry.sql).run(...entry.params);
}
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const table of financeFixtureTables)
    database.exec(fixtureTableDdl(table, false));
  for (const [table, values] of baseFinanceRows) insert(table, values);
  const queryDb = drizzle(async (query, params) => {
    const statement = database.prepare(query);
    statement.setReturnArrays(true);
    return { rows: statement.all(...params) };
  });
  state.db = {
    async transaction<T>(read: (tx: typeof queryDb) => Promise<T>) {
      database.exec("BEGIN");
      try {
        const result = await read(queryDb);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
});
afterEach(() => {
  state.db = null;
  database.close();
});

describe("standard finance reports over actual relational SQL", () => {
  it("retains 37 unique finance catalogue definitions and blocks unsupported authorities", async () => {
    expect(financeReportDefinitions).toHaveLength(37);
    expect(
      new Set(financeReportDefinitions.map(report => report.id)).size
    ).toBe(37);
    for (const id of [7, 10, 38, 39, 40, 66, 87, 88, 98, 99]) {
      await expect(
        getFinanceStandardReport(id, {}, financeScope)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    expect(await getFinanceStandardReport(3, {}, financeScope)).toBeUndefined();
  });

  it("includes full UTC end days, stable payment ordering and only the owning airline's payments", async () => {
    insert(payments, payment(3, { tenantId: 202, bookingId: 1 }));
    insert(payments, payment(4, { tenantId: null }));
    insert(payments, payment(5, { createdAt: "2026-10-01 23:59:59.999" }));
    insert(payments, payment(6, { createdAt: "2026-10-02 00:00:00" }));
    insert(payments, payment(7, { bookingId: 999 }));
    const report = await getFinanceStandardReport(
      55,
      { startDate: "2026-10-01", endDate: "2026-10-01" },
      financeScope
    );
    expect(report?.rows.map(row => row.paymentId)).toEqual([1, 4, 5]);
    expect(report?.rows.map(row => row.amountMinor)).toEqual([
      12000, 12000, 12000,
    ]);
    expect(
      report?.rows.every(row => !Object.hasOwn(row, "providerMetadata"))
    ).toBe(true);
    const global = await getFinanceStandardReport(55, october, {
      userId: 9001,
    });
    expect(global?.rows.map(row => row.paymentId)).toEqual([1, 2, 4, 5, 6]);
  });

  it("returns every coupon of a specified ticket across its actual sectors and excludes foreign ownership", async () => {
    insert(ticketCoupons, coupon(201, { passengerId: 3, couponNumber: 3 }));
    insert(ticketCoupons, coupon(202, { flightId: 3, couponNumber: 4 }));
    insert(passengers, {
      id: 4,
      tenantId: 202,
      bookingId: 1,
      firstName: "Foreign",
      lastName: "Wrong tenant",
    });
    insert(ticketCoupons, coupon(203, { passengerId: 4, couponNumber: 5 }));
    const report = await getFinanceStandardReport(
      6,
      { ticketNumber: "0010000000001" },
      financeScope
    );
    expect(
      report?.rows.map(row => [row.couponId, row.flightId, row.status])
    ).toEqual([
      [100, 1, "F"],
      [101, 2, "C"],
    ]);
    expect(
      report?.rows.every(
        row =>
          row.externalIssueReceipt === null &&
          row.issuer === "AIS local document"
      )
    ).toBe(true);
    const foreign = await getFinanceStandardReport(
      6,
      { ticketNumber: "0020000000001" },
      financeScope
    );
    expect(foreign?.rows).toEqual([]);
  });

  it("exports each monetary source line once and leaves booking-level discounts unallocated", async () => {
    insert(
      bookingFareComponents,
      component(5, {
        passengerId: null,
        componentType: "discount",
        code: "MULTICITY_DISCOUNT",
        amount: -500,
      })
    );
    const report = await getFinanceStandardReport(
      9,
      { bookingReference: "pnr001" },
      financeScope
    );
    const monetary = report!.rows.filter(row => row.componentId !== null);
    expect(monetary.map(row => row.componentId)).toEqual([1, 2, 3, 4, 5]);
    expect(
      monetary.reduce((sum, row) => sum + Number(row.amountMinor), 0)
    ).toBe(24500);
    expect(monetary.find(row => row.componentId === 5)).toMatchObject({
      ticketNumber: null,
      couponNumber: null,
      amountMinor: -500,
      mapping: "booking_level_unallocated",
    });
    expect(monetary.find(row => row.componentId === 2)).toMatchObject({
      code: "OFFER_TAX_ESTIMATE",
      source: "retail_offer",
      amountMinor: 1000,
    });
  });

  it("shows a legacy document number as unverified without inventing coupon dates or sectors", async () => {
    insert(passengers, {
      id: 5,
      tenantId: 101,
      bookingId: 1,
      firstName: "Legacy",
      lastName: "Synthetic",
      ticketNumber: "0010000000088",
    });
    const report = await getFinanceStandardReport(
      6,
      { ticketNumber: "0010000000088" },
      financeScope
    );
    expect(report!.rows).toHaveLength(1);
    expect(report!.rows[0]).toMatchObject({
      ticketNumber: "0010000000088",
      status: "unverified",
      couponId: null,
      couponNumber: null,
      flightId: null,
      couponCreatedAt: null,
      issuer: "AIS legacy local document",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS n FROM ticket_coupons").get()
    ).toMatchObject({ n: 4 });
  });

  it("does not assign an old/new ambiguous document pair's fare to a single-ticket lookup", async () => {
    insert(
      ticketCoupons,
      coupon(110, { ticketNumber: "0010000000099", status: "E" })
    );
    const report = await getFinanceStandardReport(
      90,
      { ticketNumber: "0010000000001", couponNumber: 1 },
      financeScope
    );
    expect(
      report!.rows
        .filter(row => row.componentId !== null)
        .every(
          row =>
            row.mapping === "ambiguous_documents" && row.ticketNumber === null
        )
    ).toBe(true);
    expect(report!.rows.find(row => row.couponId === 100)).toMatchObject({
      componentId: null,
      amountMinor: null,
      mapping: "no_unique_component_mapping",
    });
  });

  it("requires a unique scoped uplift receipt rather than completed flights or F flags alone", async () => {
    database.exec("UPDATE ticket_coupons SET status='F' WHERE id IN (101,102)");
    insert(
      aviationEvidence,
      uplift(2, {
        tenantId: 202,
        payload: JSON.stringify({
          couponId: 102,
          bookingId: 1,
          passengerId: 2,
        }),
      })
    );
    insert(
      aviationEvidence,
      uplift(3, {
        payload: JSON.stringify({
          couponId: 102,
          bookingId: 1,
          passengerId: 1,
        }),
      })
    );
    const report = await getFinanceStandardReport(
      43,
      { startDate: "2026-10-10", endDate: "2026-10-10" },
      financeScope
    );
    expect(report!.rows.map(row => row.couponId)).toEqual([100]);
    expect(report!.rows[0]).toMatchObject({
      upliftEvidenceId: 1,
      upliftSourceId: "synthetic-operator",
    });
    const used = await getFinanceStandardReport(95, {}, financeScope);
    expect(used!.rows.map(row => row.couponId)).toEqual([100]);
    insert(aviationEvidence, uplift(4));
    expect(
      (await getFinanceStandardReport(95, {}, financeScope))!.rows
    ).toEqual([]);
  });

  it("uses immutable void-event time even when the coupon is later refunded", async () => {
    database.exec(
      "UPDATE ticket_coupons SET status='R', updatedAt='2026-10-09 10:00:00' WHERE id=100"
    );
    insert(outbox, voidEvent(1));
    insert(outbox, voidEvent(2, { tenantId: 202 }));
    insert(outbox, voidEvent(3, { createdAt: "2026-10-08 00:00:00" }));
    const report = await getFinanceStandardReport(
      96,
      { startDate: "2026-10-07", endDate: "2026-10-07" },
      financeScope
    );
    expect(report!.rows).toHaveLength(1);
    expect(report!.rows[0]).toMatchObject({
      couponId: 100,
      status: "R",
      voidStatus: "V",
      previousStatus: "O",
      voidEventId: "synthetic-void-1",
      voidedAt: "2026-10-07T23:59:59.000Z",
    });
  });

  it("keeps real refund postings, cash/non-cash classification and currencies distinct", async () => {
    insert(financialLedger, {
      id: 1005,
      bookingId: 1,
      type: "refund",
      amount: "1.23",
      currency: "USD",
      metadata: "{}",
      transactionDate: "2026-10-10 23:59:59",
      createdAt: "2026-10-10 23:59:59",
    });
    const report = await getFinanceStandardReport(
      68,
      { startDate: "2026-10-09", endDate: "2026-10-10" },
      financeScope
    );
    expect(
      report!.rows.map(row => [
        row.ledgerId,
        row.amountMinor,
        row.signedSettlementMinor,
        row.currency,
        row.fundingClass,
      ])
    ).toEqual([
      [1002, 2345, -2345, "SAR", "cash"],
      [1003, 1000, -1000, "SAR", "non_cash"],
      [1005, 123, -123, "USD", "cash"],
    ]);
    expect(report!.rows.every(row => row.officeId === null)).toBe(true);
  });

  it("separates booking, document and uplift event days without copying booking totals", async () => {
    const report = await getFinanceStandardReport(76, october, financeScope);
    expect(
      report!.rows.map(row => [
        row.period,
        row.basis,
        row.amountMinor,
        row.currency,
      ])
    ).toEqual([
      ["2026-10-01", "booked", 25000, "SAR"],
      ["2026-10-05", "local_document", 25000, "SAR"],
      ["2026-10-10", "recorded_uplift", 11000, "SAR"],
    ]);
    expect(report!.rows.every(row => row.recognizedRevenueMinor === null)).toBe(
      true
    );
    const flight = await getFinanceStandardReport(
      78,
      { ...october, flightId: 2 },
      financeScope
    );
    expect(flight!.rows.map(row => row.amountMinor)).toEqual([6000, 6000]);
    const justUplift = await getFinanceStandardReport(
      81,
      { startDate: "2026-10-10", endDate: "2026-10-10" },
      financeScope
    );
    expect(justUplift!.rows).toHaveLength(1);
    expect(justUplift!.rows[0]).toMatchObject({
      origin: "JED",
      destination: "RUH",
      amountMinor: 11000,
    });
  });

  it("marks coupon totals unknown when a sector discount has no passenger allocation", async () => {
    insert(
      bookingFareComponents,
      component(5, {
        passengerId: null,
        componentType: "discount",
        amount: -500,
      })
    );
    const report = await getFinanceStandardReport(76, october, financeScope);
    expect(report!.rows.find(row => row.basis === "booked")).toMatchObject({
      amountMinor: 24500,
    });
    expect(
      report!.rows.find(row => row.basis === "local_document")
    ).toMatchObject({ amountMinor: null, unresolvedLines: 2 });
    expect(
      report!.rows.find(row => row.basis === "recorded_uplift")
    ).toMatchObject({ amountMinor: null, unresolvedLines: 1 });
  });

  it("uses Monday UTC weeks while retaining separate event bases and currencies", async () => {
    insert(
      bookingFareComponents,
      component(5, {
        componentType: "booking_fee",
        code: "FEE",
        amount: 200,
        currency: "USD",
      })
    );
    const report = await getFinanceStandardReport(75, october, financeScope);
    expect(
      report!.rows.map(row => [
        row.period,
        row.basis,
        row.currency,
        row.amountMinor,
      ])
    ).toEqual([
      ["2026-09-28", "booked", "SAR", 25000],
      ["2026-09-28", "booked", "USD", 200],
      ["2026-10-05", "local_document", "SAR", 25000],
      ["2026-10-05", "local_document", "USD", 200],
      ["2026-10-05", "recorded_uplift", "SAR", 11000],
      ["2026-10-05", "recorded_uplift", "USD", 200],
    ]);
  });

  it("shows baggage funding provenance and lifecycle without pretending every baggage product is excess weight", async () => {
    insert(ancillaryServices, {
      id: 1,
      code: "BAG_20KG",
      name: "Synthetic baggage",
      category: "baggage",
    });
    const line = {
      bookingId: 1,
      passengerId: 1,
      segmentId: 11,
      scopeState: "specific_segment",
      ancillaryServiceId: 1,
      quantity: 1,
      unitPrice: 1500,
      totalPrice: 1500,
      status: "refunded",
      fundedAt: "2026-10-10 23:59:59",
      fundingReference: JSON.stringify({
        kind: "internal_booking",
        bookingId: 1,
        ledgerId: 1001,
        tender: "wallet",
        amountMinor: 1500,
      }),
    };
    insert(bookingAncillaries, { id: 1, ...line });
    insert(bookingAncillaries, {
      id: 2,
      ...line,
      fundedAt: "2026-10-11 00:00:00",
    });
    const report = await getFinanceStandardReport(
      71,
      { startDate: "2026-10-10", endDate: "2026-10-10", status: "refunded" },
      financeScope
    );
    expect(report!.rows).toHaveLength(1);
    expect(report!.rows[0]).toMatchObject({
      itemId: 1,
      totalPriceMinor: 1500,
      status: "refunded",
      fundingKind: "internal_booking",
      fundingReference: "ledger:1001",
      excessClassification: null,
      officeId: null,
    });
  });

  it("keeps agencies distinct from offices and returns more than twenty route groups", async () => {
    insert(travelAgents, { id: 1, agencyName: "Synthetic Agency" });
    insert(agentBookings, { id: 1, bookingId: 1, agentId: 1 });
    const sales = await getFinanceStandardReport(85, october, financeScope);
    expect(sales!.rows[0]).toMatchObject({
      agencyId: 1,
      agencyName: "Synthetic Agency",
      officeId: null,
    });
    for (let id = 10; id < 35; id++) {
      insert(airports, { id, code: `X${id}`, city: `Synthetic city ${id}` });
      insert(flights, {
        id,
        tenantId: 101,
        flightNumber: `SYN${id}`,
        originId: 1,
        destinationId: id,
        departureTime: "2026-10-10 10:00:00",
      });
      insert(
        bookingFareComponents,
        component(id + 100, { flightId: id, passengerId: null, amount: 100 })
      );
    }
    const routes = await getFinanceStandardReport(77, october, financeScope);
    expect(routes!.rows.filter(row => row.basis === "booked")).toHaveLength(27);
  });

  it("rejects inapplicable filters and absent lookup/period criteria", async () => {
    await expect(
      getFinanceStandardReport(6, {}, financeScope)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getFinanceStandardReport(9, {}, financeScope)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getFinanceStandardReport(
        90,
        { ticketNumber: "0010000000001" },
        financeScope
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getFinanceStandardReport(55, { startDate: "2026-10-01" }, financeScope)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getFinanceStandardReport(28, { ...october, officeId: 1 }, financeScope)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      getFinanceStandardReport(
        55,
        { ...october, status: "bogus" },
        financeScope
      )
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fails explicitly when the real payment query would exceed the row budget", async () => {
    database.exec("BEGIN");
    for (let id = 10; id < 10010; id++) insert(payments, payment(id));
    database.exec("COMMIT");
    await expect(
      getFinanceStandardReport(55, october, financeScope)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("no rows were silently omitted"),
    });
  });
});
