/**
 * SearchForm Component Tests
 *
 * Tests for the SearchForm component that handles flight search
 * with origin/destination selection and date picker.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchForm, type Airport } from "../SearchForm";
import React from "react";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "home.search.from": "From",
        "home.search.to": "To",
        "home.search.departureDate": "Departure Date",
        "home.search.selectCity": "Select City",
        "home.search.selectDate": "Select Date",
        "home.search.searchFlights": "Search Flights",
        "home.search.selectOrigin": "Please select origin",
        "home.search.selectDestination": "Please select destination",
        "common.loading": "Loading...",
      };
      return translations[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock date-fns format to return a simple string
vi.mock("date-fns", async () => {
  const actual = await vi.importActual("date-fns");
  return {
    ...actual,
    format: (date: Date) => date.toISOString().split("T")[0],
  };
});

// ============================================================================
// Test Data
// ============================================================================

const mockAirports: Airport[] = [
  { id: 1, code: "RUH", city: "Riyadh", name: "King Khalid International" },
  { id: 2, code: "JED", city: "Jeddah", name: "King Abdulaziz International" },
  { id: 3, code: "DMM", city: "Dammam", name: "King Fahd International" },
];

// ============================================================================
// Tests
// ============================================================================

describe("SearchForm", () => {
  let onOriginChange: ReturnType<typeof vi.fn>;
  let onDestinationChange: ReturnType<typeof vi.fn>;
  let onDateChange: ReturnType<typeof vi.fn>;
  let onSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onOriginChange = vi.fn();
    onDestinationChange = vi.fn();
    onDateChange = vi.fn();
    onSearch = vi.fn();
  });

  const renderSearchForm = (props: Partial<React.ComponentProps<typeof SearchForm>> = {}) => {
    const defaultProps: React.ComponentProps<typeof SearchForm> = {
      airports: mockAirports,
      originId: "",
      destinationId: "",
      departureDate: undefined,
      onOriginChange,
      onDestinationChange,
      onDateChange,
      onSearch,
    };

    return render(<SearchForm {...defaultProps} {...props} />);
  };

  describe("Rendering", () => {
    it("renders the search form", () => {
      renderSearchForm();

      expect(screen.getByTestId("search-form")).toBeInTheDocument();
    });

    it("renders all form fields", () => {
      renderSearchForm();

      expect(screen.getByTestId("origin-field")).toBeInTheDocument();
      expect(screen.getByTestId("destination-field")).toBeInTheDocument();
      expect(screen.getByTestId("date-field")).toBeInTheDocument();
    });

    it("renders the search button", () => {
      renderSearchForm();

      expect(screen.getByTestId("search-button")).toBeInTheDocument();
      expect(screen.getByTestId("search-button")).toHaveTextContent(
        "Search Flights"
      );
    });

    it("renders field labels", () => {
      renderSearchForm();

      expect(screen.getByText("From")).toBeInTheDocument();
      expect(screen.getByText("To")).toBeInTheDocument();
      expect(screen.getByText("Departure Date")).toBeInTheDocument();
    });

    it("renders placeholders when no selections made", () => {
      renderSearchForm();

      expect(screen.getByTestId("date-placeholder")).toHaveTextContent(
        "Select Date"
      );
    });
  });

  describe("Origin Selection", () => {
    it("displays origin select with placeholder", () => {
      renderSearchForm();

      expect(screen.getByTestId("origin-select")).toBeInTheDocument();
    });

    it("displays selected origin", () => {
      renderSearchForm({ originId: "1" });

      const originSelect = screen.getByTestId("origin-select");
      expect(originSelect).toHaveTextContent("Riyadh (RUH)");
    });

    it("origin select is interactive", () => {
      renderSearchForm();

      const originSelect = screen.getByTestId("origin-select");
      expect(originSelect).not.toBeDisabled();
    });
  });

  describe("Destination Selection", () => {
    it("displays destination select with placeholder", () => {
      renderSearchForm();

      expect(screen.getByTestId("destination-select")).toBeInTheDocument();
    });

    it("displays selected destination", () => {
      renderSearchForm({ destinationId: "2" });

      const destinationSelect = screen.getByTestId("destination-select");
      expect(destinationSelect).toHaveTextContent("Jeddah (JED)");
    });

    it("destination select is interactive", () => {
      renderSearchForm();

      const destinationSelect = screen.getByTestId("destination-select");
      expect(destinationSelect).not.toBeDisabled();
    });
  });

  describe("Date Selection", () => {
    it("displays date picker button", () => {
      renderSearchForm();

      expect(screen.getByTestId("date-picker-button")).toBeInTheDocument();
    });

    it("shows placeholder when no date selected", () => {
      renderSearchForm();

      expect(screen.getByTestId("date-placeholder")).toBeInTheDocument();
    });

    it("opens calendar popover when clicked", async () => {
      const user = userEvent.setup();
      renderSearchForm();

      await user.click(screen.getByTestId("date-picker-button"));

      expect(screen.getByTestId("calendar-popover")).toBeInTheDocument();
    });

    it("displays selected date", () => {
      const testDate = new Date("2026-02-15");
      renderSearchForm({ departureDate: testDate });

      expect(screen.getByTestId("selected-date")).toHaveTextContent(
        "2026-02-15"
      );
    });
  });

  describe("Search Button", () => {
    it("is disabled when origin is not selected", () => {
      renderSearchForm({
        originId: "",
        destinationId: "2",
        departureDate: new Date(),
      });

      expect(screen.getByTestId("search-button")).toBeDisabled();
    });

    it("is disabled when destination is not selected", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "",
        departureDate: new Date(),
      });

      expect(screen.getByTestId("search-button")).toBeDisabled();
    });

    it("is disabled when date is not selected", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: undefined,
      });

      expect(screen.getByTestId("search-button")).toBeDisabled();
    });

    it("is enabled when all fields are filled", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: new Date(),
      });

      expect(screen.getByTestId("search-button")).not.toBeDisabled();
    });

    it("calls onSearch when clicked with valid inputs", async () => {
      const user = userEvent.setup();
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: new Date(),
      });

      await user.click(screen.getByTestId("search-button"));

      expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it("does not call onSearch when disabled", async () => {
      const user = userEvent.setup();
      renderSearchForm();

      await user.click(screen.getByTestId("search-button"));

      expect(onSearch).not.toHaveBeenCalled();
    });
  });

  describe("Loading State", () => {
    it("shows loading text when isLoading is true", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: new Date(),
        isLoading: true,
      });

      expect(screen.getByTestId("search-button")).toHaveTextContent(
        "Loading..."
      );
    });

    it("disables search button when loading", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: new Date(),
        isLoading: true,
      });

      expect(screen.getByTestId("search-button")).toBeDisabled();
    });
  });

  describe("Validation Messages", () => {
    it("shows origin validation message", () => {
      renderSearchForm({
        originId: "",
        destinationId: "",
        departureDate: undefined,
      });

      expect(screen.getByTestId("validation-message")).toHaveTextContent(
        "Please select origin"
      );
    });

    it("shows destination validation message when origin selected", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "",
        departureDate: undefined,
      });

      expect(screen.getByTestId("validation-message")).toHaveTextContent(
        "Please select destination"
      );
    });

    it("shows date validation message when origin and destination selected", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: undefined,
      });

      expect(screen.getByTestId("validation-message")).toHaveTextContent(
        "Select Date"
      );
    });

    it("hides validation message when all fields are filled", () => {
      renderSearchForm({
        originId: "1",
        destinationId: "2",
        departureDate: new Date(),
      });

      expect(
        screen.queryByTestId("validation-message")
      ).not.toBeInTheDocument();
    });

    it("hides validation message when loading", () => {
      renderSearchForm({
        originId: "",
        destinationId: "",
        departureDate: undefined,
        isLoading: true,
      });

      expect(
        screen.queryByTestId("validation-message")
      ).not.toBeInTheDocument();
    });
  });

  describe("Airport Options", () => {
    it("handles empty airports array", () => {
      renderSearchForm({ airports: [] });

      expect(screen.getByTestId("origin-select")).toBeInTheDocument();
      expect(screen.getByTestId("destination-select")).toBeInTheDocument();
    });

    it("can display all airports when selected", () => {
      // Test that each airport can be displayed when selected
      renderSearchForm({ originId: "1" });
      expect(screen.getByTestId("origin-select")).toHaveTextContent("Riyadh (RUH)");
    });

    it("can display different airport when selected", () => {
      renderSearchForm({ destinationId: "3" });
      expect(screen.getByTestId("destination-select")).toHaveTextContent("Dammam (DMM)");
    });
  });

  describe("Accessibility", () => {
    it("has aria-labelledby on origin select", () => {
      renderSearchForm();

      expect(screen.getByTestId("origin-select")).toHaveAttribute(
        "aria-labelledby",
        "origin-label"
      );
    });

    it("has aria-labelledby on destination select", () => {
      renderSearchForm();

      expect(screen.getByTestId("destination-select")).toHaveAttribute(
        "aria-labelledby",
        "destination-label"
      );
    });

    it("has aria-labelledby on date picker", () => {
      renderSearchForm();

      expect(screen.getByTestId("date-picker-button")).toHaveAttribute(
        "aria-labelledby",
        "date-label"
      );
    });
  });

  describe("Same Origin and Destination", () => {
    it("allows selecting same airport for origin and destination", () => {
      // Note: In a real app, you might want to prevent this
      renderSearchForm({
        originId: "1",
        destinationId: "1",
        departureDate: new Date(),
      });

      // Button should still be enabled (validation might be handled elsewhere)
      expect(screen.getByTestId("search-button")).not.toBeDisabled();
    });
  });
});
