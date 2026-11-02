import { describe, expect, it } from "vitest";
import { arrivalDelayTariffXdr } from "../shared/gaca-arrival-delay";

describe("GACA article 10 arrival-delay tariff in SDR", () => {
  it.each([
    [0, 0],
    [179.99, 0],
    [180, 50],
    [360, 50],
    [360.01, 150],
  ])("maps %s elapsed minutes to %s SDR", (minutes, expected) => {
    expect(arrivalDelayTariffXdr(minutes)).toBe(expected);
  });

  it.each([NaN, Infinity, -1])("rejects invalid delay %s", minutes => {
    expect(() => arrivalDelayTariffXdr(minutes)).toThrow(RangeError);
  });
});
