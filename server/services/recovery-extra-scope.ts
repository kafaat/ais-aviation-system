import type { BookingAncillary, BookingSegment } from "../../drizzle/schema";

export function extraNeedsRecoveryReview(
  extra: Pick<BookingAncillary, "bookingId" | "scopeState" | "segmentId">,
  segments: Pick<BookingSegment, "bookingId" | "id" | "flightId" | "status">[],
  disruptedFlightId: number
) {
  return (
    extra.scopeState !== "specific_segment" ||
    !segments.some(
      segment =>
        segment.id === extra.segmentId &&
        segment.bookingId === extra.bookingId &&
        segment.status === "confirmed" &&
        segment.flightId !== disruptedFlightId
    )
  );
}
