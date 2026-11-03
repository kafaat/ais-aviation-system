import assert from "node:assert/strict";
import {
  decodeBcbpM1,
  normalizeBcbpSeat,
} from "../../server/services/bcbp.service";
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
    departureDate: when(1 + index / 2),
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
  await db.insert(s.seatInventory).values(
    flightIds.flatMap(flightId =>
      ["12A", "12B", "12C"].map(seatNumber => ({
        flightId,
        seatMapId: id,
        seatNumber,
        row: 12,
        column: seatNumber.slice(-1),
        cabinClass: "economy" as const,
        seatType: "window" as const,
        priceTier:
          seatNumber === "12B" ? ("preferred" as const) : ("free" as const),
        seatPrice: seatNumber === "12B" ? 500 : 0,
      }))
    )
  );
  const namedSegments = segments.map((leg, segmentIndex) => ({
    ...leg,
    seats: passengers.map((_, passengerIndex) => ({
      passengerIndex,
      seatNumber: passengerIndex === segmentIndex ? "12A" : "12C",
    })),
  }));
  const command = {
    segments: namedSegments,
    passengers,
    cabinClass,
    ancillaries,
    sessionId: "scoped-ancillary-roundtrip",
    checkoutContractVersion: 1 as const,
    expectedTotalMinor,
  };
  const badSeat = { passengerIndex: 1, seatNumber: "12B" };
  await assert.rejects(
    sale.create({
      ...command,
      sessionId: "sector-paid-seat-rejected",
      segments: [namedSegments[0], { ...segments[1], seats: [badSeat] }],
    }),
    /seat unavailable/i
  );
  for (const flightId of flightIds) {
    const inventory = await db
      .select()
      .from(s.seatInventory)
      .where(eq(s.seatInventory.flightId, flightId));
    assert(
      inventory.every(
        row => row.status === "available" && row.bookingId === null
      )
    );
    const partial = await db
      .select()
      .from(s.inventoryLocks)
      .where(eq(s.inventoryLocks.flightId, flightId));
    assert.equal(partial.length, 0);
  }
  await assert.rejects(
    sale.create({
      ...command,
      sessionId: "sector-duplicate-seat-rejected",
      segments: [
        {
          ...segments[0],
          seats: [
            { passengerIndex: 0, seatNumber: "12A" },
            { passengerIndex: 1, seatNumber: "12A" },
          ],
        },
        namedSegments[1],
      ],
    }),
    /one distinct seat/i
  );
  const attempts = [
    command,
    { ...command, sessionId: "same-seat-competing-order" },
  ];
  const outcomes = await Promise.allSettled(
    attempts.map(attempt => sale.create(attempt))
  );
  const winners = outcomes.filter(r => r.status === "fulfilled");
  assert.equal(winners.length, 1);
  const loser = outcomes.find(r => r.status === "rejected");
  assert(loser && /seat unavailable/i.test(String(loser.reason)));
  const accepted = attempts[outcomes.findIndex(r => r.status === "fulfilled")];
  const saleResult = winners[0].value;
  assert.deepEqual(await sale.create(accepted), saleResult);
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
  for (const [index, flightId] of flightIds.entries()) {
    const owner = people.find(
      person => person.firstName === passengers[index].firstName
    );
    assert(owner);
    const assigned = await db
      .select()
      .from(s.seatInventory)
      .where(eq(s.seatInventory.flightId, flightId));
    assert(
      assigned.some(
        row =>
          row.seatNumber === "12A" &&
          row.status === "occupied" &&
          row.bookingId === bookingId &&
          row.passengerId === owner.id
      )
    );
    assert(
      assigned.some(
        row =>
          row.seatNumber === "12B" &&
          row.status === "available" &&
          row.bookingId === null
      )
    );
  }
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
  assert.deepEqual(await sale.create(accepted), saleResult);
  await verifyView(ctx);
  await verifyView(staff);
  const issued = await db
    .select()
    .from(s.bookingAncillaries)
    .where(eq(s.bookingAncillaries.bookingId, bookingId));
  assert.equal(issued.length, 2);
  for (const item of issued) assert(item.fundedAt && item.fundingReference);
  let verifiedBoardingPasses = 0;
  for (const [segmentIndex, flightId] of flightIds.entries()) {
    for (const { passengerIndex, seatNumber } of namedSegments[segmentIndex]
      .seats) {
      const person = people.find(
        p => p.firstName === passengers[passengerIndex].firstName
      );
      assert(person);
      const scope = { bookingId, passengerId: person.id, flightId };
      assert.equal(
        (await seats.getPassengerSeat(scope))?.seatNumber,
        seatNumber
      );
      await seats.checkIn(scope); // No override: use the customer's stored initial seat.
      const pass = await seats.getBoardingPass({
        passengerId: person.id,
        flightId,
      });
      assert.equal(pass.flightNumber, "ZY" + (711 + segmentIndex));
      assert.equal(pass.passenger.firstName, person.firstName);
      assert.equal(pass.seat.seatNumber, seatNumber);
      assert.equal(
        normalizeBcbpSeat(decodeBcbpM1(pass.bcbp).seatNumber),
        seatNumber
      );
      verifiedBoardingPasses++;
    }
    const map = await seats.getFlightSeatMap({ flightId });
    const occupied = map.cabins
      .flatMap(c => c.rows.flatMap(r => r.seats))
      .filter(s => s.status === "checked_in");
    assert.deepEqual(occupied.map(s => s.seatNumber).sort(), ["12A", "12C"]);
  }
  return {
    bookingId,
    paidMinor: expectedTotalMinor,
    walletDebits: 1,
    scopesVerified: 4,
    initialSectorSeatsVerified: 4,
    verifiedBoardingPasses,
    competingSeatOrderWinners: winners.length,
    failedSeatSelectionRolledBack: true,
    recoveryRefusedWithExtras: true,
    assignedSeatRetained: "12A",
    outboundWeightGrams: 43000,
    baseWeightGrams: 23000,
  };
}
