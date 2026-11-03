import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source-wiring checks complement CheckoutResume.test.tsx and
// booking-checkout-boundary.test.ts. Those exercise request identity, ownership,
// retries and frozen claims; none is evidence of a real provider settlement.
const bookingSource = readFileSync(
  new URL("../../client/src/pages/BookingPage.tsx", import.meta.url),
  "utf8"
);
const checkoutSource = readFileSync(
  new URL("../../client/src/pages/CheckoutResume.tsx", import.meta.url),
  "utf8"
);

describe("booking checkout source contract", () => {
  it("hands new bookings to invoice review before starting provider checkout", () => {
    expect(bookingSource).toContain("trpc.bookings.create.useMutation");
    // Both the card and wallet/split entry paths must retain the created identity.
    expect(
      bookingSource.match(
        /navigate\(\s*`\/checkout\/\$\{booking\.bookingId\}\?/g
      )
    ).toHaveLength(2);
    expect(bookingSource).not.toContain(
      "trpc.payments.createCheckoutSession.useMutation"
    );
    expect(checkoutSource).toContain("trpc.payments.getCheckoutState.useQuery");
    expect(checkoutSource).toContain(
      "trpc.payments.createCheckoutSession.useMutation"
    );
    for (const source of [bookingSource, checkoutSource]) {
      expect(source).not.toContain("trpc.payments.create.useMutation");
    }
  });

  it("resumes checkout by booking identity without creating a booking or supplying an amount", () => {
    expect(checkoutSource).not.toContain("trpc.bookings.create");
    // Match the whole checkout payload, so an amount, currency or spread cannot
    // enter this command. Voucher review has a separate authoritative mutation.
    expect(checkoutSource).toMatch(
      /checkout\.mutateAsync\(\{\s*bookingId,\s*provider: "stripe",?\s*\}\)/
    );
    expect(checkoutSource.match(/checkout\.mutateAsync\(/g)).toHaveLength(1);
  });

  it("redirects to checkout instead of announcing premature payment success", () => {
    expect(checkoutSource).toMatch(
      /if \(!session\.url\) throw new Error\([^;]+;\s*window\.location\.assign\(session\.url\)/
    );
    for (const source of [bookingSource, checkoutSource]) {
      expect(source).not.toContain('toast.success(t("common.success"))');
    }
  });
});
