// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  enroll: z.object({
    id: outputNumber,
    passengerId: outputNumber,
    userId: outputNumber,
    biometricType: z.enum(["face", "fingerprint", "iris"]),
    templateHash: z.string(),
    consentGiven: z.boolean(),
    consentDate: z.union([z.null(), z.date()]),
    enrolledAt: z.date(),
    expiresAt: z.date(),
    status: z.enum(["active", "expired", "revoked"]),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  verify: z.object({
    verified: z.boolean(),
    confidence: outputNumber,
    enrollmentId: outputNumber,
    processingTimeMs: outputNumber,
  }),
  getBoardingToken: z.object({
    token: z.string(),
    expiresAt: z.date(),
    passengerId: outputNumber,
    flightId: outputNumber,
  }),
  getMyEnrollment: z.object({
    passengerId: outputNumber,
    enrollments: z.array(
      z.object({
        id: outputNumber,
        biometricType: z.enum(["face", "fingerprint", "iris"]),
        status: z.enum(["active", "expired", "revoked"]),
        enrolledAt: z.date(),
        expiresAt: z.date(),
      })
    ),
    hasActiveEnrollment: z.boolean(),
  }),
  revokeEnrollment: z.object({ revoked: outputNumber }),
  getFlightStats: z.object({
    flightId: outputNumber,
    totalPassengers: outputNumber,
    biometricVerified: outputNumber,
    biometricBoarded: outputNumber,
    manualBoarded: outputNumber,
    verificationFailures: outputNumber,
    averageProcessingTimeMs: outputNumber,
    biometricBoardingRate: outputNumber,
  }),
  getGateStatus: z.object({
    gateId: outputNumber,
    ready: z.boolean(),
    status: z.enum(["maintenance", "online", "offline"]),
    deviceType: z.union([z.null(), z.string()]),
    firmwareVersion: z.union([z.null(), z.string()]),
    lastCalibration: z.union([z.null(), z.date()]),
    issues: z.array(z.string()),
  }),
  getEvents: z.object({
    events: z.array(
      z.object({
        id: outputNumber,
        passengerId: outputNumber,
        flightId: z.union([z.null(), outputNumber]),
        gateId: z.union([z.null(), outputNumber]),
        eventType: z.enum([
          "enrollment",
          "verification_success",
          "verification_failure",
          "boarding_complete",
        ]),
        biometricType: z.enum(["face", "fingerprint", "iris"]),
        confidence: z.union([z.null(), outputNumber]),
        processingTimeMs: z.union([z.null(), outputNumber]),
        deviceId: z.union([z.null(), z.string()]),
        createdAt: z.date(),
      })
    ),
    total: outputNumber,
  }),
  configureGate: z.object({
    id: outputNumber,
    gateId: outputNumber,
    airportId: outputNumber,
    deviceType: z.string(),
    status: z.enum(["maintenance", "online", "offline"]),
    lastCalibration: z.union([z.null(), z.date()]),
    firmwareVersion: z.union([z.null(), z.string()]),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
};
