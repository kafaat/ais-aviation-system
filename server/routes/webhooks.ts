/**
 * Webhook Routes - Express Raw Body Handler
 *
 * IMPORTANT: This route must be mounted BEFORE express.json()
 * to preserve raw body for Stripe signature verification.
 *
 * @version 2.0.0
 * @date 2026-01-26
 */

import express, { Request, Response, Router } from "express";
import { stripeWebhookServiceV2 } from "../services/stripe-webhook-v2.service";
import { getCorrelationId } from "../_core/correlation";

const router: Router = express.Router();

/**
 * Stripe Webhook Endpoint
 *
 * POST /webhooks/stripe
 *
 * IMPORTANT: Must use express.raw() middleware
 * to preserve raw body for signature verification.
 *
 * Response codes:
 * - 200: Event processed successfully (Stripe stops retrying)
 * - 400: Invalid signature (Stripe stops retrying)
 * - 500: Processing error (Stripe will retry)
 */
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const correlationId =
      getCorrelationId() || req.headers["x-correlation-id"] || "unknown";
    const signature = req.header("Stripe-Signature");

    console.log(`[Webhook] Received request (correlationId: ${correlationId})`);

    // Validate signature header
    if (!signature) {
      console.error(`[Webhook] Missing Stripe-Signature header`);
      return res.status(400).json({
        error: {
          code: "MISSING_SIGNATURE",
          message: "Missing Stripe-Signature header",
          correlationId,
          retryable: false,
        },
      });
    }

    // Validate raw body
    if (!req.body || !(req.body instanceof Buffer)) {
      console.error(`[Webhook] Invalid body format (not Buffer)`);
      return res.status(400).json({
        error: {
          code: "INVALID_BODY",
          message: "Request body must be raw Buffer",
          correlationId,
          retryable: false,
        },
      });
    }

    try {
      await stripeWebhookServiceV2.handleRawWebhook({
        rawBody: req.body,
        signature,
      });

      // Return 200 to stop Stripe retries
      return res.status(200).json({
        received: true,
        correlationId,
      });
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      console.error(`[Webhook] Error:`, msg);

      // Return 400 for signature errors (don't retry)
      if (
        msg.toLowerCase().includes("signature") ||
        msg.toLowerCase().includes("webhook secret")
      ) {
        return res.status(400).json({
          error: {
            code: "SIGNATURE_ERROR",
            message: `Webhook signature error: ${msg}`,
            correlationId,
            retryable: false,
          },
        });
      }

      // Return 500 for processing errors (Stripe will retry)
      return res.status(500).json({
        error: {
          code: "PROCESSING_ERROR",
          message: "Webhook processing error",
          correlationId,
          retryable: true,
        },
      });
    }
  }
);

/**
 * Health check for webhooks
 *
 * GET /webhooks/health
 */
router.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "webhooks",
    timestamp: new Date().toISOString(),
  });
});

export default router;
