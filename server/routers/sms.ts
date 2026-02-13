import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as smsService from "../services/sms.service";
import { getUserPreferences } from "../services/user-preferences.service";

/**
 * SMS Router
 * Handles SMS notification operations
 */
export const smsRouter = router({
  // ============================================================================
  // User Endpoints
  // ============================================================================

  /**
   * Get user's SMS logs
   */
  getMyLogs: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/sms/logs",
        tags: ["SMS"],
        summary: "Get my SMS logs",
        description:
          "Retrieve the authenticated user's SMS notification history.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z
          .number()
          .min(1)
          .max(100)
          .default(20)
          .describe("Maximum logs to return"),
        offset: z.number().min(0).default(0).describe("Number of logs to skip"),
        type: z
          .enum([
            "booking_confirmation",
            "flight_reminder",
            "flight_status",
            "boarding_pass",
            "check_in_reminder",
            "payment_received",
            "refund_processed",
            "loyalty_update",
            "promotional",
            "system",
          ])
          .optional()
          .describe("Filter by SMS type"),
        status: z
          .enum(["pending", "sent", "delivered", "failed", "rejected"])
          .optional()
          .describe("Filter by status"),
      })
    )
    .query(async ({ ctx, input }) => {
      return await smsService.getSMSLogs(ctx.user.id, input);
    }),

  /**
   * Check if user has SMS notifications enabled
   */
  getPreferences: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/sms/preferences",
        tags: ["SMS"],
        summary: "Get SMS preferences",
        description: "Get the user's SMS notification preferences.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      const prefs = await getUserPreferences(ctx.user.id);
      return {
        smsNotifications: prefs?.smsNotifications ?? false,
        phoneNumber: prefs?.phoneNumber ?? null,
      };
    }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Get all SMS logs (admin only)
   */
  listLogs: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/sms/logs",
        tags: ["SMS", "Admin"],
        summary: "List all SMS logs",
        description: "Admin endpoint to retrieve all SMS logs with filtering.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        type: z
          .enum([
            "booking_confirmation",
            "flight_reminder",
            "flight_status",
            "boarding_pass",
            "check_in_reminder",
            "payment_received",
            "refund_processed",
            "loyalty_update",
            "promotional",
            "system",
          ])
          .optional(),
        status: z
          .enum(["pending", "sent", "delivered", "failed", "rejected"])
          .optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ input }) => {
      return await smsService.getAllSMSLogs({
        ...input,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });
    }),

  /**
   * Get SMS statistics (admin only)
   */
  getStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/sms/stats",
        tags: ["SMS", "Admin"],
        summary: "Get SMS statistics",
        description: "Admin endpoint to retrieve SMS sending statistics.",
        protect: true,
      },
    })
    .query(async () => {
      return await smsService.getSMSStats();
    }),

  /**
   * Send test SMS (admin only)
   */
  sendTest: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/sms/test",
        tags: ["SMS", "Admin"],
        summary: "Send test SMS",
        description: "Admin endpoint to send a test SMS message.",
        protect: true,
      },
    })
    .input(
      z.object({
        phoneNumber: z
          .string()
          .min(7)
          .max(20)
          .regex(/^\+?[\d\s\-()]+$/, "Invalid phone number format")
          .describe("Phone number to send test SMS to"),
        message: z
          .string()
          .min(1)
          .max(160)
          .default("This is a test SMS from AIS Aviation System.")
          .describe("Test message content"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await smsService.sendSMS(
        ctx.user.id,
        input.phoneNumber,
        input.message,
        "system"
      );
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      };
    }),

  /**
   * Resend a failed SMS (admin only)
   */
  resend: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/sms/{id}/resend",
        tags: ["SMS", "Admin"],
        summary: "Resend failed SMS",
        description: "Admin endpoint to resend a failed SMS message.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("SMS log ID to resend"),
      })
    )
    .mutation(async ({ input }) => {
      const result = await smsService.resendSMS(input.id);
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      };
    }),

  /**
   * Send bulk SMS (admin only)
   */
  sendBulk: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/sms/bulk",
        tags: ["SMS", "Admin"],
        summary: "Send bulk SMS",
        description: "Admin endpoint to send SMS to multiple recipients.",
        protect: true,
      },
    })
    .input(
      z.object({
        messages: z
          .array(
            z.object({
              userId: z.number().describe("User ID"),
              phoneNumber: z
                .string()
                .min(7)
                .max(20)
                .regex(/^\+?[\d\s\-()]+$/, "Invalid phone number format")
                .describe("Phone number"),
              body: z.string().min(1).max(160).describe("Message content"),
              bookingId: z.number().optional().describe("Related booking ID"),
            })
          )
          .min(1)
          .max(100)
          .describe("Array of messages to send"),
      })
    )
    .mutation(async ({ input }) => {
      return await smsService.sendBulkSMS(input.messages);
    }),

  /**
   * Get SMS logs for a specific user (admin only)
   */
  getUserLogs: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/sms/users/{userId}/logs",
        tags: ["SMS", "Admin"],
        summary: "Get user SMS logs",
        description: "Admin endpoint to retrieve SMS logs for a specific user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      return await smsService.getSMSLogs(input.userId, {
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Get available SMS templates (admin only)
   */
  getTemplates: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/sms/templates",
        tags: ["SMS", "Admin"],
        summary: "Get SMS templates",
        description: "Admin endpoint to retrieve all available SMS templates.",
        protect: true,
      },
    })
    .query(() => {
      return Object.values(smsService.SMS_TEMPLATES);
    }),

  /**
   * Send templated SMS (admin only)
   */
  sendTemplated: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/sms/send-templated",
        tags: ["SMS", "Admin"],
        summary: "Send templated SMS",
        description:
          "Admin endpoint to send an SMS using a predefined template.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID to send SMS to"),
        phoneNumber: z
          .string()
          .min(7)
          .max(20)
          .regex(/^\+?[\d\s\-()]+$/, "Invalid phone number format")
          .describe("Phone number"),
        templateId: z
          .enum([
            "booking_confirmation",
            "check_in_reminder",
            "flight_reminder",
            "flight_status",
            "boarding_pass",
            "payment_received",
            "refund_processed",
            "loyalty_milestone",
          ])
          .describe("Template ID to use"),
        variables: z
          .record(z.string(), z.string())
          .describe("Template variables"),
        language: z
          .enum(["ar", "en"])
          .default("ar")
          .describe("Message language"),
        bookingId: z.number().optional().describe("Related booking ID"),
        flightId: z.number().optional().describe("Related flight ID"),
      })
    )
    .mutation(async ({ input }) => {
      const result = await smsService.sendTemplatedSMS(
        input.userId,
        input.phoneNumber,
        input.templateId,
        input.variables,
        input.language,
        input.bookingId,
        input.flightId
      );
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      };
    }),
});
