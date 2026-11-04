import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusManager } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";
import RefundsDashboard from "../RefundsDashboard";

const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: notifications }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/components/ExportReportButton", () => ({
  ExportReportButton: () => null,
}));
vi.mock("@/components/InternalFundingRefund", () => ({
  InternalFundingRefund: () => null,
}));

type PlanStatus = "review_required" | "processing" | "completed";
function detail(status: PlanStatus = "review_required") {
  return {
    quote: null,
    plan: {
      status,
      totalAmount: 10000,
      cancellationFee: 1000,
      refundAmount: 9000,
      items: [
        {
          splitId: 701,
          payerName: "Payer one",
          paidAmount: 10000,
          refundAmount: 9000,
          status:
            status === "review_required"
              ? "review_required"
              : status === "processing"
                ? "pending"
                : "settled",
          errorCode:
            status === "review_required" ? "unknown_provider_outcome" : null,
        },
      ],
    },
  };
}
const stats = {
  totalRefunds: 2,
  refundedBookings: 1,
  totalRefundedAmount: 7501,
  refundRate: 25,
  pendingRefunds: 3,
  pendingRefundAmount: 3001,
  reviewRequiredRefunds: 1,
  reviewRequiredAmount: 4500,
  retainedCancellationFees: 2500,
};
type Handler = (input: unknown) => unknown | Promise<unknown>;
let handlers: Record<string, Handler>;
let caches: Array<ReturnType<typeof createTrpcFixture>["cache"]>;
beforeEach(() => {
  vi.clearAllMocks();
  caches = [];
  handlers = {
    "refunds.getStats": () => stats,
    "refunds.getHistory": () => [],
    "refunds.getTrends": () => [],
    "refunds.splitCancellationQueue": () => ({
      items: [{ bookingId: 90, refundAmount: 9000 }],
      nextCursor: null,
    }),
    "refunds.splitCancellation": () => detail(),
    "refunds.resumeSplitCancellation": () => ({ status: "processing" }),
  };
});
afterEach(() => {
  caches.forEach(cache => cache.clear());
  vi.restoreAllMocks();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

async function visit() {
  const fixture = createTrpcFixture(handlers);
  caches.push(fixture.cache);
  const view = render(<RefundsDashboard />, { wrapper: fixture.Wrapper });
  await screen.findByRole("heading", { name: "admin.refunds.title" });
  return {
    ...fixture,
    ...view,
    calls: (path: string) =>
      fixture.requests.filter(request => request.path === `refunds.${path}`),
  };
}
async function openDetail() {
  fireEvent.click(
    await screen.findByRole("button", { name: "cancelBooking.split.track" })
  );
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("status");
  return dialog;
}

describe("refund dashboard interactions through real tRPC hooks", () => {
  it("pages by the supplied cursor and resets it when the status filter changes", async () => {
    handlers["refunds.splitCancellationQueue"] = input => {
      const value = input as { beforeBookingId?: number; status: PlanStatus };
      if (value.status === "completed")
        return {
          items: [{ bookingId: 200, refundAmount: 5001 }],
          nextCursor: null,
        };
      return value.beforeBookingId === undefined
        ? { items: [{ bookingId: 90, refundAmount: 9000 }], nextCursor: 90 }
        : { items: [{ bookingId: 80, refundAmount: 7000 }], nextCursor: null };
    };
    const page = await visit();
    expect(page.calls("splitCancellation")).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "cancelBooking.split.more" })
    );
    await screen.findByText("#80 — 70.00 common.sar");
    expect(page.calls("splitCancellationQueue").at(-1)?.input).toEqual({
      status: "review_required",
      beforeBookingId: 90,
    });
    fireEvent.change(screen.getByLabelText("cancelBooking.split.status"), {
      target: { value: "completed" },
    });
    await screen.findByText("#200 — 50.01 common.sar");
    expect(page.calls("splitCancellationQueue").at(-1)?.input).toEqual({
      status: "completed",
      beforeBookingId: undefined,
    });
    expect(
      screen.queryByText("#80 — 70.00 common.sar")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "cancelBooking.split.more" })
    ).not.toBeInTheDocument();
  });

  it("refreshes detail, queue, statistics, history and trends after real resume mutations", async () => {
    let phase: PlanStatus = "review_required";
    handlers["refunds.splitCancellation"] = () => detail(phase);
    handlers["refunds.splitCancellationQueue"] = input => ({
      items:
        (input as { status: PlanStatus }).status === phase
          ? [{ bookingId: 90, refundAmount: 9000 }]
          : [],
      nextCursor: null,
    });
    handlers["refunds.resumeSplitCancellation"] = () => {
      phase = phase === "review_required" ? "processing" : "completed";
      return { status: phase };
    };
    const page = await visit();
    const dialog = await openDetail();
    const endpoints = [
      "splitCancellation",
      "splitCancellationQueue",
      "getStats",
      "getHistory",
      "getTrends",
    ];
    for (const next of ["processing", "completed"]) {
      const before = endpoints.map(path => page.calls(path).length);
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "cancelBooking.split.resume",
        })
      );
      await waitFor(() =>
        expect(within(dialog).getByRole("status")).toHaveTextContent(
          `cancelBooking.split.plan.${next}`
        )
      );
      await waitFor(() =>
        endpoints.forEach((path, index) =>
          expect(page.calls(path)).toHaveLength(before[index] + 1)
        )
      );
    }
    expect(
      page.calls("resumeSplitCancellation").map(call => call.input)
    ).toEqual([
      { bookingId: 90, splitId: 701 },
      { bookingId: 90, splitId: 701 },
    ]);
    expect(
      within(dialog).queryByRole("button", {
        name: "cancelBooking.split.resume",
      })
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.change(screen.getByLabelText("cancelBooking.split.status"), {
      target: { value: "completed" },
    });
    await screen.findByText("#90 — 90.00 common.sar");
    expect(
      page
        .calls("getHistory")
        .every(call => (call.input as { limit: number }).limit === 20)
    ).toBe(true);
  });

  it("refreshes after a failed resume and leaves uncertain money out of a completed state", async () => {
    handlers["refunds.resumeSplitCancellation"] = () => {
      throw new Error("Provider outcome requires review");
    };
    const page = await visit();
    const dialog = await openDetail();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "cancelBooking.split.resume" })
    );
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith(
        "Provider outcome requires review"
      )
    );
    await waitFor(() =>
      expect(page.calls("splitCancellation")).toHaveLength(2)
    );
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "cancelBooking.split.plan.review_required"
    );
    expect(
      within(dialog).getByRole("button", { name: "cancelBooking.split.resume" })
    ).toBeEnabled();
    expect(notifications.success).not.toHaveBeenCalled();
  });

  it("polls only an open selected detail and stops after closing it", async () => {
    // Keep HTTP batching and React notifications on real timers. Only the
    // query observer's polling interval is advanced by this test.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    focusManager.setFocused(true);
    const intervals = vi.spyOn(globalThis, "setInterval");
    const clearIntervals = vi.spyOn(globalThis, "clearInterval");
    let reads = 0;
    handlers["refunds.splitCancellation"] = () =>
      detail(++reads === 1 ? "review_required" : "processing");
    const commitNotifications = async () => {
      // An idle cache can precede React Query's queued notification and the
      // effect that commits observer options. Drain that real timer inside
      // act before measuring the interval owned by the committed observer.
      await act(async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });
    };
    const page = await visit();
    expect(page.calls("splitCancellation")).toEqual([]);
    const dialog = await openDetail();
    expect(page.calls("splitCancellation")).toHaveLength(1);
    await waitFor(() => expect(page.cache.isFetching()).toBe(0));
    await commitNotifications();
    const selectedQuery = page.cache.getQueryCache().find({
      queryKey: getQueryKey(
        trpc.refunds.splitCancellation,
        { bookingId: 90 },
        "query"
      ),
      exact: true,
    });
    expect(selectedQuery?.getObserversCount()).toBe(1);
    expect(selectedQuery?.observers[0].options).toMatchObject({
      enabled: true,
      refetchInterval: 5000,
    });
    expect(intervals.mock.calls.some(call => call[1] === 5000)).toBe(true);
    // Advance synchronously: an asynchronous tick lets real notifications
    // re-arm the interval midway through the artificial five-second jump.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() =>
      expect(page.calls("splitCancellation")).toHaveLength(2)
    );
    await within(dialog).findByText("cancelBooking.split.plan.processing");
    await waitFor(() => expect(page.cache.isFetching()).toBe(0));
    await commitNotifications();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await commitNotifications();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(selectedQuery?.getObserversCount()).toBe(0);
    intervals.mock.calls.forEach((call, index) => {
      if (call[1] === 5000)
        expect(clearIntervals).toHaveBeenCalledWith(
          intervals.mock.results[index].value
        );
    });
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    // Flush any HTTP batch that an orphaned interval would have queued, so
    // the no-request assertion cannot pass before the request is dispatched.
    await commitNotifications();
    expect(page.calls("splitCancellation")).toHaveLength(2);
    expect(
      page
        .calls("splitCancellation")
        .every(call => (call.input as { bookingId: number }).bookingId === 90)
    ).toBe(true);
    page.unmount();
    page.cache.clear();
  });

  it("discards a late detail from a closed dialog before opening another booking", async () => {
    const old = deferred<ReturnType<typeof detail>>();
    handlers["refunds.splitCancellationQueue"] = () => ({
      items: [
        { bookingId: 90, refundAmount: 9000 },
        { bookingId: 80, refundAmount: 8000 },
      ],
      nextCursor: null,
    });
    handlers["refunds.splitCancellation"] = input =>
      (input as { bookingId: number }).bookingId === 90
        ? old.promise
        : detail("completed");
    const page = await visit();
    fireEvent.click(
      screen.getAllByRole("button", { name: "cancelBooking.split.track" })[0]
    );
    await waitFor(() =>
      expect(page.calls("splitCancellation")).toHaveLength(1)
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" })
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "cancelBooking.split.track" })[1]
    );
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("cancelBooking.split.plan.completed");
    await act(async () => old.resolve(detail("review_required")));
    await waitFor(() => expect(page.cache.isFetching()).toBe(0));
    expect(within(dialog).getByText("#80")).toBeVisible();
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "cancelBooking.split.plan.completed"
    );
    expect(
      within(dialog).queryByText("cancelBooking.split.plan.review_required")
    ).not.toBeInTheDocument();
  });

  it("distinguishes queue and detail failures from empty or completed results", async () => {
    handlers["refunds.splitCancellationQueue"] = () => {
      throw new Error("Queue temporarily unavailable");
    };
    const page = await visit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Queue temporarily unavailable"
    );
    handlers["refunds.splitCancellationQueue"] = () => ({
      items: [{ bookingId: 90, refundAmount: 9000 }],
      nextCursor: null,
    });
    handlers["refunds.splitCancellation"] = () => {
      throw new Error("Detail temporarily unavailable");
    };
    fireEvent.change(screen.getByLabelText("cancelBooking.split.status"), {
      target: { value: "processing" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "cancelBooking.split.track" })
    );
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Detail temporarily unavailable"
    );
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    expect(page.calls("resumeSplitCancellation")).toEqual([]);
  });

  it.each(["getStats", "getHistory", "getTrends"])(
    "recovers a failed %s read through its actual retry button",
    async endpoint => {
      const path = `refunds.${endpoint}`;
      const original = handlers[path];
      handlers[path] = () => {
        throw new Error("Temporary read failure");
      };
      const page = await visit();
      await screen.findByRole("alert");
      handlers[path] = original;
      fireEvent.click(
        screen.getByRole("button", { name: "admin.refunds.retry" })
      );
      await waitFor(() =>
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      );
      expect(page.calls(endpoint)).toHaveLength(2);
      expect(await screen.findByText("75.01")).toBeVisible();
    }
  );
});
