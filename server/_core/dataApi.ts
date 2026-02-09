/**
 * Quick example (matches curl usage):
 *   await callDataApi("Youtube/search", {
 *     query: { gl: "US", hl: "en", q: "manus" },
 *   })
 */
import { ENV } from "./env";

/** Timeout for Data API calls */
const DATA_API_TIMEOUT_MS = 30_000;

/**
 * Whitelist of allowed Data API IDs.
 * Only APIs in this list can be called through callDataApi.
 * Add new API IDs here when integrating new external services.
 */
const DATA_API_WHITELIST = new Set<string>([
  // Flight data providers
  "FlightAware/search",
  "FlightAware/status",
  "FlightAware/track",
  "AviationStack/flights",
  "AviationStack/airlines",
  "AviationStack/airports",
  // Weather data for flight operations
  "OpenWeather/current",
  "OpenWeather/forecast",
  // Currency conversion for multi-currency support
  "ExchangeRate/convert",
  "ExchangeRate/latest",
  // Country/timezone data
  "RestCountries/info",
  // Search / general
  "Youtube/search",
]);

/**
 * Check if an API ID is whitelisted for use
 */
export function isApiWhitelisted(apiId: string): boolean {
  return DATA_API_WHITELIST.has(apiId);
}

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  options: DataApiCallOptions = {}
): Promise<unknown> {
  if (!ENV.forgeApiUrl) {
    throw new Error("BUILT_IN_FORGE_API_URL is not configured");
  }
  if (!ENV.forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
  }

  if (!apiId || apiId.trim().length === 0) {
    throw new Error("callDataApi requires a non-empty apiId");
  }

  // Enforce API whitelist for security
  if (!isApiWhitelisted(apiId)) {
    throw new Error(
      `Data API "${apiId}" is not whitelisted. Add it to DATA_API_WHITELIST in dataApi.ts to allow access.`
    );
  }

  // Build the full URL by appending the service path to the base URL
  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL(
    "webdevtoken.v1.WebDevService/CallApi",
    baseUrl
  ).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify({
      apiId,
      query: options.query,
      body: options.body,
      path_params: options.pathParams,
      multipart_form_data: options.formData,
    }),
    signal: AbortSignal.timeout(DATA_API_TIMEOUT_MS),
  });

  if (!response.ok) {
    const _detail = await response.text().catch(() => "");
    throw new Error(
      `Data API request failed (${response.status} ${response.statusText})`
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (payload && typeof payload === "object" && "jsonData" in payload) {
    try {
      return JSON.parse((payload as Record<string, string>).jsonData ?? "{}");
    } catch {
      return (payload as Record<string, unknown>).jsonData;
    }
  }
  return payload;
}
