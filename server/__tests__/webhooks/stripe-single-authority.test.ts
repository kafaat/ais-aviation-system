import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("Stripe webhook single-authority boundary", () => {
  it("uses the canonical processor for both retry workers", () => {
    for (const path of [
      "server/services/queue.service.ts",
      "server/services/queue-v2.service.ts",
    ]) {
      const source = read(path);
      expect(source).toContain("processStripeEvent");
      expect(source).not.toContain("stripeWebhookServiceV2");
      expect(source).not.toContain("stripe-webhook-v2.service");
    }
  });

  it("keeps the compatibility route on the canonical HTTP handler", () => {
    const source = read("server/routes/webhooks.ts");
    expect(source).toContain("handleStripeWebhook");
    expect(source).not.toContain("stripeWebhookServiceV2");
  });

  it("exports one canonical transactional event processor", () => {
    const source = read("server/webhooks/stripe.ts");
    expect(source).toContain("export async function processStripeEvent");
    expect(source).toContain("await processStripeEvent(tx, event)");
  });

  it("removes the divergent v2 financial state machine", () => {
    expect(
      existsSync(new URL("server/services/stripe-webhook-v2.service.ts", root))
    ).toBe(false);
  });
});
