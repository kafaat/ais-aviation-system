import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DcsBaggageRegistration } from "../DcsBaggageRegistration";

const api = vi.hoisted(() => ({
  query: vi.fn(),
  mutate: vi.fn(),
  mutation: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    baggage: {
      registrationSummary: { useQuery: api.query },
      register: { useMutation: api.mutation },
    },
  },
}));
const props = {
  flightId: 41,
  bookingId: 82,
  passengerId: 92,
  segmentId: 102,
  disabled: false,
};
function summary() {
  return {
    allowanceWeightGrams: 23000,
    registeredWeightGrams: 13000,
    remainingWeightGrams: 10000,
    requiresOperationalReview: false,
    bags: [
      {
        id: 1,
        tagNumber: "0123000001",
        weightGrams: 13000,
        status: "checked_in",
        flightId: 41,
        segmentId: 102,
        legacy: false,
      },
    ],
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.query.mockReturnValue({ data: summary(), refetch: api.refetch });
  api.mutation.mockReturnValue({ mutate: api.mutate, isPending: false });
});

it("shows accepted weight and rejects a single bag that exceeds the remaining sector allowance", () => {
  render(<DcsBaggageRegistration {...props} />);
  expect(screen.getByText("0123000001")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "10.01" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Weight exceeds");
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  expect(api.mutate).not.toHaveBeenCalled();
});

it("recovers a lost 13 kg receipt with its original command after the allowance falls from 23 kg to 10 kg", () => {
  api.query.mockReturnValue({
    data: {
      ...summary(),
      registeredWeightGrams: 0,
      remainingWeightGrams: 23000,
      bags: [],
    },
    refetch: api.refetch,
  });
  const view = render(<DcsBaggageRegistration {...props} />);
  const weight = screen.getByLabelText("Bag weight in kilograms");
  const description = screen.getByLabelText("Bag description (optional)");
  const handling = screen.getByLabelText("Handling instructions (optional)");
  const register = screen.getByRole("button", {
    name: "Register received bag",
  });
  fireEvent.change(weight, { target: { value: "13" } });
  fireEvent.change(description, { target: { value: "Blue suitcase" } });
  fireEvent.change(handling, { target: { value: "Fragile" } });
  fireEvent.click(register);
  const first = api.mutate.mock.calls[0][0];
  expect(first).toEqual({
    flightId: 41,
    bookingId: 82,
    passengerId: 92,
    segmentId: 102,
    weight: 13,
    description: "Blue suitcase",
    specialHandling: "Fragile",
    idempotencyKey: expect.any(String),
  });
  act(() =>
    api.mutation.mock.calls
      .at(-1)![0]
      .onError(new Error("Connection lost"), first)
  );
  api.query.mockReturnValue({ data: summary(), refetch: api.refetch });
  view.rerender(<DcsBaggageRegistration {...props} disabled />);
  expect(screen.getByText("10 kg")).toBeInTheDocument();
  for (const input of [weight, description, handling, register])
    expect(input).toBeDisabled();
  const recover = screen.getByRole("button", { name: "Recover bag receipt" });
  fireEvent.click(recover);
  expect(api.mutate.mock.calls[1][0]).toEqual(first);
  act(() =>
    api.mutation.mock.calls.at(-1)![0].onError(
      {
        message: "Tenant temporarily unavailable",
        data: { code: "FORBIDDEN" },
      },
      first
    )
  );
  fireEvent.click(recover);
  expect(api.mutate.mock.calls[2][0]).toEqual(first);
  act(() =>
    api.mutation.mock.calls
      .at(-1)![0]
      .onSuccess({ baggage: { tagNumber: "0123000001" } })
  );
  expect(screen.getByRole("status")).toHaveTextContent("0123000001");
  expect(
    screen.queryByRole("button", { name: "Recover bag receipt" })
  ).not.toBeInTheDocument();
  expect(weight).toHaveValue(null);
  expect(register).toBeDisabled();
  view.rerender(<DcsBaggageRegistration {...props} />);
  fireEvent.change(weight, { target: { value: "5" } });
  fireEvent.click(register);
  expect(api.mutate.mock.calls[3][0].idempotencyKey).not.toBe(
    first.idempotencyKey
  );
});

it("allows a corrected new registration after the server rejects the allowance", () => {
  render(<DcsBaggageRegistration {...props} />);
  const weight = screen.getByLabelText("Bag weight in kilograms");
  const register = screen.getByRole("button", {
    name: "Register received bag",
  });
  fireEvent.change(weight, { target: { value: "9" } });
  fireEvent.click(register);
  const first = api.mutate.mock.calls[0][0];
  act(() =>
    api.mutation.mock.calls.at(-1)![0].onError(
      {
        message: "Allowance exceeded",
        data: { code: "PRECONDITION_FAILED" },
      },
      first
    )
  );
  expect(
    screen.queryByRole("button", { name: "Recover bag receipt" })
  ).not.toBeInTheDocument();
  expect(weight).toBeEnabled();
  fireEvent.change(weight, { target: { value: "4" } });
  fireEvent.click(register);
  const corrected = api.mutate.mock.calls[1][0];
  expect(corrected.weight).toBe(4);
  expect(corrected.idempotencyKey).not.toBe(first.idempotencyKey);
});

it("blocks ambiguous legacy bags and shows review instead of a made-up remaining allowance", () => {
  api.query.mockReturnValue({
    data: {
      ...summary(),
      requiresOperationalReview: true,
      registeredWeightGrams: null,
      remainingWeightGrams: null,
    },
    refetch: api.refetch,
  });
  render(<DcsBaggageRegistration {...props} />);
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "1" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Operational review is required"
  );
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
});

it("does not write using a failed or refreshing summary", () => {
  api.query.mockReturnValue({
    data: summary(),
    error: { message: "Read failed" },
    refetch: api.refetch,
  });
  const view = render(<DcsBaggageRegistration {...props} />);
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "1" },
  });
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Read failed");
  api.query.mockReturnValue({
    data: summary(),
    isFetching: true,
    refetch: api.refetch,
  });
  view.rerender(<DcsBaggageRegistration {...props} />);
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  expect(api.mutate).not.toHaveBeenCalled();
});
