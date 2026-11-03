import { afterEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { ibePublicRouter } from "./ibe-public";
import {
  parseEmbedOrigins,
  publicIbeConfiguration,
} from "../services/ibe-public-config.service";

vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
vi.mock("../db", () => ({ getDb: () => null }));
afterEach(() => vi.unstubAllEnvs());

it("defaults to a neutral identity with external embedding disabled", () => {
  expect(publicIbeConfiguration({})).toEqual({
    brandName: "AIS",
    logoPath: null,
    embedSearchEnabled: false,
  });
});

it("accepts explicit HTTPS origins and canonicalizes duplicates", () => {
  expect(
    parseEmbedOrigins(
      "https://www.airline.example/, https://www.airline.example:443,https://airline.example:8443"
    )
  ).toEqual(["https://www.airline.example", "https://airline.example:8443"]);
});

it.each([
  "*",
  "'self'",
  "https:",
  "https:airline.example",
  "https:/airline.example",
  "https:///airline.example",
  "http://airline.example",
  "//airline.example",
  "https://*.airline.example",
  "https://user:password@airline.example",
  "https://@airline.example",
  "https://airline.example/path",
  "https://airline.example?x=1",
  "https://airline.example#fragment",
  "https://airline.example?",
  "https://airline.example\\@evil.example",
  "https://airline.example%0a",
  "https://airline.example\r\n",
  "https://airline.example;script-src",
  "https://airline.example'",
  "https://airline.example,,https://other.example",
  "https://valid.example,https://*.invalid.example",
])(
  "rejects an invalid origin list without granting a partial allowlist: %s",
  value => {
    expect(() => parseEmbedOrigins(value)).toThrow();
  }
);

it.each([
  "https://images.example/logo.svg",
  "//evil.example/logo.svg",
  "/%2f/evil.svg",
  "/brand/../logo.svg",
  "/brand/logo.svg?tenant=2",
  "/brand/logo.svg#fragment",
  "/brand\\logo.svg",
  "/brand/logo.html",
  "/brand/%2e%2e/logo.svg",
])("rejects an external or ambiguous logo path: %s", logo => {
  expect(() => publicIbeConfiguration({ IBE_BRAND_LOGO_PATH: logo })).toThrow(
    "same-origin image asset path"
  );
});

it("exposes only operator branding to an anonymous caller and ignores request tenant/brand selectors", async () => {
  vi.stubEnv("IBE_BRAND_NAME", "Example Airline");
  vi.stubEnv("IBE_BRAND_LOGO_PATH", "/branding/airline.svg");
  vi.stubEnv("IBE_EMBED_ALLOWED_ORIGINS", "https://www.airline.example");
  const context = {
    user: null,
    authMethod: null,
    tenantId: null,
    req: {
      ip: "198.51.100.23",
      method: "GET",
      headers: {},
      query: { tenantId: 999, brandName: "Untrusted" },
    },
    res: { setHeader: vi.fn() },
  } as unknown as TrpcContext;
  const result = await ibePublicRouter.createCaller(context).config();
  expect(result).toEqual({
    brandName: "Example Airline",
    logoPath: "/branding/airline.svg",
    embedSearchEnabled: true,
  });
  expect(JSON.stringify(result)).not.toContain("www.airline.example");
  expect(context.tenantId).toBeNull();
});
