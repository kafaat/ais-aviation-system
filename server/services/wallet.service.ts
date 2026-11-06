import { assertTenantOperational } from "./tenant.service";
import { withTransactionalIdempotency } from "./idempotency-v2.service";
import {
  providerRequestOptions,
  requireSafeCheckoutReplay,
} from "../_core/idempotency";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  wallets,
  walletTransactions,
  bookings,
  financialLedger,
  users,
} from "../../drizzle/schema";
import { stripe } from "../stripe";
import {
  assertNoActiveCheckout,
  assertNoActiveSplitPayment,
} from "./booking-checkout.service";
import {
  confirmFundedBooking,
  assertNoCollectionReview,
} from "./booking-settlement.service";
import { eq, sql, and } from "drizzle-orm";
import {
  assertWalletFundingReconciled,
  WalletFundingReviewRequiredError,
} from "./wallet-funding.service";

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
  description: string,
  requestKey: string
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
  const claim = await withTransactionalIdempotency({
    scope: "wallet.top-up",
    key: requestKey,
    userId,
    request: { amount },
    run: async tx => {
      const [request] = await tx.insert(walletTransactions).values({
        walletId: wallet.id,
        userId,
        type: "top_up",
        amount,
        balanceAfter: wallet.balance,
        description,
        status: "pending",
      });
      return {
        topUpId: request.insertId,
        requestedAt: Date.now(),
        baseUrl: process.env.FRONTEND_URL || "http://localhost:3000",
      };
    },
  });
  const [pending] = await db
    .select()
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.id, claim.topUpId),
        eq(walletTransactions.userId, userId)
      )
    )
    .limit(1);
  if (!pending || pending.status !== "pending")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This wallet top-up is no longer pending",
    });
  requireSafeCheckoutReplay(claim.requestedAt);
  const metadata = {
    type: "wallet_topup",
    topUpId: String(claim.topUpId),
    userId: String(userId),
  };
  const baseUrl = claim.baseUrl;
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
    providerRequestOptions(`wallet-topup:${claim.topUpId}`)
  );
  return {
    status: "pending" as const,
    sessionId: session.id,
    url: session.url,
  };
}

/** Amount and ownership come from the locked booking, never the client. */
export async function payFromWallet(
  userId: number,
  bookingId: number,
  expectedAmount?: number
) {
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
    const quotedAmount = existing ? -existing.amount : booking.totalAmount;
    if (expectedAmount !== undefined && expectedAmount !== quotedAmount)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Wallet payment amount changed. Review the booking total.",
      });
    if (existing)
      return { balance: existing.balanceAfter, amountPaid: -existing.amount };
    if (
      booking.status !== "pending" ||
      booking.paymentStatus !== "pending" ||
      booking.seatsReserved
    )
      throw new Error("Booking is not payable");
    await assertTenantOperational(tx, booking.tenantId);
    await assertNoCollectionReview(tx, bookingId);
    await assertNoActiveCheckout(tx, booking);
    await assertNoActiveSplitPayment(tx, bookingId);
    const amount = booking.totalAmount;
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("Invalid booking amount");
    // Internal refunds lock the same owner before inventory and then the
    // wallet. Serialize this owner's funding before taking the wallet so a
    // refund for another booking cannot invert the wallet/inventory locks.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
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
    try {
      await assertWalletFundingReconciled(tx, wallet);
    } catch (error) {
      if (!(error instanceof WalletFundingReviewRequiredError)) throw error;
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Wallet funding requires reconciliation. Contact support before making a new wallet payment.",
        cause: error,
      });
    }
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
    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      userId,
      bookingId,
      type: "payment",
      amount: -amount,
      balanceAfter: wallet.balance - amount,
      description: `Booking ${booking.bookingReference}`,
      status: "completed",
    });
    const [posted] = await tx.insert(financialLedger).values({
      bookingId,
      userId,
      type: "charge",
      amount: (amount / 100).toFixed(2),
      currency: "SAR",
      // Same identity scheme as internal-credit:/corporate-credit:, so a
      // cancellation is refused until finance returns the money through
      // refundInternalFunding, which credits the wallet back.
      stripeEventId: `wallet-credit:${bookingId}`,
      description: "Wallet booking settlement",
      metadata: JSON.stringify({ tender: "wallet", walletId: wallet.id }),
    });
    await confirmFundedBooking(tx, booking, undefined, {
      kind: "internal_booking",
      bookingId,
      ledgerId: posted.insertId,
      tender: "wallet",
      amountMinor: amount,
    });
    return { balance: wallet.balance - amount, amountPaid: amount };
  });
}

/**
 * Refund to wallet
 */
export function refundToWallet(
  _userId: number,
  _amount: number,
  _description: string,
  _bookingId?: number
): Promise<never> {
  return Promise.reject(
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Unlinked wallet credits are disabled; reconcile a verified original payment first",
    })
  );
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
    .orderBy(
      sql`${walletTransactions.createdAt} DESC`,
      sql`${walletTransactions.id} DESC`
    )
    .limit(limit)
    .offset(offset);

  return transactions;
}
