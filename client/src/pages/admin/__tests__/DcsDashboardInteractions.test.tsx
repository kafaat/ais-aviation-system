import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import DcsDashboard from "../DcsDashboard";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

// Render the complete dashboard and its real tabs, controls and tRPC client.
// HTTP fixtures below do not validate a server, aircraft model or dispatch.
const stats = () => ({
  flights: { total: 0, scheduled: 0, delayed: 0, completed: 0 },
  crew: { total: 0, active: 0 },
  loadPlans: { total: 0, draft: 0, approved: 0, finalized: 0 },
  aircraftTypes: 0,
});
const aircraft = (id = 4) => ({
  id,
  code: id === 4 ? "TEST" : "NEXT",
  name: id === 4 ? "Synthetic trainer" : "Replacement trainer",
  manufacturer: "Fixture manufacturer",
  maxTakeoffWeight: 2000,
  maxLandingWeight: 1800,
  maxZeroFuelWeight: 1500,
  operatingEmptyWeight: 1000,
  maxPayload: 500,
  maxFuelCapacity: 500,
  totalSeats: 10,
  economySeats: 10,
  businessSeats: 0,
});
const calculation = (id = 81, withinLimits = true) => ({
  id,
  aircraft: {
    code: "TEST",
    name: "Synthetic trainer",
    limits: {
      mtow: 2000,
      mlw: 1800,
      mzfw: 1500,
      oew: 1000,
      maxPayload: 500,
      maxFuel: 500,
    },
  },
  weights: {
    operatingEmpty: 1000,
    passengers: { count: 0, weight: 0 },
    baggage: { count: 0, weight: 0 },
    cargo: { zones: [], weight: 0 },
    fuel: 100.75,
    payload: 0,
    zeroFuel: 1000,
    takeoff: 1100.75,
    landing: 1020,
  },
  balance: { cgPosition: 25, forwardLimit: 15, aftLimit: 35 },
  safety: {
    withinLimits,
    warnings: withinLimits ? [] : ["Synthetic takeoff limit exceeded"],
  },
});
type Handlers = Parameters<typeof createTrpcFixture>[0];
function visit(overrides: Handlers = {}) {
  const fixture = createTrpcFixture({
    "dcs.getStats": stats,
    "dcs.getAircraftTypes": () => [aircraft(), aircraft(5)],
    "dcs.getCrewMembers": () => [],
    "dcs.getLoadPlan": () => null,
    "dcs.createLoadPlan": () => calculation(),
    ...overrides,
  });
  render(<DcsDashboard />, { wrapper: fixture.Wrapper });
  return fixture;
}
const requestsFor = (fixture: ReturnType<typeof visit>, path: string) =>
  fixture.requests.filter(request => request.path === path);
async function tab(id: "crew" | "loadPlan" | "aircraft" | "overview") {
  fireEvent.click(
    await screen.findByRole("button", { name: i18n.t(`dcs.tabs.${id}`) })
  );
}
// Legacy dashboard labels are siblings of their controls, not associated labels.
function field(label: string) {
  const element = screen
    .getByText(label, { selector: "label" })
    .parentElement!.querySelector<HTMLInputElement>("input");
  if (!element) throw new Error(`Missing input for ${label}`);
  return element;
}
function enter(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}
async function choose(name: string) {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}
const calculateButton = () =>
  screen.getByRole("button", { name: i18n.t("dcs.loadPlan.calculateBtn") });
const approveButton = () =>
  screen.queryByRole("button", { name: i18n.t("dcs.loadPlan.approve") });
async function prepareLoadPlan(fuel = "100.75") {
  await tab("loadPlan");
  enter(i18n.t("dcs.loadPlan.flightId"), "7");
  await choose("TEST - Synthetic trainer");
  enter(i18n.t("dcs.loadPlan.fuelWeight"), fuel);
}
async function prepareCrew() {
  await tab("crew");
  await screen.findByText(i18n.t("dcs.crew.empty"));
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("dcs.crew.addNew") })
  );
  enter(i18n.t("dcs.crew.employeeId"), "SYN-9");
  enter(i18n.t("dcs.crew.firstName"), "Aisha");
  enter(i18n.t("dcs.crew.lastName"), "Synthetic");
  enter(i18n.t("dcs.crew.airlineId"), "3");
  await choose(i18n.t("dcs.crew.captain"));
}
async function prepareAircraft() {
  await tab("aircraft");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("dcs.aircraft.addNew") })
  );
  enter(i18n.t("dcs.aircraft.code"), "ZERO");
  enter(i18n.t("dcs.aircraft.name"), "No business cabin");
  enter(i18n.t("dcs.aircraft.manufacturer"), "Fixture manufacturer");
  enter("MTOW (kg)", "2000.5");
  enter("MLW (kg)", "1800.5");
  enter("MZFW (kg)", "1500.5");
  enter("OEW (kg)", "1000.5");
  enter(`${i18n.t("dcs.aircraft.maxPayload")} (kg)`, "500");
  enter(`${i18n.t("dcs.aircraft.maxFuel")} (kg)`, "500");
  enter(i18n.t("dcs.aircraft.totalSeats"), "10");
  enter(i18n.t("dcs.aircraft.economySeats"), "10");
  enter(i18n.t("dcs.aircraft.businessSeats"), "0");
}

it("renders zero dashboard counts and keeps the training tab available only when the server exposes it", async () => {
  const fixture = visit({
    "dcs.getStats": () => ({ ...stats(), loadPlans: null }),
  });
  await screen.findByText(i18n.t("dcs.stats.active") + ": 0");
  for (const key of ["todayFlights", "crewMembers", "aircraftTypes"]) {
    const label = screen.getByText(i18n.t(`dcs.stats.${key}`), {
      selector: "span",
    });
    expect(
      within(label.parentElement!.parentElement!).getByText("0")
    ).toBeVisible();
  }
  expect(
    screen.queryByRole("button", { name: i18n.t("dcs.tabs.loadPlan") })
  ).not.toBeInTheDocument();
  expect(requestsFor(fixture, "dcs.createLoadPlan")).toEqual([]);
});

it("submits a crew member once while pending and refreshes the real crew table after success", async () => {
  const response = deferred<{ id: number }>();
  const member = {
    id: 91,
    employeeId: "SYN-9",
    firstName: "Aisha",
    lastName: "Synthetic",
    role: "captain",
    status: "active",
    licenseNumber: null,
  };
  let created = false;
  const fixture = visit({
    "dcs.getCrewMembers": () => (created ? [member] : []),
    "dcs.createCrewMember": () => response.promise,
  });
  await prepareCrew();
  expect(
    screen.getByRole("heading", { name: "Crew Members (0)" })
  ).toBeVisible();
  const save = screen.getByRole("button", { name: i18n.t("dcs.crew.save") });
  fireEvent.click(save);
  await waitFor(() =>
    expect(requestsFor(fixture, "dcs.createCrewMember")).toHaveLength(1)
  );
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(notices.success).not.toHaveBeenCalled();
  created = true;
  await act(async () => response.resolve({ id: 91 }));
  expect(
    await screen.findByRole("cell", { name: "Aisha Synthetic" })
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Crew Members (1)" })
  ).toBeVisible();
  expect(requestsFor(fixture, "dcs.createCrewMember")).toEqual([
    {
      path: "dcs.createCrewMember",
      input: {
        employeeId: "SYN-9",
        firstName: "Aisha",
        lastName: "Synthetic",
        role: "captain",
        airlineId: 3,
        licenseNumber: undefined,
        email: undefined,
        phone: undefined,
      },
    },
  ]);
  expect(notices.success).toHaveBeenCalledOnce();
});

it("preserves a rejected crew form without claiming success or adding a table row", async () => {
  const fixture = visit({
    "dcs.createCrewMember": () => {
      throw Object.assign(new Error("Crew administration permission removed"), {
        code: "FORBIDDEN",
      });
    },
  });
  await prepareCrew();
  enter(i18n.t("dcs.crew.license"), "LIC-9");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("dcs.crew.save") })
  );
  await waitFor(() =>
    expect(notices.error).toHaveBeenCalledWith(
      "Crew administration permission removed"
    )
  );
  expect(field(i18n.t("dcs.crew.firstName"))).toHaveValue("Aisha");
  expect(field(i18n.t("dcs.crew.license"))).toHaveValue("LIC-9");
  expect(screen.getByText(i18n.t("dcs.crew.empty"))).toBeVisible();
  expect(notices.success).not.toHaveBeenCalled();
  expect(requestsFor(fixture, "dcs.createCrewMember")).toHaveLength(1);
});

it("preserves decimal aircraft limits and zero cabin counts and refreshes the aircraft table", async () => {
  let created: Record<string, unknown> | null = null;
  const fixture = visit({
    "dcs.getAircraftTypes": () => (created ? [{ id: 6, ...created }] : []),
    "dcs.createAircraftType": input => {
      created = input as Record<string, unknown>;
      return { id: 6 };
    },
  });
  await prepareAircraft();
  expect(
    screen.getByRole("heading", { name: "Aircraft Types (0)" })
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("dcs.aircraft.save") })
  );
  expect(
    await screen.findByRole("cell", { name: "No business cabin" })
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Aircraft Types (1)" })
  ).toBeVisible();
  expect(screen.getByRole("cell", { name: "10 (10Y / 0C)" })).toBeVisible();
  expect(requestsFor(fixture, "dcs.createAircraftType")[0].input).toMatchObject(
    {
      maxTakeoffWeight: 2000.5,
      maxLandingWeight: 1800.5,
      maxZeroFuelWeight: 1500.5,
      operatingEmptyWeight: 1000.5,
      totalSeats: 10,
      economySeats: 10,
      businessSeats: 0,
    }
  );
});

it("does not submit an incomplete aircraft and disables repeat creation until the server rejects it", async () => {
  const response = deferred<{ id: number }>();
  const fixture = visit({ "dcs.createAircraftType": () => response.promise });
  await prepareAircraft();
  const save = screen.getByRole("button", {
    name: i18n.t("dcs.aircraft.save"),
  });
  enter("MLW (kg)", "");
  expect(save).toBeDisabled();
  fireEvent.click(save);
  expect(requestsFor(fixture, "dcs.createAircraftType")).toEqual([]);
  enter("MLW (kg)", "1800.5");
  fireEvent.click(save);
  await waitFor(() =>
    expect(requestsFor(fixture, "dcs.createAircraftType")).toHaveLength(1)
  );
  expect(save).toBeDisabled();
  fireEvent.click(save);
  await act(async () =>
    response.reject(new Error("Aircraft configuration was changed"))
  );
  await waitFor(() => expect(save).toBeEnabled());
  expect(notices.error).toHaveBeenCalledWith(
    "Aircraft configuration was changed"
  );
  expect(notices.success).not.toHaveBeenCalled();
  expect(field(i18n.t("dcs.aircraft.name"))).toHaveValue("No business cabin");
  expect(requestsFor(fixture, "dcs.createAircraftType")).toHaveLength(1);
});

it.each(["fractional flight", "negative flight", "negative fuel"])(
  "rejects %s before querying or creating a load plan",
  async invalid => {
    const fixture = visit();
    await prepareLoadPlan();
    if (invalid === "negative fuel")
      enter(i18n.t("dcs.loadPlan.fuelWeight"), "-1");
    else
      enter(
        i18n.t("dcs.loadPlan.flightId"),
        invalid === "fractional flight" ? "7.5" : "-7"
      );
    expect(calculateButton()).toBeDisabled();
    fireEvent.click(calculateButton());
    await act(() => new Promise(resolve => setTimeout(resolve, 20)));
    expect(requestsFor(fixture, "dcs.createLoadPlan")).toEqual([]);
    expect(
      requestsFor(fixture, "dcs.getLoadPlan").every(
        request => (request.input as { flightId: number }).flightId === 7
      )
    ).toBe(true);
  }
);

it.each(["0", "100.75"])(
  "sends explicit fuel %s unchanged and displays zero passenger and baggage counts",
  async fuel => {
    const fixture = visit();
    await prepareLoadPlan(fuel);
    fireEvent.click(calculateButton());
    expect(await screen.findByText("Passengers (0)")).toBeVisible();
    expect(screen.getByText("Baggage (0 pcs)")).toBeVisible();
    expect(requestsFor(fixture, "dcs.createLoadPlan")).toEqual([
      {
        path: "dcs.createLoadPlan",
        input: { flightId: 7, aircraftTypeId: 4, fuelWeight: Number(fuel) },
      },
    ]);
  }
);

it.each(["flight", "aircraft", "fuel"])(
  "removes a calculated plan and its approval when the %s changes",
  async changed => {
    const fixture = visit();
    await prepareLoadPlan();
    fireEvent.click(calculateButton());
    await screen.findByText(i18n.t("dcs.loadPlan.withinLimitsMsg"));
    expect(approveButton()).toBeEnabled();
    if (changed === "aircraft") await choose("NEXT - Replacement trainer");
    else
      enter(
        i18n.t(
          `dcs.loadPlan.${changed === "flight" ? "flightId" : "fuelWeight"}`
        ),
        changed === "flight" ? "8" : "200"
      );
    expect(approveButton()).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t("dcs.loadPlan.withinLimitsMsg"))
    ).not.toBeInTheDocument();
    expect(requestsFor(fixture, "dcs.approveLoadPlan")).toEqual([]);
  }
);

it.each(["flight", "aircraft", "fuel"])(
  "ignores a late calculation for changed %s inputs and permits a new current calculation",
  async changed => {
    const response = deferred<ReturnType<typeof calculation>>();
    let attempts = 0;
    const fixture = visit({
      "dcs.createLoadPlan": () =>
        ++attempts === 1 ? response.promise : calculation(82),
    });
    await prepareLoadPlan();
    fireEvent.click(calculateButton());
    await waitFor(() =>
      expect(requestsFor(fixture, "dcs.createLoadPlan")).toHaveLength(1)
    );
    expect(calculateButton()).toBeDisabled();
    if (changed === "aircraft") await choose("NEXT - Replacement trainer");
    else
      enter(
        i18n.t(
          `dcs.loadPlan.${changed === "flight" ? "flightId" : "fuelWeight"}`
        ),
        changed === "flight" ? "8" : "200"
      );
    await act(async () => response.resolve(calculation()));
    await waitFor(() => expect(calculateButton()).toBeEnabled());
    expect(approveButton()).not.toBeInTheDocument();
    expect(notices.success).not.toHaveBeenCalled();
    fireEvent.click(calculateButton());
    await screen.findByText(i18n.t("dcs.loadPlan.withinLimitsMsg"));
    expect(approveButton()).toBeEnabled();
    expect(requestsFor(fixture, "dcs.createLoadPlan")[1].input).toEqual({
      flightId: changed === "flight" ? 8 : 7,
      aircraftTypeId: changed === "aircraft" ? 5 : 4,
      fuelWeight: changed === "fuel" ? 200 : 100.75,
    });
  }
);

it("never offers approval for an over-limit plan and reports a rejected current approval without success", async () => {
  let attempts = 0;
  const response = deferred<{ success: boolean }>();
  const fixture = visit({
    "dcs.createLoadPlan": () =>
      calculation(++attempts === 1 ? 81 : 82, attempts > 1),
    "dcs.approveLoadPlan": () => response.promise,
  });
  await prepareLoadPlan();
  fireEvent.click(calculateButton());
  expect(
    await screen.findByText("Synthetic takeoff limit exceeded")
  ).toBeVisible();
  expect(approveButton()).not.toBeInTheDocument();
  enter(i18n.t("dcs.loadPlan.fuelWeight"), "50");
  fireEvent.click(calculateButton());
  await screen.findByText(i18n.t("dcs.loadPlan.withinLimitsMsg"));
  notices.success.mockClear();
  fireEvent.click(approveButton()!);
  await waitFor(() =>
    expect(requestsFor(fixture, "dcs.approveLoadPlan")).toHaveLength(1)
  );
  expect(approveButton()).toBeDisabled();
  expect(calculateButton()).toBeDisabled();
  await act(async () =>
    response.reject(new Error("Load plan changed before approval"))
  );
  await waitFor(() => expect(approveButton()).toBeEnabled());
  expect(notices.error).toHaveBeenCalledWith(
    "Load plan changed before approval"
  );
  expect(notices.success).not.toHaveBeenCalled();
  expect(requestsFor(fixture, "dcs.approveLoadPlan")).toEqual([
    {
      path: "dcs.approveLoadPlan",
      input: { loadPlanId: 82 },
    },
  ]);
});

it("refreshes the stored plan after approval and does not offer duplicate approval", async () => {
  let approved = false;
  const fixture = visit({
    "dcs.getLoadPlan": () =>
      approved
        ? {
            id: 81,
            flightId: 7,
            aircraftTypeId: 4,
            fuelWeight: 100.75,
            status: "approved",
            takeoffWeight: 1100.75,
            cgPosition: "25",
            withinLimits: true,
          }
        : null,
    "dcs.approveLoadPlan": () => {
      approved = true;
      return { success: true };
    },
  });
  await prepareLoadPlan();
  fireEvent.click(calculateButton());
  await screen.findByText(i18n.t("dcs.loadPlan.withinLimitsMsg"));
  fireEvent.click(approveButton()!);
  expect(await screen.findByText("approved", { selector: "p" })).toBeVisible();
  expect(approveButton()).not.toBeInTheDocument();
  expect(requestsFor(fixture, "dcs.approveLoadPlan")).toHaveLength(1);
  expect(notices.success).toHaveBeenCalledWith(i18n.t("dcs.loadPlan.approved"));
});

it("does not announce a stale calculation failure after changing aircraft", async () => {
  const response = deferred<ReturnType<typeof calculation>>();
  const fixture = visit({ "dcs.createLoadPlan": () => response.promise });
  await prepareLoadPlan();
  fireEvent.click(calculateButton());
  await waitFor(() =>
    expect(requestsFor(fixture, "dcs.createLoadPlan")).toHaveLength(1)
  );
  await choose("NEXT - Replacement trainer");
  await act(async () =>
    response.reject(new Error("Old aircraft calculation failed"))
  );
  await waitFor(() => expect(calculateButton()).toBeEnabled());
  expect(notices.error).not.toHaveBeenCalled();
  expect(approveButton()).not.toBeInTheDocument();
});
