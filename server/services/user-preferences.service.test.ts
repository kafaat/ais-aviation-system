import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getUserPreferences,
  upsertUserPreferences,
  deleteUserPreferences,
  getSavedPassportInfo,
  updatePassportInfo,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "./user-preferences.service";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { userPreferences } from "../../drizzle/schema";

describe("User Preferences Service", () => {
  const testUserId = 999999; // Use a high ID to avoid conflicts

  beforeAll(async () => {
    // Cleanup any existing test data before starting
    const db = await getDb();
    if (db) {
      await db.delete(userPreferences).where(eq(userPreferences.userId, testUserId));
    }
  });

  afterAll(async () => {
    // Cleanup test data
    const db = await getDb();
    if (db) {
      await db.delete(userPreferences).where(eq(userPreferences.userId, testUserId));
    }
  });

  it("should return null for non-existent user preferences", async () => {
    const prefs = await getUserPreferences(testUserId);
    expect(prefs).toBeNull();
  });

  it("should create new user preferences", async () => {
    const result = await upsertUserPreferences(testUserId, {
      preferredSeatType: "window",
      preferredCabinClass: "economy",
      mealPreference: "vegetarian",
      wheelchairAssistance: false,
      extraLegroom: true,
    });

    expect(result).toBeDefined();
    expect(result.userId).toBe(testUserId);
    expect(result.preferredSeatType).toBe("window");
    expect(result.preferredCabinClass).toBe("economy");
    expect(result.mealPreference).toBe("vegetarian");
    expect(result.extraLegroom).toBe(true);
  });

  it("should retrieve existing user preferences", async () => {
    const prefs = await getUserPreferences(testUserId);
    
    expect(prefs).toBeDefined();
    expect(prefs?.userId).toBe(testUserId);
    expect(prefs?.preferredSeatType).toBe("window");
  });

  it("should update existing user preferences", async () => {
    const result = await upsertUserPreferences(testUserId, {
      preferredSeatType: "aisle",
      mealPreference: "vegan",
    });

    expect(result.preferredSeatType).toBe("aisle");
    expect(result.mealPreference).toBe("vegan");
    // Old values should be preserved
    expect(result.preferredCabinClass).toBe("economy");
  });

  it("should update passport information", async () => {
    const expiryDate = new Date("2030-12-31");
    
    await updatePassportInfo(testUserId, {
      passportNumber: "A12345678",
      passportExpiry: expiryDate,
      nationality: "Saudi Arabia",
    });

    const passportInfo = await getSavedPassportInfo(testUserId);
    
    expect(passportInfo).toBeDefined();
    expect(passportInfo?.passportNumber).toBe("A12345678");
    expect(passportInfo?.nationality).toBe("Saudi Arabia");
    expect(passportInfo?.passportExpiry).toBeInstanceOf(Date);
  });

  it("should get saved passport info", async () => {
    const passportInfo = await getSavedPassportInfo(testUserId);
    
    expect(passportInfo).toBeDefined();
    expect(passportInfo?.passportNumber).toBe("A12345678");
  });

  it("should get notification preferences with defaults", async () => {
    const notifPrefs = await getNotificationPreferences(testUserId);
    
    expect(notifPrefs).toBeDefined();
    expect(notifPrefs.emailNotifications).toBe(true); // Default
    expect(notifPrefs.smsNotifications).toBe(false); // Default
  });

  it("should update notification preferences", async () => {
    await updateNotificationPreferences(testUserId, {
      emailNotifications: false,
      smsNotifications: true,
    });

    const notifPrefs = await getNotificationPreferences(testUserId);
    
    expect(notifPrefs.emailNotifications).toBe(false);
    expect(notifPrefs.smsNotifications).toBe(true);
  });

  it("should delete user preferences", async () => {
    await deleteUserPreferences(testUserId);
    
    const prefs = await getUserPreferences(testUserId);
    expect(prefs).toBeNull();
  });

  it("should handle creating preferences after deletion", async () => {
    // After deletion, should be able to create new preferences
    const result = await upsertUserPreferences(testUserId, {
      preferredSeatType: "middle",
      preferredCabinClass: "business",
    });

    expect(result).toBeDefined();
    expect(result.preferredSeatType).toBe("middle");
    expect(result.preferredCabinClass).toBe("business");
  });
});
