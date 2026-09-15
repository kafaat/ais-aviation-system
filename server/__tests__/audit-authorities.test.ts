import { describe, it, expect, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import {
  airlineFinanceProcedure,
  airlineOpsProcedure,
  router,
} from "../_core/trpc";
import { recordEvent } from "../services/outbox.service";
import { fromCloudEvent, toCloudEvent } from "../contracts/domain-events";
import { transactionMemory } from "./helpers/transaction-memory";
const r = router({
  finance: airlineFinanceProcedure.query(({ ctx }) => ctx.tenantId),
  ops: airlineOpsProcedure.query(({ ctx }) => ctx.tenantId),
});
const caller = (
  role: string,
  tenantId: number | null = 7,
  userTenant: number | null = 7
) =>
  r.createCaller({
    user: { id: 1, role, tenantId: userTenant },
    tenantId,
    req: { headers: {} },
    res: {},
  } as TrpcContext);
describe("F24 scoped role commands", () => {
  it("separates finance from operations and accepts scoped airline administrators", async () => {
    await expect(caller("finance").finance()).resolves.toBe(7);
    await expect(caller("finance").ops()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller("ops").ops()).resolves.toBe(7);
    await expect(caller("ops").finance()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller("airline_admin").ops()).resolves.toBe(7);
    await expect(caller("airline_admin").finance()).resolves.toBe(7);
  });
  it.each([
    [null, 7],
    [8, 7],
    [null, null],
  ])(
    "rejects absent or mismatched tenant (%s,%s)",
    async (tenant, userTenant) => {
      await expect(
        caller("ops", tenant, userTenant).ops()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller("finance", tenant, userTenant).finance()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
});
const fixtures: [string, Record<string, unknown>][] = [
  ["flight.refund_planned", { flightId: 1, bookingId: 2, amount: 0, jobId: 3 }],
  [
    "booking.invoice_changed",
    { bookingId: 1, previousTotal: 10000, totalAmount: 9000 },
  ],
  [
    "booking.checkout_requested",
    {
      bookingId: 1,
      requestId: "36833081-abff-4524-a607-3c84c6d94160",
      invoiceHash: "abc",
    },
  ],
  ["payment.refunded", { bookingId: 1, userId: 2, amount: 300 }],
  [
    "booking.split_payment_created",
    { bookingId: 1, splitIds: [1, 2], totalAmount: 9000 },
  ],
  ["order.refund_planned", { modificationId: 2, amount: 300, payers: 2 }],
  [
    "inventory.adjusted",
    {
      cabinClass: "economy",
      previous: 5,
      available: 3,
      capacity: 10,
      reservedSeats: 5,
      heldSeats: 2,
      actorId: 2,
      reason: "test",
    },
  ],
];
describe("F26 financial and inventory producer contracts", () => {
  it.each(fixtures)(
    "%s rejects a missing consumer field before writing and preserves replay",
    async (eventType, payload) => {
      const envelope = {
        eventId: "36833081-abff-4524-a607-3c84c6d94160",
        eventType,
        aggregateType: "booking",
        aggregateId: "1",
        tenantId: 7,
        payload,
        createdAt: new Date("2026-09-15T00:00:00Z"),
      };
      expect(fromCloudEvent(toCloudEvent(envelope)).payload).toEqual(payload);
      for (const key of Object.keys(payload)) {
        const missing = { ...payload };
        delete missing[key];
        const db = transactionMemory({});
        await expect(
          recordEvent(db.db, { ...envelope, payload: missing })
        ).rejects.toThrow();
        expect(db.rows("outbox")).toHaveLength(0);
      }
    }
  );
});
