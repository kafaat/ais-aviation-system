/**
 * Business Metrics Service Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  trackSearch,
  trackBookingStarted,
  trackBookingCompleted,
  trackBookingCancelled,
  trackPaymentInitiated,
  trackPaymentSuccess,
  trackPaymentFailed,
  trackRefundIssued,
  trackUserLogin,
  trackUserRegistration,
  getBusinessMetrics,
  getMetricsSummary,
  getRealTimeStats,
  getEventCount,
  clearMetrics,
} from "./metrics.service";

describe("Metrics Service", () => {
  beforeEach(() => {
    // Clear metrics before each test
    clearMetrics();
  });

  describe("Event Tracking", () => {
    it("should track search events", () => {
      trackSearch({
        userId: 1,
        sessionId: "session-1",
        originId: 10,
        destinationId: 20,
        departureDate: new Date("2026-03-01"),
        resultsCount: 5,
        responseTimeMs: 150,
      });

      expect(getEventCount()).toBe(1);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.search_performed).toBe(1);
      expect(metrics.funnel.searches).toBe(1);
    });

    it("should track booking started events", () => {
      trackBookingStarted({
        userId: 1,
        sessionId: "session-1",
        bookingId: 100,
        flightId: 10,
        cabinClass: "economy",
        passengerCount: 2,
        totalAmount: 500,
      });

      expect(getEventCount()).toBe(1);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.booking_started).toBe(1);
      expect(metrics.funnel.bookingsStarted).toBe(1);
    });

    it("should track booking completed events", () => {
      trackBookingCompleted({
        userId: 1,
        sessionId: "session-1",
        bookingId: 100,
        flightId: 10,
        cabinClass: "business",
        passengerCount: 1,
        totalAmount: 1500,
      });

      expect(getEventCount()).toBe(1);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.booking_completed).toBe(1);
      expect(metrics.funnel.bookingsCompleted).toBe(1);
    });

    it("should track booking cancelled events", () => {
      trackBookingCancelled({
        userId: 1,
        bookingId: 100,
        flightId: 10,
        cabinClass: "economy",
        passengerCount: 2,
        totalAmount: 500,
      });

      expect(getEventCount()).toBe(1);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.booking_cancelled).toBe(1);
    });

    it("should track payment events", () => {
      trackPaymentInitiated({
        userId: 1,
        bookingId: 100,
        amount: 500,
        currency: "SAR",
        paymentMethod: "card",
      });

      trackPaymentSuccess({
        userId: 1,
        bookingId: 100,
        amount: 500,
        currency: "SAR",
        paymentMethod: "card",
      });

      trackPaymentFailed({
        userId: 2,
        bookingId: 101,
        amount: 300,
        currency: "SAR",
        paymentMethod: "card",
        errorCode: "insufficient_funds",
        errorMessage: "Card declined",
      });

      expect(getEventCount()).toBe(3);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.payment_initiated).toBe(1);
      expect(metrics.eventCounts.payment_success).toBe(1);
      expect(metrics.eventCounts.payment_failed).toBe(1);
    });

    it("should track refund events", () => {
      trackRefundIssued({
        userId: 1,
        bookingId: 100,
        refundAmount: 400,
        originalAmount: 500,
        reason: "customer_request",
      });

      expect(getEventCount()).toBe(1);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.refund_issued).toBe(1);
      expect(metrics.refunds.totalRefunds).toBe(1);
      expect(metrics.refunds.totalRefundAmount).toBe(400);
    });

    it("should track user events", () => {
      trackUserLogin({
        userId: 1,
        sessionId: "session-1",
        source: "web",
        deviceType: "desktop",
      });

      trackUserRegistration({
        userId: 2,
        sessionId: "session-2",
        source: "mobile",
        deviceType: "ios",
      });

      expect(getEventCount()).toBe(2);

      const metrics = getBusinessMetrics(1);
      expect(metrics.eventCounts.user_login).toBe(1);
      expect(metrics.eventCounts.user_registration).toBe(1);
      expect(metrics.engagement.totalLogins).toBe(1);
      expect(metrics.engagement.newRegistrations).toBe(1);
    });
  });

  describe("Conversion Funnel", () => {
    it("should calculate correct conversion rates", () => {
      // Simulate a funnel: 10 searches -> 3 bookings started -> 2 payments successful
      for (let i = 0; i < 10; i++) {
        trackSearch({
          originId: 1,
          destinationId: 2,
          departureDate: new Date(),
          resultsCount: 5,
        });
      }

      for (let i = 0; i < 3; i++) {
        trackBookingStarted({
          userId: i + 1,
          bookingId: i + 100,
          flightId: 10,
          cabinClass: "economy",
          passengerCount: 1,
          totalAmount: 500,
        });
      }

      for (let i = 0; i < 2; i++) {
        trackPaymentSuccess({
          userId: i + 1,
          bookingId: i + 100,
          amount: 500,
          currency: "SAR",
        });
      }

      const metrics = getBusinessMetrics(1);

      expect(metrics.funnel.searches).toBe(10);
      expect(metrics.funnel.bookingsStarted).toBe(3);
      expect(metrics.funnel.paymentsSuccessful).toBe(2);

      // Search to booking rate: 3/10 = 30%
      expect(metrics.funnel.searchToBookingRate).toBe(30);

      // Booking to payment rate: 2/3 = 66.67%
      expect(metrics.funnel.bookingToPaymentRate).toBeCloseTo(66.67, 1);

      // Overall conversion rate: 2/10 = 20%
      expect(metrics.funnel.overallConversionRate).toBe(20);
    });
  });

  describe("Payment Metrics", () => {
    it("should calculate correct payment metrics", () => {
      // 3 successful payments, 1 failed
      trackPaymentSuccess({
        userId: 1,
        bookingId: 100,
        amount: 500,
        currency: "SAR",
      });

      trackPaymentSuccess({
        userId: 2,
        bookingId: 101,
        amount: 700,
        currency: "SAR",
      });

      trackPaymentSuccess({
        userId: 3,
        bookingId: 102,
        amount: 300,
        currency: "SAR",
      });

      trackPaymentFailed({
        userId: 4,
        bookingId: 103,
        amount: 400,
        currency: "SAR",
      });

      const metrics = getBusinessMetrics(1);

      expect(metrics.payments.totalAttempts).toBe(4);
      expect(metrics.payments.successful).toBe(3);
      expect(metrics.payments.failed).toBe(1);
      expect(metrics.payments.successRate).toBe(75);
      expect(metrics.payments.failureRate).toBe(25);
      expect(metrics.payments.totalRevenue).toBe(1500); // 500 + 700 + 300
      expect(metrics.payments.averageAmount).toBe(500); // 1500 / 3
    });
  });

  describe("Revenue Metrics", () => {
    it("should calculate correct revenue metrics", () => {
      // Add completed bookings and payments
      trackBookingCompleted({
        userId: 1,
        bookingId: 100,
        flightId: 10,
        cabinClass: "economy",
        passengerCount: 2,
        totalAmount: 1000,
      });

      trackBookingCompleted({
        userId: 2,
        bookingId: 101,
        flightId: 11,
        cabinClass: "business",
        passengerCount: 1,
        totalAmount: 2000,
      });

      trackPaymentSuccess({
        userId: 1,
        bookingId: 100,
        amount: 1000,
        currency: "SAR",
      });

      trackPaymentSuccess({
        userId: 2,
        bookingId: 101,
        amount: 2000,
        currency: "SAR",
      });

      // Issue a partial refund
      trackRefundIssued({
        userId: 1,
        bookingId: 100,
        refundAmount: 300,
        originalAmount: 1000,
      });

      const metrics = getBusinessMetrics(1);

      expect(metrics.revenue.totalRevenue).toBe(3000); // 1000 + 2000
      expect(metrics.revenue.netRevenue).toBe(2700); // 3000 - 300
      expect(metrics.revenue.averageBookingValue).toBe(1500); // 3000 / 2 bookings
      expect(metrics.revenue.revenueByClass.economy).toBe(1000);
      expect(metrics.revenue.revenueByClass.business).toBe(2000);
    });
  });

  describe("User Engagement Metrics", () => {
    it("should calculate correct engagement metrics", () => {
      // 3 unique users, 5 total logins
      trackUserLogin({ userId: 1 });
      trackUserLogin({ userId: 1 });
      trackUserLogin({ userId: 2 });
      trackUserLogin({ userId: 2 });
      trackUserLogin({ userId: 3 });

      // 1 new registration
      trackUserRegistration({ userId: 4 });

      // Users perform searches
      trackSearch({
        userId: 1,
        originId: 1,
        destinationId: 2,
        departureDate: new Date(),
        resultsCount: 5,
      });
      trackSearch({
        userId: 2,
        originId: 1,
        destinationId: 3,
        departureDate: new Date(),
        resultsCount: 3,
      });

      // User 1 creates a booking
      trackBookingStarted({
        userId: 1,
        bookingId: 100,
        flightId: 10,
        cabinClass: "economy",
        passengerCount: 1,
        totalAmount: 500,
      });

      const metrics = getBusinessMetrics(1);

      expect(metrics.engagement.totalLogins).toBe(5);
      expect(metrics.engagement.uniqueUsers).toBe(4); // Users 1, 2, 3, 4
      expect(metrics.engagement.newRegistrations).toBe(1);
    });
  });

  describe("Metrics Summary", () => {
    it("should return lightweight summary", () => {
      trackSearch({
        originId: 1,
        destinationId: 2,
        departureDate: new Date(),
        resultsCount: 5,
      });

      trackPaymentSuccess({
        userId: 1,
        bookingId: 100,
        amount: 500,
        currency: "SAR",
      });

      trackBookingCompleted({
        userId: 1,
        bookingId: 100,
        flightId: 10,
        cabinClass: "economy",
        passengerCount: 1,
        totalAmount: 500,
      });

      const summary = getMetricsSummary(1);

      expect(summary.totalSearches).toBe(1);
      expect(summary.totalBookings).toBe(1);
      expect(summary.totalRevenue).toBe(500);
      expect(summary.paymentSuccessRate).toBe(100);
      expect(summary.period.start).toBeDefined();
      expect(summary.period.end).toBeDefined();
    });
  });

  describe("Real-Time Stats", () => {
    it("should return real-time statistics", () => {
      // These events are within the last 5 minutes
      trackSearch({
        originId: 1,
        destinationId: 2,
        departureDate: new Date(),
        resultsCount: 5,
      });

      trackSearch({
        originId: 1,
        destinationId: 3,
        departureDate: new Date(),
        resultsCount: 3,
      });

      const stats = getRealTimeStats();

      expect(stats.searchesPerMinute).toBeGreaterThan(0);
      expect(stats.activeUsers).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Business Metrics Structure", () => {
    it("should return complete metrics object", () => {
      trackSearch({
        originId: 1,
        destinationId: 2,
        departureDate: new Date(),
        resultsCount: 5,
      });

      const metrics = getBusinessMetrics(24);

      // Verify structure
      expect(metrics).toHaveProperty("period");
      expect(metrics.period).toHaveProperty("start");
      expect(metrics.period).toHaveProperty("end");
      expect(metrics.period).toHaveProperty("durationHours");

      expect(metrics).toHaveProperty("funnel");
      expect(metrics.funnel).toHaveProperty("searches");
      expect(metrics.funnel).toHaveProperty("bookingsStarted");
      expect(metrics.funnel).toHaveProperty("bookingsCompleted");
      expect(metrics.funnel).toHaveProperty("paymentsSuccessful");
      expect(metrics.funnel).toHaveProperty("searchToBookingRate");
      expect(metrics.funnel).toHaveProperty("bookingToPaymentRate");
      expect(metrics.funnel).toHaveProperty("overallConversionRate");

      expect(metrics).toHaveProperty("payments");
      expect(metrics.payments).toHaveProperty("totalAttempts");
      expect(metrics.payments).toHaveProperty("successful");
      expect(metrics.payments).toHaveProperty("failed");
      expect(metrics.payments).toHaveProperty("successRate");
      expect(metrics.payments).toHaveProperty("failureRate");
      expect(metrics.payments).toHaveProperty("averageAmount");
      expect(metrics.payments).toHaveProperty("totalRevenue");
      expect(metrics.payments).toHaveProperty("byPaymentMethod");

      expect(metrics).toHaveProperty("refunds");
      expect(metrics.refunds).toHaveProperty("totalRefunds");
      expect(metrics.refunds).toHaveProperty("totalRefundAmount");
      expect(metrics.refunds).toHaveProperty("averageRefundAmount");
      expect(metrics.refunds).toHaveProperty("refundRate");
      expect(metrics.refunds).toHaveProperty("byReason");

      expect(metrics).toHaveProperty("revenue");
      expect(metrics.revenue).toHaveProperty("totalRevenue");
      expect(metrics.revenue).toHaveProperty("netRevenue");
      expect(metrics.revenue).toHaveProperty("averageBookingValue");
      expect(metrics.revenue).toHaveProperty("revenueByClass");
      expect(metrics.revenue).toHaveProperty("revenueByHour");

      expect(metrics).toHaveProperty("engagement");
      expect(metrics.engagement).toHaveProperty("totalLogins");
      expect(metrics.engagement).toHaveProperty("uniqueUsers");
      expect(metrics.engagement).toHaveProperty("newRegistrations");
      expect(metrics.engagement).toHaveProperty("searchesPerUser");
      expect(metrics.engagement).toHaveProperty("bookingsPerUser");

      expect(metrics).toHaveProperty("eventCounts");
      expect(metrics).toHaveProperty("recentEvents");
      expect(metrics).toHaveProperty("timeSeries");
    });
  });

  describe("Clear Metrics", () => {
    it("should clear all metrics", () => {
      trackSearch({
        originId: 1,
        destinationId: 2,
        departureDate: new Date(),
        resultsCount: 5,
      });

      expect(getEventCount()).toBe(1);

      clearMetrics();

      expect(getEventCount()).toBe(0);

      const metrics = getBusinessMetrics(1);
      expect(metrics.funnel.searches).toBe(0);
    });
  });
});
