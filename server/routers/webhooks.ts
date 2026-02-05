import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  verifyWebhookSignature,
  isEventProcessed,
  storeStripeEvent,
  processStripeEvent,
} from "../services/stripe-webhook.service";
import { logger } from "../_core/logger";

/**
 * Webhooks Router
 * Handles incoming webhooks from external services (Stripe, etc.)
 */
export const webhooksRouter = router({
  /**
   * Stripe webhook endpoint
   * Receives and processes Stripe events
   */
  stripe: publicProcedure
    .input(
      z.object({
        body: z.string(), // Raw request body
        signature: z.string(), // Stripe-Signature header
      })
    )
    .mutation(async ({ input }) => {
      try {
        // 1. Verify webhook signature
        const event = verifyWebhookSignature(input.body, input.signature);

        logger.info(
          {
            eventId: event.id,
            type: event.type,
          },
          "Stripe webhook received"
        );

        // 2. Check for duplicate (de-duplication)
        const alreadyProcessed = await isEventProcessed(event.id);
        if (alreadyProcessed) {
          logger.info(
            {
              eventId: event.id,
            },
            "Stripe event already processed (duplicate)"
          );
          return {
            received: true,
            duplicate: true,
            eventId: event.id,
          };
        }

        // 3. Store event for audit
        await storeStripeEvent(event);

        // 4. Process event
        await processStripeEvent(event);

        logger.info(
          {
            eventId: event.id,
            type: event.type,
          },
          "Stripe event processed successfully"
        );

        return {
          received: true,
          duplicate: false,
          eventId: event.id,
        };
      } catch (error) {
        logger.error(
          {
            error,
            signature: input.signature.substring(0, 20) + "...",
          },
          "Error processing Stripe webhook"
        );

        // Return 500 to trigger Stripe retry
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to process webhook",
        });
      }
    }),

  /**
   * Test endpoint for webhook verification
   */
  test: publicProcedure.query(() => {
    return {
      status: "ok",
      message: "Webhook endpoint is reachable",
      timestamp: new Date().toISOString(),
    };
  }),
});
