import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { rpc } from "./fixtures/rpc";
import { testUsers } from "./fixtures/test-data";

// This stage prepares only regular/reporting (two real UI logins), then uses
// three additional native API logins below. Five attempts fit the unchanged
// authentication quota. Never revoke the reusable session from global setup.
test.describe.configure({ mode: "serial", retries: 0 });
test.use({ trace: "off", video: "off", screenshot: "off" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
});

for (const outcome of ["success", "UNAUTHORIZED", "lost response"] as const) {
  test(`native logout clears private browser state after ${outcome}`, async ({
    page,
    browser,
  }) => {
    const privateMarker = `Logout-owner-${randomUUID()}`;
    const client = rpc(page);
    const session = await client.auth.login.mutate({
      email: testUsers.regular.email,
      password: testUsers.regular.password,
    });
    expect("mfaRequired" in session).toBe(false);
    expect((await client.auth.me.query())?.email).toBe(testUsers.regular.email);
    await client.userPreferences.updateMyPreferences.mutate({
      emergencyContact: privateMarker,
    });
    await page.goto("/profile");
    await page
      .getByRole("tab", { name: "Personal Information", exact: true })
      .click();
    await expect(page.locator("#emergencyContact")).toHaveValue(privateMarker);
    // Keep the profile query in this document's real React Query cache while
    // opening the layout that owns the actual logout control.
    await page.evaluate(() => {
      window.history.pushState(null, "", "/favorites");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(
      page.getByRole("button", { name: "User menu", exact: true })
    ).toBeVisible();
    // Install the actual shipped worker for this installed-PWA scenario. A
    // fresh browser context has no previously registered controlling worker.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller))
      )
      .toBe(true);
    const cacheName = `ais-private-logout-${randomUUID()}`;
    await page.evaluate(
      async ({ name, marker }) => {
        const cache = await caches.open(name);
        await cache.put("/private-logout-proof", new Response(marker));
      },
      { name: cacheName, marker: privateMarker }
    );

    if (outcome === "UNAUTHORIZED") {
      // Expire this context, then inject the explicit unauthorized transport
      // outcome. logoutCookie is public, so its normal expired-session response
      // is success; this fault exercises the client's documented 401 branch.
      await page.context().clearCookies();
      await page.route("**/api/trpc/auth.logoutCookie*", route =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify([
            {
              error: {
                json: {
                  message: "Session expired",
                  code: -32001,
                  data: {
                    code: "UNAUTHORIZED",
                    httpStatus: 401,
                    path: "auth.logoutCookie",
                  },
                },
              },
            },
          ]),
        })
      );
    } else if (outcome === "lost response") {
      // Commit the real logout, then lose its reply. The server state is real;
      // only the browser's network failure is injected, without forging success.
      await page.route("**/api/trpc/auth.logoutCookie*", async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      });
    }

    await page.getByRole("button", { name: "User menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Logout", exact: true }).click();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    expect(await client.auth.me.query()).toBeNull();
    await expect
      .poll(() => page.evaluate(name => caches.has(name), cacheName))
      .toBe(false);
    await expect
      .poll(() =>
        page.evaluate(
          () => localStorage.getItem("manus-runtime-user-info") ?? ""
        )
      )
      .not.toContain(testUsers.regular.email);
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);
    if (outcome === "lost response") {
      await expect(
        page.getByText("We couldn't confirm sign-out. Please try again.", {
          exact: true,
        })
      ).toBeVisible();
    }

    await page.goBack();
    await expect(page).toHaveURL(url => url.pathname === "/login");
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.locator("#emergencyContact")).toHaveCount(0);
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);

    // Reuse the other account's own real session, not the revoked cookie.
    await useBrowserSession(page, "reporting");
    await page.goto("/profile");
    await expect(
      page.getByText(testUsers.reporting.email, { exact: true })
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Personal Information", exact: true })
      .click();
    await expect(page.locator("#emergencyContact")).not.toHaveValue(
      privateMarker
    );
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);
    expect((await client.auth.me.query())?.email).toBe(
      testUsers.reporting.email
    );
    if (outcome === "UNAUTHORIZED" && "refreshToken" in session) {
      // auth.logout also revokes its request cookie. Revoke only this test's
      // detached refresh family, never the other account's reusable cookie.
      await page.context().clearCookies();
      await client.auth.logout.mutate({ refreshToken: session.refreshToken });
    }
    // Probe the shared session in another context, with no in-flight account
    // UI or logout transport fault attached to the context under test.
    const probe = await browser.newContext();
    try {
      const probePage = await probe.newPage();
      for (const account of ["regular", "reporting"] as const) {
        await useBrowserSession(probePage, account);
        expect((await rpc(probePage).auth.me.query())?.email).toBe(
          testUsers[account].email
        );
      }
    } finally {
      await probe.close();
    }
  });
}
