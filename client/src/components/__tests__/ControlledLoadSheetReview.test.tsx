import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ControlledLoadSheetReview } from "../ControlledLoadSheetReview";
const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  evaluate: vi.fn(),
  verify: vi.fn(),
  fetch: vi.fn(),
  unavailable: false,
}));
vi.mock("../OperationalReadState", () => ({
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    weightBalance: {
      reviewFlight: {
        useQuery: ({ flightId }: { flightId: number }) => ({
          data:
            flightId === 7 && !mocks.unavailable
              ? {
                  flightId,
                  flightNumber: "TEST71",
                  registrationId: 11,
                  edition: 4,
                  status: "signed_draft",
                  evaluatedBy: 3,
                  assignment: { id: 17, userId: 8, reason: "Maintenance" },
                }
              : undefined,
          error:
            flightId && mocks.unavailable
              ? new Error("Operator data unavailable")
              : null,
          isFetching: false,
          refetch: mocks.fetch,
        }),
      },
      assignAircraft: {
        useMutation: () => ({ mutate: mocks.assign, isPending: false }),
      },
      evaluateDraft: {
        useMutation: () => ({ mutate: mocks.evaluate, isPending: false }),
      },
      verifyCurrentDraft: {
        useQuery: () => ({ refetch: mocks.verify, isFetching: false }),
      },
    },
  },
}));
it("binds an operator swap to the displayed aircraft, edition and assignment receipt", () => {
  render(<ControlledLoadSheetReview />);
  fireEvent.change(screen.getByLabelText("Flight ID"), {
    target: { value: "7" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Read current flight" }));
  expect(screen.getByText(/Maintenance/)).toHaveTextContent("#8");
  expect(screen.getByRole("status")).toHaveTextContent("Edition 4");
  const record = screen.getByRole("button", {
    name: "Record assignment and supersede prior draft",
  });
  expect(record).toBeDisabled();
  fireEvent.change(screen.getByLabelText("New aircraft registration ID"), {
    target: { value: "12" },
  });
  fireEvent.change(
    screen.getByLabelText("Reason for aircraft assignment or swap"),
    { target: { value: "Replacement tail" } }
  );
  fireEvent.click(record);
  expect(mocks.assign).toHaveBeenCalledWith({
    flightId: 7,
    registrationId: 12,
    reason: "Replacement tail",
    expectedRegistrationId: 11,
    expectedEdition: 4,
    expectedAssignmentEventId: 17,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify current draft signature" })
  );
  expect(mocks.verify).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Flight ID"), {
    target: { value: "8" },
  });
  expect(
    screen.queryByRole("button", {
      name: "Record assignment and supersede prior draft",
    })
  ).toBeNull();
});
it("does not display mutation controls when review is unavailable", () => {
  mocks.unavailable = true;
  try {
    render(<ControlledLoadSheetReview />);
    fireEvent.change(screen.getByLabelText("Flight ID"), {
      target: { value: "7" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Read current flight" })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Operator data unavailable"
    );
    expect(screen.queryByLabelText("New aircraft registration ID")).toBeNull();
  } finally {
    mocks.unavailable = false;
  }
});
