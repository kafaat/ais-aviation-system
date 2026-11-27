import { describe, expect, it } from "vitest";
import { calculateModificationFee } from "./modification-fee";

describe("modification fee evaluation time", () => {
  const departure = new Date("2027-01-20T00:00:00.000Z");
  it.each([
    [168, 0, 500],
    [72, 500, 1000],
    [24, 1000, 1500],
  ])(
    "uses the supplied instant at the %i-hour boundary",
    (hours, at, after) => {
      const instant = departure.getTime() - hours * 3600000;
      expect(
        calculateModificationFee(10000, departure, new Date(instant))
      ).toBe(at);
      expect(
        calculateModificationFee(10000, departure, new Date(instant + 1))
      ).toBe(after);
    }
  );
});
