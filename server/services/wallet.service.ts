import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { wallets, walletTransactions } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

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
  const [result] = await db.insert(wallets).values({
    userId,
    balance: 0,
    currency: "SAR",
    status: "active",
  });

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, result.insertId))
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
  stripePaymentIntentId?: string
) {
  if (amount <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Amount must be positive",
    });

  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const wallet = await getOrCreateWallet(userId);

  if (wallet.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Wallet is not active",
    });
  }

  const newBalance = wallet.balance + amount;

  // Update wallet balance
  await db
    .update(wallets)
    .set({ balance: newBalance })
    .where(eq(wallets.id, wallet.id));

  // Record transaction
  await db.insert(walletTransactions).values({
    walletId: wallet.id,
    userId,
    type: "top_up",
    amount,
    balanceAfter: newBalance,
    description,
    stripePaymentIntentId,
    status: "completed",
  });

  return { balance: newBalance, transactionAmount: amount };
}

/**
 * Pay from wallet
 */
export async function payFromWallet(
  userId: number,
  amount: number,
  description: string,
  bookingId?: number
) {
  if (amount <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Amount must be positive",
    });

  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const wallet = await getOrCreateWallet(userId);

  if (wallet.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Wallet is not active",
    });
  }

  if (wallet.balance < amount) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Insufficient wallet balance",
    });
  }

  const newBalance = wallet.balance - amount;

  await db
    .update(wallets)
    .set({ balance: newBalance })
    .where(eq(wallets.id, wallet.id));

  await db.insert(walletTransactions).values({
    walletId: wallet.id,
    userId,
    type: "payment",
    amount: -amount,
    balanceAfter: newBalance,
    description,
    bookingId,
    status: "completed",
  });

  return { balance: newBalance, amountPaid: amount };
}

/**
 * Refund to wallet
 */
export async function refundToWallet(
  userId: number,
  amount: number,
  description: string,
  bookingId?: number
) {
  if (amount <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Amount must be positive",
    });

  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const wallet = await getOrCreateWallet(userId);

  const newBalance = wallet.balance + amount;

  await db
    .update(wallets)
    .set({ balance: newBalance })
    .where(eq(wallets.id, wallet.id));

  await db.insert(walletTransactions).values({
    walletId: wallet.id,
    userId,
    type: "refund",
    amount,
    balanceAfter: newBalance,
    description,
    bookingId,
    status: "completed",
  });

  return { balance: newBalance, amountRefunded: amount };
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
