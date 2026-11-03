import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, rpc } from "./fixtures/hardening";

// The registration response contains a one-time agency secret.
test.use({ trace: "off", video: "off", screenshot: "off" });

test("admin links an agency, its first sale belongs to the owner, and a foreign user cannot take it", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await useBrowserSession(page, "regular");
  const api = rpc(page);
  const owner = await api.auth.me.query();
  if (!owner) throw new Error("Missing agency owner fixture");
  await useBrowserSession(page, "admin");

  const suffix = randomUUID().slice(0, 12);
  const agencyName = `Agency ${suffix}`;
  const email = `agency-${suffix}@example.com`;
  await page.goto("/admin/travel-agents");
  await page.getByRole("button", { name: "Register Agent" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Travel Agency Name").fill(agencyName);
  await dialog.getByPlaceholder("12345678").fill(suffix);
  await dialog.getByPlaceholder("John Doe").fill("Synthetic Agent");
  await dialog.getByPlaceholder("agent@agency.com").fill(email);
  await dialog.getByPlaceholder("+966 12 345 6789").fill("+966500000000");
  const register = dialog.getByRole("button", {
    name: "Register",
    exact: true,
  });
  await expect(register).toBeDisabled();
  await dialog.getByLabel("Owner user ID").fill(String(owner.id));
  await register.click();
  await expect(
    dialog.getByRole("heading", { name: "API Credentials" })
  ).toBeVisible();
  const credentials = {
    apiKey: await dialog.getByLabel("API Key", { exact: true }).inputValue(),
    apiSecret: await dialog
      .getByLabel("API Secret", { exact: true })
      .inputValue(),
  };
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: agencyName })
  ).toContainText(`Owner user ID: ${owner.id}`);

  const agent = (await api.travelAgent.list.query()).agents.find(
    row => row.iataNumber === suffix
  );
  if (!agent) throw new Error("Registered agency missing");
  const outsider = await browser.newPage();
  try {
    const outsideApi = rpc(outsider);
    // Reuse the authenticated passenger from the other airline. The combined
    // suite reserves its fifth IP login for the guest-to-checkout browser flow.
    await useBrowserSession(outsider, "departurePassenger");
    const outsiderUser = await outsideApi.auth.me.query();
    if (!outsiderUser) throw new Error("Missing outsider session");
    expect(outsiderUser.role).toBe("user");
    expect(outsiderUser.id).not.toBe(owner.id);
    expect(outsiderUser.tenantId).toEqual(expect.any(Number));
    expect(outsiderUser.tenantId).not.toBe(owner.tenantId);

    await expect(
      api.travelAgent.assignOwner.mutate({
        agentId: agent.id,
        ownerUserId: outsiderUser.id,
      })
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    const booking = {
      flightId: await fixtureFlight(),
      cabinClass: "economy" as const,
      idempotencyKey: randomUUID(),
      contactEmail: email,
      contactPhone: "+966500000000",
      passengers: [
        { type: "adult" as const, firstName: "First", lastName: "Sale" },
      ],
    };
    // Existing records created by older API clients can be repaired without re-registering the agency.
    const legacy = await api.travelAgent.register.mutate({
      agencyName: `Legacy ${suffix}`,
      iataNumber: `L-${suffix}`,
      contactName: "Legacy Agent",
      email: `legacy-${email}`,
      phone: booking.contactPhone,
    });
    await expect(
      api.travelAgent.createBooking.mutate({
        credentials: legacy.credentials,
        booking,
      })
    ).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
    await page.reload();
    const legacyRow = page
      .getByRole("row")
      .filter({ hasText: legacy.agent.agencyName });
    await expect(legacyRow).toContainText(
      "Booking blocked until an owner is linked"
    );
    await legacyRow.getByRole("button", { name: "Link owner" }).click();
    await dialog.getByLabel("Owner user ID").fill(String(owner.id));
    await dialog.getByRole("button", { name: "Link owner" }).click();
    await expect(legacyRow).toContainText(`Owner user ID: ${owner.id}`);
    await useBrowserSession(page, "regular");
    const first = await api.travelAgent.createBooking.mutate({
      credentials,
      booking,
    });
    expect(
      await api.travelAgent.createBooking.mutate({ credentials, booking })
    ).toEqual(first);
    await expect(
      outsideApi.bookings.getPassengers.query({ bookingId: first.bookingId })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    const sales = await api.bookings.myBookings.query();
    expect(sales.filter(row => row.id === first.bookingId)).toHaveLength(1);
    expect(
      await api.bookings.getPassengers.query({ bookingId: first.bookingId })
    ).toMatchObject([{ firstName: "First", lastName: "Sale" }]);
  } finally {
    await outsider.close();
  }
});
