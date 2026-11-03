import { afterEach, describe, expect, it, vi } from "vitest";
import { generateBaggageTag, isBaggageLicensePlate } from "./baggage.service";

afterEach(() => vi.unstubAllEnvs());

describe("baggage license plate allocation", () => {
  it("uses the configured three-digit issuer in a ten-digit plate", () => {
    const tag = generateBaggageTag("065");
    expect(tag).toMatch(/^0065\d{6}$/);
    expect(isBaggageLicensePlate(tag)).toBe(true);
  });

  it("fails closed in production without an assigned numeric airline code", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BAGGAGE_AIRLINE_NUMERIC_CODE", "");
    expect(() => generateBaggageTag()).toThrow(/assigned three-digit code/);
  });
});
