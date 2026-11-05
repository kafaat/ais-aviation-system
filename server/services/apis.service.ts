import { generatePAXLST } from "./apis-paxlst";
import { generatePNRGOV } from "./apis-pnrgov";
import { isValidTimeZone } from "./civil-day";
import { manifestBookingCondition } from "./flight-state.service";
/**
 * Advance Passenger Information System (APIS) Service
 *
 * Handles collection, validation, and submission of passenger travel
 * document information to destination country authorities. Supports
 * UN/EDIFACT PAXLST and APIS PNR/GOV message formats.
 */

import { getDb } from "../db";
import {
  flights,
  bookings,
  passengers,
  airports,
  airlines,
} from "../../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export type APISDocumentType = "passport" | "national_id" | "visa";

export type APISDataStatus =
  | "incomplete"
  | "complete"
  | "validated"
  | "submitted"
  | "rejected";

export type APISSubmissionStatus =
  | "pending"
  | "submitted"
  | "acknowledged"
  | "rejected"
  | "error";

export type APISMessageFormat = "paxlst" | "pnrgov";

export interface APISData {
  id: number;
  passengerId: number;
  bookingId: number;
  documentType: APISDocumentType;
  documentNumber: string;
  issuingCountry: string;
  nationality: string;
  dateOfBirth: Date | string;
  gender: "M" | "F" | "U";
  expiryDate: Date | string;
  givenNames: string;
  surname: string;
  residenceCountry: string | null;
  residenceAddress: string | null;
  destinationAddress: string | null;
  redressNumber: string | null;
  knownTravelerNumber: string | null;
  status: APISDataStatus;
  validatedAt: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface APISSubmission {
  id: number;
  flightId: number;
  destinationCountry: string;
  format: APISMessageFormat;
  messageContent: string;
  submissionTime: Date | null;
  acknowledgmentTime: Date | null;
  status: APISSubmissionStatus;
  responseMessage: string | null;
  createdAt: Date;
}

export interface APISRequirement {
  id: number;
  originCountry: string;
  destinationCountry: string;
  requiredFields: string[];
  submissionDeadlineMinutes: number;
  format: APISMessageFormat;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectPassengerInfoInput {
  documentType: APISDocumentType;
  documentNumber: string;
  issuingCountry: string;
  nationality: string;
  dateOfBirth: string;
  gender: "M" | "F" | "U";
  expiryDate: string;
  givenNames: string;
  surname: string;
  residenceCountry?: string;
  residenceAddress?: string;
  destinationAddress?: string;
  redressNumber?: string;
  knownTravelerNumber?: string;
}

// ============================================================================
// Country-specific APIS required fields
// ============================================================================

const DEFAULT_REQUIRED_FIELDS = [
  "documentType",
  "documentNumber",
  "issuingCountry",
  "nationality",
  "dateOfBirth",
  "gender",
  "expiryDate",
  "givenNames",
  "surname",
];

const ENHANCED_REQUIRED_FIELDS = [
  ...DEFAULT_REQUIRED_FIELDS,
  "residenceCountry",
  "residenceAddress",
  "destinationAddress",
];

/**
 * Default requirements when no specific rule exists for a route.
 * US/UK/CA/AU require enhanced fields including address information.
 */
const DEFAULT_REQUIREMENTS: Record<
  string,
  { fields: string[]; deadlineMinutes: number; format: APISMessageFormat }
> = {
  US: {
    fields: [...ENHANCED_REQUIRED_FIELDS, "redressNumber"],
    deadlineMinutes: 60,
    format: "paxlst",
  },
  GB: {
    fields: ENHANCED_REQUIRED_FIELDS,
    deadlineMinutes: 60,
    format: "paxlst",
  },
  CA: {
    fields: ENHANCED_REQUIRED_FIELDS,
    deadlineMinutes: 72 * 60,
    format: "paxlst",
  },
  AU: {
    fields: ENHANCED_REQUIRED_FIELDS,
    deadlineMinutes: 72 * 60,
    format: "paxlst",
  },
  DEFAULT: {
    fields: DEFAULT_REQUIRED_FIELDS,
    deadlineMinutes: 30,
    format: "paxlst",
  },
};

// ============================================================================
// Helper: get DB or throw
// ============================================================================

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

// ============================================================================
// APIS Data Collection
// ============================================================================

/**
 * Collect or update APIS (travel document) information for a passenger.
 * Creates a new record or updates an existing one, resetting validation status.
 */
export async function collectPassengerInfo(
  passengerId: number,
  data: CollectPassengerInfoInput
) {
  const database = await requireDb();
  return database.transaction(async db => {
    // Verify passenger exists and get booking info
    const [passenger] = await db
      .select({
        id: passengers.id,
        bookingId: passengers.bookingId,
        firstName: passengers.firstName,
        lastName: passengers.lastName,
      })
      .from(passengers)
      .where(eq(passengers.id, passengerId))
      .limit(1);

    if (!passenger) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Passenger not found",
      });
    }

    await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, passenger.bookingId))
      .for("update");

    // Check for existing APIS data
    const [existing] = await db
      .select({ id: sql<number>`id` })
      .from(sql`apis_data`)
      .where(sql`passenger_id = ${passengerId}`)
      .limit(1);

    const now = new Date();

    if (existing) {
      // Update existing record
      await db.execute(sql`
      UPDATE apis_data SET
        document_type = ${data.documentType},
        document_number = ${data.documentNumber},
        issuing_country = ${data.issuingCountry},
        nationality = ${data.nationality},
        date_of_birth = ${data.dateOfBirth},
        gender = ${data.gender},
        expiry_date = ${data.expiryDate},
        given_names = ${data.givenNames},
        surname = ${data.surname},
        residence_country = ${data.residenceCountry ?? null},
        residence_address = ${data.residenceAddress ?? null},
        destination_address = ${data.destinationAddress ?? null},
        redress_number = ${data.redressNumber ?? null},
        known_traveler_number = ${data.knownTravelerNumber ?? null},
        status = 'complete',
        validated_at = NULL,
        submitted_at = NULL,
        updated_at = ${now}
      WHERE id = ${existing.id}
    `);

      return {
        id: existing.id,
        passengerId,
        bookingId: passenger.bookingId,
        status: "complete" as APISDataStatus,
        message: "APIS data updated successfully",
      };
    }

    // Insert new record
    const [result] = await db.execute(sql`
    INSERT INTO apis_data (
      passenger_id, booking_id, document_type, document_number,
      issuing_country, nationality, date_of_birth, gender,
      expiry_date, given_names, surname, residence_country,
      residence_address, destination_address, redress_number,
      known_traveler_number, status, created_at, updated_at
    ) VALUES (
      ${passengerId}, ${passenger.bookingId}, ${data.documentType},
      ${data.documentNumber}, ${data.issuingCountry}, ${data.nationality},
      ${data.dateOfBirth}, ${data.gender}, ${data.expiryDate},
      ${data.givenNames}, ${data.surname},
      ${data.residenceCountry ?? null}, ${data.residenceAddress ?? null},
      ${data.destinationAddress ?? null}, ${data.redressNumber ?? null},
      ${data.knownTravelerNumber ?? null}, 'complete', ${now}, ${now}
    )
  `);

    return {
      id: Number((result as { insertId: number }).insertId),
      passengerId,
      bookingId: passenger.bookingId,
      status: "complete" as APISDataStatus,
      message: "APIS data collected successfully",
    };
  });
}

// ============================================================================
// APIS Data Validation
// ============================================================================

/**
 * Validate the completeness and format of APIS data for a passenger.
 * Checks required fields, document expiry, and data format.
 */
export async function validateAPISData(passengerId: number) {
  const database = await requireDb();
  return database.transaction(async db => {
    // Keep validation bound to the document that was read. A competing collection
    // waits for this row lock, then resets validation for its replacement document.
    const rows = await db.execute(sql`
    SELECT apis_data.*,
      CAST(date_of_birth AS CHAR) AS date_of_birth,
      CAST(expiry_date AS CHAR) AS expiry_date
    FROM apis_data WHERE passenger_id = ${passengerId} LIMIT 1 FOR UPDATE
  `);

    const apisRows = (
      rows as unknown as Array<Array<Record<string, unknown>>>
    )[0];
    if (!apisRows || apisRows.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "No APIS data found for this passenger. Please submit travel document information first.",
      });
    }

    const apisData = apisRows[0];
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required base fields
    const requiredFields: Array<{ key: string; label: string }> = [
      { key: "document_type", label: "Document type" },
      { key: "document_number", label: "Document number" },
      { key: "issuing_country", label: "Issuing country" },
      { key: "nationality", label: "Nationality" },
      { key: "date_of_birth", label: "Date of birth" },
      { key: "gender", label: "Gender" },
      { key: "expiry_date", label: "Document expiry date" },
      { key: "given_names", label: "Given names" },
      { key: "surname", label: "Surname" },
    ];

    for (const field of requiredFields) {
      const value = apisData[field.key];
      if (!value || (typeof value === "string" && !value.trim())) {
        errors.push(`${field.label} is required`);
      }
    }

    // Validate document number format (alphanumeric, 5-20 chars)
    const docNumber = apisData["document_number"] as string | null;
    if (docNumber && !/^[A-Za-z0-9]{5,20}$/.test(docNumber)) {
      errors.push("Document number must be 5-20 alphanumeric characters");
    }

    // Validate country codes (ISO 3166-1 alpha-2 or alpha-3)
    const countryFields = [
      "issuing_country",
      "nationality",
      "residence_country",
    ];
    for (const field of countryFields) {
      const value = apisData[field] as string | null;
      if (value && !/^[A-Z]{2,3}$/.test(value)) {
        errors.push(
          `${field.replace(/_/g, " ")} must be a valid ISO country code (2-3 uppercase letters)`
        );
      }
    }

    // Validate gender
    const gender = apisData["gender"] as string | null;
    if (gender && !["M", "F", "U"].includes(gender)) {
      errors.push("Gender must be M (Male), F (Female), or U (Undisclosed)");
    }

    // SQL DATE values are civil dates, not instants. Read the original characters
    // so mysql2 cannot normalize an impossible legacy date before validation.
    // Compare both at UTC day precision: expiry after today, birth no later than today.
    // Admission still requires a separate sourced operator clearance.
    const today = new Date().toISOString().slice(0, 10);
    const calendarDate = z.iso.date();
    const expiryDate = calendarDate.safeParse(apisData["expiry_date"]);
    if (apisData["expiry_date"]) {
      if (!expiryDate.success) {
        errors.push("Document expiry date must be a valid calendar date");
      } else if (expiryDate.data <= today) {
        errors.push("Travel document has expired");
      } else {
        warnings.push(
          "Format validation does not determine admission; current itinerary-specific operator document clearance is required."
        );
      }
    }

    const dob = calendarDate.safeParse(apisData["date_of_birth"]);
    if (apisData["date_of_birth"]) {
      if (!dob.success) {
        errors.push("Date of birth must be a valid calendar date");
      } else if (dob.data > today) {
        errors.push("Date of birth cannot be in the future");
      }
    }

    const isValid = errors.length === 0;

    // Update status if valid
    if (isValid) {
      await db.execute(sql`
      UPDATE apis_data
      SET status = 'validated', validated_at = ${new Date()}, updated_at = ${new Date()}
      WHERE passenger_id = ${passengerId}
    `);
    }

    return {
      passengerId,
      valid: isValid,
      status: isValid
        ? ("validated" as APISDataStatus)
        : ("complete" as APISDataStatus),
      errors,
      warnings,
      validatedAt: isValid ? new Date().toISOString() : null,
    };
  });
}

// ============================================================================
// Travel Document Validity Check
// ============================================================================

/**
 * Check travel document validity against basic rules:
 * - Document not expired
 * - Sufficient validity remaining for destination country
 * - Document number format check
 */
export async function checkTravelDocValidity(
  documentNumber: string,
  nationality: string,
  destination: string
) {
  const db = await requireDb();

  // Look up the document in our APIS records
  const rows = await db.execute(sql`
    SELECT * FROM apis_data
    WHERE document_number = ${documentNumber}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const apisRows = (
    rows as unknown as Array<Array<Record<string, unknown>>>
  )[0];
  const apisData = apisRows?.[0] ?? null;

  const issues: string[] = [];
  const recommendations: string[] = [];

  if (!apisData) {
    return {
      documentNumber,
      found: false,
      valid: false,
      issues: ["Document not found in APIS records"],
      recommendations: [
        "Please submit your travel document information through the APIS form",
      ],
    };
  }

  const expiryDate = apisData["expiry_date"]
    ? new Date(apisData["expiry_date"] as string)
    : null;
  const now = new Date();

  // Check expiry
  if (!expiryDate) {
    issues.push("No expiry date on record");
  } else if (expiryDate <= now) {
    issues.push("Document has expired");
  } else {
    issues.push(
      `Current itinerary-specific document review is required for ${destination}`
    );
  }

  // Nationality check
  const recordedNationality = apisData["nationality"] as string | null;
  if (recordedNationality && recordedNationality !== nationality) {
    issues.push(
      `Nationality mismatch: record shows ${recordedNationality}, provided ${nationality}`
    );
  }

  return {
    documentNumber,
    found: true,
    valid: issues.length === 0,
    expiryDate: expiryDate?.toISOString() ?? null,
    nationality: recordedNationality,
    issues,
    recommendations,
  };
}

// ============================================================================
// APIS Requirements
// ============================================================================

/**
 * Get APIS required fields for a specific route (origin -> destination country).
 * Returns required fields, submission deadline, and message format.
 */
export async function getAPISRequirements(
  originCountry: string,
  destinationCountry: string
) {
  const db = await requireDb();

  // Check for route-specific requirements in DB
  const rows = await db.execute(sql`
    SELECT * FROM apis_requirements
    WHERE origin_country = ${originCountry}
      AND destination_country = ${destinationCountry}
      AND is_active = true
    LIMIT 1
  `);

  const reqRows = (rows as unknown as Array<Array<Record<string, unknown>>>)[0];
  if (reqRows && reqRows.length > 0) {
    const req = reqRows[0];
    let requiredFields: string[];
    try {
      requiredFields = JSON.parse(req["required_fields"] as string) as string[];
    } catch {
      requiredFields = DEFAULT_REQUIRED_FIELDS;
    }

    return {
      originCountry,
      destinationCountry,
      requiredFields,
      submissionDeadlineMinutes: req["submission_deadline_minutes"] as number,
      format: req["format"] as APISMessageFormat,
      source: "database" as const,
    };
  }

  // Fall back to defaults
  const destDefaults =
    DEFAULT_REQUIREMENTS[destinationCountry] ?? DEFAULT_REQUIREMENTS.DEFAULT;

  return {
    originCountry,
    destinationCountry,
    requiredFields: destDefaults.fields,
    submissionDeadlineMinutes: destDefaults.deadlineMinutes,
    format: destDefaults.format,
    source: "default" as const,
  };
}

// ============================================================================
// APIS Status Checks
// ============================================================================

/**
 * Get APIS submission status for all passengers on a flight.
 */
export async function getFlightAPISStatus(flightId: number) {
  const db = await requireDb();

  // Verify flight exists
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get all confirmed passengers for this flight
  const flightPassengers = await db
    .select({
      passengerId: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(manifestBookingCondition(flightId));

  if (flightPassengers.length === 0) {
    return {
      flightId,
      flightNumber: flight.flightNumber,
      departureTime: flight.departureTime,
      totalPassengers: 0,
      passengerStatuses: [],
      summary: {
        incomplete: 0,
        complete: 0,
        validated: 0,
        submitted: 0,
        rejected: 0,
      },
      readyForSubmission: false,
    };
  }

  // Get APIS status for each passenger
  const passengerIds = flightPassengers.map(p => p.passengerId);
  const apisRows = await db.execute(sql`
    SELECT passenger_id, status, validated_at, submitted_at
    FROM apis_data
    WHERE passenger_id IN (${sql.join(
      passengerIds.map(id => sql`${id}`),
      sql`, `
    )})
  `);

  const apisStatusMap = new Map<
    number,
    { status: string; validatedAt: string | null; submittedAt: string | null }
  >();
  const apisResults = (
    apisRows as unknown as Array<Array<Record<string, unknown>>>
  )[0];
  if (apisResults) {
    for (const row of apisResults) {
      apisStatusMap.set(row["passenger_id"] as number, {
        status: row["status"] as string,
        validatedAt: row["validated_at"]
          ? new Date(row["validated_at"] as string).toISOString()
          : null,
        submittedAt: row["submitted_at"]
          ? new Date(row["submitted_at"] as string).toISOString()
          : null,
      });
    }
  }

  const passengerStatuses = flightPassengers.map(p => {
    const apisStatus = apisStatusMap.get(p.passengerId);
    return {
      passengerId: p.passengerId,
      name: `${p.firstName} ${p.lastName}`,
      bookingReference: p.bookingReference,
      pnr: p.pnr,
      apisStatus: (apisStatus?.status ?? "incomplete") as APISDataStatus,
      validatedAt: apisStatus?.validatedAt ?? null,
      submittedAt: apisStatus?.submittedAt ?? null,
    };
  });

  const summary = {
    incomplete: passengerStatuses.filter(p => p.apisStatus === "incomplete")
      .length,
    complete: passengerStatuses.filter(p => p.apisStatus === "complete").length,
    validated: passengerStatuses.filter(p => p.apisStatus === "validated")
      .length,
    submitted: passengerStatuses.filter(p => p.apisStatus === "submitted")
      .length,
    rejected: passengerStatuses.filter(p => p.apisStatus === "rejected").length,
  };

  return {
    flightId,
    flightNumber: flight.flightNumber,
    departureTime: flight.departureTime,
    totalPassengers: flightPassengers.length,
    passengerStatuses,
    summary,
    readyForSubmission:
      summary.incomplete === 0 &&
      summary.rejected === 0 &&
      summary.complete === 0,
  };
}

/**
 * Get APIS status for an individual passenger.
 */
export async function getPassengerAPISStatus(passengerId: number) {
  const db = await requireDb();

  // Get passenger info
  const [passenger] = await db
    .select({
      id: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      bookingId: passengers.bookingId,
    })
    .from(passengers)
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found",
    });
  }

  // Get APIS data
  const rows = await db.execute(sql`
    SELECT * FROM apis_data WHERE passenger_id = ${passengerId} LIMIT 1
  `);

  const apisRows = (
    rows as unknown as Array<Array<Record<string, unknown>>>
  )[0];
  const apisData = apisRows?.[0] ?? null;

  if (!apisData) {
    return {
      passengerId,
      passengerName: `${passenger.firstName} ${passenger.lastName}`,
      bookingId: passenger.bookingId,
      hasData: false,
      status: "incomplete" as APISDataStatus,
      data: null,
      completeness: 0,
      missingFields: DEFAULT_REQUIRED_FIELDS,
    };
  }

  // Calculate completeness
  const allFields = [
    "document_type",
    "document_number",
    "issuing_country",
    "nationality",
    "date_of_birth",
    "gender",
    "expiry_date",
    "given_names",
    "surname",
    "residence_country",
    "residence_address",
    "destination_address",
    "redress_number",
    "known_traveler_number",
  ];

  const filledFields = allFields.filter(
    f => apisData[f] !== null && apisData[f] !== ""
  );
  const missingRequired = DEFAULT_REQUIRED_FIELDS.filter(f => {
    const dbKey = f.replace(/([A-Z])/g, "_$1").toLowerCase();
    return !apisData[dbKey] || apisData[dbKey] === "";
  });

  return {
    passengerId,
    passengerName: `${passenger.firstName} ${passenger.lastName}`,
    bookingId: passenger.bookingId,
    hasData: true,
    status: apisData["status"] as APISDataStatus,
    data: {
      documentType: apisData["document_type"] as string,
      documentNumber: apisData["document_number"] as string,
      issuingCountry: apisData["issuing_country"] as string,
      nationality: apisData["nationality"] as string,
      dateOfBirth: apisData["date_of_birth"]
        ? new Date(apisData["date_of_birth"] as string).toISOString()
        : null,
      gender: apisData["gender"] as string,
      expiryDate: apisData["expiry_date"]
        ? new Date(apisData["expiry_date"] as string).toISOString()
        : null,
      givenNames: apisData["given_names"] as string,
      surname: apisData["surname"] as string,
      residenceCountry: apisData["residence_country"] as string | null,
      residenceAddress: apisData["residence_address"] as string | null,
      destinationAddress: apisData["destination_address"] as string | null,
      redressNumber: apisData["redress_number"] as string | null,
      knownTravelerNumber: apisData["known_traveler_number"] as string | null,
    },
    completeness: Math.round((filledFields.length / allFields.length) * 100),
    missingFields: missingRequired,
    validatedAt: apisData["validated_at"]
      ? new Date(apisData["validated_at"] as string).toISOString()
      : null,
    submittedAt: apisData["submitted_at"]
      ? new Date(apisData["submitted_at"] as string).toISOString()
      : null,
  };
}

// ============================================================================
// Flag Incomplete Passengers
// ============================================================================

/**
 * List passengers with incomplete or missing APIS data for a flight.
 */
export async function flagIncompletePassengers(flightId: number) {
  const db = await requireDb();

  // Verify flight
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get all confirmed passengers
  const flightPassengers = await db
    .select({
      passengerId: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(manifestBookingCondition(flightId));

  if (flightPassengers.length === 0) {
    return {
      flightId,
      flightNumber: flight.flightNumber,
      incompletePassengers: [],
      totalPassengers: 0,
      incompleteCount: 0,
    };
  }

  const passengerIds = flightPassengers.map(p => p.passengerId);

  // Get APIS data for these passengers
  const apisRows = await db.execute(sql`
    SELECT passenger_id, status
    FROM apis_data
    WHERE passenger_id IN (${sql.join(
      passengerIds.map(id => sql`${id}`),
      sql`, `
    )})
  `);

  const apisStatusMap = new Map<number, string>();
  const apisResults = (
    apisRows as unknown as Array<Array<Record<string, unknown>>>
  )[0];
  if (apisResults) {
    for (const row of apisResults) {
      apisStatusMap.set(row["passenger_id"] as number, row["status"] as string);
    }
  }

  // Find incomplete passengers (no data or status is incomplete/rejected)
  const incompletePassengers = flightPassengers
    .filter(p => {
      const status = apisStatusMap.get(p.passengerId);
      return !status || status === "incomplete" || status === "rejected";
    })
    .map(p => ({
      passengerId: p.passengerId,
      name: `${p.firstName} ${p.lastName}`,
      bookingReference: p.bookingReference,
      pnr: p.pnr,
      reason: !apisStatusMap.has(p.passengerId)
        ? "No APIS data submitted"
        : apisStatusMap.get(p.passengerId) === "rejected"
          ? "APIS data was rejected"
          : "APIS data is incomplete",
    }));

  return {
    flightId,
    flightNumber: flight.flightNumber,
    incompletePassengers,
    totalPassengers: flightPassengers.length,
    incompleteCount: incompletePassengers.length,
  };
}

// ============================================================================
// APIS Message Generation
// ============================================================================

/**
 * Generate APIS message in PAXLST (UN/EDIFACT) or PNR/GOV format.
 * The message contains passenger and travel document data for the entire flight.
 */
export async function generateAPISMessage(
  flightId: number,
  format: APISMessageFormat,
  tenantId: number | null
) {
  if (!tenantId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A tenant context is required for passenger message drafts",
    });
  const db = await requireDb();

  // Get flight details with airports
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      originId: flights.originId,
      destinationId: flights.destinationId,
      airlineId: flights.airlineId,
    })
    .from(flights)
    .where(and(eq(flights.id, flightId), eq(flights.tenantId, tenantId)))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get origin and destination airports
  const [origin] = await db
    .select({
      code: airports.code,
      country: airports.country,
      timezone: airports.timezone,
    })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);

  const [destination] = await db
    .select({
      code: airports.code,
      country: airports.country,
      timezone: airports.timezone,
    })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  const [airline] = await db
    .select({ code: airlines.code, name: airlines.name })
    .from(airlines)
    .where(eq(airlines.id, flight.airlineId))
    .limit(1);

  // Get all validated APIS data for passengers on this flight
  const passengerData = await db
    .select({
      passengerId: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      bookingReference: bookings.bookingReference,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        manifestBookingCondition(flightId),
        eq(bookings.tenantId, tenantId),
        eq(passengers.tenantId, tenantId)
      )
    );

  const passengerIds = passengerData.map(p => p.passengerId);

  if (passengerIds.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No confirmed passengers on this flight",
    });
  }

  // Get APIS records for these passengers
  const apisRows = await db.execute(sql`
    SELECT * FROM apis_data
    WHERE passenger_id IN (${sql.join(
      passengerIds.map(id => sql`${id}`),
      sql`, `
    )})
    AND status IN ('validated', 'submitted')
  `);

  const apisResults =
    (apisRows as unknown as Array<Array<Record<string, unknown>>>)[0] ?? [];

  const apisMap = new Map<number, Record<string, unknown>>();
  for (const row of apisResults) {
    apisMap.set(row["passenger_id"] as number, row);
  }

  let messageContent: string;

  if (format === "paxlst") {
    const authorityRecipient = process.env.AIS_PAXLST_DRAFT_RECIPIENT?.trim();
    if (
      !authorityRecipient ||
      !origin ||
      !destination ||
      !airline ||
      !isValidTimeZone(origin.timezone) ||
      !isValidTimeZone(destination.timezone)
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "PAXLST requires an AIS_PAXLST_DRAFT_RECIPIENT, carrier and route airports with valid time zones.",
      });
    }
    messageContent = generatePAXLST({
      authorityRecipient,
      flight,
      origin: {
        code: origin.code,
        country: origin.country,
        timezone: origin.timezone,
      },
      destination: {
        code: destination.code,
        country: destination.country,
        timezone: destination.timezone,
      },
      airline,
      passengers: passengerData,
      apisMap,
    });
  } else {
    const authorityRecipient = process.env.AIS_PNRGOV_DRAFT_RECIPIENT?.trim();
    if (
      !origin ||
      !destination ||
      !airline ||
      !authorityRecipient ||
      !isValidTimeZone(origin.timezone) ||
      !isValidTimeZone(destination.timezone)
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "PNRGOV requires carrier, route time zones and an operator-approved AIS_PNRGOV_DRAFT_RECIPIENT. A country code is not an authority address.",
      });
    }
    const pnrgovOrigin = {
      code: origin.code,
      country: origin.country,
      timezone: origin.timezone,
    };
    const pnrgovDestination = {
      code: destination.code,
      country: destination.country,
      timezone: destination.timezone,
    };
    messageContent = generatePNRGOV({
      flight,
      origin: pnrgovOrigin,
      destination: pnrgovDestination,
      airline,
      authorityRecipient,
      passengers: passengerData,
      apisMap,
    });
  }

  return {
    flightId,
    flightNumber: flight.flightNumber,
    format,
    messageContent,
    passengerCount: passengerData.length,
    validatedCount: apisResults.length,
    missingCount: passengerData.length - apisResults.length,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Submit to Authorities
// ============================================================================

/**
 * Submit APIS data to destination country authorities.
 * Generates the appropriate message and records the submission.
 */
// Stays async with nothing to await: the synchronous validation throw below
// must reach callers as a rejection, not as a synchronous throw.
// eslint-disable-next-line require-await
export async function submitToAuthorities(
  flightId: number,
  destination: string
): Promise<{
  submissionId: number;
  flightId: number;
  flightNumber: string;
  destinationCountry: string;
  format: "paxlst" | "pnrgov";
  status: APISSubmissionStatus;
  submittedAt: string;
  passengerCount: number;
  validatedCount: number;
}> {
  // Message generation is available separately. A stored draft is not evidence
  // of transmission or acceptance by a border authority. No certified transport
  // adapter is installed in this deployment.
  void flightId;
  void destination;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "APIS authority submission is unavailable: configure and validate the destination authority transport and acknowledgment contract. Generate a draft for review instead.",
  });
}

/** A data-completeness flag is not evidence of an available authority link.
 * Keep this aligned with the deliberately unavailable submission action above.
 */
export function getAuthoritySubmissionCapability() {
  return {
    available: false,
    reason: "authority_transport_unavailable" as const,
  };
}

// ============================================================================
// Get Submissions
// ============================================================================

/**
 * Get all APIS submissions for a flight.
 */
export async function getFlightSubmissions(flightId: number) {
  const db = await requireDb();

  const rows = await db.execute(sql`
    SELECT * FROM apis_submissions
    WHERE flight_id = ${flightId}
    ORDER BY created_at DESC
  `);

  const submissions =
    (rows as unknown as Array<Array<Record<string, unknown>>>)[0] ?? [];

  return submissions.map(s => ({
    id: s["id"] as number,
    flightId: s["flight_id"] as number,
    destinationCountry: s["destination_country"] as string,
    format: s["format"] as APISMessageFormat,
    submissionTime: s["submission_time"]
      ? new Date(s["submission_time"] as string).toISOString()
      : null,
    acknowledgmentTime: s["acknowledgment_time"]
      ? new Date(s["acknowledgment_time"] as string).toISOString()
      : null,
    status: s["status"] as APISSubmissionStatus,
    responseMessage: s["response_message"] as string | null,
    createdAt: new Date(s["created_at"] as string).toISOString(),
  }));
}
