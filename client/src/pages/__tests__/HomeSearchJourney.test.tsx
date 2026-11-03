import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import Home from "../Home";

const calls = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: "origin=1&destination=2&date=2027-01-15",
  historyDate: "2027-01-15",
}));
vi.mock("wouter", async original => ({
  ...(await original<typeof import("wouter")>()),
  useLocation: () => ["/", calls.navigate],
  useSearch: () => calls.search,
}));
vi.mock("@/lib/useRawSearch", () => ({ useRawSearch: () => calls.search }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ reducedMotion: true }),
}));
vi.mock("@/components/BrandIdentity", () => ({
  BrandIdentity: () => <span>AIS</span>,
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}));
vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/SmartSuggestions", () => ({
  SmartSuggestions: () => null,
}));
vi.mock("@/components/SearchHistory", () => ({
  SearchHistory: ({
    onSelect,
  }: {
    onSelect: (search: {
      originCode: string;
      destinationCode: string;
      departureDate: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          originCode: "RUH",
          destinationCode: "JED",
          departureDate: calls.historyDate,
        })
      }
    >
      Replay saved search
    </button>
  ),
}));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => (
    <input
      aria-label="Calendar day"
      type="date"
      onChange={event => onSelect(new Date(event.target.value + "T00:00:00"))}
    />
  ),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    reference: {
      airports: {
        useQuery: () => ({
          data: [
            { id: 1, code: "RUH", city: "Riyadh" },
            { id: 2, code: "JED", city: "Jeddah" },
          ],
        }),
      },
    },
  },
}));

beforeEach(() => {
  calls.navigate.mockReset();
  calls.search = "origin=1&destination=2&date=2027-01-15";
  calls.historyDate = "2027-01-15";
});
it.each(["2027-01-15", "2027-01-15T12:00:00.000Z"])(
  "replays the saved day %s through the home form without a UTC shift",
  historyDate => {
    calls.historyDate = historyDate;
    render(<Home />);
    fireEvent.click(
      screen.getByRole("button", { name: "Replay saved search" })
    );
    fireEvent.click(screen.getByTestId("home-search-button"));
    const url = new URL(calls.navigate.mock.calls[0][0], "https://ais.test");
    expect(url.searchParams.get("date")).toBe("2027-01-15");
  }
);
it("carries party types and display preferences from the actual home form into search", () => {
  render(<Home />);
  fireEvent.change(screen.getByLabelText("ibe.adults"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("ibe.children"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("ibe.displayCurrency"), {
    target: { value: "KWD" },
  });
  fireEvent.change(screen.getByLabelText("ibe.country"), {
    target: { value: "KW" },
  });
  fireEvent.click(screen.getByTestId("home-search-button"));
  const url = new URL(calls.navigate.mock.calls[0][0], "https://ais.test");
  expect(url.pathname).toBe("/search");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    origin: "1",
    destination: "2",
    date: "2027-01-15",
    adults: "2",
    children: "1",
    currency: "KWD",
    country: "KW",
  });
});
it("turns a return search into two reciprocal sectors and blocks an earlier return", async () => {
  const user = userEvent.setup();
  render(<Home />);
  await user.click(screen.getByRole("tab", { name: "ibe.roundTrip" }));
  expect(screen.getByTestId("home-search-button")).toBeDisabled();
  await user.click(screen.getByTestId("home-return-date-trigger"));
  fireEvent.change(screen.getByLabelText("Calendar day"), {
    target: { value: "2027-01-14" },
  });
  expect(screen.getByTestId("home-search-button")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Calendar day"), {
    target: { value: "2027-01-20" },
  });
  fireEvent.click(screen.getByTestId("home-search-button"));
  const url = new URL(calls.navigate.mock.calls[0][0], "https://ais.test");
  expect(url.pathname).toBe("/multi-city");
  expect(JSON.parse(url.searchParams.get("segments")!)).toEqual([
    { originId: "1", destinationId: "2", departureDate: "2027-01-15" },
    { originId: "2", destinationId: "1", departureDate: "2027-01-20" },
  ]);
});
it("does not search with a party larger than the booking contract supports", () => {
  render(<Home />);
  fireEvent.change(screen.getByLabelText("ibe.adults"), {
    target: { value: "9" },
  });
  fireEvent.change(screen.getByLabelText("ibe.children"), {
    target: { value: "1" },
  });
  expect(screen.getByTestId("home-search-button")).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("ibe.passengerLimit");
});
