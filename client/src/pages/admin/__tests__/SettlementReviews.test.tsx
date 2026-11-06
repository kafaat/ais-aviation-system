import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";
import SettlementReviews from "../SettlementReviews";

const auth = vi.hoisted(() => ({ role: "admin", language: "en" }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 9, role: auth.role }, loading: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: auth.language } }),
}));

const original = {
  paymentIntentId: "pi_review",
  kind: "booking",
  bookingId: 73,
  userId: 11,
  targetId: 73,
  amount: 12345,
  currency: "SAR",
  refundedAmount: 2345,
  settlementStatus: "review_required",
  settlementError: "Awaiting inventory reconciliation",
  createdAt: new Date("2026-11-05T08:00:00Z"),
};
let receipt: typeof original;
let fixture: ReturnType<typeof createTrpcFixture>;
beforeEach(() => {
  auth.role = "admin";
  auth.language = "en";
  receipt = { ...original };
});
afterEach(() => fixture?.cache.clear());
function mount(handlers: Parameters<typeof createTrpcFixture>[0] = {}) {
  fixture = createTrpcFixture({
    "payments.settlementReviews": () =>
      receipt.settlementStatus === "review_required" ? [receipt] : [],
    "payments.settlementReview": () => receipt,
    "payments.refundSettlementReview": () => ({
      state: "awaiting_webhook",
      refundId: "re_pending",
    }),
    ...handlers,
  });
  return render(<SettlementReviews />, { wrapper: fixture.Wrapper });
}
async function openReview() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Review pi_review" })
  );
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("123.45 SAR");
  return dialog;
}
const refundCalls = () =>
  fixture.requests.filter(
    item => item.path === "payments.refundSettlementReview"
  );

describe("settlement review operator consumer", () => {
  it("loads serialized dates and minor units without creating a refund", async () => {
    mount();
    const dialog = await openReview();
    expect(within(dialog).getByText("23.45 SAR")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Awaiting inventory reconciliation/)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Settlement requires review.")
    ).toBeInTheDocument();
    expect(refundCalls()).toEqual([]);
  });

  it("requires confirmation, serializes only the selected intent, and waits for verified completion", async () => {
    const pending = deferred<{ state: "awaiting_webhook"; refundId: string }>();
    mount({ "payments.refundSettlementReview": () => pending.promise });
    const dialog = await openReview();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Request or retry refund" })
    );
    expect(refundCalls()).toEqual([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm refund request" })
    );
    await waitFor(() => expect(refundCalls()).toHaveLength(1));
    expect(refundCalls()[0].input).toEqual({ paymentIntentId: "pi_review" });
    expect(
      within(dialog).getByRole("button", { name: "Sending request…" })
    ).toBeDisabled();
    await act(async () =>
      pending.resolve({ state: "awaiting_webhook", refundId: "re_pending" })
    );
    expect(
      await within(dialog).findByText(
        "Request acknowledged; awaiting verified provider confirmation."
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(
        "Refund confirmed by the recorded financial evidence."
      )
    ).not.toBeInTheDocument();
    receipt = {
      ...receipt,
      refundedAmount: receipt.amount,
      settlementStatus: "review_refunded",
    };
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Refresh details" })
    );
    expect(
      await within(dialog).findByText(
        "Refund confirmed by the recorded financial evidence."
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Request or retry refund" })
    ).not.toBeInTheDocument();
    expect(refundCalls()).toHaveLength(1);
  });

  it("retains errors and retries only after another explicit confirmation click", async () => {
    let attempts = 0;
    mount({
      "payments.refundSettlementReview": () => {
        if (++attempts === 1)
          throw new Error("Departure reconciliation required");
        return { state: "awaiting_webhook", refundId: "re_retry" };
      },
    });
    const dialog = await openReview();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Request or retry refund" })
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm refund request" })
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Departure reconciliation required"
    );
    expect(refundCalls()).toHaveLength(1);
    expect(
      within(dialog).getByText("Settlement requires review.")
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm refund request" })
    );
    expect(
      await within(dialog).findByText(
        "Request acknowledged; awaiting verified provider confirmation."
      )
    ).toBeInTheDocument();
    expect(refundCalls()).toHaveLength(2);
  });

  it("recovers a failed list read and displays an honest empty queue", async () => {
    let first = true;
    mount({
      "payments.settlementReviews": () => {
        if (first) throw new Error("Queue unavailable");
        return [];
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Queue unavailable"
    );
    expect(
      screen.queryByText("No pending settlement reviews.")
    ).not.toBeInTheDocument();
    first = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(
      await screen.findByText("No pending settlement reviews.")
    ).toBeInTheDocument();
    expect(refundCalls()).toHaveLength(0);
  });

  it("reopens pending server evidence after remount without claiming completion", async () => {
    const view = mount();
    await openReview();
    view.unmount();
    fixture.cache.clear();
    mount();
    const dialog = await openReview();
    expect(
      within(dialog).getByText("Settlement requires review.")
    ).toBeInTheDocument();
    expect(refundCalls()).toEqual([]);
  });

  it.each(["user", "support", "airline_admin", "finance"])(
    "does not request operator data as %s",
    async role => {
      auth.role = role;
      mount();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Platform administrator access is required"
      );
      await act(async () => Promise.resolve());
      expect(fixture.requests).toEqual([]);
    }
  );

  it("supports super_admin and Arabic layout", async () => {
    auth.role = "super_admin";
    auth.language = "ar";
    mount();
    expect(
      await screen.findByRole("button", { name: "مراجعة pi_review" })
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("dir", "rtl");
  });
});
