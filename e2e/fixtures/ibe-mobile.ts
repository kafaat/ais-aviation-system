import mysql, { type ResultSetHeader } from "mysql2/promise";
import { disposableDatabaseUrl } from "../disposable-database";
import { test, expect } from "./base-test";
import { fixtureFlight, rpc } from "./hardening";

export function registerMobileIbeTests() {
  test.describe("Mobile airline website entry", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
    });

    test("passengers and agents can reach their own entry from the mobile header", async ({
      page,
    }) => {
      await page.goto("/");
      const header = page.getByRole("banner");
      const manage = header.getByRole("link", {
        name: "Manage booking",
        exact: true,
      });
      const agency = header.getByRole("link", {
        name: "Travel agent portal",
        exact: true,
      });
      await expect(manage).toBeInViewport();
      await expect(agency).toBeInViewport();
      await manage.tap();
      await expect(page).toHaveURL(/\/manage-booking$/);
      await expect(
        page.getByLabel("Booking reference", { exact: true })
      ).toBeVisible();
      await page.goBack();
      await agency.tap();
      await expect(page).toHaveURL(/\/login\?returnTo=/);
      expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/agent");
    });

    test("only the listed corporate origin embeds search and a tap opens native AIS results", async ({
      page,
      baseURL,
    }) => {
      const flight = await rpc(page).flights.getById.query({
        id: await fixtureFlight(),
      });
      if (!flight || !baseURL)
        throw new Error("Missing flight fixture or booking origin");
      const embed = new URL("/embed/search", baseURL);
      const parent = (port: number) => `https://127.0.0.1:${port}/corporate`;
      // Intercept only the two corporate documents. AIS serves its real headers,
      // scripts, public API and result page from the separate booking origin.
      for (const port of [4173, 4174]) {
        await page.route(parent(port), route =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Airline</title><iframe title="Find a flight" style="width:100%;height:1050px;border:0" sandbox="allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation" src="${embed.href}"></iframe>`,
          })
        );
      }
      const rejected = page.waitForEvent("console", {
        predicate: message => /frame-ancestors/i.test(message.text()),
      });
      await page.goto(parent(4174));
      await rejected;
      const frame = page.frameLocator('iframe[title="Find a flight"]');
      await expect(frame.locator("form")).toHaveCount(0);

      await page.goto(parent(4173));
      await expect(frame.getByTestId("brand-identity")).toHaveText(
        "Fixture Airways"
      );
      await frame
        .locator('[name="origin"]')
        .selectOption(String(flight.origin.id));
      await frame
        .locator('[name="destination"]')
        .selectOption(String(flight.destination.id));
      const date = flight.departureTime.toISOString().slice(0, 10);
      await frame.locator('[name="date"]').fill(date);
      await frame.locator('[name="currency"]').selectOption("YER");
      await frame.locator('[name="country"]').selectOption("YE");
      await frame.locator('button[type="submit"]').tap();
      await expect(page).toHaveURL(
        url => url.origin === embed.origin && url.pathname === "/search"
      );
      const query = new URL(page.url()).searchParams;
      expect(Object.fromEntries(query)).toMatchObject({
        origin: String(flight.origin.id),
        destination: String(flight.destination.id),
        date,
        currency: "YER",
        country: "YE",
      });
      const card = page
        .getByTestId("flight-card")
        .filter({ hasText: flight.flightNumber });
      await expect(card).toBeVisible();
      await expect(
        card.getByTestId("display-currency-estimate").first()
      ).toContainText("Your invoice and payment are in SAR.");
      await expect(page.getByTestId("brand-identity").first()).toHaveText(
        "Fixture Airways"
      );

      // A synthetic observation is confined to this disposable database.
      // Editing a stale row must not extend the lifetime of the observation.
      const db = await mysql.createConnection(disposableDatabaseUrl());
      let id: number | undefined;
      try {
        const [row] = await db.execute<ResultSetHeader>(
          "INSERT INTO exchange_rates (fromCurrency,toCurrency,rate,source,validFrom) VALUES ('SAR','YER',2,'manual',NOW() - INTERVAL 25 HOUR)"
        );
        id = row.insertId;
        const readRate = () =>
          rpc(page).ibePublic.displayRate.query({ currency: "YER" });
        expect(await readRate()).toBeNull();
        await db.execute(
          "UPDATE exchange_rates SET validFrom=NOW(), source='fallback' WHERE id=?",
          [id]
        );
        expect(await readRate()).toBeNull();
        await db.execute(
          "UPDATE exchange_rates SET source='bank', validTo=NOW() WHERE id=?",
          [id]
        );
        expect(await readRate()).toBeNull();
        await db.execute("UPDATE exchange_rates SET validTo=NULL WHERE id=?", [
          id,
        ]);
        expect(await readRate()).toMatchObject({
          fromCurrency: "SAR",
          toCurrency: "YER",
          source: "bank",
          rate: 2,
        });
        await page.reload();
        await expect(
          card.getByTestId("display-currency-estimate").first()
        ).toContainText(/Approximately.*YER.*payment in SAR/);
      } finally {
        try {
          if (id !== undefined)
            await db.execute("DELETE FROM exchange_rates WHERE id=?", [id]);
        } finally {
          await db.end();
        }
      }
    });
  });
}
