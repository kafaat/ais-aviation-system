import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DcsStationPanel } from "../DcsStationPanel";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const state = vi.hoisted(() => ({
  user: { id: 17, tenantId: 4, role: "airline_admin" },
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error },
}));

const passengers = [
  { bookingId: 71, passengerId: 81, name: "First Traveler" },
  { bookingId: 72, passengerId: 82, name: "Second Traveler" },
];
const reason = "Synthetic station verification";
const report = () => ({
  flightId: 41,
  flightNumber: "SYN41",
  departureTime: new Date("2030-01-01T10:00:00Z"),
  items: [],
  unresolvedServices: 0,
  closedAt: null,
  stationOffBlocksAt: null,
  cases: [
    {
      id: 70,
      kind: "no_rec",
      stationReference: "CASE70",
      dismissed: false,
      resolvedPassengerId: null,
    },
  ],
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  vi.useFakeTimers();
  state.user = { id: 17, tenantId: 4, role: "airline_admin" };
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function elapse(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function panel(flightId = 41) {
  return (
    <DcsStationPanel
      flightId={flightId}
      passengers={passengers}
      disabled={false}
      reportReady={true}
      reopenOnly={false}
    />
  );
}
async function visit(
  handlers: Record<string, (input: unknown) => unknown> = {}
) {
  const fixture = createTrpcFixture({
    "dcsOperations.stationReport": report,
    ...handlers,
  });
  const view = render(panel(), { wrapper: fixture.Wrapper });
  fireEvent.click(
    screen.getByRole("button", { name: "Station reports and actions" })
  );
  await elapse();
  return { ...fixture, ...view };
}
function mode(value: string) {
  fireEvent.change(screen.getByLabelText("Station action"), {
    target: { value },
  });
}
function setReason() {
  fireEvent.change(screen.getByLabelText("Reason for station action"), {
    target: { value: reason },
  });
}
const base = { flightId: 41, reason, expectedActorId: 17, expectedTenantId: 4 };
const request = (fixture: Awaited<ReturnType<typeof visit>>, path: string) =>
  fixture.requests.filter(r => r.path === path);

it.each(["no_rec", "go_show"])(
  "binds a %s case to the displayed operator and retries the identical failed command",
  async kind => {
    let attempts = 0;
    const fixture = await visit({
      "dcsOperations.openCase": () => {
        if (++attempts === 1) throw new Error("Lost station command response");
        return { eventId: 90 };
      },
    });
    mode(kind);
    fireEvent.change(screen.getByLabelText("Station case reference"), {
      target: { value: "case-90" },
    });
    setReason();
    fireEvent.click(
      screen.getByRole("button", { name: "Save station action" })
    );
    await elapse();
    expect(state.error).toHaveBeenCalledWith("Lost station command response");
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Reason for station action")).toHaveValue(
      reason
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save station action" })
    );
    await elapse();
    const attemptsMade = request(fixture, "dcsOperations.openCase");
    expect(attemptsMade).toHaveLength(2);
    expect(attemptsMade[0].input).toEqual({
      ...base,
      kind,
      stationReference: "CASE-90",
      idempotencyKey: expect.any(String),
    });
    expect(attemptsMade[1].input).toEqual(attemptsMade[0].input);
    expect(state.success).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Reason for station action")).toHaveValue("");
  }
);

it("sends the chosen date range and normalized seat numbers and refreshes the station report after a block", async () => {
  const fixture = await visit({
    "dcsOperations.blockSeats": () => ({ eventId: 91 }),
  });
  mode("block");
  fireEvent.change(screen.getByLabelText("First date UTC"), {
    target: { value: "2030-01-01" },
  });
  fireEvent.change(screen.getByLabelText("Last date UTC"), {
    target: { value: "2030-01-03" },
  });
  fireEvent.change(screen.getByLabelText("Comma-separated seats"), {
    target: { value: " 2a, 2b 3c " },
  });
  setReason();
  fireEvent.click(screen.getByRole("button", { name: "Save station action" }));
  await elapse();
  expect(request(fixture, "dcsOperations.blockSeats")[0].input).toMatchObject({
    ...base,
    startDate: "2030-01-01",
    endDate: "2030-01-03",
    seatNumbers: ["2A", "2B", "3C"],
  });
  expect(request(fixture, "dcsOperations.stationReport")).toHaveLength(2);
});

it.each(["dismiss", "resolve", "osi", "remap"])(
  "routes %s to the chosen case, passenger or map with the actor scope",
  async action => {
    const endpoint = {
      dismiss: "dismissCase",
      resolve: "resolveCase",
      osi: "addOsi",
      remap: "remapSeats",
    }[action]!;
    const fixture = await visit({
      [`dcsOperations.${endpoint}`]: () => ({ eventId: 92 }),
    });
    mode(action);
    if (action === "dismiss" || action === "resolve")
      fireEvent.change(screen.getByLabelText("Open case"), {
        target: { value: "70" },
      });
    if (action === "resolve" || action === "osi")
      fireEvent.change(screen.getByLabelText("Flight passenger"), {
        target: { value: "82" },
      });
    if (action === "remap")
      fireEvent.change(screen.getByLabelText("Airline seat plan ID"), {
        target: { value: "15" },
      });
    fireEvent.change(
      screen.getByLabelText(
        action === "osi"
          ? "Operational note shown on APFAX"
          : "Reason for station action"
      ),
      { target: { value: reason } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save station action" })
    );
    await elapse();
    expect(
      request(fixture, `dcsOperations.${endpoint}`)[0].input
    ).toMatchObject({
      ...base,
      ...(["dismiss", "resolve"].includes(action) ? { caseId: 70 } : {}),
      ...(["resolve", "osi"].includes(action)
        ? { passengerId: 82, bookingId: 72 }
        : {}),
      ...(action === "remap" ? { seatMapId: 15 } : {}),
    });
  }
);

it("confirms only the displayed downgrade proposal and disables repeated submission while it is pending", async () => {
  const pending = deferred<{ eventId: number }>();
  const fixture = await visit({
    "dcsOperations.quoteDowngrade": () => ({ eventId: 93, refundDue: 12345 }),
    "dcsOperations.confirmDowngrade": () => pending.promise,
  });
  mode("downgrade");
  fireEvent.change(screen.getByLabelText("Flight passenger"), {
    target: { value: "81" },
  });
  setReason();
  fireEvent.click(
    screen.getByRole("button", { name: "Quote fare difference" })
  );
  await elapse();
  expect(request(fixture, "dcsOperations.confirmDowngrade")).toEqual([]);
  expect(screen.getByRole("status")).toHaveTextContent("123.45");
  const confirm = screen.getByRole("button", {
    name: "Confirm reviewed cabin downgrade",
  });
  fireEvent.click(confirm);
  await elapse();
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(request(fixture, "dcsOperations.confirmDowngrade")).toHaveLength(1);
  expect(
    request(fixture, "dcsOperations.confirmDowngrade")[0].input
  ).toMatchObject({
    ...base,
    passengerId: 81,
    bookingId: 71,
    quoteEventId: 93,
    expectedRefund: 12345,
  });
  await act(() => pending.resolve({ eventId: 94 }));
  await elapse();
  expect(
    screen.getByRole("button", { name: "Quote fare difference" })
  ).toBeEnabled();
});

it("requires a new quote after changing passenger or flight", async () => {
  const fixture = await visit({
    "dcsOperations.quoteDowngrade": () => ({ eventId: 95, refundDue: 5000 }),
  });
  mode("downgrade");
  fireEvent.change(screen.getByLabelText("Flight passenger"), {
    target: { value: "81" },
  });
  setReason();
  fireEvent.click(
    screen.getByRole("button", { name: "Quote fare difference" })
  );
  await elapse();
  fireEvent.change(screen.getByLabelText("Flight passenger"), {
    target: { value: "82" },
  });
  expect(
    screen.queryByRole("button", { name: "Confirm reviewed cabin downgrade" })
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Quote fare difference" })
  );
  await elapse();
  expect(
    request(fixture, "dcsOperations.quoteDowngrade")[1].input
  ).toMatchObject({ passengerId: 82, bookingId: 72 });
  fixture.rerender(panel(42));
  await elapse();
  expect(
    screen.queryByRole("button", { name: "Confirm reviewed cabin downgrade" })
  ).toBeNull();
  expect(screen.getByLabelText("Station action")).toHaveValue("no_rec");
});

it("drops a supervisor-only proposal when the mounted operator loses that role", async () => {
  const fixture = await visit({
    "dcsOperations.quoteDowngrade": () => ({ eventId: 96, refundDue: 5000 }),
  });
  mode("downgrade");
  fireEvent.change(screen.getByLabelText("Flight passenger"), {
    target: { value: "81" },
  });
  setReason();
  fireEvent.click(
    screen.getByRole("button", { name: "Quote fare difference" })
  );
  await elapse();
  expect(
    screen.getByRole("button", { name: "Confirm reviewed cabin downgrade" })
  ).toBeVisible();
  state.user = { ...state.user, role: "ops" };
  fixture.rerender(panel());
  await elapse();
  expect(
    screen.queryByRole("button", { name: "Confirm reviewed cabin downgrade" })
  ).toBeNull();
  expect(
    screen.queryByRole("option", { name: "Review cabin downgrade" })
  ).toBeNull();
  expect(screen.getByLabelText("Station action")).toHaveValue("no_rec");
  expect(request(fixture, "dcsOperations.confirmDowngrade")).toEqual([]);
});
