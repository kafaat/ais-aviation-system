/** Catalog promises that can be verified from the physical per-flight inventory. */
export function matchesPaidSeatProduct(
  code: string,
  seat: { row: number; hasExtraLegroom: boolean; seatType: string }
) {
  if (seat.seatType.startsWith("exit_row")) return false;
  return (
    (code === "SEAT_EXTRA_LEG" && seat.hasExtraLegroom) ||
    (code === "SEAT_FRONT_ROW" && seat.row === 1)
  );
}
