import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, expect, it, vi } from "vitest";
import {
  bookings,
  bookingRefundPlans,
  bookingRefundItems,
  ordinaryBookingRefunds,
  paymentReceipts,
  financialLedger,
} from "../../drizzle/schema";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { getRefundStats } from "../services/refunds-stats.service";
let database: DatabaseSync;
afterEach(() => database?.close());
it("counts ordinary and split requests separately from posted refunds", async () => {
  database = new DatabaseSync(":memory:");
  database.function("JSON_UNQUOTE", value => value);
  for (const table of [
    bookings,
    bookingRefundPlans,
    bookingRefundItems,
    ordinaryBookingRefunds,
    paymentReceipts,
    financialLedger,
  ]) {
    database.exec(
      `CREATE TABLE \`${getTableName(table)}\` (${Object.values(
        getTableColumns(table)
      )
        .map(
          column =>
            `\`${column.name}\` ${column.dataType === "number" ? "INTEGER" : "TEXT"}`
        )
        .join(",")})`
    );
  }
  const db = drizzle(async (sql, params) => {
    const statement = database.prepare(sql);
    statement.setReturnArrays(true);
    return { rows: statement.all(...params) };
  });
  state.db = Object.assign(db, {
    transaction: async (run: (tx: typeof db) => unknown) => run(db),
  });
  // Actual generated SQL over rows; this does not simulate MySQL isolation.
  database.exec(`
    INSERT INTO bookings (id) VALUES (1),(2),(3),(4),(5);
    INSERT INTO payment_receipts (paymentIntentId,kind,currency) VALUES ('pi_1','booking','SAR'),('pi_2','booking','SAR'),('pi_3','booking','SAR'),('pi_4','booking','SAR'),('pi_wrong','booking','USD');
    INSERT INTO ordinary_booking_refunds (bookingId,paymentIntentId,status,providerStatus,amount) VALUES
      (1,'pi_1','pending','pending',8000),
      (2,'pi_2','pending','requires_action',2000),
      (3,'pi_3','review_required',NULL,3000),
      (4,'pi_4','succeeded','succeeded',4000),
      (5,'pi_wrong','pending','pending',999);
    INSERT INTO booking_refund_items (status,refundAmount) VALUES ('pending',500),('failed',700);
    INSERT INTO financial_ledger (bookingId,type,amount,currency) VALUES (4,'partial_refund',40,'SAR');
  `);
  expect(await getRefundStats()).toMatchObject({
    pendingRefunds: 3,
    pendingRefundAmount: 10500,
    reviewRequiredRefunds: 2,
    reviewRequiredAmount: 3700,
    completedRefunds: 1,
    totalRefundedAmount: 4000,
  });
  database.exec(
    "UPDATE ordinary_booking_refunds SET status='succeeded' WHERE bookingId=1; INSERT INTO financial_ledger (bookingId,type,amount,currency) VALUES (1,'partial_refund',80,'SAR');"
  );
  expect(await getRefundStats()).toMatchObject({
    pendingRefunds: 2,
    pendingRefundAmount: 2500,
    completedRefunds: 2,
    totalRefundedAmount: 12000,
  });
});
