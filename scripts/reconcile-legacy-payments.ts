/** Read-only by default. --write-receipts imports provider-verified legacy collection baselines. */
import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "../server/db";
import { stripe } from "../server/stripe";
import { bookings, paymentReceipts } from "../drizzle/schema";

const db = getDb();
if (!db) throw new Error("Database unavailable");
const write = process.argv.includes("--write-receipts");
const candidates = await db
  .select()
  .from(bookings)
  .where(isNotNull(bookings.stripePaymentIntentId));
const report = [];
for (const booking of candidates) {
  const id = booking.stripePaymentIntentId!;
  const payment = await stripe.paymentIntents.retrieve(id, {
    expand: ["latest_charge"],
  });
  const charge =
    typeof payment.latest_charge === "object" ? payment.latest_charge : null;
  const verified =
    payment.status === "succeeded" &&
    payment.currency === "sar" &&
    payment.amount_received > 0 &&
    payment.amount_received === booking.totalAmount &&
    charge &&
    charge.paid;
  if (!verified) {
    report.push({
      bookingId: booking.id,
      action: "manual_review",
      reason: "Provider amount/status or booking total differs",
    });
    continue;
  }
  const refundBaseline = charge.amount_refunded;
  if (write)
    await db.transaction(async tx => {
      await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, booking.id))
        .for("update");
      const [existing] = await tx
        .select()
        .from(paymentReceipts)
        .where(eq(paymentReceipts.paymentIntentId, id))
        .limit(1);
      if (!existing)
        await tx.insert(paymentReceipts).values({
          paymentIntentId: id,
          kind: "booking",
          bookingId: booking.id,
          targetId: booking.id,
          userId: booking.userId,
          amount: payment.amount_received,
          currency: "SAR",
          refundedAmount: refundBaseline,
        });
    });
  report.push({
    bookingId: booking.id,
    action: write ? "receipt_baselined" : "verified_candidate",
    amount: payment.amount_received,
    refundedAmount: refundBaseline,
    inventoryReviewRequired: true,
  });
}
console.info(
  JSON.stringify(
    {
      mode: write ? "write-receipts" : "read-only",
      note: "Does not alter ledger, booking inventory or legacy wallet balances. Reconcile those against provider and pre-upgrade snapshots separately.",
      report,
    },
    null,
    2
  )
);
process.exit(0);
