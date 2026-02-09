/**
 * Biometric Boarding Router
 *
 * Endpoints for biometric enrollment, identity verification,
 * boarding token generation, gate management, and audit trail.
 *
 * - Protected endpoints: enroll, verify, getBoardingToken, getMyEnrollment, revokeEnrollment
 * - Admin endpoints: getFlightStats, getGateStatus, getEvents, configureGate
 */

import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as biometricService from "../services/biometric.service";

export const biometricRouter = router({
  // ========================================================================
  // Passenger Enrollment
  // ========================================================================

  /**
   * Enroll a passenger's biometric template.
   * Requires explicit consent before processing.
   */
  enroll: protectedProcedure
    .input(
      z.object({
        passengerId: z.number().int().positive(),
        biometricType: z.enum(["face", "fingerprint", "iris"]),
        templateHash: z
          .string()
          .min(16, "Template hash must be at least 16 characters"),
        consentGiven: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await biometricService.enrollPassenger(
        input.passengerId,
        input.biometricType,
        input.templateHash,
        ctx.user.id,
        input.consentGiven
      );
    }),

  // ========================================================================
  // Identity Verification
  // ========================================================================

  /**
   * Verify a passenger's identity against their stored biometric template.
   */
  verify: protectedProcedure
    .input(
      z.object({
        passengerId: z.number().int().positive(),
        biometricType: z.enum(["face", "fingerprint", "iris"]),
        templateHash: z.string().min(16),
        gateId: z.number().int().positive().optional(),
        deviceId: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await biometricService.verifyIdentity(
        input.passengerId,
        input.biometricType,
        input.templateHash,
        input.gateId ?? null,
        input.deviceId ?? null
      );
    }),

  // ========================================================================
  // Boarding Token
  // ========================================================================

  /**
   * Generate a one-time boarding token after biometric verification.
   * The passenger must have a recent successful verification.
   */
  getBoardingToken: protectedProcedure
    .input(
      z.object({
        passengerId: z.number().int().positive(),
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await biometricService.getBoardingToken(
        input.passengerId,
        input.flightId
      );
    }),

  // ========================================================================
  // Enrollment Status
  // ========================================================================

  /**
   * Get the current enrollment status for a passenger.
   */
  getMyEnrollment: protectedProcedure
    .input(
      z.object({
        passengerId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await biometricService.getEnrollmentStatus(input.passengerId);
    }),

  // ========================================================================
  // Enrollment Revocation
  // ========================================================================

  /**
   * Revoke a passenger's biometric enrollment (right to erasure).
   * Optionally specify a biometric type to revoke only that type.
   */
  revokeEnrollment: protectedProcedure
    .input(
      z.object({
        passengerId: z.number().int().positive(),
        biometricType: z.enum(["face", "fingerprint", "iris"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await biometricService.revokeEnrollment(
        input.passengerId,
        input.biometricType
      );
    }),

  // ========================================================================
  // Admin: Flight Statistics
  // ========================================================================

  /**
   * Get biometric boarding statistics for a flight.
   * Shows biometric vs. manual boarding breakdown.
   */
  getFlightStats: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await biometricService.getFlightBiometricStats(input.flightId);
    }),

  // ========================================================================
  // Admin: Gate Status
  // ========================================================================

  /**
   * Check biometric hardware readiness for a gate.
   */
  getGateStatus: adminProcedure
    .input(
      z.object({
        gateId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      return await biometricService.getGateReadiness(input.gateId);
    }),

  // ========================================================================
  // Admin: Audit Trail
  // ========================================================================

  /**
   * Query biometric events for audit and compliance purposes.
   */
  getEvents: adminProcedure
    .input(
      z
        .object({
          passengerId: z.number().int().positive().optional(),
          flightId: z.number().int().positive().optional(),
          gateId: z.number().int().positive().optional(),
          eventType: z
            .enum([
              "enrollment",
              "verification_success",
              "verification_failure",
              "boarding_complete",
            ])
            .optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await biometricService.getBiometricEvents(input ?? undefined);
    }),

  // ========================================================================
  // Admin: Gate Configuration
  // ========================================================================

  /**
   * Configure or update biometric hardware at a gate.
   */
  configureGate: adminProcedure
    .input(
      z.object({
        gateId: z.number().int().positive(),
        airportId: z.number().int().positive(),
        deviceType: z.string().min(1).max(100),
        status: z.enum(["online", "offline", "maintenance"]),
        firmwareVersion: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await biometricService.configureGate(input);
    }),
});
