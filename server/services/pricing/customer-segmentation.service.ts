/**
 * Customer Segmentation Service
 *
 * Segments customers based on behavior patterns for personalized pricing:
 * - Booking frequency and recency (RFM analysis)
 * - Price sensitivity detection
 * - Travel pattern analysis
 * - Loyalty tier integration
 * - Corporate vs leisure classification
 *
 * @module services/pricing/customer-segmentation.service
 */

import { getDb } from "../../db";
import {
  bookings,
  users,
  customerSegments,
  customerSegmentAssignments,
  flights,
} from "../../../drizzle/schema";
import { eq, and, count, desc } from "drizzle-orm";
import { cacheService } from "../cache.service";

// ============================================================================
// Types
// ============================================================================

export interface CustomerProfile {
  userId: number;
  segments: SegmentAssignment[];
  metrics: CustomerMetrics;
  pricingAdjustment: number; // Final multiplier for this customer
}

export interface SegmentAssignment {
  segmentId: number;
  segmentName: string;
  segmentType: string;
  score: number;
  priceMultiplier: number;
}

export interface CustomerMetrics {
  // Recency
  daysSinceLastBooking: number;
  lastBookingDate: Date | null;

  // Frequency
  totalBookings: number;
  bookingsLast90Days: number;
  bookingsLast365Days: number;
  avgBookingsPerMonth: number;

  // Monetary
  totalSpending: number; // SAR cents
  avgBookingValue: number;
  maxBookingValue: number;

  // Behavior
  avgLeadTimeDays: number; // How far in advance they book
  preferredCabinClass: "economy" | "business" | "mixed";
  cancellationRate: number;
  ancillaryPurchaseRate: number;

  // Price sensitivity
  priceSensitivityScore: number; // 0 (insensitive) to 1 (very sensitive)
  avgPriceLevel: number; // average of prices paid vs base prices
}

export interface RFMScores {
  recency: number; // 1-5
  frequency: number; // 1-5
  monetary: number; // 1-5
  totalScore: number; // 3-15
}

// ============================================================================
// Constants
// ============================================================================

const PROFILE_CACHE_TTL = 30 * 60; // 30 minutes

// RFM thresholds
const RECENCY_THRESHOLDS = [7, 30, 90, 180]; // days
const FREQUENCY_THRESHOLDS = [1, 3, 6, 12]; // bookings per year
const MONETARY_THRESHOLDS = [50000, 150000, 400000, 1000000]; // SAR cents

// ============================================================================
// Main Service
// ============================================================================

/**
 * Get customer profile with segment assignments and pricing adjustment
 */
export async function getCustomerProfile(
  userId: number
): Promise<CustomerProfile> {
  const cacheKey = `customer_profile:${userId}`;
  const cached = await cacheService.get<CustomerProfile>(cacheKey);
  if (cached) return cached;

  const metrics = await calculateCustomerMetrics(userId);
  const rfm = calculateRFMScores(metrics);
  const segments = await assignSegments(userId, metrics, rfm);
  const pricingAdjustment = calculatePricingAdjustment(segments, metrics);

  const profile: CustomerProfile = {
    userId,
    segments,
    metrics,
    pricingAdjustment,
  };

  await cacheService.set(cacheKey, profile, PROFILE_CACHE_TTL);
  return profile;
}

/**
 * Get pricing multiplier for a specific user
 */
export async function getUserPricingMultiplier(
  userId: number
): Promise<number> {
  const profile = await getCustomerProfile(userId);
  return profile.pricingAdjustment;
}

/**
 * Run segmentation for all active users
 */
export async function runBulkSegmentation(): Promise<{
  processed: number;
  segmented: number;
  errors: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const activeUsers = await db.select({ id: users.id }).from(users);

  let processed = 0;
  let segmented = 0;
  let errors = 0;

  for (const user of activeUsers) {
    try {
      const profile = await getCustomerProfile(user.id);
      if (profile.segments.length > 0) {
        segmented++;
      }
      processed++;
    } catch {
      errors++;
    }
  }

  return { processed, segmented, errors };
}

/**
 * Create or update a customer segment definition
 */
export async function upsertSegment(data: {
  id?: number;
  name: string;
  nameAr?: string;
  description?: string;
  segmentType: string;
  criteria: Record<string, unknown>;
  priceMultiplier: number;
  maxDiscount: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (data.id) {
    await db
      .update(customerSegments)
      .set({
        name: data.name,
        nameAr: data.nameAr,
        description: data.description,
        criteria: JSON.stringify(data.criteria),
        priceMultiplier: data.priceMultiplier.toString(),
        maxDiscount: data.maxDiscount.toString(),
      })
      .where(eq(customerSegments.id, data.id));
    return data.id;
  }

  const [result] = await db.insert(customerSegments).values({
    name: data.name,
    nameAr: data.nameAr,
    description: data.description,
    segmentType: data.segmentType as
      | "value"
      | "frequency"
      | "behavior"
      | "loyalty_tier"
      | "corporate"
      | "price_sensitive"
      | "premium",
    criteria: JSON.stringify(data.criteria),
    priceMultiplier: data.priceMultiplier.toString(),
    maxDiscount: data.maxDiscount.toString(),
  });

  return result.insertId;
}

/**
 * Get all segment definitions
 */
export async function getSegments(): Promise<
  (typeof customerSegments.$inferSelect)[]
> {
  const db = await getDb();
  if (!db) return [];

  return (
    (await db.query.customerSegments?.findMany({
      where: eq(customerSegments.isActive, true),
      orderBy: [desc(customerSegments.memberCount)],
    })) || []
  );
}

// ============================================================================
// Customer Metrics Calculation
// ============================================================================

async function calculateCustomerMetrics(
  userId: number
): Promise<CustomerMetrics> {
  const db = await getDb();
  if (!db) {
    return getDefaultMetrics();
  }

  const now = new Date();
  const days90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const days365Ago = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  // Get all user bookings
  const userBookings = await db
    .select({
      id: bookings.id,
      totalAmount: bookings.totalAmount,
      cabinClass: bookings.cabinClass,
      status: bookings.status,
      createdAt: bookings.createdAt,
      departureTime: flights.departureTime,
    })
    .from(bookings)
    .leftJoin(flights, eq(flights.id, bookings.flightId))
    .where(eq(bookings.userId, userId))
    .orderBy(desc(bookings.createdAt));

  if (userBookings.length === 0) {
    return getDefaultMetrics();
  }

  // Recency
  const lastBooking = userBookings[0];
  const daysSinceLastBooking = Math.floor(
    (now.getTime() - lastBooking.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Frequency
  const totalBookings = userBookings.length;
  const bookingsLast90Days = userBookings.filter(
    b => b.createdAt >= days90Ago
  ).length;
  const bookingsLast365Days = userBookings.filter(
    b => b.createdAt >= days365Ago
  ).length;

  const oldestBooking = userBookings[userBookings.length - 1];
  const monthsActive = Math.max(
    1,
    Math.floor(
      (now.getTime() - oldestBooking.createdAt.getTime()) /
        (1000 * 60 * 60 * 24 * 30)
    )
  );
  const avgBookingsPerMonth = totalBookings / monthsActive;

  // Monetary
  const confirmedBookings = userBookings.filter(b => b.status !== "cancelled");
  const totalSpending = confirmedBookings.reduce(
    (sum, b) => sum + (b.totalAmount || 0),
    0
  );
  const avgBookingValue =
    confirmedBookings.length > 0 ? totalSpending / confirmedBookings.length : 0;
  const maxBookingValue = Math.max(
    ...confirmedBookings.map(b => b.totalAmount || 0),
    0
  );

  // Behavior
  const leadTimes = userBookings
    .filter(b => b.departureTime)
    .map(b => {
      const dep = b.departureTime as Date;
      return Math.floor(
        (dep.getTime() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );
    });
  const avgLeadTimeDays =
    leadTimes.length > 0
      ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
      : 14;

  const economyCount = userBookings.filter(
    b => b.cabinClass === "economy"
  ).length;
  const businessCount = userBookings.filter(
    b => b.cabinClass === "business"
  ).length;
  const preferredCabinClass =
    businessCount > economyCount
      ? "business"
      : economyCount > businessCount
        ? "economy"
        : ("mixed" as const);

  const cancelledCount = userBookings.filter(
    b => b.status === "cancelled"
  ).length;
  const cancellationRate =
    totalBookings > 0 ? cancelledCount / totalBookings : 0;

  // Price sensitivity (based on booking at different price levels)
  const priceSensitivityScore = calculatePriceSensitivity(userBookings);

  const avgPriceLevel =
    avgBookingValue > 0
      ? avgBookingValue / (confirmedBookings.length > 0 ? avgBookingValue : 1)
      : 1;

  return {
    daysSinceLastBooking,
    lastBookingDate: lastBooking.createdAt,
    totalBookings,
    bookingsLast90Days,
    bookingsLast365Days,
    avgBookingsPerMonth,
    totalSpending,
    avgBookingValue,
    maxBookingValue,
    avgLeadTimeDays,
    preferredCabinClass,
    cancellationRate,
    ancillaryPurchaseRate: 0, // Would need ancillary data
    priceSensitivityScore,
    avgPriceLevel,
  };
}

function getDefaultMetrics(): CustomerMetrics {
  return {
    daysSinceLastBooking: 999,
    lastBookingDate: null,
    totalBookings: 0,
    bookingsLast90Days: 0,
    bookingsLast365Days: 0,
    avgBookingsPerMonth: 0,
    totalSpending: 0,
    avgBookingValue: 0,
    maxBookingValue: 0,
    avgLeadTimeDays: 14,
    preferredCabinClass: "economy",
    cancellationRate: 0,
    ancillaryPurchaseRate: 0,
    priceSensitivityScore: 0.5,
    avgPriceLevel: 1,
  };
}

// ============================================================================
// RFM Analysis
// ============================================================================

function calculateRFMScores(metrics: CustomerMetrics): RFMScores {
  // Recency score (1-5, 5 = most recent)
  const recency =
    metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[0]
      ? 5
      : metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[1]
        ? 4
        : metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[2]
          ? 3
          : metrics.daysSinceLastBooking <= RECENCY_THRESHOLDS[3]
            ? 2
            : 1;

  // Frequency score (1-5, 5 = most frequent)
  const annualBookings = metrics.bookingsLast365Days;
  const frequency =
    annualBookings >= FREQUENCY_THRESHOLDS[3]
      ? 5
      : annualBookings >= FREQUENCY_THRESHOLDS[2]
        ? 4
        : annualBookings >= FREQUENCY_THRESHOLDS[1]
          ? 3
          : annualBookings >= FREQUENCY_THRESHOLDS[0]
            ? 2
            : 1;

  // Monetary score (1-5, 5 = highest spending)
  const monetary =
    metrics.totalSpending >= MONETARY_THRESHOLDS[3]
      ? 5
      : metrics.totalSpending >= MONETARY_THRESHOLDS[2]
        ? 4
        : metrics.totalSpending >= MONETARY_THRESHOLDS[1]
          ? 3
          : metrics.totalSpending >= MONETARY_THRESHOLDS[0]
            ? 2
            : 1;

  return {
    recency,
    frequency,
    monetary,
    totalScore: recency + frequency + monetary,
  };
}

// ============================================================================
// Segment Assignment
// ============================================================================

async function assignSegments(
  userId: number,
  metrics: CustomerMetrics,
  rfm: RFMScores
): Promise<SegmentAssignment[]> {
  const db = await getDb();
  if (!db) return [];

  // Get all active segments
  const segments =
    (await db.query.customerSegments?.findMany({
      where: eq(customerSegments.isActive, true),
    })) || [];

  // If no segments defined, use default auto-segments
  if (segments.length === 0) {
    return autoAssignSegments(metrics, rfm);
  }

  const assignments: SegmentAssignment[] = [];

  for (const segment of segments) {
    const criteria = JSON.parse(segment.criteria);
    const score = evaluateSegmentCriteria(criteria, metrics, rfm);

    if (score > 0) {
      assignments.push({
        segmentId: segment.id,
        segmentName: segment.name,
        segmentType: segment.segmentType,
        score,
        priceMultiplier: parseFloat(segment.priceMultiplier || "1"),
      });

      // Persist assignment
      try {
        await db
          .insert(customerSegmentAssignments)
          .values({
            userId,
            segmentId: segment.id,
            score: score.toString(),
            behaviorSnapshot: JSON.stringify({
              rfm,
              totalBookings: metrics.totalBookings,
              totalSpending: metrics.totalSpending,
              priceSensitivity: metrics.priceSensitivityScore,
            }),
            isActive: true,
          })
          .onDuplicateKeyUpdate({
            set: {
              score: score.toString(),
              behaviorSnapshot: JSON.stringify({
                rfm,
                totalBookings: metrics.totalBookings,
                totalSpending: metrics.totalSpending,
                priceSensitivity: metrics.priceSensitivityScore,
              }),
              assignedAt: new Date(),
              isActive: true,
            },
          });
      } catch {
        // Ignore duplicate key errors
      }
    }
  }

  // Update member counts
  for (const segment of segments) {
    try {
      const [countResult] = await db
        .select({ cnt: count() })
        .from(customerSegmentAssignments)
        .where(
          and(
            eq(customerSegmentAssignments.segmentId, segment.id),
            eq(customerSegmentAssignments.isActive, true)
          )
        );
      await db
        .update(customerSegments)
        .set({ memberCount: countResult?.cnt || 0 })
        .where(eq(customerSegments.id, segment.id));
    } catch {
      // Non-critical
    }
  }

  return assignments.sort((a, b) => b.score - a.score);
}

/**
 * Auto-assign segments based on RFM scores when no segments are defined
 */
function autoAssignSegments(
  metrics: CustomerMetrics,
  rfm: RFMScores
): SegmentAssignment[] {
  const assignments: SegmentAssignment[] = [];

  // Premium travelers (high RFM)
  if (rfm.totalScore >= 12) {
    assignments.push({
      segmentId: 0,
      segmentName: "Premium Traveler",
      segmentType: "premium",
      score: rfm.totalScore / 15,
      priceMultiplier: 1.0, // No discount needed, they value service
    });
  }

  // Frequent flyers (high frequency)
  if (rfm.frequency >= 4) {
    assignments.push({
      segmentId: 0,
      segmentName: "Frequent Flyer",
      segmentType: "frequency",
      score: rfm.frequency / 5,
      priceMultiplier: 0.95, // Small loyalty discount
    });
  }

  // Price-sensitive (low monetary, high frequency)
  if (metrics.priceSensitivityScore > 0.7) {
    assignments.push({
      segmentId: 0,
      segmentName: "Price Sensitive",
      segmentType: "price_sensitive",
      score: metrics.priceSensitivityScore,
      priceMultiplier: 0.92, // Bigger discount to retain
    });
  }

  // High-value (high monetary)
  if (rfm.monetary >= 4) {
    assignments.push({
      segmentId: 0,
      segmentName: "High Value",
      segmentType: "value",
      score: rfm.monetary / 5,
      priceMultiplier: 0.97, // Slight discount
    });
  }

  // Business traveler (short lead time, high value)
  if (metrics.avgLeadTimeDays < 7 && metrics.avgBookingValue > 200000) {
    assignments.push({
      segmentId: 0,
      segmentName: "Business Traveler",
      segmentType: "corporate",
      score: 0.8,
      priceMultiplier: 1.05, // Willing to pay more
    });
  }

  // Lapsed customer (low recency)
  if (rfm.recency <= 2 && rfm.frequency >= 3) {
    assignments.push({
      segmentId: 0,
      segmentName: "Lapsed Customer",
      segmentType: "behavior",
      score: 0.6,
      priceMultiplier: 0.88, // Win-back discount
    });
  }

  return assignments;
}

function evaluateSegmentCriteria(
  criteria: Record<string, unknown>,
  metrics: CustomerMetrics,
  rfm: RFMScores
): number {
  let matchScore = 0;
  let totalCriteria = 0;

  // RFM thresholds
  if (criteria.minRfmScore !== undefined) {
    totalCriteria++;
    if (rfm.totalScore >= (criteria.minRfmScore as number)) matchScore++;
  }
  if (criteria.maxRfmScore !== undefined) {
    totalCriteria++;
    if (rfm.totalScore <= (criteria.maxRfmScore as number)) matchScore++;
  }

  // Frequency
  if (criteria.minBookings !== undefined) {
    totalCriteria++;
    if (metrics.totalBookings >= (criteria.minBookings as number)) matchScore++;
  }

  // Spending
  if (criteria.minSpending !== undefined) {
    totalCriteria++;
    if (metrics.totalSpending >= (criteria.minSpending as number)) matchScore++;
  }

  // Recency
  if (criteria.maxDaysSinceBooking !== undefined) {
    totalCriteria++;
    if (
      metrics.daysSinceLastBooking <= (criteria.maxDaysSinceBooking as number)
    )
      matchScore++;
  }

  // Price sensitivity
  if (criteria.minPriceSensitivity !== undefined) {
    totalCriteria++;
    if (
      metrics.priceSensitivityScore >= (criteria.minPriceSensitivity as number)
    )
      matchScore++;
  }
  if (criteria.maxPriceSensitivity !== undefined) {
    totalCriteria++;
    if (
      metrics.priceSensitivityScore <= (criteria.maxPriceSensitivity as number)
    )
      matchScore++;
  }

  // Cabin class preference
  if (criteria.preferredCabinClass !== undefined) {
    totalCriteria++;
    if (metrics.preferredCabinClass === criteria.preferredCabinClass)
      matchScore++;
  }

  // Lead time
  if (criteria.maxLeadTimeDays !== undefined) {
    totalCriteria++;
    if (metrics.avgLeadTimeDays <= (criteria.maxLeadTimeDays as number))
      matchScore++;
  }

  // Cancellation rate
  if (criteria.maxCancellationRate !== undefined) {
    totalCriteria++;
    if (metrics.cancellationRate <= (criteria.maxCancellationRate as number))
      matchScore++;
  }

  return totalCriteria > 0 ? matchScore / totalCriteria : 0;
}

// ============================================================================
// Price Sensitivity Calculation
// ============================================================================

function calculatePriceSensitivity(
  userBookings: {
    totalAmount: number | null;
    status: string | null;
    createdAt: Date;
    departureTime: Date | null;
  }[]
): number {
  if (userBookings.length < 2) return 0.5; // Unknown, assume neutral

  const confirmedBookings = userBookings.filter(
    b => b.status !== "cancelled" && b.totalAmount
  );

  if (confirmedBookings.length < 2) return 0.5;

  // Check variance in booking values (high variance = price sensitive)
  const amounts = confirmedBookings.map(b => b.totalAmount!);
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / amounts.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0; // Coefficient of variation

  // Check lead time patterns (longer lead = more price sensitive)
  const leadTimes = confirmedBookings
    .filter(b => b.departureTime)
    .map(b => {
      const dep = b.departureTime as Date;
      return (dep.getTime() - b.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    });
  const avgLeadTime =
    leadTimes.length > 0
      ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
      : 14;

  // Higher lead time + higher variance = more price sensitive
  const leadTimeFactor = Math.min(avgLeadTime / 60, 1); // Normalize to 0-1
  const varianceFactor = Math.min(cv, 1);

  return Math.min(1, leadTimeFactor * 0.4 + varianceFactor * 0.6);
}

// ============================================================================
// Pricing Adjustment
// ============================================================================

function calculatePricingAdjustment(
  segments: SegmentAssignment[],
  _metrics: CustomerMetrics
): number {
  if (segments.length === 0) return 1.0;

  // Weighted average of segment multipliers, weighted by score
  let totalWeight = 0;
  let weightedMultiplier = 0;

  for (const seg of segments) {
    weightedMultiplier += seg.priceMultiplier * seg.score;
    totalWeight += seg.score;
  }

  const baseMultiplier =
    totalWeight > 0 ? weightedMultiplier / totalWeight : 1.0;

  // Apply bounds: never more than 15% discount or 10% increase from segmentation
  return Math.min(1.1, Math.max(0.85, baseMultiplier));
}

// ============================================================================
// Exports
// ============================================================================

export const CustomerSegmentationService = {
  getCustomerProfile,
  getUserPricingMultiplier,
  runBulkSegmentation,
  upsertSegment,
  getSegments,
};

export default CustomerSegmentationService;
