import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CouponMonthReview } from "../CouponMonthReview";

const state = vi.hoisted(() => ({
  error: null as { message: string } | null,
  retry: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    revenueAccounting: {
      couponMonthReview: {
        useQuery: () => ({
          isFetching: false,
          error: state.error,
          refetch: state.retry,
          data: {
            closedMonth: true,
            cashNetInMonthMinor: 0,
            transportRecognizedInMonthMinor: null,
            transportDeferredMinor: 12345,
            loyaltyDeferredMinor: null,
            issues: [],
            coupons: [
              {
                couponId: 101,
                flightId: 202,
                passengerId: 303,
                status: "flown",
                baseFareMinor: 12345,
                upliftEvidenceId: 404,
              },
              {
                couponId: 102,
                flightId: 203,
                passengerId: 304,
                status: "open",
                baseFareMinor: null,
                upliftEvidenceId: null,
              },
            ],
          },
        }),
      },
    },
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
beforeEach(() => {
  state.error = null;
});

it("exposes existing coupon evidence and separates unknown values from zero", () => {
  render(<CouponMonthReview />);
  const table = screen.getByRole("table", { name: "Local coupon evidence" });
  const flown = within(table).getByText("101").closest("tr")!;
  for (const value of ["202", "303", "flown", "123.45 SAR", "404"]) {
    expect(within(flown).getByText(value)).toBeVisible();
  }
  const open = within(table).getByText("102").closest("tr")!;
  expect(within(open).getAllByText("Unverified")).toHaveLength(2);
  expect(screen.getByText("0.00 SAR")).toBeVisible();
  const button = screen.getByRole("button", { name: "Review coupon evidence" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Booking ID"), {
    target: { value: "1" },
  });
  fireEvent.click(button);
  expect(state.retry).toHaveBeenCalledOnce();
});

it("hides cached coupon evidence when the requested review fails", () => {
  state.error = { message: "Review source unavailable" };
  render(<CouponMonthReview />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Review source unavailable"
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
