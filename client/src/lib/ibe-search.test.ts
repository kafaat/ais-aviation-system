import { describe, expect, it, vi } from "vitest";
import {
  readSearchPreferences,
  rememberDisplayPreferences,
} from "./ibe-display-context";
import {
  adjacentSearch,
  parseMultiCitySearch,
  isCivilDay,
  searchPreferences,
  travelerTypes,
} from "@shared/ibe-search";
import { displayEstimate } from "./display-money";

describe("public search context and price display", () => {
  it("preserves the traveler mix and market display through a nested booking link", () => {
    const original = new URLSearchParams({
      adults: "2",
      children: "1",
      infants: "1",
      currency: "KWD",
      country: "KW",
    });
    const booking = new URLSearchParams({
      class: "business",
      search: original.toString(),
    });
    const value = searchPreferences(booking.toString());
    expect(travelerTypes(value)).toEqual(["adult", "adult", "child", "infant"]);
    expect(value).toMatchObject({ currency: "KWD", country: "KW" });
  });
  it.each([
    "adults=99",
    "adults=0&children=2",
    "adults=2&children=8",
    "adults=1e3",
    "adults=-1",
  ])("bounds malformed traveler input: %s", query => {
    expect(travelerTypes(searchPreferences(query))).toEqual(["adult"]);
  });
  it("rejects unsupported currency and region preferences without changing invoice inputs", () => {
    expect(searchPreferences("currency=XXX&country=XX")).toMatchObject({
      currency: "SAR",
      country: "SA",
    });
  });
  it("moves a civil day across year/leap boundaries without dropping search context", () => {
    const next = adjacentSearch(
      "origin=1&destination=2&date=2028-02-28&adults=2&currency=KWD",
      1
    )!;
    expect(new URL(next, "https://ais.test").searchParams.get("date")).toBe(
      "2028-02-29"
    );
    expect(new URL(next, "https://ais.test").searchParams.get("adults")).toBe(
      "2"
    );
    expect(adjacentSearch("date=2027-01-01", -1)).toContain("date=2026-12-31");
    expect(isCivilDay("2027-02-30")).toBe(false);
    expect(adjacentSearch("date=2027-02-30", 1)).toBeNull();
  });
  it("accepts return sectors in current and legacy links, rejecting impossible dates", () => {
    const rows = [
      { originId: "1", destinationId: "2", departureDate: "2027-01-15" },
      { originId: "2", destinationId: "1", departureDate: "2027-01-20" },
    ];
    for (const segments of [
      JSON.stringify(rows),
      encodeURIComponent(JSON.stringify(rows)),
    ]) {
      const result = parseMultiCitySearch(
        new URLSearchParams({ segments }).toString()
      );
      expect(result).toHaveLength(2);
      expect(result[1]).toMatchObject({ originId: 2, destinationId: 1 });
      expect(result[1].departureDate.toISOString()).toBe(
        "2027-01-20T00:00:00.000Z"
      );
    }
    rows[1].departureDate = "2027-02-30";
    expect(
      parseMultiCitySearch(
        new URLSearchParams({ segments: JSON.stringify(rows) }).toString()
      )
    ).toEqual([]);
  });
  it("retains only currency and region across a provider return, never passenger details", () => {
    rememberDisplayPreferences({
      adults: 2,
      children: 1,
      infants: 0,
      currency: "KWD",
      country: "KW",
    });
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      "ais_display_preferences",
      JSON.stringify({ currency: "KWD", country: "KW" })
    );
    vi.mocked(localStorage.getItem).mockReturnValueOnce(
      JSON.stringify({
        currency: "KWD",
        country: "KW",
        adults: 9,
        surname: "Must not persist",
      })
    );
    expect(readSearchPreferences("canceled=true")).toEqual({
      adults: 1,
      children: 0,
      infants: 0,
      currency: "KWD",
      country: "KW",
    });
    vi.mocked(localStorage.getItem).mockReturnValueOnce(
      JSON.stringify({ currency: "KWD", country: "KW" })
    );
    expect(readSearchPreferences("currency=EUR&country=DE")).toMatchObject({
      currency: "EUR",
      country: "DE",
    });
  });
  const now = Date.parse("2026-11-03T12:00:00Z");
  const rate = {
    fromCurrency: "SAR",
    toCurrency: "KWD",
    rate: 0.082,
    source: "bank",
    updatedAt: new Date(now),
    expiresAt: new Date(now + 60_000),
  };
  it("accepts Yemen display preferences and requires an eligible SAR/YER quote", () => {
    expect(searchPreferences("currency=yer&country=ye")).toMatchObject({
      country: "YE",
      currency: "YER",
    });
    expect(displayEstimate(100, "YER", null, now)).toBeNull();
    expect(
      displayEstimate(
        100,
        "YER",
        { ...rate, toCurrency: "YER", rate: 2, source: "manual" },
        now
      )
    ).toBe(2);
  });
  it("converts SAR minor units to major units and respects three-decimal display currencies", () => {
    const result = displayEstimate(12345, "KWD", rate, now);
    expect(result).toBeCloseTo(10.1229);
    expect(
      new Intl.NumberFormat("en-KW", {
        style: "currency",
        currency: "KWD",
      }).format(result!)
    ).toContain("10.123");
  });
  it.each([
    { source: "fallback" },
    { source: "cross_rate" },
    { source: "unknown" },
    { expiresAt: new Date(now) },
    { expiresAt: "invalid" },
    { fromCurrency: "USD" },
    { rate: NaN },
    { rate: -1 },
    { toCurrency: "USD" },
    { updatedAt: new Date(now - 25 * 60 * 60 * 1000) },
    { updatedAt: new Date(now + 10 * 60 * 1000) },
  ])(
    "does not present an unverified or stale rate as a current estimate: %j",
    patch => {
      expect(
        displayEstimate(12345, "KWD", { ...rate, ...patch }, now)
      ).toBeNull();
    }
  );
});
