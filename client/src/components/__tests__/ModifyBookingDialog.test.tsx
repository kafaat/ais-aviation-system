import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ModifyBookingDialog } from "../ModifyBookingDialog";

const state = vi.hoisted(() => ({
  context: null as Record<string, unknown> | null,
  upgrade: vi.fn(async () => ({})),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && "reason" in params
        ? `${key}:${params.action}:${params.carrier}:${params.channel}:${params.version}:${params.reason}`
        : key,
    i18n: { language: "en" },
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/airline-support", () => ({ airlineSupportUrl: () => null }));
vi.mock("@/lib/trpc", () => {
  const mutation = (fn = vi.fn(async () => ({}))) => ({
    useMutation: () => ({ mutateAsync: fn }),
  });
  return {
    trpc: {
      useUtils: () => ({ bookings: { myBookings: { invalidate: vi.fn() } } }),
      auth: {
        me: {
          useQuery: () => ({
            data: { id: 9, tenantId: 3 },
            isLoading: false,
            error: null,
          }),
        },
      },
      modifications: {
        exchangeContext: {
          useQuery: () => ({
            data: state.context,
            isLoading: false,
            isFetching: false,
            error: null,
            refetch: vi.fn(async () => ({ data: state.context })),
          }),
        },
        requestChangeDate: mutation(),
        requestUpgrade: mutation(state.upgrade),
      },
      flights: {
        search: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
      },
      payments: { createModificationCheckout: mutation() },
      ndc: {
        confirmNoChargeService: mutation(),
        cancelPaidService: mutation(),
      },
    },
  };
});

const sector = {
  flightId: 11,
  flightNumber: "SV123",
  originId: 1,
  destinationId: 2,
  origin: "RUH",
  destination: "JED",
  originTimezone: "Asia/Riyadh",
  departureTime: new Date("2035-01-01T10:00:00Z"),
  status: "confirmed",
};
const decision = (
  action: string,
  allowed: boolean,
  overrides: Record<string, unknown> = {}
) => ({
  carrierCode: "LH",
  sellerId: "AGG1",
  channel: "ndc",
  schemaVersion: "17.2",
  action,
  support: allowed ? "supported" : "unsupported",
  confirmation: "confirmed",
  precedence: "exact_version",
  allowed,
  reason: "test",
  evidenceUrl: null,
  evidenceNote: null,
  rowId: null,
  source: "seed",
  ...overrides,
});
const capabilities = (exchange: boolean, seatMove = true) => ({
  carrierCode: "LH",
  sellerId: "AGG1",
  channel: "ndc",
  schemaVersion: "17.2",
  actions: {
    order_change_voluntary: decision("order_change_voluntary", exchange),
    seat_move: decision("seat_move", seatMove),
  },
});
const booking = {
  id: 7,
  bookingReference: "ABC123",
  cabinClass: "economy",
  originName: "Riyadh",
  destinationName: "Jeddah",
};
beforeEach(() => {
  vi.clearAllMocks();
});
describe("exchange capability gating", () => {
  it("disables the exchange and names the combination when the matrix withdraws it", () => {
    state.context = {
      capabilities: capabilities(false),
      sectors: [sector],
      latest: null,
    };
    render(
      <ModifyBookingDialog open onOpenChange={vi.fn()} booking={booking} />
    );
    expect(screen.getByTestId("capability-blocked")).toHaveTextContent(
      "modifyBooking.capability.blocked:ndcCapabilities.actions.order_change_voluntary:LH:ndcCapabilities.channels.ndc:17.2:ndcCapabilities.supports.unsupported"
    );
    expect(
      screen.getByRole("button", { name: "modifyBooking.exchange.quote" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "modifyBooking.upgradeTab" })
    ).toBeDisabled();
    expect(
      screen.queryByText("modifyBooking.exchange.sector")
    ).not.toBeInTheDocument();
  });
  it("explains unconfirmed combinations as needing operator confirmation", () => {
    state.context = {
      capabilities: capabilities(false),
      sectors: [sector],
      latest: null,
    };
    (
      state.context.capabilities as ReturnType<typeof capabilities>
    ).actions.order_change_voluntary = decision(
      "order_change_voluntary",
      false,
      {
        support: "supported",
        confirmation: "unconfirmed",
      }
    );
    render(
      <ModifyBookingDialog open onOpenChange={vi.fn()} booking={booking} />
    );
    expect(screen.getByTestId("capability-blocked")).toHaveTextContent(
      "modifyBooking.capability.unconfirmed"
    );
  });
  it("offers the exchange when allowed and only notes a missing seat move", async () => {
    state.context = {
      capabilities: capabilities(true, false),
      sectors: [sector],
      latest: null,
    };
    render(
      <ModifyBookingDialog open onOpenChange={vi.fn()} booking={booking} />
    );
    expect(screen.queryByTestId("capability-blocked")).not.toBeInTheDocument();
    expect(screen.getByTestId("capability-seat-move")).toHaveTextContent(
      "modifyBooking.capability.seatMoveUnavailable"
    );
    fireEvent.click(
      screen.getByRole("button", { name: "modifyBooking.upgradeTab" })
    );
    const quote = screen.getByRole("button", {
      name: "modifyBooking.exchange.quote",
    });
    expect(quote).toBeEnabled();
    fireEvent.click(quote);
    await vi.waitFor(() => expect(state.upgrade).toHaveBeenCalledTimes(1));
  });
});
