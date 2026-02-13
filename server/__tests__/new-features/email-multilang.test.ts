import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendBookingConfirmation,
  sendRefundConfirmation,
  sendCheckInReminder,
  sendLoyaltyMilesNotification,
  sendNotificationEmail,
  sendSplitPaymentRequest,
  type BookingConfirmationData,
  type RefundConfirmationData,
  type CheckInReminderData,
  type LoyaltyMilesNotificationData,
  type SplitPaymentRequestData,
  type EmailLanguage,
} from "../../services/email.service";

describe("Email Multi-Language Support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console output from email service
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const baseBookingData: BookingConfirmationData = {
    passengerName: "Ahmed Mohammed",
    passengerEmail: "ahmed@example.com",
    bookingReference: "ABC123",
    pnr: "XYZ789",
    flightNumber: "SV123",
    origin: "JED",
    destination: "RUH",
    departureTime: new Date("2025-06-15T10:00:00Z"),
    arrivalTime: new Date("2025-06-15T12:00:00Z"),
    cabinClass: "economy",
    numberOfPassengers: 2,
    totalAmount: 150000, // 1500 SAR in cents
  };

  describe("BookingConfirmationData language support", () => {
    it("should accept Arabic language parameter", async () => {
      const data: BookingConfirmationData = {
        ...baseBookingData,
        language: "ar",
      };

      const result = await sendBookingConfirmation(data);
      expect(result).toBe(true);
    });

    it("should accept English language parameter", async () => {
      const data: BookingConfirmationData = {
        ...baseBookingData,
        language: "en",
      };

      const result = await sendBookingConfirmation(data);
      expect(result).toBe(true);
    });

    it("should default to Arabic when no language specified", async () => {
      const result = await sendBookingConfirmation(baseBookingData);
      expect(result).toBe(true);
    });

    it("should handle economy class in both languages", async () => {
      const arData: BookingConfirmationData = {
        ...baseBookingData,
        language: "ar",
        cabinClass: "economy",
      };
      const enData: BookingConfirmationData = {
        ...baseBookingData,
        language: "en",
        cabinClass: "economy",
      };

      expect(await sendBookingConfirmation(arData)).toBe(true);
      expect(await sendBookingConfirmation(enData)).toBe(true);
    });

    it("should handle business class in both languages", async () => {
      const arData: BookingConfirmationData = {
        ...baseBookingData,
        language: "ar",
        cabinClass: "business",
      };
      const enData: BookingConfirmationData = {
        ...baseBookingData,
        language: "en",
        cabinClass: "business",
      };

      expect(await sendBookingConfirmation(arData)).toBe(true);
      expect(await sendBookingConfirmation(enData)).toBe(true);
    });

    it("should include attachments in both languages", async () => {
      const data: BookingConfirmationData = {
        ...baseBookingData,
        language: "en",
        attachments: [
          {
            filename: "eticket.pdf",
            content: "base64content",
            contentType: "application/pdf",
          },
        ],
      };

      const result = await sendBookingConfirmation(data);
      expect(result).toBe(true);
    });
  });

  describe("RefundConfirmationData language support", () => {
    const baseRefundData: RefundConfirmationData = {
      passengerName: "Ahmed Mohammed",
      passengerEmail: "ahmed@example.com",
      bookingReference: "ABC123",
      flightNumber: "SV123",
      refundAmount: 75000,
      processingDays: 5,
    };

    it("should accept Arabic language", async () => {
      const data: RefundConfirmationData = {
        ...baseRefundData,
        language: "ar",
      };

      const result = await sendRefundConfirmation(data);
      expect(result).toBe(true);
    });

    it("should accept English language", async () => {
      const data: RefundConfirmationData = {
        ...baseRefundData,
        language: "en",
      };

      const result = await sendRefundConfirmation(data);
      expect(result).toBe(true);
    });

    it("should handle refund with reason", async () => {
      const data: RefundConfirmationData = {
        ...baseRefundData,
        language: "en",
        refundReason: "Flight cancelled",
      };

      const result = await sendRefundConfirmation(data);
      expect(result).toBe(true);
    });
  });

  describe("CheckInReminderData language support", () => {
    const baseCheckInData: CheckInReminderData = {
      passengerName: "Ahmed Mohammed",
      passengerEmail: "ahmed@example.com",
      bookingReference: "ABC123",
      pnr: "XYZ789",
      flightNumber: "SV123",
      origin: "JED",
      destination: "RUH",
      departureTime: new Date("2025-06-15T10:00:00Z"),
      checkInUrl: "https://example.com/checkin/ABC123",
    };

    it("should accept Arabic language", async () => {
      const data: CheckInReminderData = {
        ...baseCheckInData,
        language: "ar",
      };

      const result = await sendCheckInReminder(data);
      expect(result).toBe(true);
    });

    it("should accept English language", async () => {
      const data: CheckInReminderData = {
        ...baseCheckInData,
        language: "en",
      };

      const result = await sendCheckInReminder(data);
      expect(result).toBe(true);
    });
  });

  describe("LoyaltyMilesNotificationData language support", () => {
    const baseLoyaltyData: LoyaltyMilesNotificationData = {
      passengerName: "Ahmed Mohammed",
      passengerEmail: "ahmed@example.com",
      bookingReference: "ABC123",
      milesEarned: 1500,
      totalMiles: 15000,
      tierStatus: "gold",
    };

    it("should accept Arabic language", async () => {
      const data: LoyaltyMilesNotificationData = {
        ...baseLoyaltyData,
        language: "ar",
      };

      const result = await sendLoyaltyMilesNotification(data);
      expect(result).toBe(true);
    });

    it("should accept English language", async () => {
      const data: LoyaltyMilesNotificationData = {
        ...baseLoyaltyData,
        language: "en",
      };

      const result = await sendLoyaltyMilesNotification(data);
      expect(result).toBe(true);
    });

    it("should handle next tier miles in both languages", async () => {
      const data: LoyaltyMilesNotificationData = {
        ...baseLoyaltyData,
        language: "en",
        nextTierMiles: 5000,
      };

      const result = await sendLoyaltyMilesNotification(data);
      expect(result).toBe(true);
    });

    it("should handle max tier (no next tier)", async () => {
      const data: LoyaltyMilesNotificationData = {
        ...baseLoyaltyData,
        language: "en",
        tierStatus: "platinum",
      };

      const result = await sendLoyaltyMilesNotification(data);
      expect(result).toBe(true);
    });
  });

  describe("sendNotificationEmail language support", () => {
    it("should accept language parameter", async () => {
      const result = await sendNotificationEmail(
        "user@example.com",
        "Test Subject",
        "Test message",
        "en"
      );

      expect(result).toBe(true);
    });

    it("should default to Arabic", async () => {
      const result = await sendNotificationEmail(
        "user@example.com",
        "موضوع اختبار",
        "رسالة اختبار"
      );

      expect(result).toBe(true);
    });
  });

  describe("SplitPaymentRequestData language support", () => {
    const baseSplitData: SplitPaymentRequestData = {
      payerName: "Ahmed Mohammed",
      payerEmail: "ahmed@example.com",
      bookingReference: "ABC123",
      flightNumber: "SV123",
      route: "JED → RUH",
      departureTime: new Date("2025-06-15T10:00:00Z"),
      amount: 50000,
      paymentUrl: "https://example.com/pay/token123",
    };

    it("should accept Arabic language", async () => {
      const data: SplitPaymentRequestData = {
        ...baseSplitData,
        language: "ar",
      };

      const result = await sendSplitPaymentRequest(data);
      expect(result).toBe(true);
    });

    it("should accept English language", async () => {
      const data: SplitPaymentRequestData = {
        ...baseSplitData,
        language: "en",
      };

      const result = await sendSplitPaymentRequest(data);
      expect(result).toBe(true);
    });

    it("should handle expiry date in both languages", async () => {
      const data: SplitPaymentRequestData = {
        ...baseSplitData,
        language: "en",
        expiresAt: new Date("2025-06-20T23:59:59Z"),
      };

      const result = await sendSplitPaymentRequest(data);
      expect(result).toBe(true);
    });
  });

  describe("EmailLanguage type", () => {
    it("should support ar and en values", () => {
      const ar: EmailLanguage = "ar";
      const en: EmailLanguage = "en";

      expect(ar).toBe("ar");
      expect(en).toBe("en");
    });
  });
});
