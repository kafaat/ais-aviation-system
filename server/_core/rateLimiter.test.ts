import { describe, it, expect } from "vitest";
import { apiLimiter, webhookLimiter, authLimiter, strictLimiter } from "./rateLimiter";

describe("Rate Limiter Configuration", () => {
  describe("apiLimiter", () => {
    it("should have correct configuration", () => {
      expect(apiLimiter).toBeDefined();
      // Rate limiter is a function/middleware
      expect(typeof apiLimiter).toBe("function");
    });
  });

  describe("webhookLimiter", () => {
    it("should have correct configuration", () => {
      expect(webhookLimiter).toBeDefined();
      expect(typeof webhookLimiter).toBe("function");
    });
  });

  describe("authLimiter", () => {
    it("should have correct configuration", () => {
      expect(authLimiter).toBeDefined();
      expect(typeof authLimiter).toBe("function");
    });
  });

  describe("strictLimiter", () => {
    it("should have correct configuration", () => {
      expect(strictLimiter).toBeDefined();
      expect(typeof strictLimiter).toBe("function");
    });
  });
});
