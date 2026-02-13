import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import {
  priceAlerts,
  users,
  flights,
  airlines,
  airports,
} from "../../drizzle/schema";
import * as priceAlertsService from "./price-alerts.service";
import { eq } from "drizzle-orm";

describe.skipIf(!process.env.DATABASE_URL)("Price Alerts Service", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let testUserId: number;
  let testOriginId: number;
  let testDestinationId: number;
  let testAirlineId: number;
  let testFlightId: number;
  let testAlertId: number;

  beforeAll(async () => {
    db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create test user
    const [userResult] = await db.insert(users).values({
      openId: `test-price-alert-${Date.now()}`,
      name: "Test User",
      email: "test@pricealerts.com",
      loginMethod: "test",
      role: "user",
    });
    testUserId = userResult.insertId;

    // Create test airline
    const [airlineResult] = await db.insert(airlines).values({
      code: "PA",
      name: "Price Alert Airlines",
      active: true,
    });
    testAirlineId = airlineResult.insertId;

    // Create test airports
    const [originResult] = await db.insert(airports).values({
      code: "PAO",
      name: "Price Alert Origin",
      city: "Origin City",
      country: "Test Country",
    });
    testOriginId = originResult.insertId;

    const [destResult] = await db.insert(airports).values({
      code: "PAD",
      name: "Price Alert Destination",
      city: "Dest City",
      country: "Test Country",
    });
    testDestinationId = destResult.insertId;

    // Create test flight with specific price
    const [flightResult] = await db.insert(flights).values({
      flightNumber: "PA456",
      airlineId: testAirlineId,
      originId: testOriginId,
      destinationId: testDestinationId,
      departureTime: new Date(Date.now() + 86400000 * 7), // 7 days in future
      arrivalTime: new Date(Date.now() + 90000000),
      economySeats: 150,
      businessSeats: 20,
      economyPrice: 25000, // 250 SAR
      businessPrice: 50000, // 500 SAR
      economyAvailable: 150,
      businessAvailable: 20,
    });
    testFlightId = flightResult.insertId;
  });

  afterAll(async () => {
    if (!db) return;
    // Cleanup
    await db.delete(priceAlerts).where(eq(priceAlerts.userId, testUserId));
    await db.delete(flights).where(eq(flights.id, testFlightId));
    await db.delete(airlines).where(eq(airlines.id, testAirlineId));
    await db.delete(airports).where(eq(airports.id, testOriginId));
    await db.delete(airports).where(eq(airports.id, testDestinationId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("should create a price alert", async () => {
    const alert = await priceAlertsService.createAlert({
      userId: testUserId,
      originId: testOriginId,
      destinationId: testDestinationId,
      targetPrice: 30000, // 300 SAR
      cabinClass: "economy",
    });

    expect(alert).toBeDefined();
    expect(alert.id).toBeDefined();
    expect(alert.targetPrice).toBe(30000);
    expect(alert.isActive).toBe(true);

    testAlertId = alert.id!;
  });

  it("should prevent duplicate alerts for same route", async () => {
    await expect(
      priceAlertsService.createAlert({
        userId: testUserId,
        originId: testOriginId,
        destinationId: testDestinationId,
        targetPrice: 40000,
        cabinClass: "economy",
      })
    ).rejects.toThrow("already have a price alert");
  });

  it("should get user alerts with airport details", async () => {
    const alerts = await priceAlertsService.getUserAlerts(testUserId);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].origin).toBeDefined();
    expect(alerts[0].origin.code).toBe("PAO");
    expect(alerts[0].destination).toBeDefined();
    expect(alerts[0].destination.code).toBe("PAD");
  });

  it("should get alert by ID", async () => {
    const alert = await priceAlertsService.getAlertById(
      testAlertId,
      testUserId
    );
    expect(alert).toBeDefined();
    expect(alert.alert.id).toBe(testAlertId);
    expect(alert.alert.targetPrice).toBe(30000);
  });

  it("should update alert target price", async () => {
    const result = await priceAlertsService.updateAlertPrice(
      testAlertId,
      testUserId,
      35000 // 350 SAR
    );

    expect(result.success).toBe(true);

    // Verify the update
    const alert = await priceAlertsService.getAlertById(
      testAlertId,
      testUserId
    );
    expect(alert.alert.targetPrice).toBe(35000);
  });

  it("should toggle alert active status", async () => {
    const result = await priceAlertsService.toggleAlert(
      testAlertId,
      testUserId
    );

    expect(result.success).toBe(true);
    expect(result.isActive).toBe(false);

    // Toggle back
    const result2 = await priceAlertsService.toggleAlert(
      testAlertId,
      testUserId
    );
    expect(result2.isActive).toBe(true);
  });

  it("should check alerts and update prices", async () => {
    const result = await priceAlertsService.checkAlerts();
    expect(result).toBeDefined();
    expect(result.totalChecked).toBeGreaterThanOrEqual(0);
  });

  it("should not allow access to another user's alert", async () => {
    await expect(
      priceAlertsService.getAlertById(testAlertId, 999999)
    ).rejects.toThrow("not found");
  });

  it("should delete a price alert", async () => {
    // Create a temporary alert to delete
    const tempAlert = await priceAlertsService.createAlert({
      userId: testUserId,
      originId: testOriginId,
      destinationId: testDestinationId,
      targetPrice: 20000,
      cabinClass: "business", // Different cabin class to avoid duplicate
    });

    const result = await priceAlertsService.deleteAlert(
      tempAlert.id!,
      testUserId
    );
    expect(result.success).toBe(true);

    // Verify deletion
    await expect(
      priceAlertsService.getAlertById(tempAlert.id!, testUserId)
    ).rejects.toThrow("not found");
  });
});
