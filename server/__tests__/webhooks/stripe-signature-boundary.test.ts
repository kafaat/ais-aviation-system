import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../webhooks/stripe.ts", import.meta.url),
  "utf8"
);

describe("Stripe canonical signature boundary", () => {
  it("keeps provider details in logs but not in the HTTP error", () => {
    expect(source).toContain('error: "Signature verification failed"');
    expect(source).toContain("error: errMessage");
    expect(source).not.toContain(
      "error: `Signature verification failed: ${errMessage}`"
    );
  });
});
