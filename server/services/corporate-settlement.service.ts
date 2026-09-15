import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  corporateAccounts,
  corporateBookings,
  corporateUsers,
  financialLedger,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";

export async function assertCorporatePaymentApproved(
  tx: SettlementTx,
  bookingId: number,
  requireCorporateFunding = false
) {
  const [link] = await tx
    .select()
    .from(corporateBookings)
    .where(eq(corporateBookings.bookingId, bookingId))
    .for("update");
  if (!link || (link.approvalStatus === "rejected" && !requireCorporateFunding))
    return;
  if (link.approvalStatus !== "approved")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Company approval is required before payment",
    });
  const [account] = await tx
    .select()
    .from(corporateAccounts)
    .where(eq(corporateAccounts.id, link.corporateAccountId))
    .for("update");
  if (account?.status !== "active")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Corporate account is not active",
    });
}

/** Full-invoice corporate credit is a local tender. Booking, company exposure,
 * inventory and ledger share one commit; rollback releases the entire exposure. */
export async function payCorporateInvoice(bookingId: number, actorId: number) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return await db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
    const [link] = await tx
      .select()
      .from(corporateBookings)
      .where(eq(corporateBookings.bookingId, bookingId))
      .for("update");
    if (!link) throw new TRPCError({ code: "NOT_FOUND" });
    const [account] = await tx
      .select()
      .from(corporateAccounts)
      .where(eq(corporateAccounts.id, link.corporateAccountId))
      .for("update");
    const [member] = await tx
      .select()
      .from(corporateUsers)
      .where(
        and(
          eq(corporateUsers.corporateAccountId, link.corporateAccountId),
          eq(corporateUsers.userId, actorId),
          eq(corporateUsers.isActive, true)
        )
      )
      .for("update");
    if (!member || (booking.userId !== actorId && member.role !== "admin"))
      throw new TRPCError({ code: "FORBIDDEN" });
    const reference = `corporate-credit:${bookingId}`;
    const [receipt] = await tx
      .select()
      .from(financialLedger)
      .where(eq(financialLedger.stripeEventId, reference));
    if (receipt) return { settled: true as const, receiptId: receipt.id };
    await assertCorporatePaymentApproved(tx, bookingId, true);
    if (
      !account ||
      !Number.isSafeInteger(account.creditLimit) ||
      account.creditLimit <= 0
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Corporate credit is not enabled",
      });
    const { lockEditableInvoice } = await import("./booking-invoice.service");
    const invoice = await lockEditableInvoice(tx, bookingId, {
      userId: actorId,
      admin: member.role === "admin",
    });
    const [debit] = await tx
      .update(corporateAccounts)
      .set({
        balance: sql`${corporateAccounts.balance} - ${invoice.totalAmount}`,
      })
      .where(
        and(
          eq(corporateAccounts.id, account.id),
          sql`${corporateAccounts.balance} - ${invoice.totalAmount} >= -${corporateAccounts.creditLimit}`
        )
      );
    if (debit.affectedRows !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Corporate credit limit exceeded",
      });
    const { confirmFundedBooking } =
      await import("./booking-settlement.service");
    await confirmFundedBooking(tx, invoice);
    const [posted] = await tx.insert(financialLedger).values({
      bookingId,
      userId: booking.userId,
      type: "charge",
      currency: "SAR",
      amount: (invoice.totalAmount / 100).toFixed(2),
      stripeEventId: reference,
      description: "Corporate credit invoice settlement",
      metadata: JSON.stringify({
        tender: "corporate_credit",
        corporateAccountId: account.id,
        actorId,
      }),
    });
    return { settled: true as const, receiptId: posted.insertId };
  });
}
