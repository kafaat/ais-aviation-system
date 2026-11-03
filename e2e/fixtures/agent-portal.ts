import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./base-test";
import { useBrowserSession } from "./browser-session";
import { fixtureFlight, rpc, sqlRows } from "./hardening";
import {
  civilDateInZone,
  fallbackAirportTimeZone,
  isValidTimeZone,
} from "../../server/services/civil-day";

// Admin registration returns one-time API credentials. Pin these worker
// fixtures for this test type only, without disabling other journeys' traces.
const portalTest = test.extend({
  trace: "off",
  video: "off",
  screenshot: "off",
});

/** Real browser/session + disposable MySQL acceptance; no provider charge. */
export function registerAgentPortalTests() {
  portalTest.describe("Session travel agent portal", () => {
    portalTest(
      "a linked owner books once through the portal and reviews their pending invoice",
      async ({ page, browser, trace, video, screenshot }) => {
        // Fail before registration if a containing suite overrides artifact policy.
        expect({ trace, video, screenshot }).toEqual({
          trace: "off",
          video: "off",
          screenshot: "off",
        });
        await page.addInitScript(() =>
          localStorage.setItem("i18nextLng", "en")
        );
        await useBrowserSession(page, "regular");
        const client = rpc(page);
        const owner = await client.auth.me.query();
        if (!owner) throw new Error("Missing synthetic agency owner session");

        await useBrowserSession(page, "admin");
        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        // Retain only the identifier, never credentials or the whole response.
        const agencyId = (
          await client.travelAgent.register.mutate({
            ownerUserId: owner.id,
            agencyName: `Portal fixture ${suffix}`,
            iataNumber: `P${suffix}`,
            contactName: "Synthetic Agent",
            email: `portal-${suffix}@example.test`,
            phone: "+966500000000",
          })
        ).agent.id;

        const flightId = await fixtureFlight();
        // Change only this new flight. A separate search day avoids competing
        // fixture inventory and the portal's 100-candidate daily search bound.
        await sqlRows<RowDataPacket>(
          "UPDATE flights f JOIN users u ON u.id=? SET f.tenantId=u.tenantId, f.departureTime=DATE_ADD(f.departureTime, INTERVAL 14 DAY), f.arrivalTime=DATE_ADD(f.arrivalTime, INTERVAL 14 DAY) WHERE f.id=?",
          [owner.id, flightId]
        );
        const flight = await client.flights.getById.query({ id: flightId });
        if (!flight) throw new Error("Missing agent portal flight fixture");
        const zone = isValidTimeZone(flight.origin.timezone)
          ? flight.origin.timezone
          : fallbackAirportTimeZone();

        const outsider = await browser.newPage();
        try {
          const foreign = rpc(outsider);
          await expect(
            foreign.agentPortal.agencies.query()
          ).rejects.toMatchObject({
            data: { code: "UNAUTHORIZED" },
          });
          await useBrowserSession(outsider, "admin");
          await expect(
            foreign.agentPortal.dashboard.query({ agencyId, page: 1 })
          ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
        } finally {
          await outsider.close();
        }

        await useBrowserSession(page, "regular");
        await page.goto("/agent");
        await expect(
          page.getByRole("heading", {
            name: "Travel agent portal",
            exact: true,
          })
        ).toBeVisible();
        await page
          .getByLabel("Agency", { exact: true })
          .selectOption(String(agencyId));
        await page
          .getByLabel("From (airport code)", { exact: true })
          .fill(flight.origin.code);
        await page
          .getByLabel("To (airport code)", { exact: true })
          .fill(flight.destination.code);
        await page
          .getByLabel("Departure date", { exact: true })
          .fill(civilDateInZone(flight.departureTime, zone));
        await page.getByLabel("Cabin", { exact: true }).selectOption("economy");
        await page.getByLabel("Passengers", { exact: true }).selectOption("1");
        await page
          .getByRole("button", { name: "Search flights", exact: true })
          .click();
        await page
          .locator(".rounded-md.border")
          .filter({ hasText: flight.flightNumber })
          .getByRole("button", { name: "Select flight", exact: true })
          .click();
        await page.getByLabel("First name", { exact: true }).fill("Portal");
        await page.getByLabel("Surname", { exact: true }).fill("Synthetic");
        await page
          .getByLabel("Agency reference (optional)", { exact: true })
          .fill(suffix);
        await page
          .getByRole("button", {
            name: "Create reservation and continue",
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/\/checkout\/\d+(?:\?|$)/);
        const bookingId = Number(new URL(page.url()).pathname.split("/").pop());
        await expect(
          page.getByRole("heading", { name: "Booking payment", exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Payment pending", exact: true })
        ).toBeVisible();

        const rows = await sqlRows<RowDataPacket>(
          "SELECT b.id, b.userId, b.tenantId AS bookingTenantId, b.bookingReference, b.status, b.paymentStatus, b.totalAmount, a.ownerUserId, u.tenantId AS ownerTenantId, ab.externalReference, ab.bookingAmount FROM bookings b JOIN agent_bookings ab ON ab.bookingId=b.id JOIN travel_agents a ON a.id=ab.agentId JOIN users u ON u.id=a.ownerUserId WHERE ab.agentId=? AND b.flightId=?",
          [agencyId, flightId]
        );
        expect(rows).toHaveLength(1);
        const invoice = rows[0];
        expect(invoice.id).toBe(bookingId);
        expect(invoice.userId).toBe(owner.id);
        expect(invoice.ownerUserId).toBe(owner.id);
        expect(invoice.bookingTenantId).toBe(invoice.ownerTenantId);
        expect(invoice.status).toBe("pending");
        expect(invoice.paymentStatus).toBe("pending");
        expect(invoice.externalReference).toBe(suffix);
        expect(Number(invoice.totalAmount)).toBeGreaterThan(0);
        expect(invoice.bookingAmount).toBe(invoice.totalAmount);
        await expect(
          page.getByText(invoice.bookingReference, { exact: true })
        ).toBeVisible();
        await expect(page.getByTestId("checkout-total")).toContainText(
          new Intl.NumberFormat("en", {
            style: "currency",
            currency: "SAR",
          }).format(Number(invoice.totalAmount) / 100)
        );
        expect(
          await sqlRows<RowDataPacket>(
            "SELECT id FROM passengers WHERE bookingId=?",
            [bookingId]
          )
        ).toHaveLength(1);
        expect(
          await sqlRows<RowDataPacket>(
            "SELECT id FROM financial_ledger WHERE bookingId=? AND type='charge'",
            [bookingId]
          )
        ).toHaveLength(0);
      }
    );
  });
}
