/**
 * Check-in emails use `pnr`, not the independently issued booking reference.
 * The link selects an authenticated read only; ownership and check-in authority
 * remain on the server. Previously sent `booking` links are resolved against
 * the signed-in owner's bookings before using their PNR.
 */
export type CheckInLinkTarget =
  | { kind: "pnr"; value: string }
  | { kind: "bookingReference"; value: string }
  | { kind: "invalid" }
  | null;

export function validCheckInCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{6}$/.test(value);
}

export function checkInPath(pnr: string): string {
  if (!validCheckInCode(pnr))
    throw new Error("A valid check-in PNR is required");
  return `/check-in?${new URLSearchParams({ pnr })}`;
}

export function readCheckInLink(search: string): CheckInLinkTarget {
  const params = new URLSearchParams(search);
  const pnrs = params.getAll("pnr");
  const references = params.getAll("booking");
  if (pnrs.length + references.length === 0) return null;
  // Multiple targets must not pick a booking by parameter order.
  if (pnrs.length + references.length !== 1) return { kind: "invalid" };
  const value = (pnrs[0] ?? references[0]).toUpperCase();
  if (!validCheckInCode(value)) return { kind: "invalid" };
  return { kind: pnrs.length ? "pnr" : "bookingReference", value };
}
