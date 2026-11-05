import type { Page } from "@playwright/test";
import type { RowDataPacket } from "mysql2/promise";
import { test, expect } from "./fixtures/base-test";
import { ownedBooking, rpc, sqlRows } from "./fixtures/hardening";

// Public payer links contain bearer tokens. Keep them outside browser artifacts.
test.use({ trace: "off", video: "off", screenshot: "off" });

async function unpaidShare(page: Page) {
  const { booking } = await ownedBooking(page);
  const client = rpc(page);
  const firstAmount = Math.floor(booking.totalAmount / 2);
  const { splitIds } = await client.splitPayments.initiate.mutate({
    bookingId: booking.bookingId,
    expirationDays: 1,
    splits: [
      {
        name: "Synthetic Payer One",
        email: "payer-one@example.test",
        amount: firstAmount,
      },
      {
        name: "Synthetic Payer Two",
        email: "payer-two@example.test",
        amount: booking.totalAmount - firstAmount,
      },
    ],
  });
  expect(splitIds).toHaveLength(2);
  // Initiation deliberately does not expose bearer tokens to its public result.
  // Read only the native fixture's generated token from the disposable database.
  const [share] = await sqlRows<RowDataPacket & { paymentToken: string }>(
    "SELECT paymentToken FROM payment_splits WHERE id=? AND bookingId=?",
    [splitIds[0], booking.bookingId]
  );
  if (!share) throw new Error("Native payer fixture was not created");
  const details = await client.splitPayments.getPayerDetails.query({
    paymentToken: share.paymentToken,
  });
  expect(details).toMatchObject({
    splitId: splitIds[0],
    status: "pending",
    cancellation: null,
  });
  return {
    client,
    bookingId: booking.bookingId,
    splitId: splitIds[0],
    paymentToken: share.paymentToken,
  };
}

function countPayerReads(page: Page) {
  let requests = 0;
  page.on("request", request => {
    const endpoint = new URL(request.url()).pathname.split("/").at(-1);
    if (endpoint?.split(",").includes("splitPayments.getPayerDetails")) {
      requests += 1;
    }
  });
  return () => requests;
}

test("native unpaid cancellation without a refund item ends provider-return polling", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const { client, bookingId, splitId, paymentToken } = await unpaidShare(page);
  await expect(
    client.splitPayments.cancelSplit.mutate({ splitId })
  ).resolves.toEqual({
    cancelled: true,
  });
  expect(
    await sqlRows<RowDataPacket>(
      "SELECT id FROM booking_refund_items WHERE bookingId=? AND splitId=?",
      [bookingId, splitId]
    )
  ).toEqual([]);

  // A payer does not need the booking owner's session. Exercise the public
  // reader and the browser against the actual cancellation persisted above.
  await page.context().clearCookies();
  expect(
    await client.splitPayments.getPayerDetails.query({ paymentToken })
  ).toMatchObject({ splitId, status: "cancelled", cancellation: null });
  const reads = countPayerReads(page);
  await page.goto(
    `/pay/${paymentToken}/success?session_id=cs_synthetic_cancelled`
  );
  await expect(
    page.getByRole("heading", { name: "Payment Cancelled", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Confirming your payment with the provider...")
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Payment Complete!", exact: true })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pay Now/ })).toHaveCount(0);
  expect(reads()).toBe(1);
  // More than two 3-second polling intervals: a terminal result must stay idle.
  await page.waitForTimeout(6500);
  expect(reads()).toBe(1);
});

test("a cancelled checkout return is cleaned up and an expired native link resolves to null without polling", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const { client, bookingId, splitId, paymentToken } = await unpaidShare(page);
  await page.context().clearCookies();
  await page.goto(
    `/pay/${paymentToken}/success?cancelled=true&session_id=cs_synthetic_return`
  );
  await expect(page).toHaveURL(
    new URL(`/pay/${paymentToken}`, page.url()).href
  );
  await expect(
    page.getByText("Payment was cancelled", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay Now/ })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: /Pay Now/ })).toBeEnabled();
  await expect(
    page.getByText("Payment was cancelled", { exact: true })
  ).toHaveCount(0);

  // Only the fixture deadline is changed; the native reader, serializer, route
  // and React Query lifecycle decide how the expired link is displayed.
  await sqlRows<RowDataPacket>(
    "UPDATE payment_splits SET expiresAt=UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id=? AND bookingId=?",
    [splitId, bookingId]
  );
  await expect(
    client.splitPayments.getPayerDetails.query({ paymentToken })
  ).resolves.toBeNull();
  const reads = countPayerReads(page);
  await page.goto(
    `/pay/${paymentToken}/success?session_id=cs_synthetic_expired`
  );
  await expect(
    page.getByRole("heading", { name: "Payment Not Found", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Confirming your payment with the provider...")
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pay Now/ })).toHaveCount(0);
  expect(reads()).toBe(1);
  await page.waitForTimeout(6500);
  expect(reads()).toBe(1);
});
