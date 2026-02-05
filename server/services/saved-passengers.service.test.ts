import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getUserPassengers,
  getPassenger,
  getDefaultPassenger,
  addPassenger,
  updatePassenger,
  deletePassenger,
  setDefaultPassenger,
} from "./saved-passengers.service";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { savedPassengers } from "../../drizzle/schema";

describe("Saved Passengers Service", () => {
  const testUserId = 888888; // Use a high ID to avoid conflicts

  beforeAll(async () => {
    // Cleanup any existing test data before starting
    const db = await getDb();
    if (db) {
      await db
        .delete(savedPassengers)
        .where(eq(savedPassengers.userId, testUserId));
    }
  });

  afterAll(async () => {
    // Cleanup test data
    const db = await getDb();
    if (db) {
      await db
        .delete(savedPassengers)
        .where(eq(savedPassengers.userId, testUserId));
    }
  });

  it("should return empty array for user with no saved passengers", async () => {
    const passengers = await getUserPassengers(testUserId);
    expect(passengers).toEqual([]);
  });

  it("should return null when getting non-existent passenger", async () => {
    const passenger = await getPassenger(999999, testUserId);
    expect(passenger).toBeNull();
  });

  it("should return null for user with no default passenger", async () => {
    const defaultPassenger = await getDefaultPassenger(testUserId);
    expect(defaultPassenger).toBeNull();
  });

  it("should add a new passenger and set as default when first passenger", async () => {
    const newPassenger = await addPassenger(testUserId, {
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: new Date("1990-01-15"),
      nationality: "Saudi Arabia",
      passportNumber: "A12345678",
      passportExpiry: new Date("2030-12-31"),
      email: "john.doe@example.com",
      phone: "+966501234567",
      isDefault: false,
    });

    expect(newPassenger).toBeDefined();
    expect(newPassenger.userId).toBe(testUserId);
    expect(newPassenger.firstName).toBe("John");
    expect(newPassenger.lastName).toBe("Doe");
    expect(newPassenger.nationality).toBe("Saudi Arabia");
    expect(newPassenger.passportNumber).toBe("A12345678");
    expect(newPassenger.email).toBe("john.doe@example.com");
    expect(newPassenger.isDefault).toBe(true); // Should be default (first passenger)
  });

  it("should retrieve saved passenger by ID", async () => {
    const passengers = await getUserPassengers(testUserId);
    expect(passengers.length).toBeGreaterThan(0);

    const passengerId = passengers[0].id;
    const passenger = await getPassenger(passengerId, testUserId);

    expect(passenger).toBeDefined();
    expect(passenger?.firstName).toBe("John");
    expect(passenger?.lastName).toBe("Doe");
  });

  it("should get default passenger", async () => {
    const defaultPassenger = await getDefaultPassenger(testUserId);

    expect(defaultPassenger).toBeDefined();
    expect(defaultPassenger?.firstName).toBe("John");
    expect(defaultPassenger?.isDefault).toBe(true);
  });

  it("should add another passenger", async () => {
    const secondPassenger = await addPassenger(testUserId, {
      firstName: "Jane",
      lastName: "Smith",
      nationality: "USA",
      passportNumber: "B87654321",
      isDefault: false,
    });

    expect(secondPassenger).toBeDefined();
    expect(secondPassenger.firstName).toBe("Jane");
    expect(secondPassenger.lastName).toBe("Smith");
    expect(secondPassenger.isDefault).toBe(false); // Not default (second passenger)
  });

  it("should get all passengers for user", async () => {
    const passengers = await getUserPassengers(testUserId);

    expect(passengers.length).toBe(2);
    const names = passengers.map(p => `${p.firstName} ${p.lastName}`);
    expect(names).toContain("John Doe");
    expect(names).toContain("Jane Smith");
  });

  it("should update a passenger", async () => {
    const passengers = await getUserPassengers(testUserId);
    const janePassenger = passengers.find(p => p.firstName === "Jane");
    expect(janePassenger).toBeDefined();

    const updated = await updatePassenger(janePassenger!.id, testUserId, {
      firstName: "Janet",
      email: "janet.smith@example.com",
    });

    expect(updated.firstName).toBe("Janet");
    expect(updated.email).toBe("janet.smith@example.com");
    expect(updated.lastName).toBe("Smith"); // Should preserve old value
  });

  it("should set a new default passenger", async () => {
    const passengers = await getUserPassengers(testUserId);
    const janetPassenger = passengers.find(p => p.firstName === "Janet");
    expect(janetPassenger).toBeDefined();

    await setDefaultPassenger(janetPassenger!.id, testUserId);

    const defaultPassenger = await getDefaultPassenger(testUserId);
    expect(defaultPassenger?.firstName).toBe("Janet");
    expect(defaultPassenger?.isDefault).toBe(true);

    // Verify old default is no longer default
    const johnPassenger = await getPassenger(
      passengers.find(p => p.firstName === "John")!.id,
      testUserId
    );
    expect(johnPassenger?.isDefault).toBe(false);
  });

  it("should throw error when updating non-existent passenger", async () => {
    await expect(
      updatePassenger(999999, testUserId, { firstName: "Test" })
    ).rejects.toThrow("Passenger not found");
  });

  it("should throw error when setting default for non-existent passenger", async () => {
    await expect(setDefaultPassenger(999999, testUserId)).rejects.toThrow(
      "Passenger not found"
    );
  });

  it("should delete a passenger", async () => {
    const passengers = await getUserPassengers(testUserId);
    const johnPassenger = passengers.find(p => p.firstName === "John");
    expect(johnPassenger).toBeDefined();

    await deletePassenger(johnPassenger!.id, testUserId);

    const remaining = await getUserPassengers(testUserId);
    expect(remaining.length).toBe(1);
    expect(remaining[0].firstName).toBe("Janet");
  });

  it("should throw error when deleting non-existent passenger", async () => {
    await expect(deletePassenger(999999, testUserId)).rejects.toThrow(
      "Passenger not found"
    );
  });

  it("should not allow access to passengers from other users", async () => {
    const passengers = await getUserPassengers(testUserId);
    const passengerId = passengers[0].id;

    // Try to get passenger with wrong user ID
    const passenger = await getPassenger(passengerId, 999999);
    expect(passenger).toBeNull();

    // Try to update passenger with wrong user ID
    await expect(
      updatePassenger(passengerId, 999999, { firstName: "Hacker" })
    ).rejects.toThrow("Passenger not found");

    // Try to delete passenger with wrong user ID
    await expect(deletePassenger(passengerId, 999999)).rejects.toThrow(
      "Passenger not found"
    );
  });

  it("should set new default when deleting current default passenger", async () => {
    // Add another passenger first
    const newPassenger = await addPassenger(testUserId, {
      firstName: "Bob",
      lastName: "Wilson",
      isDefault: false,
    });

    // Now delete Janet (current default)
    const passengers = await getUserPassengers(testUserId);
    const janetPassenger = passengers.find(p => p.firstName === "Janet");
    expect(janetPassenger?.isDefault).toBe(true);

    await deletePassenger(janetPassenger!.id, testUserId);

    // Bob should now be default
    const remaining = await getUserPassengers(testUserId);
    expect(remaining.length).toBe(1);
    expect(remaining[0].firstName).toBe("Bob");
    expect(remaining[0].isDefault).toBe(true);
  });

  it("should add passenger with isDefault flag overriding previous default", async () => {
    // Add a new passenger with isDefault: true
    const newDefault = await addPassenger(testUserId, {
      firstName: "Alice",
      lastName: "Johnson",
      isDefault: true,
    });

    expect(newDefault.isDefault).toBe(true);

    // Bob should no longer be default
    const bob = (await getUserPassengers(testUserId)).find(
      p => p.firstName === "Bob"
    );
    expect(bob?.isDefault).toBe(false);
  });
});
