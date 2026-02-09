/**
 * GDS (Global Distribution System) Integration Service
 *
 * Handles integration with major GDS providers (Amadeus, Sabre, Travelport, TravelSky)
 * for flight availability, booking (PNR creation), ticketing, and cancellation.
 * All GDS message exchanges are logged for audit and diagnostics.
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  gdsConnections,
  gdsMessages,
  type GdsConnection,
  type InsertGdsConnection,
  type GdsMessage,
} from "../../drizzle/schema";
import { eq, and, desc, gte, lte, sql, count } from "drizzle-orm";
import crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export type GdsProvider = "amadeus" | "sabre" | "travelport" | "travelsky";

export type GdsEnvironment = "production" | "certification" | "test";

/**
 * Status values for GDS connections.
 * "suspended" is included for router Zod schema compatibility even though
 * the DB column maps to active/inactive/maintenance/error.
 */
export type GdsConnectionStatus =
  | "active"
  | "inactive"
  | "maintenance"
  | "error"
  | "suspended";

export type GdsMessageType =
  | "availability_request"
  | "availability_response"
  | "pricing_request"
  | "pricing_response"
  | "booking_request"
  | "booking_response"
  | "ticketing_request"
  | "ticketing_response"
  | "cancel_request"
  | "cancel_response"
  | "schedule_request"
  | "schedule_response";

export type GdsMessageDirection = "outbound" | "inbound";

export type GdsMessageStatus = "success" | "error" | "timeout" | "pending";

export interface CreateConnectionParams {
  provider: GdsProvider;
  airlineId: number;
  connectionName: string;
  pseudoCityCode?: string;
  officeId?: string;
  apiKey?: string;
  apiSecret?: string;
  environment?: GdsEnvironment;
  baseUrl?: string;
  supportsBooking?: boolean;
  supportsTicketing?: boolean;
  supportsSchedules?: boolean;
  supportsPricing?: boolean;
  supportsAvailability?: boolean;
  maxRequestsPerMinute?: number;
  maxRequestsPerDay?: number;
  /** ID of the admin user who created this connection (passed by router) */
  createdBy?: number;
}

export interface UpdateConnectionParams {
  provider?: GdsProvider;
  connectionName?: string;
  pseudoCityCode?: string;
  officeId?: string;
  apiKey?: string;
  apiSecret?: string;
  environment?: GdsEnvironment;
  baseUrl?: string;
  supportsBooking?: boolean;
  supportsTicketing?: boolean;
  supportsSchedules?: boolean;
  supportsPricing?: boolean;
  supportsAvailability?: boolean;
  maxRequestsPerMinute?: number;
  maxRequestsPerDay?: number;
  status?: GdsConnectionStatus;
}

export interface SearchAvailabilityParams {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  passengers: {
    adults: number;
    children?: number;
    infants?: number;
  };
  cabinClass?: "economy" | "business" | "first";
  directOnly?: boolean;
}

export interface AvailabilityResult {
  correlationId: string;
  provider: GdsProvider;
  flights: Array<{
    flightNumber: string;
    airline: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    cabinClass: string;
    seatsAvailable: number;
    fare: {
      amount: number;
      currency: string;
      fareClass: string;
      fareBasis: string;
    };
    stops: number;
    duration: string;
  }>;
  responseTimeMs: number;
}

export interface CreateBookingParams {
  flightNumber: string;
  origin: string;
  destination: string;
  departureDate: string;
  cabinClass: string;
  fareClass: string;
  passengers: Array<{
    type: "ADT" | "CHD" | "INF";
    title: string;
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    passportNumber?: string;
    passportExpiry?: string;
    nationality?: string;
  }>;
  contact: {
    email: string;
    phone: string;
  };
  ticketTimeLimit?: string; // ISO date string
}

export interface BookingResult {
  correlationId: string;
  provider: GdsProvider;
  pnrLocator: string;
  status: "confirmed" | "pending" | "waitlisted";
  segments: Array<{
    flightNumber: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    cabinClass: string;
    fareClass: string;
    status: string;
  }>;
  ticketTimeLimit: string;
  totalFare: {
    amount: number;
    currency: string;
  };
  responseTimeMs: number;
}

export interface TicketResult {
  correlationId: string;
  provider: GdsProvider;
  pnrLocator: string;
  tickets: Array<{
    ticketNumber: string;
    passengerName: string;
    status: string;
  }>;
  responseTimeMs: number;
}

export interface CancelResult {
  correlationId: string;
  provider: GdsProvider;
  pnrLocator: string;
  status: "cancelled" | "partially_cancelled" | "failed";
  cancellationReference?: string;
  responseTimeMs: number;
}

export interface MessageLogFilters {
  messageType?: GdsMessageType | (string & {});
  direction?: GdsMessageDirection;
  status?: GdsMessageStatus | (string & {});
  correlationId?: string;
  bookingReference?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  limit?: number;
}

export interface ProviderStatistics {
  connectionId: number;
  provider: GdsProvider;
  totalMessages: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  successRate: number;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  messagesByType: Record<string, number>;
  last24hVolume: number;
  last24hErrorRate: number;
}

export interface LogMessageParams {
  connectionId: number;
  provider: GdsProvider;
  messageType: GdsMessageType;
  direction: GdsMessageDirection;
  correlationId: string;
  requestPayload?: string;
  responsePayload?: string;
  bookingReference?: string;
  responseTimeMs?: number;
  httpStatusCode?: number;
  status: GdsMessageStatus;
  errorMessage?: string;
}

// ============================================================================
// Provider-specific configuration requirements
// ============================================================================

const PROVIDER_REQUIREMENTS: Record<
  GdsProvider,
  {
    requiresPseudoCityCode: boolean;
    requiresOfficeId: boolean;
    requiresApiKey: boolean;
    defaultBaseUrls: Record<GdsEnvironment, string>;
    defaultMaxRequestsPerMinute: number;
    defaultMaxRequestsPerDay: number;
  }
> = {
  amadeus: {
    requiresPseudoCityCode: false,
    requiresOfficeId: true,
    requiresApiKey: true,
    defaultBaseUrls: {
      production: "https://api.amadeus.com/v2",
      certification: "https://test.api.amadeus.com/v2",
      test: "https://test.api.amadeus.com/v2",
    },
    defaultMaxRequestsPerMinute: 40,
    defaultMaxRequestsPerDay: 20000,
  },
  sabre: {
    requiresPseudoCityCode: true,
    requiresOfficeId: false,
    requiresApiKey: true,
    defaultBaseUrls: {
      production: "https://api.sabre.com/v1",
      certification: "https://api-crt.cert.sabre.com/v1",
      test: "https://api-crt.cert.sabre.com/v1",
    },
    defaultMaxRequestsPerMinute: 60,
    defaultMaxRequestsPerDay: 30000,
  },
  travelport: {
    requiresPseudoCityCode: true,
    requiresOfficeId: false,
    requiresApiKey: true,
    defaultBaseUrls: {
      production: "https://api.travelport.com/11/air",
      certification: "https://apicert.travelport.com/11/air",
      test: "https://apicert.travelport.com/11/air",
    },
    defaultMaxRequestsPerMinute: 50,
    defaultMaxRequestsPerDay: 25000,
  },
  travelsky: {
    requiresPseudoCityCode: false,
    requiresOfficeId: true,
    requiresApiKey: true,
    defaultBaseUrls: {
      production: "https://api.travelsky.com/v1",
      certification: "https://cert.api.travelsky.com/v1",
      test: "https://test.api.travelsky.com/v1",
    },
    defaultMaxRequestsPerMinute: 30,
    defaultMaxRequestsPerDay: 15000,
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique correlation ID for tracking GDS message pairs
 */
function generateCorrelationId(): string {
  return `GDS-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Generate a simulated PNR locator (6-character alphanumeric)
 */
function generatePnrLocator(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a simulated ticket number (13 digits: 3-digit airline code + 10-digit serial)
 */
function generateTicketNumber(airlineNumericCode: string = "065"): string {
  const serial = Math.floor(Math.random() * 10000000000)
    .toString()
    .padStart(10, "0");
  return `${airlineNumericCode}${serial}`;
}

/**
 * Mask sensitive fields (API keys, secrets) in connection data
 */
function maskSensitiveFields(connection: GdsConnection): Omit<
  GdsConnection,
  "apiKey" | "apiSecret"
> & {
  apiKey: string | null;
  apiSecret: string | null;
} {
  return {
    ...connection,
    apiKey: connection.apiKey ? `****${connection.apiKey.slice(-4)}` : null,
    apiSecret: connection.apiSecret ? "********" : null,
  };
}

/**
 * Validate that a connection supports the requested operation
 */
function assertConnectionCapability(
  connection: GdsConnection,
  capability: "booking" | "ticketing" | "schedules" | "pricing" | "availability"
): void {
  const capabilityMap: Record<string, boolean> = {
    booking: connection.supportsBooking,
    ticketing: connection.supportsTicketing,
    schedules: connection.supportsSchedules,
    pricing: connection.supportsPricing,
    availability: connection.supportsAvailability,
  };

  if (!capabilityMap[capability]) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Connection "${connection.connectionName}" does not support ${capability} operations`,
    });
  }
}

/**
 * Validate that a connection is in an operable state
 */
function assertConnectionActive(connection: GdsConnection): void {
  if (connection.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Connection "${connection.connectionName}" is not active (current status: ${connection.status})`,
    });
  }
}

// ============================================================================
// Internal: GDS Message Logging
// ============================================================================

/**
 * Log a GDS message exchange to the audit table
 */
export async function logMessage(params: LogMessageParams): Promise<number> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  try {
    const [result] = await db.insert(gdsMessages).values({
      connectionId: params.connectionId,
      provider: params.provider,
      messageType: params.messageType,
      direction: params.direction,
      correlationId: params.correlationId,
      requestPayload: params.requestPayload ?? null,
      responsePayload: params.responsePayload ?? null,
      bookingReference: params.bookingReference ?? null,
      responseTimeMs: params.responseTimeMs ?? null,
      httpStatusCode: params.httpStatusCode ?? null,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
    });

    return Number((result as { insertId: number }).insertId);
  } catch (error) {
    console.error("[GDS] Failed to log message:", error);
    // Do not throw here -- logging failure should not break the main operation
    return 0;
  }
}

// ============================================================================
// Internal: Provider-Specific Request Builders
// ============================================================================

/**
 * Build provider-specific request payloads.
 * These are stub implementations showing the correct structure for each GDS provider.
 * In production, these would generate the actual XML/JSON payloads per provider API specification.
 */
export function buildGdsRequest(
  provider: GdsProvider,
  messageType: GdsMessageType,
  params: Record<string, unknown>
): string {
  switch (provider) {
    case "amadeus":
      return buildAmadeusRequest(messageType, params);
    case "sabre":
      return buildSabreRequest(messageType, params);
    case "travelport":
      return buildTravelportRequest(messageType, params);
    case "travelsky":
      return buildTravelSkyRequest(messageType, params);
    default:
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unsupported GDS provider: ${provider}`,
      });
  }
}

function buildAmadeusRequest(
  messageType: GdsMessageType,
  params: Record<string, unknown>
): string {
  // Amadeus uses JSON-based REST API (v2)
  switch (messageType) {
    case "availability_request":
      return JSON.stringify({
        type: "flight-offers-search",
        currencyCode: "SAR",
        originDestinations: [
          {
            id: "1",
            originLocationCode: params.origin,
            destinationLocationCode: params.destination,
            departureDateTimeRange: {
              date: params.departureDate,
            },
          },
        ],
        travelers: buildAmadeusTravelers(
          params.passengers as Record<string, number>
        ),
        sources: ["GDS"],
        searchCriteria: {
          maxFlightOffers: 50,
          flightFilters: {
            cabinRestrictions: params.cabinClass
              ? [
                  {
                    cabin: (params.cabinClass as string).toUpperCase(),
                    coverage: "MOST_SEGMENTS",
                    originDestinationIds: ["1"],
                  },
                ]
              : undefined,
            connectionRestriction: params.directOnly
              ? { maxNumberOfConnections: 0 }
              : undefined,
          },
        },
      });

    case "booking_request":
      return JSON.stringify({
        type: "flight-order",
        flightOffers: [
          {
            type: "flight-offer",
            id: "1",
            source: "GDS",
            itineraries: [
              {
                segments: [
                  {
                    departure: {
                      iataCode: params.origin,
                      at: params.departureDate,
                    },
                    arrival: {
                      iataCode: params.destination,
                    },
                    carrierCode: (params.flightNumber as string)?.slice(0, 2),
                    number: (params.flightNumber as string)?.slice(2),
                    operating: {
                      carrierCode: (params.flightNumber as string)?.slice(0, 2),
                    },
                  },
                ],
              },
            ],
          },
        ],
        travelers: params.passengers,
        remarks: {
          general: [{ subType: "GENERAL_MISCELLANEOUS", text: "AIS BOOKING" }],
        },
        ticketingAgreement: {
          option: "DELAY_TO_QUEUE",
          dateTime: params.ticketTimeLimit,
        },
        contacts: [params.contact],
      });

    case "ticketing_request":
      return JSON.stringify({
        type: "ticket-issuance",
        pnrLocator: params.pnr,
        ticketingOption: "IMMEDIATE",
      });

    case "cancel_request":
      return JSON.stringify({
        type: "flight-order-cancel",
        orderReference: params.pnr,
      });

    default:
      return JSON.stringify({ type: messageType, ...params });
  }
}

function buildAmadeusTravelers(
  passengers?: Record<string, number>
): Array<Record<string, unknown>> {
  const travelers: Array<Record<string, unknown>> = [];
  let id = 1;

  const adults = passengers?.adults ?? 1;
  const children = passengers?.children ?? 0;
  const infants = passengers?.infants ?? 0;

  for (let i = 0; i < adults; i++) {
    travelers.push({ id: String(id++), travelerType: "ADULT" });
  }
  for (let i = 0; i < children; i++) {
    travelers.push({ id: String(id++), travelerType: "CHILD" });
  }
  for (let i = 0; i < infants; i++) {
    travelers.push({
      id: String(id++),
      travelerType: "SEATED_INFANT",
      associatedAdultId: String(i + 1),
    });
  }

  return travelers;
}

function buildSabreRequest(
  messageType: GdsMessageType,
  params: Record<string, unknown>
): string {
  // Sabre uses SOAP/XML-based Sabre Web Services (SWS) and REST APIs
  switch (messageType) {
    case "availability_request":
      return JSON.stringify({
        OTA_AirAvailRQ: {
          Version: "6.1.0",
          OriginDestinationInformation: {
            FlightSegment: {
              DepartureDateTime: params.departureDate,
              OriginLocation: { LocationCode: params.origin },
              DestinationLocation: { LocationCode: params.destination },
            },
          },
          OptionalQualifiers: {
            FlightQualifiers: {
              VendorPrefs: params.directOnly
                ? { Airline: { Code: params.airline } }
                : undefined,
            },
            PricingQualifiers: {
              CurrencyCode: "SAR",
            },
          },
        },
      });

    case "booking_request":
      return JSON.stringify({
        CreatePassengerNameRecordRQ: {
          version: "2.4.0",
          TravelItineraryAddInfo: {
            AgencyInfo: {
              Ticketing: {
                TicketType: "7TAW",
                PseudoCityCode: params.pseudoCityCode,
              },
            },
            CustomerInfo: {
              PersonName: params.passengers,
              ContactNumbers: {
                ContactNumber: [
                  {
                    Phone: (params.contact as Record<string, string>)?.phone,
                    PhoneUseType: "H",
                  },
                ],
              },
              Email: [
                {
                  Address: (params.contact as Record<string, string>)?.email,
                  Type: "TO",
                },
              ],
            },
          },
          AirBook: {
            OriginDestinationInformation: {
              FlightSegment: [
                {
                  DepartureDateTime: params.departureDate,
                  FlightNumber: params.flightNumber,
                  OriginLocation: { LocationCode: params.origin },
                  DestinationLocation: { LocationCode: params.destination },
                  MarketingAirline: {
                    Code: (params.flightNumber as string)?.slice(0, 2),
                    FlightNumber: (params.flightNumber as string)?.slice(2),
                  },
                  ResBookDesigCode: params.fareClass,
                },
              ],
            },
          },
          PostProcessing: {
            EndTransaction: { Source: { ReceivedFrom: "AIS SYSTEM" } },
          },
        },
      });

    case "ticketing_request":
      return JSON.stringify({
        AirTicketRQ: {
          version: "1.2.1",
          DesignatePrinter: {
            Printers: { Ticket: { CountryCode: "SA" } },
          },
          Ticketing: {
            PricingQualifiers: {},
            PNR_Locator: params.pnr,
          },
        },
      });

    case "cancel_request":
      return JSON.stringify({
        OTA_CancelRQ: {
          Version: "2.0",
          POS: { Source: { PseudoCityCode: params.pseudoCityCode } },
          UniqueID: { ID: params.pnr, Type: "PNR" },
          Segment: { Type: "entire" },
        },
      });

    default:
      return JSON.stringify({ messageType, ...params });
  }
}

function buildTravelportRequest(
  messageType: GdsMessageType,
  params: Record<string, unknown>
): string {
  // Travelport uses Universal API (UAPI) -- JSON representation of the XML structure
  switch (messageType) {
    case "availability_request":
      return JSON.stringify({
        "air:AvailabilitySearchReq": {
          TargetBranch: params.pseudoCityCode,
          "air:SearchAirLeg": {
            "air:SearchOrigin": {
              "com:CityOrAirport": { Code: params.origin },
            },
            "air:SearchDestination": {
              "com:CityOrAirport": { Code: params.destination },
            },
            "air:SearchDepTime": {
              PreferredTime: params.departureDate,
            },
            "air:AirLegModifiers": {
              PreferredCabins: params.cabinClass
                ? { "com:CabinClass": { Type: params.cabinClass } }
                : undefined,
            },
          },
          "air:AirSearchModifiers": {
            MaxSolutions: "50",
            PreferNonStop: params.directOnly ? "true" : "false",
          },
        },
      });

    case "booking_request":
      return JSON.stringify({
        "universal:AirCreateReservationReq": {
          TargetBranch: params.pseudoCityCode,
          "com:BookingTraveler": params.passengers,
          "air:AirPricingSolution": {
            "air:AirSegment": [
              {
                DepartureTime: params.departureDate,
                Origin: params.origin,
                Destination: params.destination,
                Carrier: (params.flightNumber as string)?.slice(0, 2),
                FlightNumber: (params.flightNumber as string)?.slice(2),
                ClassOfService: params.fareClass,
              },
            ],
          },
          "com:ActionStatus": {
            Type: "TAW",
            TicketDate: params.ticketTimeLimit,
          },
        },
      });

    case "ticketing_request":
      return JSON.stringify({
        "air:AirTicketingReq": {
          TargetBranch: params.pseudoCityCode,
          "air:AirReservationLocatorCode": params.pnr,
          "air:AirTicketingModifiers": {
            "air:AirPricingInfoRef": { Key: "pricing_1" },
          },
        },
      });

    case "cancel_request":
      return JSON.stringify({
        "universal:UniversalRecordCancelReq": {
          "universal:UniversalRecordLocatorCode": params.pnr,
          Version: "0",
        },
      });

    default:
      return JSON.stringify({ messageType, ...params });
  }
}

function buildTravelSkyRequest(
  messageType: GdsMessageType,
  params: Record<string, unknown>
): string {
  // TravelSky uses proprietary IBE/eTerm-based messaging
  switch (messageType) {
    case "availability_request":
      return JSON.stringify({
        header: {
          messageType: "AV",
          officeId: params.officeId,
          version: "1.0",
        },
        body: {
          originDestination: {
            origin: params.origin,
            destination: params.destination,
            departureDate: params.departureDate,
          },
          cabin: params.cabinClass ?? "Y",
          directOnly: params.directOnly ?? false,
          passengerCount:
            (params.passengers as Record<string, number>)?.adults ?? 1,
        },
      });

    case "booking_request":
      return JSON.stringify({
        header: {
          messageType: "SSR",
          officeId: params.officeId,
          version: "1.0",
        },
        body: {
          itinerary: {
            segment: {
              flightNumber: params.flightNumber,
              departureDate: params.departureDate,
              origin: params.origin,
              destination: params.destination,
              classOfService: params.fareClass,
            },
          },
          passengers: params.passengers,
          contact: params.contact,
          ticketTimeLimit: params.ticketTimeLimit,
        },
      });

    case "ticketing_request":
      return JSON.stringify({
        header: {
          messageType: "ETDZ",
          officeId: params.officeId,
          version: "1.0",
        },
        body: {
          pnrLocator: params.pnr,
          ticketingOption: "IMMEDIATE",
        },
      });

    case "cancel_request":
      return JSON.stringify({
        header: {
          messageType: "XE",
          officeId: params.officeId,
          version: "1.0",
        },
        body: {
          pnrLocator: params.pnr,
          cancelScope: "ALL",
        },
      });

    default:
      return JSON.stringify({ messageType, ...params });
  }
}

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Register a new GDS connection. Validates provider-specific requirements
 * such as PCC for Sabre/Travelport and Office ID for Amadeus/TravelSky.
 */
export async function createConnection(
  params: CreateConnectionParams
): Promise<{ id: number; connectionName: string; provider: GdsProvider }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Validate provider-specific requirements
  const requirements = PROVIDER_REQUIREMENTS[params.provider];

  if (requirements.requiresPseudoCityCode && !params.pseudoCityCode) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Provider ${params.provider} requires a Pseudo City Code (PCC)`,
    });
  }

  if (requirements.requiresOfficeId && !params.officeId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Provider ${params.provider} requires an Office ID`,
    });
  }

  if (requirements.requiresApiKey && !params.apiKey) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Provider ${params.provider} requires an API key`,
    });
  }

  // Check for duplicate connection name per airline
  const existing = await db
    .select({ id: gdsConnections.id })
    .from(gdsConnections)
    .where(
      and(
        eq(gdsConnections.airlineId, params.airlineId),
        eq(gdsConnections.connectionName, params.connectionName)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A connection named "${params.connectionName}" already exists for this airline`,
    });
  }

  const environment = params.environment ?? "test";

  const values: InsertGdsConnection = {
    provider: params.provider,
    airlineId: params.airlineId,
    connectionName: params.connectionName,
    pseudoCityCode: params.pseudoCityCode ?? null,
    officeId: params.officeId ?? null,
    apiKey: params.apiKey ?? null,
    apiSecret: params.apiSecret ?? null,
    environment,
    baseUrl: params.baseUrl ?? requirements.defaultBaseUrls[environment],
    supportsBooking: params.supportsBooking ?? true,
    supportsTicketing: params.supportsTicketing ?? true,
    supportsSchedules: params.supportsSchedules ?? true,
    supportsPricing: params.supportsPricing ?? true,
    supportsAvailability: params.supportsAvailability ?? true,
    maxRequestsPerMinute:
      params.maxRequestsPerMinute ?? requirements.defaultMaxRequestsPerMinute,
    maxRequestsPerDay:
      params.maxRequestsPerDay ?? requirements.defaultMaxRequestsPerDay,
    status: "inactive",
  };

  try {
    const [result] = await db.insert(gdsConnections).values(values);
    const insertId = Number((result as { insertId: number }).insertId);

    console.info(
      `[GDS] Created ${params.provider} connection "${params.connectionName}" (id=${insertId}) for airline ${params.airlineId}`
    );

    return {
      id: insertId,
      connectionName: params.connectionName,
      provider: params.provider,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("[GDS] Error creating connection:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create GDS connection",
    });
  }
}

/**
 * Update an existing GDS connection configuration.
 */
export async function updateConnection(
  id: number,
  params: UpdateConnectionParams
): Promise<{ success: true }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Verify connection exists
  const [existing] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, id))
    .limit(1);

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${id} not found`,
    });
  }

  // Build the update set, only including provided fields
  const updateSet: Record<string, unknown> = {};

  if (params.provider !== undefined) updateSet.provider = params.provider;
  if (params.connectionName !== undefined)
    updateSet.connectionName = params.connectionName;
  if (params.pseudoCityCode !== undefined)
    updateSet.pseudoCityCode = params.pseudoCityCode;
  if (params.officeId !== undefined) updateSet.officeId = params.officeId;
  if (params.apiKey !== undefined) updateSet.apiKey = params.apiKey;
  if (params.apiSecret !== undefined) updateSet.apiSecret = params.apiSecret;
  if (params.environment !== undefined)
    updateSet.environment = params.environment;
  if (params.baseUrl !== undefined) updateSet.baseUrl = params.baseUrl;
  if (params.supportsBooking !== undefined)
    updateSet.supportsBooking = params.supportsBooking;
  if (params.supportsTicketing !== undefined)
    updateSet.supportsTicketing = params.supportsTicketing;
  if (params.supportsSchedules !== undefined)
    updateSet.supportsSchedules = params.supportsSchedules;
  if (params.supportsPricing !== undefined)
    updateSet.supportsPricing = params.supportsPricing;
  if (params.supportsAvailability !== undefined)
    updateSet.supportsAvailability = params.supportsAvailability;
  if (params.maxRequestsPerMinute !== undefined)
    updateSet.maxRequestsPerMinute = params.maxRequestsPerMinute;
  if (params.maxRequestsPerDay !== undefined)
    updateSet.maxRequestsPerDay = params.maxRequestsPerDay;
  if (params.status !== undefined) updateSet.status = params.status;

  if (Object.keys(updateSet).length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No fields provided to update",
    });
  }

  try {
    await db
      .update(gdsConnections)
      .set(updateSet)
      .where(eq(gdsConnections.id, id));

    console.info(
      `[GDS] Updated connection id=${id} fields: ${Object.keys(updateSet).join(", ")}`
    );
    return { success: true };
  } catch (error) {
    console.error("[GDS] Error updating connection:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update GDS connection",
    });
  }
}

/**
 * Get connection details with sensitive fields masked.
 */
export async function getConnection(id: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, id))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${id} not found`,
    });
  }

  return maskSensitiveFields(connection);
}

/**
 * List all GDS connections, optionally filtered by airline, provider, or status.
 * Sensitive fields are masked.
 * Accepts either a bare airlineId number or a filter object.
 */
export async function listConnections(
  filters?:
    | number
    | {
        airlineId?: number;
        provider?: GdsProvider;
        status?: GdsConnectionStatus;
      }
) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const filterObj =
    typeof filters === "number" ? { airlineId: filters } : filters;

  const conditions = [];

  if (filterObj?.airlineId) {
    conditions.push(eq(gdsConnections.airlineId, filterObj.airlineId));
  }
  if (filterObj?.provider) {
    conditions.push(eq(gdsConnections.provider, filterObj.provider));
  }
  if (filterObj?.status) {
    // Cast needed: GdsConnectionStatus includes "suspended" for router compat
    // but the DB column only has active/inactive/maintenance/error
    conditions.push(
      eq(
        gdsConnections.status,
        filterObj.status as "active" | "inactive" | "maintenance" | "error"
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const connections = await db
    .select()
    .from(gdsConnections)
    .where(whereClause)
    .orderBy(desc(gdsConnections.updatedAt));

  return connections.map(maskSensitiveFields);
}

// ============================================================================
// Connection Health
// ============================================================================

/**
 * Test a GDS connection by simulating a health check ping to the provider.
 * Updates lastHealthCheck timestamp and status accordingly.
 */
export async function testConnection(connectionId: number): Promise<{
  connectionId: number;
  provider: GdsProvider;
  healthy: boolean;
  responseTimeMs: number;
  message: string;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${connectionId} not found`,
    });
  }

  const _startTime = Date.now();

  // Simulate health check -- in production this would be an actual HTTP call
  // to the GDS provider's health/ping endpoint
  const simulatedLatencyMs = Math.floor(Math.random() * 200) + 50; // 50-250ms
  const isHealthy = connection.apiKey !== null && connection.baseUrl !== null;

  const responseTimeMs = simulatedLatencyMs;
  const now = new Date();

  const updateData: Record<string, unknown> = {
    lastHealthCheck: now,
  };

  let message: string;

  if (isHealthy) {
    // If connection was previously in error state, set back to active
    if (connection.status === "error") {
      updateData.status = "active";
    }
    updateData.lastError = null;
    message = `Connection to ${connection.provider} (${connection.environment}) is healthy. Response time: ${responseTimeMs}ms`;
  } else {
    updateData.status = "error";
    updateData.lastError =
      "Health check failed: missing API credentials or base URL";
    message = `Connection to ${connection.provider} (${connection.environment}) failed health check: missing credentials or base URL`;
  }

  await db
    .update(gdsConnections)
    .set(updateData)
    .where(eq(gdsConnections.id, connectionId));

  // Log the health check as a schedule message pair
  const correlationId = generateCorrelationId();

  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "schedule_request",
    direction: "outbound",
    correlationId,
    requestPayload: JSON.stringify({
      type: "health_check",
      baseUrl: connection.baseUrl,
      environment: connection.environment,
      timestamp: now.toISOString(),
    }),
    status: "pending",
  });

  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "schedule_response",
    direction: "inbound",
    correlationId,
    responsePayload: JSON.stringify({
      healthy: isHealthy,
      responseTimeMs,
      message,
    }),
    responseTimeMs,
    httpStatusCode: isHealthy ? 200 : 503,
    status: isHealthy ? "success" : "error",
    errorMessage: isHealthy ? undefined : "Health check failed",
  });

  console.info(
    `[GDS] Health check for connection ${connectionId} (${connection.provider}): ${isHealthy ? "HEALTHY" : "UNHEALTHY"} (${responseTimeMs}ms)`
  );

  return {
    connectionId,
    provider: connection.provider,
    healthy: isHealthy,
    responseTimeMs,
    message,
  };
}

/**
 * Run health checks on all active connections.
 * Returns summary of results.
 */
export async function healthCheckAll(): Promise<{
  total: number;
  healthy: number;
  unhealthy: number;
  results: Array<{
    connectionId: number;
    provider: GdsProvider;
    connectionName: string;
    healthy: boolean;
    responseTimeMs: number;
  }>;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const activeConnections = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.status, "active"));

  const results: Array<{
    connectionId: number;
    provider: GdsProvider;
    connectionName: string;
    healthy: boolean;
    responseTimeMs: number;
  }> = [];

  // Run health checks sequentially to avoid overwhelming GDS providers
  for (const connection of activeConnections) {
    try {
      const result = await testConnection(connection.id);
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        connectionName: connection.connectionName,
        healthy: result.healthy,
        responseTimeMs: result.responseTimeMs,
      });
    } catch (_error) {
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        connectionName: connection.connectionName,
        healthy: false,
        responseTimeMs: 0,
      });
    }
  }

  const healthy = results.filter(r => r.healthy).length;

  console.info(
    `[GDS] Health check all: ${healthy}/${results.length} connections healthy`
  );

  return {
    total: results.length,
    healthy,
    unhealthy: results.length - healthy,
    results,
  };
}

// ============================================================================
// Flight Availability Search
// ============================================================================

/**
 * Router-compatible flat input for searchAvailability.
 * The tRPC router passes a single object with connectionId embedded.
 */
export interface SearchAvailabilityFlatParams {
  connectionId: number;
  originCode: string;
  destinationCode: string;
  departureDate: string;
  returnDate?: string;
  passengers: number;
  cabinClass?: string;
  userId?: number;
}

/**
 * Search flight availability through a GDS connection.
 * Builds provider-specific request, logs the exchange, and returns formatted results.
 * Currently simulated -- in production, this would make actual HTTP calls to the GDS API.
 *
 * Supports two calling conventions:
 * - `searchAvailability(connectionId, params)` -- direct service call
 * - `searchAvailability(flatParams)` -- single-object call from the router
 */
export async function searchAvailability(
  connectionIdOrParams: number | SearchAvailabilityFlatParams,
  params?: SearchAvailabilityParams
): Promise<AvailabilityResult> {
  // Normalize arguments: support both (connectionId, params) and (flatObject)
  let resolvedConnectionId: number;
  let resolvedParams: SearchAvailabilityParams;

  if (typeof connectionIdOrParams === "number") {
    resolvedConnectionId = connectionIdOrParams;
    if (!params) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Search params are required when connectionId is passed as first argument",
      });
    }
    resolvedParams = params;
  } else {
    // Flat-object form from the router
    resolvedConnectionId = connectionIdOrParams.connectionId;
    resolvedParams = {
      origin: connectionIdOrParams.originCode,
      destination: connectionIdOrParams.destinationCode,
      departureDate: connectionIdOrParams.departureDate,
      returnDate: connectionIdOrParams.returnDate,
      passengers: {
        adults: connectionIdOrParams.passengers,
      },
      cabinClass:
        connectionIdOrParams.cabinClass as SearchAvailabilityParams["cabinClass"],
      directOnly: undefined,
    };
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Fetch and validate connection
  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, resolvedConnectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${resolvedConnectionId} not found`,
    });
  }

  assertConnectionActive(connection);
  assertConnectionCapability(connection, "availability");

  const correlationId = generateCorrelationId();

  // Build provider-specific request payload
  const requestPayload = buildGdsRequest(
    connection.provider,
    "availability_request",
    {
      origin: resolvedParams.origin,
      destination: resolvedParams.destination,
      departureDate: resolvedParams.departureDate,
      returnDate: resolvedParams.returnDate,
      passengers: resolvedParams.passengers,
      cabinClass: resolvedParams.cabinClass,
      directOnly: resolvedParams.directOnly,
      pseudoCityCode: connection.pseudoCityCode,
      officeId: connection.officeId,
    }
  );

  // Log outbound request
  await logMessage({
    connectionId: resolvedConnectionId,
    provider: connection.provider,
    messageType: "availability_request",
    direction: "outbound",
    correlationId,
    requestPayload,
    status: "pending",
  });

  // Simulate GDS response -- in production, make actual HTTP call to connection.baseUrl
  const simulatedResponseTimeMs = Math.floor(Math.random() * 500) + 100;

  const cabinClass = resolvedParams.cabinClass ?? "economy";
  const simulatedFlights = generateSimulatedAvailability(
    resolvedParams.origin,
    resolvedParams.destination,
    resolvedParams.departureDate,
    cabinClass,
    connection.provider
  );

  const responseTimeMs = simulatedResponseTimeMs;

  const responsePayload = JSON.stringify({
    status: "OK",
    provider: connection.provider,
    flights: simulatedFlights,
  });

  // Log inbound response
  await logMessage({
    connectionId: resolvedConnectionId,
    provider: connection.provider,
    messageType: "availability_response",
    direction: "inbound",
    correlationId,
    responsePayload,
    responseTimeMs,
    httpStatusCode: 200,
    status: "success",
  });

  console.info(
    `[GDS] Availability search via ${connection.provider}: ${resolvedParams.origin}-${resolvedParams.destination} on ${resolvedParams.departureDate} => ${simulatedFlights.length} results (${responseTimeMs}ms)`
  );

  return {
    correlationId,
    provider: connection.provider,
    flights: simulatedFlights,
    responseTimeMs,
  };
}

/**
 * Generate simulated availability results for demonstration purposes.
 */
function generateSimulatedAvailability(
  origin: string,
  destination: string,
  departureDate: string,
  cabinClass: string,
  provider: GdsProvider
): AvailabilityResult["flights"] {
  const airlineCodes: Record<GdsProvider, string[]> = {
    amadeus: ["SV", "EK", "QR", "TK"],
    sabre: ["SV", "AA", "BA", "LH"],
    travelport: ["SV", "UA", "QF", "CX"],
    travelsky: ["SV", "CA", "MU", "CZ"],
  };

  const airlines = airlineCodes[provider];
  const flightCount = Math.floor(Math.random() * 3) + 2;
  const flights: AvailabilityResult["flights"] = [];

  for (let i = 0; i < flightCount; i++) {
    const airline = airlines[i % airlines.length];
    const flightNum = Math.floor(Math.random() * 900) + 100;
    const departureHour = 6 + i * 3;
    const durationHours = Math.floor(Math.random() * 4) + 2;

    flights.push({
      flightNumber: `${airline}${flightNum}`,
      airline,
      origin,
      destination,
      departureTime: `${departureDate}T${String(departureHour).padStart(2, "0")}:00:00`,
      arrivalTime: `${departureDate}T${String(departureHour + durationHours).padStart(2, "0")}:30:00`,
      cabinClass,
      seatsAvailable: Math.floor(Math.random() * 50) + 5,
      fare: {
        amount: Math.floor(Math.random() * 200000) + 50000, // SAR cents
        currency: "SAR",
        fareClass: cabinClass === "business" ? "J" : "Y",
        fareBasis: cabinClass === "business" ? "JOWSA" : "YOWSA",
      },
      stops: Math.random() > 0.7 ? 1 : 0,
      duration: `PT${durationHours}H30M`,
    });
  }

  return flights;
}

// ============================================================================
// PNR / Booking Management
// ============================================================================

/**
 * Create a PNR (Passenger Name Record) through a GDS connection.
 * Builds provider-specific booking request, logs outbound/inbound messages,
 * and returns the PNR locator.
 */
export async function createBooking(
  connectionId: number,
  params: CreateBookingParams
): Promise<BookingResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Fetch and validate connection
  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${connectionId} not found`,
    });
  }

  assertConnectionActive(connection);
  assertConnectionCapability(connection, "booking");

  if (!params.passengers || params.passengers.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one passenger is required to create a booking",
    });
  }

  const correlationId = generateCorrelationId();
  const _startTime = Date.now();

  // Calculate ticket time limit (default: 24 hours from now)
  const ticketTimeLimit =
    params.ticketTimeLimit ??
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Build provider-specific request
  const requestPayload = buildGdsRequest(
    connection.provider,
    "booking_request",
    {
      flightNumber: params.flightNumber,
      origin: params.origin,
      destination: params.destination,
      departureDate: params.departureDate,
      cabinClass: params.cabinClass,
      fareClass: params.fareClass,
      passengers: params.passengers,
      contact: params.contact,
      ticketTimeLimit,
      pseudoCityCode: connection.pseudoCityCode,
      officeId: connection.officeId,
    }
  );

  // Log outbound request
  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "booking_request",
    direction: "outbound",
    correlationId,
    requestPayload,
    status: "pending",
  });

  // Simulate GDS booking response
  const pnrLocator = generatePnrLocator();
  const simulatedResponseTimeMs = Math.floor(Math.random() * 800) + 200;

  const bookingResult: BookingResult = {
    correlationId,
    provider: connection.provider,
    pnrLocator,
    status: "confirmed",
    segments: [
      {
        flightNumber: params.flightNumber,
        origin: params.origin,
        destination: params.destination,
        departureTime: params.departureDate,
        arrivalTime: params.departureDate, // Simplified for simulation
        cabinClass: params.cabinClass,
        fareClass: params.fareClass,
        status: "HK", // Confirmed
      },
    ],
    ticketTimeLimit,
    totalFare: {
      amount: Math.floor(Math.random() * 200000) + 50000,
      currency: "SAR",
    },
    responseTimeMs: simulatedResponseTimeMs,
  };

  const responsePayload = JSON.stringify(bookingResult);

  // Log inbound response
  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "booking_response",
    direction: "inbound",
    correlationId,
    responsePayload,
    bookingReference: pnrLocator,
    responseTimeMs: simulatedResponseTimeMs,
    httpStatusCode: 201,
    status: "success",
  });

  console.info(
    `[GDS] Booking created via ${connection.provider}: PNR=${pnrLocator}, flight=${params.flightNumber}, pax=${params.passengers.length} (${simulatedResponseTimeMs}ms)`
  );

  return bookingResult;
}

/**
 * Issue a ticket for an existing PNR through a GDS connection.
 */
export async function issueTicket(
  connectionId: number,
  pnr: string
): Promise<TicketResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Fetch and validate connection
  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${connectionId} not found`,
    });
  }

  assertConnectionActive(connection);
  assertConnectionCapability(connection, "ticketing");

  if (!pnr || pnr.length !== 6) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A valid 6-character PNR locator is required",
    });
  }

  const correlationId = generateCorrelationId();

  // Build provider-specific request
  const requestPayload = buildGdsRequest(
    connection.provider,
    "ticketing_request",
    {
      pnr,
      pseudoCityCode: connection.pseudoCityCode,
      officeId: connection.officeId,
    }
  );

  // Log outbound request
  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "ticketing_request",
    direction: "outbound",
    correlationId,
    requestPayload,
    bookingReference: pnr,
    status: "pending",
  });

  // Simulate ticketing response
  const simulatedResponseTimeMs = Math.floor(Math.random() * 600) + 300;

  const ticketResult: TicketResult = {
    correlationId,
    provider: connection.provider,
    pnrLocator: pnr,
    tickets: [
      {
        ticketNumber: generateTicketNumber(),
        passengerName: "SIMULATED/PASSENGER",
        status: "ISSUED",
      },
    ],
    responseTimeMs: simulatedResponseTimeMs,
  };

  const responsePayload = JSON.stringify(ticketResult);

  // Log inbound response
  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "ticketing_response",
    direction: "inbound",
    correlationId,
    responsePayload,
    bookingReference: pnr,
    responseTimeMs: simulatedResponseTimeMs,
    httpStatusCode: 200,
    status: "success",
  });

  console.info(
    `[GDS] Ticket issued via ${connection.provider}: PNR=${pnr}, tickets=${ticketResult.tickets.length} (${simulatedResponseTimeMs}ms)`
  );

  return ticketResult;
}

/**
 * Cancel a booking (PNR) through a GDS connection.
 */
export async function cancelBooking(
  connectionId: number,
  pnr: string
): Promise<CancelResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Fetch and validate connection
  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${connectionId} not found`,
    });
  }

  assertConnectionActive(connection);
  assertConnectionCapability(connection, "booking");

  if (!pnr || pnr.length !== 6) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A valid 6-character PNR locator is required",
    });
  }

  const correlationId = generateCorrelationId();

  // Build provider-specific request
  const requestPayload = buildGdsRequest(
    connection.provider,
    "cancel_request",
    {
      pnr,
      pseudoCityCode: connection.pseudoCityCode,
      officeId: connection.officeId,
    }
  );

  // Log outbound request
  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "cancel_request",
    direction: "outbound",
    correlationId,
    requestPayload,
    bookingReference: pnr,
    status: "pending",
  });

  // Simulate cancellation response
  const simulatedResponseTimeMs = Math.floor(Math.random() * 400) + 150;
  const cancellationReference = `CXL-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  const cancelResult: CancelResult = {
    correlationId,
    provider: connection.provider,
    pnrLocator: pnr,
    status: "cancelled",
    cancellationReference,
    responseTimeMs: simulatedResponseTimeMs,
  };

  const responsePayload = JSON.stringify(cancelResult);

  // Log inbound response
  await logMessage({
    connectionId,
    provider: connection.provider,
    messageType: "cancel_response",
    direction: "inbound",
    correlationId,
    responsePayload,
    bookingReference: pnr,
    responseTimeMs: simulatedResponseTimeMs,
    httpStatusCode: 200,
    status: "success",
  });

  console.info(
    `[GDS] Booking cancelled via ${connection.provider}: PNR=${pnr}, ref=${cancellationReference} (${simulatedResponseTimeMs}ms)`
  );

  return cancelResult;
}

// ============================================================================
// Message Log & Diagnostics
// ============================================================================

/**
 * Get GDS message history for a connection with pagination and filtering.
 *
 * Supports two calling conventions:
 * - `getMessageLog(connectionId, filters)` -- direct service call
 * - `getMessageLog(flatFilters)` -- single-object call from the router (connectionId inside)
 */
export async function getMessageLog(
  connectionIdOrFilters:
    | number
    | (MessageLogFilters & { connectionId: number }),
  filters?: MessageLogFilters
): Promise<{
  messages: GdsMessage[];
  total: number;
  page: number;
  totalPages: number;
}> {
  // Normalize arguments
  let resolvedConnectionId: number;
  let resolvedFilters: MessageLogFilters;

  if (typeof connectionIdOrFilters === "number") {
    resolvedConnectionId = connectionIdOrFilters;
    resolvedFilters = filters ?? {};
  } else {
    resolvedConnectionId = connectionIdOrFilters.connectionId;
    const { connectionId: _cid, ...rest } = connectionIdOrFilters;
    resolvedFilters = rest;
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Verify connection exists
  const [connection] = await db
    .select({ id: gdsConnections.id })
    .from(gdsConnections)
    .where(eq(gdsConnections.id, resolvedConnectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${resolvedConnectionId} not found`,
    });
  }

  const page = Math.max(1, resolvedFilters.page ?? 1);
  const limit = Math.min(100, Math.max(1, resolvedFilters.limit ?? 20));
  const offset = (page - 1) * limit;

  // Build filter conditions
  const conditions = [eq(gdsMessages.connectionId, resolvedConnectionId)];

  if (resolvedFilters.messageType) {
    conditions.push(
      eq(
        gdsMessages.messageType,
        resolvedFilters.messageType as (typeof gdsMessages.messageType.enumValues)[number]
      )
    );
  }
  if (resolvedFilters.direction) {
    conditions.push(
      eq(
        gdsMessages.direction,
        resolvedFilters.direction as (typeof gdsMessages.direction.enumValues)[number]
      )
    );
  }
  if (resolvedFilters.status) {
    conditions.push(
      eq(
        gdsMessages.status,
        resolvedFilters.status as (typeof gdsMessages.status.enumValues)[number]
      )
    );
  }
  if (resolvedFilters.correlationId) {
    conditions.push(
      eq(gdsMessages.correlationId, resolvedFilters.correlationId)
    );
  }
  if (resolvedFilters.bookingReference) {
    conditions.push(
      eq(gdsMessages.bookingReference, resolvedFilters.bookingReference)
    );
  }
  if (resolvedFilters.fromDate) {
    conditions.push(gte(gdsMessages.createdAt, resolvedFilters.fromDate));
  }
  if (resolvedFilters.toDate) {
    conditions.push(lte(gdsMessages.createdAt, resolvedFilters.toDate));
  }

  const whereClause = and(...conditions);

  // Get total count
  const [countResult] = await db
    .select({ total: count() })
    .from(gdsMessages)
    .where(whereClause);

  const total = countResult?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  // Fetch messages
  const messages = await db
    .select()
    .from(gdsMessages)
    .where(whereClause)
    .orderBy(desc(gdsMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    messages,
    total,
    page,
    totalPages,
  };
}

/**
 * Get performance and reliability statistics for a GDS connection.
 */
export async function getProviderStatistics(
  connectionId: number
): Promise<ProviderStatistics> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Verify connection exists
  const [connection] = await db
    .select()
    .from(gdsConnections)
    .where(eq(gdsConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `GDS connection with id ${connectionId} not found`,
    });
  }

  // Overall message counts by status
  const statusCounts = await db
    .select({
      status: gdsMessages.status,
      total: count(),
    })
    .from(gdsMessages)
    .where(eq(gdsMessages.connectionId, connectionId))
    .groupBy(gdsMessages.status);

  let totalMessages = 0;
  let successCount = 0;
  let errorCount = 0;
  let timeoutCount = 0;

  for (const row of statusCounts) {
    const c = Number(row.total);
    totalMessages += c;
    if (row.status === "success") successCount = c;
    if (row.status === "error") errorCount = c;
    if (row.status === "timeout") timeoutCount = c;
  }

  // Response time statistics (only for messages that have responseTimeMs)
  const responseTimeStats = await db
    .select({
      avgMs: sql<number>`COALESCE(AVG(${gdsMessages.responseTimeMs}), 0)`,
      minMs: sql<number>`COALESCE(MIN(${gdsMessages.responseTimeMs}), 0)`,
      maxMs: sql<number>`COALESCE(MAX(${gdsMessages.responseTimeMs}), 0)`,
    })
    .from(gdsMessages)
    .where(
      and(
        eq(gdsMessages.connectionId, connectionId),
        sql`${gdsMessages.responseTimeMs} IS NOT NULL`
      )
    );

  const avgResponseTimeMs = Math.round(
    Number(responseTimeStats[0]?.avgMs ?? 0)
  );
  const minResponseTimeMs = Number(responseTimeStats[0]?.minMs ?? 0);
  const maxResponseTimeMs = Number(responseTimeStats[0]?.maxMs ?? 0);

  // Messages by type
  const typeCounts = await db
    .select({
      messageType: gdsMessages.messageType,
      total: count(),
    })
    .from(gdsMessages)
    .where(eq(gdsMessages.connectionId, connectionId))
    .groupBy(gdsMessages.messageType);

  const messagesByType: Record<string, number> = {};
  for (const row of typeCounts) {
    messagesByType[row.messageType] = Number(row.total);
  }

  // Last 24h volume and error rate
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const last24hCounts = await db
    .select({
      status: gdsMessages.status,
      total: count(),
    })
    .from(gdsMessages)
    .where(
      and(
        eq(gdsMessages.connectionId, connectionId),
        gte(gdsMessages.createdAt, last24h)
      )
    )
    .groupBy(gdsMessages.status);

  let last24hVolume = 0;
  let last24hErrors = 0;

  for (const row of last24hCounts) {
    const c = Number(row.total);
    last24hVolume += c;
    if (row.status === "error" || row.status === "timeout") {
      last24hErrors += c;
    }
  }

  const successRate =
    totalMessages > 0 ? (successCount / totalMessages) * 100 : 0;
  const last24hErrorRate =
    last24hVolume > 0 ? (last24hErrors / last24hVolume) * 100 : 0;

  return {
    connectionId,
    provider: connection.provider,
    totalMessages,
    successCount,
    errorCount,
    timeoutCount,
    successRate: Math.round(successRate * 100) / 100,
    avgResponseTimeMs,
    minResponseTimeMs,
    maxResponseTimeMs,
    messagesByType,
    last24hVolume,
    last24hErrorRate: Math.round(last24hErrorRate * 100) / 100,
  };
}

// ============================================================================
// Router Compatibility Wrappers
// ============================================================================
// The tRPC router (server/routers/gds.ts) calls some service functions using
// single-object signatures. These wrappers adapt those calls to the canonical
// function signatures above.

/**
 * Router-compatible passenger schema (the router sends a slightly different shape).
 */
export interface RouterPassenger {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "male" | "female";
  passportNumber?: string;
  nationality?: string;
  email?: string;
  phone?: string;
}

/**
 * Router-compatible wrapper for createBooking.
 * Accepts a single object with connectionId embedded alongside booking params.
 * Adapts the router's passenger schema to the canonical CreateBookingParams format.
 */
export async function createGdsBooking(params: {
  connectionId: number;
  flightNumber: string;
  departureDate: string;
  passengers: RouterPassenger[];
  cabinClass: string;
  userId?: number;
}): Promise<BookingResult> {
  // Adapt router's passenger format to canonical format
  const adaptedPassengers: CreateBookingParams["passengers"] =
    params.passengers.map(p => ({
      type: "ADT" as const,
      title: p.gender === "male" ? "MR" : "MS",
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      passportNumber: p.passportNumber,
      nationality: p.nationality,
    }));

  return await createBooking(params.connectionId, {
    flightNumber: params.flightNumber,
    origin: "",
    destination: "",
    departureDate: params.departureDate,
    cabinClass: params.cabinClass,
    fareClass: params.cabinClass === "business" ? "J" : "Y",
    passengers: adaptedPassengers,
    contact: {
      email: params.passengers[0]?.email ?? "",
      phone: params.passengers[0]?.phone ?? "",
    },
  });
}

/**
 * Router-compatible wrapper for getProviderStatistics.
 * Accepts a single object with connectionId and optional date range.
 */
export async function getStatistics(params: {
  connectionId: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<ProviderStatistics> {
  return await getProviderStatistics(params.connectionId);
}
