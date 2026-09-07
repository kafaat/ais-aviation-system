import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-wiring checks complement the executable router tests. These are not
// browser E2E or evidence that a real payment provider has settled a charge.
const source = readFileSync(
  new URL("../../client/src/pages/BookingPage.tsx", import.meta.url),
  "utf8"
);

describe("booking checkout source contract", () => {
  it("uses the provider checkout mutation, never the legacy payment API", () => {
    expect(source).toContain("trpc.payments.createCheckoutSession.useMutation");
    expect(source).not.toContain("trpc.payments.create.useMutation");
  });

  it("requests checkout by booking identity without a client-supplied amount", () => {
    expect(source).toMatch(
      /createCheckout\.mutateAsync\(\{\s*bookingId: booking\.bookingId,\s*provider: "stripe",?\s*\}\)/
    );
  });

  it("redirects to checkout instead of announcing premature payment success", () => {
    expect(source).toContain("window.location.assign(checkout.url)");
    expect(source).toContain("if (!checkout.url)");
    expect(source).not.toContain('toast.success(t("common.success"))');
  });
});
