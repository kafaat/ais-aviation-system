import Stripe from "stripe";
import { TRPCError } from "@trpc/server";

/**
 * Payment Security Service
 * Implements security best practices for payment processing
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-12-18.acacia",
});

/**
 * Verify Stripe webhook signature
 * Prevents webhook spoofing and replay attacks
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.error("[Payment Security] Webhook signature verification failed:", error);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid webhook signature",
    });
  }
}

/**
 * Idempotency key management
 * Prevents duplicate payment processing
 */
const processedIdempotencyKeys = new Map<string, {
  result: any;
  timestamp: number;
}>();

// Clean up old keys every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [key, value] of processedIdempotencyKeys.entries()) {
    if (value.timestamp < oneHourAgo) {
      processedIdempotencyKeys.delete(key);
    }
  }
}, 60 * 60 * 1000);

/**
 * Check if idempotency key was already processed
 */
export function checkIdempotencyKey(key: string): { processed: boolean; result?: any } {
  const cached = processedIdempotencyKeys.get(key);
  if (cached) {
    return { processed: true, result: cached.result };
  }
  return { processed: false };
}

/**
 * Store idempotency key result
 */
export function storeIdempotencyKey(key: string, result: any): void {
  processedIdempotencyKeys.set(key, {
    result,
    timestamp: Date.now(),
  });
}

/**
 * Validate payment amount matches booking
 * Prevents amount tampering
 */
export function validatePaymentAmount(
  receivedAmount: number,
  expectedAmount: number,
  currency: string = "usd"
): boolean {
  // Amount must match exactly (Stripe uses smallest currency unit)
  if (receivedAmount !== expectedAmount) {
    console.error(
      `[Payment Security] Amount mismatch: received ${receivedAmount} ${currency}, expected ${expectedAmount} ${currency}`
    );
    return false;
  }
  return true;
}

/**
 * Validate currency matches booking
 */
export function validateCurrency(
  receivedCurrency: string,
  expectedCurrency: string = "usd"
): boolean {
  if (receivedCurrency.toLowerCase() !== expectedCurrency.toLowerCase()) {
    console.error(
      `[Payment Security] Currency mismatch: received ${receivedCurrency}, expected ${expectedCurrency}`
    );
    return false;
  }
  return true;
}

/**
 * Create payment intent with idempotency key
 */
export async function createPaymentIntent(
  amount: number,
  currency: string,
  metadata: Record<string, string>,
  idempotencyKey: string
): Promise<Stripe.PaymentIntent> {
  try {
    // Check if already processed
    const { processed, result } = checkIdempotencyKey(idempotencyKey);
    if (processed) {
      console.log(`[Payment Security] Returning cached result for idempotency key: ${idempotencyKey}`);
      return result;
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      },
      {
        idempotencyKey,
      }
    );

    // Store result
    storeIdempotencyKey(idempotencyKey, paymentIntent);

    return paymentIntent;
  } catch (error) {
    console.error("[Payment Security] Failed to create payment intent:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create payment intent",
    });
  }
}

/**
 * Verify payment intent belongs to user
 */
export async function verifyPaymentIntentOwnership(
  paymentIntentId: string,
  userId: number
): Promise<boolean> {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // Check if metadata contains correct user ID
    const metadataUserId = paymentIntent.metadata?.userId;
    if (!metadataUserId || parseInt(metadataUserId) !== userId) {
      console.error(
        `[Payment Security] Payment intent ownership mismatch: expected user ${userId}, found ${metadataUserId}`
      );
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("[Payment Security] Failed to verify payment intent ownership:", error);
    return false;
  }
}

/**
 * Calculate hash for webhook event deduplication
 */
export function calculateEventHash(event: Stripe.Event): string {
  const crypto = require("crypto");
  const data = JSON.stringify({
    id: event.id,
    type: event.type,
    created: event.created,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Track processed webhook events to prevent duplicate processing
 */
const processedWebhookEvents = new Map<string, number>();

// Clean up old events every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [eventId, timestamp] of processedWebhookEvents.entries()) {
    if (timestamp < oneHourAgo) {
      processedWebhookEvents.delete(eventId);
    }
  }
}, 60 * 60 * 1000);

/**
 * Check if webhook event was already processed
 */
export function isWebhookEventProcessed(eventId: string): boolean {
  return processedWebhookEvents.has(eventId);
}

/**
 * Mark webhook event as processed
 */
export function markWebhookEventProcessed(eventId: string): void {
  processedWebhookEvents.set(eventId, Date.now());
}
