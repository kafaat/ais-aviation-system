import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-wiring checks complement the executable router tests. These are not
// browser E2E or evidence that a real payment provider has settled a charge.
const bookingPage = readFileSync(
  new URL("../../client/src/pages/BookingPage.tsx", import.meta.url),
  "utf8"
);

const invoicePage = readFileSync(
  new URL("../../client/src/pages/CheckoutResume.tsx", import.meta.url),
  "utf8"
);

describe("booking checkout source contract", () => {
  it("uses the provider checkout mutation, never the legacy payment API", () => {
    expect(bookingPage).toContain("/checkout/${booking.bookingId}");
    expect(bookingPage).not.toContain("trpc.payments.create.useMutation");
    expect(invoicePage).toContain(
      "trpc.payments.createCheckoutSession.useMutation"
    );
    expect(invoicePage).not.toContain("trpc.payments.create.useMutation");
  });

  it("requests checkout by booking identity without a client-supplied amount", () => {
    expect(invoicePage).toMatch(
      /checkout\.mutateAsync\(\{\s*bookingId,\s*provider: "stripe",?\s*\}\)/
    );
  });

  it("redirects to checkout instead of announcing premature payment success", () => {
    expect(invoicePage).toContain("window.location.assign(session.url)");
    expect(invoicePage).toContain("if (!session.url)");
    expect(invoicePage).not.toContain('toast.success(t("common.success"))');
  });
});
