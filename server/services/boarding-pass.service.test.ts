import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  signBoardingPass,
  verifyBoardingPass,
  BOARDING_PASS_ISSUER,
  BOARDING_PASS_AUDIENCE,
  type BoardingPassPayload,
} from "./boarding-pass.service";

const SECRET = "test-secret";

const payload = (): BoardingPassPayload => ({
  bookingId: 1,
  bookingReference: "ABC123",
  passengerId: 9,
  passengerName: "Sara Ali",
  flightId: 5,
  flightNumber: "SV123",
  checkInNonce: "8c78e2e3-99ef-4c26-9838-a61bc155168e",
  documentDigest: "a".repeat(64),
  itineraryDigest: "b".repeat(64),
  originId: 10,
  destinationId: 20,
  departureTime: "2026-06-01T09:00:00.000Z",
  seatNumber: "12A",
  cabinClass: "economy",
  sequence: 1,
});

describe("boarding-pass sign/verify", () => {
  it("round-trips a signed pass", () => {
    const token = signBoardingPass(payload(), { secret: SECRET });
    const result = verifyBoardingPass(token, { secret: SECRET });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.bookingReference).toBe("ABC123");
      expect(result.data.seatNumber).toBe("12A");
      expect(result.data.flightNumber).toBe("SV123");
    }
  });

  it("rejects a token with a tampered signature", () => {
    const token = signBoardingPass(payload(), { secret: SECRET });
    const parts = token.split(".");
    // Corrupt the signature segment -> signature no longer matches the payload.
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("AA") ? "BB" : "AA");
    const result = verifyBoardingPass(parts.join("."), { secret: SECRET });
    expect(result.valid).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signBoardingPass(payload(), { secret: "other-secret" });
    const result = verifyBoardingPass(token, { secret: SECRET });
    expect(result.valid).toBe(false);
  });

  it("rejects an expired pass", () => {
    const token = signBoardingPass(payload(), {
      secret: SECRET,
      expiresInSeconds: -1, // already expired
    });
    const result = verifyBoardingPass(token, { secret: SECRET });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/expired/i);
  });

  it("rejects a generic JWT lacking the boarding issuer/audience", () => {
    // A token that's validly signed but is NOT a boarding pass (e.g. an auth token).
    const foreign = jwt.sign({ userId: 1 }, SECRET, {
      issuer: "ais-auth",
      audience: "ais-api",
    });
    const result = verifyBoardingPass(foreign, { secret: SECRET });
    expect(result.valid).toBe(false);
  });

  it("pins issuer and audience on issued tokens", () => {
    const token = signBoardingPass(payload(), { secret: SECRET });
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.iss).toBe(BOARDING_PASS_ISSUER);
    expect(decoded.aud).toBe(BOARDING_PASS_AUDIENCE);
  });
});
