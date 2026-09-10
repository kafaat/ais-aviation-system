// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getMyLogs: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["pending", "failed", "rejected", "sent", "delivered"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      type: z.enum([
        "system",
        "booking_confirmation",
        "flight_reminder",
        "flight_status",
        "boarding_pass",
        "check_in_reminder",
        "payment_received",
        "refund_processed",
        "loyalty_update",
        "promotional",
      ]),
      message: z.string(),
      flightId: z.union([z.null(), outputNumber]),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.null(), outputNumber]),
      provider: z.string(),
      phoneNumber: z.string(),
      sentAt: z.union([z.null(), z.date()]),
      templateId: z.union([z.null(), z.string()]),
      providerMessageId: z.union([z.null(), z.string()]),
      errorMessage: z.union([z.null(), z.string()]),
      retryCount: outputNumber,
      deliveredAt: z.union([z.null(), z.date()]),
    })
  ),
  getPreferences: z.object({
    smsNotifications: z.boolean(),
    phoneNumber: z.union([z.null(), z.string()]),
  }),
  listLogs: z.object({
    logs: z.array(
      z.object({
        id: outputNumber,
        status: z.enum(["pending", "failed", "rejected", "sent", "delivered"]),
        createdAt: z.date(),
        updatedAt: z.date(),
        type: z.enum([
          "system",
          "booking_confirmation",
          "flight_reminder",
          "flight_status",
          "boarding_pass",
          "check_in_reminder",
          "payment_received",
          "refund_processed",
          "loyalty_update",
          "promotional",
        ]),
        message: z.string(),
        flightId: z.union([z.null(), outputNumber]),
        bookingId: z.union([z.null(), outputNumber]),
        userId: z.union([z.null(), outputNumber]),
        provider: z.string(),
        phoneNumber: z.string(),
        sentAt: z.union([z.null(), z.date()]),
        templateId: z.union([z.null(), z.string()]),
        providerMessageId: z.union([z.null(), z.string()]),
        errorMessage: z.union([z.null(), z.string()]),
        retryCount: outputNumber,
        deliveredAt: z.union([z.null(), z.date()]),
      })
    ),
    total: outputNumber,
  }),
  getStats: z.object({
    totalSent: outputNumber,
    totalFailed: outputNumber,
    totalPending: outputNumber,
    byType: z.record(z.string(), outputNumber),
    byProvider: z.record(z.string(), outputNumber),
    todaySent: outputNumber,
  }),
  sendTest: z.object({
    success: z.boolean(),
    messageId: z.union([z.undefined(), z.string()]),
    error: z.union([z.undefined(), z.string()]),
  }),
  resend: z.object({
    success: z.boolean(),
    messageId: z.union([z.undefined(), z.string()]),
    error: z.union([z.undefined(), z.string()]),
  }),
  sendBulk: z.object({
    sent: outputNumber,
    failed: outputNumber,
    results: z.array(
      z.object({
        success: z.boolean(),
        messageId: z.union([z.undefined(), z.string()]).optional(),
        error: z.union([z.undefined(), z.string()]).optional(),
      })
    ),
  }),
  getUserLogs: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["pending", "failed", "rejected", "sent", "delivered"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      type: z.enum([
        "system",
        "booking_confirmation",
        "flight_reminder",
        "flight_status",
        "boarding_pass",
        "check_in_reminder",
        "payment_received",
        "refund_processed",
        "loyalty_update",
        "promotional",
      ]),
      message: z.string(),
      flightId: z.union([z.null(), outputNumber]),
      bookingId: z.union([z.null(), outputNumber]),
      userId: z.union([z.null(), outputNumber]),
      provider: z.string(),
      phoneNumber: z.string(),
      sentAt: z.union([z.null(), z.date()]),
      templateId: z.union([z.null(), z.string()]),
      providerMessageId: z.union([z.null(), z.string()]),
      errorMessage: z.union([z.null(), z.string()]),
      retryCount: outputNumber,
      deliveredAt: z.union([z.null(), z.date()]),
    })
  ),
  getTemplates: z.array(
    z.object({
      id: z.string(),
      nameAr: z.string(),
      nameEn: z.string(),
      bodyAr: z.string(),
      bodyEn: z.string(),
    })
  ),
  sendTemplated: z.object({
    success: z.boolean(),
    messageId: z.union([z.undefined(), z.string()]),
    error: z.union([z.undefined(), z.string()]),
  }),
};
