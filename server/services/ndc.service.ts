import { TRPCError } from "@trpc/server";
import { eq, and, gte, lte, desc, asc, lt, sql } from "drizzle-orm";
import { getDb, generateBookingReference } from "../db";
import {
  ndcOffers,
  ndcOrders,
  flights,
  airlines,
  airports,
  fareClasses,
  bookings,
  ancillaryServices,
  bookingAncillaries,
  passengers,
  type FareClass,
} from "../../drizzle/schema";
import crypto from "crypto";

// ============================================================================
// Constants
// ============================================================================

/** Default offer expiry window in minutes */
const OFFER_EXPIRY_MINUTES = 30;

/** Tax rate applied to base fares (15% VAT for Saudi Arabia) */
const TAX_RATE = 0.15;

/** NDC message version */
const NDC_VERSION = "21.3";

/** Maximum passengers per NDC order */
const MAX_PASSENGERS = 9;

// ============================================================================
// Types
// ============================================================================

/** Cabin class options for NDC offers */
export type NdcCabinClass =
  | "first"
  | "business"
  | "premium_economy"
  | "economy";

/** NDC distribution channel */
export type NdcChannel =
  | "direct"
  | "ndc_aggregator"
  | "gds"
  | "ota"
  | "travel_agent";

/** NDC offer status */
export type NdcOfferStatus =
  | "active"
  | "expired"
  | "selected"
  | "ordered"
  | "cancelled";

/** NDC order status */
export type NdcOrderStatus =
  | "pending"
  | "confirmed"
  | "ticketed"
  | "partially_ticketed"
  | "changed"
  | "cancelled"
  | "refunded";

/** Flight segment within an NDC offer */
export interface NdcSegment {
  segmentKey: string;
  flightId: number;
  flightNumber: string;
  airlineCode: string;
  airlineName: string;
  origin: {
    code: string;
    name: string;
    city: string;
    country: string;
  };
  destination: {
    code: string;
    name: string;
    city: string;
    country: string;
  };
  departureTime: string;
  arrivalTime: string;
  aircraftType: string | null;
  cabinClass: NdcCabinClass;
  fareClass?: string;
  duration?: number;
}

/** Bundled service included in an NDC offer */
export interface NdcBundledService {
  code: string;
  name: string;
  description: string | null;
  included: boolean;
}

/** NDC offer pricing breakdown */
export interface NdcPriceBreakdown {
  basePrice: number;
  taxesAndFees: number;
  totalPrice: number;
  currency: string;
  pricePerPassenger: number;
  passengerCount: number;
}

/** Passenger details for NDC order creation */
export interface NdcPassengerInfo {
  type: "adult" | "child" | "infant";
  title?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: "male" | "female";
  passportNumber?: string;
  passportExpiry?: string;
  passportCountry?: string;
  nationality?: string;
  frequentFlyerNumber?: string;
  frequentFlyerAirline?: string;
}

/** Contact info for NDC order */
export interface NdcContactInfo {
  emailAddress: string;
  phoneNumber: string;
  phoneCountryCode?: string;
  /** @deprecated Use emailAddress instead -- kept for backward compat with router */
  email?: string;
  /** @deprecated Use phoneNumber instead -- kept for backward compat with router */
  phone?: string;
  address?:
    | string
    | {
        street?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country?: string;
      };
}

/** Input for NDC AirShopping (offer search) */
export interface SearchOffersInput {
  originId: number;
  destinationId: number;
  departureDate: Date | string;
  returnDate?: Date | string;
  passengerCount: number;
  cabinClass: NdcCabinClass | string;
  channel?: NdcChannel | string;
  ownerCode?: string;
}

/** Input for NDC OrderCreate */
export interface CreateOrderInput {
  offerId: string;
  passengers: NdcPassengerInfo[];
  contactInfo: NdcContactInfo;
  paymentMethod?: string;
  channel?: NdcChannel | string;
  distributorId?: string;
  userId?: number;
}

/** Input for NDC OrderChange */
export interface ChangeOrderInput {
  newDepartureDate?: Date | string;
  newCabinClass?: string;
  passengerUpdates?: Array<{
    index?: number;
    passengerId?: string;
    updates?: Partial<NdcPassengerInfo>;
    firstName?: string;
    lastName?: string;
    passportNumber?: string;
    passportExpiry?: string;
  }>;
  contactInfoUpdate?: Partial<NdcContactInfo>;
  cabinClassUpgrade?: NdcCabinClass;
}

/** Input for NDC ServiceOrder (ancillary services) */
export interface ServiceOrderInput {
  serviceCode: string;
  /** @deprecated Use serviceCode instead */
  serviceType?: string;
  passengerIndex?: number;
  passengerId?: string;
  segmentId?: string;
  quantity?: number;
}

/** Filters for order history */
export interface OrderHistoryFilters {
  status?: NdcOrderStatus | string;
  channel?: NdcChannel | string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  distributorId?: string;
  limit?: number;
  offset?: number;
  page?: number;
  airlineId?: number;
}

/** Structured NDC offer response */
export interface NdcOfferResponse {
  offerId: string;
  responseId: string;
  airline: {
    code: string;
    name: string;
  };
  origin: {
    code: string;
    name: string;
    city: string;
  };
  destination: {
    code: string;
    name: string;
    city: string;
  };
  departureDate: string;
  returnDate?: string;
  cabinClass: NdcCabinClass;
  pricing: NdcPriceBreakdown;
  segments: NdcSegment[];
  bundledServices: NdcBundledService[];
  fareClass?: {
    code: string;
    name: string;
    fareFamily: string | null;
    refundable: boolean;
    changeable: boolean;
    changeFee: number | null;
    baggageAllowance: number | null;
    baggagePieces: number | null;
  };
  expiresAt: string;
  status: NdcOfferStatus;
  channel: NdcChannel;
  ndcVersion: string;
}

/** Structured NDC order response */
export interface NdcOrderResponse {
  orderId: string;
  offerId: string;
  bookingId: number | null;
  userId?: number;
  airline: {
    id: number;
    code: string;
    name: string;
  };
  passengers: NdcPassengerInfo[];
  contactInfo: NdcContactInfo;
  paymentMethod: string | null;
  totalAmount: number;
  currency: string;
  ticketNumbers: string[];
  emdNumbers: string[];
  status: NdcOrderStatus;
  channel: NdcChannel;
  distributorId: string | null;
  servicingHistory: NdcServicingAction[];
  createdAt: string;
  updatedAt: string;
  ndcVersion: string;
}

/** Servicing action in order history */
export interface NdcServicingAction {
  action: string;
  timestamp: string;
  details: string;
  performedBy?: string;
}

/** Validation result for NDC requests */
export interface NdcValidationResult {
  valid: boolean;
  errors: string[];
}

/** NDC channel statistics */
export interface NdcStatistics {
  totalOffers: number;
  activeOffers: number;
  expiredOffers: number;
  totalOrders: number;
  ordersByStatus: Record<string, number>;
  ordersByChannel: Record<string, number>;
  totalRevenue: number;
  currency: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique NDC-style identifier with a prefix.
 * Format: PREFIX-UUID (e.g., "OFF-a1b2c3d4-e5f6-7890-abcd-ef1234567890")
 */
function generateNdcId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Safely parse a JSON text field, returning the fallback value on failure.
 * @param jsonText - The raw JSON string from the database
 * @param fallback - Default value if parsing fails
 */
function safeParseJson<T>(jsonText: string | null | undefined, fallback: T): T {
  if (!jsonText) return fallback;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return fallback;
  }
}

/**
 * Coerce a Date or ISO string to a Date object.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Calculate flight duration in minutes between departure and arrival times.
 */
function calculateDurationMinutes(departure: Date, arrival: Date): number {
  return Math.round((arrival.getTime() - departure.getTime()) / (1000 * 60));
}

/**
 * Normalize a NdcContactInfo that may come from the router with `email`/`phone`
 * fields instead of `emailAddress`/`phoneNumber`.
 */
function normalizeContactInfo(raw: NdcContactInfo): NdcContactInfo {
  return {
    emailAddress: raw.emailAddress || raw.email || "",
    phoneNumber: raw.phoneNumber || raw.phone || "",
    phoneCountryCode: raw.phoneCountryCode,
    address: raw.address,
  };
}

/**
 * Build bundled services list from a fare class definition.
 * Maps fare class attributes to NDC bundled service descriptors.
 */
function buildBundledServicesFromFareClass(
  fareClass: FareClass
): NdcBundledService[] {
  const services: NdcBundledService[] = [];

  services.push({
    code: "BAG_CHECKED",
    name: `Checked Baggage (${fareClass.baggagePieces ?? 1} x ${fareClass.baggageAllowance ?? 23}kg)`,
    description: `${fareClass.baggagePieces ?? 1} piece(s) of ${fareClass.baggageAllowance ?? 23}kg checked baggage`,
    included: true,
  });

  services.push({
    code: "BAG_CARRY_ON",
    name: `Carry-on Baggage (${fareClass.carryOnAllowance ?? 7}kg)`,
    description: `${fareClass.carryOnAllowance ?? 7}kg carry-on baggage allowance`,
    included: true,
  });

  if (fareClass.mealIncluded) {
    services.push({
      code: "MEAL",
      name: "In-flight Meal",
      description: "Complimentary in-flight meal service",
      included: true,
    });
  }

  if (fareClass.loungeAccess) {
    services.push({
      code: "LOUNGE",
      name: "Lounge Access",
      description: "Access to airport lounge",
      included: true,
    });
  }

  if (fareClass.priorityBoarding) {
    services.push({
      code: "PRIORITY_BOARD",
      name: "Priority Boarding",
      description: "Priority boarding at the gate",
      included: true,
    });
  }

  services.push({
    code: "SEAT_SELECTION",
    name: "Seat Selection",
    description:
      fareClass.seatSelection === "free"
        ? "Free seat selection"
        : fareClass.seatSelection === "paid"
          ? "Paid seat selection available"
          : "No seat selection",
    included: fareClass.seatSelection === "free",
  });

  services.push({
    code: "REFUND",
    name: fareClass.refundable ? "Refundable" : "Non-refundable",
    description: fareClass.refundable
      ? "Full refund available"
      : "Non-refundable fare",
    included: fareClass.refundable,
  });

  services.push({
    code: "CHANGE",
    name: fareClass.changeable ? "Changeable" : "Non-changeable",
    description: fareClass.changeable
      ? fareClass.changeFee
        ? `Changeable with fee of ${(fareClass.changeFee / 100).toFixed(2)} SAR`
        : "Free changes"
      : "Changes not permitted",
    included: fareClass.changeable,
  });

  return services;
}

/**
 * Build default bundled services when no fare class is available.
 * Uses cabin class to determine reasonable defaults.
 */
function buildDefaultBundledServices(
  cabinClass: NdcCabinClass
): NdcBundledService[] {
  const isUpperCabin = cabinClass === "business" || cabinClass === "first";

  return [
    {
      code: "BAG_CHECKED",
      name: isUpperCabin
        ? "Checked Baggage (2 x 32kg)"
        : "Checked Baggage (1 x 23kg)",
      description: isUpperCabin
        ? "2 pieces of 32kg checked baggage"
        : "1 piece of 23kg checked baggage",
      included: true,
    },
    {
      code: "BAG_CARRY_ON",
      name: "Carry-on Baggage (7kg)",
      description: "7kg carry-on baggage allowance",
      included: true,
    },
    {
      code: "MEAL",
      name: "In-flight Meal",
      description: "Complimentary in-flight meal service",
      included: isUpperCabin,
    },
    {
      code: "SEAT_SELECTION",
      name: "Seat Selection",
      description: isUpperCabin
        ? "Free seat selection"
        : "Paid seat selection available",
      included: isUpperCabin,
    },
  ];
}

/**
 * Resolve the userId that owns an NDC order, by looking up the linked booking.
 */
async function resolveOrderUserId(
  bookingId: number | null
): Promise<number | undefined> {
  if (!bookingId) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const results = await db
    .select({ userId: bookings.userId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return results[0]?.userId;
}

// ============================================================================
// Core NDC Service Functions
// ============================================================================

/**
 * NDC AirShopping: Search available flights and create priced offers.
 *
 * Queries the internal flight inventory for matching routes and dates,
 * generates NDC-compliant offers with unique identifiers, pricing breakdowns,
 * segment details, and bundled services. Offers expire after 30 minutes.
 *
 * @param params - Search parameters including route, date, passengers, and cabin class
 * @returns Array of structured NDC offers
 */
export async function searchOffers(
  params: SearchOffersInput
): Promise<NdcOfferResponse[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const departureDate = toDate(params.departureDate);
  const returnDate = params.returnDate ? toDate(params.returnDate) : undefined;
  const cabinClass = params.cabinClass as NdcCabinClass;

  // Validate the request
  const validation = validateNdcRequest({
    type: "AirShopping",
    originId: params.originId,
    destinationId: params.destinationId,
    departureDate,
    passengerCount: params.passengerCount,
    cabinClass,
  });
  if (!validation.valid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC AirShopping validation failed: ${validation.errors.join("; ")}`,
    });
  }

  const responseId = generateNdcId("RSP");
  const channel = (params.channel ?? "direct") as NdcChannel;

  // Build date range for departure day
  const startOfDay = new Date(departureDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(departureDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Query available flights for the route and date
  const availableFlights = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      airlineId: flights.airlineId,
      originId: flights.originId,
      destinationId: flights.destinationId,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airline: {
        code: airlines.code,
        name: airlines.name,
      },
      origin: {
        code: airports.code,
        name: airports.name,
        city: airports.city,
        country: airports.country,
      },
      destination: {
        code: sql<string>`dest.code`,
        name: sql<string>`dest.name`,
        city: sql<string>`dest.city`,
        country: sql<string>`dest.country`,
      },
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(
      and(
        eq(flights.originId, params.originId),
        eq(flights.destinationId, params.destinationId),
        gte(flights.departureTime, startOfDay),
        lte(flights.departureTime, endOfDay),
        eq(flights.status, "scheduled")
      )
    )
    .orderBy(asc(flights.departureTime));

  // Filter by cabin class availability
  const passengerCount = params.passengerCount;
  const filteredFlights = availableFlights.filter(
    (f: (typeof availableFlights)[number]) => {
      if (cabinClass === "economy" || cabinClass === "premium_economy") {
        return f.economyAvailable >= passengerCount;
      }
      return f.businessAvailable >= passengerCount;
    }
  );

  if (filteredFlights.length === 0) {
    return [];
  }

  // For each flight, find applicable fare classes and generate offers
  const offers: NdcOfferResponse[] = [];
  const expiresAt = new Date(Date.now() + OFFER_EXPIRY_MINUTES * 60 * 1000);

  for (const flight of filteredFlights) {
    // Look up fare classes for this airline + cabin class
    const applicableFareClasses = await db
      .select()
      .from(fareClasses)
      .where(
        and(
          eq(fareClasses.airlineId, flight.airlineId),
          eq(fareClasses.cabinClass, cabinClass),
          eq(fareClasses.active, true)
        )
      )
      .orderBy(desc(fareClasses.priority));

    // If fare classes exist, create an offer per fare class
    if (applicableFareClasses.length > 0) {
      for (const fc of applicableFareClasses) {
        const offer = await generateOfferFromFlight({
          flight,
          fareClass: fc,
          passengerCount,
          cabinClass,
          responseId,
          channel,
          ownerCode: params.ownerCode ?? flight.airline.code,
          expiresAt,
          returnDate,
        });
        offers.push(offer);
      }
    } else {
      // No fare class defined -- generate a single offer from base pricing
      const offer = await generateOfferFromFlight({
        flight,
        fareClass: null,
        passengerCount,
        cabinClass,
        responseId,
        channel,
        ownerCode: params.ownerCode ?? flight.airline.code,
        expiresAt,
        returnDate,
      });
      offers.push(offer);
    }
  }

  return offers;
}

/**
 * NDC OfferPrice: Retrieve detailed pricing for a specific offer.
 *
 * Validates that the offer exists and has not expired. Returns the full
 * offer with fare breakdown, segments, and bundled services.
 *
 * @param offerId - The unique NDC offer identifier
 * @returns The complete offer response with pricing details
 */
export async function getOffer(offerId: string): Promise<NdcOfferResponse> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select()
    .from(ndcOffers)
    .where(eq(ndcOffers.offerId, offerId))
    .limit(1);

  const offer = results[0];
  if (!offer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `NDC offer not found: ${offerId}`,
    });
  }

  // Check if the offer has expired
  const now = new Date();
  if (offer.expiresAt < now && offer.status === "active") {
    // Mark as expired in the database
    await db
      .update(ndcOffers)
      .set({ status: "expired", updatedAt: now })
      .where(eq(ndcOffers.id, offer.id));

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC offer has expired: ${offerId}. Offer expired at ${offer.expiresAt.toISOString()}`,
    });
  }

  if (offer.status === "expired") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC offer has expired: ${offerId}`,
    });
  }

  if (offer.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC offer has been cancelled: ${offerId}`,
    });
  }

  // Resolve airline details
  const airlineResults = await db
    .select({ code: airlines.code, name: airlines.name })
    .from(airlines)
    .where(eq(airlines.id, offer.airlineId))
    .limit(1);
  const airline = airlineResults[0] ?? { code: "XX", name: "Unknown Airline" };

  // Resolve origin/destination airports
  const originResults = await db
    .select({
      code: airports.code,
      name: airports.name,
      city: airports.city,
    })
    .from(airports)
    .where(eq(airports.id, offer.originId))
    .limit(1);
  const origin = originResults[0] ?? {
    code: "???",
    name: "Unknown",
    city: "Unknown",
  };

  const destResults = await db
    .select({
      code: airports.code,
      name: airports.name,
      city: airports.city,
    })
    .from(airports)
    .where(eq(airports.id, offer.destinationId))
    .limit(1);
  const destination = destResults[0] ?? {
    code: "???",
    name: "Unknown",
    city: "Unknown",
  };

  const segments = safeParseJson<NdcSegment[]>(offer.segments, []);
  const bundledServices = safeParseJson<NdcBundledService[]>(
    offer.bundledServices,
    []
  );

  // Reconstruct the pricing breakdown from the offer payload
  const payload = safeParseJson<{
    pricing?: { passengerCount?: number; pricePerPassenger?: number };
  }>(offer.offerPayload, {});
  const passengerCount = payload.pricing?.passengerCount ?? 1;
  const pricePerPassenger =
    payload.pricing?.pricePerPassenger ??
    Math.round(offer.totalPrice / Math.max(1, passengerCount));

  // Resolve fare class if present
  let fareClassInfo: NdcOfferResponse["fareClass"];
  if (offer.fareClassId) {
    const fcResults = await db
      .select()
      .from(fareClasses)
      .where(eq(fareClasses.id, offer.fareClassId))
      .limit(1);
    const fc = fcResults[0];
    if (fc) {
      fareClassInfo = {
        code: fc.code,
        name: fc.name,
        fareFamily: fc.fareFamily,
        refundable: fc.refundable,
        changeable: fc.changeable,
        changeFee: fc.changeFee,
        baggageAllowance: fc.baggageAllowance,
        baggagePieces: fc.baggagePieces,
      };
    }
  }

  return {
    offerId: offer.offerId,
    responseId: offer.responseId,
    airline,
    origin,
    destination,
    departureDate: offer.departureDate.toISOString(),
    returnDate: offer.returnDate?.toISOString(),
    cabinClass: offer.cabinClass,
    pricing: {
      basePrice: offer.basePrice,
      taxesAndFees: offer.taxesAndFees,
      totalPrice: offer.totalPrice,
      currency: offer.currency,
      pricePerPassenger,
      passengerCount,
    },
    segments,
    bundledServices,
    fareClass: fareClassInfo,
    expiresAt: offer.expiresAt.toISOString(),
    status: offer.status,
    channel: offer.channel,
    ndcVersion: NDC_VERSION,
  };
}

/**
 * Alias for getOffer -- used by the NDC router as "OfferPrice".
 * @param offerId - The unique NDC offer identifier
 * @returns The complete offer response with pricing details
 */
export const getOfferPrice = getOffer;

/**
 * NDC OrderCreate: Create an order from a selected offer.
 *
 * Validates that the offer is still active and not expired, creates an internal
 * booking record, generates a unique NDC order ID, and stores passenger/contact
 * details as JSON. The order starts in "pending" status awaiting payment.
 *
 * @param params - Order creation parameters including offer, passengers, and contact
 * @returns The created NDC order response
 */
export async function createOrder(
  params: CreateOrderInput
): Promise<NdcOrderResponse> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Normalize contactInfo to handle both email/phone and emailAddress/phoneNumber
  const contactInfo = normalizeContactInfo(params.contactInfo);

  // Validate request
  const validation = validateNdcRequest({
    type: "OrderCreate",
    offerId: params.offerId,
    passengers: params.passengers,
    contactInfo,
  });
  if (!validation.valid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC OrderCreate validation failed: ${validation.errors.join("; ")}`,
    });
  }

  // Fetch and validate the offer
  const offerResults = await db
    .select()
    .from(ndcOffers)
    .where(eq(ndcOffers.offerId, params.offerId))
    .limit(1);

  const offer = offerResults[0];
  if (!offer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `NDC offer not found: ${params.offerId}`,
    });
  }

  const now = new Date();

  // Check expiry
  if (offer.expiresAt < now && offer.status === "active") {
    await db
      .update(ndcOffers)
      .set({ status: "expired", updatedAt: now })
      .where(eq(ndcOffers.id, offer.id));
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC offer has expired: ${params.offerId}. Cannot create order from expired offer.`,
    });
  }

  if (offer.status !== "active" && offer.status !== "selected") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC offer is not available for ordering. Current status: ${offer.status}`,
    });
  }

  // Create the internal booking
  const bookingReference = generateBookingReference();
  const pnr = generateBookingReference();
  const cabinClass =
    offer.cabinClass === "economy" || offer.cabinClass === "premium_economy"
      ? "economy"
      : "business";

  // Determine userId (from params or default to system user 0)
  const userId = params.userId ?? 0;

  const [bookingResult] = await db.insert(bookings).values({
    userId,
    flightId: safeParseJson<NdcSegment[]>(offer.segments, [])[0]?.flightId ?? 0,
    bookingReference,
    pnr,
    status: "pending",
    totalAmount: offer.totalPrice,
    cabinClass,
    numberOfPassengers: params.passengers.length,
  });

  const bookingId = Number(
    (bookingResult as unknown as { insertId?: number }).insertId ?? 0
  );

  if (!bookingId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create internal booking for NDC order",
    });
  }

  // Create passenger records in the bookings system
  const passengerRecords = params.passengers.map(p => ({
    bookingId,
    type: p.type,
    title: p.title,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : undefined,
    passportNumber: p.passportNumber,
    nationality: p.nationality,
  }));

  await db.insert(passengers).values(passengerRecords);

  // Generate the NDC order ID
  const orderId = generateNdcId("ORD");
  const channel = (params.channel ?? offer.channel) as NdcChannel;

  // Build the initial servicing history
  const initialHistory: NdcServicingAction[] = [
    {
      action: "OrderCreate",
      timestamp: now.toISOString(),
      details: `Order created from offer ${params.offerId}`,
    },
  ];

  // Build the order payload (NDC-structured JSON)
  const orderPayload = JSON.stringify({
    ndcVersion: NDC_VERSION,
    orderId,
    offerId: params.offerId,
    bookingReference,
    pnr,
    createdAt: now.toISOString(),
    passengers: params.passengers,
    contactInfo,
    pricing: {
      totalAmount: offer.totalPrice,
      basePrice: offer.basePrice,
      taxesAndFees: offer.taxesAndFees,
      currency: offer.currency,
    },
    segments: safeParseJson(offer.segments, []),
  });

  // Insert the NDC order
  await db.insert(ndcOrders).values({
    orderId,
    offerId: params.offerId,
    bookingId,
    airlineId: offer.airlineId,
    passengers: JSON.stringify(params.passengers),
    contactInfo: JSON.stringify(contactInfo),
    paymentMethod: params.paymentMethod ?? null,
    totalAmount: offer.totalPrice,
    currency: offer.currency,
    status: "pending",
    orderPayload,
    lastServicingAction: "OrderCreate",
    servicingHistory: JSON.stringify(initialHistory),
    channel,
    distributorId: params.distributorId ?? null,
  });

  // Mark the offer as ordered
  await db
    .update(ndcOffers)
    .set({ status: "ordered", updatedAt: now })
    .where(eq(ndcOffers.id, offer.id));

  // Resolve airline for the response
  const airlineResults = await db
    .select({ id: airlines.id, code: airlines.code, name: airlines.name })
    .from(airlines)
    .where(eq(airlines.id, offer.airlineId))
    .limit(1);
  const airline = airlineResults[0] ?? {
    id: offer.airlineId,
    code: "XX",
    name: "Unknown Airline",
  };

  return {
    orderId,
    offerId: params.offerId,
    bookingId,
    userId,
    airline,
    passengers: params.passengers,
    contactInfo,
    paymentMethod: params.paymentMethod ?? null,
    totalAmount: offer.totalPrice,
    currency: offer.currency,
    ticketNumbers: [],
    emdNumbers: [],
    status: "pending",
    channel,
    distributorId: params.distributorId ?? null,
    servicingHistory: initialHistory,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ndcVersion: NDC_VERSION,
  };
}

/**
 * NDC OrderRetrieve: Get full order details with status, tickets, and history.
 *
 * @param orderId - The unique NDC order identifier
 * @returns The complete order response
 */
export async function getOrder(orderId: string): Promise<NdcOrderResponse> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.orderId, orderId))
    .limit(1);

  const order = results[0];
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `NDC order not found: ${orderId}`,
    });
  }

  // Resolve airline
  const airlineResults = await db
    .select({ id: airlines.id, code: airlines.code, name: airlines.name })
    .from(airlines)
    .where(eq(airlines.id, order.airlineId))
    .limit(1);
  const airline = airlineResults[0] ?? {
    id: order.airlineId,
    code: "XX",
    name: "Unknown Airline",
  };

  // Resolve the owning userId from the linked booking
  const userId = await resolveOrderUserId(order.bookingId);

  return {
    orderId: order.orderId,
    offerId: order.offerId,
    bookingId: order.bookingId,
    userId,
    airline,
    passengers: safeParseJson<NdcPassengerInfo[]>(order.passengers, []),
    contactInfo: safeParseJson<NdcContactInfo>(order.contactInfo, {
      emailAddress: "",
      phoneNumber: "",
    }),
    paymentMethod: order.paymentMethod,
    totalAmount: order.totalAmount,
    currency: order.currency,
    ticketNumbers: safeParseJson<string[]>(order.ticketNumbers, []),
    emdNumbers: safeParseJson<string[]>(order.emdNumbers, []),
    status: order.status,
    channel: order.channel,
    distributorId: order.distributorId,
    servicingHistory: safeParseJson<NdcServicingAction[]>(
      order.servicingHistory,
      []
    ),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    ndcVersion: NDC_VERSION,
  };
}

/**
 * NDC OrderCancel: Cancel an existing order.
 *
 * Validates the order can be cancelled (not already cancelled/refunded),
 * updates the NDC order status, cancels the linked internal booking,
 * and records the action in the servicing history.
 *
 * @param orderIdOrParams - The NDC order identifier to cancel, or an object with orderId and reason
 * @param reason - Reason for the cancellation (when first arg is a string)
 * @returns The updated order response
 */
export async function cancelOrder(
  orderIdOrParams:
    | string
    | { orderId: string; userId?: number; reason?: string },
  reason?: string
): Promise<NdcOrderResponse> {
  // Normalize arguments: support both positional and object-based calling
  const orderId =
    typeof orderIdOrParams === "string"
      ? orderIdOrParams
      : orderIdOrParams.orderId;
  const cancelReason =
    reason ??
    (typeof orderIdOrParams === "object"
      ? orderIdOrParams.reason
      : undefined) ??
    "Cancelled by request";

  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.orderId, orderId))
    .limit(1);

  const order = results[0];
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `NDC order not found: ${orderId}`,
    });
  }

  // Validate cancellable status
  const nonCancellableStatuses: NdcOrderStatus[] = ["cancelled", "refunded"];
  if (nonCancellableStatuses.includes(order.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC order cannot be cancelled. Current status: ${order.status}`,
    });
  }

  const now = new Date();

  // Update the servicing history
  const history = safeParseJson<NdcServicingAction[]>(
    order.servicingHistory,
    []
  );
  history.push({
    action: "OrderCancel",
    timestamp: now.toISOString(),
    details: cancelReason,
  });

  // Update the NDC order
  await db
    .update(ndcOrders)
    .set({
      status: "cancelled",
      lastServicingAction: "OrderCancel",
      servicingHistory: JSON.stringify(history),
      updatedAt: now,
    })
    .where(eq(ndcOrders.id, order.id));

  // Cancel the linked internal booking if it exists
  if (order.bookingId) {
    const bookingResults = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, order.bookingId))
      .limit(1);

    const booking = bookingResults[0];
    if (booking && booking.status !== "cancelled") {
      await db
        .update(bookings)
        .set({ status: "cancelled", updatedAt: now })
        .where(eq(bookings.id, order.bookingId));

      // Restore seat availability if booking was confirmed/paid
      if (booking.status === "confirmed" && booking.paymentStatus === "paid") {
        const cabin = booking.cabinClass as "economy" | "business";
        if (cabin === "business") {
          await db
            .update(flights)
            .set({
              businessAvailable: sql`${flights.businessAvailable} + ${booking.numberOfPassengers}`,
              updatedAt: now,
            })
            .where(eq(flights.id, booking.flightId));
        } else {
          await db
            .update(flights)
            .set({
              economyAvailable: sql`${flights.economyAvailable} + ${booking.numberOfPassengers}`,
              updatedAt: now,
            })
            .where(eq(flights.id, booking.flightId));
        }
      }
    }
  }

  // Mark the source offer as cancelled if it was in "ordered" state
  const offerResults = await db
    .select()
    .from(ndcOffers)
    .where(eq(ndcOffers.offerId, order.offerId))
    .limit(1);

  if (offerResults[0] && offerResults[0].status === "ordered") {
    await db
      .update(ndcOffers)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(ndcOffers.id, offerResults[0].id));
  }

  return getOrder(orderId);
}

/**
 * NDC OrderChange: Modify an existing order.
 *
 * Supports date changes, passenger detail updates, contact info updates,
 * and cabin class upgrades. Records each change in the servicing history.
 *
 * @param orderIdOrParams - The NDC order identifier, or an object with orderId, userId, and changes
 * @param changesArg - Object describing the desired changes (when first arg is a string)
 * @returns The updated order response
 */
export async function changeOrder(
  orderIdOrParams:
    | string
    | { orderId: string; userId?: number; changes: ChangeOrderInput },
  changesArg?: ChangeOrderInput
): Promise<NdcOrderResponse> {
  // Normalize arguments: support both positional and object-based calling
  const orderId =
    typeof orderIdOrParams === "string"
      ? orderIdOrParams
      : orderIdOrParams.orderId;
  const changes =
    changesArg ??
    (typeof orderIdOrParams === "object" ? orderIdOrParams.changes : {});

  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const results = await db
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.orderId, orderId))
    .limit(1);

  const order = results[0];
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `NDC order not found: ${orderId}`,
    });
  }

  // Only pending, confirmed, or ticketed orders can be changed
  const changeableStatuses: NdcOrderStatus[] = [
    "pending",
    "confirmed",
    "ticketed",
  ];
  if (!changeableStatuses.includes(order.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `NDC order cannot be changed. Current status: ${order.status}`,
    });
  }

  const now = new Date();
  const history = safeParseJson<NdcServicingAction[]>(
    order.servicingHistory,
    []
  );
  const currentPassengers = safeParseJson<NdcPassengerInfo[]>(
    order.passengers,
    []
  );
  const currentContact = safeParseJson<NdcContactInfo>(order.contactInfo, {
    emailAddress: "",
    phoneNumber: "",
  });

  const updatedPassengers = [...currentPassengers];
  let updatedContact = currentContact;
  let updatedAmount = order.totalAmount;
  const changeDetails: string[] = [];

  // Apply passenger updates
  if (changes.passengerUpdates && changes.passengerUpdates.length > 0) {
    for (const paxUpdate of changes.passengerUpdates) {
      const idx =
        paxUpdate.index ?? parseInt(paxUpdate.passengerId ?? "-1", 10);
      if (idx >= 0 && idx < updatedPassengers.length) {
        // Support both { updates: {...} } and direct field form from the router
        const patchData = paxUpdate.updates ?? {
          ...(paxUpdate.firstName ? { firstName: paxUpdate.firstName } : {}),
          ...(paxUpdate.lastName ? { lastName: paxUpdate.lastName } : {}),
          ...(paxUpdate.passportNumber
            ? { passportNumber: paxUpdate.passportNumber }
            : {}),
          ...(paxUpdate.passportExpiry
            ? { passportExpiry: paxUpdate.passportExpiry }
            : {}),
        };
        updatedPassengers[idx] = {
          ...updatedPassengers[idx],
          ...patchData,
        };
        changeDetails.push(
          `Passenger ${idx + 1} updated: ${Object.keys(patchData).join(", ")}`
        );
      }
    }
  }

  // Apply contact info update
  if (changes.contactInfoUpdate) {
    updatedContact = { ...updatedContact, ...changes.contactInfoUpdate };
    changeDetails.push(
      `Contact info updated: ${Object.keys(changes.contactInfoUpdate).join(", ")}`
    );
  }

  // Handle date change
  const newDepartureDate = changes.newDepartureDate
    ? toDate(changes.newDepartureDate)
    : undefined;
  if (newDepartureDate && order.bookingId) {
    const bookingResults = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, order.bookingId))
      .limit(1);

    const booking = bookingResults[0];
    if (booking) {
      // Find a new flight on the requested date for the same route
      const offerResults = await db
        .select()
        .from(ndcOffers)
        .where(eq(ndcOffers.offerId, order.offerId))
        .limit(1);

      const offer = offerResults[0];
      if (offer) {
        const newStartOfDay = new Date(newDepartureDate);
        newStartOfDay.setHours(0, 0, 0, 0);
        const newEndOfDay = new Date(newDepartureDate);
        newEndOfDay.setHours(23, 59, 59, 999);

        const newFlights = await db
          .select()
          .from(flights)
          .where(
            and(
              eq(flights.originId, offer.originId),
              eq(flights.destinationId, offer.destinationId),
              gte(flights.departureTime, newStartOfDay),
              lte(flights.departureTime, newEndOfDay),
              eq(flights.status, "scheduled")
            )
          )
          .orderBy(asc(flights.departureTime))
          .limit(1);

        const newFlight = newFlights[0];
        if (!newFlight) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No available flights found on ${newDepartureDate.toISOString().split("T")[0]} for this route`,
          });
        }

        // Verify seat availability on the new flight
        const cabin = booking.cabinClass as "economy" | "business";
        const seatsAvailable =
          cabin === "business"
            ? newFlight.businessAvailable
            : newFlight.economyAvailable;

        if (seatsAvailable < booking.numberOfPassengers) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient seats on the new flight. Available: ${seatsAvailable}, Required: ${booking.numberOfPassengers}`,
          });
        }

        // Update the booking to point to the new flight
        await db
          .update(bookings)
          .set({ flightId: newFlight.id, updatedAt: now })
          .where(eq(bookings.id, order.bookingId));

        changeDetails.push(
          `Date changed to ${newDepartureDate.toISOString().split("T")[0]}, new flight: ${newFlight.flightNumber}`
        );
      }
    }
  }

  // Handle cabin class upgrade (from changes.cabinClassUpgrade or changes.newCabinClass)
  const targetCabinRaw = changes.cabinClassUpgrade ?? changes.newCabinClass;
  if (targetCabinRaw && order.bookingId) {
    const bookingResults = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, order.bookingId))
      .limit(1);

    const booking = bookingResults[0];
    if (booking) {
      const currentFlight = await db
        .select()
        .from(flights)
        .where(eq(flights.id, booking.flightId))
        .limit(1);

      if (currentFlight[0]) {
        const targetCabin =
          targetCabinRaw === "economy" || targetCabinRaw === "premium_economy"
            ? "economy"
            : "business";

        if (targetCabin === "business" && booking.cabinClass !== "business") {
          if (currentFlight[0].businessAvailable < booking.numberOfPassengers) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Insufficient business class seats for upgrade. Available: ${currentFlight[0].businessAvailable}`,
            });
          }
          // Calculate price difference
          const priceDifference =
            (currentFlight[0].businessPrice - currentFlight[0].economyPrice) *
            booking.numberOfPassengers;
          updatedAmount = order.totalAmount + priceDifference;

          await db
            .update(bookings)
            .set({
              cabinClass: targetCabin,
              totalAmount: updatedAmount,
              updatedAt: now,
            })
            .where(eq(bookings.id, order.bookingId));

          changeDetails.push(
            `Cabin upgraded to ${targetCabinRaw}. Additional charge: ${(priceDifference / 100).toFixed(2)} SAR`
          );
        }
      }
    }
  }

  // Record the change in servicing history
  if (changeDetails.length > 0) {
    history.push({
      action: "OrderChange",
      timestamp: now.toISOString(),
      details: changeDetails.join("; "),
    });
  }

  // Update the NDC order
  await db
    .update(ndcOrders)
    .set({
      passengers: JSON.stringify(updatedPassengers),
      contactInfo: JSON.stringify(updatedContact),
      totalAmount: updatedAmount,
      status: "changed",
      lastServicingAction: "OrderChange",
      servicingHistory: JSON.stringify(history),
      updatedAt: now,
    })
    .where(eq(ndcOrders.id, order.id));

  return getOrder(orderId);
}

/**
 * NDC ServiceList/ServiceOrder: Add ancillary services to an existing order.
 *
 * Looks up available ancillary services by code, validates the order is in
 * a serviceable state, attaches the services to the linked booking, and
 * updates the order total and servicing history.
 *
 * @param orderId - The NDC order identifier
 * @param services - Array of services to add
 * @returns The updated order response
 */
export async function serviceOrder(
  orderId: string,
  services: ServiceOrderInput[]
): Promise<NdcOrderResponse> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (!services || services.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one service must be provided",
    });
  }

  const orderResults = await db
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.orderId, orderId))
    .limit(1);

  const order = orderResults[0];
  if (!order) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `NDC order not found: ${orderId}`,
    });
  }

  // Only pending, confirmed, or ticketed orders can have services added
  const serviceableStatuses: NdcOrderStatus[] = [
    "pending",
    "confirmed",
    "ticketed",
  ];
  if (!serviceableStatuses.includes(order.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot add services to order with status: ${order.status}`,
    });
  }

  if (!order.bookingId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "NDC order has no linked booking. Cannot add ancillary services.",
    });
  }

  const now = new Date();
  const history = safeParseJson<NdcServicingAction[]>(
    order.servicingHistory,
    []
  );
  let additionalCost = 0;
  const serviceDetails: string[] = [];

  for (const svc of services) {
    // Support both serviceCode and serviceType from the router
    const code = svc.serviceCode || svc.serviceType || "";
    if (!code) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "serviceCode is required for each service",
      });
    }

    // Look up the ancillary service by code
    const ancillaryResults = await db
      .select()
      .from(ancillaryServices)
      .where(
        and(
          eq(ancillaryServices.code, code),
          eq(ancillaryServices.available, true)
        )
      )
      .limit(1);

    const ancillary = ancillaryResults[0];
    if (!ancillary) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Ancillary service not found or unavailable: ${code}`,
      });
    }

    const quantity = svc.quantity ?? 1;
    const totalPrice = ancillary.price * quantity;

    // Create the booking ancillary record
    await db.insert(bookingAncillaries).values({
      bookingId: order.bookingId,
      ancillaryServiceId: ancillary.id,
      quantity,
      unitPrice: ancillary.price,
      totalPrice,
      status: "active",
    });

    additionalCost += totalPrice;
    serviceDetails.push(
      `${ancillary.name} x${quantity} (${(totalPrice / 100).toFixed(2)} SAR)`
    );
  }

  // Update order total
  const newTotal = order.totalAmount + additionalCost;

  // Build EMD numbers for the new services (placeholder format)
  const existingEmds = safeParseJson<string[]>(order.emdNumbers, []);
  for (const _svc of services) {
    existingEmds.push(`EMD-${crypto.randomUUID().slice(0, 13).toUpperCase()}`);
  }

  history.push({
    action: "ServiceOrder",
    timestamp: now.toISOString(),
    details: `Added services: ${serviceDetails.join(", ")}. Additional cost: ${(additionalCost / 100).toFixed(2)} SAR`,
  });

  await db
    .update(ndcOrders)
    .set({
      totalAmount: newTotal,
      emdNumbers: JSON.stringify(existingEmds),
      lastServicingAction: "ServiceOrder",
      servicingHistory: JSON.stringify(history),
      updatedAt: now,
    })
    .where(eq(ndcOrders.id, order.id));

  return getOrder(orderId);
}

/**
 * Alias for serviceOrder -- used by the NDC router as "addServices".
 * Accepts either positional args or an object with orderId, userId, and services.
 *
 * @param orderIdOrParams - Order ID string or object with orderId + services
 * @param servicesArg - Services array (when first arg is a string)
 * @returns The updated order response
 */
export function addServices(
  orderIdOrParams:
    | string
    | { orderId: string; userId?: number; services: ServiceOrderInput[] },
  servicesArg?: ServiceOrderInput[]
): Promise<NdcOrderResponse> {
  const orderId =
    typeof orderIdOrParams === "string"
      ? orderIdOrParams
      : orderIdOrParams.orderId;
  const services =
    servicesArg ??
    (typeof orderIdOrParams === "object" ? orderIdOrParams.services : []);
  return serviceOrder(orderId, services);
}

/**
 * Get order history for an airline, with optional filters.
 *
 * Supports filtering by order status, distribution channel, date range,
 * and distributor. Returns paginated results ordered by creation date descending.
 *
 * @param airlineId - The airline's internal ID
 * @param filters - Optional filter criteria
 * @returns Array of NDC order responses with total count
 */
export async function getOrderHistory(
  airlineId: number,
  filters?: OrderHistoryFilters
): Promise<{ orders: NdcOrderResponse[]; total: number }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [eq(ndcOrders.airlineId, airlineId)];

  if (filters?.status) {
    conditions.push(eq(ndcOrders.status, filters.status as NdcOrderStatus));
  }
  if (filters?.channel) {
    conditions.push(eq(ndcOrders.channel, filters.channel as NdcChannel));
  }
  if (filters?.dateFrom) {
    conditions.push(gte(ndcOrders.createdAt, toDate(filters.dateFrom)));
  }
  if (filters?.dateTo) {
    conditions.push(lte(ndcOrders.createdAt, toDate(filters.dateTo)));
  }
  if (filters?.distributorId) {
    conditions.push(eq(ndcOrders.distributorId, filters.distributorId));
  }

  const limit = Math.min(filters?.limit ?? 20, 100);
  const offset =
    filters?.offset ?? (filters?.page ? (filters.page - 1) * limit : 0);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(ndcOrders)
    .where(and(...conditions));
  const total = Number(countResult[0]?.count ?? 0);

  // Get the order rows
  const orderRows = await db
    .select()
    .from(ndcOrders)
    .where(and(...conditions))
    .orderBy(desc(ndcOrders.createdAt))
    .limit(limit)
    .offset(offset);

  // Resolve airline details once
  const airlineResults = await db
    .select({ id: airlines.id, code: airlines.code, name: airlines.name })
    .from(airlines)
    .where(eq(airlines.id, airlineId))
    .limit(1);
  const airline = airlineResults[0] ?? {
    id: airlineId,
    code: "XX",
    name: "Unknown Airline",
  };

  const orders: NdcOrderResponse[] = orderRows.map(
    (order: (typeof orderRows)[number]) => ({
      orderId: order.orderId,
      offerId: order.offerId,
      bookingId: order.bookingId,
      airline,
      passengers: safeParseJson<NdcPassengerInfo[]>(order.passengers, []),
      contactInfo: safeParseJson<NdcContactInfo>(order.contactInfo, {
        emailAddress: "",
        phoneNumber: "",
      }),
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      currency: order.currency,
      ticketNumbers: safeParseJson<string[]>(order.ticketNumbers, []),
      emdNumbers: safeParseJson<string[]>(order.emdNumbers, []),
      status: order.status,
      channel: order.channel,
      distributorId: order.distributorId,
      servicingHistory: safeParseJson<NdcServicingAction[]>(
        order.servicingHistory,
        []
      ),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      ndcVersion: NDC_VERSION,
    })
  );

  return { orders, total };
}

/**
 * List orders with filters -- admin-oriented version of getOrderHistory.
 *
 * Accepts a single filters object (as the router passes it) and queries
 * across all airlines when no airlineId is specified.
 *
 * @param filters - Filter criteria including optional airlineId
 * @returns Orders with total count
 */
export async function listOrders(
  filters: OrderHistoryFilters
): Promise<{ orders: NdcOrderResponse[]; total: number }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions: ReturnType<typeof eq>[] = [];

  if (filters.airlineId) {
    conditions.push(eq(ndcOrders.airlineId, filters.airlineId));
  }
  if (filters.status) {
    conditions.push(eq(ndcOrders.status, filters.status as NdcOrderStatus));
  }
  if (filters.channel) {
    conditions.push(eq(ndcOrders.channel, filters.channel as NdcChannel));
  }
  if (filters.dateFrom) {
    conditions.push(gte(ndcOrders.createdAt, toDate(filters.dateFrom)));
  }
  if (filters.dateTo) {
    conditions.push(lte(ndcOrders.createdAt, toDate(filters.dateTo)));
  }
  if (filters.distributorId) {
    conditions.push(eq(ndcOrders.distributorId, filters.distributorId));
  }

  const limit = Math.min(filters.limit ?? 20, 100);
  const offset =
    filters.offset ?? (filters.page ? (filters.page - 1) * limit : 0);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(ndcOrders)
    .where(whereClause);
  const total = Number(countResult[0]?.count ?? 0);

  // Get the order rows
  const orderRows = await db
    .select()
    .from(ndcOrders)
    .where(whereClause)
    .orderBy(desc(ndcOrders.createdAt))
    .limit(limit)
    .offset(offset);

  // Collect unique airline IDs
  const airlineIds = [...new Set(orderRows.map(o => o.airlineId))];
  const airlineMap = new Map<
    number,
    { id: number; code: string; name: string }
  >();

  if (airlineIds.length > 0) {
    const airlineRows = await db
      .select({ id: airlines.id, code: airlines.code, name: airlines.name })
      .from(airlines);
    for (const a of airlineRows) {
      airlineMap.set(a.id, a);
    }
  }

  const orders: NdcOrderResponse[] = orderRows.map(
    (order: (typeof orderRows)[number]) => ({
      orderId: order.orderId,
      offerId: order.offerId,
      bookingId: order.bookingId,
      airline: airlineMap.get(order.airlineId) ?? {
        id: order.airlineId,
        code: "XX",
        name: "Unknown Airline",
      },
      passengers: safeParseJson<NdcPassengerInfo[]>(order.passengers, []),
      contactInfo: safeParseJson<NdcContactInfo>(order.contactInfo, {
        emailAddress: "",
        phoneNumber: "",
      }),
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      currency: order.currency,
      ticketNumbers: safeParseJson<string[]>(order.ticketNumbers, []),
      emdNumbers: safeParseJson<string[]>(order.emdNumbers, []),
      status: order.status,
      channel: order.channel,
      distributorId: order.distributorId,
      servicingHistory: safeParseJson<NdcServicingAction[]>(
        order.servicingHistory,
        []
      ),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      ndcVersion: NDC_VERSION,
    })
  );

  return { orders, total };
}

/**
 * Expire stale offers that have passed their expiry time.
 *
 * Intended to be called periodically (e.g., by a cron job) to clean up
 * offers that were never selected or ordered before they expired.
 *
 * @returns The number of offers that were marked as expired
 */
export async function expireStaleOffers(): Promise<number> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const now = new Date();

  const result = await db
    .update(ndcOffers)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(ndcOffers.status, "active"), lt(ndcOffers.expiresAt, now)));

  // Extract affected rows from MySQL result
  const affectedRows =
    (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;

  return affectedRows;
}

/**
 * Alias for expireStaleOffers -- used by the NDC router.
 */
export const expireOffers = expireStaleOffers;

/**
 * Get aggregated NDC channel statistics.
 *
 * Returns counts of offers and orders by status, revenue totals by channel,
 * and other high-level metrics for NDC distribution monitoring.
 *
 * @returns NDC statistics summary
 */
export async function getStatistics(): Promise<NdcStatistics> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Count offers by status
  const offerCounts = await db
    .select({
      status: ndcOffers.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(ndcOffers)
    .groupBy(ndcOffers.status);

  let totalOffers = 0;
  let activeOffers = 0;
  let expiredOffers = 0;
  for (const row of offerCounts) {
    const count = Number(row.count);
    totalOffers += count;
    if (row.status === "active") activeOffers = count;
    if (row.status === "expired") expiredOffers = count;
  }

  // Count orders by status
  const orderStatusCounts = await db
    .select({
      status: ndcOrders.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(ndcOrders)
    .groupBy(ndcOrders.status);

  const ordersByStatus: Record<string, number> = {};
  let totalOrders = 0;
  for (const row of orderStatusCounts) {
    const count = Number(row.count);
    ordersByStatus[row.status] = count;
    totalOrders += count;
  }

  // Count orders and revenue by channel
  const channelStats = await db
    .select({
      channel: ndcOrders.channel,
      count: sql<number>`COUNT(*)`,
      revenue: sql<number>`COALESCE(SUM(${ndcOrders.totalAmount}), 0)`,
    })
    .from(ndcOrders)
    .groupBy(ndcOrders.channel);

  const ordersByChannel: Record<string, number> = {};
  let totalRevenue = 0;
  for (const row of channelStats) {
    ordersByChannel[row.channel] = Number(row.count);
    totalRevenue += Number(row.revenue);
  }

  return {
    totalOffers,
    activeOffers,
    expiredOffers,
    totalOrders,
    ordersByStatus,
    ordersByChannel,
    totalRevenue,
    currency: "SAR",
  };
}

/**
 * Internal helper: Generate an NDC offer from internal flight data.
 *
 * Creates a priced offer with segments, bundled services, and a complete
 * pricing breakdown. Persists the offer to the database so it can be
 * retrieved later via getOffer or used in createOrder.
 *
 * @param params - Flight data, fare class, and offer configuration
 * @returns Structured NDC offer response
 */
export async function generateOfferFromFlight(params: {
  flight: {
    id: number;
    flightNumber: string;
    airlineId: number;
    originId: number;
    destinationId: number;
    departureTime: Date;
    arrivalTime: Date;
    aircraftType: string | null;
    economyPrice: number;
    businessPrice: number;
    airline: { code: string; name: string };
    origin: { code: string; name: string; city: string; country: string };
    destination: { code: string; name: string; city: string; country: string };
  };
  fareClass: FareClass | null;
  passengerCount: number;
  cabinClass: NdcCabinClass;
  responseId: string;
  channel: NdcChannel;
  ownerCode: string;
  expiresAt: Date;
  returnDate?: Date;
}): Promise<NdcOfferResponse> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const {
    flight,
    fareClass,
    passengerCount,
    cabinClass,
    responseId,
    channel,
    ownerCode,
    expiresAt,
    returnDate,
  } = params;

  // Calculate pricing
  const basePricePerPax =
    cabinClass === "economy" || cabinClass === "premium_economy"
      ? flight.economyPrice
      : flight.businessPrice;

  // Apply fare class multiplier if available
  const multiplier = fareClass
    ? parseFloat(String(fareClass.basePriceMultiplier))
    : 1.0;
  const adjustedBasePerPax = Math.round(basePricePerPax * multiplier);
  const totalBasePrice = adjustedBasePerPax * passengerCount;
  const taxesAndFees = Math.round(totalBasePrice * TAX_RATE);
  const totalPrice = totalBasePrice + taxesAndFees;

  // Build segment
  const segmentKey = generateNdcId("SEG");
  const segment: NdcSegment = {
    segmentKey,
    flightId: flight.id,
    flightNumber: flight.flightNumber,
    airlineCode: flight.airline.code,
    airlineName: flight.airline.name,
    origin: flight.origin,
    destination: flight.destination,
    departureTime: flight.departureTime.toISOString(),
    arrivalTime: flight.arrivalTime.toISOString(),
    aircraftType: flight.aircraftType,
    cabinClass,
    fareClass: fareClass?.code,
    duration: calculateDurationMinutes(
      flight.departureTime,
      flight.arrivalTime
    ),
  };

  // Build bundled services
  const bundledServices = fareClass
    ? buildBundledServicesFromFareClass(fareClass)
    : buildDefaultBundledServices(cabinClass);

  // Build the full offer payload (NDC-structured JSON)
  const offerId = generateNdcId("OFF");
  const pricePerPassenger =
    adjustedBasePerPax + Math.round(adjustedBasePerPax * TAX_RATE);
  const offerPayload = JSON.stringify({
    ndcVersion: NDC_VERSION,
    offerId,
    responseId,
    owner: ownerCode,
    airline: flight.airline,
    route: {
      origin: flight.origin,
      destination: flight.destination,
    },
    pricing: {
      basePrice: totalBasePrice,
      taxesAndFees,
      totalPrice,
      currency: "SAR",
      pricePerPassenger,
      passengerCount,
    },
    segments: [segment],
    bundledServices,
    fareClass: fareClass
      ? {
          code: fareClass.code,
          name: fareClass.name,
          fareFamily: fareClass.fareFamily,
        }
      : null,
  });

  // Persist the offer to the database
  await db.insert(ndcOffers).values({
    offerId,
    responseId,
    originId: flight.originId,
    destinationId: flight.destinationId,
    departureDate: flight.departureTime,
    returnDate: returnDate ?? null,
    airlineId: flight.airlineId,
    fareClassId: fareClass?.id ?? null,
    cabinClass,
    totalPrice,
    basePrice: totalBasePrice,
    taxesAndFees,
    currency: "SAR",
    offerPayload,
    segments: JSON.stringify([segment]),
    bundledServices: JSON.stringify(bundledServices),
    expiresAt,
    status: "active",
    ownerCode,
    channel,
  });

  // Build fare class info for the response
  let fareClassInfo: NdcOfferResponse["fareClass"];
  if (fareClass) {
    fareClassInfo = {
      code: fareClass.code,
      name: fareClass.name,
      fareFamily: fareClass.fareFamily,
      refundable: fareClass.refundable,
      changeable: fareClass.changeable,
      changeFee: fareClass.changeFee,
      baggageAllowance: fareClass.baggageAllowance,
      baggagePieces: fareClass.baggagePieces,
    };
  }

  return {
    offerId,
    responseId,
    airline: flight.airline,
    origin: {
      code: flight.origin.code,
      name: flight.origin.name,
      city: flight.origin.city,
    },
    destination: {
      code: flight.destination.code,
      name: flight.destination.name,
      city: flight.destination.city,
    },
    departureDate: flight.departureTime.toISOString(),
    returnDate: returnDate?.toISOString(),
    cabinClass,
    pricing: {
      basePrice: totalBasePrice,
      taxesAndFees,
      totalPrice,
      currency: "SAR",
      pricePerPassenger,
      passengerCount,
    },
    segments: [segment],
    bundledServices,
    fareClass: fareClassInfo,
    expiresAt: expiresAt.toISOString(),
    status: "active",
    channel,
    ndcVersion: NDC_VERSION,
  };
}

/**
 * Validate incoming NDC requests for required fields and constraints.
 *
 * Performs structural and business-rule validations depending on the request
 * type. Returns a validation result indicating success or listing all errors.
 *
 * @param request - The NDC request to validate
 * @returns Validation result with success flag and any error messages
 */
export function validateNdcRequest(request: {
  type: string;
  originId?: number;
  destinationId?: number;
  departureDate?: Date;
  passengerCount?: number;
  cabinClass?: NdcCabinClass;
  offerId?: string;
  passengers?: NdcPassengerInfo[];
  contactInfo?: NdcContactInfo;
}): NdcValidationResult {
  const errors: string[] = [];

  switch (request.type) {
    case "AirShopping": {
      if (!request.originId || request.originId <= 0) {
        errors.push("originId is required and must be a positive integer");
      }
      if (!request.destinationId || request.destinationId <= 0) {
        errors.push("destinationId is required and must be a positive integer");
      }
      if (
        request.originId &&
        request.destinationId &&
        request.originId === request.destinationId
      ) {
        errors.push("originId and destinationId must be different");
      }
      if (!request.departureDate) {
        errors.push("departureDate is required");
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (request.departureDate < today) {
          errors.push("departureDate cannot be in the past");
        }
      }
      if (
        !request.passengerCount ||
        request.passengerCount < 1 ||
        request.passengerCount > MAX_PASSENGERS
      ) {
        errors.push(`passengerCount must be between 1 and ${MAX_PASSENGERS}`);
      }
      if (!request.cabinClass) {
        errors.push("cabinClass is required");
      }
      break;
    }

    case "OrderCreate": {
      if (!request.offerId || request.offerId.trim() === "") {
        errors.push("offerId is required");
      }
      if (!request.passengers || request.passengers.length === 0) {
        errors.push("At least one passenger is required");
      } else if (request.passengers.length > MAX_PASSENGERS) {
        errors.push(`Maximum ${MAX_PASSENGERS} passengers allowed per order`);
      } else {
        // Validate each passenger
        for (let i = 0; i < request.passengers.length; i++) {
          const pax = request.passengers[i];
          if (!pax.firstName || pax.firstName.trim() === "") {
            errors.push(`Passenger ${i + 1}: firstName is required`);
          }
          if (!pax.lastName || pax.lastName.trim() === "") {
            errors.push(`Passenger ${i + 1}: lastName is required`);
          }
          if (!pax.type) {
            errors.push(
              `Passenger ${i + 1}: type is required (adult, child, or infant)`
            );
          }
        }

        // Verify at least one adult
        const adultCount = request.passengers.filter(
          p => p.type === "adult"
        ).length;
        if (adultCount === 0) {
          errors.push("At least one adult passenger is required");
        }

        // Verify infant-to-adult ratio (max 1 infant per adult)
        const infantCount = request.passengers.filter(
          p => p.type === "infant"
        ).length;
        if (infantCount > adultCount) {
          errors.push("Number of infants cannot exceed number of adults");
        }
      }
      if (!request.contactInfo) {
        errors.push("contactInfo is required");
      } else {
        const email =
          request.contactInfo.emailAddress || request.contactInfo.email || "";
        const phone =
          request.contactInfo.phoneNumber || request.contactInfo.phone || "";
        if (!email || email.trim() === "") {
          errors.push("contactInfo.emailAddress is required");
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push("contactInfo.emailAddress is not a valid email address");
        }
        if (!phone || phone.trim() === "") {
          errors.push("contactInfo.phoneNumber is required");
        }
      }
      break;
    }

    default:
      // Unknown request types pass through without specific validation
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
