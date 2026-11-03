import { searchPreferences, type SearchPreferences } from "@shared/ibe-search";

const KEY = "ais_display_preferences";

/** Only non-personal display settings survive provider redirects. */
export function rememberDisplayPreferences(value: SearchPreferences): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ currency: value.currency, country: value.country })
    );
  } catch {
    /* Display remains usable when storage is unavailable. */
  }
}

export function readSearchPreferences(search: string): SearchPreferences {
  const query = new URLSearchParams(search);
  const nested = new URLSearchParams(query.get("search") ?? "");
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    for (const key of ["currency", "country"] as const) {
      if (
        !query.has(key) &&
        !nested.has(key) &&
        typeof saved?.[key] === "string"
      )
        query.set(key, saved[key]);
    }
  } catch {
    /* Invalid stored settings fall back to validated defaults. */
  }
  return searchPreferences(query.toString());
}
