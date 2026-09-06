import { describe, it, expect } from "vitest";
import {
  assertTenantScopedContext,
  filterContextByTenant,
} from "./ai-guardrails.service";

describe("assertTenantScopedContext", () => {
  it("allows matching tenants", () => {
    expect(() => assertTenantScopedContext(7, 7)).not.toThrow();
  });

  it("blocks a mismatched tenant (cross-tenant context leak)", () => {
    expect(() => assertTenantScopedContext(7, 8)).toThrow();
  });

  it("allows global/legacy context (null item tenant)", () => {
    expect(() => assertTenantScopedContext(null, 8)).not.toThrow();
  });

  it("is a no-op in single-tenant mode (no request tenant)", () => {
    expect(() => assertTenantScopedContext(7, null)).not.toThrow();
  });
});

describe("filterContextByTenant", () => {
  const items = [
    { tenantId: 1, text: "a" },
    { tenantId: 2, text: "b" },
    { tenantId: null, text: "global" },
  ];

  it("keeps only the tenant's items plus global ones", () => {
    expect(filterContextByTenant(items, 1)).toEqual([
      { tenantId: 1, text: "a" },
      { tenantId: null, text: "global" },
    ]);
  });

  it("returns everything unchanged in single-tenant mode", () => {
    expect(filterContextByTenant(items, null)).toEqual(items);
  });
});
