import type { Page, Request } from "@playwright/test";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { COOKIE_NAME } from "../shared/const";
import { test, expect } from "./fixtures/base-test";
import { fixtureFlight, rpc } from "./fixtures/hardening";
import { disposableDatabaseUrl } from "./disposable-database";

// These tests contain real session cookies in browser memory. Never retain
// traces, videos or screenshots of this fixture, including failed retries.
test.use({ trace: "off", video: "off", screenshot: "off" });

type Actor = {
  id: number;
  openId: string;
  tenantId: number | null;
  role: "user" | "finance" | "super_admin";
};

/** Synthetic read fixture; paid status is not evidence of a provider payment.
 * Every row belongs to this fixture, and no check-in/refund is executed. */
async function createConnectivityFixture() {
  const db = await mysql.createConnection(disposableDatabaseUrl());
  const users: number[] = [];
  const tenants: number[] = [];
  let flightId: number | undefined;
  let bookingId: number | undefined;
  let corporateId: number | undefined;
  const key = randomUUID();
  const companyName = "Synthetic connectivity " + key;
  const pnr = "P" + key.replaceAll("-", "").slice(0, 5).toUpperCase();
  const reference = "R" + pnr.slice(1);
  const cleanup = async () => {
    try {
      if (corporateId) {
        await db.execute(
          "DELETE FROM corporate_invitations WHERE corporateAccountId=?",
          [corporateId]
        );
        await db.execute(
          "DELETE FROM corporate_users WHERE corporateAccountId=?",
          [corporateId]
        );
        await db.execute("DELETE FROM corporate_accounts WHERE id=?", [
          corporateId,
        ]);
      }
      if (flightId)
        await db.execute("DELETE FROM seat_inventory WHERE flightId=?", [
          flightId,
        ]);
      if (bookingId) {
        await db.execute("DELETE FROM passengers WHERE bookingId=?", [
          bookingId,
        ]);
        await db.execute("DELETE FROM bookings WHERE id=?", [bookingId]);
      }
      if (flightId)
        await db.execute("DELETE FROM flights WHERE id=?", [flightId]);
      for (const id of users) {
        await db.execute("DELETE FROM refresh_tokens WHERE userId=?", [id]);
        await db.execute("DELETE FROM consent_records WHERE userId=?", [id]);
        await db.execute("DELETE FROM notifications WHERE userId=?", [id]);
        await db.execute("DELETE FROM user_preferences WHERE userId=?", [id]);
        await db.execute("DELETE FROM users WHERE id=?", [id]);
      }
      for (const id of tenants)
        await db.execute("DELETE FROM tenants WHERE id=?", [id]);
    } finally {
      await db.end();
    }
  };
  try {
    await db.query("SET SESSION time_zone = '+00:00'");
    for (const label of ["owner", "foreign"]) {
      const [row] = await db.execute<ResultSetHeader>(
        "INSERT INTO tenants (slug,name,status) VALUES (?,?,'active')",
        ["ui-" + label + "-" + key, "Synthetic UI " + label]
      );
      tenants.push(row.insertId);
    }
    const actor = async (
      label: string,
      role: Actor["role"],
      tenantId: number | null
    ): Promise<Actor> => {
      // Keep the longest label below the users.openId varchar(64) boundary.
      const openId = "ui-" + key + "-" + label;
      const [row] = await db.execute<ResultSetHeader>(
        "INSERT INTO users (openId,tenantId,name,email,role) VALUES (?,?,?,?,?)",
        [
          openId,
          tenantId,
          "Synthetic " + label,
          key + "." + label + "@example.invalid",
          role,
        ]
      );
      users.push(row.insertId);
      return { id: row.insertId, openId, tenantId, role };
    };
    const owner = await actor("owner", "user", tenants[0]);
    const otherOwner = await actor("other-owner", "user", tenants[0]);
    const foreignTenant = await actor("foreign-tenant", "user", tenants[1]);
    const member = await actor("member", "user", tenants[0]);
    const invited = await actor("invited", "user", tenants[0]);
    const finance = await actor("finance", "finance", tenants[0]);
    const administrator = await actor("super-admin", "super_admin", null);
    flightId = await fixtureFlight(tenants[0]);
    await db.execute(
      "UPDATE flights SET departureTime=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 6 HOUR),arrivalTime=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),status='scheduled',economyAvailable=economySeats-1 WHERE id=?",
      [flightId]
    );
    const [flightRows] = await db.execute<RowDataPacket[]>(
      "SELECT flightNumber FROM flights WHERE id=?",
      [flightId]
    );
    const flightNumber = String(flightRows[0].flightNumber);
    const [booking] = await db.execute<ResultSetHeader>(
      "INSERT INTO bookings (userId,tenantId,flightId,bookingReference,pnr,status,paymentStatus,seatsReserved,cabinClass,totalAmount,numberOfPassengers) VALUES (?,?,?,?,?,'confirmed','paid',true,'economy',10000,1)",
      [owner.id, tenants[0], flightId, reference, pnr]
    );
    bookingId = booking.insertId;
    const ownedBookingId = booking.insertId;
    await db.execute(
      "INSERT INTO passengers (tenantId,bookingId,firstName,lastName,type) VALUES (?,?,'Connectivity','Passenger','adult')",
      [tenants[0], bookingId]
    );
    const [company] = await db.execute<ResultSetHeader>(
      "INSERT INTO corporate_accounts (companyName,taxId,contactName,contactEmail,status) VALUES (?,?,?,?,'active')",
      [companyName, key, "Synthetic member", key + "@example.invalid"]
    );
    corporateId = company.insertId;
    await db.execute(
      "INSERT INTO corporate_users (corporateAccountId,userId,role,isActive) VALUES (?,?,'admin',true)",
      [corporateId, member.id]
    );
    await db.execute(
      "INSERT INTO corporate_invitations (id,corporateAccountId,recipientUserId,invitedBy,role,expiresAt) VALUES (?,?,?,?,'traveler',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))",
      [randomUUID(), corporateId, invited.id, member.id]
    );
    const snapshot = async () => {
      const [bookingRows] = await db.execute<RowDataPacket[]>(
        "SELECT id,userId,tenantId,bookingReference,pnr,status,paymentStatus,checkedIn,seatsReserved,totalAmount FROM bookings WHERE id=?",
        [ownedBookingId]
      );
      const [passengerRows] = await db.execute<RowDataPacket[]>(
        "SELECT id,seatNumber FROM passengers WHERE bookingId=? ORDER BY id",
        [ownedBookingId]
      );
      const [seats] = await db.execute<RowDataPacket[]>(
        "SELECT id,status,passengerId FROM seat_inventory WHERE bookingId=? ORDER BY id",
        [ownedBookingId]
      );
      const [payments] = await db.execute<RowDataPacket[]>(
        "SELECT id,status,amount FROM payments WHERE bookingId=? ORDER BY id",
        [ownedBookingId]
      );
      const [refundPlans] = await db.execute<RowDataPacket[]>(
        "SELECT id,status FROM booking_refund_plans WHERE bookingId=?",
        [ownedBookingId]
      );
      return { bookingRows, passengerRows, seats, payments, refundPlans };
    };
    return {
      owner,
      otherOwner,
      foreignTenant,
      member,
      invited,
      finance,
      administrator,
      pnr,
      reference,
      flightNumber,
      bookingId,
      companyName,
      snapshot,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Same persisted-session issuing boundary used by reporting acceptance. */
async function useActor(page: Page, actor: Actor) {
  disposableDatabaseUrl();
  await page.goto("about:blank");
  const { sdk } = await import("../server/_core/sdk");
  const { closePool } = await import("../server/db");
  let cookie: string;
  try {
    cookie = await sdk.createSessionToken(actor.openId, {
      name: "Synthetic connectivity actor",
      expiresInMs: 60 * 60 * 1000,
    });
  } finally {
    await closePool();
  }
  const url = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: cookie,
      url,
      httpOnly: true,
      secure: new URL(url).protocol === "https:",
      sameSite: "Lax",
    },
  ]);
  const client = rpc(page);
  const authenticated = await client.auth.me.query();
  expect(authenticated).toMatchObject({
    id: actor.id,
    role: actor.role,
    tenantId: actor.tenantId,
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
}

function names(request: Request) {
  const path = new URL(request.url()).pathname;
  return path.startsWith("/api/trpc/")
    ? decodeURIComponent(path.slice("/api/trpc/".length)).split(",")
    : [];
}
function inputFor(request: Request, name: string): unknown {
  const all = names(request);
  const encoded =
    new URL(request.url()).searchParams.get("input") ?? request.postData();
  if (!encoded) return undefined;
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  const value = (
    "0" in parsed ? parsed[String(all.indexOf(name))] : parsed
  ) as { json?: unknown };
  return value?.json ?? value;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "en"));
});

test("authenticated service navigation reaches notifications and exposes only eligible corporate entry", async ({
  page,
}) => {
  const fixture = await createConnectivityFixture();
  try {
    await useActor(page, fixture.owner);
    await page.goto("/");
    const checkedEligibility = page.waitForResponse(
      response =>
        names(response.request()).includes("corporate.myInvitations") &&
        response.ok()
    );
    await page
      .getByRole("button", { name: "Our Services", exact: true })
      .click();
    await checkedEligibility;
    await expect(
      page.getByRole("menuitem", { name: "Corporate Travel", exact: true })
    ).toHaveCount(0);
    await page
      .getByRole("menuitem", { name: "Notifications", exact: true })
      .click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(
      page.getByRole("heading", { name: "Notifications", exact: true })
    ).toBeVisible();
    for (const actor of [fixture.member, fixture.invited]) {
      await useActor(page, actor);
      await page.goto("/");
      await page
        .getByRole("button", { name: "Our Services", exact: true })
        .click();
      const corporate = page.getByRole("menuitem", {
        name: "Corporate Travel",
        exact: true,
      });
      await expect(corporate).toBeVisible();
      await corporate.click();
      await expect(page).toHaveURL(/\/corporate$/);
      await expect(
        page.getByRole("heading", { name: new RegExp(fixture.companyName) })
      ).toBeVisible();
    }
  } finally {
    await page.goto("about:blank");
    await fixture.cleanup();
  }
});

test("super_admin reads native refund reporting while finance remains forbidden", async ({
  page,
}) => {
  const fixture = await createConnectivityFixture();
  try {
    const before = await fixture.snapshot();
    await useActor(page, fixture.administrator);
    const required = [
      "refunds.getStats",
      "refunds.getHistory",
      "refunds.getTrends",
      "refunds.splitCancellationQueue",
    ];
    const reads = required.map(name =>
      page.waitForResponse(response => names(response.request()).includes(name))
    );
    await page.goto("/admin/refunds");
    await expect(
      page.getByRole("heading", { name: "Refunds Management", exact: true })
    ).toBeVisible();
    for (const response of await Promise.all(reads))
      expect(response.status()).toBe(200);
    await expect(
      page.getByText("Settled refund entries", { exact: true })
    ).toBeVisible();
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await useActor(page, fixture.finance);
    const client = rpc(page);
    await expect(client.refunds.getStats.query()).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
    await expect(
      client.refunds.getHistory.query({ limit: 20 })
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      client.refunds.splitCancellationQueue.query({})
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await page.goto("/admin/refunds");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Refunds Management", exact: true })
    ).toHaveCount(0);
    expect(await fixture.snapshot()).toEqual(before);
  } finally {
    await page.goto("about:blank");
    await fixture.cleanup();
  }
});

test("check-in PNR and legacy reference links resolve only the native booking owner without mutations", async ({
  page,
}) => {
  const fixture = await createConnectivityFixture();
  const requests: Request[] = [];
  const observe = (request: Request) => {
    if (names(request).length) requests.push(request);
  };
  page.on("request", observe);
  try {
    expect(fixture.pnr).not.toBe(fixture.reference);
    const before = await fixture.snapshot();
    await useActor(page, fixture.owner);
    for (const suffix of [
      "pnr=" + fixture.pnr,
      "booking=" + fixture.reference,
    ]) {
      requests.length = 0;
      await page.goto("/check-in?" + suffix);
      await expect(page.getByLabel("Passenger Name Record (PNR)")).toHaveValue(
        fixture.pnr
      );
      await expect(
        page.getByRole("button", {
          name: new RegExp("^" + fixture.flightNumber + " ·"),
        })
      ).toBeVisible();
      await expect(
        page.getByRole("checkbox", {
          name: "Connectivity Passenger",
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Check-in", exact: true })
      ).toBeEnabled();
      const lookups = requests.filter(request =>
        names(request).includes("bookings.getByPNR")
      );
      expect(lookups.length).toBeGreaterThan(0);
      expect(
        lookups.map(request => inputFor(request, "bookings.getByPNR"))
      ).toEqual(lookups.map(() => ({ pnr: fixture.pnr })));
      expect(
        requests.some(request => names(request).includes("bookings.myBookings"))
      ).toBe(suffix.startsWith("booking="));
      expect(
        requests.some(request => names(request).includes("bookings.checkIn"))
      ).toBe(false);
    }
    for (const actor of [fixture.otherOwner, fixture.foreignTenant]) {
      await useActor(page, actor);
      const denied = page.waitForResponse(response =>
        names(response.request()).includes("bookings.getByPNR")
      );
      await page.goto("/check-in?pnr=" + fixture.pnr);
      const deniedResponse = await denied;
      // Mixed tRPC batches use 207; the targeted procedure must still deny
      // access with its precise ownership/tenant error.
      expect([403, 404, 207]).toContain(deniedResponse.status());
      const body = await deniedResponse.json();
      const results = Array.isArray(body) ? body : [body];
      const result =
        results[names(deniedResponse.request()).indexOf("bookings.getByPNR")];
      expect(result?.error?.json ?? result?.error).toMatchObject({
        data: {
          code: actor.id === fixture.otherOwner.id ? "FORBIDDEN" : "NOT_FOUND",
        },
      });
      await expect(page.getByRole("alert")).toContainText(
        /Access denied|Booking not found/
      );
      await expect(
        page.getByRole("checkbox", {
          name: "Connectivity Passenger",
          exact: true,
        })
      ).toHaveCount(0);
      requests.length = 0;
      await page.goto("/check-in?booking=" + fixture.reference);
      await expect(page.getByRole("alert")).toHaveText("Booking Not Found");
      expect(
        requests.some(request => names(request).includes("bookings.getByPNR"))
      ).toBe(false);
      await expect(
        page.getByRole("button", { name: "Check-in", exact: true })
      ).toHaveCount(0);
    }
    expect(await fixture.snapshot()).toEqual(before);
  } finally {
    page.off("request", observe);
    await page.goto("about:blank");
    await fixture.cleanup();
  }
});
