import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  send: vi.fn(),
  mark: vi.fn(),
  reads: [] as unknown[][],
}));
vi.mock("../services/email.service", () => ({
  sendCheckInReminder: fixture.send,
}));
vi.mock("../db", () => ({
  getDb: () => ({
    select: () => {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: () => Promise.resolve(fixture.reads.shift() ?? []),
      };
      return query;
    },
    update: () => ({
      set: (input: unknown) => ({
        where: () => fixture.mark(input),
      }),
    }),
  }),
}));

import { runCheckInReminderJob } from "./check-in-reminder.job";
import { readCheckInLink } from "../../shared/check-in-link";

beforeEach(() => {
  fixture.send.mockReset().mockResolvedValue(true);
  fixture.mark.mockReset().mockResolvedValue(undefined);
  fixture.reads = [
    [
      {
        booking: { id: 7, bookingReference: "REF123", pnr: "PNR456" },
        passenger: { firstName: "Reminder", lastName: "Traveler" },
        flight: {
          id: 42,
          flightNumber: "AIS42",
          originId: 1,
          destinationId: 2,
          departureTime: new Date("2030-01-15T12:00:00Z"),
        },
        user: { id: 1, email: "reminder@example.test" },
      },
    ],
    [{ city: "Riyadh", code: "RUH" }],
    [{ city: "Jeddah", code: "JED" }],
  ];
});

it("emails the booking PNR in the shared check-in URL contract, not the independently issued reference", async () => {
  const result = await runCheckInReminderJob();
  expect(result).toEqual({ processed: 1, emailsSent: 1, errors: [] });
  expect(fixture.send).toHaveBeenCalledTimes(1);
  const message = fixture.send.mock.calls[0][0];
  expect(message).toMatchObject({ bookingReference: "REF123", pnr: "PNR456" });
  const target = new URL(message.checkInUrl);
  expect(target.pathname).toBe("/check-in");
  expect(readCheckInLink(target.search)).toEqual({
    kind: "pnr",
    value: "PNR456",
  });
  expect(target.searchParams.has("booking")).toBe(false);
  expect(fixture.mark).toHaveBeenCalledTimes(1);
});
