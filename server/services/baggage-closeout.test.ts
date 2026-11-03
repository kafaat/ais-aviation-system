import { describe, expect, it } from "vitest";
import { reconcileBaggageCloseout } from "./baggage-custody.service";

describe("Resolution 753 departure inventory", () => {
  const expected = [
    {
      baggageId: 1,
      tagNumber: "0065000001",
      entryStage: "acceptance" as const,
    },
    { baggageId: 2, tagNumber: "0065000002", entryStage: "transfer" as const },
  ];

  it("closes only when every expected bag entered and loaded exactly once", () => {
    const result = reconcileBaggageCloseout(9, expected, [
      { baggageId: 1, flightId: 9, stage: "acceptance" },
      { baggageId: 1, flightId: 9, stage: "loading" },
      { baggageId: 2, flightId: 9, stage: "transfer" },
      { baggageId: 2, flightId: 9, stage: "loading" },
    ]);
    expect(result.readyToClose).toBe(true);
    expect(result.loadedBags).toBe(2);
  });

  it("identifies missing load and duplicate evidence without closing", () => {
    const result = reconcileBaggageCloseout(9, expected, [
      { baggageId: 1, flightId: 9, stage: "acceptance" },
      { baggageId: 1, flightId: 9, stage: "loading" },
      { baggageId: 1, flightId: 9, stage: "loading" },
      { baggageId: 2, flightId: 9, stage: "transfer" },
    ]);
    expect(result.readyToClose).toBe(false);
    expect(result.missingLoading).toEqual(["0065000002"]);
    expect(result.duplicates).toEqual([
      { tagNumber: "0065000001", stage: "loading", count: 2 },
    ]);
  });
});
