import { responseContracts } from "../contracts/webhooks";
import { router, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { handleStripeWebhook } from "../webhooks/stripe";

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
    .output(responseContracts["stripe"])
    .mutation(async ({ input, ctx }) => {
      // Preserve the signed raw body. This compatibility transport delegates all
      // verification, event claiming and financial writes to the HTTP authority.
      const request: Request = Object.create(ctx.req, {
        headers: {
          value: { ...ctx.req.headers, "stripe-signature": input.signature },
        },
        body: { value: Buffer.from(input.body, "utf8") },
      });
      let statusCode = 200;
      let payload: Record<string, unknown> = {};
      const response = {
        status(code: number): Response {
          statusCode = code;
          return response as Response;
        },
        json(body: Record<string, unknown>): Response {
          payload = body;
          return response as Response;
        },
      };
      await handleStripeWebhook(request, response as Response);
      if (statusCode !== 200 || payload.received !== true)
        throw new TRPCError({
          code: statusCode === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR",
          message: "Webhook verification or processing failed",
        });
      const event = z.object({ id: z.string() }).parse(JSON.parse(input.body));
      return {
        received: true,
        duplicate: payload.deduplicated === true,
        eventId: event.id,
      };
    }),

  /**
   * Test endpoint for webhook verification
   */
  test: publicProcedure.output(responseContracts["test"]).query(() => {
    return {
      status: "ok",
      message: "Webhook endpoint is reachable",
      timestamp: new Date().toISOString(),
    };
  }),
});
