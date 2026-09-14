import assert from "node:assert/strict";
import { createHotelbedsProvider } from "../../server/integrations/hotelbeds";
import type { HotelRequest } from "../../shared/hotel-fulfillment";

const base = new URL(process.argv[2] ?? "http://invalid");
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(base.hostname))
  throw new Error("Microcks fixture target must be loopback");
let fixture = "quote";
const provider = createHotelbedsProvider(
  {
    apiKey: "synthetic-fixture",
    secret: "synthetic-fixture",
    account: "fixture-account",
    mode: "sandbox",
  },
  (url, init) => {
    const source = new URL(String(url));
    assert.equal(source.hostname, "api.test.hotelbeds.com");
    return fetch(`${base.href}${source.pathname}${source.search}`, {
      ...init,
      headers: { ...init?.headers, "x-fixture-case": fixture },
    });
  }
);
const quote = await provider.quote("synthetic-rate-key");
assert.equal(quote.totalCost, 12000);
const request: HotelRequest = {
  quote,
  quoteId: "11111111-1111-4111-8111-111111111111",
  mappingEvidence: "Synthetic fixture only",
  quotedBy: 1,
  approvedBy: 1,
  approvedAt: new Date().toISOString(),
  holder: { name: "Synthetic", surname: "Fixture" },
  maxCancellationCost: 0,
};
fixture = "confirmed";
assert.equal(
  (await provider.book(request, "HLOCALFIXTURE")).status,
  "CONFIRMED"
);
assert.equal(
  (await provider.lookup(request, "HLOCALFIXTURE"))?.reference,
  "123-456"
);
fixture = "wrong-identity";
await assert.rejects(
  provider.book(request, "HLOCALFIXTURE"),
  /identity mismatch/
);
fixture = "foreign-currency";
await assert.rejects(provider.quote("synthetic-rate-key"));
fixture = "simulation";
assert.equal(
  (await provider.cancel(request, "HLOCALFIXTURE", "123-456", true)).status,
  "CONFIRMED"
);
fixture = "cancelled";
assert.equal(
  (await provider.cancel(request, "HLOCALFIXTURE", "123-456", false)).status,
  "CANCELLED"
);
console.info(
  "Microcks: quote, booking, lookup, simulation, cancellation and two negative boundaries passed; provider calls=0"
);
