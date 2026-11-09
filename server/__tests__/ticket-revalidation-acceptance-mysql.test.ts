import { randomUUID } from "node:crypto";
import { createTRPCClient, httpLink } from "@trpc/client";
import { and, asc, eq } from "drizzle-orm";
import superjson from "superjson";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import {
  createTicketDatabase,
  loadTicketApplication,
  snapshotHash,
  startLostTicketResponse,
  ticketContext,
  type TicketDatabaseSnapshot,
} from "./helpers/ticket-revalidation-fixture";

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;
type Application = Awaited<ReturnType<typeof loadTicketApplication>>;
type OwnedDatabase = Awaited<ReturnType<typeof createTicketDatabase>>;
type Schedule = {
  originZone: string;
  destinationZone: string;
  fromDeparture: string;
  fromArrival: string;
  toDeparture: string;
  toArrival: string;
};
const ordinarySchedule: Schedule = {
  originZone: "UTC",
  destinationZone: "UTC",
  fromDeparture: "2035-03-04T12:00:00Z",
  fromArrival: "2035-03-04T14:00:00Z",
  toDeparture: "2035-03-11T12:00:00Z",
  toArrival: "2035-03-11T14:00:00Z",
};

// These are service-boundary acceptance tests with real routers, the actual
// mysql2 pool and MySQL transactions. The original browser test separately owns
// UI/auth acceptance. Controlled row mutations below represent late/corrupt
// evidence, not external provider acknowledgements or operational workflows.
nativeDescribe("local ticket revalidation acceptance on native MySQL", () => {
  let storage: OwnedDatabase | undefined;
  let application: Application | undefined;
  const app = () => {
    if (!application) throw new Error("Ticket application not initialized");
    return application;
  };
  const owned = () => {
    if (!storage) throw new Error("Owned ticket storage not initialized");
    return storage;
  };

  beforeAll(async () => {
    const redis = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(redis.hostname))
      throw new Error("Ticket acceptance refuses non-loopback Redis");
    storage = await createTicketDatabase(process.env.DATABASE_URL!);
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", storage.databaseUrl);
    vi.stubEnv("REDIS_URL", redis.toString());
    vi.stubEnv("CACHE_PREFIX", storage.databaseName);
    vi.stubEnv("DB_POOL_SIZE", "6");
    vi.stubEnv("DB_MAX_IDLE", "3");
    vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
    vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    vi.stubEnv("STRIPE_MOCK_HOST", undefined);
    application = await loadTicketApplication();
    const [rows] = await app()
      .database.getPool()!
      .query<import("mysql2").RowDataPacket[]>(
        "SELECT DATABASE() AS name, @@SESSION.time_zone AS zone"
      );
    expect(rows[0]).toMatchObject({
      name: storage.databaseName,
      zone: "+00:00",
    });
  }, 90000);

  afterAll(async () => {
    try {
      await application?.close();
    } finally {
      try {
        await storage?.close();
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    }
  }, 30000);

  beforeEach(async () => {
    await owned().reset();
  }, 30000);

  async function contextFor(userId: number) {
    const [user] = await app()
      .db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) throw new Error("Owned fixture user missing");
    return ticketContext(user);
  }

  async function issueTicket(schedule: Schedule = ordinarySchedule) {
    const { db } = app();
    const [tenant] = await db.insert(schema.tenants).values({
      slug: "ticket-owner",
      name: "Synthetic local ticket airline",
    });
    const [foreignTenant] = await db.insert(schema.tenants).values({
      slug: "ticket-other",
      name: "Synthetic other airline",
    });
    const [owner] = await db.insert(schema.users).values({
      openId: randomUUID(),
      tenantId: tenant.insertId,
      name: "Synthetic ticket owner",
      email: "ticket-owner@example.invalid",
    });
    const [other] = await db.insert(schema.users).values({
      openId: randomUUID(),
      tenantId: tenant.insertId,
      name: "Synthetic other user",
    });
    const [airline] = await db.insert(schema.airlines).values({
      code: "TQ",
      name: "Synthetic local ticket carrier",
    });
    const [origin] = await db.insert(schema.airports).values({
      code: "TQA",
      name: "Synthetic origin",
      city: "Origin",
      country: "Synthetic",
      timezone: schedule.originZone,
    });
    const [destination] = await db.insert(schema.airports).values({
      code: "TQB",
      name: "Synthetic destination",
      city: "Destination",
      country: "Synthetic",
      timezone: schedule.destinationZone,
    });
    const flight = {
      tenantId: tenant.insertId,
      airlineId: airline.insertId,
      originId: origin.insertId,
      destinationId: destination.insertId,
      flightNumber: "TQ101",
      aircraftType: "Synthetic A320",
      economySeats: 100,
      economyAvailable: 100,
      businessSeats: 10,
      businessAvailable: 10,
      economyPrice: 50000,
      businessPrice: 100000,
    };
    const [from] = await db.insert(schema.flights).values({
      ...flight,
      departureTime: new Date(schedule.fromDeparture),
      arrivalTime: new Date(schedule.fromArrival),
    });
    const [to] = await db.insert(schema.flights).values({
      ...flight,
      departureTime: new Date(schedule.toDeparture),
      arrivalTime: new Date(schedule.toArrival),
    });
    const [fareClass] = await db.insert(schema.fareClasses).values({
      airlineId: airline.insertId,
      code: "Q",
      name: "Local date flex",
      cabinClass: "economy",
      fareFamily: "Local Flex",
      changeable: true,
      changeFee: 0,
      basePriceMultiplier: "1.000",
    });
    await db.insert(schema.flightFareClassInventory).values(
      [from.insertId, to.insertId].map(flightId => ({
        flightId,
        fareClassId: fareClass.insertId,
        capacity: 100,
        availableSeats: 100,
      }))
    );
    const context = await contextFor(owner.insertId);
    const offer = await app()
      .priceQuoteRouter.createCaller(context)
      .createOffer({
        flightId: from.insertId,
        cabinClass: "economy",
        fareClassCode: "Q",
        passengerTypes: ["adult"],
      });
    expect(offer.fareLines).toHaveLength(1);
    const booking = await app()
      .bookingsRouter.createCaller(context)
      .create({
        flightId: from.insertId,
        cabinClass: "economy",
        fareClassCode: "Q",
        offerId: offer.offerId,
        sessionId: randomUUID(),
        idempotencyKey: randomUUID(),
        passengers: [
          { type: "adult", firstName: "Synthetic", lastName: "Ticket" },
        ],
      });
    // Only the initial promotional lot is seeded. The real tender service
    // creates its usage, ledger charge, paid booking and inventory reservation.
    await db.insert(schema.userCredits).values({
      userId: owner.insertId,
      amount: booking.totalAmount,
      source: "promo",
      description: "Owned BE-05 acceptance funding",
    });
    const funding = await app()
      .vouchersRouter.createCaller(context)
      .useCredits({
        bookingId: booking.bookingId,
        amount: booking.totalAmount,
      });
    expect(funding).toMatchObject({
      success: true,
      amountUsed: booking.totalAmount,
    });
    const [passenger] = await db.select().from(schema.passengers);
    const [segment] = await db.select().from(schema.bookingSegments);
    const document = await app()
      .eticketRouter.createCaller(context)
      .generateETicket({
        bookingId: booking.bookingId,
        passengerId: passenger.id,
      });
    expect(Buffer.from(document.pdf, "base64").subarray(0, 5).toString()).toBe(
      "%PDF-"
    );
    const [coupon] = await db.select().from(schema.ticketCoupons);
    expect(coupon).toMatchObject({
      bookingId: booking.bookingId,
      passengerId: passenger.id,
      flightId: from.insertId,
      ticketNumber: document.ticketNumber,
      status: "O",
    });
    const fares = await db.select().from(schema.bookingFareComponents);
    expect(fares).toHaveLength(3);
    expect(fares.reduce((sum, row) => sum + row.amount, 0)).toBe(
      booking.totalAmount
    );
    const ledger = await db.select().from(schema.financialLedger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: "charge",
      stripeEventId: `internal-credit:${booking.bookingId}`,
      stripePaymentIntentId: null,
    });
    return {
      ownerId: owner.insertId,
      otherUserId: other.insertId,
      tenantId: tenant.insertId,
      foreignTenantId: foreignTenant.insertId,
      airlineId: airline.insertId,
      originId: origin.insertId,
      destinationId: destination.insertId,
      fromId: from.insertId,
      toId: to.insertId,
      fareClassId: fareClass.insertId,
      bookingId: booking.bookingId,
      amount: booking.totalAmount,
      passengerId: passenger.id,
      segmentId: segment.id,
      coupon,
      originalOfferId: offer.offerId,
      ticketNumber: document.ticketNumber,
    };
  }
  type Fixture = Awaited<ReturnType<typeof issueTicket>>;

  async function preview(fixture: Fixture, userId = fixture.ownerId) {
    return app()
      .modificationsRouter.createCaller(await contextFor(userId))
      .requestChangeDate({
        bookingId: fixture.bookingId,
        replaceFlightId: fixture.fromId,
        newFlightId: fixture.toId,
        intent: "revalidate",
        idempotencyKey: randomUUID(),
      });
  }

  async function confirm(modificationId: number, userId: number) {
    return app()
      .ndcRouter.createCaller(await contextFor(userId))
      .confirmNoChargeService({ modificationId });
  }

  async function quotePlan(modificationId: number) {
    const [change] = await app()
      .db.select()
      .from(schema.bookingModifications)
      .where(eq(schema.bookingModifications.id, modificationId));
    if (!change) throw new Error("Fixture quote missing");
    return app().planSchema.parse(change.servicingPayload);
  }

  function receipt(
    label: string,
    before: TicketDatabaseSnapshot,
    after: TicketDatabaseSnapshot
  ) {
    console.info(
      JSON.stringify({
        event: "ticket_revalidation_snapshot",
        case: label,
        tables: owned().tableNames.length,
        beforeSha256: snapshotHash(before),
        afterSha256: snapshotHash(after),
        unchanged: JSON.stringify(after) === JSON.stringify(before),
        rowCounts: Object.fromEntries(
          Object.entries(before)
            .filter(([, rows]) => rows.length)
            .map(([name, rows]) => [name, rows.length])
        ),
      })
    );
  }

  async function rejectWithoutWrites(
    label: string,
    action: () => Promise<unknown>,
    message: RegExp
  ) {
    const before = await owned().snapshot();
    const error: unknown = await action().then(
      () => null,
      error => error
    );
    const after = await owned().snapshot();
    receipt(label, before, after);
    expect(error, `${label} must reject`).toBeInstanceOf(Error);
    expect(String(error)).toMatch(message);
    // Compare rows, not counts alone: overwrites, offer consumption, released
    // locks, coupon changes, debits and outbox writes must all be absent.
    expect(after).toEqual(before);
  }

  async function addSeat(
    fixture: Fixture,
    status: "checked_in" | "occupied",
    boardingPassIssued: boolean
  ) {
    const [map] = await app().db.insert(schema.seatMaps).values({
      airlineId: fixture.airlineId,
      aircraftType: "Synthetic A320",
      configName: "Acceptance seat",
      cabinLayout: "{}",
      totalSeats: 100,
      economySeats: 100,
    });
    await app().db.insert(schema.seatInventory).values({
      flightId: fixture.fromId,
      seatMapId: map.insertId,
      seatNumber: "12A",
      row: 12,
      column: "A",
      cabinClass: "economy",
      seatType: "window",
      bookingId: fixture.bookingId,
      passengerId: fixture.passengerId,
      status,
      boardingPassIssued,
    });
  }

  const refusals: Array<{
    name: string;
    mutate: (fixture: Fixture) => Promise<unknown>;
    message: RegExp;
    otherUser?: boolean;
  }> = [
    {
      name: "a different owner in the same tenant",
      mutate: async () => {},
      otherUser: true,
      message: /not found/i,
    },
    {
      name: "the owner moved to a different tenant",
      mutate: fixture =>
        app()
          .db.update(schema.users)
          .set({ tenantId: fixture.foreignTenantId })
          .where(eq(schema.users.id, fixture.ownerId)),
      message: /not found|verified payment/i,
    },
    {
      name: "a registered bag with claimed status but no return receipt",
      mutate: fixture =>
        app()
          .db.insert(schema.baggageItems)
          .values({
            bookingId: fixture.bookingId,
            passengerId: fixture.passengerId,
            flightId: fixture.fromId,
            segmentId: fixture.segmentId,
            tagNumber: `TQ${fixture.bookingId}`,
            weight: "10.00",
            status: "claimed",
          }),
      message: /return the registered sector bag/i,
    },
    {
      name: "booking check-in",
      mutate: fixture =>
        app()
          .db.update(schema.bookings)
          .set({ checkedIn: true })
          .where(eq(schema.bookings.id, fixture.bookingId)),
      message: /check-in|serviceable|quote expired|booking changed/i,
    },
    ...(["checked_in", "boarded"] as const).map(state => ({
      name: `DCS passenger state ${state}`,
      mutate: (fixture: Fixture) =>
        app().db.insert(schema.dcsPassengerStates).values({
          bookingId: fixture.bookingId,
          passengerId: fixture.passengerId,
          flightId: fixture.fromId,
          state,
        }),
      message: /revalidation|checked|boarded/i,
    })),
    {
      name: "a checked-in seat",
      mutate: fixture => addSeat(fixture, "checked_in", false),
      message: /seat|revalidation|check/i,
    },
    {
      name: "an occupied seat with a boarding document",
      mutate: fixture => addSeat(fixture, "occupied", true),
      message: /seat|revalidation|check/i,
    },
    {
      name: "an external collection receipt",
      mutate: fixture =>
        app()
          .db.insert(schema.paymentReceipts)
          .values({
            paymentIntentId: `pi_synthetic_external_${fixture.bookingId}`,
            kind: "booking",
            bookingId: fixture.bookingId,
            userId: fixture.ownerId,
            targetId: fixture.bookingId,
            amount: fixture.amount,
            currency: "SAR",
          }),
      message: /revalidation/i,
    },
    {
      name: "an external payment-intent marker without a local receipt",
      mutate: fixture =>
        app()
          .db.update(schema.bookings)
          .set({ stripePaymentIntentId: `pi_synthetic_${fixture.bookingId}` })
          .where(eq(schema.bookings.id, fixture.bookingId)),
      message: /revalidation/i,
    },
    {
      name: "an incomplete fare-component set",
      mutate: fixture =>
        app()
          .db.delete(schema.bookingFareComponents)
          .where(
            and(
              eq(schema.bookingFareComponents.bookingId, fixture.bookingId),
              eq(schema.bookingFareComponents.componentType, "booking_fee")
            )
          ),
      message: /revalidation/i,
    },
    {
      name: "a completed sector on a still-confirmed booking",
      mutate: fixture =>
        app()
          .db.update(schema.bookingSegments)
          .set({ status: "completed" })
          .where(eq(schema.bookingSegments.id, fixture.segmentId)),
      message:
        /reservation needs reconciliation|quote expired|booking changed/i,
    },
    {
      name: "a completed flight instance",
      mutate: fixture =>
        app()
          .db.update(schema.flights)
          .set({ status: "completed" })
          .where(eq(schema.flights.id, fixture.fromId)),
      message: /flight instance|schedule changed/i,
    },
    {
      name: "a flown coupon",
      mutate: fixture =>
        app()
          .db.update(schema.ticketCoupons)
          .set({ status: "F" })
          .where(eq(schema.ticketCoupons.id, fixture.coupon.id)),
      message: /revalidation/i,
    },
    {
      name: "changed fare-family terms at an unchanged price",
      mutate: fixture =>
        app()
          .db.update(schema.fareClasses)
          .set({ fareFamily: "Changed Local Flex" })
          .where(eq(schema.fareClasses.id, fixture.fareClassId)),
      message: /revalidation/i,
    },
    {
      name: "a new eligible sale rule with a different fare digest",
      mutate: fixture =>
        app()
          .db.insert(schema.fareRules)
          .values({
            airlineId: fixture.airlineId,
            fareClassId: fixture.fareClassId,
            ruleName: "Adult-only terms added after ticket issue",
            ruleCategory: "eligibility",
            conditions: JSON.stringify({ passengerTypes: ["adult"] }),
            validFrom: new Date("2030-01-01T00:00:00Z"),
          }),
      message: /revalidation/i,
    },
    {
      name: "a corrupted original offer digest",
      mutate: fixture =>
        app()
          .db.update(schema.retailOffers)
          .set({ digest: "0".repeat(64) })
          .where(eq(schema.retailOffers.id, fixture.originalOfferId)),
      message: /revalidation/i,
    },
  ];

  for (const stage of ["preview", "commit"] as const) {
    it.each(refusals)(
      `${stage} refuses $name without changing any owned row`,
      async refusal => {
        const fixture = await issueTicket();
        const quote = stage === "commit" ? await preview(fixture) : null;
        await refusal.mutate(fixture);
        const userId = refusal.otherUser
          ? fixture.otherUserId
          : fixture.ownerId;
        await rejectWithoutWrites(
          `${stage}: ${refusal.name}`,
          () =>
            quote
              ? confirm(quote.modificationId, userId)
              : preview(fixture, userId),
          refusal.message
        );
      },
      30000
    );
  }

  const changedAfterPreview: Array<{
    name: string;
    mutate: (fixture: Fixture, modificationId: number) => Promise<unknown>;
  }> = [
    {
      name: "replacement offer digest",
      mutate: async (_fixture, modificationId) => {
        const plan = await quotePlan(modificationId);
        await app()
          .db.update(schema.retailOffers)
          .set({ digest: "f".repeat(64) })
          .where(
            eq(schema.retailOffers.id, plan.revalidation!.replacementOfferId)
          );
      },
    },
    {
      name: "replacement offer consumption binding",
      mutate: async (_fixture, modificationId) => {
        const plan = await quotePlan(modificationId);
        await app()
          .db.update(schema.retailOffers)
          .set({ consumedBookingId: null })
          .where(
            eq(schema.retailOffers.id, plan.revalidation!.replacementOfferId)
          );
      },
    },
    {
      name: "open coupon number with an otherwise eligible ticket",
      mutate: fixture =>
        app()
          .db.update(schema.ticketCoupons)
          .set({ couponNumber: fixture.coupon.couponNumber + 1 })
          .where(eq(schema.ticketCoupons.id, fixture.coupon.id)),
    },
    {
      name: "ticket issuance event identity",
      mutate: fixture =>
        app()
          .db.update(schema.outbox)
          .set({ eventId: randomUUID() })
          .where(
            and(
              eq(schema.outbox.aggregateId, String(fixture.bookingId)),
              eq(schema.outbox.eventType, "ETicketIssued")
            )
          ),
    },
    {
      name: "valid but changed fare evidence on both offers",
      mutate: async (fixture, modificationId) => {
        const plan = await quotePlan(modificationId);
        await app()
          .db.update(schema.fareClasses)
          .set({ fareFamily: "Later approved family" })
          .where(eq(schema.fareClasses.id, fixture.fareClassId));
        for (const id of [
          fixture.originalOfferId,
          plan.revalidation!.replacementOfferId,
        ]) {
          const [offer] = await app()
            .db.select()
            .from(schema.retailOffers)
            .where(eq(schema.retailOffers.id, id));
          const payload = app().offers.retailOfferPayloadSchema.parse(
            offer.payload
          );
          payload.revalidationTerms = {
            ...payload.revalidationTerms!,
            family: "Later approved family",
          };
          await app()
            .db.update(schema.retailOffers)
            .set({ payload, digest: app().offers.offerDigest(payload) })
            .where(eq(schema.retailOffers.id, id));
        }
      },
    },
  ];
  it.each(changedAfterPreview)(
    "commit rechecks $name and rolls back every row",
    async change => {
      const fixture = await issueTicket();
      const quote = await preview(fixture);
      await change.mutate(fixture, quote.modificationId);
      await rejectWithoutWrites(
        `late evidence: ${change.name}`,
        () => confirm(quote.modificationId, fixture.ownerId),
        /revalidation|evidence changed/i
      );
    },
    30000
  );

  const timeRefusals: Array<{ name: string; schedule: Schedule }> = [
    {
      name: "crossing UTC midnight without changing the origin civil day",
      schedule: {
        ...ordinarySchedule,
        originZone: "Asia/Riyadh",
        fromDeparture: "2035-03-04T23:30:00Z",
        fromArrival: "2035-03-05T01:30:00Z",
        toDeparture: "2035-03-05T00:30:00Z",
        toArrival: "2035-03-05T02:30:00Z",
      },
    },
    {
      name: "equal UTC clocks that move the departure's local DST clock",
      schedule: {
        originZone: "Europe/London",
        destinationZone: "Europe/Berlin",
        fromDeparture: "2035-03-18T12:00:00Z",
        fromArrival: "2035-03-18T14:00:00Z",
        toDeparture: "2035-03-25T12:00:00Z",
        toArrival: "2035-03-25T14:00:00Z",
      },
    },
    {
      name: "unchanged origin clock and duration but a changed destination DST clock",
      schedule: {
        originZone: "UTC",
        destinationZone: "Europe/London",
        fromDeparture: "2035-03-18T12:00:00Z",
        fromArrival: "2035-03-18T14:00:00Z",
        toDeparture: "2035-03-25T12:00:00Z",
        toArrival: "2035-03-25T14:00:00Z",
      },
    },
    {
      name: "matching local clocks with different elapsed durations across DST zones",
      schedule: {
        originZone: "Europe/London",
        destinationZone: "America/New_York",
        fromDeparture: "2035-03-18T12:00:00Z",
        fromArrival: "2035-03-18T18:00:00Z",
        toDeparture: "2035-03-25T11:00:00Z",
        toArrival: "2035-03-25T18:00:00Z",
      },
    },
    {
      name: "a one-second departure-clock difference at equal duration",
      schedule: {
        ...ordinarySchedule,
        toDeparture: "2035-03-11T12:00:01Z",
        toArrival: "2035-03-11T14:00:01Z",
      },
    },
    {
      name: "an arrival-clock difference with the same departure clock",
      schedule: { ...ordinarySchedule, toArrival: "2035-03-11T14:01:00Z" },
    },
  ];
  it.each(timeRefusals)(
    "preview refuses $name without writes",
    async scenario => {
      const fixture = await issueTicket(scenario.schedule);
      await rejectWithoutWrites(
        `clock: ${scenario.name}`,
        () => preview(fixture),
        /local ticket revalidation/i
      );
    },
    30000
  );

  it("rechecks airport timezone evidence at commit", async () => {
    const fixture = await issueTicket();
    const quote = await preview(fixture);
    await app()
      .db.update(schema.airports)
      .set({ timezone: "Invalid/AcceptanceZone" })
      .where(eq(schema.airports.id, fixture.destinationId));
    await rejectWithoutWrites(
      "late invalid destination timezone",
      () => confirm(quote.modificationId, fixture.ownerId),
      /revalidation/i
    );
  }, 30000);

  const validSchedules: Array<{
    name: string;
    schedule: Schedule;
    loseResponse?: boolean;
  }> = [
    {
      name: "a local date after UTC midnight with a 45-minute zone offset",
      schedule: {
        originZone: "Asia/Kathmandu",
        destinationZone: "Pacific/Auckland",
        fromDeparture: "2035-03-04T23:30:00Z",
        fromArrival: "2035-03-05T03:30:00Z",
        toDeparture: "2035-03-11T23:30:00Z",
        toArrival: "2035-03-12T03:30:00Z",
      },
    },
    {
      name: "the spring DST transition with unchanged local clocks and elapsed duration",
      schedule: {
        originZone: "Europe/London",
        destinationZone: "Europe/Berlin",
        fromDeparture: "2035-03-18T12:00:00Z",
        fromArrival: "2035-03-18T14:00:00Z",
        toDeparture: "2035-03-25T11:00:00Z",
        toArrival: "2035-03-25T13:00:00Z",
      },
      loseResponse: true,
    },
    {
      name: "the autumn DST transition with unchanged local clocks and elapsed duration",
      schedule: {
        originZone: "America/New_York",
        destinationZone: "America/Chicago",
        fromDeparture: "2035-11-03T12:00:00Z",
        fromArrival: "2035-11-03T15:00:00Z",
        toDeparture: "2035-11-10T13:00:00Z",
        toArrival: "2035-11-10T16:00:00Z",
      },
    },
  ];
  it.each(validSchedules)(
    "preserves ticket and all fare components through $name",
    async scenario => {
      const fixture = await issueTicket(scenario.schedule);
      const before = await owned().snapshot();
      const fares = await app()
        .db.select()
        .from(schema.bookingFareComponents)
        .orderBy(asc(schema.bookingFareComponents.id));
      const quote = await preview(fixture);
      expect(quote).toMatchObject({
        totalCost: 0,
        modificationFee: 0,
        priceDifference: 0,
        requiresPayment: false,
      });
      const plan = await quotePlan(quote.modificationId);
      expect(plan.revalidation).toMatchObject({
        ticketNumber: fixture.ticketNumber,
        couponId: fixture.coupon.id,
        originalOfferId: fixture.originalOfferId,
        fromFlightId: fixture.fromId,
        toFlightId: fixture.toId,
      });
      let receiptId: string;
      if (scenario.loseResponse) {
        const { user } = await contextFor(fixture.ownerId);
        if (!user) throw new Error("Owned user missing");
        const transport = await startLostTicketResponse(app(), user);
        try {
          const client = createTRPCClient<Application["ndcRouter"]>({
            links: [httpLink({ url: transport.url, transformer: superjson })],
          });
          await expect(
            client.confirmNoChargeService.mutate({
              modificationId: quote.modificationId,
            })
          ).rejects.toThrow(/fetch failed|network/i);
          expect(transport.lost()?.status).toBe(200);
          const [committed] = await app()
            .db.select()
            .from(schema.bookingModifications)
            .where(eq(schema.bookingModifications.id, quote.modificationId));
          expect(committed.status).toBe("completed");
          if (!committed.executionEventId)
            throw new Error("No durable receipt after lost response");
          receiptId = committed.executionEventId;
          expect(transport.lost()?.body).toContain(receiptId);
          const applied = await owned().snapshot();
          const replay = await client.confirmNoChargeService.mutate({
            modificationId: quote.modificationId,
          });
          expect(replay).toEqual({ receiptId, refundDue: 0 });
          const replayed = await owned().snapshot();
          receipt(
            "lost HTTP response: committed status and replay",
            applied,
            replayed
          );
          expect(replayed).toEqual(applied);
        } finally {
          await transport.close();
        }
      } else {
        receiptId = (await confirm(quote.modificationId, fixture.ownerId))
          .receiptId;
      }
      const [coupon] = await app().db.select().from(schema.ticketCoupons);
      expect({ ...coupon, updatedAt: fixture.coupon.updatedAt }).toEqual({
        ...fixture.coupon,
        flightId: fixture.toId,
      });
      expect(
        await app()
          .db.select()
          .from(schema.bookingFareComponents)
          .orderBy(asc(schema.bookingFareComponents.id))
      ).toEqual(fares.map(row => ({ ...row, flightId: fixture.toId })));
      const [segment] = await app().db.select().from(schema.bookingSegments);
      expect(segment).toMatchObject({
        id: fixture.segmentId,
        flightId: fixture.toId,
        segmentAmount: fixture.amount,
        status: "confirmed",
        seatsReserved: true,
      });
      const [booking] = await app().db.select().from(schema.bookings);
      expect(booking).toMatchObject({
        flightId: fixture.toId,
        totalAmount: fixture.amount,
        paymentStatus: "paid",
        status: "confirmed",
      });
      const instances = await app()
        .db.select()
        .from(schema.flights)
        .orderBy(asc(schema.flights.id));
      const buckets = await app()
        .db.select()
        .from(schema.flightFareClassInventory)
        .orderBy(asc(schema.flightFareClassInventory.flightId));
      expect(instances.map(row => row.economyAvailable)).toEqual([100, 99]);
      expect(buckets.map(row => row.availableSeats)).toEqual([100, 99]);
      const after = await owned().snapshot();
      for (const name of [
        "passengers",
        "financial_ledger",
        "credit_usage",
        "user_credits",
        "payment_receipts",
      ])
        expect(
          after[name],
          `${name} must preserve ticket/funding identity`
        ).toEqual(before[name]);
      const events = await app().db.select().from(schema.outbox);
      expect(
        events.filter(row => row.eventType === "ETicketIssued")
      ).toHaveLength(1);
      expect(
        events.filter(row => row.eventType === "order.servicing_applied")
      ).toEqual([
        expect.objectContaining({
          eventId: receiptId,
          payload: expect.objectContaining({
            fulfillment: "local_ticket_revalidated",
          }),
        }),
      ]);
      const details = await app()
        .modificationsRouter.createCaller(await contextFor(fixture.ownerId))
        .getDetails({ modificationId: quote.modificationId });
      expect(details).toMatchObject({
        executionEventId: receiptId,
        revalidation: { ticketNumber: fixture.ticketNumber },
      });
      const replay = await confirm(quote.modificationId, fixture.ownerId);
      expect(replay).toEqual({ receiptId, refundDue: 0 });
      const replayed = await owned().snapshot();
      receipt(
        `successful revalidation replay: ${scenario.name}`,
        after,
        replayed
      );
      expect(replayed).toEqual(after);
    },
    30000
  );
});
