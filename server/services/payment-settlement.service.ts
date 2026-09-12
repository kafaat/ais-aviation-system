import { BaggageCustodyConflict } from "./baggage-custody.service";
import {
  applyPaidOrderModification,
  OrderServicingUnavailable,
} from "./order-servicing.service";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  bookings,
  bookingRefundItems,
  flights,
  bookingModifications,
  orderServiceRefunds,
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
  InventoryUnavailableError,
  BookingNotPendingError,
  type SettlementTx,
} from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";
import { isActiveSplitPayment } from "./booking-checkout.service";

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
    if (await hasReceipt(tx, payment)) return;
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
  if (await hasReceipt(tx, payment)) return;

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
    if (!split) throw new Error("Payment split/booking mismatch");
    assertCollectedAmount(amount, split.amount, currency);
    // Legacy same-intent replays are harmless; a different collected intent is
    // a real additional charge and must be retained for reconciliation.
    if (
      split.status === "paid" &&
      split.stripePaymentIntentId === paymentIntentId
    )
      return;
    await recordReceipt(
      tx,
      payment,
      kind,
      split.id,
      booking.userId,
      booking.id
    );
    const shares = await tx
      .select()
      .from(paymentSplits)
      .where(eq(paymentSplits.bookingId, booking.id));
    const active = shares.filter(s =>
      ["paid", "pending", "email_sent", "failed"].includes(s.status)
    );
    const receipts = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.bookingId, booking.id));
    const requestMetadata = split.checkoutRequestPayload
      ? (
          JSON.parse(split.checkoutRequestPayload) as {
            metadata?: Record<string, string>;
          }
        ).metadata
      : undefined;
    const mismatchedClaim =
      split.checkoutRequestId &&
      (meta.checkoutRequestId !== split.checkoutRequestId ||
        !requestMetadata?.invoiceHash ||
        meta.invoiceHash !== requestMetadata.invoiceHash);
    if (
      !["pending", "email_sent", "failed"].includes(split.status) ||
      booking.status !== "pending" ||
      booking.paymentStatus !== "pending" ||
      booking.seatsReserved ||
      mismatchedClaim ||
      active.length < 2 ||
      active.reduce((sum, s) => sum + s.amount, 0) !== booking.totalAmount ||
      receipts.some(
        r =>
          (r.refundedAmount > 0 && r.settlementStatus !== "review_refunded") ||
          r.settlementStatus === "review_required"
      )
    ) {
      await requireCollectionReview(
        tx,
        payment,
        booking,
        "Split collection conflicts with its current payment plan"
      );
      return;
    }
    await tx
      .update(paymentSplits)
      .set({
        status: "paid",
        stripePaymentIntentId: paymentIntentId,
        paidAt: new Date(),
      })
      .where(eq(paymentSplits.id, split.id));
    const funded = active.every(s => {
      const intent =
        s.id === split.id ? paymentIntentId : s.stripePaymentIntentId;
      return (
        (s.id === split.id || s.status === "paid") &&
        receipts.some(
          r =>
            r.kind === "split_payment" &&
            r.targetId === s.id &&
            r.paymentIntentId === intent &&
            r.amount === s.amount &&
            r.refundedAmount === 0 &&
            r.settlementStatus === "applied"
        )
      );
    });
    if (funded) await confirmCollectedBooking(tx, booking, payment);
    else if (active.every(s => s.id === split.id || s.status === "paid"))
      await requireCollectionReview(
        tx,
        payment,
        booking,
        "Paid split state lacks matching verified funding receipts",
        true
      );
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
    if (change?.servicingPayload && change.userId === booking.userId) {
      assertCollectedAmount(amount, change.totalCost, currency);
      await recordReceipt(
        tx,
        payment,
        kind,
        change.id,
        booking.userId,
        booking.id
      );
      try {
        if (
          !change.checkoutRequestId ||
          meta.checkoutRequestId !== change.checkoutRequestId
        )
          throw new OrderServicingUnavailable(
            "Collected payment lacks the saved servicing checkout identity"
          );
        await tx.transaction(inner =>
          applyPaidOrderModification(inner, booking, change)
        );
        await tx
          .update(bookingModifications)
          .set({ stripePaymentIntentId: paymentIntentId })
          .where(eq(bookingModifications.id, change.id));
      } catch (error) {
        if (
          !(
            error instanceof OrderServicingUnavailable ||
            error instanceof BaggageCustodyConflict ||
            error instanceof InventoryUnavailableError
          )
        )
          throw error;
        await requireCollectionReview(tx, payment, booking, error.message);
      }
      return;
    }
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
    await recordReceipt(
      tx,
      payment,
      "booking",
      booking.id,
      booking.userId,
      booking.id
    );
    await requireCollectionReview(
      tx,
      payment,
      booking,
      "Booking already funded by another payment"
    );
    return;
  }
  const shares = await tx
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.bookingId, booking.id));
  await recordReceipt(
    tx,
    payment,
    "booking",
    booking.id,
    booking.userId,
    booking.id
  );
  if (shares.some(isActiveSplitPayment)) {
    await requireCollectionReview(
      tx,
      payment,
      booking,
      "Booking has an active split payment plan"
    );
    return;
  }
  await confirmCollectedBooking(tx, booking, payment);
}

async function requireCollectionReview(
  tx: SettlementTx,
  payment: VerifiedPayment,
  booking: typeof bookings.$inferSelect,
  reason: string,
  allBookingCollections = false
) {
  await tx
    .update(paymentReceipts)
    .set({ settlementStatus: "review_required", settlementError: reason })
    .where(
      allBookingCollections
        ? and(
            eq(paymentReceipts.bookingId, booking.id),
            inArray(paymentReceipts.kind, ["booking", "split_payment"]),
            eq(paymentReceipts.settlementStatus, "applied")
          )
        : eq(paymentReceipts.paymentIntentId, payment.paymentIntentId)
    );
  await recordEvent(tx, {
    aggregateType: "payment",
    aggregateId: payment.paymentIntentId,
    eventType: "payment.settlement_review_required",
    tenantId: booking.tenantId,
    payload: {
      paymentIntentId: payment.paymentIntentId,
      bookingId: booking.id,
      reason,
    },
  });
}

async function confirmCollectedBooking(
  tx: SettlementTx,
  booking: typeof bookings.$inferSelect,
  payment: VerifiedPayment
) {
  try {
    await confirmFundedBooking(tx, booking, payment.paymentIntentId);
  } catch (error) {
    // These errors occur before inventory is changed. Other failures must roll
    // back the whole transaction and remain retryable (never acknowledge them).
    if (
      !(
        error instanceof InventoryUnavailableError ||
        error instanceof BookingNotPendingError
      )
    )
      throw error;
    await requireCollectionReview(tx, payment, booking, error.message, true);
  }
}

async function hasReceipt(tx: SettlementTx, payment: VerifiedPayment) {
  // Owner locks serialize the same purchase. A unique receipt key handles
  // conflicting references; do not take an absent-key gap lock here.
  const [existing] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, payment.paymentIntentId))
    .limit(1);
  if (!existing) return false;
  const kind = payment.metadata.type || "booking";
  const target = Number(
    payment.metadata[
      kind === "wallet_topup"
        ? "topUpId"
        : kind === "split_payment"
          ? "splitId"
          : kind === "modification"
            ? "modificationId"
            : "bookingId"
    ]
  );
  if (
    existing.kind !== kind ||
    existing.targetId !== target ||
    (kind !== "wallet_topup" &&
      existing.bookingId !== Number(payment.metadata.bookingId)) ||
    (payment.metadata.userId &&
      existing.userId !== Number(payment.metadata.userId)) ||
    existing.amount !== payment.amount ||
    existing.currency.toUpperCase() !== payment.currency.toUpperCase()
  ) {
    throw new Error("Payment receipt identity/amount mismatch");
  }
  return true;
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
    refundId?: string;
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
  // Planned split refunds require individual success evidence. A charge's gross
  // refund aggregate can include pending requests and cannot complete this plan.
  if (ownerBooking) {
    const [planned] = await tx
      .select()
      .from(bookingRefundItems)
      .where(eq(bookingRefundItems.paymentIntentId, input.paymentIntentId))
      .for("update");
    if (
      planned &&
      (!input.refundId ||
        planned.status !== "succeeded" ||
        planned.refundId !== input.refundId ||
        input.amountRefunded !== planned.refundAmount)
    )
      return;
  }
  const servicePlans = ownerBooking
    ? await tx
        .select()
        .from(orderServiceRefunds)
        .where(eq(orderServiceRefunds.paymentIntentId, input.paymentIntentId))
        .for("update")
    : [];
  if (
    servicePlans.some(p => p.status !== "succeeded") &&
    (!input.refundId ||
      !servicePlans.some(
        p =>
          p.status === "succeeded" &&
          p.refundId === input.refundId &&
          p.baseRefundedAmount + p.amount === input.amountRefunded
      ))
  )
    return;
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
  } else if (
    receipt.bookingId &&
    receipt.kind !== "modification" &&
    receipt.settlementStatus === "applied"
  ) {
    const booking = ownerBooking!;
    const receipts = await tx
      .select()
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.bookingId, booking.id),
          inArray(paymentReceipts.kind, ["booking", "split_payment"]),
          eq(paymentReceipts.settlementStatus, "applied")
        )
      )
      .for("update");
    const allRefunded =
      receipts.length > 0 && receipts.every(r => r.amount === r.refundedAmount);
    if (allRefunded) {
      await releaseBookingSeats(tx, booking, "refunded");
      await tx
        .update(bookings)
        .set({ status: "cancelled", paymentStatus: "refunded" })
        .where(eq(bookings.id, booking.id));
    } else if (
      receipt.kind === "split_payment" &&
      booking.status === "pending"
    ) {
      await requireCollectionReview(
        tx,
        {
          paymentIntentId: input.paymentIntentId,
          amount: receipt.amount,
          currency: receipt.currency,
          eventId: input.eventId,
          metadata: {
            type: "split_payment",
            bookingId: String(booking.id),
            splitId: String(receipt.targetId),
          },
        },
        booking,
        "Split funding was refunded before booking confirmation",
        true
      );
    }
  }
  if (input.amountRefunded === receipt.amount && receipt.bookingId) {
    await tx
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.stripePaymentIntentId, input.paymentIntentId));
    if (receipt.settlementStatus === "review_required") {
      await tx
        .update(paymentReceipts)
        .set({ settlementStatus: "review_refunded" })
        .where(eq(paymentReceipts.paymentIntentId, input.paymentIntentId));
    }
  }
  await recordEvent(tx, {
    aggregateType: "payment",
    aggregateId: input.paymentIntentId,
    eventType: "payment.refunded",
    tenantId: ownerBooking?.tenantId,
    payload: {
      userId: receipt.userId,
      bookingId: receipt.bookingId,
      amount: delta,
    },
  });
}
