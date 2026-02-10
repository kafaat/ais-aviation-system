/**
 * Biometric Boarding Service
 *
 * Handles biometric enrollment, identity verification, boarding token generation,
 * gate readiness checks, and audit logging for biometric boarding operations.
 *
 * Schema types are defined inline as this service manages its own domain tables:
 * - biometricEnrollments: Stores passenger biometric templates and consent records
 * - biometricEvents: Audit trail for all biometric operations
 * - biometricGates: Gate hardware status and configuration
 */

import { getDb } from "../db";
import { passengers, bookings } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";

// ============================================================================
// Inline Schema Types
// ============================================================================

export type BiometricType = "face" | "fingerprint" | "iris";

export type EnrollmentStatus = "active" | "expired" | "revoked";

export type BiometricEventType =
  | "enrollment"
  | "verification_success"
  | "verification_failure"
  | "boarding_complete";

export type GateStatus = "online" | "offline" | "maintenance";

export interface BiometricEnrollment {
  id: number;
  passengerId: number;
  userId: number;
  biometricType: BiometricType;
  templateHash: string;
  consentGiven: boolean;
  consentDate: Date | null;
  enrolledAt: Date;
  expiresAt: Date;
  status: EnrollmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface BiometricEvent {
  id: number;
  passengerId: number;
  flightId: number | null;
  gateId: number | null;
  eventType: BiometricEventType;
  biometricType: BiometricType;
  confidence: number | null;
  processingTimeMs: number | null;
  deviceId: string | null;
  createdAt: Date;
}

export interface BiometricGate {
  id: number;
  gateId: number;
  airportId: number;
  deviceType: string;
  status: GateStatus;
  lastCalibration: Date | null;
  firmwareVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

/** Default enrollment validity period: 1 year */
const ENROLLMENT_VALIDITY_DAYS = 365;

/** Boarding token validity: 30 minutes */
const BOARDING_TOKEN_VALIDITY_MINUTES = 30;

/** Minimum confidence threshold for biometric verification (0-100) */
const MIN_CONFIDENCE_THRESHOLD = 85;

// ============================================================================
// In-Memory Storage (replace with database tables in production)
// ============================================================================

const enrollments: BiometricEnrollment[] = [];
const events: BiometricEvent[] = [];
const gates: BiometricGate[] = [];
const boardingTokens: Map<
  string,
  { passengerId: number; flightId: number; expiresAt: Date }
> = new Map();

let nextEnrollmentId = 1;
let nextEventId = 1;
let nextGateId = 1;

// ============================================================================
// Enrollment Management
// ============================================================================

/**
 * Enroll a passenger's biometric template.
 * Requires explicit consent before storing any biometric data.
 */
export async function enrollPassenger(
  passengerId: number,
  biometricType: BiometricType,
  templateHash: string,
  userId: number,
  consentGiven: boolean
): Promise<BiometricEnrollment> {
  if (!consentGiven) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Biometric enrollment requires explicit consent. User must agree to biometric data collection and processing.",
    });
  }

  // Validate passenger exists
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [passenger] = await db
    .select()
    .from(passengers)
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found",
    });
  }

  // Check for existing active enrollment of the same type
  const existingEnrollment = enrollments.find(
    e =>
      e.passengerId === passengerId &&
      e.biometricType === biometricType &&
      e.status === "active"
  );

  if (existingEnrollment) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Passenger already has an active ${biometricType} enrollment. Revoke the existing enrollment before creating a new one.`,
    });
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + ENROLLMENT_VALIDITY_DAYS);

  const enrollment: BiometricEnrollment = {
    id: nextEnrollmentId++,
    passengerId,
    userId,
    biometricType,
    templateHash,
    consentGiven: true,
    consentDate: now,
    enrolledAt: now,
    expiresAt,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  enrollments.push(enrollment);

  // Log the enrollment event
  await logBiometricEvent(passengerId, "enrollment", null, {
    biometricType,
    confidence: 100,
    processingTimeMs: 0,
  });

  return enrollment;
}

/**
 * Verify a passenger's identity against their stored biometric template.
 * Returns a confidence score and match result.
 */
export async function verifyIdentity(
  passengerId: number,
  biometricType: BiometricType,
  templateHash: string,
  gateId?: number | null,
  deviceId?: string | null
): Promise<{
  verified: boolean;
  confidence: number;
  enrollmentId: number;
  processingTimeMs: number;
}> {
  const startTime = Date.now();

  const enrollment = enrollments.find(
    e =>
      e.passengerId === passengerId &&
      e.biometricType === biometricType &&
      e.status === "active"
  );

  if (!enrollment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No active ${biometricType} enrollment found for this passenger. Please enroll first.`,
    });
  }

  // Check enrollment expiry
  if (enrollment.expiresAt < new Date()) {
    // Mark as expired
    enrollment.status = "expired";
    enrollment.updatedAt = new Date();

    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Biometric enrollment has expired. Please re-enroll to continue using biometric boarding.",
    });
  }

  // Compare template hashes for verification
  // In production, this would use a biometric matching algorithm with a similarity score.
  // Here we simulate with hash comparison and a confidence score.
  const isMatch = enrollment.templateHash === templateHash;
  const confidence = isMatch
    ? 95 + Math.floor(Math.random() * 5) // 95-99% for matches
    : 10 + Math.floor(Math.random() * 30); // 10-39% for non-matches

  const processingTimeMs = Date.now() - startTime;
  const verified = isMatch && confidence >= MIN_CONFIDENCE_THRESHOLD;

  // Log verification event
  await logBiometricEvent(
    passengerId,
    verified ? "verification_success" : "verification_failure",
    gateId ?? null,
    {
      biometricType,
      confidence,
      processingTimeMs,
      deviceId: deviceId ?? undefined,
    }
  );

  return {
    verified,
    confidence,
    enrollmentId: enrollment.id,
    processingTimeMs,
  };
}

// ============================================================================
// Boarding Token Generation
// ============================================================================

/**
 * Generate a one-time boarding token for a passenger after biometric verification.
 * The token is valid for a limited time and can only be used once.
 */
export async function getBoardingToken(
  passengerId: number,
  flightId: number
): Promise<{
  token: string;
  expiresAt: Date;
  passengerId: number;
  flightId: number;
}> {
  // Verify passenger has an active enrollment
  const activeEnrollment = enrollments.find(
    e => e.passengerId === passengerId && e.status === "active"
  );

  if (!activeEnrollment) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No active biometric enrollment found. Please enroll before requesting a boarding token.",
    });
  }

  // Verify that the passenger has a confirmed booking for this flight
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [booking] = await db
    .select({
      bookingId: bookings.id,
      passengerId: passengers.id,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(passengers.id, passengerId),
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    )
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "No confirmed booking found for this passenger on the specified flight.",
    });
  }

  // Check recent successful verification (within last 10 minutes)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const recentVerification = events.find(
    e =>
      e.passengerId === passengerId &&
      e.eventType === "verification_success" &&
      e.createdAt >= tenMinutesAgo
  );

  if (!recentVerification) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Biometric verification required before boarding token can be issued. Please verify your identity first.",
    });
  }

  // Generate cryptographically secure one-time token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + BOARDING_TOKEN_VALIDITY_MINUTES * 60 * 1000
  );

  boardingTokens.set(token, {
    passengerId,
    flightId,
    expiresAt,
  });

  return {
    token,
    expiresAt,
    passengerId,
    flightId,
  };
}

// ============================================================================
// Enrollment Status & Revocation
// ============================================================================

/**
 * Get the enrollment status for a passenger across all biometric types.
 */
export async function getEnrollmentStatus(passengerId: number): Promise<{
  passengerId: number;
  enrollments: Array<{
    id: number;
    biometricType: BiometricType;
    status: EnrollmentStatus;
    enrolledAt: Date;
    expiresAt: Date;
  }>;
  hasActiveEnrollment: boolean;
}> {
  const passengerEnrollments = enrollments
    .filter(e => e.passengerId === passengerId)
    .map(e => ({
      id: e.id,
      biometricType: e.biometricType,
      status: e.status,
      enrolledAt: e.enrolledAt,
      expiresAt: e.expiresAt,
    }));

  const hasActiveEnrollment = passengerEnrollments.some(
    e => e.status === "active"
  );

  return {
    passengerId,
    enrollments: passengerEnrollments,
    hasActiveEnrollment,
  };
}

/**
 * Revoke a passenger's biometric enrollment and delete stored template data.
 * This implements the right to erasure for biometric data.
 */
export async function revokeEnrollment(
  passengerId: number,
  biometricType?: BiometricType
): Promise<{ revoked: number }> {
  let revokedCount = 0;

  for (const enrollment of enrollments) {
    if (enrollment.passengerId !== passengerId) continue;
    if (enrollment.status !== "active") continue;
    if (biometricType && enrollment.biometricType !== biometricType) continue;

    enrollment.status = "revoked";
    enrollment.templateHash = ""; // Clear template data
    enrollment.updatedAt = new Date();
    revokedCount++;
  }

  if (revokedCount === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No active enrollment found to revoke.",
    });
  }

  return { revoked: revokedCount };
}

// ============================================================================
// Statistics & Monitoring
// ============================================================================

/**
 * Get biometric boarding statistics for a specific flight.
 * Shows the breakdown of biometric vs. manual boarding.
 */
export async function getFlightBiometricStats(flightId: number): Promise<{
  flightId: number;
  totalPassengers: number;
  biometricVerified: number;
  biometricBoarded: number;
  manualBoarded: number;
  verificationFailures: number;
  averageProcessingTimeMs: number;
  biometricBoardingRate: number;
}> {
  // Get total passengers for the flight
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [paxCount] = await db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  const totalPassengers = Number(paxCount?.count ?? 0);

  // Aggregate biometric events for this flight
  const flightEvents = events.filter(e => e.flightId === flightId);

  const biometricVerified = flightEvents.filter(
    e => e.eventType === "verification_success"
  ).length;

  const biometricBoarded = flightEvents.filter(
    e => e.eventType === "boarding_complete"
  ).length;

  const verificationFailures = flightEvents.filter(
    e => e.eventType === "verification_failure"
  ).length;

  const manualBoarded = Math.max(0, totalPassengers - biometricBoarded);

  // Calculate average processing time from successful verifications
  const successfulVerifications = flightEvents.filter(
    e => e.eventType === "verification_success" && e.processingTimeMs !== null
  );

  const averageProcessingTimeMs =
    successfulVerifications.length > 0
      ? Math.round(
          successfulVerifications.reduce(
            (sum, e) => sum + (e.processingTimeMs ?? 0),
            0
          ) / successfulVerifications.length
        )
      : 0;

  const biometricBoardingRate =
    totalPassengers > 0
      ? Math.round((biometricBoarded / totalPassengers) * 100)
      : 0;

  return {
    flightId,
    totalPassengers,
    biometricVerified,
    biometricBoarded,
    manualBoarded,
    verificationFailures,
    averageProcessingTimeMs,
    biometricBoardingRate,
  };
}

/**
 * Check if a gate's biometric hardware is ready for operations.
 */
export async function getGateReadiness(gateId: number): Promise<{
  gateId: number;
  ready: boolean;
  status: GateStatus;
  deviceType: string | null;
  firmwareVersion: string | null;
  lastCalibration: Date | null;
  issues: string[];
}> {
  const gate = gates.find(g => g.gateId === gateId);

  if (!gate) {
    return {
      gateId,
      ready: false,
      status: "offline",
      deviceType: null,
      firmwareVersion: null,
      lastCalibration: null,
      issues: ["No biometric hardware configured for this gate"],
    };
  }

  const issues: string[] = [];

  if (gate.status !== "online") {
    issues.push(`Gate hardware is ${gate.status}`);
  }

  if (gate.lastCalibration) {
    const daysSinceCalibration = Math.floor(
      (Date.now() - gate.lastCalibration.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceCalibration > 30) {
      issues.push(
        `Calibration overdue: last calibrated ${daysSinceCalibration} days ago`
      );
    }
  } else {
    issues.push("Device has never been calibrated");
  }

  const ready = gate.status === "online" && issues.length === 0;

  return {
    gateId,
    ready,
    status: gate.status,
    deviceType: gate.deviceType,
    firmwareVersion: gate.firmwareVersion,
    lastCalibration: gate.lastCalibration,
    issues,
  };
}

// ============================================================================
// Gate Configuration
// ============================================================================

/**
 * Configure or update a biometric gate device.
 */
export async function configureGate(input: {
  gateId: number;
  airportId: number;
  deviceType: string;
  status: GateStatus;
  firmwareVersion?: string;
}): Promise<BiometricGate> {
  const now = new Date();

  const existingGate = gates.find(g => g.gateId === input.gateId);

  if (existingGate) {
    existingGate.airportId = input.airportId;
    existingGate.deviceType = input.deviceType;
    existingGate.status = input.status;
    existingGate.firmwareVersion =
      input.firmwareVersion ?? existingGate.firmwareVersion;
    existingGate.updatedAt = now;

    if (input.status === "online") {
      existingGate.lastCalibration = now;
    }

    return existingGate;
  }

  const gate: BiometricGate = {
    id: nextGateId++,
    gateId: input.gateId,
    airportId: input.airportId,
    deviceType: input.deviceType,
    status: input.status,
    lastCalibration: input.status === "online" ? now : null,
    firmwareVersion: input.firmwareVersion ?? null,
    createdAt: now,
    updatedAt: now,
  };

  gates.push(gate);
  return gate;
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log a biometric event for audit purposes.
 * All biometric operations must be logged for compliance and security.
 */
export async function logBiometricEvent(
  passengerId: number,
  eventType: BiometricEventType,
  gateId: number | null,
  options?: {
    flightId?: number;
    biometricType?: BiometricType;
    confidence?: number;
    processingTimeMs?: number;
    deviceId?: string;
  }
): Promise<BiometricEvent> {
  const event: BiometricEvent = {
    id: nextEventId++,
    passengerId,
    flightId: options?.flightId ?? null,
    gateId,
    eventType,
    biometricType: options?.biometricType ?? "face",
    confidence: options?.confidence ?? null,
    processingTimeMs: options?.processingTimeMs ?? null,
    deviceId: options?.deviceId ?? null,
    createdAt: new Date(),
  };

  events.push(event);
  return event;
}

/**
 * Get biometric events for audit trail with optional filters.
 */
export async function getBiometricEvents(filters?: {
  passengerId?: number;
  flightId?: number;
  gateId?: number;
  eventType?: BiometricEventType;
  limit?: number;
  offset?: number;
}): Promise<{
  events: BiometricEvent[];
  total: number;
}> {
  let filtered = [...events];

  if (filters?.passengerId) {
    filtered = filtered.filter(e => e.passengerId === filters.passengerId);
  }
  if (filters?.flightId) {
    filtered = filtered.filter(e => e.flightId === filters.flightId);
  }
  if (filters?.gateId) {
    filtered = filtered.filter(e => e.gateId === filters.gateId);
  }
  if (filters?.eventType) {
    filtered = filtered.filter(e => e.eventType === filters.eventType);
  }

  const total = filtered.length;

  // Sort by most recent first
  filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Apply pagination
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? 50;
  filtered = filtered.slice(offset, offset + limit);

  return { events: filtered, total };
}
