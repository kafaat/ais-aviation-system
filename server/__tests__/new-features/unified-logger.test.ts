import { describe, it, expect } from "vitest";
import { sanitize, redactFromString } from "../../services/logger.service";

describe("Unified Logger - PII Masking", () => {
  describe("redactFromString", () => {
    it("should mask email addresses", () => {
      const text = "Contact us at support@example.com or admin@test.org";
      const masked = redactFromString(text);

      expect(masked).not.toContain("support@example.com");
      expect(masked).not.toContain("admin@test.org");
      // Email is partially masked - shows first char and domain
      expect(masked).toContain("s***@example.com");
    });

    it("should mask credit card numbers", () => {
      const text = "Card number: 4532 1234 5678 9010";
      const masked = redactFromString(text);

      expect(masked).not.toContain("4532 1234 5678 9010");
    });

    it("should not mask non-PII text", () => {
      const text = "This is a normal message without PII";
      const masked = redactFromString(text);

      expect(masked).toBe(text);
    });
  });

  describe("sanitize (maskSensitiveFields)", () => {
    it("should partially mask password field", () => {
      const obj = {
        username: "john",
        password: "secret123",
        email: "john@example.com",
      };

      const masked = sanitize(obj);

      // Password is partially masked (shows first 2 and last 2 chars)
      expect(masked.password).toContain("***");
      expect(masked.password).not.toBe("secret123");
      expect(masked.username).toBe("john");
      // Email is partially masked
      expect(masked.email).toContain("***@");
    });

    it("should partially mask passportNumber field", () => {
      const obj = {
        name: "John Doe",
        passportNumber: "A1234567",
      };

      const masked = sanitize(obj);

      // Passport is partially masked
      expect(masked.passportNumber).toContain("***");
      expect(masked.passportNumber).not.toBe("A1234567");
      expect(masked.name).toBe("John Doe");
    });

    it("should mask creditCard field showing last 4 digits", () => {
      const obj = {
        name: "John Doe",
        cardNumber: "4532123456789010",
      };

      const masked = sanitize(obj);

      // Card number shows last 4 digits
      expect(masked.cardNumber).toContain("****");
      expect(masked.cardNumber).toContain("9010");
    });

    it("should handle nested objects", () => {
      const obj = {
        user: {
          name: "John",
          password: "secret",
        },
        payment: {
          amount: 100,
          cardNumber: "4532123456789010",
        },
      };

      const masked = sanitize(obj);

      // Password is partially masked
      expect(masked.user.password).toContain("***");
      expect(masked.user.password).not.toBe("secret");
      expect(masked.payment.cardNumber).toContain("****");
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

      const masked = sanitize(obj);

      // Passwords are partially masked
      expect(masked.users[0].password).toContain("***");
      expect(masked.users[1].password).toContain("***");
      expect(masked.users[0].password).not.toBe("secret1");
      expect(masked.users[1].password).not.toBe("secret2");
      expect(masked.users[0].name).toBe("John");
      expect(masked.users[1].name).toBe("Jane");
    });

    it("should handle null and undefined", () => {
      const obj = {
        name: "John",
        email: null,
        phone: undefined,
      };

      const masked = sanitize(obj);

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
        cardNumber: "4532123456789010",
        cvv: "123",
        apiKey: "sk_test_123456789",
      };

      const masked = sanitize(obj);

      // All sensitive fields are masked
      expect(masked.password).toContain("***");
      expect(masked.password).not.toBe("secret123");
      expect(masked.passportNumber).toContain("***");
      expect(masked.nationalId).toContain("***");
      expect(masked.cardNumber).toContain("****");
      // CVV is short, so it gets fully redacted
      expect(masked.cvv).toBe("[REDACTED]");
      expect(masked.apiKey).toContain("***");
      expect(masked.username).toBe("john");
    });

    it("should mask phone numbers showing last 4 digits", () => {
      const obj = {
        name: "John",
        phone: "+966501234567",
        phoneNumber: "0501234567",
      };

      const masked = sanitize(obj);

      // Phone shows last 4 digits with masking
      expect(masked.phone).toContain("***");
      expect(masked.phone).toContain("4567");
      expect(masked.phoneNumber).toContain("***");
      expect(masked.phoneNumber).toContain("4567");
    });
  });
});
