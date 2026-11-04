import { randomUUID } from "node:crypto";
import type { InboxEvent } from "../../services/event-inbox.service";

export function flightNotificationEvent(
  bookingIds = [11, 12],
  tenantId: number | null = 101
): InboxEvent {
  return {
    eventId: randomUUID(),
    eventType: "flight.status_changed",
    aggregateType: "flight",
    aggregateId: "31",
    tenantId,
    payload: {
      flightId: 31,
      flightNumber: "SV031",
      oldStatus: "scheduled",
      newStatus: "delayed",
      departureTime: "2026-11-05T10:00:00.000Z",
      arrivalTime: "2026-11-05T12:00:00.000Z",
      delayMinutes: 20,
      reason: "Weather delay",
      actorId: null,
      bookingIds,
      disruptionId: null,
    },
  };
}
