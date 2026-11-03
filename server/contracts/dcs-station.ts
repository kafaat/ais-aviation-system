import { z } from "zod";

const id = z.number().int().positive();
export const stationCommand = z.object({
  flightId: id,
  expectedActorId: id.optional(),
  expectedTenantId: id.optional(),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().min(8).max(128),
});
const passenger = { passengerId: id, bookingId: id };
export const stationCaseKind = z.enum(["no_rec", "go_show"]);
export const openStationCase = stationCommand.extend({
  kind: stationCaseKind,
  stationReference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/),
});
export const resolveStationCase = stationCommand.extend({
  caseId: id,
  ...passenger,
});
export const addStationNote = stationCommand.extend(passenger);
export const eventReceipt = z.object({ eventId: id, flightId: id });

export const stationReport = z.object({
  flightId: id,
  flightNumber: z.string(),
  departureTime: z.date(),
  items: z.array(
    z.object({
      passengerId: id,
      name: z.string(),
      seat: z.string().nullable(),
      category: z.enum(["meal", "ssr", "osi"]),
      code: z.string(),
      status: z.enum(["pending", "confirmed", "recorded"]),
      note: z.string().nullable(),
    })
  ),
  closedAt: z.date().nullable(),
  stationOffBlocksAt: z.date().nullable(),
  unresolvedServices: z.number().int().nonnegative(),
  cases: z.array(
    z.object({
      id,
      kind: stationCaseKind,
      stationReference: z.string(),
      resolvedPassengerId: id.nullable(),
      dismissed: z.boolean(),
    })
  ),
});

export const blockStationSeats = stationCommand
  .extend({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    seatNumbers: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[1-9]\d{0,2}[A-Z]{1,2}$/)
      )
      .min(1)
      .max(20),
  })
  .refine(v => {
    const days = (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000;
    return (
      days >= 0 &&
      days < 31 &&
      new Set(v.seatNumbers).size === v.seatNumbers.length
    );
  }, "Choose up to 31 consecutive UTC dates and distinct seats");

export const blockedSeatsReceipt = z.object({
  flights: z.number().int().positive(),
  seats: z.number().int().positive(),
});

export const remapStationSeats = stationCommand.extend({ seatMapId: id });

export const finalizeStation = stationCommand
  .extend({
    action: z.enum(["close", "reopen", "record_out"]),
    offBlocksAt: z.iso.datetime().optional(),
  })
  .refine(
    v => (v.action === "record_out") === !!v.offBlocksAt,
    "Supply an observed UTC timestamp only for OUT"
  );

export const downgradeQuote = stationCommand.extend(passenger);
export const downgradeConfirm = downgradeQuote.extend({
  quoteEventId: id,
  expectedRefund: z.number().int().nonnegative(),
});
export const downgradeReceipt = eventReceipt.extend({
  modificationId: id,
  refundDue: z.number().int().nonnegative(),
});
