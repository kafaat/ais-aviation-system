import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  getValidTransitions,
  recordStatusChange,
  transitionBookingStatus,
  getStateMachineDiagram,
  type BookingStatus,
  STATUS_DESCRIPTIONS,
} from "./booking-state-machine.service";

describe("Booking State Machine Service", () => {
  describe("isValidTransition", () => {
    it("should allow valid transitions", () => {
      expect(isValidTransition("initiated", "pending")).toBe(true);
      expect(isValidTransition("pending", "paid")).toBe(true);
      expect(isValidTransition("paid", "confirmed")).toBe(true);
      expect(isValidTransition("confirmed", "checked_in")).toBe(true);
      expect(isValidTransition("checked_in", "boarded")).toBe(true);
      expect(isValidTransition("boarded", "completed")).toBe(true);
    });

    it("should allow cancellation from multiple states", () => {
      expect(isValidTransition("pending", "cancelled")).toBe(true);
      expect(isValidTransition("paid", "cancelled")).toBe(true);
      expect(isValidTransition("confirmed", "cancelled")).toBe(true);
    });

    it("should allow refund transitions", () => {
      expect(isValidTransition("paid", "refunded")).toBe(true);
      expect(isValidTransition("confirmed", "refunded")).toBe(true);
      expect(isValidTransition("cancelled", "refunded")).toBe(true);
      expect(isValidTransition("completed", "refunded")).toBe(true);
    });

    it("should allow expiration from initial states", () => {
      expect(isValidTransition("initiated", "expired")).toBe(true);
      expect(isValidTransition("pending", "expired")).toBe(true);
      expect(isValidTransition("reserved", "expired")).toBe(true);
    });

    it("should prevent invalid backward transitions", () => {
      expect(isValidTransition("confirmed", "pending")).toBe(false);
      expect(isValidTransition("paid", "pending")).toBe(false);
      expect(isValidTransition("boarded", "confirmed")).toBe(false);
    });

    it("should prevent transitions from terminal states", () => {
      expect(isValidTransition("completed", "cancelled")).toBe(false);
      expect(isValidTransition("refunded", "cancelled")).toBe(false);
      expect(isValidTransition("expired", "pending")).toBe(false);
    });

    it("should allow payment retry from payment_failed", () => {
      expect(isValidTransition("payment_failed", "pending")).toBe(true);
      expect(isValidTransition("payment_failed", "cancelled")).toBe(true);
    });

    it("should allow no_show transitions", () => {
      expect(isValidTransition("confirmed", "no_show")).toBe(true);
      expect(isValidTransition("checked_in", "no_show")).toBe(true);
      expect(isValidTransition("no_show", "refunded")).toBe(true);
    });
  });

  describe("getValidTransitions", () => {
    it("should return all valid transitions for initiated status", () => {
      const transitions = getValidTransitions("initiated");
      expect(transitions).toContain("pending");
      expect(transitions).toContain("reserved");
      expect(transitions).toContain("expired");
      expect(transitions).toContain("cancelled");
    });

    it("should return all valid transitions for pending status", () => {
      const transitions = getValidTransitions("pending");
      expect(transitions).toContain("reserved");
      expect(transitions).toContain("paid");
      expect(transitions).toContain("expired");
      expect(transitions).toContain("cancelled");
      expect(transitions).toContain("payment_failed");
    });

    it("should return empty array for terminal states", () => {
      expect(getValidTransitions("refunded")).toEqual([]);
      expect(getValidTransitions("expired")).toEqual([]);
    });

    it("should return payment retry options from payment_failed", () => {
      const transitions = getValidTransitions("payment_failed");
      expect(transitions).toContain("pending");
      expect(transitions).toContain("cancelled");
    });
  });

  describe("recordStatusChange", () => {
    it("should record valid status change", async () => {
      await recordStatusChange({
        bookingId: 1,
        bookingReference: "ABC123",
        previousStatus: "pending",
        newStatus: "paid",
        transitionReason: "Payment successful",
        changedBy: 1,
        changedByRole: "user",
        actorType: "payment_gateway",
        paymentIntentId: "pi_123456",
      });

      // If no error thrown, test passes
      expect(true).toBe(true);
    });

    it("should record invalid transition with warning", async () => {
      await recordStatusChange({
        bookingId: 1,
        bookingReference: "ABC123",
        previousStatus: "completed",
        newStatus: "pending",
        transitionReason: "Invalid attempt",
        changedBy: 1,
        changedByRole: "admin",
        actorType: "admin",
      });

      // Should not throw, but log warning
      expect(true).toBe(true);
    });

    it("should handle first status (no previous status)", async () => {
      await recordStatusChange({
        bookingId: 2,
        bookingReference: "DEF456",
        previousStatus: null,
        newStatus: "initiated",
        transitionReason: "Booking started",
        actorType: "system",
      });

      expect(true).toBe(true);
    });

    it("should handle metadata serialization", async () => {
      await recordStatusChange({
        bookingId: 3,
        bookingReference: "GHI789",
        previousStatus: "paid",
        newStatus: "confirmed",
        transitionReason: "Automatic confirmation",
        actorType: "system",
        metadata: {
          flightId: 100,
          passengerCount: 2,
          confirmationSent: true,
        },
      });

      expect(true).toBe(true);
    });
  });

  describe("transitionBookingStatus", () => {
    it("should successfully transition with valid state change", async () => {
      const result = await transitionBookingStatus(
        1,
        "ABC123",
        "pending",
        "paid",
        {
          reason: "Payment successful",
          changedBy: 1,
          changedByRole: "user",
          actorType: "payment_gateway",
          paymentIntentId: "pi_123456",
        }
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should fail with invalid state transition", async () => {
      const result = await transitionBookingStatus(
        1,
        "ABC123",
        "completed",
        "pending",
        {
          reason: "Invalid attempt",
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Invalid transition");
    });

    it("should handle system actor transitions", async () => {
      const result = await transitionBookingStatus(
        2,
        "DEF456",
        "pending",
        "expired",
        {
          reason: "Seat hold timeout",
          actorType: "system",
        }
      );

      expect(result.success).toBe(true);
    });

    it("should track admin cancellation", async () => {
      const result = await transitionBookingStatus(
        3,
        "GHI789",
        "confirmed",
        "cancelled",
        {
          reason: "Customer request",
          changedBy: 5,
          changedByRole: "support",
          actorType: "admin",
        }
      );

      expect(result.success).toBe(true);
    });
  });

  describe("STATUS_DESCRIPTIONS", () => {
    it("should have descriptions for all states", () => {
      const states: BookingStatus[] = [
        "initiated",
        "pending",
        "reserved",
        "paid",
        "confirmed",
        "checked_in",
        "boarded",
        "completed",
        "cancelled",
        "refunded",
        "expired",
        "payment_failed",
        "no_show",
      ];

      states.forEach(state => {
        expect(STATUS_DESCRIPTIONS[state]).toBeDefined();
        expect(STATUS_DESCRIPTIONS[state].length).toBeGreaterThan(0);
      });
    });
  });

  describe("getStateMachineDiagram", () => {
    it("should return state machine diagram", () => {
      const diagram = getStateMachineDiagram();

      expect(diagram).toContain("Booking State Machine");
      expect(diagram).toContain("INITIATED");
      expect(diagram).toContain("COMPLETED");
      expect(diagram).toContain("Valid Transitions");
    });
  });

  describe("Complete Booking Flow", () => {
    it("should allow complete successful flow", async () => {
      const bookingId = 100;
      const bookingRef = "TEST01";

      // Initiated -> Pending
      let result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "initiated",
        "pending",
        { reason: "Booking started" }
      );
      expect(result.success).toBe(true);

      // Pending -> Reserved
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "pending",
        "reserved",
        { reason: "Seats locked" }
      );
      expect(result.success).toBe(true);

      // Reserved -> Paid
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "reserved",
        "paid",
        { reason: "Payment successful" }
      );
      expect(result.success).toBe(true);

      // Paid -> Confirmed
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "paid",
        "confirmed",
        { reason: "Booking confirmed" }
      );
      expect(result.success).toBe(true);

      // Confirmed -> Checked In
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "confirmed",
        "checked_in",
        { reason: "Check-in completed" }
      );
      expect(result.success).toBe(true);

      // Checked In -> Boarded
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "checked_in",
        "boarded",
        { reason: "Passenger boarded" }
      );
      expect(result.success).toBe(true);

      // Boarded -> Completed
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "boarded",
        "completed",
        { reason: "Flight completed" }
      );
      expect(result.success).toBe(true);
    });

    it("should allow cancellation and refund flow", async () => {
      const bookingId = 101;
      const bookingRef = "TEST02";

      // Confirmed -> Cancelled
      let result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "confirmed",
        "cancelled",
        { reason: "Customer requested cancellation" }
      );
      expect(result.success).toBe(true);

      // Cancelled -> Refunded
      result = await transitionBookingStatus(
        bookingId,
        bookingRef,
        "cancelled",
        "refunded",
        { reason: "Refund processed" }
      );
      expect(result.success).toBe(true);
    });
  });
});
