import { describe, it, expect } from "vitest";
import { maskPII, maskSensitiveFields } from "../_core/logger";

describe("PII Masking", () => {
  describe("maskPII", () => {
    it("should mask email addresses", () => {
      const text = "Contact us at support@example.com or john.doe@test.org";
      const masked = maskPII(text);
      expect(masked).toBe("Contact us at [EMAIL] or [EMAIL]");
    });

    it("should mask phone numbers", () => {
      const text = "Call us at +966 123 456 7890 or 555-123-4567";
      const masked = maskPII(text);
      expect(masked).toContain("[PHONE]");
    });

    it("should mask credit card numbers", () => {
      const text = "Card number: 1234 5678 9012 3456";
      const masked = maskPII(text);
      expect(masked).toBe("Card number: [CARD]");
    });

    it("should mask passport numbers", () => {
      const text = "Passport: A1234567";
      const masked = maskPII(text);
      expect(masked).toBe("Passport: [PASSPORT]");
    });

    it("should mask Saudi National IDs", () => {
      const text = "National ID: 1234567890";
      const masked = maskPII(text);
      expect(masked).toBe("National ID: [NATIONAL_ID]");
    });

    it("should not modify text without PII", () => {
      const text = "This is just normal text";
      const masked = maskPII(text);
      expect(masked).toBe(text);
    });
  });

  describe("maskSensitiveFields", () => {
    it("should mask password field", () => {
      const obj = {
        username: "john",
        password: "secret123",
        email: "john@example.com",
      };
      const masked = maskSensitiveFields(obj);
      expect(masked.password).toBe("[REDACTED]");
      expect(masked.username).toBe("john");
      expect(masked.email).toBe("[EMAIL]");
    });

    it("should mask passportNumber field", () => {
      const obj = {
        name: "John Doe",
        passportNumber: "A1234567",
      };
      const masked = maskSensitiveFields(obj);
      expect(masked.passportNumber).toBe("[REDACTED]");
      expect(masked.name).toBe("John Doe");
    });

    it("should mask nested objects", () => {
      const obj = {
        user: {
          name: "John",
          password: "secret",
          contact: {
            email: "john@example.com",
            phone: "555-123-4567",
          },
        },
      };
      const masked = maskSensitiveFields(obj);
      expect(masked.user.password).toBe("[REDACTED]");
      expect(masked.user.contact.email).toBe("[EMAIL]");
      expect(masked.user.contact.phone).toBe("[PHONE]");
    });

    it("should mask arrays of objects", () => {
      const obj = {
        users: [
          { name: "John", password: "secret1" },
          { name: "Jane", password: "secret2" },
        ],
      };
      const masked = maskSensitiveFields(obj);
      expect(masked.users[0].password).toBe("[REDACTED]");
      expect(masked.users[1].password).toBe("[REDACTED]");
      expect(masked.users[0].name).toBe("John");
      expect(masked.users[1].name).toBe("Jane");
    });

    it("should handle null and undefined values", () => {
      const obj = {
        value: null,
        other: undefined,
        email: "test@example.com",
      };
      const masked = maskSensitiveFields(obj);
      expect(masked.value).toBe(null);
      expect(masked.other).toBe(undefined);
      expect(masked.email).toBe("[EMAIL]");
    });

    it("should return non-object values as-is", () => {
      expect(maskSensitiveFields("string")).toBe("string");
      expect(maskSensitiveFields(123)).toBe(123);
      expect(maskSensitiveFields(true)).toBe(true);
      expect(maskSensitiveFields(null)).toBe(null);
    });

    it("should mask multiple sensitive fields", () => {
      const obj = {
        username: "john",
        password: "secret",
        creditCard: "1234-5678-9012-3456",
        cvv: "123",
        nationalId: "1234567890",
      };
      const masked = maskSensitiveFields(obj);
      expect(masked.password).toBe("[REDACTED]");
      expect(masked.creditCard).toBe("[REDACTED]");
      expect(masked.cvv).toBe("[REDACTED]");
      expect(masked.nationalId).toBe("[REDACTED]");
      expect(masked.username).toBe("john");
    });
  });
});
