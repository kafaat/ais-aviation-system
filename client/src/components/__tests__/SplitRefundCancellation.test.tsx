import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SplitRefundCancellation } from "../SplitRefundCancellation";
const state = vi.hoisted(() => ({
  cancel: vi.fn(),
  resume: vi.fn(),
  pending: false,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    refunds: {
      cancelSplitBooking: {
        useMutation: () => ({ mutate: state.cancel, isPending: state.pending }),
      },
      resumeSplitCancellation: {
        useMutation: () => ({ mutate: state.resume, isPending: state.pending }),
      },
    },
  },
}));
const quote = {
  splitFunded: true,
  reason: null,
  plan: null,
  quote: {
    quoteHash: "a".repeat(64),
    totalAmount: 10001,
    refundAmount: 7501,
    cancellationFee: 2500,
    refundPercentage: 75,
    tier: "high" as const,
    items: [
      { splitId: 1, payerName: "A", paidAmount: 4001, refundAmount: 3001 },
      { splitId: 2, payerName: "B", paidAmount: 6000, refundAmount: 4500 },
    ],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.pending = false;
});
describe("split cancellation financial consent", () => {
  it("shows each allocation and submits only the reviewed server quote and notes", () => {
    render(
      <SplitRefundCancellation bookingId={7} data={quote} onRefresh={vi.fn()} />
    );
    expect(screen.getByText("30.01")).toBeInTheDocument();
    expect(screen.getByText("45.00")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("cancelBooking.additionalNotes"), {
      target: { value: "Travel plans changed" },
    });
    fireEvent.click(screen.getByText("cancelBooking.confirmCancel"));
    expect(state.cancel).toHaveBeenCalledWith({
      bookingId: 7,
      quoteHash: "a".repeat(64),
      reason: "requested_by_customer",
      notes: "Travel plans changed",
    });
    expect(state.resume).not.toHaveBeenCalled();
  });
  it("keeps partial progress visible and resumes only the requested payer", () => {
    const data = {
      ...quote,
      quote: null,
      plan: {
        id: "plan",
        status: "processing" as const,
        totalAmount: 10001,
        refundAmount: 7501,
        cancellationFee: 2500,
        items: quote.quote.items.map((i, n) => ({
          ...i,
          status: n ? ("requesting" as const) : ("succeeded" as const),
          refundedAmount: n ? 0 : i.refundAmount,
          refundId: n ? null : "re_1",
          errorCode: n ? "provider_unavailable" : null,
        })),
      },
    };
    render(
      <SplitRefundCancellation bookingId={7} data={data} onRefresh={vi.fn()} />
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "cancelBooking.split.plan.processing"
    );
    expect(
      screen.queryByText("cancelBooking.confirmCancel")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("cancelBooking.split.resume"));
    expect(state.resume).toHaveBeenCalledWith({ bookingId: 7, splitId: 2 });
  });
  it("does not turn a failed refund into a new money request", () => {
    const data = {
      ...quote,
      quote: null,
      plan: {
        id: "plan",
        status: "review_required" as const,
        totalAmount: 10001,
        refundAmount: 7501,
        cancellationFee: 2500,
        items: quote.quote.items.map(i => ({
          ...i,
          status: "failed" as const,
          refundedAmount: 0,
          refundId: "re_fail",
          errorCode: "provider_refund_failed",
        })),
      },
    };
    render(
      <SplitRefundCancellation bookingId={7} data={data} onRefresh={vi.fn()} />
    );
    expect(screen.getByRole("status")).toHaveTextContent("review_required");
    expect(
      screen.queryByText("cancelBooking.split.resume")
    ).not.toBeInTheDocument();
  });
  it("shows unavailable quotes without a confirm button and disables duplicate clicks", () => {
    const { rerender } = render(
      <SplitRefundCancellation
        bookingId={7}
        data={{
          splitFunded: true,
          quote: null,
          plan: null,
          reason: "Review required",
        }}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Review required");
    state.pending = true;
    rerender(
      <SplitRefundCancellation bookingId={7} data={quote} onRefresh={vi.fn()} />
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
