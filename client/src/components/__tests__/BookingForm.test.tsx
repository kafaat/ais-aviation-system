/**
 * BookingForm Component Tests
 *
 * Tests for the BookingForm component that handles passenger
 * information collection with validation and multiple passengers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingForm, type Passenger } from "../BookingForm";
import React from "react";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "booking.passengerInfo": "Passenger Information",
        "booking.addPassenger": "Add Passenger",
        "booking.passenger": "Passenger",
        "booking.passengerType": "Passenger Type",
        "booking.title": "Title",
        "booking.firstName": "First Name",
        "booking.lastName": "Last Name",
        "booking.passportNumber": "Passport Number",
        "booking.nationality": "Nationality",
        "booking.adult": "Adult",
        "booking.child": "Child",
        "booking.infant": "Infant",
        "booking.mr": "Mr",
        "booking.mrs": "Mrs",
        "booking.ms": "Ms",
        "common.search": "Select",
      };
      return translations[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

// ============================================================================
// Test Data
// ============================================================================

const createEmptyPassenger = (): Passenger => ({
  type: "adult",
  firstName: "",
  lastName: "",
});

const createFilledPassenger = (index: number): Passenger => ({
  type: "adult",
  title: "Mr",
  firstName: `John${index}`,
  lastName: `Doe${index}`,
  passportNumber: `A1234567${index}`,
  nationality: "SA",
});

// ============================================================================
// Tests
// ============================================================================

describe("BookingForm", () => {
  let onPassengerChange: ReturnType<typeof vi.fn>;
  let onAddPassenger: ReturnType<typeof vi.fn>;
  let onRemovePassenger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onPassengerChange = vi.fn();
    onAddPassenger = vi.fn();
    onRemovePassenger = vi.fn();
  });

  describe("Rendering", () => {
    it("renders the form with title", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("booking-form")).toBeInTheDocument();
      expect(screen.getByTestId("form-title")).toHaveTextContent(
        "Passenger Information"
      );
    });

    it("renders the add passenger button", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("add-passenger-button")).toBeInTheDocument();
      expect(screen.getByTestId("add-passenger-button")).toHaveTextContent(
        "Add Passenger"
      );
    });

    it("renders all passenger forms", () => {
      const passengers = [createEmptyPassenger(), createEmptyPassenger()];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-form-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-form-1")).toBeInTheDocument();
    });

    it("renders passenger headers with correct numbering", () => {
      const passengers = [createEmptyPassenger(), createEmptyPassenger()];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-header-0")).toHaveTextContent(
        "Passenger 1"
      );
      expect(screen.getByTestId("passenger-header-1")).toHaveTextContent(
        "Passenger 2"
      );
    });

    it("renders all input fields for a passenger", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-type-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-title-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-firstname-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-lastname-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-passport-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-nationality-0")).toBeInTheDocument();
    });
  });

  describe("Input Handling", () => {
    it("calls onPassengerChange when first name is changed", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      const firstNameInput = screen.getByTestId("passenger-firstname-0");
      fireEvent.change(firstNameInput, { target: { value: "John" } });

      expect(onPassengerChange).toHaveBeenCalledWith(0, "firstName", "John");
    });

    it("calls onPassengerChange when last name is changed", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      const lastNameInput = screen.getByTestId("passenger-lastname-0");
      fireEvent.change(lastNameInput, { target: { value: "Doe" } });

      expect(onPassengerChange).toHaveBeenCalledWith(0, "lastName", "Doe");
    });

    it("calls onPassengerChange when passport number is changed", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      const passportInput = screen.getByTestId("passenger-passport-0");
      fireEvent.change(passportInput, { target: { value: "A123" } });

      expect(onPassengerChange).toHaveBeenCalledWith(
        0,
        "passportNumber",
        "A123"
      );
    });

    it("calls onPassengerChange when nationality is changed", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      const nationalityInput = screen.getByTestId("passenger-nationality-0");
      fireEvent.change(nationalityInput, { target: { value: "SA" } });

      expect(onPassengerChange).toHaveBeenCalledWith(0, "nationality", "SA");
    });
  });

  describe("Add/Remove Passengers", () => {
    it("calls onAddPassenger when add button is clicked", async () => {
      const user = userEvent.setup();

      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      await user.click(screen.getByTestId("add-passenger-button"));

      expect(onAddPassenger).toHaveBeenCalledTimes(1);
    });

    it("does not show remove button for single passenger", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(
        screen.queryByTestId("remove-passenger-0")
      ).not.toBeInTheDocument();
    });

    it("shows remove button when there are multiple passengers", () => {
      const passengers = [createEmptyPassenger(), createEmptyPassenger()];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("remove-passenger-0")).toBeInTheDocument();
      expect(screen.getByTestId("remove-passenger-1")).toBeInTheDocument();
    });

    it("calls onRemovePassenger with correct index", async () => {
      const user = userEvent.setup();
      const passengers = [createEmptyPassenger(), createEmptyPassenger()];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      await user.click(screen.getByTestId("remove-passenger-1"));

      expect(onRemovePassenger).toHaveBeenCalledTimes(1);
      expect(onRemovePassenger).toHaveBeenCalledWith(1);
    });
  });

  describe("Pre-filled Data", () => {
    it("displays pre-filled passenger data", () => {
      const filledPassenger = createFilledPassenger(1);

      render(
        <BookingForm
          passengers={[filledPassenger]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-firstname-0")).toHaveValue("John1");
      expect(screen.getByTestId("passenger-lastname-0")).toHaveValue("Doe1");
      expect(screen.getByTestId("passenger-passport-0")).toHaveValue(
        "A12345671"
      );
      expect(screen.getByTestId("passenger-nationality-0")).toHaveValue("SA");
    });

    it("displays data for multiple passengers correctly", () => {
      const passengers = [createFilledPassenger(1), createFilledPassenger(2)];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-firstname-0")).toHaveValue("John1");
      expect(screen.getByTestId("passenger-firstname-1")).toHaveValue("John2");
      expect(screen.getByTestId("passenger-lastname-0")).toHaveValue("Doe1");
      expect(screen.getByTestId("passenger-lastname-1")).toHaveValue("Doe2");
    });
  });

  describe("Disabled State", () => {
    it("disables all inputs when disabled prop is true", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
          disabled={true}
        />
      );

      expect(screen.getByTestId("add-passenger-button")).toBeDisabled();
      expect(screen.getByTestId("passenger-firstname-0")).toBeDisabled();
      expect(screen.getByTestId("passenger-lastname-0")).toBeDisabled();
      expect(screen.getByTestId("passenger-passport-0")).toBeDisabled();
      expect(screen.getByTestId("passenger-nationality-0")).toBeDisabled();
    });

    it("disables remove button when disabled", () => {
      const passengers = [createEmptyPassenger(), createEmptyPassenger()];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
          disabled={true}
        />
      );

      expect(screen.getByTestId("remove-passenger-0")).toBeDisabled();
      expect(screen.getByTestId("remove-passenger-1")).toBeDisabled();
    });

    it("enables all inputs when disabled prop is false", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
          disabled={false}
        />
      );

      expect(screen.getByTestId("add-passenger-button")).not.toBeDisabled();
      expect(screen.getByTestId("passenger-firstname-0")).not.toBeDisabled();
      expect(screen.getByTestId("passenger-lastname-0")).not.toBeDisabled();
    });
  });

  describe("Passenger Types", () => {
    it("handles different passenger types", () => {
      const passengers: Passenger[] = [
        { type: "adult", firstName: "John", lastName: "Doe" },
        { type: "child", firstName: "Jane", lastName: "Doe" },
        { type: "infant", firstName: "Baby", lastName: "Doe" },
      ];

      render(
        <BookingForm
          passengers={passengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-form-0")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-form-1")).toBeInTheDocument();
      expect(screen.getByTestId("passenger-form-2")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("has proper labels for all inputs", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByLabelText("First Name")).toBeInTheDocument();
      expect(screen.getByLabelText("Last Name")).toBeInTheDocument();
      expect(screen.getByLabelText("Passport Number")).toBeInTheDocument();
      expect(screen.getByLabelText("Nationality")).toBeInTheDocument();
    });

    it("has required attributes on mandatory fields", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passenger-firstname-0")).toHaveAttribute(
        "required"
      );
      expect(screen.getByTestId("passenger-lastname-0")).toHaveAttribute(
        "required"
      );
    });
  });

  describe("Edge Cases", () => {
    it("handles empty passengers array", () => {
      render(
        <BookingForm
          passengers={[]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      expect(screen.getByTestId("passengers-list")).toBeEmptyDOMElement();
    });

    it("handles many passengers", () => {
      const manyPassengers = Array.from({ length: 5 }, (_, i) =>
        createFilledPassenger(i)
      );

      render(
        <BookingForm
          passengers={manyPassengers}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`passenger-form-${i}`)).toBeInTheDocument();
      }
    });

    it("handles special characters in names", () => {
      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      const firstNameInput = screen.getByTestId("passenger-firstname-0");
      fireEvent.change(firstNameInput, { target: { value: "Jean-Pierre" } });

      expect(onPassengerChange).toHaveBeenCalledWith(
        0,
        "firstName",
        "Jean-Pierre"
      );
    });

    it("handles Arabic characters in names", async () => {
      const user = userEvent.setup();

      render(
        <BookingForm
          passengers={[createEmptyPassenger()]}
          onPassengerChange={onPassengerChange}
          onAddPassenger={onAddPassenger}
          onRemovePassenger={onRemovePassenger}
        />
      );

      const firstNameInput = screen.getByTestId("passenger-firstname-0");
      // Note: userEvent.type might have issues with Arabic characters
      fireEvent.change(firstNameInput, { target: { value: "محمد" } });

      expect(onPassengerChange).toHaveBeenCalledWith(0, "firstName", "محمد");
    });
  });
});
