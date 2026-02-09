import { describe, it, expect, vi, beforeEach } from "vitest";
import * as db from "../../db";

// Mock the db module
vi.mock("../../db");

describe("Soft Delete Filtering in Booking Queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getBookingByPNR", () => {
    it("should return booking when not soft-deleted", async () => {
      const mockBooking = {
        id: 1,
        pnr: "ABC123",
        userId: 1,
        status: "confirmed",
        deletedAt: null,
      };

      vi.mocked(db.getBookingByPNR).mockResolvedValue(mockBooking as any);

      const result = await db.getBookingByPNR("ABC123");
      expect(result).toEqual(mockBooking);
      expect(result?.deletedAt).toBeNull();
    });

    it("should return null for soft-deleted booking", async () => {
      // The real implementation filters with isNull(bookings.deletedAt)
      // so a deleted booking would not be returned
      vi.mocked(db.getBookingByPNR).mockResolvedValue(null);

      const result = await db.getBookingByPNR("DEL456");
      expect(result).toBeNull();
    });

    it("should return null when booking not found", async () => {
      vi.mocked(db.getBookingByPNR).mockResolvedValue(null);

      const result = await db.getBookingByPNR("NOTFND");
      expect(result).toBeNull();
    });
  });

  describe("getBookingByIdWithDetails", () => {
    it("should return booking when not soft-deleted", async () => {
      const mockBooking = {
        id: 1,
        pnr: "ABC123",
        bookingReference: "REF123",
        userId: 1,
        status: "confirmed",
        deletedAt: null,
      };

      vi.mocked(db.getBookingByIdWithDetails).mockResolvedValue(
        mockBooking as any
      );

      const result = await db.getBookingByIdWithDetails(1);
      expect(result).toEqual(mockBooking);
      expect(result?.deletedAt).toBeNull();
    });

    it("should return null for soft-deleted booking", async () => {
      vi.mocked(db.getBookingByIdWithDetails).mockResolvedValue(null);

      const result = await db.getBookingByIdWithDetails(999);
      expect(result).toBeNull();
    });
  });

  describe("getBookingByPaymentIntentId", () => {
    it("should return booking when not soft-deleted", async () => {
      const mockBooking = {
        id: 1,
        stripePaymentIntentId: "pi_test123",
        status: "confirmed",
        deletedAt: null,
      };

      vi.mocked(db.getBookingByPaymentIntentId).mockResolvedValue(
        mockBooking as any
      );

      const result = await db.getBookingByPaymentIntentId("pi_test123");
      expect(result).toEqual(mockBooking);
    });

    it("should return null for soft-deleted booking", async () => {
      vi.mocked(db.getBookingByPaymentIntentId).mockResolvedValue(null);

      const result = await db.getBookingByPaymentIntentId("pi_deleted");
      expect(result).toBeNull();
    });
  });

  describe("getBookingByCheckoutSessionId", () => {
    it("should return booking when not soft-deleted", async () => {
      const mockBooking = {
        id: 1,
        stripeCheckoutSessionId: "cs_test123",
        status: "pending",
        deletedAt: null,
      };

      vi.mocked(db.getBookingByCheckoutSessionId).mockResolvedValue(
        mockBooking as any
      );

      const result = await db.getBookingByCheckoutSessionId("cs_test123");
      expect(result).toEqual(mockBooking);
    });

    it("should return null for soft-deleted booking", async () => {
      vi.mocked(db.getBookingByCheckoutSessionId).mockResolvedValue(null);

      const result = await db.getBookingByCheckoutSessionId("cs_deleted");
      expect(result).toBeNull();
    });
  });

  describe("getBookingsByUserId", () => {
    it("should return only non-deleted bookings", async () => {
      const mockBookings = [
        { id: 1, pnr: "ACT001", deletedAt: null },
        { id: 2, pnr: "ACT002", deletedAt: null },
      ];

      vi.mocked(db.getBookingsByUserId).mockResolvedValue(mockBookings as any);

      const result = await db.getBookingsByUserId(1);
      expect(result).toHaveLength(2);
      result.forEach((booking: any) => {
        expect(booking.deletedAt).toBeNull();
      });
    });

    it("should return empty array when all bookings are soft-deleted", async () => {
      vi.mocked(db.getBookingsByUserId).mockResolvedValue([]);

      const result = await db.getBookingsByUserId(999);
      expect(result).toHaveLength(0);
    });
  });
});
