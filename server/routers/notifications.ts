import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as notificationService from "../services/notification.service";

/**
 * Notifications Router
 * Handles in-app notification operations
 */
export const notificationsRouter = router({
  /**
   * Get user's notifications with optional filtering and pagination
   */
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/notifications",
        tags: ["Notifications"],
        summary: "Get notifications",
        description:
          "Retrieve the authenticated user's notifications with optional filtering by type and read status.",
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
          .describe("Maximum notifications to return"),
        offset: z
          .number()
          .min(0)
          .default(0)
          .describe("Number of notifications to skip"),
        type: z
          .enum(["booking", "flight", "payment", "promo", "system"])
          .optional()
          .describe("Filter by notification type"),
        unreadOnly: z
          .boolean()
          .default(false)
          .describe("Only return unread notifications"),
      })
    )
    .query(async ({ ctx, input }) => {
      return await notificationService.getUserNotifications(ctx.user.id, input);
    }),

  /**
   * Get unread notification count
   */
  unreadCount: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/notifications/unread-count",
        tags: ["Notifications"],
        summary: "Get unread count",
        description:
          "Get the count of unread notifications for the authenticated user.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await notificationService.getUnreadCount(ctx.user.id);
    }),

  /**
   * Mark a single notification as read
   */
  markAsRead: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/notifications/{id}/read",
        tags: ["Notifications"],
        summary: "Mark notification as read",
        description: "Mark a specific notification as read.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Notification ID to mark as read"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await notificationService.markAsRead(input.id, ctx.user.id);
    }),

  /**
   * Mark all notifications as read
   */
  markAllAsRead: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/notifications/read-all",
        tags: ["Notifications"],
        summary: "Mark all as read",
        description:
          "Mark all notifications as read for the authenticated user.",
        protect: true,
      },
    })
    .mutation(async ({ ctx }) => {
      return await notificationService.markAllAsRead(ctx.user.id);
    }),

  /**
   * Delete a notification
   */
  delete: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/notifications/{id}",
        tags: ["Notifications"],
        summary: "Delete notification",
        description: "Delete a specific notification.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Notification ID to delete"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await notificationService.deleteNotification(
        input.id,
        ctx.user.id
      );
    }),

  /**
   * Delete all notifications
   */
  deleteAll: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/notifications/all",
        tags: ["Notifications"],
        summary: "Delete all notifications",
        description: "Delete all notifications for the authenticated user.",
        protect: true,
      },
    })
    .mutation(async ({ ctx }) => {
      return await notificationService.deleteAllNotifications(ctx.user.id);
    }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Create a notification for a specific user (admin only)
   */
  create: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/notifications",
        tags: ["Notifications", "Admin"],
        summary: "Create notification",
        description:
          "Admin endpoint to create a notification for a specific user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID to send notification to"),
        type: z
          .enum(["booking", "flight", "payment", "promo", "system"])
          .describe("Notification type"),
        title: z.string().min(1).max(255).describe("Notification title"),
        message: z.string().min(1).max(2000).describe("Notification message"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Additional data (JSON)"),
      })
    )
    .mutation(async ({ input }) => {
      return await notificationService.createNotification(
        input.userId,
        input.type,
        input.title,
        input.message,
        input.data
          ? (input.data as notificationService.NotificationData)
          : undefined
      );
    }),

  /**
   * Create bulk notifications for multiple users (admin only)
   */
  createBulk: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/notifications/bulk",
        tags: ["Notifications", "Admin"],
        summary: "Create bulk notifications",
        description:
          "Admin endpoint to create notifications for multiple users at once.",
        protect: true,
      },
    })
    .input(
      z.object({
        userIds: z
          .array(z.number())
          .min(1)
          .max(1000)
          .describe("Array of user IDs"),
        type: z
          .enum(["booking", "flight", "payment", "promo", "system"])
          .describe("Notification type"),
        title: z.string().min(1).max(255).describe("Notification title"),
        message: z.string().min(1).max(2000).describe("Notification message"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Additional data (JSON)"),
      })
    )
    .mutation(async ({ input }) => {
      return await notificationService.createBulkNotifications(
        input.userIds,
        input.type,
        input.title,
        input.message,
        input.data
          ? (input.data as notificationService.NotificationData)
          : undefined
      );
    }),

  /**
   * Get notifications for a specific user (admin only)
   */
  getUserNotifications: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/notifications/users/{userId}",
        tags: ["Notifications", "Admin"],
        summary: "Get user notifications",
        description: "Admin endpoint to retrieve notifications for any user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
        limit: z.number().min(1).max(100).optional().default(20),
        offset: z.number().min(0).optional().default(0),
      })
    )
    .query(async ({ input }) => {
      return await notificationService.getUserNotifications(input.userId, {
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Cleanup old notifications (admin only)
   */
  cleanup: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/notifications/cleanup",
        tags: ["Notifications", "Admin"],
        summary: "Cleanup old notifications",
        description:
          "Admin endpoint to remove old read notifications. Normally runs automatically on schedule.",
        protect: true,
      },
    })
    .input(
      z.object({
        daysOld: z
          .number()
          .min(1)
          .max(365)
          .default(30)
          .describe("Delete read notifications older than this many days"),
      })
    )
    .mutation(async ({ input }) => {
      return await notificationService.cleanupOldNotifications(input.daysOld);
    }),
});
