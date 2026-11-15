import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { router } from "../_core/trpc";
import { kioskRouter } from "./kiosk";

/**
 * Review finding R2 (#355): kiosk.authenticate is a public reference-plus-
 * surname sign-in and was outside every strict quota, so a reference could be
 * guessed at the ordinary request rate. It now carries the same two bounds as
 * manageBooking.lookup: the caller address through the procedure middleware
 * and the reference itself inside the handler. The real middleware and the
 * in-memory limiter fallback are exercised here; the lookup itself is a stub
 * that answers "no booking", and its call count shows that a refused attempt
 * never reaches the lookup.
 */
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
vi.mock("../db", () => ({ getDb: () => null }));
const lookup = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("../services/kiosk.service", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/kiosk.service")>()),
  authenticatePassenger: lookup.authenticate,
}));

// Nested on purpose: the middleware keys its scope on the full path
// "kiosk.authenticate"; a bare router caller would lose the prefix.
const app = router({ kiosk: kioskRouter });

let nextOctet = 10;
const context = (ip?: string) =>
  ({
    user: null,
    authMethod: null,
    tenantId: null,
    req: { ip: ip ?? `203.0.113.${nextOctet++}`, headers: {}, method: "POST" },
    res: { setHeader: vi.fn() },
  }) as unknown as TrpcContext;
const limited = { code: "TOO_MANY_REQUESTS" };
const notFound = { code: "NOT_FOUND" };
let referenceSerial = 0;
const freshReference = () => `K${String(++referenceSerial).padStart(5, "0")}`;

beforeEach(() => {
  lookup.authenticate.mockReset().mockImplementation(async () => {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No booking found with the provided reference and last name.",
    });
  });
});

describe("kiosk sign-in guessing quota (R2)", () => {
  it("bounds one address to ten attempts per window, whatever references it tries", async () => {
    const ctx = context();
    const api = app.createCaller(ctx).kiosk;
    for (let i = 0; i < 10; i++)
      await expect(
        api.authenticate({ bookingRef: freshReference(), lastName: "Nobody" })
      ).rejects.toMatchObject(notFound);
    await expect(
      api.authenticate({ bookingRef: freshReference(), lastName: "Nobody" })
    ).rejects.toMatchObject(limited);
    expect(ctx.res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "10");
    // The eleventh attempt was refused before the lookup ran.
    expect(lookup.authenticate).toHaveBeenCalledTimes(10);
    // Another address is not affected by the first one's attempts.
    await expect(
      app.createCaller(context()).kiosk.authenticate({
        bookingRef: freshReference(),
        lastName: "Nobody",
      })
    ).rejects.toMatchObject(notFound);
  });

  it("bounds one reference to five attempts per window across many addresses", async () => {
    const bookingRef = freshReference();
    for (let i = 0; i < 5; i++)
      await expect(
        app
          .createCaller(context())
          .kiosk.authenticate({ bookingRef, lastName: `Guess${i}` })
      ).rejects.toMatchObject(notFound);
    // A different letter case does not open a fresh budget for the reference.
    await expect(
      app.createCaller(context()).kiosk.authenticate({
        bookingRef: bookingRef.toLowerCase(),
        lastName: "Guess",
      })
    ).rejects.toMatchObject(limited);
    expect(lookup.authenticate).toHaveBeenCalledTimes(5);
  });

  it("does not spend the sign-in budget on the other kiosk procedures", async () => {
    const ctx = context();
    const api = app.createCaller(ctx).kiosk;
    for (let i = 0; i < 12; i++)
      await expect(
        api.getCheckInData({ capabilityToken: "x".repeat(48) })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      api.authenticate({ bookingRef: freshReference(), lastName: "Nobody" })
    ).rejects.toMatchObject(notFound);
  });
});
