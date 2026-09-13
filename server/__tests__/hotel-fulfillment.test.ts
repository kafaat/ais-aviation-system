import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { emergencyHotelBookings } from "../../drizzle/schema";
import {
  fulfillHotelRequest,
  nightsBetween,
} from "../services/hotel-fulfillment.service";
import { createHotelbedsProvider, moneyCents } from "../integrations/hotelbeds";
import { transactionMemory } from "./helpers/transaction-memory";
import {
  hotelFixtureRequest as request,
  hotelFixtureReceipt as receipt,
  hotelFixtureProvider,
  providerBookingBody,
} from "./fixtures/hotel-provider";

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    emergency_hotel_bookings: [
      {
        id: 1,
        bookingId: 4,
        tenantId: 3,
        status: "pending_provider",
        requestReference: receipt.clientReference,
        confirmationNumber: null,
        providerRequest: request,
        providerLeaseUntil: null,
      },
    ],
  });
});
const row = () => fixture.rows("emergency_hotel_bookings")[0];
describe("durable hotel fulfillment", () => {
  it("records a sandbox receipt without claiming a real reservation", async () => {
    const provider = hotelFixtureProvider();
    await fulfillHotelRequest(fixture.db, 1, provider);
    expect(row()).toMatchObject({
      status: "sandbox_confirmed",
      confirmationNumber: receipt.reference,
    });
    expect(fixture.rows("outbox")[0]).toMatchObject({
      tenantId: 3,
      eventType: "hotel.sandbox_confirmed",
    });
    await fulfillHotelRequest(fixture.db, 1, provider);
    expect(provider.book).toHaveBeenCalledTimes(1);
  });
  it("reconciles a lost POST response without issuing a second booking", async () => {
    const provider = hotelFixtureProvider();
    vi.mocked(provider.book).mockRejectedValueOnce(
      new Error("connection reset")
    );
    await expect(fulfillHotelRequest(fixture.db, 1, provider)).rejects.toThrow(
      "reset"
    );
    expect(row().status).toBe("outcome_unknown");
    expect(row().providerLease).toBeNull();
    await fulfillHotelRequest(fixture.db, 1, provider);
    expect(provider.book).toHaveBeenCalledTimes(1);
    expect(provider.lookup).toHaveBeenCalledTimes(1);
    expect(row().status).toBe("sandbox_confirmed");
  });
  it("keeps not-found reconciliation unknown even across repeated attempts", async () => {
    const provider = hotelFixtureProvider();
    vi.mocked(provider.book).mockRejectedValue(new Error("timeout"));
    vi.mocked(provider.lookup).mockResolvedValue(null);
    for (let i = 0; i < 3; i++)
      await expect(
        fulfillHotelRequest(fixture.db, 1, provider)
      ).rejects.toThrow();
    expect(provider.book).toHaveBeenCalledTimes(1);
    expect(row().status).toBe("outcome_unknown");
  });
  it("rolls back receipt and state when event recording fails, then uses lookup", async () => {
    fixture.failInsert("outbox");
    const provider = hotelFixtureProvider();
    await expect(fulfillHotelRequest(fixture.db, 1, provider)).rejects.toThrow(
      "Injected"
    );
    expect(row().status).toBe("outcome_unknown");
    fixture.failInsert("");
    await fulfillHotelRequest(fixture.db, 1, provider);
    expect(provider.book).toHaveBeenCalledTimes(1);
    expect(fixture.rows("outbox")).toHaveLength(1);
  });
  it("does not use credentials for a different provider account", async () => {
    const provider = hotelFixtureProvider();
    provider.account = "different-account";
    await expect(fulfillHotelRequest(fixture.db, 1, provider)).rejects.toThrow(
      "account"
    );
    expect(provider.book).not.toHaveBeenCalled();
  });
  it("expires an unsent quote without a provider write", async () => {
    const expired = structuredClone(request);
    expired.quote.expiresAt = "2020-01-01T00:00:00Z";
    await fixture.db
      .update(emergencyHotelBookings)
      .set({ providerRequest: expired })
      .where(eq(emergencyHotelBookings.id, 1));
    const provider = hotelFixtureProvider();
    await fulfillHotelRequest(fixture.db, 1, provider);
    expect(row().status).toBe("rejected");
    expect(provider.book).not.toHaveBeenCalled();
  });
  it("requires a cancellation acknowledgement and never mistakes simulation for cancellation", async () => {
    await fixture.db
      .update(emergencyHotelBookings)
      .set({
        status: "cancellation_pending",
        confirmationNumber: receipt.reference,
      })
      .where(eq(emergencyHotelBookings.id, 1));
    const provider = hotelFixtureProvider();
    vi.mocked(provider.cancel).mockImplementation(
      async (_r, _c, _ref, simulate) => {
        if (simulate) return { ...receipt, cancellationCost: 0 };
        throw new Error("lost cancellation response");
      }
    );
    await expect(fulfillHotelRequest(fixture.db, 1, provider)).rejects.toThrow(
      "lost"
    );
    expect(row().status).toBe("cancellation_unknown");
    vi.mocked(provider.lookup).mockResolvedValue({
      ...receipt,
      status: "CANCELLED",
      cancellationCost: 0,
      cancellationReference: "CANCELLED-FIXTURE",
    });
    await fulfillHotelRequest(fixture.db, 1, provider);
    expect(provider.cancel).toHaveBeenCalledTimes(2);
    expect(row().status).toBe("cancelled");
  });
  it("stops cancellation before a fee above the operator ceiling", async () => {
    await fixture.db
      .update(emergencyHotelBookings)
      .set({
        status: "cancellation_pending",
        confirmationNumber: receipt.reference,
      })
      .where(eq(emergencyHotelBookings.id, 1));
    const provider = hotelFixtureProvider();
    vi.mocked(provider.cancel).mockResolvedValue({
      ...receipt,
      cancellationCost: 50,
    });
    await expect(fulfillHotelRequest(fixture.db, 1, provider)).rejects.toThrow(
      "fee"
    );
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    expect(row().status).toBe("cancellation_pending");
  });
  it("rejects reversed/invalid stays and unsupported monetary precision", () => {
    expect(() => nightsBetween(new Date("invalid"), new Date())).toThrow();
    expect(() =>
      nightsBetween(new Date("2035-01-02"), new Date("2035-01-01"))
    ).toThrow();
    expect(() => moneyCents("1.234")).toThrow();
    expect(() => moneyCents(Infinity)).toThrow();
  });
});
describe("Hotelbeds HTTP boundary", () => {
  const client = (http: typeof fetch) =>
    createHotelbedsProvider(
      {
        mode: "sandbox",
        account: "fixture-account",
        apiKey: "fixture-only-key",
        secret: "fixture-only-secret",
      },
      http
    );
  const quoteBody = (
    rateChange: Record<string, unknown> = {},
    hotelChange: Record<string, unknown> = {}
  ) => ({
    hotel: {
      code: 123,
      checkIn: "2035-01-01",
      checkOut: "2035-01-02",
      currency: "SAR",
      totalNet: "120.00",
      rooms: [
        {
          code: "SGL.ST",
          rates: [
            {
              rateKey: "rechecked-fixture-rate",
              rateType: "BOOKABLE",
              net: "120.00",
              boardCode: "RO",
              rooms: 1,
              adults: 1,
              children: 0,
              rateComments: "Fixture conditions, local fees payable separately",
              cancellationPolicies: [
                { amount: "120.00", from: "2034-12-31T00:00:00Z" },
              ],
              ...rateChange,
            },
          ],
        },
      ],
      ...hotelChange,
    },
  });
  it("rechecks and exposes exact supplier terms and SAR cost before approval", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(quoteBody())));
    expect(await client(http).quote("availability-rate")).toMatchObject({
      rateKey: "rechecked-fixture-rate",
      totalCost: 12000,
      currency: "SAR",
      boardCode: "RO",
    });
    expect(JSON.parse(String(http.mock.calls[0]?.[1]?.body))).toEqual({
      rooms: [{ rateKey: "availability-rate" }],
    });
  });
  it.each([
    { rateType: "RECHECK" },
    { sellingRate: "140.00" },
    { commission: "20.00" },
    { children: 1 },
    { packaging: true },
    { rateComments: "" },
  ])("blocks unsupported rate conditions %j", async rate => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(quoteBody(rate))));
    await expect(client(http).quote("availability-rate")).rejects.toThrow();
  });
  it("does not convert a foreign-currency quote into SAR", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(quoteBody({}, { currency: "USD" })))
      );
    await expect(client(http).quote("availability-rate")).rejects.toThrow();
  });
  it("uses signed headers, zero price tolerance and the stable client reference", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(providerBookingBody())));
    await client(http).book(request, receipt.clientReference);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe("https://api.test.hotelbeds.com/hotel-api/1.0/bookings");
    expect(init?.headers).toMatchObject({
      "X-Signature": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      clientReference: receipt.clientReference,
      tolerance: 0,
    });
  });
  it.each(["identity", "amount", "currency"])(
    "rejects a %s mismatch",
    async mismatch => {
      const body = providerBookingBody();
      if (mismatch === "identity") body.booking.hotel.code = 999;
      if (mismatch === "amount") body.booking.totalNet = 200;
      if (mismatch === "currency") body.booking.currency = "USD";
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(
        client(http).book(request, receipt.clientReference)
      ).rejects.toThrow();
    }
  );
  it("performs no automatic POST retry on HTTP 500", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 500 }));
    await expect(
      client(http).book(request, receipt.clientReference)
    ).rejects.toThrow("HTTP 500");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("looks up client reference and verifies booking detail, without another write", async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            bookings: {
              bookings: [
                {
                  reference: receipt.reference,
                  clientReference: receipt.clientReference,
                },
              ],
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(providerBookingBody()))
      );
    expect(
      await client(http).lookup(request, receipt.clientReference)
    ).toMatchObject({ reference: receipt.reference });
    expect(String(http.mock.calls[0]?.[0])).toContain(
      `clientReference=${receipt.clientReference}`
    );
    expect(http.mock.calls.every(c => c[1]?.method === "GET")).toBe(true);
  });
});
