import { describe, it, expect } from "vitest";
import { maskPII, maskSensitiveFields } from "../_core/unified-logger";

describe("Unified Logger - PII Masking", () => {
  describe("maskPII", () => {
    it("should mask email addresses", () => {
      const text = "Contact us at support@example.com or admin@test.org";
      const masked = maskPII(text);

      expect(masked).not.toContain("support@example.com");
      expect(masked).not.toContain("admin@test.org");
      expect(masked).toContain("[EMAIL]");
    });

    it("should mask phone numbers", () => {
      const text = "Call us at +966 50 123 4567 or 0501234567";
      const masked = maskPII(text);

      expect(masked).toContain("[PHONE]");
    });

    it("should mask credit card numbers", () => {
      const text = "Card number: 4532 1234 5678 9010";
      const masked = maskPII(text);

      expect(masked).not.toContain("4532 1234 5678 9010");
      expect(masked).toContain("[CARD]");
    });

    it("should mask passport numbers", () => {
      const text = "Passport: A1234567";
      const masked = maskPII(text);

      expect(masked).toContain("[PASSPORT]");
    });

    it("should mask Saudi National IDs", () => {
      const text = "National ID: 1234567890";
      const masked = maskPII(text);

      expect(masked).toContain("[NATIONAL_ID]");
    });

    it("should handle text with multiple PII types", () => {
      const text =
        "User email@test.com with phone +966501234567 and card 4532123456789010";
      const masked = maskPII(text);

      expect(masked).toContain("[EMAIL]");
      expect(masked).toContain("[PHONE]");
      expect(masked).toContain("[CARD]");
    });

    it("should not mask non-PII text", () => {
      const text = "This is a normal message without PII";
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
      expect(masked.email).toContain("[EMAIL]"); // Email is masked by PII masking
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

    it("should mask creditCard field", () => {
      const obj = {
        name: "John Doe",
        creditCard: "4532123456789010",
      };

      const masked = maskSensitiveFields(obj);

      expect(masked.creditCard).toBe("[REDACTED]");
    });

    it("should handle nested objects", () => {
      const obj = {
        user: {
          name: "John",
          password: "secret",
        },
        payment: {
          amount: 100,
          creditCard: "4532123456789010",
        },
      };

      const masked = maskSensitiveFields(obj);

      expect(masked.user.password).toBe("[REDACTED]");
      expect(masked.payment.creditCard).toBe("[REDACTED]");
      expect(masked.user.name).toBe("John");
      expect(masked.payment.amount).toBe(100);
    });

    it("should handle arrays", () => {
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

    it("should handle null and undefined", () => {
      const obj = {
        name: "John",
        email: null,
        phone: undefined,
      };

      const masked = maskSensitiveFields(obj);

      expect(masked.name).toBe("John");
      expect(masked.email).toBeNull();
      expect(masked.phone).toBeUndefined();
    });

    it("should mask multiple sensitive fields", () => {
      const obj = {
        username: "john",
        password: "secret123",
        passportNumber: "A1234567",
        nationalId: "1234567890",
        creditCard: "4532123456789010",
        cvv: "123",
        pin: "1234",
      };

      const masked = maskSensitiveFields(obj);

      expect(masked.password).toBe("[REDACTED]");
      expect(masked.passportNumber).toBe("[REDACTED]");
      expect(masked.nationalId).toBe("[REDACTED]");
      expect(masked.creditCard).toBe("[REDACTED]");
      expect(masked.cvv).toBe("[REDACTED]");
      expect(masked.pin).toBe("[REDACTED]");
      expect(masked.username).toBe("john");
    });
  });
});
