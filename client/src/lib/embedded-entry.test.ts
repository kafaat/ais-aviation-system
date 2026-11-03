import { expect, it } from "vitest";
import { isEmbeddedSearchDocument } from "./embedded-entry";

it.each([
  "/embed/search",
  "/%65mbed/search",
  "/embed%2Fsearch",
  "/%2565mbed%252Fsearch",
  "//embed/search",
  "/embed//search/",
  "/./embed/search",
  "/account/../embed/search",
  "/account/%2e%2e/embed/search",
  "/embed/./search",
  "/embed/foo/../search",
  "/embed\\search",
  "/embed%5csearch",
  "/EMBED/SEARCH",
  "/embed/search%3fignored=value",
])("isolates any normalization of the public embed document: %s", path => {
  expect(isEmbeddedSearchDocument(path)).toBe(true);
});

it.each([
  "/",
  "/search",
  "/login",
  "/my-bookings",
  "/booking/42",
  "/checkout/700",
  "/embed/search/../my-bookings",
  "/embed/search%2f..%2fmy-bookings",
  "/embed/search-other",
  "/search?returnTo=/embed/search",
])("keeps ordinary application documents on their existing entry: %s", path => {
  expect(isEmbeddedSearchDocument(path)).toBe(false);
});

it("does not select account UI for ambiguously deep percent encoding", () => {
  const path = "/" + "%" + "25".repeat(9) + "65mbed/search";
  expect(isEmbeddedSearchDocument(path)).toBe(true);
});
