import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { wallets, walletTransactions } from "../../drizzle/schema";
import { eq, sql, and } from "drizzle-orm";

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

  const result = await db.transaction(async tx => {
    // Atomic balance update using SQL arithmetic to prevent lost updates
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}` })
      .where(eq(wallets.id, wallet.id));

    // Read back the updated balance
    const [updated] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, wallet.id))
      .limit(1);
    const newBalance = updated.balance;

    // Record transaction inside same tx
    await tx.insert(walletTransactions).values({
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
  });

  return result;
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

  // Preliminary balance check (authoritative check is inside the transaction)
  if (wallet.balance < amount) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Insufficient wallet balance",
    });
  }

  const result = await db.transaction(async tx => {
    // Atomic deduct with SQL-level balance check to prevent race conditions
    const updateResult = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}` })
      .where(
        and(eq(wallets.id, wallet.id), sql`${wallets.balance} >= ${amount}`)
      );

    // Check if update was applied (balance was sufficient)
    const affectedRows = (
      updateResult as unknown as [{ affectedRows: number }]
    )[0].affectedRows;
    if (affectedRows === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Insufficient wallet balance",
      });
    }

    // Read back the updated balance
    const [updated] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, wallet.id))
      .limit(1);
    const newBalance = updated.balance;

    await tx.insert(walletTransactions).values({
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
  });

  return result;
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

  const result = await db.transaction(async tx => {
    // Atomic balance update using SQL arithmetic to prevent lost updates
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${amount}` })
      .where(eq(wallets.id, wallet.id));

    // Read back the updated balance
    const [updated] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.id, wallet.id))
      .limit(1);
    const newBalance = updated.balance;

    await tx.insert(walletTransactions).values({
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
  });

  return result;
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
