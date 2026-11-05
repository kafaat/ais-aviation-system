import type { Page, Response } from "@playwright/test";
import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { rpc } from "./fixtures/rpc";
import { testUsers } from "./fixtures/test-data";

// Use the built entry and native API. Disable the service worker only in these
// chunk-failure checks so a cached asset cannot conceal the injected outage.
test.describe("Built entry and account recovery acceptance", () => {
  test.use({ serviceWorkers: "block", locale: "en-US" });

  const routes = [
    { path: "/", heading: "Book Your Next Flight", private: false },
    { path: "/my-bookings", heading: "My Bookings", private: true },
    { path: "/profile", heading: "User Profile", private: true },
    { path: "/payment-history", heading: "Payment History", private: true },
  ];

  for (const authenticated of [false, true]) {
    for (const route of routes) {
      test(`${authenticated ? "signed-in" : "anonymous"} direct URL and reload: ${route.path}`, async ({
        page,
      }) => {
        if (authenticated) await useBrowserSession(page, "regular");
        const destination = `${route.path}?entry=direct#account`;
        await page.goto(destination);
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          if (route.private && !authenticated) {
            await expectLogin(page, destination);
            await expect(
              page.getByText(testUsers.regular.email, { exact: true })
            ).toHaveCount(0);
          } else {
            await expect(
              page.getByRole("heading", { name: route.heading, exact: true })
            ).toBeVisible();
            expect(new URL(page.url()).pathname).toBe(route.path);
          }
          await expect(page.locator("html")).toHaveAttribute("lang", "en");
          await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
        }
      });
    }
  }

  test("retry reloads a failed built route chunk at the original protected URL", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    let blocked = 0;
    await page.route(/\/assets\/Profile-[^/]+\.js(?:\?.*)?$/, async route => {
      if (blocked++ === 0) await route.abort("failed");
      else await route.continue();
    });
    const destination = "/profile?entry=chunk-retry#account";
    await page.goto(destination);
    await expect(
      page.getByRole("heading", { name: "Failed to load this page" })
    ).toBeVisible();
    expect(blocked).toBe(1);
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Try Again", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "User Profile", exact: true })
    ).toBeVisible();
    expect(
      new URL(page.url()).pathname +
        new URL(page.url()).search +
        new URL(page.url()).hash
    ).toBe(destination);
    expect(blocked).toBeGreaterThan(1);
    await expect(
      page.getByRole("heading", { name: "Failed to load this page" })
    ).toHaveCount(0);
  });

  test("home exits a failed built route without leaving a blank page", async ({
    page,
  }) => {
    let blocked = 0;
    await page.route(
      /\/assets\/AccessibilityStatement-[^/]+\.js(?:\?.*)?$/,
      async route => {
        blocked += 1;
        await route.abort("failed");
      }
    );
    await page.goto("/accessibility");
    await expect(
      page.getByRole("heading", { name: "Failed to load this page" })
    ).toBeVisible();
    expect(blocked).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Go Home", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#hero-title")).toHaveText(
      "Book Your Next Flight"
    );
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);
  });

  test("an expired query preserves its return URL and reaches a stable login page", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const destination = "/profile?entry=expired-query#preferences";
    const loaded = page.waitForResponse(
      response =>
        isProcedure(response, "userPreferences.getMyPreferences") &&
        response.status() === 200
    );
    await page.goto(destination);
    await loaded;
    await expect(page.getByTestId("save-button")).toBeEnabled();
    // Removing only this context's cookies expires its browser authentication;
    // the shared fixture's server session is not revoked for other tests.
    await page.context().clearCookies();
    expect(await rpc(page).auth.me.query()).toBeNull();
    const failed = page.waitForResponse(response =>
      isUnauthorizedProcedure(response, "userPreferences.getMyPreferences")
    );
    // Refetch the mounted query through the browser lifecycle used by TanStack.
    // useAuth disables focus refetch. Navigating to a cold private route instead
    // races auth.me=null against its lazy page: the guard can correctly redirect
    // before getMyPreferences ever exists, which does not exercise query expiry.
    await page.evaluate(() => {
      if (document.visibilityState !== "visible")
        throw new Error("Expected a visible profile before query refetch");
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await failed;
    await expectLogin(page, destination);
    await page.reload();
    await expectLogin(page, destination);
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);
  });

  test("an expired mutation preserves its return URL without reporting a successful save", async ({
    page,
  }) => {
    await useBrowserSession(page, "regular");
    const destination = "/profile?entry=expired-mutation#preferences";
    await page.goto(destination);
    await expect(page.getByTestId("save-button")).toBeEnabled();
    await page.context().clearCookies();
    expect(await rpc(page).auth.me.query()).toBeNull();
    const failed = page.waitForResponse(response =>
      isUnauthorizedProcedure(response, "userPreferences.updateMyPreferences")
    );
    await page.getByTestId("save-button").click();
    await failed;
    await expectLogin(page, destination);
    await page.reload();
    await expectLogin(page, destination);
    await expect(
      page.getByText(testUsers.regular.email, { exact: true })
    ).toHaveCount(0);
  });

  for (const returnTo of [
    "https://outside.invalid/private",
    "//outside.invalid/private",
    "/login?returnTo=/profile",
  ]) {
    test(`a signed-in login rejects unsafe returnTo ${returnTo}`, async ({
      page,
    }) => {
      await useBrowserSession(page, "regular");
      await page.goto(`/login?${new URLSearchParams({ returnTo })}`);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator("#hero-title")).toHaveText(
        "Book Your Next Flight"
      );
    });
  }

  for (const language of ["en", "ar"] as const) {
    test(`embedded search keeps account UI isolated and bootstraps ${language}`, async ({
      page,
    }) => {
      await useBrowserSession(page, "regular");
      await page.addInitScript(
        lang => localStorage.setItem("i18nextLng", lang),
        language
      );
      const procedures: string[] = [];
      page.on("request", request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/trpc/"))
          procedures.push(
            ...url.pathname.slice("/api/trpc/".length).split(",")
          );
      });
      await page.goto("/embed/search");
      await expect(
        page.getByRole("heading", {
          name: language === "ar" ? "ابحث عن رحلة" : "Find a flight",
          exact: true,
        })
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        language === "ar" ? "rtl" : "ltr"
      );
      await expect(
        page.getByRole("button", { name: /User menu|قائمة المستخدم/ })
      ).toHaveCount(0);
      await expect(
        page.getByText(testUsers.regular.email, { exact: true })
      ).toHaveCount(0);
      await expect.poll(() => procedures).toContain("ibePublic.config");
      expect(
        procedures.filter(procedure =>
          /^(?:auth\.|bookings\.|payments\.|userPreferences\.|consent\.)/.test(
            procedure
          )
        )
      ).toEqual([]);
    });
  }
});

function isProcedure(response: Response, procedure: string) {
  return (
    new URL(response.url()).pathname
      .split("/")
      .at(-1)
      ?.split(",")
      .includes(procedure) === true
  );
}

async function isUnauthorizedProcedure(response: Response, procedure: string) {
  if (!isProcedure(response, procedure)) return false;
  // A single-procedure 401 can navigate the document before CDP exposes its
  // body. Mixed batches use 207, for which inspect the individual error below.
  if (response.status() === 401) return true;
  const body = await response.json();
  const results = Array.isArray(body) ? body : [body];
  return results.some(
    result =>
      result?.error?.json?.data?.code === "UNAUTHORIZED" &&
      result.error.json.data.path === procedure
  );
}

async function expectLogin(page: Page, returnTo: string) {
  await expect(page).toHaveURL(
    url =>
      url.pathname === "/login" && url.searchParams.get("returnTo") === returnTo
  );
  await expect(page.getByTestId("login-submit")).toBeVisible();
}
