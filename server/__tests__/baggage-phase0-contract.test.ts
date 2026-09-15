import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("baggage entitlement Phase 0 contract", () => {
  it("keeps historical purchases untouched while defining reviewed catalog weights", () => {
    const migration = readFileSync(
      "drizzle/0053_baggage_catalog_weights.sql",
      "utf8"
    );
    expect(migration).toContain("`code` = 'BAG_20KG'");
    expect(migration).toContain("`weightGrams` = 20000");
    expect(migration).toContain("`code` = 'BAG_30KG'");
    expect(migration).toContain("`weightGrams` = 30000");
    expect(migration).not.toMatch(/UPDATE\s+`?booking_ancillaries`?/i);
    expect(migration).not.toContain("BAG_SPORTS");
  });

  it("keeps fresh catalog seeds and session snapshots aligned with migrations", () => {
    const serviceSeed = readFileSync(
      "server/services/ancillary-services.service.ts",
      "utf8"
    );
    const scriptSeed = readFileSync(
      "server/scripts/seed-ancillaries.mjs",
      "utf8"
    );
    for (const seed of [serviceSeed, scriptSeed]) {
      expect(seed).toMatch(/code: "BAG_20KG"[\s\S]*?weightGrams: 20000/);
      expect(seed).toMatch(/code: "BAG_30KG"[\s\S]*?weightGrams: 30000/);
      expect(seed).not.toMatch(/code: "BAG_SPORTS"[\s\S]{0,300}weightGrams:/);
    }
    const sessionMigration = readFileSync(
      "drizzle/0054_baggage_entitlement_sessions.sql",
      "utf8"
    );
    for (const column of [
      "entitlementSnapshot",
      "entitlementSnapshotAt",
      "entitlementSegmentId",
    ])
      expect(sessionMigration).toContain(`ADD \`${column}\``);
  });

  it("limits inventory to baggage and protects invalid legacy metadata", () => {
    const detail = readFileSync("scripts/audit-baggage-matching.sql", "utf8");
    const summary = readFileSync("scripts/audit-baggage-summary.sql", "utf8");
    for (const query of [detail, summary]) {
      expect(query).toContain("services.category = 'baggage'");
      expect(query).toContain("JSON_VALID");
      expect(query).not.toMatch(/\b(UPDATE|DELETE|INSERT|REPLACE)\b/i);
    }
    expect(detail).toContain("JSON_MERGE_PRESERVE");
    expect(detail).toContain("invalid_specific_segment_scope");
  });
});
