import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FlightWeatherAdvisory } from "../FlightWeatherAdvisory";
const { query, map, refresh } = vi.hoisted(() => ({
  query: vi.fn(),
  map: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    weather: {
      flightAdvisory: { useQuery: query },
      mapStation: { useMutation: () => ({ mutate: map }) },
      refresh: { useMutation: () => ({ mutate: refresh }) },
    },
  },
}));
vi.mock("../OperationalReadState", () => ({
  useOperationalLabels: () => (_ar: string, en: string) => en,
}));
const input = () => screen.getByLabelText("Weather flight ID");
function selectFlight() {
  render(<FlightWeatherAdvisory />);
  expect(query).not.toHaveBeenCalled();
  fireEvent.change(input(), { target: { value: "17" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Show flight bulletins" })
  );
  expect(query).toHaveBeenCalledWith(
    { flightId: 17 },
    { retry: false, refetchInterval: 60000 }
  );
}
beforeEach(() => {
  query.mockReturnValue({
    data: {
      evaluatedAt: "2026-11-03T12:00:00Z",
      fields: [
        {
          role: "origin",
          airportId: 4,
          airportCode: "ADE",
          icaoCode: null,
          coverage: "station_unmapped",
          concerns: [],
        },
        {
          role: "destination",
          airportId: 6,
          airportCode: "RUH",
          icaoCode: "OERK",
          coverage: "stale_observation",
          rawText: "Stored bulletin",
          issuedAt: "2026-11-02T04:00:00Z",
          concerns: [],
          flightCategory: null,
        },
      ],
    },
  });
});
it("shows missing mapping and stale source distinctly, and pulls only on explicit action", () => {
  selectFlight();
  expect(screen.getByText("Station not mapped")).toBeVisible();
  expect(screen.getByText("Bulletin outside freshness window")).toBeVisible();
  expect(screen.queryByText("VFR")).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Fetch METAR from configured source" })
  );
  expect(refresh).toHaveBeenCalledWith({ airportIds: [6], kind: "metar" });
  fireEvent.change(input(), { target: { value: "21" } });
  expect(screen.queryByText("Stored bulletin")).toBeNull();
});
it("binds station mapping to the returned airport and requires evidence", () => {
  selectFlight();
  const save = screen.getByRole("button", {
    name: "Save airport station mapping",
  });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("ICAO station"), {
    target: { value: "oyaa" },
  });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Station verification reference"), {
    target: { value: "AIP fixture" },
  });
  fireEvent.click(save);
  expect(map).toHaveBeenCalledWith({
    airportId: 4,
    icaoCode: "OYAA",
    mappingEvidence: "AIP fixture",
  });
});
it("shows a read error instead of an empty advisory", () => {
  const refetch = vi.fn();
  query.mockReturnValue({
    isError: true,
    error: { message: "Weather store unavailable" },
    refetch,
  });
  selectFlight();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Weather store unavailable"
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalledOnce();
});
