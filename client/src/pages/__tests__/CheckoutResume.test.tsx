import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import superjson from "superjson";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import App from "@/App";
import i18n from "@/i18n/config";
import { trpc } from "@/lib/trpc";

type Reply = (input: unknown) => unknown;
type Invoice = {
  bookingId: number;
  bookingReference: string;
  bookingStatus: string;
  totalAmount: number;
  currency: string;
  state: string;
  invoiceEditable: boolean;
  appliedVoucher: { code: string; discountAmount: number } | null;
};
const pendingInvoice = (): Invoice => ({
  bookingId: 700,
  bookingReference: "OWN700",
  bookingStatus: "pending",
  totalAmount: 10000,
  currency: "SAR",
  state: "pending",
  invoiceEditable: true,
  appliedVoucher: null,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

/** Real route, auth guard, page, tRPC hooks and mutation lifecycle. Only the
 * HTTP transport is substituted; no provider, email, wallet or database call.
 */
function visit(path: string, replies: Record<string, Reply> = {}) {
  const route = memoryLocation({ path, record: true });
  const requests: { path: string; input: unknown }[] = [];
  const responses: Record<string, Reply> = {
    "auth.me": () => ({ id: 9, name: "Owner", tenantId: 3, role: "user" }),
    "consent.getMyConsent": () => ({ needsReconsent: false }),
    "payments.getCheckoutState": () => pendingInvoice(),
    "wallet.balance": () => ({
      balance: 20000,
      currency: "SAR",
      status: "active",
    }),
    ...replies,
  };
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "https://local.test/api/trpc",
        transformer: superjson,
        fetch: async (url, options) => {
          const parsed = new URL(String(url));
          const methods = parsed.pathname.split("/").pop()!.split(",");
          const body = String(
            options?.body ?? parsed.searchParams.get("input") ?? "{}"
          );
          const inputs = JSON.parse(body) as Record<
            string,
            Parameters<typeof superjson.deserialize>[0]
          >;
          const results = await Promise.all(
            methods.map(async (path, index) => {
              const input = inputs[index]
                ? superjson.deserialize(inputs[index])
                : undefined;
              requests.push({ path, input });
              try {
                if (!responses[path])
                  throw new Error("Unexpected procedure: " + path);
                return {
                  result: {
                    data: superjson.serialize(await responses[path](input)),
                  },
                };
              } catch (error) {
                const code =
                  error && typeof error === "object" && "code" in error
                    ? String(error.code)
                    : "INTERNAL_SERVER_ERROR";
                return {
                  error: {
                    json: {
                      message:
                        error instanceof Error ? error.message : "Unavailable",
                      code: -32603,
                      data: { code, httpStatus: 500, path },
                    },
                  },
                };
              }
            })
          );
          return new Response(JSON.stringify(results), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <trpc.Provider client={client} queryClient={cache}>
      <QueryClientProvider client={cache}>
        <Router hook={route.hook}>
          <App />
        </Router>
      </QueryClientProvider>
    </trpc.Provider>
  );
  return { requests, route };
}

it("opens the owned booking from the actual cancellation route without querying a flight or creating a booking", async () => {
  const { requests } = visit("/checkout/700?canceled=true");
  await screen.findByRole(
    "heading",
    { name: "Payment pending" },
    { timeout: 6000 }
  );
  expect(screen.getByText("OWN700")).toBeVisible();
  expect(screen.getByText(/You returned from checkout/)).toBeVisible();
  expect(requests.filter(r => r.path === "payments.getCheckoutState")).toEqual([
    { path: "payments.getCheckoutState", input: { bookingId: 700 } },
  ]);
  expect(
    requests.some(r =>
      /flights\.|bookings\.create|createCheckoutSession|vouchers\.applyVoucher/.test(
        r.path
      )
    )
  ).toBe(false);
});

it("redirects an existing frozen checkout's legacy cancel URL before interpreting its booking ID as a flight", async () => {
  const { route, requests } = visit("/booking/700?canceled=true");
  await waitFor(() =>
    expect(route.history.at(-1)).toBe("/checkout/700?canceled=true")
  );
  await screen.findByRole("heading", { name: "Payment pending" });
  expect(
    requests.some(
      r => r.path === "flights.getById" || r.path === "bookings.create"
    )
  ).toBe(false);
  expect(requests.some(r => r.path === "payments.getCheckoutState")).toBe(true);
});

it.each([
  ["paid", "Payment received"],
  ["refunded", "Payment refunded"],
  ["cancelled", "Booking closed"],
  ["unavailable", "Payment needs attention"],
])(
  "uses server %s state even on a cancellation return and offers no collection",
  async (state, title) => {
    const { requests } = visit("/checkout/700?canceled=true&method=wallet", {
      "payments.getCheckoutState": () => ({
        ...pendingInvoice(),
        state,
        invoiceEditable: false,
      }),
    });
    await screen.findByRole("heading", { name: title });
    expect(
      screen.queryByRole("button", { name: "Continue payment" })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Voucher Code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm wallet payment" })
    ).not.toBeInTheDocument();
    expect(
      requests.some(r =>
        /\.pay$|\.initiate$|createCheckoutSession/.test(r.path)
      )
    ).toBe(false);
  }
);

it("distinguishes an unavailable foreign booking from a transient read error", async () => {
  const { requests } = visit("/checkout/700", {
    "payments.getCheckoutState": () => {
      throw Object.assign(new Error("Owned booking not found"), {
        code: "NOT_FOUND",
      });
    },
  });
  await screen.findByRole("heading", { name: "Booking unavailable" });
  expect(screen.queryByText("OWN700")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Continue payment" })
  ).not.toBeInTheDocument();
  expect(requests.some(r => r.path === "payments.createCheckoutSession")).toBe(
    false
  );
});

it("retries a failed state read without initiating payment", async () => {
  let available = false;
  const { requests } = visit("/checkout/700", {
    "payments.getCheckoutState": () => {
      if (!available) throw new Error("Read interrupted");
      return pendingInvoice();
    },
  });
  await screen.findByRole("heading", {
    name: "Payment status could not be loaded",
  });
  expect(
    screen.queryByRole("button", { name: "Continue payment" })
  ).not.toBeInTheDocument();
  available = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh payment status" })
  );
  await screen.findByRole("heading", { name: "Payment pending" });
  expect(requests.some(r => r.path === "payments.createCheckoutSession")).toBe(
    false
  );
});

it("retries an ambiguous checkout with the same booking and locks competing actions while in flight", async () => {
  let invoice = pendingInvoice();
  let rejectFirst: (error: Error) => void = () => {};
  const start = vi
    .fn()
    .mockImplementationOnce(() => {
      invoice = { ...invoice, invoiceEditable: false };
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    })
    .mockResolvedValueOnce({
      provider: "stripe",
      sessionId: "cs_same",
      url: "#provider-checkout",
    });
  const { requests } = visit("/checkout/700?canceled=true", {
    "payments.getCheckoutState": () => invoice,
    "payments.createCheckoutSession": start,
  });
  const button = await screen.findByRole("button", {
    name: "Continue payment",
  });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(start).toHaveBeenCalledOnce());
  expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: "Wallet" })).toBeDisabled();
  rejectFirst(new Error("Connection lost"));
  await screen.findByText("Connection lost");
  await screen.findByText(/Payment has already started/);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Continue payment" })
    ).toBeEnabled()
  );
  expect(
    screen.queryByRole("button", { name: "Wallet" })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue payment" }));
  await waitFor(() => expect(window.location.hash).toBe("#provider-checkout"));
  expect(start.mock.calls.map(call => call[0])).toEqual([
    { bookingId: 700, provider: "stripe" },
    { bookingId: 700, provider: "stripe" },
  ]);
  expect(requests.some(r => r.path === "bookings.create")).toBe(false);
});

it("shows a verified expired session as resumable on the same booking", async () => {
  const start = vi.fn().mockResolvedValue({
    provider: "stripe",
    sessionId: "cs_new",
    url: "#new-session",
  });
  visit("/checkout/700", {
    "payments.getCheckoutState": () => ({
      ...pendingInvoice(),
      state: "expired",
    }),
    "payments.createCheckoutSession": start,
  });
  await screen.findByRole("heading", { name: "Checkout session expired" });
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue payment" }));
  await waitFor(() =>
    expect(start).toHaveBeenCalledWith({ bookingId: 700, provider: "stripe" })
  );
});

it("recovers a voucher's persisted total after a lost reply without subtracting a local discount", async () => {
  let invoice = pendingInvoice();
  const apply = vi.fn(() => {
    invoice = {
      ...invoice,
      totalAmount: 9000,
      appliedVoucher: { code: "SAVE10", discountAmount: 1000 },
    };
    throw new Error("Voucher response lost");
  });
  const { requests } = visit("/checkout/700", {
    "payments.getCheckoutState": () => invoice,
    "vouchers.applyVoucher": apply,
  });
  const field = await screen.findByLabelText("Voucher Code");
  fireEvent.change(field, { target: { value: "SAVE10" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("Promotion SAVE10");
  expect(screen.getByTestId("checkout-total")).toHaveTextContent("90.00");
  expect(apply).toHaveBeenCalledWith({
    bookingId: 700,
    code: "SAVE10",
    amount: 10000,
  });
  expect(screen.queryByLabelText("Voucher Code")).not.toBeInTheDocument();
  expect(requests.some(r => r.path === "payments.createCheckoutSession")).toBe(
    false
  );
});

it("uses the refreshed invoice for wallet confirmation and reconciles an ambiguous debit before offering another method", async () => {
  let invoice = pendingInvoice();
  const pay = vi.fn(() => {
    invoice = {
      ...invoice,
      state: "paid",
      bookingStatus: "confirmed",
      invoiceEditable: false,
    };
    throw new Error("Wallet response lost");
  });
  visit("/checkout/700?method=wallet", {
    "payments.getCheckoutState": () => invoice,
    "vouchers.applyVoucher": () => {
      invoice = {
        ...invoice,
        totalAmount: 9000,
        appliedVoucher: { code: "SAVE10", discountAmount: 1000 },
      };
      return {
        success: true,
        finalAmount: 9000,
        discountApplied: 1000,
        voucherCode: "SAVE10",
      };
    },
    "wallet.pay": pay,
  });
  const field = await screen.findByLabelText("Voucher Code");
  expect(pay).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "SAVE10" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("Promotion SAVE10");
  const confirm = await screen.findByRole("button", {
    name: "Confirm wallet payment",
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await screen.findByRole("heading", { name: "Payment received" });
  expect(pay).toHaveBeenCalledOnce();
  expect(pay).toHaveBeenCalledWith({ bookingId: 700, expectedAmount: 9000 });
  expect(
    screen.queryByRole("button", { name: "Continue payment" })
  ).not.toBeInTheDocument();
});

it("rebuilds split amounts from the discounted invoice and resumes an existing plan after a lost reply", async () => {
  let invoice = pendingInvoice();
  const initiate = vi.fn(() => {
    invoice = { ...invoice, state: "split", invoiceEditable: false };
    throw new Error("Plan response lost");
  });
  visit("/checkout/700?method=split", {
    "payments.getCheckoutState": () => invoice,
    "vouchers.applyVoucher": () => {
      invoice = {
        ...invoice,
        totalAmount: 9000,
        appliedVoucher: { code: "SAVE10", discountAmount: 1000 },
      };
      return {
        success: true,
        finalAmount: 9000,
        discountApplied: 1000,
        voucherCode: "SAVE10",
      };
    },
    "splitPayments.initiate": initiate,
    "splitPayments.getStatus": () => ({
      bookingId: 700,
      splits: [
        { id: 1, payerName: "Yara", amount: 4500, status: "pending" },
        { id: 2, payerName: "Maha", amount: 4500, status: "pending" },
      ],
    }),
  });
  const field = await screen.findByLabelText("Voucher Code");
  expect(initiate).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "SAVE10" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("Promotion SAVE10");
  for (const [index, name] of ["Yara", "Maha"].entries()) {
    fireEvent.change(screen.getAllByLabelText("Name")[index], {
      target: { value: name },
    });
    fireEvent.change(screen.getAllByLabelText("Email")[index], {
      target: { value: name.toLowerCase() + "@example.test" },
    });
  }
  const submit = screen.getByRole("button", { name: "Send Payment Requests" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await screen.findByRole("heading", { name: "Split payment in progress" });
  await screen.findByText("Yara");
  expect(initiate).toHaveBeenCalledOnce();
  expect(initiate).toHaveBeenCalledWith({
    bookingId: 700,
    splits: [
      { name: "Yara", email: "yara@example.test", amount: 4500 },
      { name: "Maha", email: "maha@example.test", amount: 4500 },
    ],
  });
  expect(
    screen.queryByRole("button", { name: "Continue payment" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Send Payment Requests" })
  ).not.toBeInTheDocument();
});
