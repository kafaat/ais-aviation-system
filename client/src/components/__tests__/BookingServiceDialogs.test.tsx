import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { CancelBookingDialog } from "../CancelBookingDialog";
import { ModifyBookingDialog } from "../ModifyBookingDialog";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";
import i18n from "@/i18n/config";

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function elapse(milliseconds = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

type Handlers = Parameters<typeof createTrpcFixture>[0];
async function cancellation(overrides: Handlers = {}) {
  const fixture = createTrpcFixture({
    "refunds.splitCancellation": () => ({
      splitFunded: false,
      plan: null,
      quote: null,
      reason: null,
    }),
    "refunds.cancellationReceipt": () => null,
    "refunds.checkRefundable": () => ({ refundable: true }),
    "refunds.calculateCancellationFee": () => ({
      tier: "high",
      totalAmount: 10000,
      refundAmount: 7500,
      cancellationFee: 2500,
      refundPercentage: 75,
    }),
    ...overrides,
  });
  const success = vi.fn();
  const close = vi.fn();
  render(
    <fixture.Wrapper>
      <CancelBookingDialog
        bookingId={7}
        bookingReference="BOOK007"
        totalAmount={10000}
        open
        onSuccess={success}
        onOpenChange={close}
      />
    </fixture.Wrapper>
  );
  await elapse();
  return { ...fixture, success, close };
}

it("keeps the returned refund receipt visible until the passenger closes it", async () => {
  const reply = deferred<{
    success: boolean;
    refundId: string;
    amount: number;
    status: string;
    cumulativeRefundedAmount: number;
    remainingRefundableAmount: number;
  }>();
  const { requests, success, close } = await cancellation({
    "refunds.create": () => reply.promise,
  });
  expect(screen.getByText(/75\.00/)).toBeVisible();
  expect(screen.getByText(/-25\.00/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("radio", { name: i18n.t("cancelBooking.reasonDuplicate") })
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("cancelBooking.confirmCancel") })
  );
  await elapse();
  expect(requests.filter(request => request.path === "refunds.create")).toEqual(
    [{ path: "refunds.create", input: { bookingId: 7, reason: "duplicate" } }]
  );
  expect(success).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: i18n.t("cancelBooking.processing") })
  ).toBeDisabled();
  await act(async () =>
    reply.resolve({
      success: true,
      refundId: "re_cash_007",
      amount: 7500,
      status: "succeeded",
      cumulativeRefundedAmount: 7500,
      remainingRefundableAmount: 2500,
    })
  );
  await elapse();
  expect(success).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText("re_cash_007")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Refund confirmed");
  expect(screen.getByText(/75\.00/)).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: i18n.t("cancelBooking.confirmCancel"),
    })
  ).not.toBeInTheDocument();
  expect(notices.success).toHaveBeenCalledWith(
    i18n.t("cancelBooking.receipt.recorded")
  );
  fireEvent.click(screen.getByRole("button", { name: "Close receipt" }));
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
});

it("shows a pending refund receipt without claiming that the provider confirmed it", async () => {
  const { close } = await cancellation({
    "refunds.create": () => ({
      success: true,
      refundId: "re_pending_007",
      amount: 7500,
      status: "pending",
      cumulativeRefundedAmount: 0,
      remainingRefundableAmount: 2500,
    }),
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("cancelBooking.confirmCancel") })
  );
  await elapse();
  expect(screen.getByText("re_pending_007")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Pending with provider");
  expect(screen.queryByText("Refund confirmed")).not.toBeInTheDocument();
  expect(notices.success).not.toHaveBeenCalledWith(
    i18n.t("cancelBooking.successMessage")
  );
  expect(close).not.toHaveBeenCalled();
});

it("retains the cancellation dialog and reports a refund failure without announcing success", async () => {
  const { success, close } = await cancellation({
    "refunds.create": () => {
      throw new Error("Refund requires reconciliation");
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("cancelBooking.confirmCancel") })
  );
  await elapse();
  expect(notices.error).toHaveBeenCalledWith("Refund requires reconciliation");
  expect(success).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(notices.success).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("prevents the regular refund flow when the server marks a booking non-refundable", async () => {
  const { requests } = await cancellation({
    "refunds.checkRefundable": () => ({
      refundable: false,
      reason: "Booking already flown",
    }),
  });
  expect(screen.getByText("Booking already flown")).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: i18n.t("cancelBooking.confirmCancel"),
    })
  ).not.toBeInTheDocument();
  expect(
    requests.some(request =>
      /calculateCancellationFee|refunds.create/.test(request.path)
    )
  ).toBe(false);
});

it("routes split funding to its own receipt review without requesting a regular refund", async () => {
  const { requests } = await cancellation({
    "refunds.splitCancellation": () => ({
      splitFunded: true,
      quote: null,
      plan: null,
      reason: "Split payer receipts require review",
    }),
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Split payer receipts require review"
  );
  expect(requests).toEqual([
    { path: "refunds.splitCancellation", input: { bookingId: 7 } },
  ]);
});

it("shows the split cancellation reference and each payer's confirmed refund reference", async () => {
  const { requests } = await cancellation({
    "refunds.splitCancellation": () => ({
      splitFunded: true,
      quote: null,
      reason: null,
      plan: {
        id: "plan_007",
        status: "completed",
        totalAmount: 10000,
        cancellationFee: 2500,
        refundAmount: 7500,
        items: [
          {
            splitId: 1,
            payerName: "First payer",
            paidAmount: 4000,
            refundAmount: 3000,
            refundedAmount: 3000,
            status: "succeeded",
            refundId: "re_first_payer",
            errorCode: null,
          },
          {
            splitId: 2,
            payerName: "Second payer",
            paidAmount: 6000,
            refundAmount: 4500,
            refundedAmount: 4500,
            status: "succeeded",
            refundId: "re_second_payer",
            errorCode: null,
          },
        ],
      },
    }),
  });
  expect(screen.getByText("plan_007")).toBeVisible();
  for (const [name, reference, amount] of [
    ["First payer", "re_first_payer", "30.00"],
    ["Second payer", "re_second_payer", "45.00"],
  ]) {
    const row = screen.getByRole("row", { name: new RegExp(name) });
    expect(within(row).getByText(reference)).toBeVisible();
    expect(within(row).getByText(amount)).toBeVisible();
    expect(within(row).getByText("Refund confirmed")).toBeVisible();
  }
  expect(screen.getByRole("status")).toHaveTextContent(
    "All planned refunds are confirmed"
  );
  expect(requests).toEqual([
    { path: "refunds.splitCancellation", input: { bookingId: 7 } },
  ]);
});

const sector = {
  flightId: 42,
  flightNumber: "TEST42",
  originId: 1,
  destinationId: 2,
  origin: "RUH",
  destination: "JED",
  originTimezone: "Asia/Riyadh",
  departureTime: new Date("2030-01-15T12:00:00Z"),
  status: "confirmed",
};
/** Digest of the quoted amounts; the server binds the passenger's consent to it. */
const QUOTE_VERSION = "c".repeat(64);
const quote = () => ({
  status: "pending",
  modificationId: 91,
  reviewRequired: false,
  quoteVersion: QUOTE_VERSION,
  totalCost: 0,
  originalAmount: 10000,
  newAmount: 10000,
  priceDifference: 0,
  modificationFee: 0,
  expiresAt: new Date(Date.now() + 60000),
  checkoutStarted: false,
  receiptId: null as null | string,
});

async function modification(overrides: Handlers = {}) {
  const fixture = createTrpcFixture({
    "auth.me": () => ({ id: 11, tenantId: 3, role: "user" }),
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: quote(),
    }),
    "flights.search": () => [
      {
        id: 43,
        flightNumber: "TEST43",
        departureTime: new Date("2030-01-16T12:00:00Z"),
        origin: { timezone: "Asia/Riyadh" },
      },
    ],
    ...overrides,
  });
  const view = render(
    <fixture.Wrapper>
      <ModifyBookingDialog
        open
        onOpenChange={vi.fn()}
        booking={{
          id: 7,
          bookingReference: "BOOK007",
          cabinClass: "economy",
          originName: "Riyadh",
          destinationName: "Jeddah",
        }}
      />
    </fixture.Wrapper>
  );
  await elapse();
  return { ...fixture, ...view };
}

it("never confirms a quote that carries no version to consent to", async () => {
  const { quoteVersion: _omitted, ...unversioned } = quote();
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: unversioned,
    }),
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.confirm"),
    })
  );
  await elapse();
  expect(
    requests.some(request =>
      /createModificationCheckout|confirmNoChargeService/.test(request.path)
    )
  ).toBe(false);
});

it("requires consent to the current quote and records a no-charge confirmation before showing its receipt", async () => {
  let latest = quote();
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({ sectors: [sector], latest }),
    "ndc.confirmNoChargeService": () => {
      latest = { ...latest, status: "completed", receiptId: "RECEIPT91" };
      return { success: true };
    },
  });
  const confirm = screen.getByRole("button", {
    name: i18n.t("modifyBooking.exchange.confirm"),
  });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(confirm).not.toBeDisabled();
  fireEvent.click(confirm);
  await elapse();
  expect(
    requests.filter(request => request.path === "ndc.confirmNoChargeService")
  ).toEqual([
    {
      path: "ndc.confirmNoChargeService",
      input: {
        modificationId: 91,
        consent: { quoteVersion: QUOTE_VERSION, totalCost: 0, currency: "SAR" },
      },
    },
  ]);
  expect(screen.getByText("RECEIPT91")).toBeVisible();
  expect(
    requests.some(
      request => request.path === "payments.createModificationCheckout"
    )
  ).toBe(false);
});

it("expires a consented quote exactly at its deadline and prevents confirmation", async () => {
  const current = quote();
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: current,
    }),
  });
  fireEvent.click(screen.getByRole("checkbox"));
  const confirm = screen.getByRole("button", {
    name: i18n.t("modifyBooking.exchange.confirm"),
  });
  await elapse(current.expiresAt.getTime() - Date.now() - 1);
  expect(confirm).toBeEnabled();
  await elapse(1);
  expect(
    screen.getByText(i18n.t("modifyBooking.exchange.expired"))
  ).toBeVisible();
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  await elapse();
  expect(
    requests.every(request =>
      ["auth.me", "modifications.exchangeContext"].includes(request.path)
    )
  ).toBe(true);
});

it("requires new consent when a status refresh replaces the quoted operation", async () => {
  let latest = quote();
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({ sectors: [sector], latest }),
  });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.confirm"),
    })
  ).toBeEnabled();
  latest = {
    ...quote(),
    modificationId: 92,
    totalCost: 2500,
    newAmount: 12500,
    priceDifference: 2500,
  };
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.refresh"),
    })
  );
  await elapse();
  expect(screen.getByRole("status")).toHaveTextContent("#92");
  expect(screen.getByRole("status")).toHaveTextContent("125.00");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  const confirm = screen.getByRole("button", {
    name: i18n.t("modifyBooking.exchange.confirm"),
  });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  await elapse();
  expect(
    requests.some(request =>
      /createModificationCheckout|confirmNoChargeService/.test(request.path)
    )
  ).toBe(false);
});

it("looks up the persisted quote after a lost mutation response instead of sending a second change", async () => {
  let latest: ReturnType<typeof quote> | null = null;
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({ sectors: [sector], latest }),
    "modifications.requestChangeDate": () => {
      latest = quote();
      throw new Error("Response lost after reservation");
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  expect(screen.getByRole("alert")).toHaveTextContent(
    i18n.t("modifyBooking.exchange.lookupFirst")
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.refresh"),
    })
  );
  await elapse();
  expect(screen.getByRole("status")).toHaveTextContent("#91");
  const changes = requests.filter(
    request => request.path === "modifications.requestChangeDate"
  );
  expect(changes).toHaveLength(1);
  expect(changes[0].input).toMatchObject({
    bookingId: 7,
    replaceFlightId: 42,
    newFlightId: 43,
  });
  expect(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.confirm"),
    })
  ).toBeDisabled();
});

it("keeps a paid-seat precondition visible and does not begin payment or confirmation", async () => {
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: null,
    }),
    "modifications.requestChangeDate": () => {
      throw Object.assign(new Error("Paid seat requires review"), {
        code: "PRECONDITION_FAILED",
      });
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  expect(screen.getByRole("alert")).toHaveTextContent(
    i18n.t("modifyBooking.exchange.seatReview")
  );
  expect(
    requests.some(request =>
      /createModificationCheckout|confirmNoChargeService/.test(request.path)
    )
  ).toBe(false);
});

it("preserves the unknown change request key through a missing quote lookup and a remounted dialog", async () => {
  const handlers: Handlers = {
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: null,
    }),
    "modifications.requestChangeDate": () => {
      throw new Error("Response lost before the outcome could be verified");
    },
  };
  const first = await modification(handlers);
  const requestQuote = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("modifyBooking.exchange.quote"),
      })
    );
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  requestQuote();
  await elapse();
  expect(screen.getByRole("alert")).toHaveTextContent(
    i18n.t("modifyBooking.exchange.lookupFirst")
  );
  expect(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.refresh"),
    })
  );
  await elapse();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  requestQuote();
  await elapse();
  const attempts = first.requests.filter(
    request => request.path === "modifications.requestChangeDate"
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1].input).toEqual(attempts[0].input);
  expect(attempts[0].input).toMatchObject({
    bookingId: 7,
    replaceFlightId: 42,
    newFlightId: 43,
    idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  // A new React tree and query cache model the dialog being opened after a
  // reload. sessionStorage remains the same browser tab's storage.
  first.unmount();
  first.cache.clear();
  const reloaded = await modification(handlers);
  expect(
    reloaded.requests.filter(
      request => request.path === "modifications.exchangeContext"
    )
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  requestQuote();
  await elapse();
  expect(
    reloaded.requests.filter(
      request => request.path === "modifications.requestChangeDate"
    )
  ).toEqual([
    { path: "modifications.requestChangeDate", input: attempts[0].input },
  ]);
});

it("uses a new request identity when only the replacement flight changes after an unknown response", async () => {
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: null,
    }),
    "flights.search": () =>
      [43, 44].map(id => ({
        id,
        flightNumber: `TEST${id}`,
        departureTime: new Date("2030-01-16T12:00:00Z"),
        origin: { timezone: "Asia/Riyadh" },
      })),
    "modifications.requestChangeDate": () => {
      throw new Error("Response lost");
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.refresh"),
    })
  );
  await elapse();
  fireEvent.click(screen.getByRole("button", { name: /TEST44/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  const changes = requests.filter(
    request => request.path === "modifications.requestChangeDate"
  );
  expect(changes).toHaveLength(2);
  expect(changes[0].input).toMatchObject({ newFlightId: 43 });
  expect(changes[1].input).toMatchObject({ newFlightId: 44 });
  expect(
    (changes[1].input as { idempotencyKey: string }).idempotencyKey
  ).not.toBe((changes[0].input as { idempotencyKey: string }).idempotencyKey);
});

it("keeps recovered request identities separate between signed-in users", async () => {
  const handlers: Handlers = {
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: null,
    }),
    "modifications.requestChangeDate": () => {
      throw new Error("Response lost");
    },
  };
  const keys: string[] = [];
  for (const userId of [11, 12, 11]) {
    const view = await modification({
      ...handlers,
      "auth.me": () => ({ id: userId, tenantId: 3, role: "user" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("modifyBooking.exchange.quote"),
      })
    );
    await elapse();
    const request = view.requests.find(
      request => request.path === "modifications.requestChangeDate"
    );
    expect(request).toBeDefined();
    keys.push((request!.input as { idempotencyKey: string }).idempotencyKey);
    view.unmount();
    view.cache.clear();
  }
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[2]).toBe(keys[0]);
});

it("starts a fresh matching intent after a recovered uncertain quote is cancelled", async () => {
  let latest: ReturnType<typeof quote> | null = null;
  const handlers: Handlers = {
    "modifications.exchangeContext": () => ({ sectors: [sector], latest }),
    "modifications.requestChangeDate": () => {
      latest = quote();
      throw new Error("Response lost after the quote was saved");
    },
    "ndc.cancelPaidService": () => {
      latest = null;
      return { success: true };
    },
  };
  const first = await modification(handlers);
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  const original = first.requests.find(
    request => request.path === "modifications.requestChangeDate"
  )!.input as { idempotencyKey: string };
  first.unmount();
  first.cache.clear();
  const reloaded = await modification(handlers);
  expect(screen.getByRole("status")).toHaveTextContent("#91");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.discard"),
    })
  );
  await elapse();
  expect(
    reloaded.requests.filter(
      request => request.path === "ndc.cancelPaidService"
    )
  ).toEqual([{ path: "ndc.cancelPaidService", input: { modificationId: 91 } }]);
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  const next = reloaded.requests.find(
    request => request.path === "modifications.requestChangeDate"
  )!.input as { idempotencyKey: string };
  expect(next.idempotencyKey).not.toBe(original.idempotencyKey);
});

it("does not replace a damaged saved request identity or submit a new modification", async () => {
  sessionStorage.setItem(
    "ais:modification:3:11:7",
    JSON.stringify({
      fingerprint: "damaged identity",
      key: "not-a-uuid",
    })
  );
  const saved = sessionStorage.getItem("ais:modification:3:11:7");
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: null,
    }),
  });
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  expect(
    requests.some(request => request.path === "modifications.requestChangeDate")
  ).toBe(false);
  expect(sessionStorage.getItem("ais:modification:3:11:7")).toBe(saved);
  expect(screen.getByRole("alert")).toHaveTextContent(
    i18n.t("modifyBooking.exchange.lookupFirst")
  );
});

it("recovers an unavailable identity lookup before creating a scoped request", async () => {
  let available = false;
  const { requests } = await modification({
    "auth.me": () => {
      if (!available) throw new Error("Identity lookup unavailable");
      return { id: 11, tenantId: 3, role: "user" };
    },
    "modifications.exchangeContext": () => ({
      sectors: [sector],
      latest: null,
    }),
    "modifications.requestChangeDate": () => quote(),
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    i18n.t("modifyBooking.exchange.lookupFirst")
  );
  expect(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  ).toBeDisabled();
  expect(
    requests.some(request => request.path === "modifications.requestChangeDate")
  ).toBe(false);
  available = true;
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.refresh"),
    })
  );
  await elapse();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /TEST43/ }));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  expect(
    requests.filter(
      request => request.path === "modifications.requestChangeDate"
    )
  ).toHaveLength(1);
});

it("requests a cabin upgrade and requires consent to the returned paid quote", async () => {
  let latest: ReturnType<typeof quote> | null = null;
  const { requests } = await modification({
    "modifications.exchangeContext": () => ({ sectors: [sector], latest }),
    "modifications.requestUpgrade": () => {
      latest = {
        ...quote(),
        totalCost: 2500,
        newAmount: 12500,
        priceDifference: 2500,
      };
      return latest;
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.upgradeTab") })
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("modifyBooking.exchange.quote") })
  );
  await elapse();
  expect(
    requests.filter(request => request.path === "modifications.requestUpgrade")
  ).toEqual([
    {
      path: "modifications.requestUpgrade",
      input: {
        bookingId: 7,
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    },
  ]);
  expect(screen.getByRole("status")).toHaveTextContent("125.00");
  expect(screen.getByRole("status")).toHaveTextContent("25.00");
  expect(
    screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.confirm"),
    })
  ).toBeDisabled();
});

it.each(["missing URL", "provider failure"])(
  "keeps a paid quote unconfirmed after checkout %s and requires a status refresh",
  async outcome => {
    const { requests } = await modification({
      "modifications.exchangeContext": () => ({
        sectors: [sector],
        latest: {
          ...quote(),
          totalCost: 2500,
          newAmount: 12500,
          priceDifference: 2500,
        },
      }),
      "payments.createModificationCheckout": () => {
        if (outcome === "provider failure")
          throw new Error("Provider unavailable");
        return { url: null };
      },
    });
    const confirm = screen.getByRole("button", {
      name: i18n.t("modifyBooking.exchange.confirm"),
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    await elapse();
    expect(
      requests.filter(
        request => request.path === "payments.createModificationCheckout"
      )
    ).toEqual([
      {
        path: "payments.createModificationCheckout",
        input: {
          bookingId: 7,
          modificationId: 91,
          provider: "stripe",
          consent: {
            quoteVersion: QUOTE_VERSION,
            totalCost: 2500,
            currency: "SAR",
          },
        },
      },
    ]);
    expect(
      requests.some(request => request.path === "ndc.confirmNoChargeService")
    ).toBe(false);
    expect(notices.error).toHaveBeenCalledWith(
      outcome === "provider failure"
        ? "Provider unavailable"
        : i18n.t("modifyBooking.exchange.paymentUnavailable")
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("modifyBooking.exchange.lookupFirst")
    );
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("#91");
    expect(notices.success).not.toHaveBeenCalled();
  }
);

const zeroQuote = {
  quoteHash: "a".repeat(64),
  policyReason: "nonrefundable_fare",
  requiresZeroRefundConfirmation: true,
  tier: "none",
  totalAmount: 10000,
  cancellationFee: 10000,
  refundAmount: 0,
  refundPercentage: 0,
};
const zeroReceipt = {
  cancellationId: "booking-7-cancel-without-refund",
  bookingId: 7,
  status: "cancelled_without_refund",
  totalAmount: 10000,
  cancellationFee: 10000,
  refundAmount: 0,
  currency: "SAR",
  policyReason: "nonrefundable_fare",
  confirmedAt: new Date("2030-01-01T12:00:00Z"),
};
it("requires explicit no-refund consent and keeps the truthful cancellation receipt after the confirmed response", async () => {
  const reply = deferred<typeof zeroReceipt>();
  const { requests, success, close } = await cancellation({
    "refunds.checkRefundable": () => ({
      refundable: false,
      cancellable: true,
      requiresZeroRefundConfirmation: true,
    }),
    "refunds.calculateCancellationFee": () => zeroQuote,
    "refunds.cancelWithoutRefund": () => reply.promise,
  });
  const confirm = screen.getByRole("button", { name: "Confirm Cancellation" });
  expect(confirm).toBeDisabled();
  expect(screen.getByText("Cancellation without a refund")).toBeVisible();
  expect(screen.getByText("-100.00 SAR")).toBeVisible();
  expect(
    screen.queryByText(i18n.t("cancelBooking.refundProcessing"))
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: i18n.t("cancelBooking.noRefund.acknowledgment"),
    })
  );
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await elapse();
  expect(
    requests.filter(r => /create|cancelWithoutRefund/.test(r.path))
  ).toEqual([
    {
      path: "refunds.cancelWithoutRefund",
      input: {
        bookingId: 7,
        quoteHash: zeroQuote.quoteHash,
        confirmNoRefund: true,
        reason: "requested_by_customer",
        notes: "",
      },
    },
  ]);
  expect(success).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancelling..." })).toBeDisabled();
  await act(async () => reply.resolve(zeroReceipt));
  await elapse();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Booking cancelled. No refund was issued."
  );
  expect(screen.getByText(zeroReceipt.cancellationId)).toBeVisible();
  expect(screen.getByText("0.00 SAR")).toBeVisible();
  expect(screen.getByText("Retained cancellation fee:")).toBeVisible();
  expect(screen.queryByText("Refund confirmed")).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  expect(success).toHaveBeenCalledTimes(1);
});
it("reopens a persisted zero-refund receipt without another cancellation or refund request", async () => {
  const { requests } = await cancellation({
    "refunds.cancellationReceipt": () => zeroReceipt,
  });
  expect(
    screen.getByRole("heading", { name: "Cancellation receipt" })
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("No refund was issued");
  expect(screen.getByText(zeroReceipt.cancellationId)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Confirm Cancellation" })
  ).not.toBeInTheDocument();
  expect(
    requests.some(r => /refunds\.(create|cancelWithoutRefund)/.test(r.path))
  ).toBe(false);
});
it("clears zero-refund consent when a changed quote is rejected and requires review of the replacement quote", async () => {
  let latest = zeroQuote;
  const { requests, success } = await cancellation({
    "refunds.checkRefundable": () => ({ refundable: false, cancellable: true }),
    "refunds.calculateCancellationFee": () => latest,
    "refunds.cancelWithoutRefund": () => {
      latest = { ...zeroQuote, quoteHash: "b".repeat(64) };
      throw new Error("Cancellation quote changed; review the current fare");
    },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Cancellation" }));
  await elapse();
  expect(notices.error).toHaveBeenCalledWith(
    "Cancellation quote changed; review the current fare"
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(
    screen.getByRole("button", { name: "Confirm Cancellation" })
  ).toBeDisabled();
  expect(success).not.toHaveBeenCalled();
  expect(
    requests.filter(r => r.path === "refunds.cancelWithoutRefund")
  ).toHaveLength(1);
});
it("never guesses a full refund or enables cancellation while the quote is unavailable", async () => {
  const reply = deferred<typeof zeroQuote>();
  const { requests } = await cancellation({
    "refunds.calculateCancellationFee": () => reply.promise,
  });
  expect(
    screen.getByRole("button", { name: "Confirm Cancellation" })
  ).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading the current cancellation quote"
  );
  expect(screen.queryByText("100.00 SAR")).not.toBeInTheDocument();
  expect(
    requests.some(r => /refunds\.(create|cancelWithoutRefund)/.test(r.path))
  ).toBe(false);
});
