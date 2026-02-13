/**
 * FlightCard Component Tests
 *
 * Tests for the FlightCard component that displays flight information,
 * including airline details, times, pricing, and user interactions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlightCard, type FlightData } from "../FlightCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      const translations: Record<string, string> = {
        "search.title": "Search Flights",
        "search.economy": "Economy",
        "search.business": "Business",
        "search.bookNow": "Book Now",
        "search.directFlight": "Direct Flight",
        "search.seatsAvailable": `${options?.count ?? 0} seats available`,
        "home.search.to": "to",
        "common.currency": "SAR",
        "common.share": "Share",
        "favorites.addToFavorites": "Add to Favorites",
        "favorites.removeFromFavorites": "Remove from Favorites",
      };
      return translations[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock wouter
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock FlightStatusBadge
vi.mock("@/components/FlightStatusBadge", () => ({
  FlightStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="flight-status-badge">{status}</span>
  ),
}));

// ============================================================================
// Test Data
// ============================================================================

const mockFlight: FlightData = {
  id: 1,
  flightNumber: "SV123",
  airline: {
    id: 1,
    name: "Saudi Airlines",
    code: "SV",
    logo: null,
  },
  origin: {
    id: 1,
    code: "RUH",
    city: "Riyadh",
    name: "King Khalid International Airport",
  },
  destination: {
    id: 2,
    code: "JED",
    city: "Jeddah",
    name: "King Abdulaziz International Airport",
  },
  departureTime: new Date("2026-02-10T10:00:00"),
  arrivalTime: new Date("2026-02-10T12:00:00"),
  economyPrice: 50000, // 500 SAR in cents
  businessPrice: 120000, // 1200 SAR in cents
  economyAvailable: 50,
  businessAvailable: 10,
  status: "scheduled",
};

const mockFlightNoEconomy: FlightData = {
  ...mockFlight,
  economyAvailable: 0,
};

const mockFlightNoBusiness: FlightData = {
  ...mockFlight,
  businessAvailable: 0,
};

// ============================================================================
// Test Wrapper
// ============================================================================

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
};

// ============================================================================
// Tests
// ============================================================================

describe("FlightCard", () => {
  describe("Rendering", () => {
    it("renders the flight card with basic information", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("flight-card")).toBeInTheDocument();
      expect(screen.getByTestId("airline-name")).toHaveTextContent(
        "Saudi Airlines"
      );
      expect(screen.getByTestId("flight-number")).toHaveTextContent("SV123");
    });

    it("displays departure and arrival information", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("departure-time")).toHaveTextContent("10:00");
      expect(screen.getByTestId("arrival-time")).toHaveTextContent("12:00");
      expect(screen.getByTestId("origin-code")).toHaveTextContent("RUH");
      expect(screen.getByTestId("destination-code")).toHaveTextContent("JED");
    });

    it("shows the flight duration", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("flight-duration")).toHaveTextContent("2h 0m");
    });

    it("displays the flight status badge", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("flight-status-badge")).toHaveTextContent(
        "scheduled"
      );
    });

    it("renders airline logo when provided", () => {
      const flightWithLogo = {
        ...mockFlight,
        airline: {
          ...mockFlight.airline,
          logo: "https://example.com/logo.png",
        },
      };

      renderWithProviders(<FlightCard flight={flightWithLogo} />);

      const logo = screen.getByAltText("Saudi Airlines");
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveAttribute("src", "https://example.com/logo.png");
    });

    it("renders default plane icon when no logo is provided", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      // Should not have an img element for the airline logo
      const logo = screen.queryByAltText("Saudi Airlines");
      expect(logo).not.toBeInTheDocument();
    });
  });

  describe("Pricing", () => {
    it("displays economy pricing when available", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("economy-pricing")).toBeInTheDocument();
      expect(screen.getByTestId("economy-price")).toHaveTextContent("500");
      expect(screen.getByTestId("economy-seats")).toHaveTextContent(
        "50 seats available"
      );
    });

    it("displays business pricing when available", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("business-pricing")).toBeInTheDocument();
      expect(screen.getByTestId("business-price")).toHaveTextContent("1,200");
      expect(screen.getByTestId("business-seats")).toHaveTextContent(
        "10 seats available"
      );
    });

    it("does not display economy section when no economy seats available", () => {
      renderWithProviders(<FlightCard flight={mockFlightNoEconomy} />);

      expect(screen.queryByTestId("economy-pricing")).not.toBeInTheDocument();
      expect(screen.getByTestId("business-pricing")).toBeInTheDocument();
    });

    it("does not display business section when no business seats available", () => {
      renderWithProviders(<FlightCard flight={mockFlightNoBusiness} />);

      expect(screen.getByTestId("economy-pricing")).toBeInTheDocument();
      expect(screen.queryByTestId("business-pricing")).not.toBeInTheDocument();
    });

    it("renders correct booking links", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      // The Link component renders as an anchor tag
      const economySection = screen.getByTestId("economy-pricing");
      const businessSection = screen.getByTestId("business-pricing");

      const economyLink = economySection.querySelector("a");
      const businessLink = businessSection.querySelector("a");

      expect(economyLink).toHaveAttribute("href", "/booking/1?class=economy");
      expect(businessLink).toHaveAttribute("href", "/booking/1?class=business");
    });
  });

  describe("Favorite Functionality", () => {
    let onAddToFavorites: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onAddToFavorites = vi.fn();
    });

    it("renders favorite button when handler is provided", () => {
      renderWithProviders(
        <FlightCard flight={mockFlight} onAddToFavorites={onAddToFavorites} />
      );

      expect(screen.getByTestId("favorite-button")).toBeInTheDocument();
    });

    it("does not render favorite button when handler is not provided", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.queryByTestId("favorite-button")).not.toBeInTheDocument();
    });

    it("calls onAddToFavorites when favorite button is clicked", () => {
      renderWithProviders(
        <FlightCard flight={mockFlight} onAddToFavorites={onAddToFavorites} />
      );

      fireEvent.click(screen.getByTestId("favorite-button"));

      expect(onAddToFavorites).toHaveBeenCalledTimes(1);
    });

    it("disables favorite button when already favorited", () => {
      renderWithProviders(
        <FlightCard
          flight={mockFlight}
          onAddToFavorites={onAddToFavorites}
          isFavorited={true}
        />
      );

      expect(screen.getByTestId("favorite-button")).toBeDisabled();
    });

    it("disables favorite button when loading", () => {
      renderWithProviders(
        <FlightCard
          flight={mockFlight}
          onAddToFavorites={onAddToFavorites}
          isFavoriteLoading={true}
        />
      );

      expect(screen.getByTestId("favorite-button")).toBeDisabled();
    });

    it("has correct aria-label when not favorited", () => {
      renderWithProviders(
        <FlightCard
          flight={mockFlight}
          onAddToFavorites={onAddToFavorites}
          isFavorited={false}
        />
      );

      expect(screen.getByTestId("favorite-button")).toHaveAttribute(
        "aria-label",
        "Add to Favorites"
      );
    });

    it("has correct aria-label when favorited", () => {
      renderWithProviders(
        <FlightCard
          flight={mockFlight}
          onAddToFavorites={onAddToFavorites}
          isFavorited={true}
        />
      );

      expect(screen.getByTestId("favorite-button")).toHaveAttribute(
        "aria-label",
        "Remove from Favorites"
      );
    });
  });

  describe("Share Functionality", () => {
    let onShare: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onShare = vi.fn();
    });

    it("renders share button when handler is provided", () => {
      renderWithProviders(<FlightCard flight={mockFlight} onShare={onShare} />);

      expect(screen.getByTestId("share-button")).toBeInTheDocument();
    });

    it("does not render share button when handler is not provided", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.queryByTestId("share-button")).not.toBeInTheDocument();
    });

    it("calls onShare when share button is clicked", () => {
      renderWithProviders(<FlightCard flight={mockFlight} onShare={onShare} />);

      fireEvent.click(screen.getByTestId("share-button"));

      expect(onShare).toHaveBeenCalledTimes(1);
    });
  });

  describe("Live Status", () => {
    it("displays live status when provided", () => {
      renderWithProviders(
        <FlightCard
          flight={mockFlight}
          liveStatus={{ status: "delayed", delayMinutes: 30 }}
          isConnected={true}
        />
      );

      expect(screen.getByTestId("flight-status-badge")).toHaveTextContent(
        "delayed"
      );
    });

    it("falls back to flight status when no live status", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      expect(screen.getByTestId("flight-status-badge")).toHaveTextContent(
        "scheduled"
      );
    });
  });

  describe("Accessibility", () => {
    it("has appropriate ARIA attributes", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      const card = screen.getByTestId("flight-card");
      expect(card).toHaveAttribute("role", "article");
      expect(card).toHaveAttribute("aria-label");
    });

    it("includes flight information in aria-label", () => {
      renderWithProviders(<FlightCard flight={mockFlight} />);

      const card = screen.getByTestId("flight-card");
      const ariaLabel = card.getAttribute("aria-label");

      expect(ariaLabel).toContain("Saudi Airlines");
      expect(ariaLabel).toContain("SV123");
      expect(ariaLabel).toContain("Riyadh");
      expect(ariaLabel).toContain("Jeddah");
    });

    it("share button has aria-label", () => {
      renderWithProviders(<FlightCard flight={mockFlight} onShare={vi.fn()} />);

      expect(screen.getByTestId("share-button")).toHaveAttribute(
        "aria-label",
        "Share"
      );
    });
  });

  describe("Different Flight Scenarios", () => {
    it("handles flight with very long duration", () => {
      const longFlight = {
        ...mockFlight,
        departureTime: new Date("2026-02-10T10:00:00"),
        arrivalTime: new Date("2026-02-10T22:30:00"), // 12h 30m
      };

      renderWithProviders(<FlightCard flight={longFlight} />);

      expect(screen.getByTestId("flight-duration")).toHaveTextContent(
        "12h 30m"
      );
    });

    it("handles flight with very short duration", () => {
      const shortFlight = {
        ...mockFlight,
        departureTime: new Date("2026-02-10T10:00:00"),
        arrivalTime: new Date("2026-02-10T10:45:00"), // 45 minutes
      };

      renderWithProviders(<FlightCard flight={shortFlight} />);

      expect(screen.getByTestId("flight-duration")).toHaveTextContent("0h 45m");
    });

    it("handles flight with low economy availability", () => {
      const lowAvailability = {
        ...mockFlight,
        economyAvailable: 3,
      };

      renderWithProviders(<FlightCard flight={lowAvailability} />);

      expect(screen.getByTestId("economy-seats")).toHaveTextContent(
        "3 seats available"
      );
    });

    it("handles cancelled flight status", () => {
      const cancelledFlight = {
        ...mockFlight,
        status: "cancelled" as const,
      };

      renderWithProviders(<FlightCard flight={cancelledFlight} />);

      expect(screen.getByTestId("flight-status-badge")).toHaveTextContent(
        "cancelled"
      );
    });

    it("handles delayed flight status", () => {
      const delayedFlight = {
        ...mockFlight,
        status: "delayed" as const,
      };

      renderWithProviders(<FlightCard flight={delayedFlight} />);

      expect(screen.getByTestId("flight-status-badge")).toHaveTextContent(
        "delayed"
      );
    });
  });
});
