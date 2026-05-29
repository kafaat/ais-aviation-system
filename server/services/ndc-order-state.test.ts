import { describe, it, expect } from "vitest";
import {
  isValidNdcOrderTransition,
  getValidNdcOrderTransitions,
  isTerminalNdcOrderStatus,
  canTransitionTo,
  assertNdcOrderTransition,
  NDC_ORDER_TRANSITIONS,
  type NdcOrderStatus,
} from "./ndc-order-state";

describe("NDC order state machine", () => {
  it("allows the core forward transitions", () => {
    expect(isValidNdcOrderTransition("pending", "confirmed")).toBe(true);
    expect(isValidNdcOrderTransition("confirmed", "ticketed")).toBe(true);
    expect(isValidNdcOrderTransition("ticketed", "refunded")).toBe(true);
    expect(isValidNdcOrderTransition("cancelled", "refunded")).toBe(true);
  });

  it("rejects invalid / backward transitions", () => {
    expect(isValidNdcOrderTransition("refunded", "confirmed")).toBe(false);
    expect(isValidNdcOrderTransition("cancelled", "ticketed")).toBe(false);
    expect(isValidNdcOrderTransition("pending", "refunded")).toBe(false);
  });

  it("treats same-state as not a transition", () => {
    expect(isValidNdcOrderTransition("pending", "pending")).toBe(false);
  });

  it("permits cancellation from every non-terminal, non-cancelled state", () => {
    const cancellableFrom: NdcOrderStatus[] = [
      "pending",
      "confirmed",
      "ticketed",
      "partially_ticketed",
      "changed",
    ];
    for (const s of cancellableFrom) {
      expect(canTransitionTo(s, "cancelled")).toBe(true);
    }
    expect(canTransitionTo("cancelled", "cancelled")).toBe(false);
    expect(canTransitionTo("refunded", "cancelled")).toBe(false);
  });

  it("marks refunded as the only terminal state", () => {
    expect(isTerminalNdcOrderStatus("refunded")).toBe(true);
    for (const s of Object.keys(NDC_ORDER_TRANSITIONS) as NdcOrderStatus[]) {
      if (s !== "refunded") expect(isTerminalNdcOrderStatus(s)).toBe(false);
    }
  });

  it("lists valid transitions", () => {
    expect(getValidNdcOrderTransitions("pending")).toContain("confirmed");
    expect(getValidNdcOrderTransitions("refunded")).toEqual([]);
  });

  it("assertNdcOrderTransition throws on an illegal move", () => {
    expect(() => assertNdcOrderTransition("refunded", "confirmed")).toThrow();
    expect(() =>
      assertNdcOrderTransition("pending", "confirmed")
    ).not.toThrow();
  });
});
