import { z } from "zod";

const id = z.number().int().positive();
export const dcsAttendanceState = z.enum([
  "not_checked_in",
  "checked_in",
  "boarded",
  "offloaded",
]);
export const dcsDepartureState = z.enum([
  "not_checked_in",
  "checked_in",
  "boarding_denied",
  "boarded",
  "offloaded",
]);
const command = z.object({
  flightId: id,
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().min(1).max(255),
});
export const changeDcsFlightInput = command.extend({
  action: z.enum(["open", "close", "reopen"]),
});
export const dcsCheckInInput = command.extend({
  bookingId: id,
  passengerId: id,
  seatNumber: z.string().trim().min(1).max(5).optional(),
});
export const dcsTransitionInput = command.extend({
  bookingId: id,
  passengerId: id,
  action: z.enum(["board", "deplane", "deny", "allow", "offload"]),
  boardingPassToken: z.string().min(1).max(8192).optional(),
});
export const dcsReturnBagInput = command.extend({
  bookingId: id,
  passengerId: id,
  segmentId: id,
  tagNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/),
});
export const dcsReturnBagResult = z.object({
  eventId: id,
  tagNumber: z.string(),
});
export const dcsPassengerResult = z.object({
  eventId: id,
  flightId: id,
  bookingId: id,
  passengerId: id,
  state: dcsDepartureState,
  seatNumber: z.string().nullable(),
  changed: z.boolean(),
});
export const dcsBagReturnGrantInput = command.extend({
  staffId: id,
  airlineId: id,
  airportId: id,
  enabled: z.boolean(),
});
export const dcsBagReturnGrantResult = dcsBagReturnGrantInput
  .pick({ staffId: true, airlineId: true, airportId: true, enabled: true })
  .extend({ eventId: id });
export const dcsFlightResult = z.object({
  eventId: id,
  flightId: id,
  state: z.enum(["open", "closed"]),
  changed: z.boolean(),
});
export const dcsDesk = z.object({
  flight: z.object({
    id,
    flightNumber: z.string(),
    tenantId: id.nullable(),
    airlineId: id,
    originId: id,
    destinationId: id,
    departureTime: z.date(),
    dcsClosedAt: z.date().nullable().optional(),
    stationOffBlocksAt: z.date().nullable().optional(),
    status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
  }),
  checkInState: z.enum(["open", "closed"]),
  stateConfigured: z.boolean(),
  canReturnBags: z.boolean(),
  checkInWindowOpen: z.boolean(),
  passengers: z.array(
    z.object({
      bookingId: id,
      passengerId: id,
      segmentId: id.nullable(),
      name: z.string(),
      pnr: z.string(),
      bookingReference: z.string(),
      cabinClass: z.enum(["economy", "business"]),
      seatNumber: z.string().nullable(),
      departureState: dcsDepartureState,
      attendanceState: dcsAttendanceState,
      boardingDenied: z.boolean(),
      checkedIn: z.boolean(),
    })
  ),
  history: z.array(
    z.object({
      id,
      bookingId: id.nullable(),
      passengerId: id.nullable(),
      action: z.string(),
      fromState: z.string(),
      toState: z.string(),
      actorId: id.nullable(),
      actorRole: z.string(),
      reason: z.string(),
      createdAt: z.date(),
    })
  ),
  historyHasMore: z.boolean(),
});

export type DcsDesk = z.infer<typeof dcsDesk>;
export type DcsPassengerResult = z.infer<typeof dcsPassengerResult>;
