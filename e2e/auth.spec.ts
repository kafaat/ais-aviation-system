import { test, expect } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { rpc } from "./fixtures/rpc";
import { testUsers } from "./fixtures/test-data";
import { login } from "./fixtures/test-helpers";

/**
 * Authentication on the product as built (#86).
 *
 * `/login` is one page with a login mode and a register mode toggled by a
 * button. Registration takes an optional full name, an e-mail and one
 * password of at least eight characters, and signs the new account in. There
 * is no `/register` page, no confirm-password field and no password-reset
 * flow; the legacy suite asserted all three and could never pass. Browser
 * constraint validation (type=email, required, minLength) stops malformed
 * submissions before any request, so those cases assert that nothing reached
 * the API. Real logins stay within the per-IP login quota: four UI attempts
 * here plus the one session global setup prepares when this spec runs in its
 * own phase with `AIS_E2E_SESSION_ACCOUNTS=regular`.
 */
test.describe("Authentication on the combined login/register page", () => {
  test.use({ locale: "en-US" });

  /** Counts tRPC auth mutations the browser actually sent. */
  function countRequests(page: import("@playwright/test").Page) {
    const sent: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "POST" && path.startsWith("/api/trpc/auth."))
        sent.push(path.replace("/api/trpc/", ""));
    });
    return sent;
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  });

  test.describe("login mode", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator("#email")).toBeVisible();
    });

    test("renders the login form and the register toggle, no reset or register links", async ({
      page,
    }) => {
      await expect(page.locator("#email")).toHaveAttribute("type", "email");
      await expect(page.locator("#password")).toHaveAttribute(
        "type",
        "password"
      );
      await expect(page.locator('[data-testid="login-submit"]')).toHaveText(
        /Login/
      );
      await expect(
        page.getByRole("button", { name: "Don't have an account? Register" })
      ).toBeVisible();
      // The product has no separate registration page and no password reset.
      await expect(
        page.getByRole("link", { name: /forgot|reset|register|sign up/i })
      ).toHaveCount(0);
      await expect(page.locator("#name")).toHaveCount(0);
    });

    test("a malformed e-mail or an empty form never reaches the API", async ({
      page,
    }) => {
      const sent = countRequests(page);
      await page.locator('[data-testid="login-submit"]').click();
      await expect(page.locator("#email:invalid")).toHaveCount(1);
      await page.locator("#email").fill("invalid-email");
      await page.locator("#password").fill("password123");
      await page.locator('[data-testid="login-submit"]').click();
      await expect(page.locator("#email:invalid")).toHaveCount(1);
      await expect(page.locator('[data-testid="error-message"]')).toHaveCount(
        0
      );
      expect(sent).toEqual([]);
    });

    test("a wrong password and an unknown account get the same generic refusal", async ({
      page,
    }) => {
      const attempt = async (email: string, password: string) => {
        await page.locator("#email").fill(email);
        await page.locator("#password").fill(password);
        const [response] = await Promise.all([
          page.waitForResponse(
            r =>
              new URL(r.url()).pathname.endsWith("/api/trpc/auth.login") &&
              r.request().method() === "POST"
          ),
          page.locator('[data-testid="login-submit"]').click(),
        ]);
        expect(response.status()).toBe(401);
        const alert = page.locator('[data-testid="error-message"]');
        await expect(alert).toBeVisible();
        await expect(alert).toHaveAttribute("role", "alert");
        return (await alert.textContent())?.trim() ?? "";
      };
      const wrongPassword = await attempt(
        testUsers.regular.email,
        "not-the-password-fixture"
      );
      const unknownAccount = await attempt(
        `nobody.${Date.now()}@example.com`,
        "not-the-password-fixture"
      );
      expect(wrongPassword).toContain("Invalid email or password");
      // Account enumeration: the two refusals are indistinguishable.
      expect(unknownAccount).toBe(wrongPassword);
      expect(page.url()).toContain("/login");
    });

    test("valid credentials sign the account in and leave the login page", async ({
      page,
    }) => {
      await login(page, testUsers.regular.email, testUsers.regular.password);
      expect(new URL(page.url()).pathname).not.toBe("/login");
      const me = await rpc(page).auth.me.query();
      expect(me?.email).toBe(testUsers.regular.email);
    });

    test("the password stays masked until the visibility toggle is used", async ({
      page,
    }) => {
      const password = page.locator("#password");
      const toggle = page.locator('[data-testid="toggle-password-visibility"]');
      await password.fill("fixture-secret");
      await expect(password).toHaveAttribute("type", "password");
      await expect(toggle).toHaveAttribute("aria-label", "Show password");
      await toggle.click();
      await expect(password).toHaveAttribute("type", "text");
      await expect(toggle).toHaveAttribute("aria-label", "Hide password");
      await toggle.click();
      await expect(password).toHaveAttribute("type", "password");
    });
  });

  test.describe("register mode", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/login");
      await page
        .getByRole("button", { name: "Don't have an account? Register" })
        .click();
      await expect(page.locator("#name")).toBeVisible();
      await expect(page.locator('[data-testid="login-submit"]')).toHaveText(
        /Create Account/
      );
    });

    test("a new account is created, signed in and can switch back to login", async ({
      page,
    }) => {
      const email = `e2e.register.${Date.now()}@example.com`;
      await page.locator("#name").fill("E2E Registered User");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill("RegisteredPassword123!");
      const [registered, loggedIn] = await Promise.all([
        page.waitForResponse(
          r =>
            new URL(r.url()).pathname.endsWith("/api/trpc/auth.register") &&
            r.request().method() === "POST"
        ),
        page.waitForResponse(
          r =>
            new URL(r.url()).pathname.endsWith("/api/trpc/auth.login") &&
            r.request().method() === "POST"
        ),
        page.locator('[data-testid="login-submit"]').click(),
      ]);
      expect(registered.status()).toBe(200);
      expect(loggedIn.status()).toBe(200);
      await page.waitForURL(url => url.pathname !== "/login");
      const me = await rpc(page).auth.me.query();
      expect(me?.email).toBe(email);
      expect(me?.role).toBe("user");
    });

    test("a password shorter than eight characters never reaches the API", async ({
      page,
    }) => {
      const sent = countRequests(page);
      await page.locator("#email").fill(`e2e.weak.${Date.now()}@example.com`);
      await page.locator("#password").fill("weak");
      await page.locator('[data-testid="login-submit"]').click();
      await expect(page.locator("#password:invalid")).toHaveCount(1);
      expect(sent).toEqual([]);
    });

    test("registering an existing e-mail is refused with the service's own reason", async ({
      page,
    }) => {
      await page.locator("#email").fill(testUsers.regular.email);
      await page.locator("#password").fill("AnotherPassword123!");
      const [registered] = await Promise.all([
        page.waitForResponse(
          r =>
            new URL(r.url()).pathname.endsWith("/api/trpc/auth.register") &&
            r.request().method() === "POST"
        ),
        page.locator('[data-testid="login-submit"]').click(),
      ]);
      expect(registered.status()).toBe(400);
      await expect(page.locator('[data-testid="error-message"]')).toContainText(
        "already exists"
      );
      expect(page.url()).toContain("/login");
    });

    test("the toggle returns to login mode", async ({ page }) => {
      await page
        .getByRole("button", { name: "Already have an account? Sign in" })
        .click();
      await expect(page.locator("#name")).toHaveCount(0);
      await expect(page.locator('[data-testid="login-submit"]')).toHaveText(
        /Login/
      );
    });
  });

  test.describe("sessions", () => {
    test("a signed-in session survives a reload on a protected page", async ({
      page,
    }) => {
      await useBrowserSession(page, "regular");
      await page.goto("/profile");
      await expect(
        page.getByRole("heading", { name: "User Profile", exact: true })
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "User Profile", exact: true })
      ).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/profile");
    });

    test("a signed-in visitor is sent away from the login page", async ({
      page,
    }) => {
      await useBrowserSession(page, "regular");
      await page.goto("/login");
      await page.waitForURL(url => url.pathname !== "/login");
      expect(new URL(page.url()).pathname).toBe("/");
    });

    test("an anonymous visitor to a protected page is sent to login with a return target", async ({
      page,
    }) => {
      await page.goto("/profile?tab=security");
      await page.waitForURL(url => url.pathname === "/login");
      const returnTo = new URL(page.url()).searchParams.get("returnTo");
      expect(returnTo).toBe("/profile?tab=security");
      await expect(page.locator("#email")).toBeVisible();
    });

    test("logout from the user menu ends the session", async ({ page }) => {
      await useBrowserSession(page, "regular");
      await page.goto("/favorites");
      await page
        .getByRole("button", { name: "User menu", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Logout", exact: true }).click();
      await expect
        .poll(async () => (await rpc(page).auth.me.query()) ?? null)
        .toBeNull();
      await page.goto("/profile");
      await page.waitForURL(url => url.pathname === "/login");
    });
  });

  test.describe("password reset", () => {
    test.fixme(
      true,
      "The product offers no password-reset flow (no route, no form, no e-mail); the legacy assertions were against a feature that does not exist. Tracked as a product decision in #86."
    );
    test("sends a reset e-mail for a known account", async () => {});
  });
});
