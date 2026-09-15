import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InternalFundingRefund } from "../InternalFundingRefund";
const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  pending: false,
  failed: false,
  data: undefined as
    | undefined
    | {
        ledgerId: number;
        amount: number;
        remaining: number;
        cancelled: boolean;
      },
}));
vi.mock("../OperationalReadState", () => ({
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    refunds: {
      refundInternalFunding: {
        useMutation: () => ({
          mutate: state.mutate,
          reset: state.reset,
          isPending: state.pending,
          isError: state.failed,
          error: { message: "Connection interrupted" },
          isSuccess: !!state.data,
          data: state.data,
        }),
      },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = state.failed = false;
  state.data = undefined;
});
function fill(amount = "30.01") {
  for (const [label, value] of [
    ["Booking ID", "7"],
    ["Amount in SAR", amount],
    ["Finance approval reference", "CASE-7"],
    ["Refund reason", "Approved refund"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
describe("original funding refund command", () => {
  it("preserves both integer amount and request identity after an ambiguous failure", () => {
    const view = render(<InternalFundingRefund />);
    fill();
    fireEvent.click(screen.getByText("Execute approved refund"));
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3001,
        bookingId: 7,
        cancelItinerary: false,
        approvalReference: "CASE-7",
      })
    );
    const first = state.mutate.mock.calls[0][0];
    state.failed = true;
    view.rerender(<InternalFundingRefund />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connection interrupted"
    );
    expect(screen.queryByText(/Refund receipt/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount in SAR")).toBeDisabled();
    fireEvent.click(screen.getByText("Retry the same request"));
    expect(state.mutate.mock.calls[1][0]).toEqual(first);
  });
  it("rejects fractional minor units before starting a money command", () => {
    render(<InternalFundingRefund />);
    fill("30.001");
    fireEvent.click(screen.getByText("Execute approved refund"));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeVisible();
  });
  it("shows completion only from the returned ledger receipt and itinerary outcome", () => {
    state.data = {
      ledgerId: 91,
      amount: 3001,
      remaining: 6999,
      cancelled: false,
    };
    render(<InternalFundingRefund />);
    expect(screen.getByRole("status")).toHaveTextContent("#91: 30.01 SAR");
    expect(screen.getByRole("status")).toHaveTextContent("Itinerary retained");
    expect(
      screen.queryByText("Execute approved refund")
    ).not.toBeInTheDocument();
  });
});
