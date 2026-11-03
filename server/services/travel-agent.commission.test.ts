import { beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
import { updateCommissionStatus } from "./travel-agent.service";

let fixture: ReturnType<typeof transactionMemory>;
vi.mock("../db", () => ({ getDb: () => fixture.db }));
beforeEach(() => {
  fixture = transactionMemory({
    agent_bookings: [
      {
        id: 4,
        bookingId: 7,
        bookingAmount: 10000,
        commissionAmount: 500,
        commissionStatus: "pending",
        commissionPaidAt: null,
      },
    ],
    bookings: [
      {
        id: 7,
        totalAmount: 10000,
        deletedAt: null,
        status: "confirmed",
        paymentStatus: "paid",
      },
    ],
    financial_ledger: [
      { bookingId: 7, type: "charge", amount: "100.00", currency: "SAR" },
    ],
  });
});
it("approves a funded invoice once without recording a payout", async () => {
  await updateCommissionStatus(4, "approved");
  await updateCommissionStatus(4, "approved");
  expect(fixture.rows("agent_bookings")[0]).toMatchObject({
    commissionStatus: "approved",
    commissionPaidAt: null,
  });
  await expect(updateCommissionStatus(4, "paid")).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(fixture.rows("financial_ledger")).toHaveLength(1);
});
it.each([
  "unfunded",
  "cancelled",
  "refund",
  "changed amount",
  "missing ledger",
  "offsetting charge",
  "foreign currency",
])("blocks approval of a %s invoice", async variant => {
  if (variant === "unfunded")
    fixture.rows("bookings")[0].paymentStatus = "pending";
  if (variant === "cancelled") fixture.rows("bookings")[0].status = "cancelled";
  if (variant === "changed amount") fixture.rows("bookings")[0].totalAmount++;
  if (variant === "missing ledger") fixture.rows("financial_ledger").splice(0);
  if (variant === "offsetting charge") {
    fixture.rows("financial_ledger")[0].amount = "101.00";
    fixture
      .rows("financial_ledger")
      .push({ bookingId: 7, type: "charge", currency: "SAR", amount: "-1.00" });
  }
  if (variant === "foreign currency")
    fixture.rows("financial_ledger")[0].currency = "USD";
  if (variant === "refund")
    fixture.rows("financial_ledger").push({
      bookingId: 7,
      type: "partial_refund",
      amount: "1.00",
      currency: "SAR",
    });
  await expect(updateCommissionStatus(4, "approved")).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(fixture.rows("agent_bookings")[0].commissionStatus).toBe("pending");
});
it("blocks direct payment, reopening cancelled commissions and nonexistent IDs", async () => {
  await expect(updateCommissionStatus(4, "paid")).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await updateCommissionStatus(4, "cancelled");
  for (const status of ["pending", "approved"] as const)
    await expect(updateCommissionStatus(4, status)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  await expect(updateCommissionStatus(999, "approved")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
