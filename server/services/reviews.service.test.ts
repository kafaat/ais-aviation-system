import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  flightReviews,
  users,
  flights,
  bookings,
  airlines,
  airports,
} from "../../drizzle/schema";
import * as reviewsService from "./reviews.service";
import { eq } from "drizzle-orm";

describe("Reviews Service", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let testUserId: number;
  let testFlightId: number;
  let testBookingId: number;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test user
    const [userResult] = await db.insert(users).values({
      openId: `test-review-${Date.now()}`,
      name: "Test User",
      email: "test@reviews.com",
      loginMethod: "test",
      role: "user",
    });
    testUserId = userResult.insertId;

    // Create test airline
    const [airlineResult] = await db.insert(airlines).values({
      code: "TS",
      name: "Test Airlines",
      active: true,
    });

    // Create test airports
    const [originResult] = await db.insert(airports).values({
      code: "TST",
      name: "Test Origin",
      city: "Test City",
      country: "Test Country",
    });

    const [destResult] = await db.insert(airports).values({
      code: "TES",
      name: "Test Destination",
      city: "Test City 2",
      country: "Test Country 2",
    });

    // Create test flight
    const [flightResult] = await db.insert(flights).values({
      flightNumber: "TS123",
      airlineId: airlineResult.insertId,
      originId: originResult.insertId,
      destinationId: destResult.insertId,
      departureTime: new Date(Date.now() + 86400000),
      arrivalTime: new Date(Date.now() + 90000000),
      aircraftType: "Test Aircraft",
      economySeats: 150,
      businessSeats: 20,
      economyPrice: 50000,
      businessPrice: 100000,
      economyAvailable: 150,
      businessAvailable: 20,
    });
    testFlightId = flightResult.insertId;

    // Create test booking
    const [bookingResult] = await db.insert(bookings).values({
      userId: testUserId,
      flightId: testFlightId,
      bookingReference: "TSTREF",
      pnr: "TSTPNR",
      status: "completed",
      totalAmount: 50000,
      paymentStatus: "paid",
    });
    testBookingId = bookingResult.insertId;
  });

  afterAll(async () => {
    if (!db) return;
    // Cleanup
    await db.delete(flightReviews).where(eq(flightReviews.userId, testUserId));
    await db.delete(bookings).where(eq(bookings.userId, testUserId));
    await db.delete(flights).where(eq(flights.id, testFlightId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("should create a verified review with booking", async () => {
    const review = await reviewsService.createReview({
      userId: testUserId,
      flightId: testFlightId,
      bookingId: testBookingId,
      rating: 5,
      comfortRating: 5,
      serviceRating: 4,
      valueRating: 5,
      title: "Excellent flight!",
      comment: "Had a great experience.",
    });

    expect(review).toBeDefined();
    expect(review.rating).toBe(5);
    expect(review.isVerified).toBe(true);
  });

  it("should prevent duplicate reviews for same flight", async () => {
    await expect(
      reviewsService.createReview({
        userId: testUserId,
        flightId: testFlightId,
        rating: 4,
      })
    ).rejects.toThrow("already reviewed");
  });

  it("should get flight reviews", async () => {
    const reviews = await reviewsService.getFlightReviews(testFlightId);
    expect(reviews.length).toBeGreaterThan(0);
  });

  it("should get flight review statistics", async () => {
    const stats = await reviewsService.getFlightReviewStats(testFlightId);
    expect(stats.totalReviews).toBeGreaterThan(0);
    expect(stats.averageRating).toBeGreaterThan(0);
    expect(stats.ratingDistribution).toBeDefined();
  });

  it("should update a review", async () => {
    const reviews = await reviewsService.getUserReviews(testUserId);
    const reviewId = reviews[0].review.id;

    const result = await reviewsService.updateReview({
      reviewId,
      userId: testUserId,
      rating: 4,
      comment: "Updated comment",
    });

    expect(result.success).toBe(true);
  });

  it("should mark review as helpful", async () => {
    const reviews = await reviewsService.getUserReviews(testUserId);
    const reviewId = reviews[0].review.id;

    const result = await reviewsService.markReviewHelpful(reviewId);
    expect(result.success).toBe(true);
  });

  it("should get user reviews", async () => {
    const reviews = await reviewsService.getUserReviews(testUserId);
    expect(reviews.length).toBeGreaterThan(0);
  });

  it("should validate rating range", async () => {
    await expect(
      reviewsService.createReview({
        userId: testUserId,
        flightId: testFlightId + 1000, // Different flight
        rating: 6, // Invalid
      })
    ).rejects.toThrow("between 1 and 5");
  });
});
