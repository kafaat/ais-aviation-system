/**
 * Stripe Reconciliation Service - Production Grade
 *
 * التحسينات المطبقة:
 * 1. مصدر السحب من payments (بدلاً من bookings) ✅
 * 2. Structured logging مع correlationId ✅
 * 3. dryRun mode فعلي ✅
 * 4. التعامل الصحيح مع العملات ✅
 * 5. حماية من race conditions ✅
 * 6. Unique constraint check قبل insert ✅
 *
 * @see PRODUCTION_GRADE_IMPLEMENTATION_GUIDE.md
 */

import type Stripe from "stripe";
import { createStripeClient } from "./client-factory";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { payments, bookings, paymentReceipts } from "../../../drizzle/schema";
import {
  assertCollectedAmount,
  settleVerifiedPayment,
} from "../payment-settlement.service";
import { nanoid } from "nanoid";

// ============================================================================
// Types
// ============================================================================

export interface ReconciliationOptions {
  /** Dry run mode - لا يُحدّث قاعدة البيانات */
  dryRun?: boolean;
  /** عدد الأيام للبحث عن المدفوعات المعلقة */
  lookbackDays?: number;
  /** الحد الأقصى للمدفوعات المعالجة في الجلسة */
  limit?: number;
  /** Correlation ID للتتبع */
  correlationId?: string;
}

export interface ReconciliationResult {
  correlationId: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  dryRun: boolean;
  scanned: number;
  fixed: number;
  failed: number;
  skipped: number;
  errors: number;
  totalAmountReconciled: number;
  currency: string;
  details: ReconciliationDetail[];
}

export interface ReconciliationDetail {
  paymentId: number;
  bookingId: number;
  stripePaymentIntentId: string | null;
  previousStatus: string;
  newStatus: string;
  amount: number;
  currency: string;
  action: string;
  error?: string;
}

// ============================================================================
// Logger - Structured JSON
// ============================================================================

interface LogContext {
  correlationId: string;
  paymentId?: number;
  bookingId?: number;
  stripePaymentIntentId?: string;
  [key: string]: unknown;
}

function log(
  level: "info" | "warn" | "error",
  message: string,
  context: LogContext
) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    service: "stripe-reconciliation",
    message,
    ...context,
  };

  if (level === "error") {
    console.error(JSON.stringify(logEntry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.info(JSON.stringify(logEntry));
  }
}

// ============================================================================
// Stripe Client
// ============================================================================

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required for reconciliation");
  }
  return createStripeClient(secretKey);
}

// ============================================================================
// Main Reconciliation Function
// ============================================================================

/**
 * تشغيل عملية التسوية
 *
 * ✅ تبدأ من جدول payments (وليس bookings) للأسباب التالية:
 * 1. قد توجد bookings بدون payment intent
 * 2. قد يكون payment تم معالجته سابقاً
 * 3. أكثر دقة في تتبع المعاملات المالية
 */
export async function runStripeReconciliation(
  options: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  const {
    dryRun = false,
    lookbackDays = 7,
    limit = 200,
    correlationId = `recon_${nanoid(12)}`,
  } = options;

  const startedAt = new Date();
  const details: ReconciliationDetail[] = [];

  let scanned = 0;
  let fixed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let totalAmountReconciled = 0;

  log("info", "Starting reconciliation", {
    correlationId,
    dryRun,
    lookbackDays,
    limit,
  });

  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const stripe = getStripeClient();

  // ========================================
  // 1. جلب المدفوعات المعلقة من جدول payments
  // ✅ تم التغيير: نبدأ من payments وليس bookings
  // ========================================

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  const pendingPayments = await db
    .select({
      paymentId: payments.id,
      bookingId: payments.bookingId,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      paymentStatus: payments.status,
      paymentAmount: payments.amount,
      paymentCurrency: payments.currency,
      bookingStatus: bookings.status,
      bookingTotal: bookings.totalAmount,
      bookingPaymentStatus: bookings.paymentStatus,
      bookingUserId: bookings.userId,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(payments.provider, "stripe"),
        eq(payments.status, "pending"),
        isNotNull(payments.stripePaymentIntentId),
        sql`${payments.createdAt} >= ${cutoffDate}`,
        // requires_payment_method is also the state of an intent the
        // customer is still paying; leave anything younger than the
        // checkout session lifetime alone.
        sql`${payments.createdAt} < ${new Date(Date.now() - 32 * 60 * 1000)}`
      )
    )
    .limit(limit);

  scanned = pendingPayments.length;

  log("info", `Found ${scanned} pending payments to reconcile`, {
    correlationId,
    count: scanned,
  });

  // ========================================
  // 2. معالجة كل payment
  // ========================================

  for (const payment of pendingPayments) {
    const paymentContext: LogContext = {
      correlationId,
      paymentId: payment.paymentId,
      bookingId: payment.bookingId,
      stripePaymentIntentId: payment.stripePaymentIntentId || undefined,
    };

    try {
      if (!payment.stripePaymentIntentId) {
        log("warn", "Payment has no Stripe Payment Intent ID", paymentContext);
        skipped++;
        details.push({
          paymentId: payment.paymentId,
          bookingId: payment.bookingId,
          stripePaymentIntentId: null,
          previousStatus: payment.paymentStatus,
          newStatus: payment.paymentStatus,
          amount: Number(payment.paymentAmount),
          currency: payment.paymentCurrency || "SAR",
          action: "SKIPPED - No Stripe Payment Intent ID",
        });
        continue;
      }

      // ========================================
      // 3. جلب حالة الدفع من Stripe
      // ========================================

      log("info", "Fetching payment intent from Stripe", paymentContext);

      const pi = await stripe.paymentIntents.retrieve(
        payment.stripePaymentIntentId,
        { expand: ["latest_charge"] }
      );

      log("info", `Stripe status: ${pi.status}`, {
        ...paymentContext,
        stripeStatus: pi.status,
        stripeAmount: pi.amount,
      });

      // ========================================
      // 4. معالجة حسب الحالة
      // ========================================

      switch (pi.status) {
        case "succeeded":
          if (
            pi.id !== payment.stripePaymentIntentId ||
            pi.currency.toUpperCase() !==
              payment.paymentCurrency.toUpperCase() ||
            (pi.metadata?.bookingId &&
              pi.metadata.bookingId !== String(payment.bookingId)) ||
            (pi.metadata?.userId &&
              pi.metadata.userId !== String(payment.bookingUserId)) ||
            (pi.metadata?.type && pi.metadata.type !== "booking")
          )
            throw new Error("Payment intent identity/currency mismatch");
          assertCollectedAmount(
            pi.amount_received,
            Number(payment.paymentAmount),
            pi.currency
          );
          assertCollectedAmount(
            pi.amount_received,
            payment.bookingTotal,
            pi.currency
          );
          if (
            await handleSucceeded(
              db,
              payment,
              pi,
              dryRun,
              correlationId,
              details
            )
          ) {
            fixed++;
            totalAmountReconciled += Number(payment.paymentAmount);
          } else {
            skipped++;
          }
          break;

        case "canceled":
          await handleFailed(db, payment, pi, dryRun, correlationId, details);
          if (!dryRun) {
            failed++;
          } else {
            skipped++;
          }
          break;

        case "requires_payment_method":
        case "processing":
        case "requires_action":
        case "requires_confirmation":
          log("info", "Payment still processing, skipping", {
            ...paymentContext,
            stripeStatus: pi.status,
          });
          skipped++;
          details.push({
            paymentId: payment.paymentId,
            bookingId: payment.bookingId,
            stripePaymentIntentId: payment.stripePaymentIntentId,
            previousStatus: payment.paymentStatus,
            newStatus: payment.paymentStatus,
            amount: Number(payment.paymentAmount),
            currency: payment.paymentCurrency || "SAR",
            action: `NO_CHANGE (Stripe status: ${pi.status})`,
          });
          break;

        default:
          skipped++;
          details.push({
            paymentId: payment.paymentId,
            bookingId: payment.bookingId,
            stripePaymentIntentId: payment.stripePaymentIntentId,
            previousStatus: payment.paymentStatus,
            newStatus: payment.paymentStatus,
            amount: Number(payment.paymentAmount),
            currency: payment.paymentCurrency || "SAR",
            action: `UNKNOWN_STATUS (${pi.status})`,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      log("error", `Error reconciling payment: ${errorMessage}`, {
        ...paymentContext,
        error: errorMessage,
      });

      errors++;
      details.push({
        paymentId: payment.paymentId,
        bookingId: payment.bookingId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        previousStatus: payment.paymentStatus,
        newStatus: payment.paymentStatus,
        amount: Number(payment.paymentAmount),
        currency: payment.paymentCurrency || "SAR",
        action: "ERROR",
        error: errorMessage,
      });
    }
  }

  // ========================================
  // 5. إنشاء التقرير النهائي
  // ========================================

  const completedAt = new Date();
  const result: ReconciliationResult = {
    correlationId,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    dryRun,
    scanned,
    fixed,
    failed,
    skipped,
    errors,
    totalAmountReconciled,
    currency: "SAR",
    details,
  };

  log("info", "Reconciliation completed", {
    correlationId,
    durationMs: result.durationMs,
    scanned,
    fixed,
    failed,
    skipped,
    errors,
    totalAmountReconciled,
  });

  return result;
}

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Handle succeeded payment - update booking to confirmed and create ledger entry
 * ✅ يتحقق من وجود قيد مالي سابق قبل الإنشاء
 */
async function handleSucceeded(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  payment: {
    paymentId: number;
    bookingId: number;
    bookingUserId: number;
    stripePaymentIntentId: string | null;
    paymentStatus: string;
    paymentAmount: string | number;
    paymentCurrency: string | null;
  },
  pi: Stripe.PaymentIntent,
  dryRun: boolean,
  correlationId: string,
  details: ReconciliationDetail[]
): Promise<boolean> {
  if (dryRun) {
    log("info", "[DRY RUN] Would confirm payment", {
      correlationId,
      paymentId: payment.paymentId,
    });
    details.push({
      paymentId: payment.paymentId,
      bookingId: payment.bookingId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      previousStatus: payment.paymentStatus,
      newStatus: "completed",
      amount: Number(payment.paymentAmount),
      currency: payment.paymentCurrency || "SAR",
      action: "[DRY RUN] WOULD_CONFIRM + LEDGER",
    });
    return false;
  }

  let observedStatus = payment.paymentStatus;
  let action = "MANUAL_REVIEW_LEGACY_MISSING_RECEIPT";
  const settled = await db.transaction(async tx => {
    // Serialize with webhook settlement before checking the ledger or the
    // payment snapshot. Both can change while Stripe is being contacted.
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .for("update");
    if (!booking || booking.userId !== payment.bookingUserId)
      throw new Error("Booking identity changed during reconciliation");
    assertCollectedAmount(pi.amount_received, booking.totalAmount, pi.currency);
    if (
      booking.paymentStatus === "paid" &&
      booking.stripePaymentIntentId === pi.id
    ) {
      const [receipt] = await tx
        .select()
        .from(paymentReceipts)
        .where(eq(paymentReceipts.paymentIntentId, pi.id))
        .limit(1);
      // Legacy paid bookings have no verified refund baseline. Preserve their
      // history for explicit repair; a settlement no-op is not a reconciliation.
      if (!receipt) return false;
    }
    // Provider observations enter the same transaction owner as webhooks.
    // It records the receipt, payment history, ledger and confirmation together.
    await settleVerifiedPayment(tx, {
      paymentIntentId: pi.id,
      amount: pi.amount_received,
      currency: pi.currency,
      metadata: {
        ...pi.metadata,
        type: "booking",
        bookingId: String(booking.id),
        userId: String(booking.userId),
      },
      eventId: `reconciliation:${pi.id}`,
    });
    // A matching receipt can short-circuit canonical settlement. Verify the
    // selected history row with a current locking read before claiming repair.
    const [history] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, payment.paymentId))
      .for("update");
    if (
      !history ||
      history.bookingId !== booking.id ||
      history.provider !== "stripe" ||
      history.stripePaymentIntentId !== pi.id ||
      history.amount !== pi.amount_received ||
      history.currency.toUpperCase() !== pi.currency.toUpperCase()
    )
      throw new Error("Payment history identity changed during reconciliation");
    observedStatus = history.status;
    if (history.status !== "completed") {
      action = "MANUAL_REVIEW_PAYMENT_HISTORY";
      return false;
    }
    action = "SETTLE_VERIFIED_PAYMENT";
    return true;
  });

  details.push({
    paymentId: payment.paymentId,
    bookingId: payment.bookingId,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    previousStatus: payment.paymentStatus,
    newStatus: observedStatus,
    amount: Number(payment.paymentAmount),
    currency: payment.paymentCurrency || "SAR",
    action,
  });
  return settled;
}

/**
 * Handle failed/canceled payment
 */
async function handleFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  payment: {
    paymentId: number;
    bookingId: number;
    stripePaymentIntentId: string | null;
    paymentStatus: string;
    paymentAmount: string | number;
    paymentCurrency: string | null;
  },
  pi: Stripe.PaymentIntent,
  dryRun: boolean,
  correlationId: string,
  details: ReconciliationDetail[]
): Promise<void> {
  if (dryRun) {
    log("info", "[DRY RUN] Would mark payment as failed", {
      correlationId,
      paymentId: payment.paymentId,
    });
    details.push({
      paymentId: payment.paymentId,
      bookingId: payment.bookingId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      previousStatus: payment.paymentStatus,
      newStatus: "failed",
      amount: Number(payment.paymentAmount),
      currency: payment.paymentCurrency || "SAR",
      action: `[DRY RUN] WOULD_MARK_FAILED (Stripe: ${pi.status})`,
    });
    return;
  }

  await db.transaction(async tx => {
    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.id, payment.paymentId),
          eq(payments.status, "pending"),
          eq(payments.stripePaymentIntentId, pi.id)
        )
      );
    // A cancelled intent ends this attempt. Booking expiry and inventory
    // release belong to the booking lifecycle; another attempt may be open.
  });

  details.push({
    paymentId: payment.paymentId,
    bookingId: payment.bookingId,
    stripePaymentIntentId: payment.stripePaymentIntentId,
    previousStatus: payment.paymentStatus,
    newStatus: "failed",
    amount: Number(payment.paymentAmount),
    currency: payment.paymentCurrency || "SAR",
    action: `MARK_FAILED (Stripe: ${pi.status})`,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * تشغيل التسوية في وضع Dry Run
 */
export function runReconciliationDryRun(
  options: Omit<ReconciliationOptions, "dryRun"> = {}
): Promise<ReconciliationResult> {
  return runStripeReconciliation({ ...options, dryRun: true });
}

/**
 * Get reconciliation statistics for monitoring
 */
export async function getReconciliationStats(): Promise<{
  pendingPayments: number;
  lastReconciliationAt: Date | null;
}> {
  const db = await getDb();
  if (!db) {
    return { pendingPayments: 0, lastReconciliationAt: null };
  }

  const pending = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(payments)
    .where(
      and(
        eq(payments.provider, "stripe"),
        eq(payments.status, "pending"),
        isNotNull(payments.stripePaymentIntentId)
      )
    );

  return {
    pendingPayments: pending[0]?.count ?? 0,
    lastReconciliationAt: null,
  };
}
