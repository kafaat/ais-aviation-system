import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("operational uniqueness contract", () => {
  const schema = readFileSync("drizzle/schema.ts", "utf8");
  const migrations = readdirSync("drizzle")
    .filter(name => /^\d{4}_.*\.sql$/.test(name))
    .map(name => readFileSync(`drizzle/${name}`, "utf8"))
    .join("\n");

  it("makes passenger ticket numbers unique", () => {
    expect(schema).toContain('uniqueIndex("passengers_ticket_number_uq").on(');
    expect(migrations).toContain("passengers_ticket_number_uq");
  });

  it("makes seat numbers unique within a flight", () => {
    expect(schema).toContain('uniqueIndex("seat_inv_flight_seat_uq").on(');
    expect(migrations).toContain("seat_inv_flight_seat_uq");
  });
});
