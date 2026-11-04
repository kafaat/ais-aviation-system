import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, users } from "../../drizzle/schema";
import { transactionMemory } from "./helpers/transaction-memory";
import { flightNotificationEvent } from "./helpers/flight-notification-event";
import type { FlightStatusChangeData } from "../services/email.service";

const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof import("../db").getDb>,
  send: vi.fn<(data: FlightStatusChangeData) => Promise<boolean>>(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/email.service", () => ({
  sendFlightStatusChange: state.send,
}));
import { deliverFlightStatusEmails } from "../services/flight-event-delivery.service";

let memory: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  state.send.mockReset().mockResolvedValue(true);
  memory = transactionMemory({
    bookings: [
      { id: 11, tenantId: 101, userId: 1, bookingReference: "ONE111" },
      { id: 12, tenantId: 101, userId: 2, bookingReference: "TWO222" },
    ],
    users: [
      { id: 1, email: "first@example.test", name: "First" },
      { id: 2, email: "second@example.test", name: "Second" },
    ],
    flights: [{ id: 31, tenantId: 101, originId: 21, destinationId: 22 }],
    airports: [
      { id: 21, code: "RUH" },
      { id: 22, code: "JED" },
    ],
    event_inbox: [],
    event_deliveries: [],
  });
  // Add only this consumer's booking/user join to the existing SQL-predicate
  // double. Inbox claim/failure/replay logic remains the actual implementation.
  // Native transactions and uniqueness are verified by the MySQL companion.
  const select = memory.db.select.bind(memory.db);
  memory.db.select = (projection?: Record<string, unknown>) => {
    const query = select(projection);
    return {
      ...query,
      from(table: unknown) {
        if (table !== bookings) return query.from(table);
        return {
          innerJoin(joined: unknown, condition: SQL) {
            expect(joined).toBe(users);
            expect(new MySqlDialect().sqlToQuery(condition).sql).toBe(
              "`users`.`id` = `bookings`.`userId`"
            );
            return {
              async where(predicate: SQL) {
                const selected: Array<{
                  userId: number;
                  bookingReference: string;
                }> = await select().from(bookings).where(predicate);
                return selected.flatMap(booking => {
                  const user = memory
                    .rows("users")
                    .find(candidate => candidate.id === booking.userId);
                  return user
                    ? [
                        {
                          reference: booking.bookingReference,
                          email: user.email,
                          name: user.name,
                        },
                      ]
                    : [];
                });
              },
            };
          },
        };
      },
    };
  };
  state.db = memory.db;
});

describe("actual flight delivery and inbox receipts (relational boundary double)", () => {
  it("accepts each recipient once and suppresses duplicate events with stable provider keys", async () => {
    const event = flightNotificationEvent();
    await deliverFlightStatusEmails(event);
    await deliverFlightStatusEmails(event);
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(
      state.send.mock.calls.map(([data]) => data.idempotencyKey).sort()
    ).toEqual([
      `${event.eventId}:flight-email:11`,
      `${event.eventId}:flight-email:12`,
    ]);
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        passengerName: "First",
        passengerEmail: "first@example.test",
        bookingReference: "ONE111",
        flightNumber: "SV031",
        origin: "RUH",
        destination: "JED",
        departureTime: new Date("2026-11-05T10:00:00.000Z"),
        newStatus: "delayed",
        delayMinutes: 20,
        reason: "Weather delay",
      })
    );
    expect(
      memory
        .rows("event_deliveries")
        .map(row => ({ status: row.status, attempts: row.attempts }))
    ).toEqual([
      { status: "processed", attempts: 1 },
      { status: "processed", attempts: 1 },
    ]);
  });

  it("retries only the failed passenger after partial success and reuses its provider key", async () => {
    const event = flightNotificationEvent();
    state.send.mockImplementation(
      async data => data.passengerEmail !== "second@example.test"
    );
    await expect(deliverFlightStatusEmails(event)).rejects.toThrow(
      "Flight email delivery incomplete"
    );
    expect(
      memory
        .rows("event_deliveries")
        .find(row => row.consumer === "flight-email:11")
    ).toMatchObject({ status: "processed", attempts: 1 });
    expect(
      memory
        .rows("event_deliveries")
        .find(row => row.consumer === "flight-email:12")
    ).toMatchObject({ status: "failed", attempts: 1, processedAt: null });
    state.send.mockResolvedValue(true);
    await deliverFlightStatusEmails(event);
    await deliverFlightStatusEmails(event);
    expect(state.send).toHaveBeenCalledTimes(3);
    expect(
      state.send.mock.calls.filter(
        ([data]) => data.passengerEmail === "first@example.test"
      )
    ).toHaveLength(1);
    expect(
      state.send.mock.calls
        .filter(([data]) => data.passengerEmail === "second@example.test")
        .map(([data]) => data.idempotencyKey)
    ).toEqual([
      `${event.eventId}:flight-email:12`,
      `${event.eventId}:flight-email:12`,
    ]);
    expect(
      memory
        .rows("event_deliveries")
        .find(row => row.consumer === "flight-email:12")
    ).toMatchObject({ status: "processed", attempts: 2, lastError: null });
  });

  it("retains a retryable failure on provider timeout without recording acceptance or storing raw provider data", async () => {
    const event = flightNotificationEvent([11]);
    state.send.mockRejectedValueOnce(
      new Error("Provider timeout for first@example.test")
    );
    await expect(deliverFlightStatusEmails(event)).rejects.toThrow(
      "Flight email delivery incomplete"
    );
    expect(memory.rows("event_deliveries")[0]).toMatchObject({
      status: "failed",
      processedAt: null,
      leaseToken: null,
    });
    expect(memory.rows("event_deliveries")[0].lastError).not.toContain(
      "first@example.test"
    );
    await deliverFlightStatusEmails(event);
    expect(memory.rows("event_deliveries")[0]).toMatchObject({
      status: "processed",
      attempts: 2,
    });
  });

  it.each(["email", "user", "flight", "origin", "destination"] as const)(
    "does not claim success when the %s is missing",
    async missing => {
      if (missing === "email") memory.rows("users")[0].email = null;
      if (missing === "user") memory.rows("users").splice(0, 1);
      if (missing === "flight") memory.rows("flights").splice(0);
      if (missing === "origin") memory.rows("airports").splice(0, 1);
      if (missing === "destination") memory.rows("airports").splice(1, 1);
      await expect(
        deliverFlightStatusEmails(flightNotificationEvent([11]))
      ).rejects.toThrow("Flight email delivery incomplete");
      expect(state.send).not.toHaveBeenCalled();
      expect(memory.rows("event_deliveries")[0]).toMatchObject({
        status: "failed",
        processedAt: null,
      });
    }
  );

  it.each([
    [101, 202],
    [null, 101],
    [101, null],
  ] as const)(
    "excludes booking tenant %s from event tenant %s",
    async (bookingTenant, eventTenant) => {
      memory.rows("bookings")[0].tenantId = bookingTenant;
      await expect(
        deliverFlightStatusEmails(flightNotificationEvent([11], eventTenant))
      ).rejects.toThrow("Flight email delivery incomplete");
      expect(state.send).not.toHaveBeenCalled();
    }
  );

  it("does not use a flight owned by another tenant even when the recipient booking matches", async () => {
    memory.rows("flights")[0].tenantId = 202;
    await expect(
      deliverFlightStatusEmails(flightNotificationEvent([11], 101))
    ).rejects.toThrow("Flight email delivery incomplete");
    expect(state.send).not.toHaveBeenCalled();
    expect(memory.rows("event_deliveries")[0]).toMatchObject({
      status: "failed",
      processedAt: null,
    });
  });

  it("supports public legacy records and nullable passenger and delay fields", async () => {
    memory.rows("bookings")[0].tenantId = null;
    memory.rows("flights")[0].tenantId = null;
    memory.rows("users")[0].name = null;
    const event = flightNotificationEvent([11], null);
    event.payload = { ...event.payload, delayMinutes: null, reason: null };
    await deliverFlightStatusEmails(event);
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        passengerName: "Passenger",
        delayMinutes: undefined,
        reason: undefined,
      })
    );
  });

  it("rejects changed payload on an existing event identity without resending accepted mail", async () => {
    const event = flightNotificationEvent([11]);
    await deliverFlightStatusEmails(event);
    await expect(
      deliverFlightStatusEmails({
        ...event,
        payload: { ...event.payload, reason: "Different event data" },
      })
    ).rejects.toThrow("Flight email delivery incomplete");
    expect(state.send).toHaveBeenCalledOnce();
    expect(memory.rows("event_deliveries")[0]).toMatchObject({
      status: "processed",
      attempts: 1,
    });
  });

  it("keeps a pending provider request unprocessed and refuses another claim until it finishes", async () => {
    let release!: (accepted: boolean) => void;
    state.send.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    const event = flightNotificationEvent([11]);
    const pending = deliverFlightStatusEmails(event);
    await vi.waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    expect(memory.rows("event_deliveries")[0]).toMatchObject({
      status: "processing",
      processedAt: null,
    });
    await expect(deliverFlightStatusEmails(event)).rejects.toThrow(
      "Flight email delivery incomplete"
    );
    expect(state.send).toHaveBeenCalledOnce();
    release(true);
    await pending;
    expect(memory.rows("event_deliveries")[0]).toMatchObject({
      status: "processed",
      attempts: 1,
    });
  });

  it("rejects malformed event data before creating a receipt or sending mail", async () => {
    const event = flightNotificationEvent([11]);
    event.payload = { ...event.payload, departureTime: "not-a-date" };
    await expect(deliverFlightStatusEmails(event)).rejects.toThrow();
    expect(memory.rows("event_deliveries")).toHaveLength(0);
    expect(state.send).not.toHaveBeenCalled();
  });

  it("refuses delivery when its database is unavailable", async () => {
    state.db = null;
    await expect(
      deliverFlightStatusEmails(flightNotificationEvent())
    ).rejects.toThrow("Database unavailable");
    expect(state.send).not.toHaveBeenCalled();
  });
});
