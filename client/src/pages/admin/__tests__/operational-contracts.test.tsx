import React from "react";
import { beforeEach, afterEach, vi, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BiometricBoarding from "@/pages/admin/BiometricBoarding";
import KioskManagement from "@/pages/admin/KioskManagement";
import BagDropManagement from "@/pages/admin/BagDropManagement";
import { responseContracts as biometric } from "../../../../../server/contracts/biometric";
import { responseContracts as kiosk } from "../../../../../server/contracts/kiosk";
import { responseContracts as bagDrop } from "../../../../../server/contracts/bag-drop";
const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  error: false,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get(_t, domain) {
        return new Proxy(
          {},
          {
            get(_t, procedure) {
              return {
                useQuery: (_input: unknown, opts?: { enabled?: boolean }) => ({
                  data:
                    opts?.enabled === false
                      ? undefined
                      : state.data[`${String(domain)}.${String(procedure)}`],
                  isLoading: false,
                  isError: state.error,
                  error: state.error ? new Error("Source unavailable") : null,
                  refetch: vi.fn(),
                }),
                useMutation: () => ({ mutate: vi.fn(), isPending: false }),
              };
            },
          }
        );
      },
    }
  ),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" }, loading: false }),
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en" },
  }),
}));
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <output data-testid="render-error">{this.state.error}</output>
    ) : (
      this.props.children
    );
  }
}
beforeEach(() => {
  state.data = {};
  state.error = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function show(page: React.ReactNode) {
  return render(<Boundary>{page}</Boundary>);
}
function tab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), {
    button: 0,
    ctrlKey: false,
  });
}

it.each([false, true])(
  "F14 biometric envelope renders (populated=%s)",
  populated => {
    const now = new Date();
    state.data["biometric.getEvents"] = biometric.getEvents.parse({
      events: populated
        ? [
            {
              id: 1,
              passengerId: 7,
              flightId: 1,
              gateId: null,
              eventType: "verification_failure",
              biometricType: "face",
              confidence: null,
              processingTimeMs: null,
              deviceId: null,
              errorCode: "synthetic",
              createdAt: now,
            },
          ]
        : [],
      total: populated ? 1 : 0,
    });
    show(<BiometricBoarding />);
    tab(/Events Log/);
    expect(screen.queryByTestId("render-error")).toBeNull();
    expect(
      screen.getByText(
        populated ? "verification_failure" : "No recorded events"
      )
    ).toBeTruthy();
  }
);
it("F13 provider failure cannot display invented biometric readiness", () => {
  state.error = true;
  show(<BiometricBoarding />);
  tab(/Events Log/);
  expect(screen.getByRole("alert").textContent).toContain("Source unavailable");
  expect(screen.queryByText("12,847")).toBeNull();
  expect(screen.queryByText("NEC NeoFace")).toBeNull();
});
it("F14 kiosk analytics consumes the actual totals envelope", () => {
  const now = new Date();
  state.data["kiosk.getDevices"] = kiosk.getDevices.parse([]);
  state.data["kiosk.getAnalytics"] = kiosk.getAnalytics.parse({
    airportId: 1,
    dateRange: { from: now, to: now },
    kiosks: [],
    totals: {
      totalSessions: 37,
      completedSessions: 29,
      abandonedSessions: 3,
      errorSessions: 5,
      avgCompletionRate: 0,
      boardingPassesPrinted: 19,
      bagTagsPrinted: 0,
    },
  });
  show(<KioskManagement />);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
  tab(/Analytics/);
  expect(screen.queryByTestId("render-error")).toBeNull();
  expect(screen.getByText("37")).toBeTruthy();
  expect(screen.getByText("29")).toBeTruthy();
});
it.each([false, true])(
  "F14 bag-drop units render (populated=%s)",
  populated => {
    const now = new Date();
    state.data["bagDrop.getUnits"] = bagDrop.getUnits.parse({
      units: populated
        ? [
            {
              id: 1,
              unitCode: "SYNTHETIC-1",
              airportId: 1,
              terminal: "T1",
              zone: "Z1",
              status: "online",
              hasPrinter: true,
              hasScale: true,
              hasPayment: false,
              beltConnected: false,
              lastMaintenance: null,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [],
    });
    show(<BagDropManagement />);
    expect(screen.queryByTestId("render-error")).toBeNull();
    expect(
      screen.getByText(populated ? "SYNTHETIC-1" : "No registered units")
    ).toBeTruthy();
  }
);
it("F14 bag-drop analytics maps actual counters and units", () => {
  const now = new Date();
  state.data["bagDrop.getUnits"] = bagDrop.getUnits.parse({ units: [] });
  state.data["bagDrop.getAnalytics"] = bagDrop.getAnalytics.parse({
    airportId: 1,
    period: { start: now, end: now },
    totalSessions: 23,
    completedSessions: 17,
    errorSessions: 4,
    timeoutSessions: 2,
    averageSessionDurationMs: 51000,
    totalBagsProcessed: 31,
    totalWeightGrams: 32000,
    totalExcessFeeCents: 4300,
    units: [],
  });
  show(<BagDropManagement />);
  fireEvent.change(screen.getByRole("spinbutton", { name: /Airport ID/ }), {
    target: { value: "1" },
  });
  tab(/Analytics/);
  expect(screen.queryByTestId("render-error")).toBeNull();
  for (const value of ["23", "17", "51", "32", "43"])
    expect(screen.getByText(value)).toBeTruthy();
});
it.each([KioskManagement, BagDropManagement])(
  "F13 unavailable devices expose failure and retry",
  Page => {
    state.error = true;
    show(<Page />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Source unavailable"
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  }
);

it("hands unassigned bookings and considered flights to recovery review", async () => {
  const { ReaccommodationAdvisory } =
    await import("@/components/ReaccommodationAdvisory");
  const { reaccommodationAdvisory } =
    await import("../../../../../server/contracts/passenger-priority");
  state.data["passengerPriority.reaccommodationAdvisory"] =
    reaccommodationAdvisory.parse({
      plan: {
        disruptedFlightId: 1,
        objectiveValue: 100,
        advisory: true,
        assignments: [
          {
            passengerId: 9,
            bookingId: 7,
            flightId: null,
            flightNumber: null,
            cabin: null,
            delayMinutes: null,
            downgraded: false,
            cost: 100,
            reason: "No capacity",
          },
        ],
        unassigned: [9],
        objective: {
          order: "max-assigned-then-min-cost",
          weightAtZeroPriority: 1,
          weightPerPriorityPoint: 0.01,
          downgradeMinutes: 60,
          unassignedMinutes: 100,
        },
      },
      candidateFlightIds: [2, 3],
      consideredOptions: 2,
      consideredPassengers: 1,
      optionsTruncated: false,
      window: {
        fromISO: "2035-01-01T00:00:00Z",
        toISO: "2035-01-02T00:00:00Z",
      },
    });
  show(<ReaccommodationAdvisory />);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: /Compute assignment/i }));
  expect(
    screen
      .getByRole("link", { name: /Review recovery plan/i })
      .getAttribute("href")
  ).toBe("/admin/operations?bookingIds=7&candidateIds=2,3");
});
