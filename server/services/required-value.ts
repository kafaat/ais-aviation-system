/** Turns a checked data relationship into an explicit runtime invariant. */
export function requireValue<T>(
  value: T,
  message = "Required record is unavailable"
): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
