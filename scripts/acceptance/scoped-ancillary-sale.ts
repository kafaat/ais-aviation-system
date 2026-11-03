import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import { ancillaryRouter } from "../../server/routers/ancillary";
import { bookingsRouter } from "../../server/routers/bookings";
import { multiCityRouter } from "../../server/routers/multi-city";
import { seatMapRouter } from "../../server/routers/seat-map";
import { iropsRouter } from "../../server/routers/irops";
import { disruptionsRouter } from "../../server/routers/disruptions";
import { walletRouter } from "../../server/routers/wallet";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

export async function verifyScopedAncillarySale(
  db: SettlementTx,
  ctx: TrpcContext,
  id: number
) {
  assert(ctx.user);
  const flightIds = [id + 911, id + 912];
  const when = (days: number) => new Date(Date.now() + days * 86400000);
  const segments = flightIds.map((flightId, index) => ({
    flightId,
    departureDate: when(index + 7),
  }));
  await db.insert(s.flights).values(
    segments.map(({ flightId, departureDate }, index) => ({
      id: flightId,
      tenantId: id,
      airlineId: id,
      flightNumber: "ZY" + (711 + index),
      originId: id + index,
      destinationId: id + 1 - index,
      departureTime: departureDate,
      arrivalTime: new Date(departureDate.getTime() + 3600000),
      aircraftType: "A320",
      economySeats: 10,
      economyAvailable: 10,
      businessSeats: 2,
      businessAvailable: 2,
      economyPrice: 10000,
      businessPrice: 20000,
    }))
  );
  const catalog = [
    {
      code: "AUDIT_SCOPE_BAG",
      category: "baggage" as const,
      name: "20 kg baggage",
      weightGrams: 20000,
      price: 5000,
    },
    {
      code: "AUDIT_SCOPE_MEAL",
      category: "meal" as const,
      name: "Vegetarian meal",
      price: 1800,
    },
  ];
  const keys = await db
    .insert(s.ancillaryServices)
    .values(catalog)
    .$returningId();
  const ancillaries = keys.map(({ id: ancillaryServiceId }, index) => ({
    ancillaryServiceId,
    passengerIndex: 0,
    segmentIndex: 0,
    quantity: 1,
    unitPrice: catalog[index].price,
    totalPrice: catalog[index].price,
  }));
  const sale = multiCityRouter.createCaller(ctx);
  const cabinClass = "economy" as const;
  const passengers = ["First", "Second"].map(firstName => ({
    firstName,
    lastName: "Traveler",
    type: "adult" as const,
  }));
  const fare = await sale.calculatePrice({
    segments: segments.map(leg => ({ ...leg, cabinClass })),
    passengerCount: 2,
    passengerTypes: ["adult", "adult"],
  });
  const expectedTotalMinor = fare.totalPrice + 6800;
  const command = {
    segments,
    passengers,
    cabinClass,
    ancillaries,
    sessionId: "scoped-ancillary-roundtrip",
    checkoutContractVersion: 1 as const,
    expectedTotalMinor,
  };
  const saleResult = await sale.create(command);
  assert.deepEqual(await sale.create(command), saleResult);
  const { bookingId } = saleResult;
  await db
    .insert(s.wallets)
    .values({ userId: ctx.user.id, balance: expectedTotalMinor })
    .onDuplicateKeyUpdate({ set: { balance: expectedTotalMinor } });
  const pay = walletRouter.createCaller(ctx);
  const charge = { bookingId, expectedAmount: expectedTotalMinor };
  const receipt = await pay.pay(charge);
  assert.equal(receipt.amountPaid, expectedTotalMinor);
  assert.equal(receipt.balance, 0);
  assert.deepEqual(await pay.pay(charge), receipt);
  const debits = await db
    .select()
    .from(s.walletTransactions)
    .where(eq(s.walletTransactions.bookingId, bookingId));
  assert.equal(debits.length, 1);
  assert.equal(debits[0].amount, -expectedTotalMinor);
  const people = await db
    .select()
    .from(s.passengers)
    .where(eq(s.passengers.bookingId, bookingId));
  assert.equal(people.length, 2);
  const first = people.find(person => person.firstName === "First");
  assert(first);
  const verifyView = async (actor: TrpcContext) => {
    const rows = await bookingsRouter
      .createCaller(actor)
      .baggageEntitlements({ bookingId });
    assert.equal(
      new Set(rows.map(row => row.passengerId + "/" + row.flightId)).size,
      4
    );
    for (const person of people)
      for (const flightId of flightIds) {
        const row = rows.find(
          row => row.passengerId === person.id && row.flightId === flightId
        );
        assert(row);
        assert.equal(
          row.totalWeightGrams,
          person.id === first.id && flightId === flightIds[0] ? 43000 : 23000
        );
        assert.equal(row.requiresOperationalReview, false);
      }
    const items = await ancillaryRouter
      .createCaller(actor)
      .getBookingAncillaries({ bookingId });
    assert.deepEqual(
      items.map(item => item.service?.code).sort(),
      catalog.map(item => item.code).sort()
    );
    for (const item of items) {
      assert.equal(item.status, "active");
      assert.equal(item.passengerId, first.id);
      assert.equal(item.segmentOrder, 1);
      assert.equal(item.flightNumber, "ZY711");
    }
  };
  await verifyView(ctx);
  const staff = {
    ...ctx,
    user: { ...ctx.user, id: id + 9999, role: "admin" as const },
  };
  await db.insert(s.seatInventory).values({
    flightId: flightIds[0],
    seatMapId: id,
    seatNumber: "12A",
    row: 12,
    column: "A",
    cabinClass: "economy",
    seatType: "window",
    priceTier: "free",
    seatPrice: 0,
  });
  const seats = seatMapRouter.createCaller(ctx);
  const seatScope = {
    bookingId,
    passengerId: first.id,
    flightId: flightIds[0],
  };
  await seats.selectSeat({ ...seatScope, seatNumber: "12A" });
  const originalSeat = await seats.getPassengerSeat(seatScope);
  assert.equal(originalSeat?.seatNumber, "12A");
  const [disruption] = await db
    .insert(s.flightDisruptions)
    .values({
      flightId: flightIds[0],
      type: "delay",
      reason: "Synthetic recovery drill",
      severity: "moderate",
    })
    .$returningId();
  const notices = await disruptionsRouter.createCaller(ctx).myDisruptions();
  assert(
    notices.some(
      notice =>
        notice.bookingId === bookingId &&
        notice.id === disruption.id &&
        notice.extrasReviewRequired
    )
  );
  await assert.rejects(
    iropsRouter.createCaller(staff).proposeRecovery({
      eventId: disruption.id,
      bookingIds: [bookingId],
      candidateFlightIds: [id + 2],
    }),
    /active extras/i
  );
  assert.deepEqual(await seats.getPassengerSeat(seatScope), originalSeat);
  assert.deepEqual(await sale.create(command), saleResult);
  await verifyView(ctx);
  await verifyView(staff);
  const issued = await db
    .select()
    .from(s.bookingAncillaries)
    .where(eq(s.bookingAncillaries.bookingId, bookingId));
  assert.equal(issued.length, 2);
  for (const item of issued) assert(item.fundedAt && item.fundingReference);
  return {
    bookingId,
    paidMinor: expectedTotalMinor,
    walletDebits: 1,
    scopesVerified: 4,
    recoveryRefusedWithExtras: true,
    assignedSeatRetained: "12A",
    outboundWeightGrams: 43000,
    baseWeightGrams: 23000,
  };
}
