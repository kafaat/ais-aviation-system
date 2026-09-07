/**
 * Legacy /webhooks router kept as a thin compatibility wrapper.
 * All Stripe processing is delegated to the canonical handler used by
 * /api/stripe/webhook so there is only one financial state machine.
 */

import express, { Request, Response, Router } from "express";
import { handleStripeWebhook } from "../webhooks/stripe";

const router: Router = express.Router();

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "webhooks",
    timestamp: new Date().toISOString(),
  });
});

export default router;
