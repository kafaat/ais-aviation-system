/**
 * Keep the original public search query, including market, passenger and fare
 * options, in the booking URL. No passenger form data is persisted here.
 */
export function flightSearchPath(
  search: string | null | undefined
): string | null {
  if (!search || search.length > 8192) return null;
  const query = new URLSearchParams(search);
  const origin = query.get("origin");
  const destination = query.get("destination");
  const date = query.get("date");
  if (
    !origin ||
    !destination ||
    !/^[1-9]\d*$/.test(origin) ||
    !/^[1-9]\d*$/.test(destination) ||
    !Number.isSafeInteger(Number(origin)) ||
    !Number.isSafeInteger(Number(destination)) ||
    origin === destination ||
    !date ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      date
    ) ||
    !Number.isFinite(Date.parse(date))
  )
    return null;
  const civilDate = date.slice(0, 10);
  if (
    new Date(`${civilDate}T00:00:00Z`).toISOString().slice(0, 10) !== civilDate
  )
    return null;
  return `/search?${query}`;
}
