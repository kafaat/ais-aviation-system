import { fireEvent, render, screen } from "@testing-library/react";
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
const airports = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: { reference: { airports: { useQuery: () => airports.state } } },
}));

beforeEach(() => {
  airports.refetch.mockReset();
  airports.state = {};
});

it("says the airport list failed to load, and retries, instead of an empty city list", () => {
  airports.state = {
    data: undefined,
    isError: true,
    error: {
      message: "Synthetic airports outage",
      data: { code: "INTERNAL_SERVER_ERROR" },
    },
    refetch: airports.refetch,
  };
  render(<Home />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Synthetic airports outage"
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(airports.refetch).toHaveBeenCalledOnce();
});

it("reports an access error without offering a pointless retry", () => {
  airports.state = {
    data: undefined,
    isError: true,
    error: { message: "Forbidden", data: { code: "FORBIDDEN" } },
    refetch: airports.refetch,
  };
  render(<Home />);
  expect(screen.getByRole("alert")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Retry" })
  ).not.toBeInTheDocument();
});

it("shows no alert for a loaded airport list, empty or not", () => {
  airports.state = {
    data: [],
    isError: false,
    error: null,
    refetch: airports.refetch,
  };
  render(<Home />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
