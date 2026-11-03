import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DcsBaggageRegistration } from "../DcsBaggageRegistration";
import {
  bagRegistrationStorageKey,
  readBagRegistration,
} from "@/lib/baggage-registration-intent";

const api = vi.hoisted(() => ({
  actor: { id: 17, tenantId: 4, role: "ops" } as {
    id: number;
    tenantId: number;
    role: string;
  } | null,
  query: vi.fn(),
  mutate: vi.fn(),
  mutation: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: api.actor, loading: false }),
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
const scope = { actorId: 17, tenantId: 4, ...props };
const storageScope = {
  actorId: scope.actorId,
  tenantId: scope.tenantId,
  bookingId: scope.bookingId,
  passengerId: scope.passengerId,
  flightId: scope.flightId,
  segmentId: scope.segmentId,
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
  api.mutate.mockReset();
  sessionStorage.clear();
  api.actor = { id: 17, tenantId: 4, role: "ops" };
  api.query.mockReturnValue({ data: summary(), refetch: api.refetch });
  api.mutation.mockReturnValue({ mutate: api.mutate, isPending: false });
});
afterEach(() => vi.restoreAllMocks());

function submitBag(weight = "5") {
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: weight },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Register received bag" })
  );
  return api.mutate.mock.calls.at(-1)![0];
}

it("has persisted the exact command before the first request is sent", () => {
  api.mutate.mockImplementation(command => {
    expect(readBagRegistration(sessionStorage, storageScope)).toEqual(command);
  });
  render(<DcsBaggageRegistration {...props} />);
  submitBag();
  expect(api.mutate).toHaveBeenCalledOnce();
});

it("restores the exact first-send command after unmount before any reply", () => {
  const view = render(<DcsBaggageRegistration {...props} />);
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Bag description (optional)"), {
    target: { value: "Blue cabin bag" },
  });
  fireEvent.change(screen.getByLabelText("Handling instructions (optional)"), {
    target: { value: "Fragile" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Register received bag" })
  );
  const first = api.mutate.mock.calls[0][0];
  view.unmount();
  render(<DcsBaggageRegistration {...props} />);
  expect(screen.getByLabelText("Bag weight in kilograms")).toHaveValue(5);
  expect(screen.getByLabelText("Bag description (optional)")).toHaveValue(
    "Blue cabin bag"
  );
  expect(screen.getByLabelText("Handling instructions (optional)")).toHaveValue(
    "Fragile"
  );
  expect(screen.getByLabelText("Bag weight in kilograms")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  expect(api.mutate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Recover bag receipt" }));
  expect(api.mutate.mock.calls[1][0]).toEqual(first);
});

it("hides an uncertain receipt while signed out and restores it for the same actor", () => {
  const view = render(<DcsBaggageRegistration {...props} />);
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "5" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Register received bag" })
  );
  const first = api.mutate.mock.calls[0][0];
  act(() =>
    api.mutation.mock.calls
      .at(-1)![0]
      .onError(new Error("Lost response"), first)
  );
  api.actor = null;
  view.rerender(<DcsBaggageRegistration {...props} />);
  expect(
    screen.queryByRole("button", { name: "Recover bag receipt" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Bag weight in kilograms")
  ).not.toBeInTheDocument();
  api.actor = { id: 17, tenantId: 4, role: "ops" };
  view.rerender(<DcsBaggageRegistration {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Recover bag receipt" }));
  expect(api.mutate.mock.calls[1][0]).toEqual(first);
});

it.each([
  "actorId",
  "tenantId",
  "bookingId",
  "passengerId",
  "flightId",
  "segmentId",
] as const)(
  "does not expose or replay a pending receipt after %s changes",
  field => {
    const view = render(<DcsBaggageRegistration {...props} />);
    const first = submitBag();
    const changed = { ...props };
    if (field === "actorId") api.actor = { id: 18, tenantId: 4, role: "ops" };
    else if (field === "tenantId")
      api.actor = { id: 17, tenantId: 5, role: "ops" };
    else changed[field] += 1;
    view.rerender(<DcsBaggageRegistration {...changed} />);
    expect(
      screen.queryByRole("button", { name: "Recover bag receipt" })
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Bag weight in kilograms")).toHaveValue(null);
    const other = submitBag("2");
    expect(other.idempotencyKey).not.toBe(first.idempotencyKey);
    api.actor = { id: 17, tenantId: 4, role: "ops" };
    view.rerender(<DcsBaggageRegistration {...props} />);
    expect(screen.getByLabelText("Bag weight in kilograms")).toHaveValue(5);
    fireEvent.click(
      screen.getByRole("button", { name: "Recover bag receipt" })
    );
    expect(api.mutate.mock.calls[2][0]).toEqual(first);
  }
);

it("a late acknowledgement clears only the original actor's command", () => {
  const view = render(<DcsBaggageRegistration {...props} />);
  const first = submitBag();
  const firstCallbacks = api.mutation.mock.calls.at(-1)![0];
  api.actor = { id: 18, tenantId: 4, role: "ops" };
  view.rerender(<DcsBaggageRegistration {...props} />);
  const other = submitBag("2");
  act(() =>
    firstCallbacks.onSuccess({ baggage: { tagNumber: "0123000017" } }, first)
  );
  expect(screen.queryByText("0123000017")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recover bag receipt" }));
  expect(api.mutate.mock.calls[2][0]).toEqual(other);
  api.actor = { id: 17, tenantId: 4, role: "ops" };
  view.rerender(<DcsBaggageRegistration {...props} />);
  expect(
    screen.queryByRole("button", { name: "Recover bag receipt" })
  ).not.toBeInTheDocument();
});

it("updates a restored view when the original request is acknowledged after remount", () => {
  const original = render(<DcsBaggageRegistration {...props} />);
  const command = submitBag();
  const callbacks = api.mutation.mock.calls.at(-1)![0];
  original.unmount();
  render(<DcsBaggageRegistration {...props} />);
  expect(
    screen.getByRole("button", { name: "Recover bag receipt" })
  ).toBeVisible();
  act(() =>
    callbacks.onSuccess({ baggage: { tagNumber: "0123000017" } }, command)
  );
  expect(
    screen.queryByRole("button", { name: "Recover bag receipt" })
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Bag weight in kilograms")).toHaveValue(null);
  expect(screen.getByLabelText("Bag weight in kilograms")).toBeEnabled();
});

it("blocks a malformed saved receipt without deleting it or sending a new bag", () => {
  const key = bagRegistrationStorageKey(storageScope);
  sessionStorage.setItem(key, "corrupted receipt");
  render(<DcsBaggageRegistration {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Registration is blocked"
  );
  expect(screen.getByLabelText("Bag weight in kilograms")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  expect(api.mutate).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBe("corrupted receipt");
});

it.each(["getItem", "setItem"] as const)(
  "does not send a bag when browser storage %s fails",
  method => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    render(<DcsBaggageRegistration {...props} />);
    if (method === "setItem") {
      fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
        target: { value: "5" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Register received bag" })
      );
    }
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Registration is blocked"
    );
    expect(
      screen.getByRole("button", { name: "Register received bag" })
    ).toBeDisabled();
    expect(api.mutate).not.toHaveBeenCalled();
  }
);

it("does not send if storage silently fails to retain the request", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  render(<DcsBaggageRegistration {...props} />);
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "5" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Register received bag" })
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Registration is blocked"
  );
  expect(api.mutate).not.toHaveBeenCalled();
});

it("preserves the saved command across authorization errors before and after remount", () => {
  const view = render(<DcsBaggageRegistration {...props} />);
  const first = submitBag();
  const rejection = { message: "Unauthorized", data: { code: "UNAUTHORIZED" } };
  act(() => api.mutation.mock.calls.at(-1)![0].onError(rejection, first));
  expect(readBagRegistration(sessionStorage, storageScope)).toEqual(first);
  view.unmount();
  render(<DcsBaggageRegistration {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Recover bag receipt" }));
  act(() => api.mutation.mock.calls.at(-1)![0].onError(rejection, first));
  expect(readBagRegistration(sessionStorage, storageScope)).toEqual(first);
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Recover bag receipt" }));
  expect(api.mutate.mock.calls.at(-1)![0]).toEqual(first);
});

it("keeps a restored retry when an older attempt reports a late business rejection", () => {
  const original = render(<DcsBaggageRegistration {...props} />);
  const command = submitBag();
  const oldCallbacks = api.mutation.mock.calls.at(-1)![0];
  original.unmount();
  render(<DcsBaggageRegistration {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Recover bag receipt" }));
  const recoveryCallbacks = api.mutation.mock.calls.at(-1)![0];
  const rejection = {
    message: "Check-in closed",
    data: { code: "PRECONDITION_FAILED" },
  };
  act(() => oldCallbacks.onError(rejection, command));
  expect(readBagRegistration(sessionStorage, storageScope)).toEqual(command);
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
  act(() => recoveryCallbacks.onError(rejection, command));
  expect(readBagRegistration(sessionStorage, storageScope)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Recover bag receipt" })
  ).not.toBeInTheDocument();
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
    expectedActorId: 17,
    expectedTenantId: 4,
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
      .onSuccess({ baggage: { tagNumber: "0123000001" } }, first)
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
