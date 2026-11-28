import { expect, test } from "./fixtures/base-test";
import { useBrowserSession } from "./fixtures/browser-session";
import { fixtureFlight, rpc, sqlRows } from "./fixtures/hardening";
import en from "../client/src/i18n/locales/en.json";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("uses the passenger's explicit route to suggest an available flight without booking it", async ({
  page,
}, testInfo) => {
  // The application and test runner share the disposable environment. The
  // server handles an absent provider key before any outbound model request.
  if (process.env.BUILT_IN_FORGE_API_KEY)
    throw new Error("Run this acceptance with the Forge provider key unset");
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  await useBrowserSession(page, "regular");
  const owner = await rpc(page).auth.me.query();
  if (!owner) throw new Error("The passenger session is required");

  // Isolate this flight from other browser projects, retries, and previous
  // runs. The service returns only the first three matching flights.
  const occupied = await sqlRows(
    "SELECT DISTINCT DATEDIFF(departureTime, UTC_DATE()) AS dayOffset FROM flights WHERE departureTime >= UTC_DATE() + INTERVAL 120 DAY"
  );
  const used = new Set(occupied.map(row => Number(row.dayOffset)));
  let offset = 120 + (testInfo.parallelIndex % 20);
  while (used.has(offset)) offset += 20;
  const flightId = await fixtureFlight(owner.tenantId, offset);
  const [flight] = await sqlRows(
    "SELECT originId, destinationId, DATE_FORMAT(departureTime, '%Y-%m-%d') AS departureDate, businessPrice FROM flights WHERE id = ?",
    [flightId]
  );
  const [before] = await sqlRows(
    "SELECT COALESCE(MAX(id), 0) AS lastId FROM chat_conversations WHERE userId = ?",
    [owner.id]
  );

  await page.goto("/ai-chat");
  await page.getByRole("checkbox", { name: en.aiChat.addRoute }).check();
  await page
    .getByLabel(en.home.search.from, { exact: true })
    .selectOption(String(flight.originId));
  await page
    .getByLabel(en.home.search.to, { exact: true })
    .selectOption(String(flight.destinationId));
  await page
    .getByLabel(en.home.search.departureDate)
    .fill(flight.departureDate);
  await page
    .getByLabel(en.booking.passengers, { exact: true })
    .selectOption("2");
  await page.getByLabel(en.filters.cabinClass).selectOption("business");
  await page.getByRole("button", { name: en.aiChat.startConversation }).click();
  const log = page.getByRole("log", { name: en.aiChat.conversationLog });
  await expect(log).toBeVisible();

  const conversations = await sqlRows(
    "SELECT id, bookingId, CAST(context AS CHAR) AS contextJson FROM chat_conversations WHERE userId = ? AND id > ? AND JSON_UNQUOTE(JSON_EXTRACT(context, '$.departureDate')) = ?",
    [owner.id, Number(before.lastId), flight.departureDate]
  );
  expect(conversations).toHaveLength(1);
  expect(JSON.parse(conversations[0].contextJson)).toEqual({
    originId: flight.originId,
    destinationId: flight.destinationId,
    departureDate: flight.departureDate,
    passengers: 2,
    cabinClass: "business",
  });

  await page
    .getByRole("textbox", { name: en.aiChat.messageLabel })
    .fill("Please show available flights.");
  await page.getByRole("button", { name: en.aiChat.sendMessage }).click();
  const suggestion = log.locator(
    `a[href="/booking/${flightId}?class=business"]`
  );
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText(en.search.business);
  const rows = await sqlRows(
    "SELECT s.cabinClass, s.pricePerPerson, s.totalPrice, s.currency, s.selected, c.bookingId FROM booking_suggestions s JOIN chat_conversations c ON c.id = s.conversationId WHERE s.conversationId = ? AND c.userId = ? AND s.flightId = ?",
    [Number(conversations[0].id), owner.id, flightId]
  );
  expect(rows).toEqual([
    {
      cabinClass: "business",
      pricePerPerson: flight.businessPrice,
      totalPrice: flight.businessPrice * 2,
      currency: "SAR",
      selected: "pending",
      bookingId: null,
    },
  ]);
  const [effects] = await sqlRows(
    "SELECT COUNT(DISTINCT b.id) AS bookings, COUNT(p.id) AS payments FROM bookings b LEFT JOIN payments p ON p.bookingId = b.id WHERE b.flightId = ?",
    [flightId]
  );
  expect(Number(effects.bookings)).toBe(0);
  expect(Number(effects.payments)).toBe(0);
});
