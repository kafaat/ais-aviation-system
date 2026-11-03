/** Public search preferences. They never determine invoice currency or tenant. */
export const DISPLAY_CURRENCIES = [
  "SAR",
  "USD",
  "EUR",
  "AED",
  "GBP",
  "KWD",
  "BHD",
  "QAR",
  "OMR",
  "EGP",
  "YER",
] as const;
// Direct quotes entered by an operator or ingested from a named provider.
export const DISPLAY_RATE_SOURCES = [
  "manual",
  "bank",
  "openexchangerates",
] as const;
export const DISPLAY_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export const DISPLAY_COUNTRIES = [
  "SA",
  "AE",
  "KW",
  "BH",
  "QA",
  "OM",
  "EG",
  "YE",
  "US",
  "GB",
  "DE",
  "FR",
] as const;
export type DisplayCountry = (typeof DISPLAY_COUNTRIES)[number];
export type TravelerCounts = {
  adults: number;
  children: number;
  infants: number;
};
export type SearchPreferences = TravelerCounts & {
  currency: DisplayCurrency;
  country: DisplayCountry;
};
export const DEFAULT_SEARCH_PREFERENCES: SearchPreferences = {
  adults: 1,
  children: 0,
  infants: 0,
  currency: "SAR",
  country: "SA",
};

export function validTravelerCounts(value: TravelerCounts): boolean {
  return (
    Number.isInteger(value.adults) &&
    value.adults >= 1 &&
    Number.isInteger(value.children) &&
    value.children >= 0 &&
    Number.isInteger(value.infants) &&
    value.infants >= 0 &&
    value.adults + value.children + value.infants <= 9
  );
}

export function searchPreferences(search: string): SearchPreferences {
  const outer = new URLSearchParams(search);
  // Flight selection carries the original search through authentication/back.
  const inner = new URLSearchParams(outer.get("search") ?? "");
  const get = (name: string) => outer.get(name) ?? inner.get(name);
  const number = (name: string, fallback: number) => {
    const value = get(name);
    return value !== null && /^\d{1,2}$/.test(value) ? Number(value) : fallback;
  };
  const counts = {
    adults: number("adults", number("passengers", 1)),
    children: number("children", 0),
    infants: number("infants", 0),
  };
  const currency = (get("currency") ?? "SAR").toUpperCase();
  const country = (get("country") ?? "SA").toUpperCase();
  return {
    ...(validTravelerCounts(counts)
      ? counts
      : { adults: 1, children: 0, infants: 0 }),
    currency: DISPLAY_CURRENCIES.includes(currency as DisplayCurrency)
      ? (currency as DisplayCurrency)
      : "SAR",
    country: DISPLAY_COUNTRIES.includes(country as DisplayCountry)
      ? (country as DisplayCountry)
      : "SA",
  };
}

export function preferenceParams(value: SearchPreferences): URLSearchParams {
  return new URLSearchParams(
    Object.entries(value).map(([key, item]) => [key, String(item)])
  );
}

export function travelerTypes(
  value: TravelerCounts
): Array<"adult" | "child" | "infant"> {
  const safe = validTravelerCounts(value) ? value : DEFAULT_SEARCH_PREFERENCES;
  return [
    ...Array<"adult">(safe.adults).fill("adult"),
    ...Array<"child">(safe.children).fill("child"),
    ...Array<"infant">(safe.infants).fill("infant"),
  ];
}

export function isCivilDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function adjacentSearch(search: string, offset: -1 | 1): string | null {
  const params = new URLSearchParams(search);
  const value = params.get("date") ?? "";
  if (!isCivilDay(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  params.set("date", date.toISOString().slice(0, 10));
  return `/search?${params.toString()}`;
}

/** Read both canonical links and older double-encoded multi-city links. */
export function parseMultiCitySearch(
  search: string
): Array<{ originId: number; destinationId: number; departureDate: Date }> {
  const raw = new URLSearchParams(search).get("segments");
  if (!raw || raw.length > 6000) return [];
  try {
    let rows: unknown;
    try {
      rows = JSON.parse(raw);
    } catch {
      rows = JSON.parse(decodeURIComponent(raw));
    }
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > 5) return [];
    return rows.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new Error("Invalid sector");
      const value = row as Record<string, unknown>;
      const originId = Number(value.originId),
        destinationId = Number(value.destinationId);
      if (
        !Number.isSafeInteger(originId) ||
        originId < 1 ||
        !Number.isSafeInteger(destinationId) ||
        destinationId < 1 ||
        originId === destinationId ||
        typeof value.departureDate !== "string"
      )
        throw new Error("Invalid route");
      const civil = value.departureDate;
      if (
        !isCivilDay(civil) &&
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(civil)
      )
        throw new Error("Invalid day");
      const departureDate = new Date(
        isCivilDay(civil) ? civil + "T00:00:00Z" : civil
      );
      if (
        !Number.isFinite(departureDate.getTime()) ||
        !isCivilDay(civil.slice(0, 10))
      )
        throw new Error("Invalid day");
      return { originId, destinationId, departureDate };
    });
  } catch {
    return [];
  }
}
