import { describe, it, expect } from "vitest";
import { bookings } from "../../drizzle/schema";
import {
  tenantCondition,
  strictTenantCondition,
  tenantStamp,
} from "./tenant-scope.service";

describe("tenant-scope helpers", () => {
  describe("tenantCondition", () => {
    it("returns undefined when there is no tenant context", () => {
      expect(tenantCondition(bookings.tenantId, null)).toBeUndefined();
      expect(tenantCondition(bookings.tenantId, undefined)).toBeUndefined();
    });

    it("returns a SQL condition when a tenant is present", () => {
      const cond = tenantCondition(bookings.tenantId, 7);
      expect(cond).toBeDefined();
    });
  });

  describe("strictTenantCondition", () => {
    it("returns undefined with no tenant context", () => {
      expect(strictTenantCondition(bookings.tenantId, null)).toBeUndefined();
    });

    it("returns a SQL condition with a tenant", () => {
      expect(strictTenantCondition(bookings.tenantId, 7)).toBeDefined();
    });
  });

  describe("tenantStamp", () => {
    it("is empty (no stamp) without a tenant", () => {
      expect(tenantStamp(null)).toEqual({});
      expect(tenantStamp(undefined)).toEqual({});
    });

    it("stamps the tenant id when present", () => {
      expect(tenantStamp(7)).toEqual({ tenantId: 7 });
    });
  });
});
