import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../services/stripe-webhook-v2.service.ts", import.meta.url),
  "utf8"
);

describe("Stripe webhook v2 legacy-salvage boundaries", () => {
  it("does not expose provider signature error details", () => {
    expect(source).toContain(
      'throw new Error("Signature verification failed");'
    );
    expect(source).not.toContain(
      "Signature verification failed: ${err.message}"
    );
  });
});
