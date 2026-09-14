import { createHash } from "node:crypto";
import { z } from "zod";
import {
  hotelQuote,
  type HotelQuote,
  type HotelReceipt,
  type HotelRequest,
} from "../../shared/hotel-fulfillment";

/** Bounded single-adult, single-room, net-model SAR procurement adapter.
 * Source: Hotelbeds' linked OpenAPI-Hotel-BookingAPI-3.0.yaml (API 1.0).
 * Never retries a booking/cancellation write. Reconcile by clientReference.
 */
export interface HotelProvider {
  mode: "sandbox" | "live";
  account: string;
  quote(rateKey: string): Promise<HotelQuote>;
  book(request: HotelRequest, clientReference: string): Promise<HotelReceipt>;
  lookup(
    request: HotelRequest,
    clientReference: string
  ): Promise<HotelReceipt | null>;
  cancel(
    request: HotelRequest,
    clientReference: string,
    reference: string,
    simulate: boolean
  ): Promise<HotelReceipt>;
}
const textAmount = z.union([
  z.string().regex(/^\d+(\.\d{1,2})?$/),
  z.number().finite().nonnegative(),
]);
export function moneyCents(value: unknown): number {
  const amount = textAmount.parse(value);
  const cents = Math.round(Number(amount) * 100);
  if (
    !Number.isSafeInteger(cents) ||
    cents > 2147483647 ||
    Math.abs(cents / 100 - Number(amount)) > 1e-8
  )
    throw new Error("Unsupported hotel monetary amount");
  return cents;
}
const rateSchema = z.object({
  rateKey: z.string(),
  rateType: z.literal("BOOKABLE"),
  net: textAmount,
  sellingRate: textAmount.optional(),
  hotelMandatory: z.boolean().optional(),
  commission: textAmount.optional(),
  packaging: z.boolean().optional(),
  resident: z.boolean().optional(),
  boardCode: z.enum(["RO", "BB"]),
  rooms: z.literal(1),
  adults: z.literal(1),
  children: z.literal(0),
  rateComments: z.string().min(1),
  cancellationPolicies: z.array(
    z.object({
      amount: textAmount,
      from: z.string().datetime({ offset: true }),
    })
  ),
});
const quotedHotel = z.object({
  code: z.number().int().positive(),
  checkIn: z.string().date(),
  checkOut: z.string().date(),
  currency: z.literal("SAR"),
  totalNet: textAmount,
  paymentDataRequired: z.boolean().optional(),
  rooms: z
    .array(z.object({ code: z.string(), rates: z.array(rateSchema).length(1) }))
    .length(1),
});
const bookingSchema = z.object({
  reference: z.string().min(1).max(100),
  clientReference: z.string().min(1).max(20),
  status: z.enum(["CONFIRMED", "CANCELLED"]),
  currency: z.literal("SAR"),
  totalNet: textAmount,
  cancellationReference: z.string().optional(),
  hotel: z.object({
    code: z.number(),
    checkIn: z.string(),
    checkOut: z.string(),
    cancellationAmount: textAmount.optional(),
    rooms: z
      .array(
        z.object({
          code: z.string(),
          rates: z
            .array(z.object({ boardCode: z.string(), rooms: z.number() }))
            .length(1),
        })
      )
      .length(1),
  }),
});
export function parseHotelReceipt(
  value: unknown,
  request: HotelRequest,
  clientReference: string,
  reference?: string
): HotelReceipt {
  const b = bookingSchema.parse(value);
  const q = request.quote;
  const room = b.hotel.rooms[0];
  if (
    b.clientReference !== clientReference ||
    (reference && b.reference !== reference) ||
    b.hotel.code !== q.hotelCode ||
    b.hotel.checkIn !== q.checkIn ||
    b.hotel.checkOut !== q.checkOut ||
    room?.code !== q.roomCode ||
    room.rates[0]?.boardCode !== q.boardCode ||
    room.rates[0].rooms !== 1
  )
    throw new Error("Hotel provider receipt identity mismatch");
  const totalCost = moneyCents(b.totalNet);
  if (totalCost > q.totalCost)
    throw new Error("Hotel provider amount exceeds approved quote");
  return {
    reference: b.reference,
    clientReference: b.clientReference,
    status: b.status,
    currency: "SAR",
    totalCost,
    cancellationCost:
      b.hotel.cancellationAmount === undefined
        ? null
        : moneyCents(b.hotel.cancellationAmount),
    cancellationReference: b.cancellationReference ?? null,
  };
}

export function createHotelbedsProvider(
  config: {
    apiKey: string;
    secret: string;
    mode: "sandbox" | "live";
    account: string;
  },
  http: typeof fetch = fetch,
  now: () => number = Date.now
): HotelProvider {
  const base =
    config.mode === "live"
      ? "https://api.hotelbeds.com"
      : "https://api.test.hotelbeds.com";
  async function call(
    path: string,
    method = "GET",
    body?: unknown
  ): Promise<Record<string, unknown>> {
    const signature = createHash("sha256")
      .update(config.apiKey + config.secret + Math.floor(now() / 1000))
      .digest("hex");
    const response = await http(`${base}/hotel-api/1.0${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Api-key": config.apiKey,
        "X-Signature": signature,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Hotelbeds HTTP ${response.status}; reconcile before retrying writes`
      );
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("Hotelbeds response too large");
    const result = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
    if (result.error)
      throw new Error(
        "Hotelbeds returned a provider error; outcome requires reconciliation"
      );
    return result;
  }
  return {
    mode: config.mode,
    account: config.account,
    async quote(rateKey) {
      const rs = await call("/checkrates", "POST", { rooms: [{ rateKey }] });
      // The linked schema names this field `hotels`; deployments also use `hotel`.
      if (rs.hotel && rs.hotels)
        throw new Error("Ambiguous CheckRate envelope");
      const h = quotedHotel.parse(rs.hotel ?? rs.hotels);
      const room = h.rooms[0];
      const rate = room?.rates[0];
      if (
        !room ||
        !rate ||
        h.paymentDataRequired ||
        rate.hotelMandatory ||
        rate.sellingRate !== undefined ||
        rate.commission !== undefined ||
        rate.packaging ||
        rate.resident ||
        moneyCents(rate.net) !== moneyCents(h.totalNet)
      )
        throw new Error(
          "Unsupported Hotelbeds pricing, occupancy or payment model"
        );
      return hotelQuote.parse({
        provider: "hotelbeds",
        mode: config.mode,
        account: config.account,
        hotelCode: h.code,
        roomCode: room.code,
        boardCode: rate.boardCode,
        checkIn: h.checkIn,
        checkOut: h.checkOut,
        currency: h.currency,
        totalCost: moneyCents(h.totalNet),
        rateKey: rate.rateKey,
        terms: rate.rateComments,
        cancellationPolicies: rate.cancellationPolicies.map(p => ({
          from: p.from,
          amount: moneyCents(p.amount),
        })),
        expiresAt: new Date(now() + 5 * 60000).toISOString(),
      });
    },
    async book(request, clientReference) {
      const result = await call("/bookings", "POST", {
        holder: request.holder,
        clientReference,
        tolerance: 0,
        rooms: [
          {
            rateKey: request.quote.rateKey,
            paxes: [{ roomId: 1, type: "AD", ...request.holder }],
          },
        ],
      });
      return parseHotelReceipt(result.booking, request, clientReference);
    },
    async lookup(request, clientReference) {
      const params = new URLSearchParams({
        clientReference,
        filterType: "CHECKIN",
        start: request.quote.checkIn,
        end: request.quote.checkIn,
        status: "ALL",
        from: "1",
        to: "25",
      });
      const result = await call(`/bookings?${params}`);
      const list = z
        .object({
          bookings: z.array(
            z.object({ reference: z.string(), clientReference: z.string() })
          ),
        })
        .parse(result.bookings);
      const matches = list.bookings.filter(
        b => b.clientReference === clientReference
      );
      if (matches.length > 1 || list.bookings.length >= 25)
        throw new Error(
          "Ambiguous provider reconciliation; manual review required"
        );
      const match = matches[0];
      if (!match) return null; // Absence is not permission to repeat POST.
      const detail = await call(
        `/bookings/${encodeURIComponent(match.reference)}`
      );
      return parseHotelReceipt(
        detail.booking,
        request,
        clientReference,
        match.reference
      );
    },
    async cancel(request, clientReference, reference, simulate) {
      const rs = await call(
        `/bookings/${encodeURIComponent(reference)}?cancellationFlag=${simulate ? "SIMULATION" : "CANCELLATION"}`,
        "DELETE"
      );
      return parseHotelReceipt(rs.booking, request, clientReference, reference);
    },
  };
}

export function configuredHotelProvider(): HotelProvider | null {
  const mode = process.env.HOTELBEDS_MODE;
  if (!mode || mode === "disabled") return null;
  if (mode !== "sandbox" && mode !== "live")
    throw new Error("Invalid HOTELBEDS_MODE");
  if (mode === "live" && !process.env.HOTELBEDS_ACCEPTANCE_REFERENCE?.trim())
    throw new Error("Live Hotelbeds requires recorded provider acceptance");
  const apiKey = process.env.HOTELBEDS_API_KEY;
  const secret = process.env.HOTELBEDS_SECRET;
  if (!apiKey || !secret)
    throw new Error("Hotelbeds credentials are not configured");
  return createHotelbedsProvider({
    apiKey,
    secret,
    mode,
    account: createHash("sha256").update(`${mode}:${apiKey}`).digest("hex"),
  });
}
