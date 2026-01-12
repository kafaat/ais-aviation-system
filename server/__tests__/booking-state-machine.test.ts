import { describe, it, expect, beforeEach, vi } from "vitest";
import { isValidTransition, VALID_BOOKING_TRANSITIONS } from "../../drizzle/booking-status-history-schema";

describe("Booking State Machine", () => {
  describe("State Transition Validation", () => {
    it("should allow initiated as first status", () => {
      expect(isValidTransition(null, "initiated")).toBe(true);
    });

    it("should not allow any status other than initiated as first status", () => {
      expect(isValidTransition(null, "reserved")).toBe(false);
      expect(isValidTransition(null, "paid")).toBe(false);
      expect(isValidTransition(null, "cancelled")).toBe(false);
    });

    it("should allow initiated -> reserved transition", () => {
      expect(isValidTransition("initiated", "reserved")).toBe(true);
    });

    it("should allow initiated -> expired transition", () => {
      expect(isValidTransition("initiated", "expired")).toBe(true);
    });

    it("should allow initiated -> cancelled transition", () => {
      expect(isValidTransition("initiated", "cancelled")).toBe(true);
    });

    it("should allow reserved -> paid transition", () => {
      expect(isValidTransition("reserved", "paid")).toBe(true);
    });

    it("should allow reserved -> expired transition", () => {
      expect(isValidTransition("reserved", "expired")).toBe(true);
    });

    it("should allow reserved -> cancelled transition", () => {
      expect(isValidTransition("reserved", "cancelled")).toBe(true);
    });

    it("should allow paid -> ticketed transition", () => {
      expect(isValidTransition("paid", "ticketed")).toBe(true);
    });

    it("should allow paid -> payment_failed transition", () => {
      expect(isValidTransition("paid", "payment_failed")).toBe(true);
    });

    it("should allow paid -> cancelled transition", () => {
      expect(isValidTransition("paid", "cancelled")).toBe(true);
    });

    it("should allow ticketed -> checked_in transition", () => {
      expect(isValidTransition("ticketed", "checked_in")).toBe(true);
    });

    it("should allow ticketed -> no_show transition", () => {
      expect(isValidTransition("ticketed", "no_show")).toBe(true);
    });

    it("should allow checked_in -> boarded transition", () => {
      expect(isValidTransition("checked_in", "boarded")).toBe(true);
    });

    it("should allow boarded -> flown transition", () => {
      expect(isValidTransition("boarded", "flown")).toBe(true);
    });

    it("should allow cancelled -> refunded transition if paid", () => {
      expect(isValidTransition("cancelled", "refunded")).toBe(true);
    });

    it("should not allow invalid transitions", () => {
      // Can't go backwards
      expect(isValidTransition("paid", "reserved")).toBe(false);
      expect(isValidTransition("ticketed", "paid")).toBe(false);
      expect(isValidTransition("checked_in", "ticketed")).toBe(false);
      
      // Can't skip states
      expect(isValidTransition("initiated", "paid")).toBe(false);
      expect(isValidTransition("reserved", "ticketed")).toBe(false);
      expect(isValidTransition("paid", "checked_in")).toBe(false);
      
      // Terminal states can't transition
      expect(isValidTransition("flown", "cancelled")).toBe(false);
      expect(isValidTransition("refunded", "paid")).toBe(false);
      expect(isValidTransition("no_show", "checked_in")).toBe(false);
    });

    it("should prevent double booking by enforcing reserved state", () => {
      // Can't go directly to paid without reservation
      expect(isValidTransition("initiated", "paid")).toBe(false);
    });

    it("should allow retry after payment failure", () => {
      expect(isValidTransition("payment_failed", "reserved")).toBe(true);
      expect(isValidTransition("payment_failed", "cancelled")).toBe(true);
    });

    it("should allow retry after expiration", () => {
      expect(isValidTransition("expired", "reserved")).toBe(true);
    });
  });

  describe("State Machine Configuration", () => {
    it("should have all required states defined", () => {
      const requiredStates = [
        "initiated",
        "reserved",
        "paid",
        "ticketed",
        "checked_in",
        "boarded",
        "flown",
        "expired",
        "payment_failed",
        "cancelled",
        "refunded",
        "no_show"
      ];

      requiredStates.forEach(state => {
        expect(VALID_BOOKING_TRANSITIONS).toHaveProperty(state);
      });
    });

    it("should define terminal states with no transitions", () => {
      expect(VALID_BOOKING_TRANSITIONS["flown"]).toEqual([]);
      expect(VALID_BOOKING_TRANSITIONS["refunded"]).toEqual([]);
      expect(VALID_BOOKING_TRANSITIONS["no_show"]).toEqual([]);
    });

    it("should enforce seat hold TTL through state transitions", () => {
      // Reserved state should be able to expire
      expect(VALID_BOOKING_TRANSITIONS["reserved"]).toContain("expired");
      
      // Initiated state should be able to expire
      expect(VALID_BOOKING_TRANSITIONS["initiated"]).toContain("expired");
    });
  });

  describe("Business Logic Validation", () => {
    it("should prevent overselling by requiring reserved state before payment", () => {
      // Must go through reserved state
      expect(isValidTransition("initiated", "reserved")).toBe(true);
      expect(isValidTransition("reserved", "paid")).toBe(true);
      
      // Can't skip reservation
      expect(isValidTransition("initiated", "paid")).toBe(false);
    });

    it("should support cancellation at any non-terminal state", () => {
      const cancelableStates = ["initiated", "reserved", "paid", "ticketed"];
      
      cancelableStates.forEach(state => {
        expect(VALID_BOOKING_TRANSITIONS[state]).toContain("cancelled");
      });
    });

    it("should support refund only after cancellation", () => {
      expect(VALID_BOOKING_TRANSITIONS["cancelled"]).toContain("refunded");
      
      // Can't refund without cancellation
      expect(VALID_BOOKING_TRANSITIONS["paid"]).not.toContain("refunded");
      expect(VALID_BOOKING_TRANSITIONS["ticketed"]).not.toContain("refunded");
    });

    it("should handle no-show scenario", () => {
      // No-show possible from ticketed or checked_in
      expect(VALID_BOOKING_TRANSITIONS["ticketed"]).toContain("no_show");
      expect(VALID_BOOKING_TRANSITIONS["checked_in"]).toContain("no_show");
      
      // No-show is terminal
      expect(VALID_BOOKING_TRANSITIONS["no_show"]).toEqual([]);
    });
  });
});
