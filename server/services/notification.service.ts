import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { notifications, users } from "../../drizzle/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { sendNotificationEmail } from "./email.service";

/**
 * Notification Service
 * Handles in-app notification operations
 */

/**
 * Notification types
 */
export type NotificationType =
  | "booking"
  | "flight"
  | "payment"
  | "promo"
  | "system";

/**
 * Options for fetching notifications
 */
export interface GetNotificationsOptions {
  limit?: number;
  offset?: number;
  type?: NotificationType;
  unreadOnly?: boolean;
}

/**
 * Notification data structure
 */
export interface NotificationData {
  bookingId?: number;
  bookingReference?: string;
  flightId?: number;
  flightNumber?: string;
  paymentId?: number;
  amount?: number;
  link?: string;
  [key: string]: unknown;
}

/**
 * Create a new notification for a user
 */
export async function createNotification(
  userId: number,
  type: NotificationType,
  title: string,
  message: string,
  data?: NotificationData
): Promise<{ id: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const [result] = await database.insert(notifications).values({
      userId,
      type,
      title,
      message,
      data: data ? JSON.stringify(data) : null,
      isRead: false,
    });

    const insertId = (result as any)?.insertId;

    if (insertId == null) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to retrieve notification ID after insert",
      });
    }

    console.info(
      `[Notification] Created notification ${insertId} for user ${userId}: ${type}`
    );

    // Send email for important notification types
    const emailNotificationTypes: NotificationType[] = [
      "booking",
      "flight",
      "promo",
    ];
    if (emailNotificationTypes.includes(type)) {
      try {
        const [user] = await database
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (user?.email) {
          await sendNotificationEmail(user.email, title, message);
          console.info(
            `[Notification] Email sent to ${user.email} for notification ${insertId}`
          );
        }
      } catch (emailError) {
        // Email failure should not break notification creation
        console.error(
          `[Notification] Failed to send email for notification ${insertId}:`,
          emailError
        );
      }
    }

    return { id: insertId };
  } catch (error) {
    console.error("Error creating notification:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create notification",
    });
  }
}

/**
 * Get notifications for a user with optional filtering and pagination
 */
export async function getUserNotifications(
  userId: number,
  options: GetNotificationsOptions = {}
) {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const { limit = 20, offset = 0, type, unreadOnly = false } = options;

    // Build conditions
    const conditions = [eq(notifications.userId, userId)];

    if (type) {
      conditions.push(eq(notifications.type, type));
    }

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    const results = await database
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    // Parse JSON data field
    return results.map(notification => {
      let parsedData = null;
      if (notification.data) {
        try {
          parsedData = JSON.parse(notification.data);
        } catch {
          parsedData = null;
        }
      }
      return { ...notification, data: parsedData };
    });
  } catch (error) {
    console.error("Error getting user notifications:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get notifications",
    });
  }
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(
  notificationId: number,
  userId: number
): Promise<{ success: boolean }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    // Verify notification belongs to user
    const [notification] = await database
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId)
        )
      )
      .limit(1);

    if (!notification) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Notification not found",
      });
    }

    if (notification.isRead) {
      return { success: true }; // Already read
    }

    await database
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(eq(notifications.id, notificationId));

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error marking notification as read:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to mark notification as read",
    });
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(
  userId: number
): Promise<{ count: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const result = await database
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      );

    const affectedRows = (result as any).affectedRows || 0;

    console.info(
      `[Notification] Marked ${affectedRows} notifications as read for user ${userId}`
    );

    return { count: affectedRows };
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to mark all notifications as read",
    });
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  notificationId: number,
  userId: number
): Promise<{ success: boolean }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    // Verify notification belongs to user
    const [notification] = await database
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId)
        )
      )
      .limit(1);

    if (!notification) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Notification not found",
      });
    }

    await database
      .delete(notifications)
      .where(eq(notifications.id, notificationId));

    console.info(
      `[Notification] Deleted notification ${notificationId} for user ${userId}`
    );

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error deleting notification:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete notification",
    });
  }
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(
  userId: number
): Promise<{ count: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const [result] = await database
      .select({ count: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      );

    return { count: result?.count ?? 0 };
  } catch (error) {
    console.error("Error getting unread count:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get unread count",
    });
  }
}

/**
 * Delete all notifications for a user (admin function or user-triggered cleanup)
 */
export async function deleteAllNotifications(
  userId: number
): Promise<{ count: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const result = await database
      .delete(notifications)
      .where(eq(notifications.userId, userId));

    const affectedRows = (result as any).affectedRows || 0;

    console.info(
      `[Notification] Deleted ${affectedRows} notifications for user ${userId}`
    );

    return { count: affectedRows };
  } catch (error) {
    console.error("Error deleting all notifications:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete all notifications",
    });
  }
}

// ============================================================================
// Helper functions for creating specific notification types
// ============================================================================

/**
 * Create a booking confirmation notification
 */
export function notifyBookingConfirmed(
  userId: number,
  bookingReference: string,
  flightNumber: string,
  bookingId: number
): Promise<{ id: number }> {
  return createNotification(
    userId,
    "booking",
    "Booking Confirmed",
    `Your booking ${bookingReference} for flight ${flightNumber} has been confirmed.`,
    {
      bookingId,
      bookingReference,
      flightNumber,
      link: `/my-bookings`,
    }
  );
}

/**
 * Create a flight status update notification
 */
export function notifyFlightStatusUpdate(
  userId: number,
  flightNumber: string,
  status: string,
  flightId: number,
  delayMinutes?: number
): Promise<{ id: number }> {
  let message = `Flight ${flightNumber} status has changed to ${status}.`;
  if (delayMinutes && delayMinutes > 0) {
    message = `Flight ${flightNumber} has been delayed by ${delayMinutes} minutes.`;
  } else if (status === "cancelled") {
    message = `Flight ${flightNumber} has been cancelled. Please contact support for rebooking options.`;
  }

  return createNotification(userId, "flight", "Flight Status Update", message, {
    flightId,
    flightNumber,
    status,
    delayMinutes,
    link: `/my-bookings`,
  });
}

/**
 * Create a payment notification
 */
export function notifyPaymentReceived(
  userId: number,
  amount: number,
  bookingReference: string,
  paymentId?: number
): Promise<{ id: number }> {
  const amountFormatted = (amount / 100).toFixed(2);
  return createNotification(
    userId,
    "payment",
    "Payment Received",
    `Your payment of ${amountFormatted} SAR for booking ${bookingReference} has been received.`,
    {
      paymentId,
      bookingReference,
      amount,
      link: `/my-bookings`,
    }
  );
}

/**
 * Create a refund notification
 */
export function notifyRefundProcessed(
  userId: number,
  amount: number,
  bookingReference: string
): Promise<{ id: number }> {
  const amountFormatted = (amount / 100).toFixed(2);
  return createNotification(
    userId,
    "payment",
    "Refund Processed",
    `Your refund of ${amountFormatted} SAR for booking ${bookingReference} has been processed.`,
    {
      bookingReference,
      amount,
      link: `/my-bookings`,
    }
  );
}

/**
 * Create a promotional notification
 */
export function notifyPromotion(
  userId: number,
  title: string,
  message: string,
  promoCode?: string,
  link?: string
): Promise<{ id: number }> {
  return createNotification(userId, "promo", title, message, {
    promoCode,
    link,
  });
}

/**
 * Create a system notification
 */
export function notifySystem(
  userId: number,
  title: string,
  message: string,
  data?: NotificationData
): Promise<{ id: number }> {
  return createNotification(userId, "system", title, message, data);
}

/**
 * Create a check-in reminder notification
 */
export function notifyCheckInReminder(
  userId: number,
  flightNumber: string,
  departureTime: Date,
  bookingReference: string,
  bookingId: number
): Promise<{ id: number }> {
  return createNotification(
    userId,
    "booking",
    "Check-in Available",
    `Online check-in is now available for your flight ${flightNumber} departing on ${departureTime.toLocaleDateString()}. Check in now to choose your seats!`,
    {
      bookingId,
      bookingReference,
      flightNumber,
      link: `/check-in`,
    }
  );
}

/**
 * Create a miles earned notification
 */
export function notifyMilesEarned(
  userId: number,
  milesEarned: number,
  newBalance: number,
  bookingReference: string
): Promise<{ id: number }> {
  return createNotification(
    userId,
    "system",
    "Miles Earned",
    `You earned ${milesEarned} miles from booking ${bookingReference}. Your new balance is ${newBalance} miles.`,
    {
      milesEarned,
      newBalance,
      bookingReference,
      link: `/loyalty`,
    }
  );
}

/**
 * Batch create notifications for multiple users (admin function)
 */
export async function createBulkNotifications(
  userIds: number[],
  type: NotificationType,
  title: string,
  message: string,
  data?: NotificationData
): Promise<{ count: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const notificationValues = userIds.map(userId => ({
      userId,
      type,
      title,
      message,
      data: data ? JSON.stringify(data) : null,
      isRead: false,
    }));

    await database.insert(notifications).values(notificationValues);

    console.info(
      `[Notification] Created bulk notifications for ${userIds.length} users: ${type}`
    );

    return { count: userIds.length };
  } catch (error) {
    console.error("Error creating bulk notifications:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create bulk notifications",
    });
  }
}

/**
 * Clean up old read notifications (run via cron job)
 * Deletes read notifications older than specified days
 */
export async function cleanupOldNotifications(
  daysOld: number = 30
): Promise<{ count: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await database
      .delete(notifications)
      .where(
        and(
          eq(notifications.isRead, true),
          sql`${notifications.createdAt} < ${cutoffDate}`
        )
      );

    const affectedRows = (result as any).affectedRows || 0;

    console.info(
      `[Notification] Cleaned up ${affectedRows} old notifications older than ${daysOld} days`
    );

    return { count: affectedRows };
  } catch (error) {
    console.error("Error cleaning up old notifications:", error);
    return { count: 0 };
  }
}
