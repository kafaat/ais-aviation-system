import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaggageEntitlement } from "./BaggageEntitlement";
const state = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc", () => ({
  trpc: { bookings: { baggageEntitlements: { useQuery: () => state.query } } },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
afterEach(cleanup);
const row = {
  passengerId: 11,
  segmentId: 21,
  segmentOrder: 1,
  flightId: 31,
  totalWeightGrams: 33000,
  maxBagWeightGrams: 32000,
  requiresOperationalReview: false,
  warnings: [],
};
describe("baggage allowance presentation", () => {
  it("shows the scoped total and independent piece limit", () => {
    state.query = {
      data: [
        row,
        { ...row, passengerId: 12, totalWeightGrams: 99000 },
        { ...row, segmentId: 22, flightId: 32, totalWeightGrams: 88000 },
      ],
    };
    render(<BaggageEntitlement bookingId={7} passengerId={11} flightId={31} />);
    expect(screen.getByText(/33 kg verified/)).toBeTruthy();
    expect(screen.getByText(/Maximum per bag: 32 kg/)).toBeTruthy();
    expect(screen.queryByText(/99 kg|88 kg/)).toBeNull();
  });
  it("marks incomplete funding as provisional instead of silently granting weight", () => {
    state.query = {
      data: [
        {
          ...row,
          totalWeightGrams: 23000,
          requiresOperationalReview: true,
          warnings: ["missing_funding"],
        },
      ],
    };
    render(<BaggageEntitlement bookingId={7} passengerId={11} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Allowance is not final"
    );
    expect(screen.getByText("Item funding is incomplete")).toBeTruthy();
    expect(screen.getByText(/23 kg verified/)).toBeTruthy();
  });
  it("does not turn read failures into a default allowance", () => {
    state.query = { error: new Error("offline") };
    render(<BaggageEntitlement bookingId={7} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be verified"
    );
    expect(screen.queryByText(/kg verified/)).toBeNull();
  });
});
