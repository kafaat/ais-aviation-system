import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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

it("shows the server refund and retained fee, then waits for successful cancellation before closing", async () => {
  const reply = deferred<{ success: boolean }>();
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
  await act(async () => reply.resolve({ success: true }));
  await elapse();
  expect(success).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
  expect(notices.success).toHaveBeenCalledWith(
    i18n.t("cancelBooking.successMessage")
  );
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
const quote = () => ({
  status: "pending",
  modificationId: 91,
  reviewRequired: false,
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
  render(
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
  return fixture;
}

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
    { path: "ndc.confirmNoChargeService", input: { modificationId: 91 } },
  ]);
  expect(screen.getByText("RECEIPT91")).toBeVisible();
  expect(
    requests.some(
      request => request.path === "payments.createModificationCheckout"
    )
  ).toBe(false);
});

it("expires a consented quote on the clock and prevents confirmation", async () => {
  const { requests } = await modification();
  fireEvent.click(screen.getByRole("checkbox"));
  await elapse(61000);
  expect(
    screen.getByText(i18n.t("modifyBooking.exchange.expired"))
  ).toBeVisible();
  const confirm = screen.getByRole("button", {
    name: i18n.t("modifyBooking.exchange.confirm"),
  });
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  await elapse();
  expect(
    requests.every(request => request.path === "modifications.exchangeContext")
  ).toBe(true);
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
