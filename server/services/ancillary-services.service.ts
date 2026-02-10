import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  ancillaryServices,
  bookingAncillaries,
  type InsertAncillaryService,
  type InsertBookingAncillary,
} from "../../drizzle/schema";

/**
 * Ancillary Services Service
 * Manages add-on services (baggage, meals, seats, insurance)
 */

/**
 * Get all available ancillary services
 */
export async function getAvailableAncillaries(category?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [eq(ancillaryServices.available, true)];
  if (category) {
    conditions.push(eq(ancillaryServices.category, category as any));
  }

  return await db
    .select()
    .from(ancillaryServices)
    .where(and(...conditions));
}

/**
 * Get ancillary service by ID
 */
export async function getAncillaryById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const results = await db
    .select()
    .from(ancillaryServices)
    .where(eq(ancillaryServices.id, id))
    .limit(1);

  return results[0] || null;
}

/**
 * Create new ancillary service (admin only)
 */
export async function createAncillaryService(data: InsertAncillaryService) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(ancillaryServices).values(data);
  return Number((result as any).insertId);
}

/**
 * Update ancillary service (admin only)
 */
export async function updateAncillaryService(
  id: number,
  data: Partial<InsertAncillaryService>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(ancillaryServices)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(ancillaryServices.id, id));

  return true;
}

/**
 * Delete/deactivate ancillary service (admin only)
 */
export async function deactivateAncillaryService(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(ancillaryServices)
    .set({ available: false, updatedAt: new Date() })
    .where(eq(ancillaryServices.id, id));

  return true;
}

/**
 * Add ancillary to booking
 */
export async function addAncillaryToBooking(data: {
  bookingId: number;
  passengerId?: number;
  ancillaryServiceId: number;
  quantity?: number;
  metadata?: any;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get ancillary service details
  const service = await getAncillaryById(data.ancillaryServiceId);
  if (!service) throw new Error("Ancillary service not found");
  if (!service.available) throw new Error("Ancillary service not available");

  const quantity = data.quantity || 1;
  const totalPrice = service.price * quantity;

  const ancillaryData: InsertBookingAncillary = {
    bookingId: data.bookingId,
    passengerId: data.passengerId,
    ancillaryServiceId: data.ancillaryServiceId,
    quantity,
    unitPrice: service.price,
    totalPrice,
    status: "active",
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
  };

  const [result] = await db.insert(bookingAncillaries).values(ancillaryData);
  return {
    id: Number((result as any).insertId),
    totalPrice,
    service,
  };
}

/**
 * Get ancillaries for a booking
 */
export async function getBookingAncillaries(bookingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const results = await db
    .select({
      id: bookingAncillaries.id,
      bookingId: bookingAncillaries.bookingId,
      passengerId: bookingAncillaries.passengerId,
      quantity: bookingAncillaries.quantity,
      unitPrice: bookingAncillaries.unitPrice,
      totalPrice: bookingAncillaries.totalPrice,
      status: bookingAncillaries.status,
      metadata: bookingAncillaries.metadata,
      createdAt: bookingAncillaries.createdAt,
      service: {
        id: ancillaryServices.id,
        code: ancillaryServices.code,
        category: ancillaryServices.category,
        name: ancillaryServices.name,
        description: ancillaryServices.description,
        icon: ancillaryServices.icon,
      },
    })
    .from(bookingAncillaries)
    .leftJoin(
      ancillaryServices,
      eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id)
    )
    .where(eq(bookingAncillaries.bookingId, bookingId));

  return results.map(r => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
  }));
}

/**
 * Calculate total ancillaries cost for a booking
 */
export async function calculateAncillariesTotalCost(
  bookingId: number
): Promise<number> {
  const ancillaries = await getBookingAncillaries(bookingId);
  return ancillaries
    .filter(a => a.status === "active")
    .reduce((sum, a) => sum + a.totalPrice, 0);
}

/**
 * Remove ancillary from booking
 */
export async function removeAncillaryFromBooking(ancillaryId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(bookingAncillaries)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(bookingAncillaries.id, ancillaryId));

  return true;
}

/**
 * Get ancillaries by category with filters
 */
export async function getAncillariesByCategory(params: {
  category: string;
  cabinClass?: string;
  airlineId?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let services = await db
    .select()
    .from(ancillaryServices)
    .where(
      and(
        eq(ancillaryServices.category, params.category as any),
        eq(ancillaryServices.available, true)
      )
    );

  // Filter by cabin class if specified
  if (params.cabinClass) {
    services = services.filter(s => {
      if (!s.applicableCabinClasses) return true;
      const classes = JSON.parse(s.applicableCabinClasses);
      return classes.includes(params.cabinClass);
    });
  }

  // Filter by airline if specified
  if (params.airlineId) {
    services = services.filter(s => {
      if (!s.applicableAirlines) return true;
      const airlines = JSON.parse(s.applicableAirlines);
      return airlines.includes(params.airlineId);
    });
  }

  return services;
}

/**
 * Seed initial ancillary services
 */
export async function seedAncillaryServices() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const services: InsertAncillaryService[] = [
    // Baggage
    {
      code: "BAG_20KG",
      category: "baggage",
      name: "20kg Checked Baggage",
      description: "Additional 20kg checked baggage allowance",
      price: 15000, // 150 SAR
      icon: "luggage",
      available: true,
    },
    {
      code: "BAG_30KG",
      category: "baggage",
      name: "30kg Checked Baggage",
      description: "Additional 30kg checked baggage allowance",
      price: 22000, // 220 SAR
      icon: "luggage",
      available: true,
    },
    {
      code: "BAG_SPORTS",
      category: "baggage",
      name: "Sports Equipment",
      description: "Special handling for sports equipment (golf, ski, etc.)",
      price: 30000, // 300 SAR
      icon: "dumbbell",
      available: true,
    },
    // Meals
    {
      code: "MEAL_REGULAR",
      category: "meal",
      name: "Regular Meal",
      description: "Standard in-flight meal",
      price: 5000, // 50 SAR
      icon: "utensils",
      available: true,
    },
    {
      code: "MEAL_VEGETARIAN",
      category: "meal",
      name: "Vegetarian Meal",
      description: "Vegetarian in-flight meal",
      price: 5000, // 50 SAR
      icon: "leaf",
      available: true,
    },
    {
      code: "MEAL_HALAL",
      category: "meal",
      name: "Halal Meal",
      description: "Halal-certified in-flight meal",
      price: 5000, // 50 SAR
      icon: "utensils",
      available: true,
    },
    {
      code: "MEAL_KIDS",
      category: "meal",
      name: "Kids Meal",
      description: "Special meal for children",
      price: 4000, // 40 SAR
      icon: "baby",
      available: true,
    },
    // Seats
    {
      code: "SEAT_EXTRA_LEG",
      category: "seat",
      name: "Extra Legroom Seat",
      description: "Seat with extra legroom for comfort",
      price: 10000, // 100 SAR
      icon: "armchair",
      applicableCabinClasses: JSON.stringify(["economy"]),
      available: true,
    },
    {
      code: "SEAT_FRONT_ROW",
      category: "seat",
      name: "Front Row Seat",
      description: "Priority seating in front rows",
      price: 8000, // 80 SAR
      icon: "armchair",
      available: true,
    },
    // Insurance
    {
      code: "INS_BASIC",
      category: "insurance",
      name: "Basic Travel Insurance",
      description: "Basic coverage for trip cancellation and delays",
      price: 7500, // 75 SAR
      icon: "shield",
      available: true,
    },
    {
      code: "INS_PREMIUM",
      category: "insurance",
      name: "Premium Travel Insurance",
      description: "Comprehensive coverage including medical and baggage",
      price: 15000, // 150 SAR
      icon: "shield-check",
      available: true,
    },
    // Lounge
    {
      code: "LOUNGE_ACCESS",
      category: "lounge",
      name: "Airport Lounge Access",
      description: "Access to premium airport lounge",
      price: 20000, // 200 SAR
      icon: "coffee",
      available: true,
    },
    // Priority Boarding
    {
      code: "PRIORITY_BOARD",
      category: "priority_boarding",
      name: "Priority Boarding",
      description: "Board the aircraft before general passengers",
      price: 5000, // 50 SAR
      icon: "plane-arrival",
      available: true,
    },
  ];

  // Check if services already exist
  const existing = await db.select().from(ancillaryServices).limit(1);
  if (existing.length > 0) {
    console.log("[Ancillary Services] Services already seeded");
    return;
  }

  await db.insert(ancillaryServices).values(services);
  console.log(`[Ancillary Services] Seeded ${services.length} services`);
}
