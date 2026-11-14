import { createHash, createHmac } from "node:crypto";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";

/**
 * Scenario S-27 of docs/architecture/improvement-plan-2026-11.md: a behavioral
 * control test per public-mutation family. The S-20 allowlist names the
 * handler-level control that stands in for a session on every public
 * mutation; this suite drives one representative mutation of each credential
 * family through the real router with an anonymous context and checks four
 * cells: no credential, an invalid credential, a valid credential used outside
 * its scope, and the authorized call. The first three are refused with a
 * client error and leave the fixture unchanged; the fourth is admitted and
 * writes exactly what it should.
 *
 * Families (from server/__tests__/fixtures/public-procedures.json):
 *   1. agent API key            travelAgent.validateCredentials / searchFlights
 *   2. signed envelope          aviationIntegrations.ingestOperations
 *   3. self-service capability  kiosk.addAncillary, bagDrop.initiate
 *   4. provider signature       webhooks.stripe
 *   5. share token              splitPayments.createPayerCheckout
 */
const state = vi.hoisted(() => {
  // The webhook module reads its secret when it loads.
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_s27_fixture_secret_0123456789";
  return {
    db: null as unknown,
    checkout: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() },
  };
});
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../services/email.service", () => ({}));
vi.mock("../stripe", async importOriginal => {
  const original = await importOriginal<typeof import("../stripe")>();
  const sdk = new Stripe("sk_test_s27_signature_only");
  return {
    ...original,
    stripe: { webhooks: sdk.webhooks, checkout: { sessions: state.checkout } },
  };
});

import { router } from "../_core/trpc";
import { aviationIntegrationsRouter } from "../routers/aviation-integrations";
import { bagDropRouter } from "../routers/bag-drop";
import { kioskRouter } from "../routers/kiosk";
import { splitPaymentsRouter } from "../routers/split-payments";
import { travelAgentRouter } from "../routers/travel-agent";
import { webhooksRouter } from "../routers/webhooks";
import { calculateRequestHash } from "../services/idempotency-v2.service";
import type { EvidenceEnvelope } from "../services/aviation-evidence.service";
import { initiateBagDrop } from "../services/bag-drop.service";
import { issueBoardingPass } from "../services/boarding-pass.service";
import {
  issueSelfServiceCapability,
  verifySelfServiceCapability,
} from "../services/self-service-capability.service";

const surface = router({
  travelAgent: travelAgentRouter,
  aviationIntegrations: aviationIntegrationsRouter,
  kiosk: kioskRouter,
  bagDrop: bagDropRouter,
  webhooks: webhooksRouter,
  splitPayments: splitPaymentsRouter,
});

/** Anonymous caller: no session, a request so the rate limiter path runs. */
const anonymous = () =>
  surface.createCaller({
    user: null,
    tenantId: null,
    authMethod: null,
    req: { headers: {}, ip: "203.0.113.5" },
    res: {},
  } as unknown as TrpcContext);

type Fixture = ReturnType<typeof transactionMemory>;
let fixture: Fixture;
const use = (seed: Record<string, unknown[]>) => {
  fixture = transactionMemory(seed);
  state.db = fixture.db;
  return fixture;
};
/** Snapshot of every table, to prove a refusal changed nothing. */
const snapshot = (f: Fixture, tables: string[]) =>
  JSON.stringify(Object.fromEntries(tables.map(t => [t, f.rows(t)])));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe("S-27 family 1: agent API key (travelAgent)", () => {
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  const good = { apiKey: "ak_fixture_linked_agent", apiSecret: "secret-one" };
  const unlinked = { apiKey: "ak_fixture_unlinked", apiSecret: "secret-two" };
  const inactive = { apiKey: "ak_fixture_inactive", apiSecret: "secret-three" };
  const tables = ["travel_agents", "bookings", "flights", "users"];
  const search = {
    originCode: "AAA",
    destinationCode: "BBB",
    departureDate: new Date("2030-01-01T00:00:00Z"),
    cabinClass: "economy" as const,
    passengers: 1,
  };

  beforeEach(() => {
    use({
      tenants: [{ id: 3, status: "active" }],
      users: [{ id: 7, tenantId: 3, role: "user", status: "active" }],
      travel_agents: [
        {
          id: 1,
          agencyName: "Linked Agency",
          apiKey: good.apiKey,
          apiSecret: sha256(good.apiSecret),
          isActive: true,
          ownerUserId: 7,
        },
        {
          id: 2,
          agencyName: "Unlinked Agency",
          apiKey: unlinked.apiKey,
          apiSecret: sha256(unlinked.apiSecret),
          isActive: true,
          ownerUserId: null,
        },
        {
          id: 3,
          agencyName: "Closed Agency",
          apiKey: inactive.apiKey,
          apiSecret: sha256(inactive.apiSecret),
          isActive: false,
          ownerUserId: 7,
        },
      ],
      airports: [
        { id: 1, code: "AAA", timezone: "UTC" },
        { id: 2, code: "BBB", timezone: "UTC" },
      ],
      flights: [],
      bookings: [],
    });
  });

  it("refuses a missing credential before any lookup", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().travelAgent.validateCredentials({ apiKey: "", apiSecret: "" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(snapshot(fixture, tables)).toBe(before);
  });

  it("refuses an unknown key and a wrong secret without touching the agent", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().travelAgent.validateCredentials({
        apiKey: "ak_fixture_unknown",
        apiSecret: good.apiSecret,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous().travelAgent.validateCredentials({
        apiKey: good.apiKey,
        apiSecret: "not-the-secret",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(snapshot(fixture, tables)).toBe(before);
    expect(fixture.rows("travel_agents")[0].lastActiveAt).toBeUndefined();
  });

  it("refuses a valid key outside its scope: closed agency, or agency without an account owner", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().travelAgent.searchFlights({ credentials: inactive, search })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(snapshot(fixture, tables)).toBe(before);
    await expect(
      anonymous().travelAgent.searchFlights({ credentials: unlinked, search })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // The only field a valid key may touch on refusal is its own last-active mark.
    expect(fixture.rows("bookings")).toEqual([]);
    expect(fixture.rows("travel_agents")[0].lastActiveAt).toBeUndefined();
  });

  it("admits the linked agency's key", async () => {
    await expect(
      anonymous().travelAgent.validateCredentials(good)
    ).resolves.toMatchObject({
      valid: true,
      agentId: 1,
      agencyName: "Linked Agency",
    });
    expect(fixture.rows("travel_agents")[0].lastActiveAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
describe("S-27 family 2: signed envelope (aviationIntegrations.ingestOperations)", () => {
  const key = "s27-operations-fixture-key-32-characters";
  const otherKey = "s27-foreign-signing-key-32-characters!!";
  const sign = (e: EvidenceEnvelope, k = key) =>
    createHmac("sha256", k).update(calculateRequestHash(e)).digest("hex");
  const envelope = (
    flightId: number,
    sourceId = "airport-1"
  ): EvidenceEnvelope => ({
    sourceId,
    eventId: `event-${flightId}-${sourceId}`,
    issuedAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    flightId,
    kind: "departure_estimate",
    payload: { time: new Date(Date.now() + 3600000).toISOString() },
  });
  const tables = ["aviation_evidence", "flights", "outbox"];

  beforeEach(() => {
    vi.stubEnv("AVIATION_S27_KEY", key);
    vi.stubEnv(
      "AVIATION_SOURCE_REGISTRY",
      JSON.stringify([
        {
          sourceId: "airport-1",
          tenantId: 3,
          capabilities: ["operations"],
          secretEnv: "AVIATION_S27_KEY",
          validUntil: "2030-01-01T00:00:00Z",
        },
        {
          sourceId: "handler-2",
          tenantId: 3,
          capabilities: ["baggage"],
          secretEnv: "AVIATION_S27_KEY",
          validUntil: "2030-01-01T00:00:00Z",
        },
      ])
    );
    use({
      tenants: [
        { id: 3, status: "active" },
        { id: 4, status: "active" },
      ],
      flights: [
        { id: 11, tenantId: 3, departureTime: new Date(Date.now() + 3600000) },
        { id: 12, tenantId: 4, departureTime: new Date(Date.now() + 3600000) },
      ],
      aviation_evidence: [],
      outbox: [],
    });
  });

  it("refuses an envelope without a signature", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().aviationIntegrations.ingestOperations({
        envelope: envelope(11),
        signature: "",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(snapshot(fixture, tables)).toBe(before);
  });

  it("refuses a foreign key, an unknown source and a source without the capability", async () => {
    const before = snapshot(fixture, tables);
    const e = envelope(11);
    await expect(
      anonymous().aviationIntegrations.ingestOperations({
        envelope: e,
        signature: sign(e, otherKey),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const unknown = envelope(11, "nobody-9");
    await expect(
      anonymous().aviationIntegrations.ingestOperations({
        envelope: unknown,
        signature: sign(unknown),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const baggageOnly = envelope(11, "handler-2");
    await expect(
      anonymous().aviationIntegrations.ingestOperations({
        envelope: baggageOnly,
        signature: sign(baggageOnly),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(snapshot(fixture, tables)).toBe(before);
  });

  it("refuses a correctly signed envelope aimed at another tenant's flight", async () => {
    const before = snapshot(fixture, tables);
    const foreign = envelope(12);
    await expect(
      anonymous().aviationIntegrations.ingestOperations({
        envelope: foreign,
        signature: sign(foreign),
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Source cannot write this flight instance",
    });
    expect(snapshot(fixture, tables)).toBe(before);
  });

  it("admits the source's own signed event once", async () => {
    const e = envelope(11);
    const receipt = await anonymous().aviationIntegrations.ingestOperations({
      envelope: e,
      signature: sign(e),
    });
    expect(receipt).toMatchObject({ duplicate: false });
    expect(receipt.evidenceId).toBeGreaterThan(0);
    expect(fixture.rows("aviation_evidence")).toHaveLength(1);
    expect(fixture.rows("aviation_evidence")[0]).toMatchObject({
      sourceId: "airport-1",
      flightId: 11,
    });
  });
});

// ---------------------------------------------------------------------------
describe("S-27 family 3: self-service capability token (kiosk, bagDrop)", () => {
  const kioskToken = issueSelfServiceCapability({
    kind: "kiosk-session",
    sessionId: 9,
    bookingId: 10,
    passengerIds: [11],
  });
  const bagSessionToken = issueSelfServiceCapability({
    kind: "bag-drop-session",
    bookingId: 10,
    passengerId: 11,
    sessionId: 5,
  });
  const kioskTables = ["booking_ancillaries", "kiosk_sessions", "bookings"];

  function kioskFixture() {
    return use({
      bookings: [
        {
          id: 10,
          status: "confirmed",
          paymentStatus: "paid",
          cabinClass: "economy",
          totalAmount: 12000,
        },
      ],
      passengers: [
        { id: 11, bookingId: 10, firstName: "A", lastName: "Traveler" },
        { id: 22, bookingId: 10, firstName: "B", lastName: "Traveler" },
      ],
      booking_segments: [{ id: 1, bookingId: 10, flightId: 12 }],
      ancillary_services: [
        {
          id: 1,
          code: "BAG",
          name: "Bag",
          category: "baggage",
          price: 5000,
          currency: "SAR",
          available: true,
        },
      ],
      booking_ancillaries: [],
      kiosk_sessions: [],
    });
  }

  it("kiosk: refuses a missing token, a forged token and a token of another kind", async () => {
    kioskFixture();
    const before = snapshot(fixture, kioskTables);
    const attempt = (capabilityToken: string) =>
      anonymous().kiosk.addAncillary({
        capabilityToken,
        passengerId: 11,
        serviceType: "BAG",
        flightId: 12,
      });
    await expect(attempt("")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(attempt("x".repeat(48))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(attempt(bagSessionToken)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(snapshot(fixture, kioskTables)).toBe(before);
  });

  it("kiosk: refuses a valid session token for a passenger outside the session", async () => {
    kioskFixture();
    const before = snapshot(fixture, kioskTables);
    await expect(
      anonymous().kiosk.addAncillary({
        capabilityToken: kioskToken,
        passengerId: 22,
        serviceType: "BAG",
        flightId: 12,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Passenger is outside this kiosk session",
    });
    expect(snapshot(fixture, kioskTables)).toBe(before);
  });

  // Bag drop carries the family's authorized cell: a boarding pass is scanned
  // into an admission token, and the admission token opens a session.
  const bagTables = ["bag_drop_sessions", "seat_inventory", "bookings"];
  function itinerary() {
    const flightIds = [11, 12];
    return use({
      bookings: [
        {
          id: 3,
          userId: 7,
          tenantId: 1,
          flightId: 11,
          status: "confirmed",
          paymentStatus: "paid",
          cabinClass: "economy",
          bookingReference: "TR1234",
          pnr: "TR1234",
        },
      ],
      passengers: [
        {
          id: 4,
          bookingId: 3,
          tenantId: 1,
          firstName: "Sample",
          lastName: "Traveler",
        },
      ],
      airlines: [{ id: 1, code: "SV", name: "Sample Carrier" }],
      airports: [
        { id: 1, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
        { id: 2, code: "JED", country: "SA", timezone: "Asia/Riyadh" },
        { id: 3, code: "DMM", country: "SA", timezone: "Asia/Riyadh" },
      ],
      flights: flightIds.map((id, i) => ({
        id,
        tenantId: 1,
        flightNumber: "SV" + id,
        airlineId: 1,
        originId: i + 1,
        destinationId: i + 2,
        status: "scheduled",
        departureTime: new Date(Date.now() + (2 + i * 3) * 3600000),
        arrivalTime: new Date(Date.now() + (3 + i * 3) * 3600000),
      })),
      booking_segments: flightIds.map((flightId, i) => ({
        id: 11 + i,
        bookingId: 3,
        flightId,
        segmentOrder: i + 1,
        status: "confirmed",
        seatsReserved: true,
      })),
      seat_inventory: flightIds.map((flightId, i) => ({
        id: 5 + i,
        flightId,
        bookingId: 3,
        passengerId: 4,
        status: "checked_in",
        checkedInAt: new Date(),
        checkInNonce: "8c78e2e3-99ef-4c26-9838-a61bc155168e",
        boardingSequence: 1,
        seatNumber: "12A",
        cabinClass: "economy",
      })),
      bag_drop_sessions: [],
    });
  }
  const pass = async (flightId: number) =>
    (
      await issueBoardingPass(
        { bookingId: 3, passengerId: 4, flightId },
        { userId: 7, tenantId: 1 }
      )
    ).token;

  it("bag drop: refuses a missing, forged or wrong-kind admission token without opening a session", async () => {
    itinerary();
    const before = snapshot(fixture, bagTables);
    await expect(
      anonymous().bagDrop.initiate({ capabilityToken: "" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      anonymous().bagDrop.initiate({ capabilityToken: "y".repeat(48) })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous().bagDrop.initiate({ capabilityToken: kioskToken })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous().bagDrop.scanPass({ boardingPassToken: "z".repeat(64) })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(snapshot(fixture, bagTables)).toBe(before);
  });

  it("bag drop: refuses a genuine admission token scoped to the onward leg, then admits the primary leg", async () => {
    itinerary();
    const onward = await anonymous().bagDrop.scanPass({
      boardingPassToken: await pass(12),
    });
    await expect(
      anonymous().bagDrop.initiate({ capabilityToken: onward.capabilityToken })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("bag_drop_sessions")).toHaveLength(0);

    const primary = await anonymous().bagDrop.scanPass({
      boardingPassToken: await pass(11),
    });
    expect(primary).toMatchObject({
      success: true,
      bookingId: 3,
      passengerId: 4,
    });
    // The admitted token carries the pass's scope. The session is opened
    // through the service here because the in-memory fixture does not apply
    // column defaults, which the router's output contract requires; the
    // native admission journey covers the router end to end.
    const admission = verifySelfServiceCapability(
      primary.capabilityToken,
      "bag-drop-admission"
    );
    expect(admission).toMatchObject({
      bookingId: 3,
      passengerId: 4,
      flightId: 11,
    });
    const session = await initiateBagDrop(
      admission.bookingId,
      admission.passengerId,
      admission
    );
    expect(session.entitlementSegmentId).toBe(11);
    expect(fixture.rows("bag_drop_sessions")).toHaveLength(1);
    expect(fixture.rows("bag_drop_sessions")[0]).toMatchObject({
      bookingId: 3,
      passengerId: 4,
    });
  });
});

// ---------------------------------------------------------------------------
describe("S-27 family 4: provider signature (webhooks.stripe)", () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  const sdk = new Stripe("sk_test_s27_signature_only");
  const body = JSON.stringify({
    id: "evt_s27_unhandled_1",
    object: "event",
    type: "customer.created",
    api_version: "2024-06-20",
    data: { object: { id: "cus_s27", object: "customer" } },
  });
  const header = (
    payload: string,
    opts: { secret?: string; timestamp?: number } = {}
  ) =>
    sdk.webhooks.generateTestHeaderString({
      payload,
      secret: opts.secret ?? secret,
      timestamp: opts.timestamp,
    });

  beforeEach(() => {
    use({ stripe_events: [], bookings: [], payments: [] });
  });

  it("refuses a body without a signature", async () => {
    await expect(
      anonymous().webhooks.stripe({ body, signature: "" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("stripe_events")).toEqual([]);
  });

  it("refuses a signature made with another secret", async () => {
    await expect(
      anonymous().webhooks.stripe({
        body,
        signature: header(body, { secret: "whsec_someone_elses_secret_value" }),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("stripe_events")).toEqual([]);
  });

  it("refuses a genuine signature used outside its scope: another body, or a replay from the past", async () => {
    const altered = body.replace("cus_s27", "cus_other");
    await expect(
      anonymous().webhooks.stripe({ body: altered, signature: header(body) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stale = Math.floor(Date.now() / 1000) - 24 * 3600;
    await expect(
      anonymous().webhooks.stripe({
        body,
        signature: header(body, { timestamp: stale }),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("stripe_events")).toEqual([]);
  });

  it("admits a correctly signed event and records it exactly once", async () => {
    await expect(
      anonymous().webhooks.stripe({ body, signature: header(body) })
    ).resolves.toEqual({
      received: true,
      duplicate: false,
      eventId: "evt_s27_unhandled_1",
    });
    expect(fixture.rows("stripe_events")).toHaveLength(1);
    expect(fixture.rows("stripe_events")[0]).toMatchObject({
      id: "evt_s27_unhandled_1",
      type: "customer.created",
      processed: true,
    });
    await expect(
      anonymous().webhooks.stripe({ body, signature: header(body) })
    ).resolves.toMatchObject({ received: true, duplicate: true });
    expect(fixture.rows("stripe_events")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("S-27 family 5: share token (splitPayments.createPayerCheckout)", () => {
  const token = "a".repeat(64);
  const expiredToken = "b".repeat(64);
  const tables = ["payment_splits", "bookings", "outbox"];

  beforeEach(() => {
    vi.stubEnv("FRONTEND_URL", "https://app.example.test");
    use({
      tenants: [{ id: 3, status: "active" }],
      bookings: [
        {
          id: 7,
          userId: 9,
          tenantId: 3,
          flightId: 4,
          cabinClass: "economy",
          numberOfPassengers: 1,
          bookingReference: "SPLIT7",
          pnr: "SPLIT7",
          totalAmount: 10000,
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: false,
        },
      ],
      flights: [
        {
          id: 4,
          tenantId: 3,
          airlineId: 2,
          status: "scheduled",
          economyAvailable: 5,
          businessAvailable: 5,
          departureTime: new Date("2035-01-01T10:00:00Z"),
        },
      ],
      payment_splits: [
        {
          id: 1,
          amount: 4000,
          paymentToken: token,
          expiresAt: new Date(Date.now() + 86400000),
        },
        {
          id: 2,
          amount: 6000,
          paymentToken: expiredToken,
          expiresAt: new Date(Date.now() - 1000),
        },
      ].map(s => ({
        ...s,
        bookingId: 7,
        payerEmail: `payer${s.id}@example.test`,
        payerName: "Payer",
        percentage: String(s.amount / 100),
        status: "pending",
        checkoutRequestId: null,
        checkoutRequestPayload: null,
        checkoutRequestedAt: null,
        checkoutStatus: null,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
      })),
      outbox: [],
    });
    state.checkout.create.mockImplementation(async (request: any) => ({
      id: "cs_s27_1",
      mode: "payment",
      amount_total: request.line_items[0].price_data.unit_amount,
      currency: "sar",
      metadata: request.metadata,
      status: "open",
      payment_status: "unpaid",
      url: "https://checkout.stripe.com/s27",
    }));
  });

  it("refuses a missing token before any lookup", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().splitPayments.createPayerCheckout({ paymentToken: "" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(snapshot(fixture, tables)).toBe(before);
    expect(state.checkout.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown token of the right shape", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().splitPayments.createPayerCheckout({
        paymentToken: "c".repeat(64),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      anonymous().splitPayments.createPayerCheckout({
        paymentToken: "Z".repeat(64),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(snapshot(fixture, tables)).toBe(before);
    expect(state.checkout.create).not.toHaveBeenCalled();
  });

  it("refuses a genuine token whose share is no longer payable", async () => {
    const before = snapshot(fixture, tables);
    await expect(
      anonymous().splitPayments.createPayerCheckout({
        paymentToken: expiredToken,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(snapshot(fixture, tables)).toBe(before);
    expect(state.checkout.create).not.toHaveBeenCalled();
  });

  it("admits the payable share's token and opens exactly one checkout for it", async () => {
    await expect(
      anonymous().splitPayments.createPayerCheckout({ paymentToken: token })
    ).resolves.toEqual({
      sessionId: "cs_s27_1",
      url: "https://checkout.stripe.com/s27",
    });
    expect(state.checkout.create).toHaveBeenCalledTimes(1);
    const [request] = state.checkout.create.mock.calls[0];
    expect(request.line_items[0].price_data.unit_amount).toBe(4000);
    const shares = fixture.rows("payment_splits");
    expect(shares.find(s => s.id === 1)).toMatchObject({
      stripeCheckoutSessionId: "cs_s27_1",
    });
    expect(shares.find(s => s.id === 2)).toMatchObject({
      stripeCheckoutSessionId: null,
      status: "pending",
    });
  });
});
