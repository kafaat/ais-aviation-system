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
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

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
  const db = await requireDb();

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
}

// ============================================================================
// APIS Data Validation
// ============================================================================

/**
 * Validate the completeness and format of APIS data for a passenger.
 * Checks required fields, document expiry, and data format.
 */
export async function validateAPISData(passengerId: number) {
  const db = await requireDb();

  // Get APIS data
  const rows = await db.execute(sql`
    SELECT * FROM apis_data WHERE passenger_id = ${passengerId} LIMIT 1
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
    if (!apisData[field.key]) {
      errors.push(`${field.label} is required`);
    }
  }

  // Validate document number format (alphanumeric, 5-20 chars)
  const docNumber = apisData["document_number"] as string | null;
  if (docNumber && !/^[A-Za-z0-9]{5,20}$/.test(docNumber)) {
    errors.push("Document number must be 5-20 alphanumeric characters");
  }

  // Validate country codes (ISO 3166-1 alpha-2 or alpha-3)
  const countryFields = ["issuing_country", "nationality", "residence_country"];
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

  // Validate document expiry (must be in the future, at least 6 months)
  const expiryDate = apisData["expiry_date"]
    ? new Date(apisData["expiry_date"] as string)
    : null;
  if (expiryDate) {
    const now = new Date();
    if (expiryDate <= now) {
      errors.push("Travel document has expired");
    } else {
      const sixMonthsFromNow = new Date();
      sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
      if (expiryDate < sixMonthsFromNow) {
        warnings.push(
          "Travel document expires within 6 months. Some countries may deny entry."
        );
      }
    }
  }

  // Validate date of birth is in the past
  const dob = apisData["date_of_birth"]
    ? new Date(apisData["date_of_birth"] as string)
    : null;
  if (dob && dob >= new Date()) {
    errors.push("Date of birth must be in the past");
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
    // Check destination-specific validity requirements
    const _destRequirements =
      DEFAULT_REQUIREMENTS[destination] ?? DEFAULT_REQUIREMENTS.DEFAULT;
    const requiredMonths = destination === "US" || destination === "CA" ? 6 : 3;
    const minExpiryDate = new Date();
    minExpiryDate.setMonth(minExpiryDate.getMonth() + requiredMonths);

    if (expiryDate < minExpiryDate) {
      issues.push(
        `Document must be valid for at least ${requiredMonths} months beyond travel date for ${destination}`
      );
    }

    // Check if destination requires visa for this nationality
    if (
      nationality !== destination &&
      ["US", "GB", "CA", "AU"].includes(destination)
    ) {
      recommendations.push(
        `Verify visa requirements for ${nationality} nationals traveling to ${destination}`
      );
    }
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
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

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
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

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
  format: APISMessageFormat
) {
  const db = await requireDb();

  // Get flight details with airports
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get origin and destination airports
  const [flightRoute] = await db
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
      airlineId: flights.airlineId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  const [origin] = await db
    .select({ code: airports.code, country: airports.country })
    .from(airports)
    .where(eq(airports.id, flightRoute.originId))
    .limit(1);

  const [destination] = await db
    .select({ code: airports.code, country: airports.country })
    .from(airports)
    .where(eq(airports.id, flightRoute.destinationId))
    .limit(1);

  const [airline] = await db
    .select({ code: airlines.code, name: airlines.name })
    .from(airlines)
    .where(eq(airlines.id, flightRoute.airlineId))
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
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
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
    messageContent = generatePAXLST({
      flight,
      origin: origin ?? { code: "???", country: "??" },
      destination: destination ?? { code: "???", country: "??" },
      airline: airline ?? { code: "??", name: "Unknown" },
      passengers: passengerData,
      apisMap,
    });
  } else {
    messageContent = generatePNRGOV({
      flight,
      origin: origin ?? { code: "???", country: "??" },
      destination: destination ?? { code: "???", country: "??" },
      airline: airline ?? { code: "??", name: "Unknown" },
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
// PAXLST Message Builder (UN/EDIFACT format)
// ============================================================================

function generatePAXLST(data: {
  flight: {
    id: number;
    flightNumber: string;
    departureTime: Date;
    arrivalTime: Date;
  };
  origin: { code: string; country: string };
  destination: { code: string; country: string };
  airline: { code: string; name: string };
  passengers: Array<{
    passengerId: number;
    firstName: string;
    lastName: string;
    bookingReference: string;
  }>;
  apisMap: Map<number, Record<string, unknown>>;
}): string {
  const { flight, origin, destination, airline, passengers, apisMap } = data;

  const now = new Date();
  const dateStr = formatEdifactDate(now);
  const timeStr = formatEdifactTime(now);
  const depDate = formatEdifactDate(flight.departureTime);
  const depTime = formatEdifactTime(flight.departureTime);

  const lines: string[] = [];

  // UNB - Interchange Header
  lines.push(
    `UNB+UNOA:4+${airline.code}+${destination.country}GOVT+${dateStr}:${timeStr}+${flight.id}++APIS'`
  );

  // UNH - Message Header
  lines.push(`UNH+1+PAXLST:D:05B:UN:IATA+${flight.id}+01:F'`);

  // BGM - Beginning of Message
  lines.push(`BGM+745'`);

  // NAD - Name and Address (carrier)
  lines.push(`NAD+MS+++${airline.name}'`);

  // TDT - Transport Information
  lines.push(`TDT+20+${flight.flightNumber}+++${airline.code}'`);

  // LOC - Origin
  lines.push(`LOC+125+${origin.code}'`);

  // DTM - Departure time
  lines.push(`DTM+189:${depDate}${depTime}:201'`);

  // LOC - Destination
  lines.push(`LOC+87+${destination.code}'`);

  // Passenger segments
  let segCount = 0;
  for (const pax of passengers) {
    const apis = apisMap.get(pax.passengerId);
    if (!apis) continue;

    segCount++;

    const surname = ((apis["surname"] as string) ?? pax.lastName).toUpperCase();
    const givenNames = (
      (apis["given_names"] as string) ?? pax.firstName
    ).toUpperCase();
    const dob = apis["date_of_birth"]
      ? formatEdifactDate(new Date(apis["date_of_birth"] as string))
      : "";
    const gender = (apis["gender"] as string) ?? "U";
    const nationality = (apis["nationality"] as string) ?? "";
    const docNumber = (apis["document_number"] as string) ?? "";
    const issuingCountry = (apis["issuing_country"] as string) ?? "";
    const expiryDate = apis["expiry_date"]
      ? formatEdifactDate(new Date(apis["expiry_date"] as string))
      : "";
    const docType = apis["document_type"] === "passport" ? "P" : "I";

    // NAD - Passenger Name
    lines.push(`NAD+FL+++${surname}:${givenNames}'`);

    // ATT - Gender
    const genderCode = gender === "M" ? "1" : gender === "F" ? "2" : "0";
    lines.push(`ATT+2++${genderCode}'`);

    // DTM - Date of Birth
    if (dob) {
      lines.push(`DTM+329:${dob}:102'`);
    }

    // LOC - Residence country
    const resCountry = apis["residence_country"] as string | null;
    if (resCountry) {
      lines.push(`LOC+174+${resCountry}'`);
    }

    // NAT - Nationality
    if (nationality) {
      lines.push(`NAT+2+${nationality}'`);
    }

    // DOC - Travel Document
    lines.push(`DOC+${docType}+${docNumber}'`);

    // DTM - Document Expiry
    if (expiryDate) {
      lines.push(`DTM+36:${expiryDate}:102'`);
    }

    // LOC - Document Issuing Country
    if (issuingCountry) {
      lines.push(`LOC+91+${issuingCountry}'`);
    }
  }

  // CNT - Passenger Count
  lines.push(`CNT+42:${segCount}'`);

  // UNT - Message Trailer
  lines.push(`UNT+${lines.length}+1'`);

  // UNZ - Interchange Trailer
  lines.push(`UNZ+1+${flight.id}'`);

  return lines.join("\n");
}

// ============================================================================
// PNR/GOV Message Builder
// ============================================================================

function generatePNRGOV(data: {
  flight: {
    id: number;
    flightNumber: string;
    departureTime: Date;
    arrivalTime: Date;
  };
  origin: { code: string; country: string };
  destination: { code: string; country: string };
  airline: { code: string; name: string };
  passengers: Array<{
    passengerId: number;
    firstName: string;
    lastName: string;
    bookingReference: string;
  }>;
  apisMap: Map<number, Record<string, unknown>>;
}): string {
  const { flight, origin, destination, airline, passengers, apisMap } = data;

  const now = new Date();
  const lines: string[] = [];

  // Header
  lines.push(`--- PNRGOV MESSAGE ---`);
  lines.push(`AIRLINE: ${airline.code} / ${airline.name}`);
  lines.push(`FLIGHT: ${flight.flightNumber}`);
  lines.push(`ROUTE: ${origin.code} -> ${destination.code}`);
  lines.push(`DEPARTURE: ${flight.departureTime.toISOString()}`);
  lines.push(`GENERATED: ${now.toISOString()}`);
  lines.push(`---`);

  for (const pax of passengers) {
    const apis = apisMap.get(pax.passengerId);

    lines.push(``);
    lines.push(`PNR: ${pax.bookingReference}`);
    lines.push(`PASSENGER: ${pax.lastName}/${pax.firstName}`);

    if (apis) {
      const docType = ((apis["document_type"] as string) ?? "").toUpperCase();
      const docNumber = (apis["document_number"] as string) ?? "";
      const nationality = (apis["nationality"] as string) ?? "";
      const issuingCountry = (apis["issuing_country"] as string) ?? "";
      const dob = apis["date_of_birth"]
        ? new Date(apis["date_of_birth"] as string).toISOString().split("T")[0]
        : "N/A";
      const gender = (apis["gender"] as string) ?? "U";
      const expiryDate = apis["expiry_date"]
        ? new Date(apis["expiry_date"] as string).toISOString().split("T")[0]
        : "N/A";
      const resAddress = (apis["residence_address"] as string) ?? "";
      const destAddress = (apis["destination_address"] as string) ?? "";
      const redress = (apis["redress_number"] as string) ?? "";
      const ktn = (apis["known_traveler_number"] as string) ?? "";

      lines.push(`  DOC TYPE: ${docType}`);
      lines.push(`  DOC NUMBER: ${docNumber}`);
      lines.push(`  NATIONALITY: ${nationality}`);
      lines.push(`  ISSUING COUNTRY: ${issuingCountry}`);
      lines.push(`  DOB: ${dob}`);
      lines.push(`  GENDER: ${gender}`);
      lines.push(`  EXPIRY: ${expiryDate}`);
      if (resAddress) lines.push(`  RESIDENCE: ${resAddress}`);
      if (destAddress) lines.push(`  DEST ADDRESS: ${destAddress}`);
      if (redress) lines.push(`  REDRESS: ${redress}`);
      if (ktn) lines.push(`  KTN: ${ktn}`);
    } else {
      lines.push(`  ** NO APIS DATA **`);
    }
  }

  lines.push(``);
  lines.push(`--- END PNRGOV ---`);
  lines.push(`TOTAL PASSENGERS: ${passengers.length}`);
  lines.push(`APIS RECORDS: ${apisMap.size}/${passengers.length}`);

  return lines.join("\n");
}

// ============================================================================
// EDIFACT Date/Time Helpers
// ============================================================================

function formatEdifactDate(date: Date): string {
  const y = date.getFullYear().toString();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatEdifactTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${h}${min}`;
}

// ============================================================================
// Submit to Authorities
// ============================================================================

/**
 * Submit APIS data to destination country authorities.
 * Generates the appropriate message and records the submission.
 */
export async function submitToAuthorities(
  flightId: number,
  destination: string
) {
  const db = await requireDb();

  // Get destination-specific requirements
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get destination airport for country info
  const [destAirport] = await db
    .select({ code: airports.code, country: airports.country })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  const destinationCountry = destination || destAirport?.country || "??";

  // Determine format
  const requirements = await getAPISRequirements("**", destinationCountry);
  const format = requirements.format;

  // Check for incomplete passengers first
  const incomplete = await flagIncompletePassengers(flightId);
  if (incomplete.incompleteCount > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot submit: ${incomplete.incompleteCount} passenger(s) have incomplete APIS data`,
    });
  }

  // Generate the APIS message
  const message = await generateAPISMessage(flightId, format);

  const now = new Date();

  // Record the submission
  const [result] = await db.execute(sql`
    INSERT INTO apis_submissions (
      flight_id, destination_country, format, message_content,
      submission_time, status, created_at
    ) VALUES (
      ${flightId}, ${destinationCountry}, ${format}, ${message.messageContent},
      ${now}, 'submitted', ${now}
    )
  `);

  const submissionId = Number((result as { insertId: number }).insertId);

  // Update all validated APIS records to submitted
  const passengerIds = await db
    .select({ passengerId: passengers.id })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  if (passengerIds.length > 0) {
    await db.execute(sql`
      UPDATE apis_data
      SET status = 'submitted', submitted_at = ${now}, updated_at = ${now}
      WHERE passenger_id IN (${sql.join(
        passengerIds.map(p => sql`${p.passengerId}`),
        sql`, `
      )})
      AND status = 'validated'
    `);
  }

  return {
    submissionId,
    flightId,
    flightNumber: flight.flightNumber,
    destinationCountry,
    format,
    status: "submitted" as APISSubmissionStatus,
    submittedAt: now.toISOString(),
    passengerCount: message.passengerCount,
    validatedCount: message.validatedCount,
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
