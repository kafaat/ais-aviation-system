import { TRPCError } from "@trpc/server";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  specialServices,
  bookings,
  passengers,
  type InsertSpecialService,
  type SpecialService,
} from "../../drizzle/schema";

/**
 * Special Services Service
 * Manages special service requests for passengers (meals, wheelchair, UMNR, etc.)
 */

// Service type definitions
export type ServiceType =
  | "meal"
  | "wheelchair"
  | "unaccompanied_minor"
  | "extra_legroom"
  | "pet_in_cabin"
  | "medical_assistance";

export type ServiceStatus = "pending" | "confirmed" | "rejected" | "cancelled";

// Available service codes by type
export const AVAILABLE_SERVICES: Record<
  ServiceType,
  Array<{ code: string; name: string; description: string }>
> = {
  meal: [
    {
      code: "VGML",
      name: "Vegetarian Meal",
      description: "Lacto-ovo vegetarian meal",
    },
    {
      code: "VVML",
      name: "Vegan Meal",
      description: "Strict vegetarian meal, no animal products",
    },
    {
      code: "MOML",
      name: "Halal Meal",
      description: "Muslim meal prepared according to Islamic law",
    },
    {
      code: "KSML",
      name: "Kosher Meal",
      description: "Meal prepared according to Jewish dietary laws",
    },
    {
      code: "GFML",
      name: "Gluten-Free Meal",
      description: "Meal without gluten-containing ingredients",
    },
    {
      code: "DBML",
      name: "Diabetic Meal",
      description: "Meal suitable for diabetic passengers",
    },
    {
      code: "CHML",
      name: "Child Meal",
      description: "Meal designed for children aged 2-12",
    },
  ],
  wheelchair: [
    {
      code: "WCHR",
      name: "Wheelchair - Ramp",
      description:
        "Passenger can walk short distances but needs wheelchair for long distances",
    },
    {
      code: "WCHS",
      name: "Wheelchair - Steps",
      description: "Passenger cannot walk but can climb stairs",
    },
    {
      code: "WCHC",
      name: "Wheelchair - Cabin",
      description: "Passenger is completely immobile, requires full assistance",
    },
  ],
  unaccompanied_minor: [
    {
      code: "UMNR",
      name: "Unaccompanied Minor",
      description: "Child traveling alone (typically ages 5-14)",
    },
  ],
  extra_legroom: [
    {
      code: "EXST",
      name: "Extra Legroom Seat",
      description: "Request for seat with additional legroom",
    },
  ],
  pet_in_cabin: [
    {
      code: "PETC",
      name: "Pet in Cabin",
      description: "Small pet traveling in cabin with passenger",
    },
  ],
  medical_assistance: [
    {
      code: "MEDA",
      name: "Medical Assistance",
      description: "Passenger requires medical assistance during flight",
    },
  ],
};

/**
 * Get all available special services organized by type
 */
export function getAvailableServices() {
  return AVAILABLE_SERVICES;
}

/**
 * Request a special service for a passenger
 */
export async function requestService(data: {
  bookingId: number;
  passengerId: number;
  serviceType: ServiceType;
  serviceCode: string;
  details?: Record<string, unknown>;
}): Promise<SpecialService> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Validate booking exists
  const booking = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, data.bookingId))
    .limit(1);

  if (booking.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  // Validate passenger belongs to booking
  const passenger = await db
    .select()
    .from(passengers)
    .where(
      and(
        eq(passengers.id, data.passengerId),
        eq(passengers.bookingId, data.bookingId)
      )
    )
    .limit(1);

  if (passenger.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found or does not belong to this booking",
    });
  }

  // Validate service code is valid for the service type
  const validServices = AVAILABLE_SERVICES[data.serviceType];
  const isValidCode = validServices?.some(s => s.code === data.serviceCode);

  if (!isValidCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid service code '${data.serviceCode}' for service type '${data.serviceType}'`,
    });
  }

  // Check if same service type already exists for this passenger
  const existingService = await db
    .select()
    .from(specialServices)
    .where(
      and(
        eq(specialServices.bookingId, data.bookingId),
        eq(specialServices.passengerId, data.passengerId),
        eq(specialServices.serviceType, data.serviceType),
        inArray(specialServices.status, ["pending", "confirmed"])
      )
    )
    .limit(1);

  if (existingService.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `A ${data.serviceType} service request already exists for this passenger`,
    });
  }

  // Create the service request
  const serviceData: InsertSpecialService = {
    bookingId: data.bookingId,
    passengerId: data.passengerId,
    serviceType: data.serviceType,
    serviceCode: data.serviceCode,
    details: data.details ? JSON.stringify(data.details) : null,
    status: "pending",
  };

  const [result] = await db.insert(specialServices).values(serviceData);
  const insertId = Number((result as { insertId: number }).insertId);

  // Return the created service
  const [created] = await db
    .select()
    .from(specialServices)
    .where(eq(specialServices.id, insertId))
    .limit(1);

  return created;
}

/**
 * Get all special services for a booking
 */
export async function getBookingServices(
  bookingId: number
): Promise<Array<SpecialService & { passengerName?: string }>> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const services = await db
    .select({
      id: specialServices.id,
      bookingId: specialServices.bookingId,
      passengerId: specialServices.passengerId,
      serviceType: specialServices.serviceType,
      serviceCode: specialServices.serviceCode,
      details: specialServices.details,
      status: specialServices.status,
      adminNotes: specialServices.adminNotes,
      createdAt: specialServices.createdAt,
      updatedAt: specialServices.updatedAt,
      passengerFirstName: passengers.firstName,
      passengerLastName: passengers.lastName,
    })
    .from(specialServices)
    .leftJoin(passengers, eq(specialServices.passengerId, passengers.id))
    .where(eq(specialServices.bookingId, bookingId));

  return services.map(s => ({
    id: s.id,
    bookingId: s.bookingId,
    passengerId: s.passengerId,
    serviceType: s.serviceType,
    serviceCode: s.serviceCode,
    details: s.details,
    status: s.status,
    adminNotes: s.adminNotes,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    passengerName:
      s.passengerFirstName && s.passengerLastName
        ? `${s.passengerFirstName} ${s.passengerLastName}`
        : undefined,
  }));
}

/**
 * Get a special service by ID
 */
export async function getServiceById(
  serviceId: number
): Promise<SpecialService | null> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select()
    .from(specialServices)
    .where(eq(specialServices.id, serviceId))
    .limit(1);

  return results[0] || null;
}

/**
 * Cancel a special service request
 */
export async function cancelService(
  serviceId: number,
  userId: number
): Promise<{ success: boolean; message: string }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get the service
  const service = await getServiceById(serviceId);
  if (!service) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Special service request not found",
    });
  }

  // Check if the service is in a cancellable state
  if (service.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Service request is already cancelled",
    });
  }

  // Get the booking to verify ownership
  const booking = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, service.bookingId))
    .limit(1);

  if (booking.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (booking[0].userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not authorized to cancel this service request",
    });
  }

  // Update the service status to cancelled
  await db
    .update(specialServices)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(specialServices.id, serviceId));

  return {
    success: true,
    message: "Special service request cancelled successfully",
  };
}

/**
 * Update service status (admin only)
 */
export async function updateServiceStatus(
  serviceId: number,
  status: ServiceStatus,
  adminNotes?: string
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const service = await getServiceById(serviceId);
  if (!service) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Special service request not found",
    });
  }

  const updateData: Partial<InsertSpecialService> = {
    status,
  };

  if (adminNotes !== undefined) {
    updateData.adminNotes = adminNotes;
  }

  await db
    .update(specialServices)
    .set({ ...updateData, updatedAt: new Date() })
    .where(eq(specialServices.id, serviceId));

  return { success: true };
}

/**
 * Get services for a specific passenger
 */
export async function getPassengerServices(
  passengerId: number
): Promise<SpecialService[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select()
    .from(specialServices)
    .where(eq(specialServices.passengerId, passengerId));
}

/**
 * Get service name by code
 */
export function getServiceNameByCode(
  serviceType: ServiceType,
  serviceCode: string
): string | null {
  const services = AVAILABLE_SERVICES[serviceType];
  const service = services?.find(s => s.code === serviceCode);
  return service?.name || null;
}

/**
 * Get service description by code
 */
export function getServiceDescriptionByCode(
  serviceType: ServiceType,
  serviceCode: string
): string | null {
  const services = AVAILABLE_SERVICES[serviceType];
  const service = services?.find(s => s.code === serviceCode);
  return service?.description || null;
}

/**
 * Get all pending service requests (for admin)
 */
export async function getPendingServices(): Promise<SpecialService[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select()
    .from(specialServices)
    .where(eq(specialServices.status, "pending"));
}

/**
 * Bulk update service statuses (admin only)
 */
export async function bulkUpdateServiceStatus(
  serviceIds: number[],
  status: ServiceStatus,
  adminNotes?: string
): Promise<{ success: boolean; updated: number }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (serviceIds.length === 0) {
    return { success: true, updated: 0 };
  }

  const updateData: Partial<InsertSpecialService> = {
    status,
  };

  if (adminNotes !== undefined) {
    updateData.adminNotes = adminNotes;
  }

  await db
    .update(specialServices)
    .set({ ...updateData, updatedAt: new Date() })
    .where(inArray(specialServices.id, serviceIds));

  return { success: true, updated: serviceIds.length };
}
