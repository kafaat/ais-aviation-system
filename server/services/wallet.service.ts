import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  wallets,
  walletTransactions,
  bookings,
  paymentSplits,
  financialLedger,
} from "../../drizzle/schema";
import { stripe } from "../stripe";
import { confirmFundedBooking } from "./booking-settlement.service";
import { eq, sql, and, inArray } from "drizzle-orm";

/**
 * Get or create a wallet for a user
 */
export async function getOrCreateWallet(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [existing] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  if (existing) return existing;

  // Create new wallet
  await db
    .insert(wallets)
    .values({
      userId,
      balance: 0,
      currency: "SAR",
      status: "active",
    })
    .onDuplicateKeyUpdate({ set: { userId } });

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  return wallet;
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(userId: number) {
  const wallet = await getOrCreateWallet(userId);
  return {
    balance: wallet.balance,
    currency: wallet.currency,
    status: wallet.status,
  };
}

/**
 * Top up wallet balance
 */
export async function topUpWallet(
  userId: number,
  amount: number,
  description: string
) {
  if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 1000000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid top-up amount",
    });
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const wallet = await getOrCreateWallet(userId);
  if (wallet.status !== "active") throw new Error("Wallet is not active");
  const [request] = await db
    .insert(walletTransactions)
    .values({
      walletId: wallet.id,
      userId,
      type: "top_up",
      amount,
      balanceAfter: wallet.balance,
      description,
      status: "pending",
    });
  const metadata = {
    type: "wallet_topup",
    topUpId: String(request.insertId),
    userId: String(userId),
  };
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  // Balance changes only after the signed provider event settles this request.
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "sar",
            product_data: { name: "Wallet top-up" },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${baseUrl}/my-bookings?wallet=pending`,
      cancel_url: `${baseUrl}/my-bookings?wallet=cancelled`,
    },
    { idempotencyKey: `wallet-topup:${request.insertId}` }
  );
  return {
    status: "pending" as const,
    sessionId: session.id,
    url: session.url,
  };
}

/** Amount and ownership come from the locked booking, never the client. */
export async function payFromWallet(userId: number, bookingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
      .limit(1)
      .for("update");
    if (!booking)
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    const [existing] = await tx
      .select()
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.bookingId, bookingId),
          eq(walletTransactions.userId, userId),
          eq(walletTransactions.type, "payment"),
          eq(walletTransactions.status, "completed")
        )
      )
      .limit(1);
    if (existing)
      return { balance: existing.balanceAfter, amountPaid: -existing.amount };
    if (booking.status !== "pending" || booking.paymentStatus === "paid")
      throw new Error("Booking is not payable");
    const shares = await tx
      .select()
      .from(paymentSplits)
      .where(
        and(
          eq(paymentSplits.bookingId, bookingId),
          inArray(paymentSplits.status, ["paid", "pending", "email_sent"])
        )
      );
    if (shares.length)
      throw new Error("Booking has an active split payment plan");
    const amount = booking.totalAmount;
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("Invalid booking amount");
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .limit(1)
      .for("update");
    if (
      !wallet ||
      wallet.status !== "active" ||
      wallet.currency !== "SAR" ||
      wallet.balance < amount
    )
      throw new Error("Insufficient active wallet balance");
    const [deduction] = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}` })
      .where(
        and(
          eq(wallets.id, wallet.id),
          eq(wallets.status, "active"),
          sql`${wallets.balance} >= ${amount}`
        )
      );
    if (deduction.affectedRows !== 1)
      throw new Error("Wallet payment conflict");
    await confirmFundedBooking(tx, booking);
    await tx
      .insert(walletTransactions)
      .values({
        walletId: wallet.id,
        userId,
        bookingId,
        type: "payment",
        amount: -amount,
        balanceAfter: wallet.balance - amount,
        description: `Booking ${booking.bookingReference}`,
        status: "completed",
      });
    await tx
      .insert(financialLedger)
      .values({
        bookingId,
        userId,
        type: "charge",
        amount: (amount / 100).toFixed(2),
        currency: "SAR",
        description: "Wallet booking settlement",
      });
    return { balance: wallet.balance - amount, amountPaid: amount };
  });
}

/**
 * Refund to wallet
 */
export async function refundToWallet(
  _userId: number,
  _amount: number,
  _description: string,
  _bookingId?: number
): Promise<never> {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Unlinked wallet credits are disabled; reconcile a verified original payment first",
  });
}

/**
 * Get wallet transaction history
 */
export async function getWalletTransactions(
  userId: number,
  limit = 20,
  offset = 0
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const wallet = await getOrCreateWallet(userId);

  const transactions = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, wallet.id))
    .orderBy(sql`${walletTransactions.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return transactions;
}
