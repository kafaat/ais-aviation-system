import { and, eq } from "drizzle-orm";
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
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

/**
 * Scenario S-07 of docs/architecture/improvement-plan-2026-11.md.
 *
 * A ticket is issued on the first read of its document: the passenger row has
 * no number, readTicketDocument allocates one, writes the coupons and records
 * ETicketIssued, all inside one transaction that first locks the booking row.
 * passengers.ticketNumber carries only a non-unique index, so the lock is the
 * sole guard against two first readers each allocating a number. These cases
 * exercise that guard on native MySQL rather than on a fixture.
 */
const provider = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => provider.db }));
import { readTicketDocument } from "../services/ticket-documents.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

nativeDescribe.sequential("ticket issuance on native MySQL", () => {
  let fixture: PaidBookingNativeFixture;

  beforeAll(async () => {
    fixture = await createPaidBookingNativeFixture("ais_confirmation");
  }, 60000);

  afterAll(async () => {
    await fixture?.close();
  });

  beforeEach(async () => {
    await fixture.reset();
    await fixture.seed();
    provider.db = fixture.db;
    // The fixture seeds an unpaid booking; issuance needs a paid, confirmed one.
    await fixture.db
      .update(schema.bookings)
      .set({ status: "confirmed", paymentStatus: "paid" })
      .where(eq(schema.bookings.id, 71));
  });

  async function issuedEvents(passengerId: number) {
    const rows = await fixture.db
      .select({ payload: schema.outbox.payload })
      .from(schema.outbox)
      .where(
        and(
          eq(schema.outbox.eventType, "ETicketIssued"),
          eq(schema.outbox.aggregateId, "71")
        )
      );
    return rows.filter(
      row =>
        (row.payload as { passengerId?: number }).passengerId === passengerId
    );
  }

  async function couponsFor(passengerId: number) {
    return fixture.db
      .select()
      .from(schema.ticketCoupons)
      .where(
        and(
          eq(schema.ticketCoupons.bookingId, 71),
          eq(schema.ticketCoupons.passengerId, passengerId)
        )
      );
  }

  it("issues one ticket number and one issuance event when two first reads race", async () => {
    const [first, second] = await Promise.all([
      readTicketDocument(71, 81, 9),
      readTicketDocument(71, 81, 9),
    ]);
    expect(first.data.ticketNumber).toMatch(/^\d{13}$/);
    expect(second.data.ticketNumber).toBe(first.data.ticketNumber);

    const [passenger] = await fixture.db
      .select({ ticketNumber: schema.passengers.ticketNumber })
      .from(schema.passengers)
      .where(eq(schema.passengers.id, 81));
    expect(passenger?.ticketNumber).toBe(first.data.ticketNumber);

    const coupons = await couponsFor(81);
    expect(coupons).toHaveLength(first.legs.length);
    expect(new Set(coupons.map(c => c.ticketNumber))).toEqual(
      new Set([first.data.ticketNumber])
    );
    expect(await issuedEvents(81)).toHaveLength(1);
  });

  it("gives concurrent first reads of different passengers distinct numbers and one event each", async () => {
    const [alpha, beta] = await Promise.all([
      readTicketDocument(71, 81, 9),
      readTicketDocument(71, 82, 9),
    ]);
    expect(alpha.data.ticketNumber).not.toBe(beta.data.ticketNumber);
    expect(await issuedEvents(81)).toHaveLength(1);
    expect(await issuedEvents(82)).toHaveLength(1);
    expect(await couponsFor(81)).toHaveLength(alpha.legs.length);
    expect(await couponsFor(82)).toHaveLength(beta.legs.length);
  });

  it("returns the same document on a later read without a second issuance", async () => {
    const issued = await readTicketDocument(71, 82, 9);
    const again = await readTicketDocument(71, 82, 9);
    expect(again.data.ticketNumber).toBe(issued.data.ticketNumber);
    expect(again.data.issueDate.getTime()).toBe(
      issued.data.issueDate.getTime()
    );
    expect(await issuedEvents(82)).toHaveLength(1);
  });

  it("refuses issuance for an unpaid booking and writes nothing", async () => {
    await fixture.db
      .update(schema.bookings)
      .set({ paymentStatus: "pending" })
      .where(eq(schema.bookings.id, 71));
    await expect(readTicketDocument(71, 81, 9)).rejects.toThrow(
      "Paid active itinerary required for ticket documents"
    );
    const [passenger] = await fixture.db
      .select({ ticketNumber: schema.passengers.ticketNumber })
      .from(schema.passengers)
      .where(eq(schema.passengers.id, 81));
    expect(passenger?.ticketNumber).toBeNull();
    expect(await couponsFor(81)).toHaveLength(0);
    expect(await issuedEvents(81)).toHaveLength(0);
  });
});
