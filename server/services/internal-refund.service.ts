import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  bookings,
  users,
  financialLedger,
  userCredits,
  creditUsage,
  corporateAccounts,
  corporateBookings,
  paymentReceipts,
  bookingModifications,
  seatInventory,
  flights,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isAdmin } from "./rbac.service";
import { withTransactionalIdempotency } from "./idempotency-v2.service";
import {
  assertNoCollectionReview,
  cancelBookingResources,
} from "./booking-settlement.service";
import { assertNoOrderRefundPending } from "./order-refunds.service";
import { recordEvent } from "./outbox.service";
import { flightBookingCondition } from "./flight-state.service";

export const internalRefundInput = z.object({
  bookingId: z.number().int().positive(),
  amount: z.number().int().positive().max(2147483647),
  requestId: z.string().uuid(),
  approvalReference: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(3).max(500),
  cancelItinerary: z.boolean(),
});
export const internalRefundResult = z.object({
  ledgerId: z.number().int().positive(),
  amount: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  tender: z.enum(["user_credit", "corporate_credit"]),
  cancelled: z.boolean(),
  currency: z.literal("SAR"),
});
const metadata = z.object({
  tender: z.enum(["user_credit", "corporate_credit"]),
  corporateAccountId: z.number().int().positive().optional(),
  originalLedgerId: z.number().int().positive().optional(),
});
function minorUnits(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Invalid original financial amount");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("Invalid original financial amount");
  return result;
}
const blocked = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });

/** Finance approval returns value to the original internal funding account.
 * It never executes an external payout, rewrites an invoice, or extends a credit's expiry.
 * Partial refunds retain inventory; cancellation must be explicit and refund the remainder. */
export async function refundInternalFunding(
  raw: z.infer<typeof internalRefundInput>,
  actorId: number
) {
  const input = internalRefundInput.parse(raw);
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  // Re-authorize even an idempotent replay after a role/tenant change.
  const authorize = async () => {
    const [actor] = await db.select().from(users).where(eq(users.id, actorId));
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId));
    if (
      !actor ||
      !booking ||
      (!isAdmin(actor.role) &&
        (!["finance", "airline_admin"].includes(actor.role) ||
          actor.tenantId === null ||
          actor.tenantId !== booking.tenantId))
    )
      throw new TRPCError({ code: "FORBIDDEN" });
  };
  await authorize();
  return withTransactionalIdempotency({
    scope: "internal_funding.refund",
    key: input.requestId,
    userId: actorId,
    request: input,
    run: async tx => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .for("update");
      const [actor] = await tx
        .select()
        .from(users)
        .where(eq(users.id, actorId));
      if (
        !booking ||
        !actor ||
        (!isAdmin(actor.role) &&
          (!["finance", "airline_admin"].includes(actor.role) ||
            actor.tenantId === null ||
            actor.tenantId !== booking.tenantId))
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      if (
        booking.paymentStatus !== "paid" ||
        booking.status !== "confirmed" ||
        booking.checkedIn ||
        !booking.seatsReserved
      )
        throw blocked(
          "Only an unflown funded booking can receive an internal refund"
        );
      const itinerary = await tx
        .select({ flight: flights })
        .from(flights)
        .innerJoin(
          bookings,
          and(eq(bookings.id, booking.id), flightBookingCondition(flights.id))
        )
        .orderBy(asc(flights.id))
        .for("update");
      if (
        !itinerary.length ||
        itinerary.some(
          ({ flight }) =>
            flight.tenantId !== booking.tenantId ||
            flight.status === "completed" ||
            (flight.status !== "cancelled" &&
              flight.departureTime <= new Date())
        )
      )
        throw blocked(
          "Flown or inconsistent itinerary requires servicing review"
        );
      const [checkedIn] = await tx
        .select({ id: seatInventory.id })
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.bookingId, booking.id),
            isNotNull(seatInventory.checkedInAt)
          )
        )
        .limit(1);
      if (checkedIn)
        throw blocked("A checked-in segment requires servicing review");
      await assertNoCollectionReview(tx, booking.id);
      await assertNoOrderRefundPending(tx, booking.id);
      for (const [table, column] of [
        [paymentReceipts, paymentReceipts.bookingId],
        [bookingModifications, bookingModifications.bookingId],
      ] as const) {
        if (
          (await tx.select().from(table).where(eq(column, booking.id)).limit(1))
            .length
        )
          throw blocked("External or modified funding requires reconciliation");
      }
      const ledger = await tx
        .select()
        .from(financialLedger)
        .where(eq(financialLedger.bookingId, booking.id))
        .for("update");
      const charges = ledger.filter(e => e.type === "charge");
      if (
        charges.length !== 1 ||
        charges[0].currency !== "SAR" ||
        charges[0].userId !== booking.userId
      )
        throw blocked(
          "Exactly one original SAR internal funding receipt is required"
        );
      const original = charges[0];
      const origin = metadata.safeParse(JSON.parse(original.metadata ?? "{}"));
      if (
        !origin.success ||
        original.stripePaymentIntentId ||
        original.stripeEventId !==
          `${origin.data.tender === "user_credit" ? "internal-credit" : "corporate-credit"}:${booking.id}`
      )
        throw blocked("Original internal funding identity is unavailable");
      const originalAmount = minorUnits(original.amount);
      if (originalAmount !== booking.totalAmount)
        throw blocked("Original invoice requires reconciliation");
      let returned = 0;
      for (const entry of ledger.filter(e => e.type !== "charge")) {
        const refund = metadata.safeParse(JSON.parse(entry.metadata ?? "{}"));
        if (
          !["refund", "partial_refund"].includes(entry.type) ||
          entry.currency !== "SAR" ||
          !refund.success ||
          refund.data.originalLedgerId !== original.id ||
          refund.data.tender !== origin.data.tender
        )
          throw blocked("An unrelated financial entry requires reconciliation");
        returned += minorUnits(entry.amount);
      }
      const available = originalAmount - returned;
      if (input.amount > available || available <= 0)
        throw blocked("Refund exceeds remaining original funding");
      if ((input.amount === available) !== input.cancelItinerary)
        throw blocked(
          "Full remaining refund requires explicit itinerary cancellation; partial refunds retain the itinerary"
        );
      const restorations: Array<{ creditId: number; amount: number }> = [];
      if (origin.data.tender === "user_credit") {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, booking.userId))
          .for("update");
        const usages = await tx
          .select()
          .from(creditUsage)
          .where(
            and(
              eq(creditUsage.bookingId, booking.id),
              eq(creditUsage.userId, booking.userId)
            )
          )
          .orderBy(asc(creditUsage.userCreditId))
          .for("update");
        const balances = new Map<number, number>();
        for (const usage of usages)
          balances.set(
            usage.userCreditId,
            (balances.get(usage.userCreditId) ?? 0) + usage.amountUsed
          );
        if (
          [...balances.values()].some(n => n < 0) ||
          [...balances.values()].reduce((s, n) => s + n, 0) !== available
        )
          throw blocked("Credit usage and refund receipts disagree");
        let remaining = input.amount;
        for (const [creditId, amount] of balances) {
          const restore = Math.min(amount, remaining);
          if (!restore) continue;
          const [credit] = await tx
            .select()
            .from(userCredits)
            .where(
              and(
                eq(userCredits.id, creditId),
                eq(userCredits.userId, booking.userId)
              )
            )
            .for("update");
          if (!credit || credit.usedAmount < restore)
            throw blocked("Original credit lot requires reconciliation");
          const [updated] = await tx
            .update(userCredits)
            .set({ usedAmount: sql`${userCredits.usedAmount} - ${restore}` })
            .where(
              and(
                eq(userCredits.id, creditId),
                sql`${userCredits.usedAmount} >= ${restore}`
              )
            );
          if (updated.affectedRows !== 1)
            throw blocked("Credit restoration conflict");
          await tx.insert(creditUsage).values({
            userCreditId: creditId,
            userId: booking.userId,
            bookingId: booking.id,
            amountUsed: -restore,
          });
          restorations.push({ creditId, amount: restore });
          remaining -= restore;
        }
        if (remaining)
          throw blocked("Original credit allocation is incomplete");
      } else {
        const accountId = origin.data.corporateAccountId;
        if (!accountId) throw blocked("Original corporate account is missing");
        const [link] = await tx
          .select()
          .from(corporateBookings)
          .where(eq(corporateBookings.bookingId, booking.id))
          .for("update");
        if (link?.corporateAccountId !== accountId)
          throw blocked("Corporate funding ownership changed");
        const [account] = await tx
          .select()
          .from(corporateAccounts)
          .where(eq(corporateAccounts.id, accountId))
          .for("update");
        if (!account || account.balance + input.amount > 2147483647)
          throw blocked("Corporate balance requires reconciliation");
        await tx
          .update(corporateAccounts)
          .set({ balance: sql`${corporateAccounts.balance} + ${input.amount}` })
          .where(eq(corporateAccounts.id, accountId));
      }
      const [receipt] = await tx.insert(financialLedger).values({
        bookingId: booking.id,
        userId: booking.userId,
        type: input.cancelItinerary ? "refund" : "partial_refund",
        amount: (input.amount / 100).toFixed(2),
        currency: "SAR",
        stripeEventId: `internal-refund:${input.requestId}`,
        description: input.reason,
        metadata: JSON.stringify({
          ...origin.data,
          originalLedgerId: original.id,
          approvalReference: input.approvalReference,
          actorId,
          restorations,
          cancelItinerary: input.cancelItinerary,
          requestId: input.requestId,
        }),
      });
      if (input.cancelItinerary) {
        await tx
          .update(bookings)
          .set({ paymentStatus: "refunded" })
          .where(eq(bookings.id, booking.id));
        await cancelBookingResources(
          tx,
          { ...booking, paymentStatus: "refunded" },
          input.reason,
          actorId
        );
      }
      await recordEvent(tx, {
        aggregateType: "booking",
        aggregateId: booking.id,
        tenantId: booking.tenantId,
        eventType: "payment.internal_refunded",
        payload: {
          bookingId: booking.id,
          ledgerId: receipt.insertId,
          originalLedgerId: original.id,
          amount: input.amount,
          tender: origin.data.tender,
          actorId,
          approvalReference: input.approvalReference,
          cancelItinerary: input.cancelItinerary,
        },
      });
      return internalRefundResult.parse({
        ledgerId: receipt.insertId,
        amount: input.amount,
        remaining: available - input.amount,
        tender: origin.data.tender,
        cancelled: input.cancelItinerary,
        currency: "SAR",
      });
    },
  });
}
