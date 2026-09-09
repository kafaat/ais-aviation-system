import { and, eq, inArray, sql } from "drizzle-orm";
import {
  bookings,
  flights,
  bookingModifications,
  paymentSplits,
  paymentReceipts,
  financialLedger,
  wallets,
  walletTransactions,
  payments,
} from "../../drizzle/schema";
import {
  confirmFundedBooking,
  releaseBookingSeats,
  reserveSeats,
  restoreSeats,
  type SettlementTx,
} from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";

export interface VerifiedPayment {
  paymentIntentId: string;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  eventId: string;
}

export function assertCollectedAmount(
  actual: number,
  expected: number,
  currency: string
) {
  if (
    !Number.isSafeInteger(actual) ||
    actual <= 0 ||
    actual !== expected ||
    currency.toUpperCase() !== "SAR"
  )
    throw new Error(
      "Collected amount/currency does not match the persisted purchase"
    );
}

/** Only provider-verified events may call this inside their database transaction. */
export async function settleVerifiedPayment(
  tx: SettlementTx,
  payment: VerifiedPayment
) {
  const { metadata: meta, paymentIntentId, amount, currency } = payment;
  if (!paymentIntentId) throw new Error("Missing payment intent");
  const kind = meta.type || "booking";
  if (
    !["booking", "split_payment", "modification", "wallet_topup"].includes(kind)
  )
    throw new Error("Unsupported payment purpose");
  if (kind === "wallet_topup") {
    const [request] = await tx
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.id, Number(meta.topUpId)))
      .limit(1)
      .for("update");
    if (
      !request ||
      request.type !== "top_up" ||
      String(request.userId) !== meta.userId
    )
      throw new Error("Top-up request mismatch");
    assertCollectedAmount(amount, request.amount, currency);
    if (request.status === "completed") {
      if (request.stripePaymentIntentId !== paymentIntentId)
        throw new Error("Top-up already funded by another payment");
      return;
    }
    if (request.status !== "pending")
      throw new Error("Top-up request is not pending");
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, request.walletId))
      .limit(1)
      .for("update");
    if (
      !wallet ||
      wallet.status !== "active" ||
      wallet.userId !== request.userId
    )
      throw new Error("Wallet unavailable");
    if (await hasReceipt(tx, paymentIntentId)) return;
    await recordReceipt(
      tx,
      payment,
      "wallet_topup",
      request.id,
      request.userId,
      null
    );
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}` })
      .where(eq(wallets.id, wallet.id));
    await tx
      .update(walletTransactions)
      .set({
        status: "completed",
        stripePaymentIntentId: paymentIntentId,
        balanceAfter: wallet.balance + amount,
      })
      .where(eq(walletTransactions.id, request.id));
    return;
  }

  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, Number(meta.bookingId)))
    .limit(1)
    .for("update");
  if (!booking || (meta.userId && Number(meta.userId) !== booking.userId))
    throw new Error("Payment booking/owner mismatch");
  if (await hasReceipt(tx, paymentIntentId)) return;

  if (kind === "split_payment") {
    const [split] = await tx
      .select()
      .from(paymentSplits)
      .where(
        and(
          eq(paymentSplits.id, Number(meta.splitId)),
          eq(paymentSplits.bookingId, booking.id)
        )
      )
      .limit(1)
      .for("update");
    if (
      !split ||
      !["pending", "email_sent", "failed"].includes(split.status) ||
      booking.status !== "pending"
    )
      throw new Error("Split is not payable");
    assertCollectedAmount(amount, split.amount, currency);
    await recordReceipt(
      tx,
      payment,
      kind,
      split.id,
      booking.userId,
      booking.id
    );
    await tx
      .update(paymentSplits)
      .set({
        status: "paid",
        stripePaymentIntentId: paymentIntentId,
        paidAt: new Date(),
      })
      .where(eq(paymentSplits.id, split.id));
    const shares = await tx
      .select()
      .from(paymentSplits)
      .where(
        and(
          eq(paymentSplits.bookingId, booking.id),
          inArray(paymentSplits.status, [
            "paid",
            "pending",
            "email_sent",
            "failed",
          ])
        )
      );
    const paid = shares
      .filter(s => s.status === "paid")
      .reduce((sum, s) => sum + s.amount, 0);
    if (paid > booking.totalAmount)
      throw new Error("Split payments exceed booking amount");
    if (paid === booking.totalAmount && shares.every(s => s.status === "paid"))
      await confirmFundedBooking(tx, booking);
    return;
  }

  if (kind === "modification") {
    const [change] = await tx
      .select()
      .from(bookingModifications)
      .where(
        and(
          eq(bookingModifications.id, Number(meta.modificationId)),
          eq(bookingModifications.bookingId, booking.id)
        )
      )
      .limit(1)
      .for("update");
    if (
      !change ||
      change.userId !== booking.userId ||
      change.status !== "pending" ||
      booking.status !== "confirmed" ||
      !booking.seatsReserved
    )
      throw new Error("Modification is not payable");
    assertCollectedAmount(amount, change.totalCost, currency);
    if (
      change.originalFlightId !== booking.flightId ||
      change.originalCabinClass !== booking.cabinClass ||
      change.originalAmount !== booking.totalAmount
    )
      throw new Error("Booking changed after modification quote");
    const nextFlight = change.newFlightId || booking.flightId;
    const nextCabin = change.newCabinClass || booking.cabinClass;
    // Lock both flight rows in deterministic order before moving capacity.
    for (const id of [...new Set([booking.flightId, nextFlight])].sort(
      (a, b) => a - b
    )) {
      await tx.select().from(flights).where(eq(flights.id, id)).for("update");
    }
    if (nextFlight !== booking.flightId || nextCabin !== booking.cabinClass) {
      await reserveSeats(tx, nextFlight, nextCabin, booking.numberOfPassengers);
      await restoreSeats(
        tx,
        booking.flightId,
        booking.cabinClass,
        booking.numberOfPassengers
      );
    }
    await recordReceipt(
      tx,
      payment,
      kind,
      change.id,
      booking.userId,
      booking.id
    );
    await tx
      .update(bookings)
      .set({
        flightId: nextFlight,
        cabinClass: nextCabin,
        totalAmount: change.newAmount,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));
    await tx
      .update(bookingModifications)
      .set({
        status: "completed",
        paymentStatus: "paid",
        stripePaymentIntentId: paymentIntentId,
        completedAt: new Date(),
      })
      .where(eq(bookingModifications.id, change.id));
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      eventType: "booking.modified",
      tenantId: booking.tenantId,
      payload: { bookingId: booking.id, modificationId: change.id },
    });
    return;
  }

  assertCollectedAmount(amount, booking.totalAmount, currency);
  if (booking.paymentStatus === "paid") {
    // Legacy paid rows predate receipt tracking; never invent another charge.
    if (booking.stripePaymentIntentId === paymentIntentId) return;
    throw new Error("Booking already funded by another payment");
  }
  const shares = await tx
    .select()
    .from(paymentSplits)
    .where(
      and(
        eq(paymentSplits.bookingId, booking.id),
        inArray(paymentSplits.status, ["paid", "pending", "email_sent"])
      )
    );
  if (shares.length)
    throw new Error("Booking has an active split payment plan");
  await recordReceipt(
    tx,
    payment,
    "booking",
    booking.id,
    booking.userId,
    booking.id
  );
  await confirmFundedBooking(tx, booking, paymentIntentId);
}

async function hasReceipt(tx: SettlementTx, paymentIntentId: string) {
  const [existing] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, paymentIntentId))
    .limit(1)
    .for("update");
  return !!existing;
}

async function recordReceipt(
  tx: SettlementTx,
  payment: VerifiedPayment,
  kind: "booking" | "split_payment" | "modification" | "wallet_topup",
  targetId: number,
  userId: number,
  bookingId: number | null
) {
  await tx.insert(paymentReceipts).values({
    paymentIntentId: payment.paymentIntentId,
    kind,
    targetId,
    userId,
    bookingId,
    amount: payment.amount,
    currency: payment.currency.toUpperCase(),
  });
  if (bookingId)
    await tx.insert(payments).values({
      bookingId,
      amount: payment.amount,
      currency: payment.currency.toUpperCase(),
      method: "card",
      provider: "stripe",
      status: "completed",
      transactionId: payment.paymentIntentId,
      stripePaymentIntentId: payment.paymentIntentId,
      idempotencyKey: `stripe:${payment.paymentIntentId}`,
    });
  await tx.insert(financialLedger).values({
    bookingId,
    userId,
    type: "charge",
    amount: (payment.amount / 100).toFixed(2),
    currency: payment.currency.toUpperCase(),
    stripeEventId: payment.eventId,
    stripePaymentIntentId: payment.paymentIntentId,
    description: `${kind} payment ${targetId}`,
  });
}

/** Charge amount_refunded is cumulative: record only a positive, previously unseen delta. */
export async function settleVerifiedRefund(
  tx: SettlementTx,
  input: {
    paymentIntentId: string;
    chargeId: string;
    amount: number;
    amountRefunded: number;
    currency: string;
    eventId: string;
  }
) {
  // Discovery is non-locking. Acquire the same owner locks as collection
  // (booking -> receipt, or top-up request -> wallet -> receipt), then reread
  // the receipt with a current locking read. Never hold receipt while waiting
  // on an owner: that inverts collection's lock order and can deadlock.
  const [hint] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, input.paymentIntentId))
    .limit(1);
  if (!hint)
    throw new Error(
      "Refund collection not yet reconciled; retry after payment receipt"
    );
  let ownerBooking;
  let ownerWallet;
  if (hint.kind === "wallet_topup") {
    const [request] = await tx
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.id, hint.targetId))
      .limit(1)
      .for("update");
    if (!request || request.type !== "top_up" || request.userId !== hint.userId)
      throw new Error("Missing wallet top-up owner");
    [ownerWallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, request.walletId))
      .limit(1)
      .for("update");
    if (!ownerWallet || ownerWallet.userId !== hint.userId)
      throw new Error("Refund wallet missing");
  } else if (hint.bookingId) {
    [ownerBooking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .limit(1)
      .for("update");
    if (!ownerBooking || ownerBooking.userId !== hint.userId)
      throw new Error("Refund booking missing");
  }
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, input.paymentIntentId))
    .limit(1)
    .for("update");
  if (!receipt)
    throw new Error(
      "Refund collection not yet reconciled; retry after payment receipt"
    );
  assertCollectedAmount(input.amount, receipt.amount, input.currency);
  if (
    !Number.isSafeInteger(input.amountRefunded) ||
    input.amountRefunded > receipt.amount ||
    input.amountRefunded < 0
  )
    throw new Error("Invalid cumulative refund");
  const delta = input.amountRefunded - receipt.refundedAmount;
  if (delta <= 0) return;
  await tx
    .update(paymentReceipts)
    .set({ refundedAmount: input.amountRefunded })
    .where(eq(paymentReceipts.paymentIntentId, input.paymentIntentId));
  await tx.insert(financialLedger).values({
    bookingId: receipt.bookingId,
    userId: receipt.userId,
    type: input.amountRefunded === receipt.amount ? "refund" : "partial_refund",
    amount: (delta / 100).toFixed(2),
    currency: receipt.currency,
    stripePaymentIntentId: input.paymentIntentId,
    stripeChargeId: input.chargeId,
    stripeEventId: input.eventId,
    description: "Verified refund delta",
  });
  if (receipt.kind === "wallet_topup") {
    const wallet = ownerWallet!;
    const balance = wallet.balance - delta;
    await tx
      .update(wallets)
      .set({ balance, ...(balance < 0 ? { status: "frozen" as const } : {}) })
      .where(eq(wallets.id, wallet.id));
    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      userId: wallet.userId,
      type: "withdrawal",
      amount: -delta,
      balanceAfter: balance,
      description: "Provider reversed wallet funding",
      stripePaymentIntentId: input.paymentIntentId,
    });
  } else if (receipt.bookingId && receipt.kind !== "modification") {
    const booking = ownerBooking!;
    const receipts = await tx
      .select()
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.bookingId, booking.id),
          inArray(paymentReceipts.kind, ["booking", "split_payment"])
        )
      )
      .for("update");
    const allRefunded =
      receipts.length > 0 && receipts.every(r => r.amount === r.refundedAmount);
    if (allRefunded) {
      await releaseBookingSeats(tx, booking);
      await tx
        .update(bookings)
        .set({ status: "cancelled", paymentStatus: "refunded" })
        .where(eq(bookings.id, booking.id));
    }
  }
  if (input.amountRefunded === receipt.amount && receipt.bookingId) {
    await tx
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.stripePaymentIntentId, input.paymentIntentId));
  }
  await recordEvent(tx, {
    aggregateType: "payment",
    aggregateId: input.paymentIntentId,
    eventType: "payment.refunded",
    payload: {
      userId: receipt.userId,
      bookingId: receipt.bookingId,
      amount: delta,
    },
  });
}
