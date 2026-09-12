import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ getDb: () => null }));
import {
  countProtectedPassengers,
  autoTriggerProtection,
  resolveIROPSEvent,
} from "../services/irops.service";

describe("IROPS execution evidence", () => {
  const rebook = {
    eventId: 1,
    targetPassengerId: 7,
    actionType: "rebook" as const,
    status: "completed" as const,
    evidenceType: "booking_reaccommodation",
    evidenceId: "21",
  };
  it("counts unique passenger/event confirmations, excluding plans, hotels and evidence-free completion", () => {
    expect(
      countProtectedPassengers([
        rebook,
        rebook,
        { ...rebook, targetPassengerId: 8 },
        { ...rebook, targetPassengerId: 9, status: "pending" },
        { ...rebook, targetPassengerId: 10, evidenceId: null },
        { ...rebook, targetPassengerId: 11, actionType: "hotel" },
      ])
    ).toBe(2);
  });
  it("never replaces unavailable durable storage with a local event or action", async () => {
    await expect(autoTriggerProtection(1)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    await expect(resolveIROPSEvent(1)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
