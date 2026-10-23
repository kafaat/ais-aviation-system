import superjson from "superjson";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { fixtureFlight, sqlRows } from "./hardening";

/** Exercises the app/provider handoff, never a real provider or card authorization. */
export function registerProviderCheckoutTests() {
  test.describe("Payment Processing (synthetic provider handoff)", () => {
    for (const outcome of ["redirect", "failure", "missing-url"] as const) {
      test(`checkout ${outcome} does not mark an unpaid invoice paid`, async ({
        page,
      }) => {
        await page.addInitScript(() =>
          localStorage.setItem("i18nextLng", "en")
        );
        await useBrowserSession(page, "regular");
        const flightId = await fixtureFlight();
        const providerUrl = "https://checkout.example.test/session/synthetic";
        await page.route(providerUrl, route =>
          route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><h1>Synthetic provider checkout</h1>",
          })
        );
        let received: { bookingId: number; provider: string } | undefined;
        await page.route(
          "**/api/trpc/*payments.createCheckoutSession*",
          async route => {
            const batch =
              new URL(route.request().url()).searchParams.get("batch") === "1";
            const payload = route.request().postDataJSON() as Record<
              string,
              unknown
            >;
            const serialized = (batch ? payload["0"] : payload) as Parameters<
              typeof superjson.deserialize
            >[0];
            received = superjson.deserialize<{
              bookingId: number;
              provider: string;
            }>(serialized);
            const response =
              outcome === "failure"
                ? {
                    error: superjson.serialize({
                      message: "Synthetic provider unavailable",
                      code: -32603,
                      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 },
                    }),
                  }
                : {
                    result: {
                      data: superjson.serialize({
                        url: outcome === "redirect" ? providerUrl : null,
                      }),
                    },
                  };
            await route.fulfill({
              status: outcome === "failure" ? 503 : 200,
              contentType: "application/json",
              body: JSON.stringify(batch ? [response] : response),
            });
          }
        );
        await page.goto(`/booking/${flightId}`);
        await page.locator("#pax-firstname-0").fill("Synthetic");
        await page.locator("#pax-lastname-0").fill("Handoff");
        // Blank passport remains optional; no hosted card input is fabricated in-app.
        await page
          .getByRole("button", { name: "Refresh fare offer", exact: true })
          .click();
        const submit = page.getByRole("button", {
          name: "Complete Booking & Payment",
          exact: true,
        });
        await expect(submit).toBeEnabled();
        await submit.click();
        if (outcome === "redirect") {
          await expect(page).toHaveURL(providerUrl);
          await expect(
            page.getByRole("heading", { name: "Synthetic provider checkout" })
          ).toBeVisible();
        } else {
          await expect(
            page.locator("[data-sonner-toast]").filter({
              hasText:
                outcome === "failure"
                  ? "Synthetic provider unavailable"
                  : "An error occurred",
            })
          ).toBeVisible();
          await expect(page).toHaveURL(
            new RegExp(`/booking/${flightId}(?:\\?|$)`)
          );
        }
        expect(received).toEqual({
          bookingId: expect.any(Number),
          provider: "stripe",
        });
        if (!received)
          throw new Error("Synthetic provider boundary was not reached");
        const invoices = await sqlRows<RowDataPacket>(
          "SELECT id, paymentStatus, seatsReserved FROM bookings WHERE flightId=?",
          [flightId]
        );
        expect(invoices).toHaveLength(1);
        expect(invoices[0].id).toBe(received.bookingId);
        expect(invoices[0].paymentStatus).toBe("pending");
        expect(invoices[0].seatsReserved).toBe(0);
        expect(
          await sqlRows<RowDataPacket>(
            "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
            [received.bookingId]
          )
        ).toHaveLength(0);
        const [flight] = await sqlRows<RowDataPacket>(
          "SELECT economyAvailable FROM flights WHERE id=?",
          [flightId]
        );
        expect(flight.economyAvailable).toBe(10);
      });
    }
  });
}
