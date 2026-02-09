import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ENV before importing dataApi
vi.mock("../../_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://api.example.com/",
    forgeApiKey: "test-api-key",
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { isApiWhitelisted, callDataApi } from "../../_core/dataApi";

describe("Data API Whitelist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isApiWhitelisted", () => {
    it("should allow whitelisted flight data APIs", () => {
      expect(isApiWhitelisted("FlightAware/search")).toBe(true);
      expect(isApiWhitelisted("FlightAware/status")).toBe(true);
      expect(isApiWhitelisted("FlightAware/track")).toBe(true);
    });

    it("should allow whitelisted aviation stack APIs", () => {
      expect(isApiWhitelisted("AviationStack/flights")).toBe(true);
      expect(isApiWhitelisted("AviationStack/airlines")).toBe(true);
      expect(isApiWhitelisted("AviationStack/airports")).toBe(true);
    });

    it("should allow whitelisted weather APIs", () => {
      expect(isApiWhitelisted("OpenWeather/current")).toBe(true);
      expect(isApiWhitelisted("OpenWeather/forecast")).toBe(true);
    });

    it("should allow whitelisted currency APIs", () => {
      expect(isApiWhitelisted("ExchangeRate/convert")).toBe(true);
      expect(isApiWhitelisted("ExchangeRate/latest")).toBe(true);
    });

    it("should allow whitelisted country APIs", () => {
      expect(isApiWhitelisted("RestCountries/info")).toBe(true);
    });

    it("should allow whitelisted search APIs", () => {
      expect(isApiWhitelisted("Youtube/search")).toBe(true);
    });

    it("should reject non-whitelisted APIs", () => {
      expect(isApiWhitelisted("MaliciousApi/steal-data")).toBe(false);
      expect(isApiWhitelisted("Unknown/endpoint")).toBe(false);
      expect(isApiWhitelisted("")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(isApiWhitelisted("flightaware/search")).toBe(false);
      expect(isApiWhitelisted("FLIGHTAWARE/SEARCH")).toBe(false);
      expect(isApiWhitelisted("FlightAware/Search")).toBe(false);
    });

    it("should reject partial matches", () => {
      expect(isApiWhitelisted("FlightAware")).toBe(false);
      expect(isApiWhitelisted("search")).toBe(false);
      expect(isApiWhitelisted("FlightAware/search/extra")).toBe(false);
    });
  });

  describe("callDataApi - whitelist enforcement", () => {
    it("should reject non-whitelisted API calls", async () => {
      await expect(
        callDataApi("MaliciousApi/steal-data", {
          query: { target: "users" },
        })
      ).rejects.toThrow("not whitelisted");
    });

    it("should include API ID in error message for non-whitelisted calls", async () => {
      await expect(callDataApi("Dangerous/endpoint")).rejects.toThrow(
        'Data API "Dangerous/endpoint" is not whitelisted'
      );
    });

    it("should proceed with whitelisted API calls", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: "result" }),
      });

      const result = await callDataApi("Youtube/search", {
        query: { q: "test" },
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(result).toEqual({ data: "result" });
    });

    it("should throw for empty API ID before whitelist check", async () => {
      await expect(callDataApi("")).rejects.toThrow(
        "callDataApi requires a non-empty apiId"
      );
    });

    it("should throw for whitespace-only API ID", async () => {
      await expect(callDataApi("   ")).rejects.toThrow(
        "callDataApi requires a non-empty apiId"
      );
    });
  });

  describe("callDataApi - request format", () => {
    it("should send correct request format for whitelisted API", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      await callDataApi("FlightAware/search", {
        query: { flight: "SV123" },
        body: { extra: "data" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("webdevtoken.v1.WebDevService/CallApi"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            authorization: "Bearer test-api-key",
          }),
        })
      );

      // Verify body contains the API ID and options
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.apiId).toBe("FlightAware/search");
      expect(body.query).toEqual({ flight: "SV123" });
      expect(body.body).toEqual({ extra: "data" });
    });

    it("should handle jsonData response format", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            jsonData: JSON.stringify({ flights: [{ id: 1 }] }),
          }),
      });

      const result = await callDataApi("AviationStack/flights");
      expect(result).toEqual({ flights: [{ id: 1 }] });
    });

    it("should handle non-ok response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("Server error"),
      });

      await expect(callDataApi("Youtube/search")).rejects.toThrow(
        "Data API request failed (500 Internal Server Error)"
      );
    });
  });
});
