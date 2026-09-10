// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getAvailableServices: z.object({
    meal: z.array(
      z.object({ code: z.string(), name: z.string(), description: z.string() })
    ),
    wheelchair: z.array(
      z.object({ code: z.string(), name: z.string(), description: z.string() })
    ),
    unaccompanied_minor: z.array(
      z.object({ code: z.string(), name: z.string(), description: z.string() })
    ),
    extra_legroom: z.array(
      z.object({ code: z.string(), name: z.string(), description: z.string() })
    ),
    pet_in_cabin: z.array(
      z.object({ code: z.string(), name: z.string(), description: z.string() })
    ),
    medical_assistance: z.array(
      z.object({ code: z.string(), name: z.string(), description: z.string() })
    ),
  }),
  requestService: z.object({
    success: z.boolean(),
    service: z.object({
      id: outputNumber,
      status: z.enum(["cancelled", "pending", "confirmed", "rejected"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      bookingId: outputNumber,
      passengerId: outputNumber,
      adminNotes: z.union([z.null(), z.string()]),
      serviceType: z.enum([
        "meal",
        "wheelchair",
        "unaccompanied_minor",
        "extra_legroom",
        "pet_in_cabin",
        "medical_assistance",
      ]),
      serviceCode: z.string(),
      details: z.union([z.null(), z.string()]),
    }),
  }),
  getBookingServices: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["cancelled", "pending", "confirmed", "rejected"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      bookingId: outputNumber,
      passengerId: outputNumber,
      adminNotes: z.union([z.null(), z.string()]),
      serviceType: z.enum([
        "meal",
        "wheelchair",
        "unaccompanied_minor",
        "extra_legroom",
        "pet_in_cabin",
        "medical_assistance",
      ]),
      serviceCode: z.string(),
      details: z.union([z.null(), z.string()]),
      passengerName: z.union([z.undefined(), z.string()]).optional(),
    })
  ),
  cancelService: z.object({ success: z.boolean(), message: z.string() }),
  getServiceById: z.object({
    id: outputNumber,
    status: z.enum(["cancelled", "pending", "confirmed", "rejected"]),
    createdAt: z.date(),
    updatedAt: z.date(),
    bookingId: outputNumber,
    passengerId: outputNumber,
    adminNotes: z.union([z.null(), z.string()]),
    serviceType: z.enum([
      "meal",
      "wheelchair",
      "unaccompanied_minor",
      "extra_legroom",
      "pet_in_cabin",
      "medical_assistance",
    ]),
    serviceCode: z.string(),
    details: z.union([z.null(), z.string()]),
  }),
  getPassengerServices: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["cancelled", "pending", "confirmed", "rejected"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      bookingId: outputNumber,
      passengerId: outputNumber,
      adminNotes: z.union([z.null(), z.string()]),
      serviceType: z.enum([
        "meal",
        "wheelchair",
        "unaccompanied_minor",
        "extra_legroom",
        "pet_in_cabin",
        "medical_assistance",
      ]),
      serviceCode: z.string(),
      details: z.union([z.null(), z.string()]),
    })
  ),
  adminGetPending: z.array(
    z.object({
      id: outputNumber,
      status: z.enum(["cancelled", "pending", "confirmed", "rejected"]),
      createdAt: z.date(),
      updatedAt: z.date(),
      bookingId: outputNumber,
      passengerId: outputNumber,
      adminNotes: z.union([z.null(), z.string()]),
      serviceType: z.enum([
        "meal",
        "wheelchair",
        "unaccompanied_minor",
        "extra_legroom",
        "pet_in_cabin",
        "medical_assistance",
      ]),
      serviceCode: z.string(),
      details: z.union([z.null(), z.string()]),
    })
  ),
  adminUpdateStatus: z.object({ success: z.boolean() }),
  adminBulkUpdateStatus: z.object({
    success: z.boolean(),
    updated: outputNumber,
  }),
};
