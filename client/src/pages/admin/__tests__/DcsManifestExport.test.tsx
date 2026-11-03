import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DcsDashboard from "@/pages/admin/DcsDashboard";
import { downloadFile } from "@/lib/downloadFile";

vi.mock("sonner", () => ({ toast: {} }));
vi.mock("@/components/ui/select", () => ({}));
vi.mock("@/lib/downloadFile", () => ({ downloadFile: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
  }),
}));
const { query, closeoutQuery, refetch } = vi.hoisted(() => ({
  query: vi.fn(),
  closeoutQuery: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    baggage: { flightCloseout: { useQuery: closeoutQuery } },
    dcs: {
      getStats: { useQuery: () => ({}) },
      getFlightManifest: { useQuery: query },
    },
  },
}));
afterEach(cleanup);

it("exports the selected manifest with UTC times, escaped names and only allowlisted fields", () => {
  const passenger = {
    id: 21,
    name: '=Ali, "نور"',
    pnr: "ABC123",
    type: "adult",
    cabinClass: "economy",
    seat: "12A",
    passportNumber: "SECRET123",
    email: "private@example.test",
  };
  query.mockReturnValue({
    data: {
      manifest: {
        flight: {
          id: 42,
          airline: { code: "ZZ" },
          flightNumber: "ZZ7",
          origin: { code: "JED" },
          destination: { code: "RUH" },
          departureTime: "2026-11-03T12:00:00+03:00",
        },
        generatedAt: "2026-11-03T08:38:55.123Z",
        passengers: { total: 1, list: [passenger] },
        capacity: {},
        crew: { total: 0, cockpit: [], cabin: [] },
        baggage: {},
      },
    },
  });
  closeoutQuery.mockReturnValue({
    refetch,
    data: {
      flightId: 42,
      readyToClose: false,
      expectedBags: 1,
      loadedBags: 0,
      unexpectedBags: 1,
      unresolvedRegistrations: ["0000000002"],
      missingEntry: ["0000000001"],
      missingLoading: [],
      duplicates: [],
    },
  });
  render(<DcsDashboard />);
  fireEvent.click(screen.getByRole("button", { name: "Flight Manifest" }));
  const flightId = screen.getByRole("spinbutton");
  const exportButton = { name: "reports.exportCSV" };
  fireEvent.change(flightId, { target: { value: "42" } });
  expect(query).toHaveBeenLastCalledWith({ flightId: 42 }, { enabled: true });
  expect(closeoutQuery).toHaveBeenLastCalledWith(
    { flightId: 42 },
    { enabled: false, retry: false }
  );
  fireEvent.click(
    screen.getByRole("button", { name: "dcs.manifest.checkBaggage" })
  );
  expect(refetch).toHaveBeenCalledOnce();
  expect(screen.getByText("0000000001")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "dcs.manifest.unresolvedRegistrations"
  );
  expect(screen.getByRole("alert")).toHaveTextContent("0000000002");
  expect(screen.getByText(passenger.name)).toBeInTheDocument();
  expect(screen.getByText(passenger.seat)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", exportButton));
  expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
    "\uFEFFFlight,Origin,Destination,Departure UTC,Manifest generated UTC,Name,PNR,Class,Seat\r\n" +
      'ZZ7,JED,RUH,2026-11-03T09:00:00.000Z,2026-11-03T08:38:55.123Z,"\'=Ali, ""نور""",ABC123,economy,12A',
    "manifest-42.csv",
    "text/csv;charset=utf-8"
  );
  // A cached response for flight 42 must not be exported as flight 43.
  fireEvent.change(flightId, { target: { value: "43" } });
  expect(screen.queryByRole("button", exportButton)).not.toBeInTheDocument();
  expect(screen.queryByText("0000000001")).not.toBeInTheDocument();
  expect(screen.queryByText("0000000002")).not.toBeInTheDocument();
});
