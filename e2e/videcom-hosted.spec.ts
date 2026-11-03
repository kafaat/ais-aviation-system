import { expect, test } from "@playwright/test";

const provider = "https://ibe-fixture.invalid";
const base = provider + "/demo";
const panels = base + "/VARS/Public/CustomerPanels/";

test.use({ serviceWorkers: "block" });
test("hosted panels open on the assigned origin and a search leaves the corporate site", async ({
  page,
}) => {
  test.skip(
    process.env.VIDECOM_IBE_BASE_URL !== base,
    "Requires the isolated Videcom fixture configured by CI"
  );
  const visits: string[] = [];
  await page.route(provider + "/**", async route => {
    const req = route.request();
    visits.push(req.url());
    if (req.url().includes("/CustomerPanels/"))
      expect(req.headers().referer).toBeUndefined();
    const body = req.url().includes("requirementsBS.aspx")
      ? '<form action="/demo/results" target="_top"><button>Continue test search</button></form>'
      : "<main>Provider fixture</main>";
    await route.fulfill({ contentType: "text/html", body });
  });
  await page.goto(
    "/videcom?lang=en&country=US&currency=USD&bookingRef=do-not-forward"
  );
  await expect(
    page.frameLocator('iframe[title="Manage a booking"]').locator("main")
  ).toHaveText("Provider fixture");
  const search = page.frameLocator('iframe[title="Book a flight"]');
  await search.getByRole("button", { name: "Continue test search" }).click();
  await expect(page).toHaveURL(
    url => url.origin === provider && url.pathname === "/demo/results"
  );
  await page.goto("/videcom?lang=en");
  await page.getByRole("link", { name: "Travel agent sign-in" }).click();
  await expect(page).toHaveURL(panels + "AgentLoginBS.aspx");
  expect(visits).toContain(
    panels + "requirementsBS.aspx?country=us&currency=USD"
  );
  expect(visits).toContain(panels + "MMBLoginbs.aspx");
  expect(visits.join(" ")).not.toContain("do-not-forward");
});
