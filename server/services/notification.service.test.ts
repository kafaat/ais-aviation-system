import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { getDb } from "../db";
import { notifications } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  createNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  deleteAllNotifications,
  notifyBookingConfirmed,
  notifyFlightStatusUpdate,
  notifyPaymentReceived,
  createBulkNotifications,
} from "./notification.service";
import { isDatabaseAvailable } from "../__tests__/test-db-helper";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("Notification Service", () => {
  const testUserId = 999888;
  const testUserId2 = 999889;

  // Clean up test data before and after all tests
  beforeAll(async () => {
    const db = await getDb();
    if (db) {
      await db
        .delete(notifications)
        .where(eq(notifications.userId, testUserId));
      await db
        .delete(notifications)
        .where(eq(notifications.userId, testUserId2));
    }
  });

  afterAll(async () => {
    const db = await getDb();
    if (db) {
      await db
        .delete(notifications)
        .where(eq(notifications.userId, testUserId));
      await db
        .delete(notifications)
        .where(eq(notifications.userId, testUserId2));
    }
  });

  describe("createNotification", () => {
    it("should create a new notification", async () => {
      const result = await createNotification(
        testUserId,
        "booking",
        "Test Notification",
        "This is a test notification message",
        { bookingId: 12345 }
      );

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
    });

    it("should create a notification without data", async () => {
      const result = await createNotification(
        testUserId,
        "system",
        "System Alert",
        "This is a system notification"
      );

      expect(result).toBeDefined();
      expect(result.id).toBeGreaterThan(0);
    });

    it("should create notifications of different types", async () => {
      const types: Array<
        "booking" | "flight" | "payment" | "promo" | "system"
      > = ["booking", "flight", "payment", "promo", "system"];

      for (const type of types) {
        const result = await createNotification(
          testUserId,
          type,
          `${type} notification`,
          `Test ${type} message`
        );
        expect(result.id).toBeGreaterThan(0);
      }
    });
  });

  describe("getUserNotifications", () => {
    it("should retrieve user notifications", async () => {
      const results = await getUserNotifications(testUserId);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should filter by notification type", async () => {
      const results = await getUserNotifications(testUserId, {
        type: "booking",
      });

      expect(results).toBeDefined();
      for (const notification of results) {
        expect(notification.type).toBe("booking");
      }
    });

    it("should filter by unread only", async () => {
      const results = await getUserNotifications(testUserId, {
        unreadOnly: true,
      });

      expect(results).toBeDefined();
      for (const notification of results) {
        expect(notification.isRead).toBe(false);
      }
    });

    it("should respect limit and offset", async () => {
      const limit = 2;
      const results = await getUserNotifications(testUserId, { limit });

      expect(results.length).toBeLessThanOrEqual(limit);
    });

    it("should parse JSON data field", async () => {
      // Create notification with data
      await createNotification(
        testUserId,
        "booking",
        "Test with Data",
        "Test",
        {
          bookingId: 54321,
          link: "/test-link",
        }
      );

      const results = await getUserNotifications(testUserId, {
        type: "booking",
        limit: 1,
      });

      expect(results.length).toBeGreaterThan(0);
      const notification = results[0];
      if (notification.data) {
        expect(typeof notification.data).toBe("object");
      }
    });
  });

  describe("getUnreadCount", () => {
    it("should return unread count", async () => {
      const result = await getUnreadCount(testUserId);

      expect(result).toBeDefined();
      expect(result.count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("markAsRead", () => {
    it("should mark a notification as read", async () => {
      // Create a new notification
      const created = await createNotification(
        testUserId,
        "system",
        "To be marked as read",
        "Test message"
      );

      // Mark it as read
      const result = await markAsRead(created.id, testUserId);

      expect(result.success).toBe(true);

      // Verify it's marked as read
      const notifications = await getUserNotifications(testUserId);
      const marked = notifications.find(n => n.id === created.id);
      expect(marked?.isRead).toBe(true);
    });

    it("should throw error for non-existent notification", async () => {
      await expect(markAsRead(999999999, testUserId)).rejects.toThrow(
        "Notification not found"
      );
    });

    it("should throw error for notification belonging to another user", async () => {
      // Create notification for different user
      const created = await createNotification(
        testUserId2,
        "system",
        "Other user notification",
        "Test"
      );

      // Try to mark as read with wrong user
      await expect(markAsRead(created.id, testUserId)).rejects.toThrow(
        "Notification not found"
      );
    });

    it("should succeed when marking already read notification", async () => {
      // Create and mark as read
      const created = await createNotification(
        testUserId,
        "system",
        "Double read test",
        "Test"
      );
      await markAsRead(created.id, testUserId);

      // Mark as read again - should succeed
      const result = await markAsRead(created.id, testUserId);
      expect(result.success).toBe(true);
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all unread notifications as read", async () => {
      // Create some unread notifications
      await createNotification(testUserId, "system", "Unread 1", "Test 1");
      await createNotification(testUserId, "system", "Unread 2", "Test 2");

      // Get initial unread count
      const initialCount = await getUnreadCount(testUserId);
      expect(initialCount.count).toBeGreaterThan(0);

      // Mark all as read
      const result = await markAllAsRead(testUserId);
      expect(result.count).toBeGreaterThanOrEqual(0);

      // Verify all are read
      const afterCount = await getUnreadCount(testUserId);
      expect(afterCount.count).toBe(0);
    });
  });

  describe("deleteNotification", () => {
    it("should delete a notification", async () => {
      // Create a notification
      const created = await createNotification(
        testUserId,
        "system",
        "To be deleted",
        "Test"
      );

      // Delete it
      const result = await deleteNotification(created.id, testUserId);
      expect(result.success).toBe(true);

      // Verify it's deleted
      const db = await getDb();
      if (db) {
        const [found] = await db
          .select()
          .from(notifications)
          .where(eq(notifications.id, created.id))
          .limit(1);
        expect(found).toBeUndefined();
      }
    });

    it("should throw error for non-existent notification", async () => {
      await expect(deleteNotification(999999999, testUserId)).rejects.toThrow(
        "Notification not found"
      );
    });
  });

  describe("deleteAllNotifications", () => {
    it("should delete all user notifications", async () => {
      // Create some notifications
      await createNotification(testUserId2, "system", "Delete all 1", "Test 1");
      await createNotification(testUserId2, "system", "Delete all 2", "Test 2");

      // Delete all
      const result = await deleteAllNotifications(testUserId2);
      expect(result.count).toBeGreaterThanOrEqual(0);

      // Verify all are deleted
      const remaining = await getUserNotifications(testUserId2);
      expect(remaining.length).toBe(0);
    });
  });

  describe("Helper Functions", () => {
    describe("notifyBookingConfirmed", () => {
      it("should create a booking confirmed notification", async () => {
        const result = await notifyBookingConfirmed(
          testUserId,
          "ABC123",
          "SV456",
          12345
        );

        expect(result.id).toBeGreaterThan(0);

        // Verify content
        const notifs = await getUserNotifications(testUserId, {
          type: "booking",
        });
        const created = notifs.find(n => n.id === result.id);
        expect(created?.title).toBe("Booking Confirmed");
        expect(created?.message).toContain("ABC123");
        expect(created?.message).toContain("SV456");
      });
    });

    describe("notifyFlightStatusUpdate", () => {
      it("should create a flight status notification for delay", async () => {
        const result = await notifyFlightStatusUpdate(
          testUserId,
          "SV789",
          "delayed",
          54321,
          30
        );

        expect(result.id).toBeGreaterThan(0);

        const notifs = await getUserNotifications(testUserId, {
          type: "flight",
        });
        const created = notifs.find(n => n.id === result.id);
        expect(created?.message).toContain("30 minutes");
      });

      it("should create a flight status notification for cancellation", async () => {
        const result = await notifyFlightStatusUpdate(
          testUserId,
          "SV999",
          "cancelled",
          99999
        );

        expect(result.id).toBeGreaterThan(0);

        const notifs = await getUserNotifications(testUserId, {
          type: "flight",
        });
        const created = notifs.find(n => n.id === result.id);
        expect(created?.message).toContain("cancelled");
      });
    });

    describe("notifyPaymentReceived", () => {
      it("should create a payment notification", async () => {
        const result = await notifyPaymentReceived(
          testUserId,
          50000, // 500 SAR in cents
          "XYZ789",
          77777
        );

        expect(result.id).toBeGreaterThan(0);

        const notifs = await getUserNotifications(testUserId, {
          type: "payment",
        });
        const created = notifs.find(n => n.id === result.id);
        expect(created?.message).toContain("500.00");
        expect(created?.message).toContain("XYZ789");
      });
    });
  });

  describe("createBulkNotifications", () => {
    it("should create notifications for multiple users", async () => {
      const userIds = [testUserId, testUserId2];

      const result = await createBulkNotifications(
        userIds,
        "promo",
        "Special Offer",
        "Get 20% off your next booking!",
        { promoCode: "SAVE20" }
      );

      expect(result.count).toBe(userIds.length);

      // Verify notifications created for both users
      for (const userId of userIds) {
        const notifs = await getUserNotifications(userId, {
          type: "promo",
        });
        const created = notifs.find(n => n.title === "Special Offer");
        expect(created).toBeDefined();
        expect(created?.title).toBe("Special Offer");
      }
    });
  });
});
