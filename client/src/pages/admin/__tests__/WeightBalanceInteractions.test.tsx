import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import WeightBalance from "../WeightBalance";
import i18n from "@/i18n/config";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

// Synthetic responses exercise presentation and command binding, not aircraft
// calculations, measured loading or operational dispatch acceptance.
const calculation = () => ({
  id: 8,
  flightId: 7,
  aircraftTypeId: 4,
  operatingEmptyWeight: 1000,
  passengerWeight: 80,
  baggageWeight: 20,
  cargoWeight: 25.5,
  fuelWeight: 100.75,
  totalWeight: 1226.25,
  maxTakeoffWeight: 2000,
  cgPosition: 25,
  cgForwardLimit: 15,
  cgAftLimit: 35,
  isWithinLimits: true,
  trimSetting: 4,
  status: "preliminary",
  calculatedBy: 1,
  calculatedAt: new Date("2030-01-01T12:00:00Z"),
  details: {
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
      passengers: {
        count: 1,
        weight: 80,
        breakdown: {
          males: { count: 1, weight: 80 },
          females: { count: 0, weight: 0 },
          children: { count: 0, weight: 0 },
          infants: { count: 0, weight: 0 },
        },
      },
      baggage: {
        checkedCount: 1,
        checkedWeight: 20,
        carryOnCount: 0,
        totalWeight: 20,
      },
      cargo: { zones: [{ zone: "FWD", weight: 25.5 }], totalWeight: 25.5 },
      fuel: {
        totalFuelWeight: 100.75,
        fuelDensity: 0.8,
        breakdown: {
          taxiFuel: 2,
          tripFuel: 80.75,
          contingency: 5,
          alternateFuel: 8,
          finalReserve: 4,
          extraFuel: 1,
        },
      },
      zeroFuel: 1125.5,
      takeoff: 1226.25,
      landing: 1145.5,
    },
    balance: { cgPosition: 25, forwardLimit: 15, aftLimit: 35, trimSetting: 4 },
    isWithinLimits: true,
  },
});
type Handlers = Parameters<typeof createTrpcFixture>[0];
function visit(overrides: Handlers = {}) {
  const fixture = createTrpcFixture({
    "dcs.getAircraftTypes": () => [
      { id: 4, code: "TEST", name: "Synthetic trainer" },
    ],
    "weightBalance.calculate": () => calculation(),
    ...overrides,
  });
  render(
    <fixture.Wrapper>
      <WeightBalance />
    </fixture.Wrapper>
  );
  return fixture;
}
const flightInput = () =>
  screen.getByPlaceholderText(i18n.t("wb.calc.enterFlightId"));
const fuelInput = () => screen.getByPlaceholderText("e.g. 15000");
const calculateButton = () =>
  screen.getAllByRole("button", { name: i18n.t("wb.calc.calculateBtn") })[1];
async function prepare(fuel = "100.75") {
  fireEvent.change(flightInput(), { target: { value: "7" } });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("option", { name: "TEST - Synthetic trainer" })
  );
  fireEvent.change(fuelInput(), { target: { value: fuel } });
}
function addZone(zone: string, weight: string) {
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("wb.calc.addZone") })
  );
  fireEvent.change(
    screen.getAllByPlaceholderText(i18n.t("wb.calc.zoneName")).at(-1)!,
    { target: { value: zone } }
  );
  fireEvent.change(
    screen.getAllByPlaceholderText(i18n.t("wb.calc.zoneWeight")).at(-1)!,
    { target: { value: weight } }
  );
}

it("sends entered decimal weights without truncating them and renders the returned training result", async () => {
  const { requests } = visit();
  expect(calculateButton()).toBeDisabled();
  expect(screen.getByText(i18n.t("dcs.loadTrainingNotice"))).toBeVisible();
  await prepare();
  addZone("FWD", "25.5");
  fireEvent.click(calculateButton());
  expect(
    await screen.findByText(i18n.t("wb.result.withinLimits"))
  ).toBeVisible();
  expect(
    requests.filter(request => request.path === "weightBalance.calculate")
  ).toEqual([
    {
      path: "weightBalance.calculate",
      input: {
        flightId: 7,
        aircraftTypeId: 4,
        fuelWeight: 100.75,
        cargoDistribution: [{ zone: "FWD", weight: 25.5 }],
      },
    },
  ]);
  expect(
    screen.getByRole("heading", { name: i18n.t("wb.result.cgEnvelope") })
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: i18n.t("wb.result.fuelBreakdown") })
  ).toBeVisible();
});

it.each([
  "fractional flight",
  "negative fuel",
  "missing zone",
  "negative cargo",
  "missing weight",
])("does not send a calculation with %s input", async invalid => {
  const { requests } = visit();
  await prepare();
  if (invalid === "fractional flight")
    fireEvent.change(flightInput(), { target: { value: "7.5" } });
  else if (invalid === "negative fuel")
    fireEvent.change(fuelInput(), { target: { value: "-1" } });
  else if (invalid === "missing zone") addZone("", "25");
  else if (invalid === "negative cargo") addZone("FWD", "-10");
  else addZone("FWD", "");
  expect(calculateButton()).toBeDisabled();
  fireEvent.click(calculateButton());
  expect(
    requests.some(request => request.path === "weightBalance.calculate")
  ).toBe(false);
});

it("removes an incomplete cargo row and permits an explicit zero fuel weight", async () => {
  const { requests } = visit();
  await prepare("0");
  addZone("FWD", "0");
  addZone("", "");
  expect(calculateButton()).toBeDisabled();
  const removeButtons = screen.getAllByRole("button", { name: "" });
  fireEvent.click(removeButtons[removeButtons.length - 1]);
  expect(calculateButton()).toBeEnabled();
  fireEvent.click(calculateButton());
  await screen.findByText(i18n.t("wb.result.withinLimits"));
  expect(requests.at(-1)?.input).toEqual({
    flightId: 7,
    aircraftTypeId: 4,
    fuelWeight: 0,
    cargoDistribution: [{ zone: "FWD", weight: 0 }],
  });
});

it.each(["flight", "fuel", "cargo"])(
  "hides the previous result when the %s input changes",
  async field => {
    const { requests } = visit();
    await prepare();
    fireEvent.click(calculateButton());
    await screen.findByText(i18n.t("wb.result.withinLimits"));
    if (field === "flight")
      fireEvent.change(flightInput(), { target: { value: "8" } });
    else if (field === "fuel")
      fireEvent.change(fuelInput(), { target: { value: "120" } });
    else addZone("AFT", "50");
    expect(
      screen.queryByText(i18n.t("wb.result.withinLimits"))
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: i18n.t("wb.result.weightBreakdown"),
      })
    ).not.toBeInTheDocument();
    expect(
      requests.filter(request => request.path === "weightBalance.calculate")
    ).toHaveLength(1);
  }
);

it("does not show a late result for an edited flight or announce it as the current calculation", async () => {
  const response = deferred<ReturnType<typeof calculation>>();
  const { requests } = visit({
    "weightBalance.calculate": () => response.promise,
  });
  await prepare();
  fireEvent.click(calculateButton());
  await waitFor(() =>
    expect(
      requests.some(request => request.path === "weightBalance.calculate")
    ).toBe(true)
  );
  fireEvent.change(flightInput(), { target: { value: "8" } });
  await act(async () => response.resolve(calculation()));
  await waitFor(() => expect(calculateButton()).toBeEnabled());
  expect(
    screen.queryByText(i18n.t("wb.result.withinLimits"))
  ).not.toBeInTheDocument();
  expect(notices.success).not.toHaveBeenCalled();
});

it("reports the server capability refusal without displaying a calculated result", async () => {
  visit({
    "weightBalance.calculate": () => {
      throw Object.assign(
        new Error(
          "Weight and balance simulation has no verified production adapter configured"
        ),
        { code: "PRECONDITION_FAILED" }
      );
    },
  });
  await prepare();
  fireEvent.click(calculateButton());
  await waitFor(() =>
    expect(notices.error).toHaveBeenCalledWith(
      expect.stringContaining("no verified production adapter")
    )
  );
  expect(notices.success).not.toHaveBeenCalled();
  expect(
    screen.queryByText(i18n.t("wb.result.withinLimits"))
  ).not.toBeInTheDocument();
  expect(screen.getByText(i18n.t("dcs.loadTrainingNotice"))).toBeVisible();
});

it.each(["resolved", "rejected"])(
  "ignores a pending calculation for a changed aircraft when it is %s",
  async outcome => {
    const response = deferred<ReturnType<typeof calculation>>();
    const { requests } = visit({
      "dcs.getAircraftTypes": () => [
        { id: 4, code: "TEST", name: "Synthetic trainer" },
        { id: 5, code: "NEXT", name: "Replacement trainer" },
      ],
      "weightBalance.calculate": () => response.promise,
    });
    await prepare();
    fireEvent.click(calculateButton());
    await waitFor(() =>
      expect(
        requests.filter(r => r.path === "weightBalance.calculate")
      ).toHaveLength(1)
    );
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("option", { name: "NEXT - Replacement trainer" })
    );
    await act(async () => {
      if (outcome === "resolved") response.resolve(calculation());
      else response.reject(new Error("Previous aircraft was removed"));
    });
    await waitFor(() => expect(calculateButton()).toBeEnabled());
    expect(
      screen.queryByText(i18n.t("wb.result.withinLimits"))
    ).not.toBeInTheDocument();
    expect(notices.success).not.toHaveBeenCalled();
    expect(notices.error).not.toHaveBeenCalled();
  }
);

it("checks limits only on request and shows failed margins, warnings and errors from that response", async () => {
  const { requests } = visit({
    "weightBalance.checkLimits": () => ({
      isWithinAllLimits: false,
      checks: [
        {
          name: "Fixture takeoff limit",
          actual: 2100,
          limit: 2000,
          unit: "kg",
          passed: false,
          margin: -100,
        },
      ],
      warnings: ["Fixture warning: revised fuel required"],
      errors: ["Fixture error: takeoff limit exceeded"],
    }),
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("wb.tabs.limits") })
  );
  fireEvent.change(flightInput(), { target: { value: "7" } });
  expect(
    requests.some(request => request.path === "weightBalance.checkLimits")
  ).toBe(false);
  fireEvent.click(
    screen.getAllByRole("button", { name: i18n.t("wb.limits.checkBtn") })[1]
  );
  expect(await screen.findByText(i18n.t("wb.limits.failed"))).toBeVisible();
  expect(screen.getByText("-100 kg")).toBeVisible();
  expect(
    screen.getByText("Fixture warning: revised fuel required")
  ).toBeVisible();
  expect(
    screen.getByText("Fixture error: takeoff limit exceeded")
  ).toBeVisible();
  expect(
    requests.filter(request => request.path === "weightBalance.checkLimits")
  ).toEqual([{ path: "weightBalance.checkLimits", input: { flightId: 7 } }]);
});

it("expands and closes a history record without turning it into a new calculation", async () => {
  const { requests } = visit({
    "weightBalance.getHistory": () => [
      {
        id: 8,
        status: "preliminary",
        passengerCount: 1,
        passengerWeight: 80,
        baggageWeight: 20,
        cargoWeight: 25.5,
        fuelWeight: 100.75,
        zeroFuelWeight: 1125.5,
        takeoffWeight: 1226.25,
        landingWeight: 1145.5,
        cgPosition: "25.00",
        withinLimits: false,
        warnings: ["Historical training warning"],
        createdAt: "2030-01-01T12:00:00Z",
      },
    ],
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("wb.tabs.history") })
  );
  fireEvent.change(flightInput(), { target: { value: "7" } });
  const record = await screen.findByRole("button", {
    name: /TOW: 1,226.25 kg/,
  });
  expect(
    screen.queryByText("Historical training warning")
  ).not.toBeInTheDocument();
  fireEvent.click(record);
  expect(screen.getByText("Historical training warning")).toBeVisible();
  expect(screen.getByText("1 (80 kg)")).toBeVisible();
  fireEvent.click(record);
  expect(
    screen.queryByText("Historical training warning")
  ).not.toBeInTheDocument();
  expect(
    requests.some(request => request.path === "weightBalance.calculate")
  ).toBe(false);
});

const generatedSheet = () => ({
  loadSheetNumber: "SIMULATED-SHEET-7",
  edition: "PRELIMINARY",
  generatedAt: "2030-01-01T12:00:00Z",
  flight: {
    id: 7,
    flightNumber: "TEST7",
    date: "2030-01-15",
    origin: "RUH",
    destination: "JED",
    aircraftType: "TEST",
    registration: "SYNTHETIC",
  },
  crew: { cockpit: 2, cabin: 2, total: 4 },
  passengers: {
    males: 1,
    females: 0,
    children: 0,
    infants: 0,
    totalExcludingInfants: 1,
    total: 1,
  },
  weights: {
    operatingEmptyWeight: 1000,
    passengerWeight: 80,
    baggageWeight: 20,
    cargoMailWeight: 25.5,
    totalTrafficLoad: 125.5,
    dryOperatingWeight: 1000,
    zeroFuelWeightActual: 1125.5,
    zeroFuelWeightMax: 1500,
    takeoffFuel: 100.75,
    takeoffWeightActual: 1226.25,
    takeoffWeightMax: 2000,
    tripFuel: 80.75,
    landingWeightActual: 1145.5,
    landingWeightMax: 1800,
  },
  balance: {
    cgPercent: 25,
    cgForwardLimit: 15,
    cgAftLimit: 35,
    trimSetting: 4,
    stabilizerSetting: 4,
  },
  cargoByZone: [],
  limitations: { isWithinAllLimits: true, items: [] },
  remarks: ["Synthetic training response; no dispatch acceptance."],
});

it.each(["during", "after"])(
  "hides a generated sheet for another flight when its identifier changes %s generation",
  async timing => {
    const response = deferred<ReturnType<typeof generatedSheet>>();
    const { requests } = visit({
      "weightBalance.generateLoadSheet": () => response.promise,
    });
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("wb.tabs.loadsheet") })
    );
    fireEvent.change(flightInput(), { target: { value: "7" } });
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("wb.loadsheet.generateBtn") })
    );
    await waitFor(() =>
      expect(requests).toContainEqual({
        path: "weightBalance.generateLoadSheet",
        input: { flightId: 7 },
      })
    );
    if (timing === "after") {
      await act(async () => response.resolve(generatedSheet()));
      expect(await screen.findByText(/SIMULATED-SHEET-7/)).toBeVisible();
      expect(notices.success).toHaveBeenCalledWith(
        i18n.t("wb.loadsheet.generated")
      );
      notices.success.mockClear();
    }
    fireEvent.change(flightInput(), { target: { value: "8" } });
    if (timing === "during") {
      await act(async () => response.resolve(generatedSheet()));
      await waitFor(() =>
        expect(
          screen.getByRole("button", {
            name: i18n.t("wb.loadsheet.generateBtn"),
          })
        ).toBeEnabled()
      );
    }
    expect(screen.queryByText(/SIMULATED-SHEET-7/)).not.toBeInTheDocument();
    expect(notices.success).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t("dcs.loadTrainingNotice"))).toBeVisible();
    expect(
      requests.filter(
        request => request.path === "weightBalance.generateLoadSheet"
      )
    ).toHaveLength(1);
  }
);
