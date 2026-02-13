import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  favoriteFlights,
  users,
  flights,
  airlines,
  airports,
} from "../../drizzle/schema";
import * as favoritesService from "./favorites.service";
import { eq } from "drizzle-orm";

describe.skipIf(!process.env.DATABASE_URL)("Favorites Service", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let testUserId: number;
  let testOriginId: number;
  let testDestinationId: number;
  let testAirlineId: number;
  let testFlightId: number;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test user
    const [userResult] = await db.insert(users).values({
      openId: `test-favorite-${Date.now()}`,
      name: "Test User",
      email: "test@favorites.com",
      loginMethod: "test",
      role: "user",
    });
    testUserId = userResult.insertId;

    // Create test airline
    const [airlineResult] = await db.insert(airlines).values({
      code: "FA",
      name: "Favorite Airlines",
      active: true,
    });
    testAirlineId = airlineResult.insertId;

    // Create test airports
    const [originResult] = await db.insert(airports).values({
      code: "FAO",
      name: "Favorite Origin",
      city: "Origin City",
      country: "Test Country",
    });
    testOriginId = originResult.insertId;

    const [destResult] = await db.insert(airports).values({
      code: "FAD",
      name: "Favorite Destination",
      city: "Dest City",
      country: "Test Country",
    });
    testDestinationId = destResult.insertId;

    // Create test flight with low price for price alert testing
    const [flightResult] = await db.insert(flights).values({
      flightNumber: "FA123",
      airlineId: testAirlineId,
      originId: testOriginId,
      destinationId: testDestinationId,
      departureTime: new Date(Date.now() + 86400000 * 7), // 7 days in future
      arrivalTime: new Date(Date.now() + 90000000),
      economySeats: 150,
      businessSeats: 20,
      economyPrice: 30000, // 300 SAR
      businessPrice: 60000, // 600 SAR
      economyAvailable: 150,
      businessAvailable: 20,
    });
    testFlightId = flightResult.insertId;
  });

  afterAll(async () => {
    if (!db) return;
    // Cleanup
    await db
      .delete(favoriteFlights)
      .where(eq(favoriteFlights.userId, testUserId));
    await db.delete(flights).where(eq(flights.id, testFlightId));
    await db.delete(airlines).where(eq(airlines.id, testAirlineId));
    await db.delete(airports).where(eq(airports.id, testOriginId));
    await db.delete(airports).where(eq(airports.id, testDestinationId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("should add a favorite flight route", async () => {
    const favorite = await favoritesService.addFavorite({
      userId: testUserId,
      originId: testOriginId,
      destinationId: testDestinationId,
      airlineId: testAirlineId,
      cabinClass: "economy",
      enablePriceAlert: true,
      maxPrice: 40000, // 400 SAR
      emailNotifications: true,
      notes: "My regular route",
    });

    expect(favorite).toBeDefined();
    expect(favorite.enablePriceAlert).toBe(true);
    expect(favorite.maxPrice).toBe(40000);
  });

  it("should prevent duplicate favorites", async () => {
    await expect(
      favoritesService.addFavorite({
        userId: testUserId,
        originId: testOriginId,
        destinationId: testDestinationId,
        airlineId: testAirlineId,
      })
    ).rejects.toThrow("already in your favorites");
  });

  it("should get user favorites with details", async () => {
    const favorites = await favoritesService.getUserFavorites(testUserId);
    expect(favorites.length).toBeGreaterThan(0);
    expect(favorites[0].origin).toBeDefined();
    expect(favorites[0].destination).toBeDefined();
    expect(favorites[0].airline).toBeDefined();
  });

  it("should check if route is favorited", async () => {
    const isFav = await favoritesService.isFavorited({
      userId: testUserId,
      originId: testOriginId,
      destinationId: testDestinationId,
      airlineId: testAirlineId,
    });
    expect(isFav).toBe(true);
  });

  it("should update favorite settings", async () => {
    const favorites = await favoritesService.getUserFavorites(testUserId);
    const favoriteId = favorites[0].favorite.id;

    const result = await favoritesService.updateFavorite({
      favoriteId,
      userId: testUserId,
      maxPrice: 35000,
      notes: "Updated notes",
    });

    expect(result.success).toBe(true);
  });

  it("should get best prices for favorite route", async () => {
    const favorites = await favoritesService.getUserFavorites(testUserId);
    const favoriteId = favorites[0].favorite.id;

    const prices = await favoritesService.getBestPricesForFavorite(
      favoriteId,
      testUserId
    );
    expect(prices).toBeDefined();
    expect(prices.lowestPrice).toBeLessThanOrEqual(40000);
    expect(prices.totalFlights).toBeGreaterThan(0);
  });

  it("should check price alerts", async () => {
    const result = await favoritesService.checkPriceAlertsAndNotify();
    expect(result).toBeDefined();
    expect(result.alertsFound).toBeGreaterThanOrEqual(0);
  });

  it("should get price alert history", async () => {
    const favorites = await favoritesService.getUserFavorites(testUserId);
    const favoriteId = favorites[0].favorite.id;

    const history = await favoritesService.getPriceAlertHistory(
      favoriteId,
      testUserId
    );
    expect(Array.isArray(history)).toBe(true);
  });

  it("should delete a favorite", async () => {
    // Create a temporary favorite to delete
    const tempFavorite = await favoritesService.addFavorite({
      userId: testUserId,
      originId: testOriginId,
      destinationId: testDestinationId,
      // No airlineId, different from main favorite
    });

    const result = await favoritesService.deleteFavorite(
      tempFavorite.id!,
      testUserId
    );
    expect(result.success).toBe(true);

    // Verify deletion
    const isFav = await favoritesService.isFavorited({
      userId: testUserId,
      originId: testOriginId,
      destinationId: testDestinationId,
    });
    expect(isFav).toBe(false);
  });

  // ============================================================================
  // Flight Favorites Tests (individual flights)
  // ============================================================================

  describe("Flight Favorites (individual flights)", () => {
    it("should add a specific flight to favorites", async () => {
      const favorite = await favoritesService.addFlightFavorite(
        testUserId,
        testFlightId
      );

      expect(favorite).toBeDefined();
      expect(favorite.flightId).toBe(testFlightId);
      expect(favorite.userId).toBe(testUserId);
    });

    it("should prevent duplicate flight favorites", async () => {
      await expect(
        favoritesService.addFlightFavorite(testUserId, testFlightId)
      ).rejects.toThrow("already in your favorites");
    });

    it("should check if a flight is favorited", async () => {
      const isFav = await favoritesService.isFlightFavorited(
        testUserId,
        testFlightId
      );
      expect(isFav).toBe(true);
    });

    it("should return false for non-favorited flight", async () => {
      const isFav = await favoritesService.isFlightFavorited(
        testUserId,
        999999
      );
      expect(isFav).toBe(false);
    });

    it("should get user flight favorites with details", async () => {
      const favorites =
        await favoritesService.getUserFlightFavorites(testUserId);
      expect(favorites.length).toBeGreaterThan(0);
      expect(favorites[0].flight).toBeDefined();
      expect(favorites[0].origin).toBeDefined();
      expect(favorites[0].destination).toBeDefined();
      expect(favorites[0].airline).toBeDefined();
    });

    it("should remove a flight from favorites", async () => {
      const result = await favoritesService.removeFlightFavorite(
        testUserId,
        testFlightId
      );
      expect(result.success).toBe(true);

      // Verify removal
      const isFav = await favoritesService.isFlightFavorited(
        testUserId,
        testFlightId
      );
      expect(isFav).toBe(false);
    });

    it("should throw error when removing non-existent favorite", async () => {
      await expect(
        favoritesService.removeFlightFavorite(testUserId, 999999)
      ).rejects.toThrow("not found");
    });
  });
});
