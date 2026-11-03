import { expect, it } from "vitest";
import { extraNeedsRecoveryReview } from "./recovery-extra-scope";
const segments = [
  { bookingId: 1, id: 101, flightId: 11, status: "confirmed" as const },
  { bookingId: 1, id: 102, flightId: 22, status: "confirmed" as const },
  { bookingId: 2, id: 103, flightId: 33, status: "confirmed" as const },
  { bookingId: 1, id: 104, flightId: 44, status: "cancelled" as const },
];
it.each([
  ["specific_segment", 102, false],
  ["specific_segment", 101, true],
  ["specific_segment", 103, true],
  ["specific_segment", 104, true],
  ["specific_segment", null, true],
  ["specific_segment", 999, true],
  ["unresolved", 102, true],
  ["all_segments", 102, true],
] as const)("handles %s binding to %s", (scopeState, segmentId, review) => {
  expect(
    extraNeedsRecoveryReview(
      { bookingId: 1, scopeState, segmentId },
      segments,
      11
    )
  ).toBe(review);
});
