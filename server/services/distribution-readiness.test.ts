import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  airlines,
  airports,
  flights,
  ndcOffers,
  ndcOrders,
  bookings,
  interlineAgreements,
  gdsConnections,
  gdsMessages,
} from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";
import {
  getGdsExecutionCapability,
  getNdcExecutionCapability,
  getInterlineExecutionCapability,
  requireLocalNdcOrigin,
} from "./distribution-readiness.service";
import * as gds from "./gds.service";
import * as ndc from "./ndc.service";
import { gdsRouter } from "../routers/gds";
import { interlineRouter } from "../routers/interline";
import type { TrpcContext } from "../_core/context";

const store = vi.hoisted(() => ({ getDb: vi.fn(), reference: vi.fn() }));
vi.mock("../db", () => ({
  getDb: store.getDb,
  generateBookingReference: store.reference,
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("./idempotency-v2.service", async importOriginal => ({
  ...(await importOriginal<typeof import("./idempotency-v2.service")>()),
  // Exercise the service's real transaction body and SQL predicates; the shared
  // durable idempotency authority is covered by its separate acceptance suite.
  withTransactionalIdempotency: async <T>(options: {
    run: (tx: unknown) => Promise<T>;
  }) => {
    const db = store.getDb() as ReturnType<
      typeof authorityRelationalFixture
    >["db"];
    return db.transaction(options.run);
  },
}));
let fixture: ReturnType<typeof authorityRelationalFixture>;
const context = {
  req: { headers: {}, ip: "198.51.100.8" } as TrpcContext["req"],
  res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
  user: { id: 7, role: "admin", tenantId: 1 } as NonNullable<
    TrpcContext["user"]
  >,
  tenantId: 1,
  authMethod: "cookie",
} satisfies TrpcContext;
const createInput: ndc.CreateOrderInput = {
  offerId: "OFF-FIXTURE",
  userId: 7,
  passengers: [
    { type: "adult", firstName: "Controlled", lastName: "Passenger" },
  ],
  contactInfo: {
    emailAddress: "controlled@example.test",
    phoneNumber: "+966500000000",
  },
};
const bookingInput: gds.CreateBookingParams = {
  flightNumber: "ZY917",
  origin: "RUH",
  destination: "LHR",
  departureDate: "2035-01-01",
  cabinClass: "economy",
  fareClass: "Y",
  passengers: [
    {
      type: "ADT",
      title: "MR",
      firstName: "Controlled",
      lastName: "Passenger",
    },
  ],
  contact: { email: "controlled@example.test", phone: "+966500000000" },
};
const searchInput: ndc.SearchOffersInput = {
  originId: 1,
  destinationId: 2,
  departureDate: "2035-01-01",
  passengerCount: 1,
  cabinClass: "economy",
};
function offer(values: Record<string, string | number> = {}) {
  fixture.insert(ndcOffers, {
    id: 1,
    offerId: "OFF-FIXTURE",
    responseId: "controlled",
    originId: 1,
    destinationId: 2,
    departureDate: "2035-01-01 12:00:00",
    airlineId: 1,
    cabinClass: "economy",
    totalPrice: 10000,
    basePrice: 10000,
    taxesAndFees: 0,
    currency: "SAR",
    channel: "direct",
    segments: "[]",
    offerPayload: JSON.stringify({
      ndcVersion: "21.3",
      pricing: { passengerCount: 1 },
    }),
    status: "active",
    expiresAt: "2035-01-01 12:00:00",
    ...values,
  });
}
function connection() {
  fixture.insert(gdsConnections, {
    id: 1,
    airlineId: 1,
    provider: "amadeus",
    connectionName: "Controlled fixture",
    status: "active",
    environment: "test",
    officeId: "FIXTURE",
    apiKey: "fixture-only",
    baseUrl: "https://unused.invalid",
    supportsAvailability: 1,
    supportsBooking: 1,
    supportsTicketing: 1,
    supportsSchedules: 1,
    supportsPricing: 1,
  });
}
beforeEach(() => {
  fixture = authorityRelationalFixture([
    airlines,
    airports,
    flights,
    ndcOffers,
    ndcOrders,
    bookings,
    interlineAgreements,
    gdsConnections,
    gdsMessages,
  ]);
  store.getDb.mockReset().mockReturnValue(fixture.db);
  store.reference.mockReset().mockReturnValue("FIX123");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AIS_ENABLE_DEMOS", "false");
});
afterEach(() => {
  fixture.sqlite.close();
  vi.unstubAllEnvs();
});

describe("GDS external execution versus explicit simulation", () => {
  it.each(["production", "test"])(
    "rejects every executable GDS operation without an accepted adapter in %s",
    async environment => {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv(
        "AIS_ENABLE_DEMOS",
        environment === "production" ? "true" : "false"
      );
      expect(getGdsExecutionCapability()).toMatchObject({
        externalExecutionAvailable: false,
        simulationAvailable: false,
      });
      for (const run of [
        () => gds.testConnection(1),
        () => gds.healthCheckAll(),
        () =>
          gds.searchAvailability({
            origin: "RUH",
            destination: "LHR",
            departureDate: "2035-01-01",
            passengers: { adults: 1 },
            cabinClass: "economy",
          }),
        () => gds.createBooking(1, bookingInput),
        () => gds.issueTicket(1, "FIX123"),
        () => gds.cancelBooking(1, "FIX123"),
      ])
        await expect(run()).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
        });
      expect(store.getDb).not.toHaveBeenCalled();
    }
  );

  it("labels direct simulated booking, ticket and cancel results without provider contact", async () => {
    vi.stubEnv("AIS_ENABLE_DEMOS", "true");
    connection();
    for (const result of [
      await gds.createBooking(1, bookingInput),
      await gds.issueTicket(1, "FIX123"),
      await gds.cancelBooking(1, "FIX123"),
    ])
      expect(result).toMatchObject({
        execution: "simulation",
        providerContacted: false,
      });
    expect(getGdsExecutionCapability()).toMatchObject({
      simulationAvailable: true,
      externalExecutionAvailable: false,
    });
  });

  it("retains simulation metadata through the actual router output allowlist", async () => {
    vi.stubEnv("AIS_ENABLE_DEMOS", "true");
    connection();
    const api = gdsRouter.createCaller(context);
    expect(await api.getExecutionCapability()).toMatchObject({
      externalExecutionAvailable: false,
      simulationAvailable: true,
    });
    const result = await api.testConnection({ connectionId: 1 });
    expect(result).toMatchObject({
      execution: "simulation",
      providerContacted: false,
    });
    expect(result.data.message).toContain("no provider contacted");
  });
});

describe("NDC origination and external-order boundaries", () => {
  it("preserves the local direct origin and shopping positive control", async () => {
    expect(() => requireLocalNdcOrigin({})).not.toThrow();
    expect(() =>
      requireLocalNdcOrigin({ channel: "direct", distributorId: null })
    ).not.toThrow();
    expect(getNdcExecutionCapability()).toMatchObject({
      localDirectOrdersAvailable: true,
      externalExecutionAvailable: false,
    });
    expect(await ndc.searchOffers(searchInput)).toEqual([]);
    expect(
      fixture.queries.some(query => query.sql.includes("from `flights`"))
    ).toBe(true);
  });

  it.each(["gds", "ndc_aggregator", "ota", "travel_agent", "unknown"])(
    "rejects external shopping/creation channel %s before database access",
    async channel => {
      await expect(
        ndc.searchOffers({ ...searchInput, channel })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        ndc.createOrder({ ...createInput, channel })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(store.getDb).not.toHaveBeenCalled();
    }
  );

  it.each(["external-seller", "AIS", ""])(
    "does not let distributor identifier %s masquerade as a local seller",
    async distributorId => {
      await expect(
        ndc.createOrder({ ...createInput, distributorId })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(store.getDb).not.toHaveBeenCalled();
    }
  );

  it("rejects an external persisted offer even when the caller requests direct", async () => {
    offer({ channel: "gds" });
    await expect(
      ndc.createOrder({ ...createInput, channel: "direct" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(store.reference).not.toHaveBeenCalled();
    expect(
      fixture.queries.every(query => query.sql.startsWith("select "))
    ).toBe(true);
  });

  it.each([
    "{}",
    "{",
    "null",
    "[]",
    '{"ndcVersion":"24.1"}',
    '{"ndcVersion":21.3}',
  ])(
    "rejects unsupported or missing persisted issuance profile: %s",
    async offerPayload => {
      offer({ offerPayload });
      await expect(ndc.createOrder(createInput)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "The offer has no supported local NDC issuance profile",
      });
      expect(store.reference).not.toHaveBeenCalled();
      expect(
        fixture.queries.every(query => query.sql.startsWith("select "))
      ).toBe(true);
    }
  );

  it("lets a known local issuance profile reach the independent inventory validation", async () => {
    offer();
    await expect(ndc.createOrder(createInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Offer inventory, cabin, currency or passenger count is unsupported",
    });
    expect(store.reference).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-carrier issuance before inventory mutation", async () => {
    offer({ segments: JSON.stringify([{ flightId: 8 }]) });
    fixture.insert(flights, {
      id: 8,
      airlineId: 2,
      tenantId: 1,
      flightNumber: "ZY918",
      status: "scheduled",
    });
    await expect(ndc.createOrder(createInput)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Cross-carrier NDC issuance requires accepted interline integration",
    });
    expect(
      fixture.queries.every(query => query.sql.startsWith("select "))
    ).toBe(true);
  });

  it("does not manufacture a different issuing-carrier identity on offer generation", async () => {
    const input = {
      channel: "direct",
      ownerCode: "EXTERNAL",
      flight: { airline: { code: "LOCAL" } },
    } as Parameters<typeof ndc.generateOfferFromFlight>[0];
    await expect(ndc.generateOfferFromFlight(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { channel: "gds" },
    { channel: "direct", distributorId: "external" },
  ])("does not cancel a partner-origin order locally: %j", async origin => {
    fixture.insert(bookings, {
      id: 7,
      userId: 7,
      tenantId: 1,
      status: "pending",
      paymentStatus: "pending",
    });
    fixture.insert(ndcOrders, {
      id: 1,
      orderId: "ORD-EXTERNAL",
      bookingId: 7,
      offerId: "OFF-EXTERNAL",
      airlineId: 1,
      totalAmount: 100,
      currency: "SAR",
      status: "pending",
      passengers: "[]",
      contactInfo: "{}",
      orderPayload: '{"ndcVersion":"21.3"}',
      ...origin,
    });
    await expect(
      ndc.cancelOrder({ orderId: "ORD-EXTERNAL", userId: 7 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      fixture.queries.every(query => query.sql.startsWith("select "))
    ).toBe(true);
  });
});

describe("interline local planning and partner execution separation", () => {
  it("preserves active agreement eligibility while explicitly denying external execution", async () => {
    fixture.insert(interlineAgreements, {
      id: 1,
      airline1Id: 1,
      airline2Id: 2,
      agreementType: "full",
      agreementReference: "CONTROLLED-LOCAL",
      prorateType: "percentage",
      prorateValue: "50",
      baggageThroughCheck: 1,
      settlementMethod: "bilateral",
      status: "active",
      validFrom: "2020-01-01 00:00:00",
    });
    const api = interlineRouter.createCaller(context);
    const result = await api.checkEligibility({ airline1Id: 1, airline2Id: 2 });
    expect(result.data).toMatchObject({ eligible: true, agreement: { id: 1 } });
    expect(result.execution).toEqual(getInterlineExecutionCapability());
    expect(result.execution.externalExecutionAvailable).toBe(false);
    expect(result.execution.scope).toBe("local_agreement_planning");
    expect(
      (await api.checkEligibility({ airline1Id: 2, airline2Id: 1 })).data
        .eligible
    ).toBe(true);
    await fixture.db
      .update(interlineAgreements)
      .set({ status: "suspended" })
      .where(eq(interlineAgreements.id, 1));
    expect(
      (await api.checkEligibility({ airline1Id: 1, airline2Id: 2 })).data
        .eligible
    ).toBe(false);
  });

  it("marks local activation as planning without claiming partner receipt or settlement", async () => {
    fixture.insert(interlineAgreements, {
      id: 1,
      airline1Id: 1,
      airline2Id: 2,
      agreementType: "full",
      agreementReference: "CONTROLLED-LOCAL",
      prorateType: "percentage",
      prorateValue: "50",
      status: "draft",
      validFrom: "2020-01-01 00:00:00",
    });
    const result = await interlineRouter
      .createCaller(context)
      .activate({ id: 1 });
    expect(result).toMatchObject({
      data: { status: "active" },
      execution: {
        scope: "local_agreement_planning",
        externalExecutionAvailable: false,
      },
    });
  });
});
