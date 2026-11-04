import assert from "node:assert/strict";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";
import { analyticsRouter } from "../../server/routers/analytics";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Real SQL verifies capacity de-duplication, onward sectors and ancillary cohorts. */
export async function verifyAnalyticsLinkage(
  db: SettlementTx,
  ctx: TrpcContext,
  tenantId: number
) {
  assert(ctx.user);
  const at = new Date("2017-02-01T12:00:00Z");
  const period = {
    startDate: new Date("2017-02-01T00:00:00Z"),
    endDate: new Date("2017-02-01T23:59:59.999Z"),
  };
  const caller = analyticsRouter.createCaller({
    ...ctx,
    user: { ...ctx.user, role: "admin" },
  });
  const flightIds: number[] = [];
  for (const [index, capacity] of [100, 200, 200].entries()) {
    const [flight] = await db.insert(s.flights).values({
      tenantId,
      airlineId: tenantId,
      originId: tenantId,
      destinationId: tenantId + 1,
      flightNumber: `RA90${index}`,
      departureTime: at,
      arrivalTime: new Date(at.getTime() + 3600_000),
      economySeats: capacity,
      economyAvailable: capacity,
      economyPrice: 10000,
      businessSeats: 0,
      businessAvailable: 0,
      businessPrice: 0,
    });
    flightIds.push(flight.insertId);
  }
  const bookingIds: number[] = [];
  for (const [index, count] of [10, 20, 1].entries()) {
    const [booking] = await db.insert(s.bookings).values({
      tenantId,
      userId: ctx.user.id,
      flightId: flightIds[0],
      bookingReference: `RPA00${index}`,
      pnr: `ANA00${index}`,
      numberOfPassengers: count,
      totalAmount: count * 10000,
      cabinClass: "economy",
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
      createdAt: index === 2 ? new Date("2016-02-01T12:00:00Z") : at,
    });
    bookingIds.push(booking.insertId);
  }
  const primary = await caller.getKPIs(period);
  assert.equal(primary.totalBookings, 2);
  assert.equal(primary.averageOccupancyRate, 30);
  await db.insert(s.bookingSegments).values(
    flightIds.map((flightId, index) => ({
      bookingId: bookingIds[1],
      flightId,
      segmentOrder: index + 1,
      departureDate: at,
      seatsReserved: index !== 2,
      status: index === 2 ? ("cancelled" as const) : ("confirmed" as const),
    }))
  );
  const onward = await caller.getKPIs(period);
  assert.equal(onward.averageOccupancyRate, 16.7); // (30 + 20) / (100 + 200)
  const [service] = await db.insert(s.ancillaryServices).values({
    code: "REPORT-ANALYTICS-MEAL",
    category: "meal",
    name: "Synthetic report meal",
    price: 1000,
  });
  const items = [
    {
      bookingId: bookingIds[0],
      quantity: 1,
      unitPrice: 1000,
      status: "active",
      fundedAt: at,
    },
    {
      bookingId: bookingIds[1],
      quantity: 2,
      unitPrice: 1000,
      status: "active",
      fundedAt: at,
    },
    {
      bookingId: bookingIds[0],
      quantity: 1,
      unitPrice: 30000,
      status: "active",
      fundedAt: null,
    },
    {
      bookingId: bookingIds[0],
      quantity: 1,
      unitPrice: 40000,
      status: "cancelled",
      fundedAt: at,
    },
    {
      bookingId: bookingIds[0],
      quantity: 1,
      unitPrice: 50000,
      status: "refunded",
      fundedAt: at,
    },
    {
      bookingId: bookingIds[2],
      quantity: 1,
      unitPrice: 60000,
      status: "active",
      fundedAt: at,
    },
  ] as const;
  await db.insert(s.bookingAncillaries).values(
    items.map(item => ({
      ...item,
      ancillaryServiceId: service.insertId,
      totalPrice: item.quantity * item.unitPrice,
      // Purchase time is deliberately different: selected cohort is booking creation.
      createdAt: new Date("2017-03-01T12:00:00Z"),
    }))
  );
  assert.deepEqual(await caller.getAncillaryMetrics(period), {
    totalAncillaryRevenue: 3000,
    totalAncillariesSold: 3,
    ancillaryAttachmentRate: 100,
    averageAncillaryRevenuePerBooking: 1500,
  });
  assert.deepEqual(await caller.getAncillaryRevenueByCategory(period), [
    { category: "meal", revenue: 3000, quantity: 3, percentage: 100 },
  ]);
  assert.deepEqual(await caller.getPopularAncillaries(period), [
    {
      serviceName: "Synthetic report meal",
      category: "meal",
      totalSold: 3,
      revenue: 3000,
    },
  ]);
  const trend = await caller.getBookingTrends(period);
  assert.equal(trend.length, 1);
  assert.equal(trend[0].bookings, 2);
  assert.equal(trend[0].passengers, 30);
  assert.equal(
    (await caller.getPopularDestinations(period))[0].bookingCount,
    2
  );
  return {
    capacityCountedOnce: primary.averageOccupancyRate,
    onwardSectorOccupancy: onward.averageOccupancyRate,
    cancelledSectorExcluded: true,
    fundedActiveBookedAncillaryMinor: 3000,
    unpaidCancelledRefundedAndOtherCohortExcluded: true,
    chartAndRankingPeriodApplied: true,
  };
}
