import { randomBytes, randomUUID } from "node:crypto";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type { Page } from "@playwright/test";
import { COOKIE_NAME } from "../shared/const";
import { test, expect } from "./fixtures/base-test";
import { rpc } from "./fixtures/rpc";
import { disposableDatabaseUrl } from "./disposable-database";

// Real browser, built application, signed persisted sessions and native MySQL.
// Setup issues sessions through the production issuer; it is not a provider
// login test. Financial read fixtures never represent a real provider payment.
test.use({ trace: "off", video: "off", screenshot: "off" });

type Actor = { id: number; openId: string; role: string };
async function useActor(page: Page, actor: Actor) {
  await page.goto("about:blank");
  const { sdk } = await import("../server/_core/sdk");
  const { closePool } = await import("../server/db");
  let cookie: string;
  try {
    cookie = await sdk.createSessionToken(actor.openId, {
      expiresInMs: 3600000,
    });
  } finally {
    await closePool();
  }
  await page.context().clearCookies();
  const url = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: cookie,
      url,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
  const client = rpc(page);
  expect(await client.auth.me.query()).toMatchObject({
    id: actor.id,
    role: actor.role,
  });
  const consent = await client.consent.getMyConsent.query();
  if (consent.needsReconsent)
    await client.consent.updateConsent.mutate({
      expectedRevision: consent.consent?.id ?? null,
      consentVersion: consent.currentVersion,
      essential: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
  return client;
}

async function fixture() {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const key = randomUUID();
  const users: number[] = [];
  const airports: number[] = [];
  let tenantId = 0,
    airlineId = 0,
    flightId = 0,
    reviewId = 0;
  const intentId = "pi_forensic_" + key.replaceAll("-", "");
  const voucherCode = "FORENSIC" + key.slice(0, 8).toUpperCase();
  const cleanup = async () => {
    try {
      await db.execute("DELETE FROM payment_receipts WHERE paymentIntentId=?", [
        intentId,
      ]);
      await db.execute("DELETE FROM vouchers WHERE code=?", [voucherCode]);
      if (reviewId)
        await db.execute(
          "DELETE FROM flight_review_helpful_votes WHERE reviewId=?",
          [reviewId]
        );
      if (flightId) {
        await db.execute("DELETE FROM flight_reviews WHERE flightId=?", [
          flightId,
        ]);
        await db.execute("DELETE FROM user_flight_favorites WHERE flightId=?", [
          flightId,
        ]);
        await db.execute("DELETE FROM dcs_operation_events WHERE flightId=?", [
          flightId,
        ]);
        await db.execute("DELETE FROM flights WHERE id=?", [flightId]);
      }
      if (tenantId)
        await db.execute("DELETE FROM dcs_bag_return_grants WHERE tenantId=?", [
          tenantId,
        ]);
      for (const id of users) {
        await db.execute("DELETE FROM idempotency_requests WHERE userId=?", [
          id,
        ]);
        await db.execute("DELETE FROM audit_logs WHERE userId=?", [id]);
        await db.execute("DELETE FROM refresh_tokens WHERE userId=?", [id]);
        await db.execute("DELETE FROM consent_records WHERE userId=?", [id]);
        await db.execute("DELETE FROM notifications WHERE userId=?", [id]);
        await db.execute("DELETE FROM user_preferences WHERE userId=?", [id]);
        await db.execute("DELETE FROM users WHERE id=?", [id]);
      }
      if (airlineId)
        await db.execute("DELETE FROM airlines WHERE id=?", [airlineId]);
      for (const id of airports)
        await db.execute("DELETE FROM airports WHERE id=?", [id]);
      if (tenantId)
        await db.execute("DELETE FROM tenants WHERE id=?", [tenantId]);
    } finally {
      await db.end();
    }
  };
  try {
    const [tenant] = await db.execute<ResultSetHeader>(
      "INSERT INTO tenants (slug,name,status) VALUES (?,?,'active')",
      ["forensic-" + key, "Synthetic forensic airline"]
    );
    tenantId = tenant.insertId;
    const actor = async (role: string, label: string): Promise<Actor> => {
      const openId = "forensic-" + key + "-" + label;
      const [row] = await db.execute<ResultSetHeader>(
        "INSERT INTO users (openId,tenantId,name,email,role) VALUES (?,?,?,?,?)",
        [
          openId,
          role === "super_admin" ? null : tenantId,
          "Synthetic " + label,
          key + "." + label + "@example.invalid",
          role,
        ]
      );
      users.push(row.insertId);
      return { id: row.insertId, openId, role };
    };
    const owner = await actor("user", "owner"),
      other = await actor("user", "other"),
      admin = await actor("super_admin", "admin"),
      manager = await actor("airline_admin", "manager"),
      staff = await actor("ops", "staff");
    const reference = async (kind: "airlines" | "airports") => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = [...randomBytes(3)]
          .map(byte => String.fromCharCode(65 + (byte % 26)))
          .join("");
        try {
          const [row] = await db.execute<ResultSetHeader>(
            kind === "airlines"
              ? "INSERT INTO airlines (code,name,active) VALUES (?, 'Synthetic forensic airline',true)"
              : "INSERT INTO airports (code,name,city,country,timezone) VALUES (?, 'Synthetic forensic airport','Fixture city','Fixture country','UTC')",
            [code]
          );
          return row.insertId;
        } catch (error) {
          if (!(
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ER_DUP_ENTRY"
          ))
            throw error;
        }
      }
      throw new Error("No unused synthetic reference code");
    };
    airlineId = await reference("airlines");
    airports.push(await reference("airports"), await reference("airports"));
    const [flight] = await db.execute<ResultSetHeader>(
      "INSERT INTO flights (tenantId,flightNumber,airlineId,originId,destinationId,departureTime,arrivalTime,economySeats,businessSeats,economyAvailable,businessAvailable,economyPrice,businessPrice) VALUES (?, 'FX901',?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 DAY),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 4 DAY),20,2,20,2,12345,23456)",
      [tenantId, airlineId, airports[0], airports[1]]
    );
    flightId = flight.insertId;
    const [review] = await db.execute<ResultSetHeader>(
      "INSERT INTO flight_reviews (userId,flightId,rating,title,comment,status,helpfulCount) VALUES (?,?,5,'Native consumer review','Recorded synthetic experience','approved',7)",
      [other.id, flightId]
    );
    reviewId = review.insertId;
    await db.execute(
      "INSERT INTO user_flight_favorites (userId,flightId) VALUES (?,?)",
      [owner.id, flightId]
    );
    return {
      db,
      owner,
      other,
      admin,
      manager,
      staff,
      flightId,
      reviewId,
      intentId,
      voucherCode,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("saved-flight preview persists helpful votes and owner-specific save/remove through the real API", async ({
  page,
}) => {
  const f = await fixture();
  try {
    const client = await useActor(page, f.owner);
    await page.goto("/favorites");
    await page
      .getByRole("button", { name: "Flight Details", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Native consumer review", { exact: true })
    ).toBeVisible();
    const helpful = dialog.getByRole("button", { name: /helpful/i });
    await helpful.click();
    await expect(helpful).toBeDisabled();
    await expect
      .poll(async () => {
        const [rows] = await f.db.execute<RowDataPacket[]>(
          "SELECT helpfulCount FROM flight_reviews WHERE id=?",
          [f.reviewId]
        );
        return rows[0].helpfulCount;
      })
      .toBe(8);
    await dialog
      .getByRole("button", { name: "Remove saved flight", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Save this flight", exact: true })
    ).toBeVisible();
    expect(await client.favorites.getFlights.query()).toEqual([]);
    await dialog
      .getByRole("button", { name: "Save this flight", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Remove saved flight", exact: true })
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Flight Details", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /helpful/i })
    ).toBeDisabled();
    const other = await useActor(page, f.other);
    expect(await other.favorites.getFlights.query()).toEqual([]);
    expect(
      (await other.reviews.getFlightReviews.query({ flightId: f.flightId }))[0]
        .hasVoted
    ).toBe(false);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await f.cleanup();
  }
});

test("voucher create and edit persist percentage units and descriptions after page reload", async ({
  page,
}) => {
  const f = await fixture();
  try {
    await useActor(page, f.admin);
    await page.goto("/admin/vouchers");
    await page
      .getByRole("button", { name: "Create Voucher", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Create New Voucher" });
    await dialog
      .getByLabel("Voucher Code", { exact: true })
      .fill(f.voucherCode);
    await dialog.getByRole("combobox", { name: "Discount Type" }).click();
    await page.getByRole("option", { name: "Percentage", exact: true }).click();
    await dialog.getByLabel("Percentage (%)", { exact: true }).fill("10");
    await dialog
      .getByLabel("Maximum Discount (SAR)", { exact: true })
      .fill("20");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const [created] = await f.db.execute<RowDataPacket[]>(
      "SELECT value,maxDiscount,type FROM vouchers WHERE code=?",
      [f.voucherCode]
    );
    expect(created).toEqual([
      expect.objectContaining({
        value: 10,
        maxDiscount: 2000,
        type: "percentage",
      }),
    ]);
    await page
      .getByRole("button", { name: `Edit voucher ${f.voucherCode}` })
      .click();
    dialog = page.getByRole("dialog", { name: "Edit Voucher" });
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Saved by native browser acceptance");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: `Edit voucher ${f.voucherCode}` })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("Description", { exact: true })
    ).toHaveValue("Saved by native browser acceptance");
    const [rows] = await f.db.execute<RowDataPacket[]>(
      "SELECT value,maxDiscount,type FROM vouchers WHERE code=?",
      [f.voucherCode]
    );
    expect(rows).toEqual(created);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await f.cleanup();
  }
});

test("airline administrator grants and revokes station-specific handover access from the mounted page", async ({
  page,
}) => {
  const f = await fixture();
  try {
    const client = await useActor(page, f.manager);
    await page.goto("/airline/bag-return-grants");
    await page
      .getByRole("combobox", { name: "Reference flight", exact: true })
      .selectOption(String(f.flightId));
    await page.getByLabel("Staff ID", { exact: true }).fill(String(f.staff.id));
    await page
      .getByLabel("Grant change reason", { exact: true })
      .fill("Synthetic station authorization");
    await page
      .getByRole("button", { name: "Grant access", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: `Revoke access for staff ${f.staff.id}`,
      })
    ).toBeVisible();
    expect(
      (
        await client.dcsOperations.bagReturnGrants.query({
          flightId: f.flightId,
          limit: 25,
        })
      ).grants
    ).toMatchObject([{ staffId: f.staff.id, enabled: true }]);
    await page
      .getByRole("button", { name: `Revoke access for staff ${f.staff.id}` })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Revoke bag return access",
    });
    await dialog
      .getByLabel("Grant change reason", { exact: true })
      .fill("Synthetic access ended");
    await dialog
      .getByRole("button", { name: "Confirm revocation", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await page
      .getByRole("combobox", { name: "Reference flight", exact: true })
      .selectOption(String(f.flightId));
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    expect(
      (
        await client.dcsOperations.bagReturnGrants.query({
          flightId: f.flightId,
          limit: 25,
        })
      ).grants
    ).toMatchObject([{ staffId: f.staff.id, enabled: false }]);
    const owner = await useActor(page, f.owner);
    await expect(
      owner.dcsOperations.bagReturnGrants.query({ flightId: f.flightId })
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await f.cleanup();
  }
});

test("settlement review page reads pending and completed native evidence without issuing an unsolicited refund", async ({
  page,
}) => {
  const f = await fixture();
  try {
    await f.db.execute(
      "INSERT INTO payment_receipts (paymentIntentId,kind,userId,targetId,amount,currency,settlementStatus,settlementError) VALUES (?,'booking',?,?,12345,'SAR','review_required','Synthetic review evidence')",
      [f.intentId, f.owner.id, f.flightId]
    );
    const client = await useActor(page, f.admin);
    const refundRequests: string[] = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.includes("refundSettlementReview"))
        refundRequests.push(request.method());
    });
    await page.goto("/admin/payments/settlement-reviews");
    await page.getByRole("button", { name: `Review ${f.intentId}` }).click();
    const dialog = page.getByRole("dialog", { name: "Settlement details" });
    await expect(dialog.getByText("123.45 SAR", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("Settlement requires review.", { exact: true })
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Request or retry refund" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Confirm refund request" })
    ).toBeVisible();
    expect(refundRequests).toEqual([]);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    // This is a read-state fixture transition, not a provider/webhook acceptance
    // claim. Signed webhook convergence is covered by the native financial suite.
    await f.db.execute(
      "UPDATE payment_receipts SET refundedAmount=amount,settlementStatus='review_refunded' WHERE paymentIntentId=?",
      [f.intentId]
    );
    await dialog.getByRole("button", { name: "Refresh details" }).click();
    await expect(
      dialog.getByText("Refund confirmed by the recorded financial evidence.", {
        exact: true,
      })
    ).toBeVisible();
    expect(
      await client.payments.settlementReview.query({
        paymentIntentId: f.intentId,
      })
    ).toMatchObject({
      settlementStatus: "review_refunded",
      refundedAmount: 12345,
    });
    expect(refundRequests).toEqual([]);
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await f.cleanup();
  }
});
