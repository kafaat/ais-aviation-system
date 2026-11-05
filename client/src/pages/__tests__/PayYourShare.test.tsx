import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { toast } from "sonner";
import { PayYourShare } from "../PayYourShare";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const token = "a".repeat(64);
const payerLinks = [
  { label: "ordinary link", path: `/pay/${token}` },
  {
    label: "provider return",
    path: `/pay/${token}/success?session_id=synthetic-session`,
  },
];
const payerDetails = () => ({
  splitId: 14,
  bookingReference: "SHARE14",
  flightNumber: "TEST14",
  route: "Riyadh (RUH) - Jeddah (JED)",
  departureTime: new Date("2030-01-15T12:00:00Z"),
  payerName: "Fixture Payer",
  payerEmail: "payer@example.test",
  amount: 12500,
  status: "pending",
  expiresAt: new Date("2030-01-14T12:00:00Z"),
  cancellation: null as null | {
    status: string;
    refundAmount: number;
    cancellationFee: number;
  },
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

async function elapse(milliseconds = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function visit(
  details: () => ReturnType<typeof payerDetails> | null,
  path = `/pay/${token}/success?session_id=synthetic-session`,
  checkout: () => unknown = () => ({ url: null })
) {
  window.history.replaceState(null, "", path);
  const route = memoryLocation({ path, record: true });
  const fixture = createTrpcFixture({
    "splitPayments.getPayerDetails": details,
    "splitPayments.createPayerCheckout": checkout,
  });
  render(
    <fixture.Wrapper>
      <Router hook={route.hook}>
        <PayYourShare />
      </Router>
    </fixture.Wrapper>
  );
  await elapse();
  return { ...fixture, route };
}

it.each(payerLinks)(
  "shows an unpaid cancelled share without a refund item and stops polling on $label",
  async ({ path }) => {
    const { requests } = await visit(
      () => ({ ...payerDetails(), status: "cancelled" }),
      path
    );
    expect(
      screen.getByRole("heading", {
        name: i18n.t("splitPayment.paymentCancelledTitle"),
      })
    ).toBeVisible();
    expect(
      screen.queryByText(i18n.t("splitPayment.verifyingPayment"))
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
    await elapse(10000);
    expect(requests).toEqual([
      { path: "splitPayments.getPayerDetails", input: { paymentToken: token } },
    ]);
  }
);

it.each(payerLinks)(
  "stops polling after an expired or unknown payment link resolves to null on $label",
  async ({ path }) => {
    const { requests } = await visit(() => null, path);
    expect(
      screen.getByRole("heading", { name: i18n.t("splitPayment.notFound") })
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
    await elapse(10000);
    expect(requests).toHaveLength(1);
  }
);

it.each(
  payerLinks.flatMap(link =>
    ["expired", "deadline"].map(reason => ({ ...link, reason }))
  )
)(
  "shows the terminal expiry state for $reason on $label",
  async ({ reason, path }) => {
    const { requests } = await visit(
      () => ({
        ...payerDetails(),
        ...(reason === "expired"
          ? { status: "expired" }
          : { expiresAt: new Date("2029-12-31T12:00:00Z") }),
      }),
      path
    );
    expect(
      screen.getByRole("heading", {
        name: i18n.t("splitPayment.paymentExpired"),
      })
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
    await elapse(10000);
    expect(requests).toHaveLength(1);
  }
);

it.each(["pending", "email_sent", "failed"])(
  "uses the server's %s-to-paid transition before confirming a provider return and then stops polling",
  async status => {
    let settled = false;
    const { requests } = await visit(() => ({
      ...payerDetails(),
      status: settled ? "paid" : status,
    }));
    expect(
      screen.getByText(i18n.t("splitPayment.verifyingPayment"))
    ).toBeVisible();
    expect(
      screen.queryByText(i18n.t("splitPayment.paymentComplete"))
    ).not.toBeInTheDocument();
    settled = true;
    await elapse(3100);
    expect(
      screen.getByRole("heading", {
        name: i18n.t("splitPayment.paymentComplete"),
      })
    ).toBeVisible();
    expect(screen.getByText("SHARE14")).toBeVisible();
    expect(requests).toHaveLength(2);
    await elapse(10000);
    expect(requests).toHaveLength(2);
  }
);

it.each([
  `/pay/${token}`,
  `/pay/${token}/success`,
  `/pay/${token}/success?session_id=`,
  `/pay/${token}?session_id=synthetic-session`,
  `/pay/${token}/unknown?session_id=synthetic-session`,
])(
  "keeps pending payment available without a complete provider return at %s",
  async path => {
    const { requests } = await visit(() => payerDetails(), path);
    expect(
      screen.getByText(i18n.t("splitPayment.payYourShareTitle"))
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Pay/ })).toBeEnabled();
    expect(
      screen.queryByText(i18n.t("splitPayment.paymentComplete"))
    ).not.toBeInTheDocument();
    await elapse(10000);
    expect(requests).toHaveLength(1);
  }
);

it.each([
  "/pay",
  "/pay?session_id=synthetic-session",
  "/pay/short",
  "/pay/short/success?session_id=synthetic-session",
])(
  "does not query or start checkout for a missing or short token at %s",
  async path => {
    const { requests } = await visit(() => payerDetails(), path);
    expect(
      screen.getByRole("heading", { name: i18n.t("splitPayment.notFound") })
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
    await elapse(10000);
    expect(requests).toHaveLength(0);
  }
);

it.each([
  { path: `/pay/${token}`, heading: "splitPayment.alreadyPaid" },
  {
    path: `/pay/${token}/success`,
    heading: "splitPayment.alreadyPaid",
  },
  {
    path: `/pay/${token}/success?session_id=synthetic-session`,
    heading: "splitPayment.paymentComplete",
  },
])(
  "renders server-confirmed paid details at $path without another checkout",
  async ({ path, heading }) => {
    const { requests } = await visit(
      () => ({ ...payerDetails(), status: "paid" }),
      path
    );
    expect(
      screen.getByRole("heading", { name: i18n.t(heading) })
    ).toBeVisible();
    if (heading === "splitPayment.alreadyPaid") {
      expect(
        screen.getByText(
          i18n.t("splitPayment.alreadyPaidDescription", {
            name: "Fixture Payer",
          })
        )
      ).toBeVisible();
    }
    expect(screen.queryByRole("button", { name: /Pay/ })).toBeNull();
    await elapse(10000);
    expect(requests).toHaveLength(1);
  }
);

it.each([
  { status: "cancelled", heading: "splitPayment.paymentCancelledTitle" },
  { status: "expired", heading: "splitPayment.paymentExpired" },
  { status: "missing", heading: "splitPayment.notFound" },
])(
  "stops an active provider-return poll when the server becomes $status",
  async ({ status, heading }) => {
    let terminal = false;
    const { requests } = await visit(() => {
      if (terminal && status === "missing") return null;
      return { ...payerDetails(), status: terminal ? status : "pending" };
    });
    expect(
      screen.getByText(i18n.t("splitPayment.verifyingPayment"))
    ).toBeVisible();
    terminal = true;
    await elapse(3100);
    expect(
      screen.getByRole("heading", { name: i18n.t(heading) })
    ).toBeVisible();
    expect(
      screen.queryByText(i18n.t("splitPayment.paymentComplete"))
    ).not.toBeInTheDocument();
    expect(requests).toHaveLength(2);
    await elapse(10000);
    expect(requests).toHaveLength(2);
  }
);

it("stops verification polling when the query fails, including a failure after pending data", async () => {
  let failed = false;
  const { requests } = await visit(() => {
    if (failed) throw new Error("Fixture unavailable");
    return payerDetails();
  });
  failed = true;
  await elapse(3100);
  expect(
    screen.getByRole("heading", { name: i18n.t("splitPayment.notFound") })
  ).toBeVisible();
  await elapse(10000);
  expect(requests).toHaveLength(2);
});

it("preserves the refund receipt view and never confirms a cancelled share as paid", async () => {
  const { requests } = await visit(() => ({
    ...payerDetails(),
    status: "cancelled",
    cancellation: {
      status: "pending",
      refundAmount: 10000,
      cancellationFee: 2500,
    },
  }));
  expect(screen.getByText(i18n.t("cancelBooking.split.track"))).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    i18n.t("cancelBooking.split.item.pending")
  );
  expect(
    screen.queryByText(i18n.t("splitPayment.paymentComplete"))
  ).not.toBeInTheDocument();
  await elapse(10000);
  expect(requests).toHaveLength(1);
});

it("starts checkout with the link's token on request and follows the returned URL", async () => {
  // JSDOM supports same-document navigation; the real success handler assigns
  // the URL without mocking the mutation or replacing window.location.
  const checkoutUrl = `${window.location.origin}/pay/${token}#provider-checkout`;
  const { requests } = await visit(
    () => payerDetails(),
    `/pay/${token}`,
    () => ({ sessionId: "synthetic-session", url: checkoutUrl })
  );
  expect(requests).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
  await elapse();
  expect(requests[1]).toEqual({
    path: "splitPayments.createPayerCheckout",
    input: { paymentToken: token },
  });
  expect(window.location.href).toBe(checkoutUrl);
  expect(
    screen.queryByText(i18n.t("splitPayment.paymentComplete"))
  ).not.toBeInTheDocument();
});

it("blocks duplicate pending checkout requests and allows retry after failure", async () => {
  const first = deferred<{ sessionId: string; url: null }>();
  const retry = deferred<{ sessionId: string; url: null }>();
  const errorToast = vi.spyOn(toast, "error").mockReturnValue("checkout-error");
  let attempts = 0;
  const { requests } = await visit(
    () => payerDetails(),
    `/pay/${token}`,
    () => (++attempts === 1 ? first.promise : retry.promise)
  );
  const checkoutRequests = () =>
    requests.filter(
      request => request.path === "splitPayments.createPayerCheckout"
    );

  fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
  await elapse();
  const pendingButton = screen.getByRole("button", {
    name: i18n.t("splitPayment.redirecting"),
  });
  expect(pendingButton).toBeDisabled();
  fireEvent.click(pendingButton);
  await elapse(1000);
  expect(checkoutRequests()).toHaveLength(1);

  first.reject(new Error("Checkout temporarily unavailable"));
  await elapse();
  expect(errorToast).toHaveBeenCalledExactlyOnceWith(
    "Checkout temporarily unavailable"
  );
  const retryButton = screen.getByRole("button", { name: /Pay/ });
  expect(retryButton).toBeEnabled();
  fireEvent.click(retryButton);
  await elapse();
  expect(
    screen.getByRole("button", { name: i18n.t("splitPayment.redirecting") })
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("splitPayment.redirecting") })
  );
  await elapse();
  expect(checkoutRequests()).toEqual([
    {
      path: "splitPayments.createPayerCheckout",
      input: { paymentToken: token },
    },
    {
      path: "splitPayments.createPayerCheckout",
      input: { paymentToken: token },
    },
  ]);

  retry.resolve({ sessionId: "synthetic-retry", url: null });
  await elapse();
  expect(screen.getByRole("button", { name: /Pay/ })).toBeEnabled();
  expect(errorToast).toHaveBeenCalledTimes(1);
});

it("notifies a cancelled provider return once and replaces its return parameters", async () => {
  const errorToast = vi
    .spyOn(toast, "error")
    .mockReturnValue("cancelled-return");
  const { requests, route } = await visit(
    () => payerDetails(),
    `/pay/${token}/success?cancelled=true&session_id=synthetic-session`
  );
  expect(errorToast).toHaveBeenCalledExactlyOnceWith(
    i18n.t("splitPayment.paymentCancelled")
  );
  expect(route.history).toEqual([`/pay/${token}`]);
  expect(screen.getByRole("button", { name: /Pay/ })).toBeEnabled();
  await elapse(10000);
  expect(errorToast).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(1);
});

it("does not treat a false cancellation parameter as a cancelled payment", async () => {
  const errorToast = vi
    .spyOn(toast, "error")
    .mockReturnValue("unexpected-error");
  const path = `/pay/${token}?cancelled=false`;
  const { route } = await visit(() => payerDetails(), path);
  expect(errorToast).not.toHaveBeenCalled();
  expect(route.history).toEqual([path]);
  expect(screen.getByRole("button", { name: /Pay/ })).toBeEnabled();
});
