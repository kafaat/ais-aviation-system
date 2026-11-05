import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import LoadPlanning from "../LoadPlanning";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

const aircraft = { id: 4, code: "TEST", name: "Synthetic trainer" };
const compartment = {
  id: 3,
  compartmentCode: "FWD",
  name: "Forward fixture hold",
  position: "forward",
  maxWeight: 1000000,
  maxVolume: 4000,
  uldCompatible: true,
};
const items = [
  {
    id: 11,
    loadPlanId: 8,
    compartmentId: 3,
    itemType: "baggage",
    description: "Fixture baggage",
    pieces: 2,
    weight: 200000,
    volume: 100,
    status: "planned",
    uldNumber: null,
  },
  {
    id: 12,
    loadPlanId: 8,
    compartmentId: 3,
    itemType: "cargo",
    description: "Fixture cargo",
    pieces: 1,
    weight: 700000,
    volume: 200,
    status: "planned",
    uldNumber: null,
  },
];
const plan = (status = "draft") => ({
  id: 8,
  flightId: 7,
  status,
  updatedAt: new Date("2030-01-01T12:00:00Z"),
  lastAmendedAt: null,
  totalBaggage: 200000,
  totalCargo: 700000,
  totalMail: 0,
  deadload: 900000,
  items,
  compartments: [
    {
      compartment,
      items,
      totalWeight: 900000,
      totalVolume: 300,
      fillPercentWeight: 90,
      fillPercentVolume: 7.5,
    },
  ],
});
type Handlers = Parameters<typeof createTrpcFixture>[0];

function visit(overrides: Handlers = {}) {
  const fixture = createTrpcFixture({
    "dcs.getAircraftTypes": () => [aircraft],
    "loadPlanning.get": () => plan(),
    "loadPlanning.validate": () => ({ valid: true, errors: [], warnings: [] }),
    ...overrides,
  });
  render(
    <fixture.Wrapper>
      <LoadPlanning />
    </fixture.Wrapper>
  );
  return fixture;
}
function enterFlight(value = "7") {
  fireEvent.change(
    screen.getByPlaceholderText(i18n.t("loadPlanning.enterFlightId")),
    {
      target: { value },
    }
  );
}
async function choose(control: HTMLElement, name: string) {
  fireEvent.keyDown(control, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}

it("keeps an invalid flight identifier from selecting a truncated flight or exposing mutation controls", async () => {
  const { requests } = visit();
  expect(screen.getByText(i18n.t("dcs.loadTrainingNotice"))).toBeVisible();
  expect(
    screen.getByText(i18n.t("loadPlanning.enterFlightFirst"))
  ).toBeVisible();
  enterFlight("7.5");
  // Let the HTTP batch queue run; an incorrectly enabled query would appear.
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(requests).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: i18n.t("loadPlanning.createPlan") })
  ).not.toBeInTheDocument();
});

it("keeps a failed plan lookup distinct from an absent plan and allows a read retry", async () => {
  let available = false;
  const { requests } = visit({
    "loadPlanning.get": () => {
      if (!available)
        throw new Error(
          "Load planning simulation has no verified production adapter configured"
        );
      return null;
    },
  });
  enterFlight();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no verified production adapter"
  );
  expect(
    screen.queryByRole("button", { name: i18n.t("loadPlanning.createPlan") })
  ).not.toBeInTheDocument();
  available = true;
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("common.retry", "Retry") })
  );
  expect(
    await screen.findByRole("button", {
      name: i18n.t("loadPlanning.createPlan"),
    })
  ).toBeEnabled();
  expect(
    requests.filter(request => request.path === "loadPlanning.get")
  ).toHaveLength(2);
  expect(requests.some(request => request.path === "loadPlanning.create")).toBe(
    false
  );
});

it("creates only after an absent-plan response and waits for the server before showing a plan", async () => {
  const response = deferred<ReturnType<typeof plan>>();
  let created = false;
  const { requests } = visit({
    "loadPlanning.get": () => (created ? plan() : null),
    "loadPlanning.create": () => response.promise,
  });
  enterFlight();
  const create = await screen.findByRole("button", {
    name: i18n.t("loadPlanning.createPlan"),
  });
  fireEvent.click(create);
  await waitFor(() => expect(create).toBeDisabled());
  expect(notices.success).not.toHaveBeenCalled();
  created = true;
  await act(async () => response.resolve(plan()));
  expect(await screen.findByText("draft")).toBeVisible();
  expect(
    requests.filter(request => request.path === "loadPlanning.create")
  ).toEqual([{ path: "loadPlanning.create", input: { flightId: 7 } }]);
  expect(
    await screen.findByText(i18n.t("loadPlanning.validationPass"))
  ).toBeVisible();
});

it("refreshes both the plan and validation after optimization and finalizes only after server success", async () => {
  let status = "draft";
  let validation = {
    valid: false,
    errors: ["Fixture hold overloaded"],
    warnings: ["Review cargo distribution"],
  };
  const response = deferred<{ success: boolean }>();
  const { requests } = visit({
    "loadPlanning.get": () => plan(status),
    "loadPlanning.validate": () => validation,
    "loadPlanning.optimize": () => {
      status = "optimized";
      validation = { valid: true, errors: [], warnings: [] };
      return plan(status);
    },
    "loadPlanning.finalize": () => response.promise,
  });
  enterFlight();
  await screen.findByText("Fixture hold overloaded");
  expect(screen.getByText("Review cargo distribution")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("loadPlanning.optimize") })
  );
  expect(await screen.findByText("optimized")).toBeVisible();
  expect(
    await screen.findByText(i18n.t("loadPlanning.validationPass"))
  ).toBeVisible();
  expect(screen.queryByText("Fixture hold overloaded")).not.toBeInTheDocument();
  const finalize = screen.getByRole("button", {
    name: i18n.t("loadPlanning.finalize"),
  });
  fireEvent.click(finalize);
  await waitFor(() => expect(finalize).toBeDisabled());
  expect(screen.queryByText("finalized")).not.toBeInTheDocument();
  status = "finalized";
  await act(async () => response.resolve({ success: true }));
  expect(await screen.findByText("finalized")).toBeVisible();
  expect(
    screen.getByRole("button", { name: i18n.t("loadPlanning.optimize") })
  ).toBeDisabled();
  expect(finalize).toBeDisabled();
  expect(
    requests.filter(request =>
      /loadPlanning\.(optimize|finalize)$/.test(request.path)
    )
  ).toEqual([
    { path: "loadPlanning.optimize", input: { flightId: 7 } },
    { path: "loadPlanning.finalize", input: { flightId: 7 } },
  ]);
});

it("reports a rejected finalization without changing the displayed plan status", async () => {
  visit({
    "loadPlanning.finalize": () => {
      throw new Error("Compartment reconciliation required");
    },
  });
  enterFlight();
  const finalize = await screen.findByRole("button", {
    name: i18n.t("loadPlanning.finalize"),
  });
  await waitFor(() => expect(finalize).toBeEnabled());
  fireEvent.click(finalize);
  await waitFor(() =>
    expect(notices.error).toHaveBeenCalledWith(
      "Compartment reconciliation required"
    )
  );
  expect(screen.getByText("draft")).toBeVisible();
  expect(screen.queryByText("finalized")).not.toBeInTheDocument();
  expect(notices.success).not.toHaveBeenCalled();
});

it("reads the selected aircraft layout and derives only training ULD estimates from the current plan", async () => {
  const { requests } = visit({
    "loadPlanning.getCompartments": () => ({
      aircraftType: { ...aircraft, isWidebody: true },
      totalMaxWeight: 1000000,
      totalMaxVolume: 4000,
      compartments: [compartment],
    }),
  });
  enterFlight();
  await screen.findByText("draft");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("loadPlanning.tabs.compartments"),
    })
  );
  await choose(screen.getByRole("combobox"), "TEST - Synthetic trainer");
  expect(await screen.findByText("Widebody")).toBeVisible();
  expect(requests).toContainEqual({
    path: "loadPlanning.getCompartments",
    input: { aircraftTypeId: 4 },
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("loadPlanning.tabs.uld") })
  );
  expect(await screen.findByText(/2x LD-3/)).toBeVisible();
  expect(screen.getByText(/2x PMC/)).toBeVisible();
  expect(screen.getByText(i18n.t("dcs.loadTrainingNotice"))).toBeVisible();
});

it("requires a passing current validation before finalization and waits for optimization and its refreshed validation", async () => {
  const optimization = deferred<ReturnType<typeof plan>>();
  const validation = deferred<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>();
  let optimized = false;
  const { requests } = visit({
    "loadPlanning.get": () => plan(optimized ? "optimized" : "draft"),
    "loadPlanning.validate": () =>
      optimized
        ? validation.promise
        : {
            valid: false,
            errors: ["Synthetic forward hold exceeds limit"],
            warnings: [],
          },
    "loadPlanning.optimize": () => optimization.promise,
    "loadPlanning.finalize": () => {
      throw new Error("Operator changed the load plan");
    },
  });
  enterFlight();
  await screen.findByText("Synthetic forward hold exceeds limit");
  const finalize = screen.getByRole("button", {
    name: i18n.t("loadPlanning.finalize"),
  });
  expect(finalize).toBeDisabled();
  fireEvent.click(finalize);
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("loadPlanning.optimize") })
  );
  await waitFor(() =>
    expect(
      requests.filter(r => r.path === "loadPlanning.optimize")
    ).toHaveLength(1)
  );
  expect(finalize).toBeDisabled();
  optimized = true;
  await act(async () => optimization.resolve(plan("optimized")));
  await screen.findByText("optimized");
  await waitFor(() =>
    expect(
      requests.filter(r => r.path === "loadPlanning.validate")
    ).toHaveLength(2)
  );
  expect(finalize).toBeDisabled();
  fireEvent.click(finalize);
  expect(requests.filter(r => r.path === "loadPlanning.finalize")).toEqual([]);
  await act(async () =>
    validation.resolve({ valid: true, errors: [], warnings: [] })
  );
  await waitFor(() => expect(finalize).toBeEnabled());
  notices.success.mockClear();
  fireEvent.click(finalize);
  await waitFor(() =>
    expect(notices.error).toHaveBeenCalledWith("Operator changed the load plan")
  );
  expect(screen.getByText("optimized")).toBeVisible();
  expect(screen.queryByText("finalized")).not.toBeInTheDocument();
  expect(notices.success).not.toHaveBeenCalled();
});

it("does not trust cached passing validation while a new validation is pending or rejected", async () => {
  const response = deferred<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>();
  let reads = 0;
  const { requests } = visit({
    "loadPlanning.validate": () =>
      ++reads === 1
        ? {
            valid: true,
            errors: [],
            warnings: [],
          }
        : response.promise,
  });
  enterFlight();
  await screen.findByText(i18n.t("loadPlanning.validationPass"));
  const finalize = screen.getByRole("button", {
    name: i18n.t("loadPlanning.finalize"),
  });
  expect(finalize).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("loadPlanning.validate") })
  );
  await waitFor(() =>
    expect(
      requests.filter(r => r.path === "loadPlanning.validate")
    ).toHaveLength(2)
  );
  expect(finalize).toBeDisabled();
  expect(
    screen.queryByText(i18n.t("loadPlanning.validationPass"))
  ).not.toBeInTheDocument();
  await act(async () =>
    response.reject(new Error("Current loading cannot be validated"))
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Current loading cannot be validated"
  );
  expect(finalize).toBeDisabled();
  fireEvent.click(finalize);
  expect(requests.filter(r => r.path === "loadPlanning.finalize")).toEqual([]);
});

it("does not announce an old flight optimization as success for a newly selected flight", async () => {
  const response = deferred<ReturnType<typeof plan>>();
  const { requests } = visit({
    "loadPlanning.get": input => ({
      ...plan(),
      flightId: (input as { flightId: number }).flightId,
    }),
    "loadPlanning.optimize": () => response.promise,
  });
  enterFlight();
  await screen.findByText(i18n.t("loadPlanning.validationPass"));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("loadPlanning.optimize") })
  );
  await waitFor(() =>
    expect(
      requests.filter(r => r.path === "loadPlanning.optimize")
    ).toHaveLength(1)
  );
  enterFlight("8");
  await screen.findByText("draft");
  await act(async () => response.resolve(plan("optimized")));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: i18n.t("loadPlanning.optimize") })
    ).toBeEnabled()
  );
  expect(notices.success).not.toHaveBeenCalled();
  expect(screen.queryByText("optimized")).not.toBeInTheDocument();
  expect(requests.filter(r => r.path === "loadPlanning.optimize")).toEqual([
    { path: "loadPlanning.optimize", input: { flightId: 7 } },
  ]);
});

it.each(["resolved", "rejected"])(
  "keeps the selected aircraft layout when an earlier pending layout request is %s",
  async outcome => {
    const previous = deferred<{
      aircraftType: typeof aircraft & { isWidebody: boolean };
      totalMaxWeight: number;
      totalMaxVolume: number;
      compartments: (typeof compartment)[];
    }>();
    const replacement = { id: 5, code: "NEXT", name: "Replacement trainer" };
    const { requests } = visit({
      "dcs.getAircraftTypes": () => [aircraft, replacement],
      "loadPlanning.getCompartments": input =>
        (input as { aircraftTypeId: number }).aircraftTypeId === 4
          ? previous.promise
          : {
              aircraftType: { ...replacement, isWidebody: false },
              totalMaxWeight: 500000,
              totalMaxVolume: 2000,
              compartments: [
                {
                  ...compartment,
                  id: 6,
                  name: "Replacement aft hold",
                  compartmentCode: "AFT",
                  position: "aft",
                },
              ],
            },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("loadPlanning.tabs.compartments"),
      })
    );
    await choose(screen.getByRole("combobox"), "TEST - Synthetic trainer");
    await waitFor(() =>
      expect(
        requests.filter(r => r.path === "loadPlanning.getCompartments")
      ).toHaveLength(1)
    );
    await choose(screen.getByRole("combobox"), "NEXT - Replacement trainer");
    expect(await screen.findByText("Replacement aft hold")).toBeVisible();
    await act(async () => {
      if (outcome === "resolved")
        previous.resolve({
          aircraftType: { ...aircraft, isWidebody: true },
          totalMaxWeight: 1000000,
          totalMaxVolume: 4000,
          compartments: [compartment],
        });
      else
        previous.reject(new Error("Previous aircraft layout no longer exists"));
    });
    expect(screen.getByText("Replacement aft hold")).toBeVisible();
    expect(screen.getByText("Narrowbody")).toBeVisible();
    expect(screen.queryByText("Forward fixture hold")).not.toBeInTheDocument();
    expect(screen.queryByText("Widebody")).not.toBeInTheDocument();
    expect(notices.error).not.toHaveBeenCalled();
    expect(
      requests.filter(r => r.path === "loadPlanning.getCompartments")
    ).toEqual([
      { path: "loadPlanning.getCompartments", input: { aircraftTypeId: 4 } },
      { path: "loadPlanning.getCompartments", input: { aircraftTypeId: 5 } },
    ]);
  }
);
