// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  create: z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    originId: outputNumber,
    destinationId: outputNumber,
    userId: outputNumber,
    targetPrice: outputNumber,
    id: outputNumber,
    cabinClass: z
      .union([z.undefined(), z.literal("economy"), z.literal("business")])
      .optional(),
    currentPrice: z.union([z.undefined(), z.null(), outputNumber]).optional(),
    isActive: z
      .union([z.undefined(), z.literal(false), z.literal(true)])
      .optional(),
    lastChecked: z.union([z.undefined(), z.null(), z.date()]).optional(),
    notifiedAt: z.union([z.undefined(), z.null(), z.date()]).optional(),
  }),
  getAll: z.array(
    z.object({
      alert: z.object({
        id: outputNumber,
        userId: outputNumber,
        originId: outputNumber,
        destinationId: outputNumber,
        targetPrice: outputNumber,
        currentPrice: z.union([z.null(), outputNumber]),
        isActive: z.boolean(),
        lastChecked: z.union([z.null(), z.date()]),
        notifiedAt: z.union([z.null(), z.date()]),
        cabinClass: z.enum(["economy", "business"]),
        createdAt: z.date(),
        updatedAt: z.date(),
      }),
      origin: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        city: z.string(),
        country: z.string(),
      }),
      destination: z.object({
        id: outputNumber,
        code: z.string(),
        name: z.string(),
        city: z.string(),
        country: z.string(),
      }),
    })
  ),
  getById: z.object({
    alert: z.object({
      id: outputNumber,
      userId: outputNumber,
      originId: outputNumber,
      destinationId: outputNumber,
      targetPrice: outputNumber,
      currentPrice: z.union([z.null(), outputNumber]),
      isActive: z.boolean(),
      lastChecked: z.union([z.null(), z.date()]),
      notifiedAt: z.union([z.null(), z.date()]),
      cabinClass: z.enum(["economy", "business"]),
      createdAt: z.date(),
      updatedAt: z.date(),
    }),
    origin: z.object({
      id: outputNumber,
      code: z.string(),
      name: z.string(),
      city: z.string(),
      country: z.string(),
    }),
    destination: z.object({
      id: outputNumber,
      code: z.string(),
      name: z.string(),
      city: z.string(),
      country: z.string(),
    }),
  }),
  delete: z.object({ success: z.boolean() }),
  toggle: z.object({ success: z.boolean(), isActive: z.boolean() }),
  updatePrice: z.object({ success: z.boolean() }),
  checkAlerts: z.object({
    totalChecked: outputNumber,
    alertsTriggered: outputNumber,
    alerts: z.array(
      z.object({
        alertId: outputNumber,
        userId: outputNumber,
        originId: outputNumber,
        destinationId: outputNumber,
        targetPrice: outputNumber,
        currentPrice: outputNumber,
        previousPrice: z.union([z.null(), outputNumber]),
      })
    ),
  }),
};
