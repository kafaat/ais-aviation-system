import { configuredHotelProvider } from "../integrations/hotelbeds";
import { configuredWeatherSource } from "../integrations/aviation-weather";
import { configuredOnCallProvider } from "../integrations/on-call";

export const INTEGRATION_CONFIG_KEYS = [
  "HOTELBEDS_MODE",
  "HOTELBEDS_API_KEY",
  "HOTELBEDS_SECRET",
  "HOTELBEDS_ACCEPTANCE_REFERENCE",
  "AVIATION_WEATHER_MODE",
  "AVIATION_WEATHER_BASE_URL",
  "AVIATION_WEATHER_SOURCE_REFERENCE",
  "ONCALL_MODE",
  "ONCALL_BASE_URL",
  "ONCALL_TOKEN",
  "ONCALL_ACCEPTANCE_REFERENCE",
] as const;

/** Constructs adapters without making provider calls. Reports configuration
 * readiness only; it does not assert provider acceptance or connectivity. */
export function integrationConfiguration() {
  return [
    { id: "hotelbeds", configure: configuredHotelProvider },
    { id: "weather", configure: configuredWeatherSource },
    { id: "oncall", configure: configuredOnCallProvider },
  ].map(({ id, configure }) => {
    try {
      const adapter = configure();
      return {
        id,
        state: adapter ? ("configured" as const) : ("disabled" as const),
        reason: adapter ? null : "No provider enabled",
      };
    } catch {
      // Do not serialize exception text: malformed URLs may contain credentials.
      return {
        id,
        state: "invalid" as const,
        reason: "Provider configuration or acceptance reference is incomplete",
      };
    }
  });
}
export function assertIntegrationConfiguration() {
  const result = integrationConfiguration();
  const invalid = result.filter(row => row.state === "invalid");
  if (invalid.length)
    throw new Error(
      `Invalid integration configuration: ${invalid.map(row => row.id).join(", ")}`
    );
  return result;
}
