import { describe, it, expect } from "vitest";
import { bookings } from "../../drizzle/schema";
import {
  legacyTenantCondition,
  strictTenantCondition,
  tenantCondition,
  tenantStamp,
} from "./tenant-scope.service";

describe("tenant-scope helpers", () => {
  describe("tenantCondition", () => {
    it("fails closed when there is no tenant context", () => {
      expect(() => tenantCondition(bookings.tenantId, null)).toThrow(
        "Tenant context required"
      );
      expect(() => tenantCondition(bookings.tenantId, undefined)).toThrow(
        "Tenant context required"
      );
    });

    it("returns a strict SQL condition when a tenant is present", () => {
      expect(tenantCondition(bookings.tenantId, 7)).toBeDefined();
    });
  });

  describe("legacyTenantCondition", () => {
    it("is explicitly available only for migration compatibility", () => {
      expect(legacyTenantCondition(bookings.tenantId, 7)).toBeDefined();
      expect(legacyTenantCondition(bookings.tenantId, null)).toBeUndefined();
    });
  });

  describe("strictTenantCondition", () => {
    it("fails closed with no tenant context", () => {
      expect(() => strictTenantCondition(bookings.tenantId, null)).toThrow(
        "Tenant context required"
      );
    });

    it("returns a SQL condition with a tenant", () => {
      expect(strictTenantCondition(bookings.tenantId, 7)).toBeDefined();
    });
  });

  describe("tenantStamp", () => {
    it("fails closed without a tenant", () => {
      expect(() => tenantStamp(null)).toThrow("Tenant context required");
      expect(() => tenantStamp(undefined)).toThrow("Tenant context required");
    });

    it("stamps the tenant id when present", () => {
      expect(tenantStamp(7)).toEqual({ tenantId: 7 });
    });
  });
});
