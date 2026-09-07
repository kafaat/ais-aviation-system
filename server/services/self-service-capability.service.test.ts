import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  assertPassengerInKioskCapability,
  issueSelfServiceCapability,
  verifySelfServiceCapability,
} from "./self-service-capability.service";

const secret = "test-self-service-capability-secret-0123456789";

describe("self-service capability boundary", () => {
  it("round-trips a kiosk scope and preserves passenger allowlist", () => {
    const token = issueSelfServiceCapability(
      {
        kind: "kiosk-session",
        bookingId: 42,
        sessionId: 7,
        passengerIds: [10, 11],
      },
      { secret }
    );
    const decoded = verifySelfServiceCapability(token, "kiosk-session", {
      secret,
    });
    expect(decoded.bookingId).toBe(42);
    expect(decoded.sessionId).toBe(7);
    expect(decoded.passengerIds).toEqual([10, 11]);
    expect(() => assertPassengerInKioskCapability(decoded, 11)).not.toThrow();
    expect(() => assertPassengerInKioskCapability(decoded, 99)).toThrow(
      TRPCError
    );
  });

  it("cannot replay a capability into a different self-service scope", () => {
    const token = issueSelfServiceCapability(
      { kind: "bag-drop-admission", bookingId: 42, passengerId: 10 },
      { secret }
    );
    expect(() =>
      verifySelfServiceCapability(token, "bag-drop-session", { secret })
    ).toThrow(TRPCError);
  });

  it("rejects tampering", () => {
    const token = issueSelfServiceCapability(
      { kind: "bag-drop-admission", bookingId: 42, passengerId: 10 },
      { secret }
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(() =>
      verifySelfServiceCapability(tampered, "bag-drop-admission", { secret })
    ).toThrow(TRPCError);
  });

  it("rejects expired capabilities", () => {
    const token = issueSelfServiceCapability(
      { kind: "bag-drop-admission", bookingId: 42, passengerId: 10 },
      { secret, expiresInSeconds: -1 }
    );
    expect(() =>
      verifySelfServiceCapability(token, "bag-drop-admission", { secret })
    ).toThrow(TRPCError);
  });
});
