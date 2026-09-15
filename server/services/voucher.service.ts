import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  vouchers,
  userCredits,
  voucherUsage,
  creditUsage,
  bookings,
  users,
  financialLedger,
  type InsertVoucher,
} from "../../drizzle/schema";
import { eq, and, lte, gte, gt, desc, or, isNull, sql, asc } from "drizzle-orm";

import {
  lockEditableInvoice,
  setInvoiceTotal,
} from "./booking-invoice.service";
import { confirmFundedBooking } from "./booking-settlement.service";

/**
 * Voucher & Credit Service
 * Handles voucher validation, application, and credit management
 */

// ============================================================================
// Voucher Functions
// ============================================================================

/**
 * Create a new voucher (admin only)
 */
export async function createVoucher(
  data: Omit<InsertVoucher, "id" | "usedCount" | "createdAt" | "updatedAt">,
  createdBy: number
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Check if voucher code already exists
    const [existing] = await database
      .select()
      .from(vouchers)
      .where(eq(vouchers.code, data.code.toUpperCase()))
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Voucher code already exists",
      });
    }

    const [result] = await database.insert(vouchers).values({
      ...data,
      code: data.code.toUpperCase(),
      createdBy,
      usedCount: 0,
    });

    const [newVoucher] = await database
      .select()
      .from(vouchers)
      .where(eq(vouchers.id, (result as { insertId: number }).insertId))
      .limit(1);

    return newVoucher;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error creating voucher:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create voucher",
    });
  }
}

/**
 * Get all vouchers (admin only)
 */
export async function getAllVouchers(includeInactive = false) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const query = includeInactive
      ? database.select().from(vouchers).orderBy(desc(vouchers.createdAt))
      : database
          .select()
          .from(vouchers)
          .where(eq(vouchers.isActive, true))
          .orderBy(desc(vouchers.createdAt));

    return await query;
  } catch (error) {
    console.error("Error getting vouchers:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get vouchers",
    });
  }
}

/**
 * Get voucher by ID
 */
export async function getVoucherById(id: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [voucher] = await database
    .select()
    .from(vouchers)
    .where(eq(vouchers.id, id))
    .limit(1);

  return voucher || null;
}

/**
 * Update voucher (admin only)
 */
export async function updateVoucher(
  id: number,
  data: Partial<
    Omit<InsertVoucher, "id" | "code" | "createdAt" | "updatedAt" | "createdBy">
  >
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    await database.update(vouchers).set(data).where(eq(vouchers.id, id));

    const [updated] = await database
      .select()
      .from(vouchers)
      .where(eq(vouchers.id, id))
      .limit(1);

    return updated;
  } catch (error) {
    console.error("Error updating voucher:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update voucher",
    });
  }
}

/**
 * Deactivate voucher (admin only)
 */
export function deactivateVoucher(id: number) {
  return updateVoucher(id, { isActive: false });
}

/**
 * Validate a voucher code
 * Returns the voucher details if valid, otherwise throws an error
 */
export async function validateVoucher(
  code: string,
  amount: number,
  userId?: number
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const now = new Date();
    const normalizedCode = code.toUpperCase().trim();

    // Find the voucher
    const [voucher] = await database
      .select()
      .from(vouchers)
      .where(eq(vouchers.code, normalizedCode))
      .limit(1);

    if (!voucher) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Voucher code not found",
      });
    }

    // Check if active
    if (!voucher.isActive) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This voucher is no longer active",
      });
    }

    // Check validity period
    if (new Date(voucher.validFrom) > now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This voucher is not yet valid",
      });
    }

    if (new Date(voucher.validUntil) < now) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This voucher has expired",
      });
    }

    // Check usage limit
    if (voucher.maxUses !== null && voucher.usedCount >= voucher.maxUses) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This voucher has reached its usage limit",
      });
    }

    // Check minimum purchase
    if (amount < voucher.minPurchase) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Minimum purchase of ${(voucher.minPurchase / 100).toFixed(2)} SAR required`,
      });
    }

    // Check if user has already used this voucher (if userId provided)
    if (userId) {
      const [existingUsage] = await database
        .select()
        .from(voucherUsage)
        .where(
          and(
            eq(voucherUsage.voucherId, voucher.id),
            eq(voucherUsage.userId, userId),
            isNull(voucherUsage.releasedAt)
          )
        )
        .limit(1);

      if (existingUsage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You have already used this voucher",
        });
      }
    }

    // Calculate discount
    let discountAmount: number;
    if (voucher.type === "fixed") {
      discountAmount = Math.min(voucher.value, amount);
    } else {
      // Percentage
      discountAmount = Math.floor((amount * voucher.value) / 100);
      // Apply max discount cap if set
      if (voucher.maxDiscount !== null) {
        discountAmount = Math.min(discountAmount, voucher.maxDiscount);
      }
    }

    return {
      valid: true,
      voucher,
      discountAmount,
      finalAmount: amount - discountAmount,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error validating voucher:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to validate voucher",
    });
  }
}

/**
 * Apply a voucher to a booking
 * Records the usage and updates the voucher count
 */
export async function applyVoucher(
  code: string,
  bookingId: number,
  userId: number,
  _amount: number
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    // Use a transaction to prevent race conditions on voucher usage count
    return await database.transaction(async tx => {
      const [owned] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
        .for("update");
      if (!owned)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Owned booking not found",
        });
      const now = new Date();
      const normalizedCode = code.toUpperCase().trim();

      // Re-read voucher inside transaction for consistency
      const [voucher] = await tx
        .select()
        .from(vouchers)
        .where(eq(vouchers.code, normalizedCode))
        .limit(1)
        .for("update");

      if (voucher) {
        const [replay] = await tx
          .select()
          .from(voucherUsage)
          .where(
            and(
              eq(voucherUsage.voucherId, voucher.id),
              eq(voucherUsage.bookingId, bookingId),
              eq(voucherUsage.userId, userId)
            )
          );
        if (replay?.releasedAt)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Voucher reservation was released on cancellation",
          });
        if (replay)
          return {
            success: true,
            discountApplied: replay.discountApplied,
            finalAmount: owned.totalAmount,
            voucherCode: voucher.code,
          };
      }
      const booking = await lockEditableInvoice(tx, bookingId, { userId });
      const amount = booking.totalAmount;
      if (!voucher || !voucher.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Voucher not found or inactive",
        });
      }

      if (
        new Date(voucher.validFrom) > now ||
        new Date(voucher.validUntil) < now
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Voucher is not within its validity period",
        });
      }

      if (voucher.maxUses !== null && voucher.usedCount >= voucher.maxUses) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This voucher has reached its usage limit",
        });
      }

      if (amount < voucher.minPurchase) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Minimum purchase of ${(voucher.minPurchase / 100).toFixed(2)} SAR required`,
        });
      }

      // Check if user has already used this voucher
      const [existingUsage] = await tx
        .select()
        .from(voucherUsage)
        .where(
          and(
            eq(voucherUsage.voucherId, voucher.id),
            eq(voucherUsage.userId, userId),
            isNull(voucherUsage.releasedAt)
          )
        )
        .limit(1);

      if (existingUsage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You have already used this voucher",
        });
      }

      // Calculate discount
      let discountAmount: number;
      if (voucher.type === "fixed") {
        discountAmount = Math.min(voucher.value, amount);
      } else {
        discountAmount = Math.floor((amount * voucher.value) / 100);
        if (voucher.maxDiscount !== null) {
          discountAmount = Math.min(discountAmount, voucher.maxDiscount);
        }
      }

      if (
        !Number.isSafeInteger(discountAmount) ||
        discountAmount <= 0 ||
        discountAmount >= amount
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Voucher must leave a positive payable invoice",
        });
      await setInvoiceTotal(tx, booking, amount - discountAmount);
      // The quota and invoice revision commit or roll back together.
      await tx.insert(voucherUsage).values({
        voucherId: voucher.id,
        userId,
        bookingId,
        discountApplied: discountAmount,
      });

      // Atomically increment the used count
      await tx
        .update(vouchers)
        .set({ usedCount: sql`${vouchers.usedCount} + 1` })
        .where(eq(vouchers.id, voucher.id));

      return {
        success: true,
        discountApplied: discountAmount,
        finalAmount: amount - discountAmount,
        voucherCode: voucher.code,
      };
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error applying voucher:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to apply voucher",
    });
  }
}

/**
 * Get voucher usage history for a voucher (admin)
 */
export async function getVoucherUsageHistory(voucherId: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  return await database
    .select()
    .from(voucherUsage)
    .where(eq(voucherUsage.voucherId, voucherId))
    .orderBy(desc(voucherUsage.usedAt));
}

// ============================================================================
// Credit Functions
// ============================================================================

/**
 * Get user's credits
 */
export async function getUserCredits(userId: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const now = new Date();

    // Get all credits that are not fully used and not expired
    const credits = await database
      .select()
      .from(userCredits)
      .where(
        and(
          eq(userCredits.userId, userId),
          or(isNull(userCredits.expiresAt), gte(userCredits.expiresAt, now))
        )
      )
      .orderBy(desc(userCredits.createdAt));

    return credits;
  } catch (error) {
    console.error("Error getting user credits:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get user credits",
    });
  }
}

/**
 * Get available credit balance for a user
 */
export async function getAvailableBalance(userId: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const now = new Date();

    // Get all valid credits
    const credits = await database
      .select()
      .from(userCredits)
      .where(
        and(
          eq(userCredits.userId, userId),
          or(isNull(userCredits.expiresAt), gte(userCredits.expiresAt, now))
        )
      );

    // Calculate total available balance
    const totalAvailable = credits.reduce((sum, credit) => {
      const available = credit.amount - credit.usedAmount;
      return sum + Math.max(0, available);
    }, 0);

    return {
      balance: totalAvailable,
      credits: credits.map(c => ({
        id: c.id,
        amount: c.amount,
        usedAmount: c.usedAmount,
        available: Math.max(0, c.amount - c.usedAmount),
        source: c.source,
        expiresAt: c.expiresAt,
        description: c.description,
      })),
    };
  } catch (error) {
    console.error("Error getting available balance:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get credit balance",
    });
  }
}

/**
 * Add credit to a user (admin or system)
 */
export async function addCredit(
  userId: number,
  amount: number,
  source: "refund" | "promo" | "compensation" | "bonus",
  description: string,
  options?: {
    expiresAt?: Date;
    bookingId?: number;
    createdBy?: number;
  }
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const [result] = await database.insert(userCredits).values({
      userId,
      amount,
      source,
      description,
      expiresAt: options?.expiresAt || null,
      bookingId: options?.bookingId || null,
      createdBy: options?.createdBy || null,
      usedAmount: 0,
    });

    const [newCredit] = await database
      .select()
      .from(userCredits)
      .where(eq(userCredits.id, (result as { insertId: number }).insertId))
      .limit(1);

    console.info(
      `[Credits] Added ${amount} cents credit to user ${userId}: ${description}`
    );

    return newCredit;
  } catch (error) {
    console.error("Error adding credit:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to add credit",
    });
  }
}

/**
 * Use credit for a booking
 * Deducts from the oldest credits first (FIFO)
 */
export async function useCredit(
  userId: number,
  amount: number,
  bookingId: number
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Credit amount must be positive whole minor units",
    });
  return database.transaction(async tx => {
    const [owned] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)))
      .for("update");
    if (!owned)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Owned booking not found",
      });
    const previous = await tx
      .select()
      .from(creditUsage)
      .where(
        and(
          eq(creditUsage.bookingId, bookingId),
          eq(creditUsage.userId, userId)
        )
      );
    if (previous.length) {
      const used = previous.reduce((sum, row) => sum + row.amountUsed, 0);
      const [posted] = await tx
        .select()
        .from(financialLedger)
        .where(
          and(
            eq(financialLedger.bookingId, bookingId),
            eq(financialLedger.stripeEventId, `internal-credit:${bookingId}`)
          )
        );
      if (used !== amount || !posted)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Credit usage requires reconciliation",
        });
      return {
        success: true,
        amountUsed: used,
        usages: previous.map(row => ({
          creditId: row.userCreditId,
          amount: row.amountUsed,
        })),
      };
    }
    const booking = await lockEditableInvoice(tx, bookingId, { userId });
    if (amount !== booking.totalAmount)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Credits currently settle the full invoice; partial tenders are unavailable",
      });
    // Account then lots: disjoint bookings cannot spend the same balance.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    const now = new Date();
    const credits = await tx
      .select()
      .from(userCredits)
      .where(
        and(
          eq(userCredits.userId, userId),
          or(isNull(userCredits.expiresAt), gt(userCredits.expiresAt, now)),
          gt(sql`${userCredits.amount} - ${userCredits.usedAmount}`, 0)
        )
      )
      .orderBy(asc(userCredits.id))
      .for("update");
    if (credits.reduce((sum, c) => sum + c.amount - c.usedAmount, 0) < amount)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Insufficient credit balance",
      });
    let remaining = amount;
    const usages: Array<{ creditId: number; amount: number }> = [];
    for (const credit of credits) {
      if (!remaining) break;
      const used = Math.min(remaining, credit.amount - credit.usedAmount);
      const [result] = await tx
        .update(userCredits)
        .set({ usedAmount: sql`${userCredits.usedAmount} + ${used}` })
        .where(
          and(
            eq(userCredits.id, credit.id),
            sql`${userCredits.usedAmount} + ${used} <= ${userCredits.amount}`
          )
        );
      if (result.affectedRows !== 1)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Credit balance changed",
        });
      await tx.insert(creditUsage).values({
        userCreditId: credit.id,
        userId,
        bookingId,
        amountUsed: used,
      });
      usages.push({ creditId: credit.id, amount: used });
      remaining -= used;
    }
    // Inventory failure rolls back the debit and every usage row.
    await confirmFundedBooking(tx, booking);
    await tx.insert(financialLedger).values({
      bookingId,
      userId,
      type: "charge",
      amount: (amount / 100).toFixed(2),
      currency: "SAR",
      stripeEventId: `internal-credit:${bookingId}`,
      description: "Internal credit invoice settlement",
      metadata: JSON.stringify({ tender: "user_credit", usages }),
    });
    return { success: true, amountUsed: amount, usages };
  });
}

/**
 * Get credit usage history for a user
 */
export async function getCreditUsageHistory(userId: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  return await database
    .select()
    .from(creditUsage)
    .where(eq(creditUsage.userId, userId))
    .orderBy(desc(creditUsage.usedAt));
}

/**
 * Get all credits for admin view
 */
export async function getAllCredits(limit = 100, offset = 0) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  return await database
    .select()
    .from(userCredits)
    .orderBy(desc(userCredits.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Process expired credits
 * This should be run periodically (cron job)
 */
export async function processExpiredCredits() {
  const database = await getDb();
  if (!database) {
    console.error("Database not available for credit expiration");
    return { processedCount: 0 };
  }

  try {
    const now = new Date();

    // Get expired credits that still have balance
    const expired = await database
      .select()
      .from(userCredits)
      .where(
        and(
          lte(userCredits.expiresAt, now),
          gt(sql`${userCredits.amount} - ${userCredits.usedAmount}`, 0)
        )
      );

    // Retain the original amount and actual usage for financial reconciliation.
    console.info(`[Credits] Expired ${expired.length} credit records`);

    return { processedCount: expired.length };
  } catch (error) {
    console.error("Error processing expired credits:", error);
    return { processedCount: 0 };
  }
}
