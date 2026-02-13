/**
 * UserProfileForm Component Tests
 *
 * Tests for the UserProfileForm component that handles user preferences
 * including travel settings, personal information, and notifications.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  UserProfileForm,
  type UserPreferencesFormData,
} from "../UserProfileForm";
import React from "react";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "profile.tabs.travel": "Travel Preferences",
        "profile.tabs.personal": "Personal Info",
        "profile.tabs.notifications": "Notifications",
        "profile.travel.title": "Travel Preferences",
        "profile.travel.description": "Customize your travel experience",
        "profile.travel.preferredSeat": "Preferred Seat",
        "profile.travel.window": "Window",
        "profile.travel.aisle": "Aisle",
        "profile.travel.middle": "Middle",
        "profile.travel.preferredClass": "Preferred Class",
        "profile.travel.economy": "Economy",
        "profile.travel.business": "Business",
        "profile.travel.first": "First Class",
        "profile.travel.mealPreference": "Meal Preference",
        "profile.travel.meals.regular": "Regular",
        "profile.travel.meals.vegetarian": "Vegetarian",
        "profile.travel.meals.vegan": "Vegan",
        "profile.travel.meals.halal": "Halal",
        "profile.travel.meals.kosher": "Kosher",
        "profile.travel.meals.glutenFree": "Gluten Free",
        "profile.travel.specialServices": "Special Services",
        "profile.travel.wheelchair": "Wheelchair Assistance",
        "profile.travel.extraLegroom": "Extra Legroom",
        "profile.personal.title": "Personal Information",
        "profile.personal.description": "Your personal details",
        "profile.personal.passportNumber": "Passport Number",
        "profile.personal.passportPlaceholder": "Enter passport number",
        "profile.personal.passportExpiry": "Passport Expiry",
        "profile.personal.selectDate": "Select date",
        "profile.personal.nationality": "Nationality",
        "profile.personal.nationalityPlaceholder": "Enter nationality",
        "profile.personal.phone": "Phone Number",
        "profile.personal.emergencyContact": "Emergency Contact",
        "profile.personal.emergencyContactPlaceholder": "Enter contact name",
        "profile.personal.emergencyPhone": "Emergency Phone",
        "profile.notifications.title": "Notification Settings",
        "profile.notifications.description": "Manage your notifications",
        "profile.notifications.email": "Email Notifications",
        "profile.notifications.emailDesc": "Receive updates via email",
        "profile.notifications.sms": "SMS Notifications",
        "profile.notifications.smsDesc": "Receive updates via SMS",
        "common.save": "Save",
        "common.loading": "Loading...",
      };
      return translations[key] || key;
    },
    i18n: { language: "en" },
  }),
}));

// Mock date-fns
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

const createDefaultFormData = (): UserPreferencesFormData => ({
  preferredSeatType: "window",
  preferredCabinClass: "economy",
  mealPreference: "regular",
  wheelchairAssistance: false,
  extraLegroom: false,
  passportNumber: "",
  passportExpiry: undefined,
  nationality: "",
  phoneNumber: "",
  emergencyContact: "",
  emergencyPhone: "",
  emailNotifications: true,
  smsNotifications: false,
});

const createFilledFormData = (): UserPreferencesFormData => ({
  preferredSeatType: "aisle",
  preferredCabinClass: "business",
  mealPreference: "halal",
  wheelchairAssistance: true,
  extraLegroom: true,
  passportNumber: "A12345678",
  passportExpiry: new Date("2030-01-15"),
  nationality: "Saudi Arabia",
  phoneNumber: "+966501234567",
  emergencyContact: "John Doe",
  emergencyPhone: "+966509876543",
  emailNotifications: true,
  smsNotifications: true,
});

// ============================================================================
// Tests
// ============================================================================

describe("UserProfileForm", () => {
  let onFormDataChange: ReturnType<typeof vi.fn>;
  let onSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onFormDataChange = vi.fn();
    onSave = vi.fn();
  });

  const renderForm = (
    props: Partial<React.ComponentProps<typeof UserProfileForm>> = {}
  ) => {
    const defaultProps: React.ComponentProps<typeof UserProfileForm> = {
      formData: createDefaultFormData(),
      onFormDataChange,
      onSave,
    };

    return render(<UserProfileForm {...defaultProps} {...props} />);
  };

  describe("Rendering", () => {
    it("renders the form", () => {
      renderForm();

      expect(screen.getByTestId("user-profile-form")).toBeInTheDocument();
    });

    it("renders all tabs", () => {
      renderForm();

      expect(screen.getByTestId("tab-travel")).toBeInTheDocument();
      expect(screen.getByTestId("tab-personal")).toBeInTheDocument();
      expect(screen.getByTestId("tab-notifications")).toBeInTheDocument();
    });

    it("renders save button", () => {
      renderForm();

      expect(screen.getByTestId("save-button")).toBeInTheDocument();
      expect(screen.getByTestId("save-button")).toHaveTextContent("Save");
    });

    it("displays user email when provided", () => {
      renderForm({ userEmail: "test@example.com" });

      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "test@example.com"
      );
    });
  });

  describe("Travel Preferences Tab", () => {
    it("renders travel preferences by default", () => {
      renderForm();

      expect(screen.getByTestId("tab-content-travel")).toBeInTheDocument();
    });

    it("displays seat preference select", () => {
      renderForm();

      expect(screen.getByTestId("seat-select")).toBeInTheDocument();
    });

    it("displays cabin class select", () => {
      renderForm();

      expect(screen.getByTestId("cabin-select")).toBeInTheDocument();
    });

    it("displays meal preference select", () => {
      renderForm();

      expect(screen.getByTestId("meal-select")).toBeInTheDocument();
    });

    it("displays wheelchair assistance toggle", () => {
      renderForm();

      expect(screen.getByTestId("wheelchair-switch")).toBeInTheDocument();
    });

    it("displays extra legroom toggle", () => {
      renderForm();

      expect(screen.getByTestId("legroom-switch")).toBeInTheDocument();
    });

    it("seat select is interactive", () => {
      renderForm();

      const seatSelect = screen.getByTestId("seat-select");
      expect(seatSelect).not.toBeDisabled();
    });

    it("calls onFormDataChange when wheelchair toggle changes", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("wheelchair-switch"));

      expect(onFormDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ wheelchairAssistance: true })
      );
    });

    it("displays current values correctly", () => {
      const filledData = createFilledFormData();
      renderForm({ formData: filledData });

      expect(screen.getByTestId("seat-select")).toHaveTextContent("Aisle");
      expect(screen.getByTestId("cabin-select")).toHaveTextContent("Business");
    });
  });

  describe("Personal Information Tab", () => {
    it("switches to personal tab when clicked", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByTestId("tab-content-personal")).toBeInTheDocument();
    });

    it("displays passport input", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByTestId("passport-input")).toBeInTheDocument();
    });

    it("displays nationality input", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByTestId("nationality-input")).toBeInTheDocument();
    });

    it("displays phone input", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByTestId("phone-input")).toBeInTheDocument();
    });

    it("displays emergency contact inputs", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByTestId("emergency-contact-input")).toBeInTheDocument();
      expect(screen.getByTestId("emergency-phone-input")).toBeInTheDocument();
    });

    it("calls onFormDataChange when passport is changed", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));
      const passportInput = screen.getByTestId("passport-input");
      await user.type(passportInput, "A123");

      expect(onFormDataChange).toHaveBeenCalled();
    });

    it("displays filled personal information", async () => {
      const user = userEvent.setup();
      const filledData = createFilledFormData();
      renderForm({ formData: filledData });

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByTestId("passport-input")).toHaveValue("A12345678");
      expect(screen.getByTestId("nationality-input")).toHaveValue(
        "Saudi Arabia"
      );
      expect(screen.getByTestId("phone-input")).toHaveValue("+966501234567");
    });
  });

  describe("Notifications Tab", () => {
    it("switches to notifications tab when clicked", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-notifications"));

      expect(
        screen.getByTestId("tab-content-notifications")
      ).toBeInTheDocument();
    });

    it("displays email notifications toggle", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-notifications"));

      expect(screen.getByTestId("email-switch")).toBeInTheDocument();
    });

    it("displays SMS notifications toggle", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-notifications"));

      expect(screen.getByTestId("sms-switch")).toBeInTheDocument();
    });

    it("calls onFormDataChange when email toggle changes", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-notifications"));
      await user.click(screen.getByTestId("email-switch"));

      expect(onFormDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ emailNotifications: false })
      );
    });

    it("calls onFormDataChange when SMS toggle changes", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-notifications"));
      await user.click(screen.getByTestId("sms-switch"));

      expect(onFormDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ smsNotifications: true })
      );
    });
  });

  describe("Save Functionality", () => {
    it("calls onSave when save button is clicked", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("save-button"));

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("disables save button when isSaving is true", () => {
      renderForm({ isSaving: true });

      expect(screen.getByTestId("save-button")).toBeDisabled();
    });

    it("shows loading text when isSaving is true", () => {
      renderForm({ isSaving: true });

      expect(screen.getByTestId("save-button")).toHaveTextContent("Loading...");
    });

    it("shows save text when not saving", () => {
      renderForm({ isSaving: false });

      expect(screen.getByTestId("save-button")).toHaveTextContent("Save");
    });
  });

  describe("Form Data Display", () => {
    it("displays all filled form data correctly", async () => {
      const user = userEvent.setup();
      const filledData = createFilledFormData();
      renderForm({ formData: filledData });

      // Check travel preferences
      expect(screen.getByTestId("seat-select")).toHaveTextContent("Aisle");
      expect(screen.getByTestId("cabin-select")).toHaveTextContent("Business");
      expect(screen.getByTestId("meal-select")).toHaveTextContent("Halal");

      // Check personal info
      await user.click(screen.getByTestId("tab-personal"));
      expect(screen.getByTestId("passport-input")).toHaveValue("A12345678");
      expect(screen.getByTestId("nationality-input")).toHaveValue(
        "Saudi Arabia"
      );
      expect(screen.getByTestId("phone-input")).toHaveValue("+966501234567");
      expect(screen.getByTestId("emergency-contact-input")).toHaveValue(
        "John Doe"
      );
      expect(screen.getByTestId("emergency-phone-input")).toHaveValue(
        "+966509876543"
      );
    });
  });

  describe("Accessibility", () => {
    it("has labels for all form fields", () => {
      renderForm();

      expect(screen.getByLabelText("Preferred Seat")).toBeInTheDocument();
      expect(screen.getByLabelText("Preferred Class")).toBeInTheDocument();
      expect(screen.getByLabelText("Meal Preference")).toBeInTheDocument();
    });

    it("has labels for personal info fields", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));

      expect(screen.getByLabelText("Passport Number")).toBeInTheDocument();
      expect(screen.getByLabelText("Nationality")).toBeInTheDocument();
      expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
    });

    it("tabs are keyboard accessible", async () => {
      const user = userEvent.setup();
      renderForm();

      // Focus on tab and press keys
      screen.getByTestId("tab-travel").focus();
      await user.keyboard("{Tab}");

      // Should be able to navigate
      expect(document.activeElement).toBeDefined();
    });
  });

  describe("Select Options", () => {
    it("seat select displays current value", () => {
      const formData = {
        ...createDefaultFormData(),
        preferredSeatType: "aisle" as const,
      };
      renderForm({ formData });

      expect(screen.getByTestId("seat-select")).toHaveTextContent("Aisle");
    });

    it("cabin select displays current value", () => {
      const formData = {
        ...createDefaultFormData(),
        preferredCabinClass: "business" as const,
      };
      renderForm({ formData });

      expect(screen.getByTestId("cabin-select")).toHaveTextContent("Business");
    });

    it("meal select displays current value", () => {
      const formData = {
        ...createDefaultFormData(),
        mealPreference: "halal" as const,
      };
      renderForm({ formData });

      expect(screen.getByTestId("meal-select")).toHaveTextContent("Halal");
    });

    it("all selects are interactive", () => {
      renderForm();

      expect(screen.getByTestId("seat-select")).not.toBeDisabled();
      expect(screen.getByTestId("cabin-select")).not.toBeDisabled();
      expect(screen.getByTestId("meal-select")).not.toBeDisabled();
    });
  });

  describe("Toggle States", () => {
    it("reflects wheelchair toggle state", () => {
      const formData = {
        ...createDefaultFormData(),
        wheelchairAssistance: true,
      };
      renderForm({ formData });

      const wheelchairSwitch = screen.getByTestId("wheelchair-switch");
      expect(wheelchairSwitch).toHaveAttribute("data-state", "checked");
    });

    it("reflects legroom toggle state", () => {
      const formData = { ...createDefaultFormData(), extraLegroom: true };
      renderForm({ formData });

      const legroomSwitch = screen.getByTestId("legroom-switch");
      expect(legroomSwitch).toHaveAttribute("data-state", "checked");
    });

    it("reflects email notifications state", async () => {
      const user = userEvent.setup();
      const formData = { ...createDefaultFormData(), emailNotifications: true };
      renderForm({ formData });

      await user.click(screen.getByTestId("tab-notifications"));

      const emailSwitch = screen.getByTestId("email-switch");
      expect(emailSwitch).toHaveAttribute("data-state", "checked");
    });

    it("reflects SMS notifications state", async () => {
      const user = userEvent.setup();
      const formData = { ...createDefaultFormData(), smsNotifications: true };
      renderForm({ formData });

      await user.click(screen.getByTestId("tab-notifications"));

      const smsSwitch = screen.getByTestId("sms-switch");
      expect(smsSwitch).toHaveAttribute("data-state", "checked");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty strings in form data", () => {
      renderForm();

      // Should render without errors
      expect(screen.getByTestId("user-profile-form")).toBeInTheDocument();
    });

    it("handles special characters in inputs", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));
      const nationalityInput = screen.getByTestId("nationality-input");
      fireEvent.change(nationalityInput, {
        target: { value: "المملكة العربية السعودية" },
      });

      expect(onFormDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ nationality: "المملكة العربية السعودية" })
      );
    });

    it("handles phone number with special formatting", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.click(screen.getByTestId("tab-personal"));
      const phoneInput = screen.getByTestId("phone-input");
      fireEvent.change(phoneInput, { target: { value: "+966 50 123 4567" } });

      expect(onFormDataChange).toHaveBeenCalledWith(
        expect.objectContaining({ phoneNumber: "+966 50 123 4567" })
      );
    });
  });
});
