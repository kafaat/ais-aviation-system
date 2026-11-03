import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AgentPortal from "../AgentPortal";

const state = vi.hoisted(() => ({
  agencies: [] as Array<{
    id: number;
    agencyName: string;
    iataNumber: string;
    contactEmail: string;
    contactPhone: string;
  }>,
  agencyError: null as Error | null,
  searchData: [] as unknown[],
  searchMutation: vi.fn(),
  searchReset: vi.fn(),
  createMutation: vi.fn(),
  createReset: vi.fn(),
  createError: null as (Error & { data?: { code?: string } }) | null,
  createOptions: {} as {
    retry?: boolean;
    onError?: (error: Error & { data?: { code?: string } }) => void;
    onSuccess?: (result: {
      bookingId: number;
      bookingReference: string;
      commission: number;
    }) => void;
  },
  navigate: vi.fn(),
  dashboardError: null as Error | null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    agentPortal: {
      agencies: {
        useQuery: () => ({
          data: state.agencies,
          error: state.agencyError,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      search: {
        useMutation: () => ({
          data: state.searchData,
          error: null,
          isPending: false,
          isSuccess: false,
          mutate: state.searchMutation,
          reset: state.searchReset,
        }),
      },
      dashboard: {
        useQuery: () => ({
          data: {
            bookings: [],
            total: 0,
            page: 1,
            pageSize: 20,
            stats: {
              totalBookings: 0,
              recordedBookingAmount: 0,
              recordedCommissionAmount: 0,
            },
          },
          error: state.dashboardError,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      createBooking: {
        useMutation: (options: typeof state.createOptions) => {
          state.createOptions = options;
          return {
            error: state.createError,
            isPending: false,
            mutate: state.createMutation,
            reset: state.createReset,
          };
        },
      },
    },
  },
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("wouter", async importOriginal => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useLocation: () => ["/agent", state.navigate],
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.agencyError = null;
  state.dashboardError = null;
  state.createError = null;
  state.agencies = [
    {
      id: 1,
      agencyName: "Synthetic Agency",
      iataNumber: "TEST01",
      contactEmail: "agency@example.test",
      contactPhone: "+966500000000",
    },
  ];
  state.searchData = [
    {
      id: 11,
      flightNumber: "QA11",
      departureTime: new Date("2030-01-01T10:00:00Z"),
      arrivalTime: new Date("2030-01-01T12:00:00Z"),
      origin: { code: "JED", timezone: "Asia/Riyadh" },
      destination: { code: "RUH", timezone: "Asia/Riyadh" },
      adultBaseFare: 10000,
      availableSeats: 5,
    },
  ];
});

it("shows the linked-account setup state without asking for API credentials", () => {
  state.agencies = [];
  render(<AgentPortal />);
  expect(screen.getByText("agentPortal.noAgency")).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("sends agency, cabin and whole party to scoped search", () => {
  render(<AgentPortal />);
  fireEvent.change(screen.getByLabelText("agentPortal.origin"), {
    target: { value: "jed" },
  });
  fireEvent.change(screen.getByLabelText("agentPortal.destination"), {
    target: { value: "ruh" },
  });
  fireEvent.change(screen.getByLabelText("agentPortal.departureDate"), {
    target: { value: "2030-01-01" },
  });
  fireEvent.change(screen.getByLabelText("agentPortal.passengerCount"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("agentPortal.cabin"), {
    target: { value: "business" },
  });
  fireEvent.click(screen.getByRole("button", { name: "agentPortal.search" }));
  expect(state.searchMutation).toHaveBeenCalledWith({
    agencyId: 1,
    originCode: "JED",
    destinationCode: "RUH",
    departureDate: "2030-01-01",
    cabinClass: "business",
    passengers: 2,
  });
});

function fillReservation() {
  fireEvent.click(
    screen.getByRole("button", { name: "agentPortal.selectFlight" })
  );
  fireEvent.change(screen.getByLabelText("agentPortal.firstName"), {
    target: { value: "Synthetic" },
  });
  fireEvent.change(screen.getByLabelText("agentPortal.lastName"), {
    target: { value: "Passenger" },
  });
}

it.each([undefined, "CONFLICT"])(
  "freezes the complete command after an uncertain %s response despite field edits, agency changes and refetch failures",
  code => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    state.agencies.push({
      ...state.agencies[0],
      id: 2,
      agencyName: "Other Agency",
    });
    const { rerender } = render(<AgentPortal />);
    fillReservation();
    fireEvent.click(screen.getByRole("button", { name: "agentPortal.create" }));
    // A second event before the mutation re-render must not start another call.
    fireEvent.click(screen.getByRole("button", { name: "agentPortal.create" }));
    expect(state.createMutation).toHaveBeenCalledTimes(1);
    const first = state.createMutation.mock.calls[0][0];
    expect(first).toMatchObject({
      agencyId: 1,
      flightId: 11,
      cabinClass: "economy",
      passengers: [
        { type: "adult", firstName: "Synthetic", lastName: "Passenger" },
      ],
      contactEmail: "agency@example.test",
      contactPhone: "+966500000000",
    });
    expect(first).not.toHaveProperty("credentials");
    expect(first).not.toHaveProperty("ownerUserId");
    expect(
      screen.queryByLabelText("agentPortal.contactEmail")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("agentPortal.contactPhone")
    ).not.toBeInTheDocument();
    state.createError = Object.assign(new Error("Response lost"), {
      data: code ? { code } : undefined,
    });
    act(() => state.createOptions.onError?.(state.createError!));
    rerender(<AgentPortal />);
    for (const label of [
      "agency",
      "origin",
      "destination",
      "departureDate",
      "cabin",
      "passengerCount",
      "firstName",
      "lastName",
      "passengerType",
      "externalReference",
    ]) {
      expect(screen.getByLabelText(`agentPortal.${label}`)).toBeDisabled();
    }
    // Even synthetic change/submit events on disabled controls cannot alter the
    // saved command or switch away from the workspace that owns its replay key.
    fireEvent.change(screen.getByLabelText("agentPortal.firstName"), {
      target: { value: "Changed" },
    });
    fireEvent.change(screen.getByLabelText("agentPortal.externalReference"), {
      target: { value: "different-reference" },
    });
    fireEvent.change(screen.getByLabelText("agentPortal.origin"), {
      target: { value: "DXB" },
    });
    fireEvent.change(screen.getByLabelText("agentPortal.passengerCount"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("agentPortal.agency"), {
      target: { value: "2" },
    });
    fireEvent.submit(
      screen.getByLabelText("agentPortal.origin").closest("form")!
    );
    expect(state.searchMutation).not.toHaveBeenCalled();
    expect(screen.getByLabelText("agentPortal.firstName")).toHaveValue(
      "Synthetic"
    );
    expect(screen.getByLabelText("agentPortal.agency")).toHaveValue("1");
    // A background ownership refresh cannot silently discard an unresolved command.
    state.agencies = [state.agencies[1]];
    state.agencyError = new Error("Read unavailable");
    rerender(<AgentPortal />);
    expect(screen.getByLabelText("agentPortal.agency")).toHaveValue("1");
    fireEvent.click(
      screen.getByRole("button", { name: "agentPortal.retryReservation" })
    );
    expect(state.createMutation.mock.calls[1][0]).toEqual(first);
    // A later authorization failure says nothing about the first lost response.
    state.createError = Object.assign(new Error("Access changed"), {
      data: { code: "FORBIDDEN" },
    });
    act(() => state.createOptions.onError?.(state.createError!));
    rerender(<AgentPortal />);
    expect(screen.getByLabelText("agentPortal.firstName")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "agentPortal.retryReservation" })
    );
    expect(state.createMutation.mock.calls[2][0]).toEqual(first);
    expect(
      new Set(
        state.createMutation.mock.calls.map(([command]) =>
          JSON.stringify(command)
        )
      ).size
    ).toBe(1);
    act(() =>
      state.createOptions.onSuccess?.({
        bookingId: 71,
        bookingReference: "TEST71",
        commission: 100,
      })
    );
    expect(state.navigate).toHaveBeenCalledWith("/checkout/71");
    expect(state.createOptions.retry).toBe(false);
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  }
);

it.each(["BAD_REQUEST", "FORBIDDEN"])(
  "allows corrected details only after a definitive first-attempt %s rejection",
  code => {
    const { rerender } = render(<AgentPortal />);
    fillReservation();
    fireEvent.click(screen.getByRole("button", { name: "agentPortal.create" }));
    const first = state.createMutation.mock.calls[0][0];
    state.createError = Object.assign(new Error("Rejected before booking"), {
      data: { code },
    });
    act(() => state.createOptions.onError?.(state.createError!));
    rerender(<AgentPortal />);
    expect(screen.getByLabelText("agentPortal.agency")).toBeEnabled();
    expect(screen.getByLabelText("agentPortal.firstName")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("agentPortal.firstName"), {
      target: { value: "Corrected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "agentPortal.create" }));
    expect(state.createMutation.mock.calls[1][0].passengers[0].firstName).toBe(
      "Corrected"
    );
    expect(state.createMutation.mock.calls[1][0].idempotencyKey).not.toBe(
      first.idempotencyKey
    );
  }
);

it("hides portfolio totals when authorization or the read fails", () => {
  state.dashboardError = new Error("Access denied");
  render(<AgentPortal />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "agentPortal.dashboardError"
  );
  expect(
    screen.queryByText("agentPortal.recordedAmount")
  ).not.toBeInTheDocument();
});
