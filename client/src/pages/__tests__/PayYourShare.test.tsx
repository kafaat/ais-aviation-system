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
import { PayYourShare } from "../PayYourShare";
import i18n from "@/i18n/config";
import { createTrpcFixture } from "@/test/trpc-fixture";

const token = "a".repeat(64);
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

it("shows an unpaid cancelled share without a refund item and stops polling even on a success URL", async () => {
  const { requests } = await visit(() => ({
    ...payerDetails(),
    status: "cancelled",
  }));
  expect(
    screen.getByRole("heading", {
      name: i18n.t("splitPayment.paymentCancelledTitle"),
    })
  ).toBeVisible();
  expect(
    screen.queryByText(i18n.t("splitPayment.verifyingPayment"))
  ).not.toBeInTheDocument();
  await elapse(10000);
  expect(requests).toEqual([
    { path: "splitPayments.getPayerDetails", input: { paymentToken: token } },
  ]);
});

it("stops polling after an expired or unknown payment link resolves to null", async () => {
  const { requests } = await visit(() => null);
  expect(
    screen.getByRole("heading", { name: i18n.t("splitPayment.notFound") })
  ).toBeVisible();
  await elapse(10000);
  expect(requests).toHaveLength(1);
});

it.each(["expired", "deadline"])(
  "shows the terminal expiry state instead of verification for %s",
  async reason => {
    const { requests } = await visit(() => ({
      ...payerDetails(),
      ...(reason === "expired"
        ? { status: "expired" }
        : { expiresAt: new Date("2029-12-31T12:00:00Z") }),
    }));
    expect(
      screen.getByRole("heading", {
        name: i18n.t("splitPayment.paymentExpired"),
      })
    ).toBeVisible();
    await elapse(10000);
    expect(requests).toHaveLength(1);
  }
);

it("uses the server's pending-to-paid transition before confirming a provider return and then stops polling", async () => {
  let settled = false;
  const { requests } = await visit(() => ({
    ...payerDetails(),
    status: settled ? "paid" : "pending",
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
});

it("does not poll an ordinary pending link or a success URL without a checkout session", async () => {
  const { requests } = await visit(
    () => payerDetails(),
    `/pay/${token}/success`
  );
  expect(
    screen.getByText(i18n.t("splitPayment.payYourShareTitle"))
  ).toBeVisible();
  await elapse(10000);
  expect(requests).toHaveLength(1);
});

it("does not query or start checkout for a malformed token", async () => {
  const { requests } = await visit(() => payerDetails(), "/pay/short/success");
  expect(
    screen.getByRole("heading", { name: i18n.t("splitPayment.notFound") })
  ).toBeVisible();
  await elapse(10000);
  expect(requests).toHaveLength(0);
});

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

it("starts checkout with the link's token only after the payer requests it", async () => {
  const { requests } = await visit(() => payerDetails(), `/pay/${token}`);
  expect(requests).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /Pay/ }));
  await elapse();
  expect(requests[1]).toEqual({
    path: "splitPayments.createPayerCheckout",
    input: { paymentToken: token },
  });
});
