import {
  int,
  mysqlTable,
  mysqlEnum,
  varchar,
  boolean,
  timestamp,
  datetime,
  date,
  decimal,
  text,
  index,
  uniqueIndex,
  json,
  longtext,
} from "drizzle-orm/mysql-core";

/** APIS uses snake-case SQL column names in the authority message service. */
export const apisData = mysqlTable(
  "apis_data",
  {
    id: int("id").autoincrement().primaryKey(),
    passengerId: int("passenger_id").notNull(),
    bookingId: int("booking_id").notNull(),
    documentType: mysqlEnum("document_type", [
      "passport",
      "national_id",
      "visa",
    ]).notNull(),
    documentNumber: varchar("document_number", { length: 20 }).notNull(),
    issuingCountry: varchar("issuing_country", { length: 3 }).notNull(),
    nationality: varchar("nationality", { length: 3 }).notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    gender: mysqlEnum("gender", ["M", "F", "U"]).notNull(),
    expiryDate: date("expiry_date", { mode: "string" }).notNull(),
    givenNames: varchar("given_names", { length: 100 }).notNull(),
    surname: varchar("surname", { length: 100 }).notNull(),
    residenceCountry: varchar("residence_country", { length: 3 }),
    residenceAddress: varchar("residence_address", { length: 500 }),
    destinationAddress: varchar("destination_address", { length: 500 }),
    redressNumber: varchar("redress_number", { length: 20 }),
    knownTravelerNumber: varchar("known_traveler_number", { length: 25 }),
    status: mysqlEnum("status", [
      "incomplete",
      "complete",
      "validated",
      "submitted",
      "rejected",
    ])
      .default("incomplete")
      .notNull(),
    validatedAt: timestamp("validated_at"),
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  t => ({
    passengerUnique: uniqueIndex("apis_data_passenger_unique").on(
      t.passengerId
    ),
    bookingIdx: index("apis_data_booking_idx").on(t.bookingId),
  })
);

export const apisRequirements = mysqlTable(
  "apis_requirements",
  {
    id: int("id").autoincrement().primaryKey(),
    originCountry: varchar("origin_country", { length: 3 }).notNull(),
    destinationCountry: varchar("destination_country", { length: 3 }).notNull(),
    requiredFields: text("required_fields").notNull(),
    submissionDeadlineMinutes: int("submission_deadline_minutes").notNull(),
    format: mysqlEnum("format", ["paxlst", "pnrgov"]).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  t => ({
    routeUnique: uniqueIndex("apis_requirements_route_unique").on(
      t.originCountry,
      t.destinationCountry
    ),
  })
);

export const apisSubmissions = mysqlTable(
  "apis_submissions",
  {
    id: int("id").autoincrement().primaryKey(),
    flightId: int("flight_id").notNull(),
    destinationCountry: varchar("destination_country", { length: 3 }).notNull(),
    format: mysqlEnum("format", ["paxlst", "pnrgov"]).notNull(),
    messageContent: text("message_content").notNull(),
    submissionTime: timestamp("submission_time"),
    acknowledgmentTime: timestamp("acknowledgment_time"),
    status: mysqlEnum("status", [
      "pending",
      "submitted",
      "acknowledged",
      "rejected",
      "error",
    ])
      .default("pending")
      .notNull(),
    responseMessage: text("response_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({ flightIdx: index("apis_submissions_flight_idx").on(t.flightId) })
);

export const consentRecords = mysqlTable(
  "consent_records",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    consentVersion: varchar("consentVersion", { length: 20 }).notNull(),
    essential: boolean("essential").default(true).notNull(),
    analytics: boolean("analytics").default(false).notNull(),
    marketing: boolean("marketing").default(false).notNull(),
    preferences: boolean("preferences").default(false).notNull(),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: varchar("userAgent", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("consent_records_userId_idx").on(table.userId),
    versionIdx: index("consent_records_version_idx").on(table.consentVersion),
  })
);

export const emergencyHotels = mysqlTable(
  "emergency_hotels",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    airportId: int("airportId").notNull(),
    address: varchar("address", { length: 500 }).notNull(),
    phone: varchar("phone", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    starRating: int("starRating").notNull(),
    /** Nightly standard rate in SAR cents (100 = 1 SAR) */
    standardRate: int("standardRate").notNull(),
    distanceKm: decimal("distanceKm", { precision: 6, scale: 2 }).notNull(),
    hasTransport: boolean("hasTransport").default(false).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    airportIdx: index("eh_airport_idx").on(table.airportId),
    activeIdx: index("eh_active_idx").on(table.isActive),
  })
);

export const emergencyHotelBookings = mysqlTable(
  "emergency_hotel_bookings",
  {
    id: int("id").autoincrement().primaryKey(),
    hotelId: int("hotelId").notNull(),
    bookingId: int("bookingId").notNull(),
    flightId: int("flightId").notNull(),
    passengerId: int("passengerId").notNull(),
    roomType: mysqlEnum("roomType", ["standard", "suite"])
      .default("standard")
      .notNull(),
    checkIn: datetime("checkIn").notNull(),
    checkOut: datetime("checkOut").notNull(),
    /** SAR cents */
    nightlyRate: int("nightlyRate").notNull(),
    /** SAR cents */
    totalCost: int("totalCost").notNull(),
    mealIncluded: boolean("mealIncluded").default(true).notNull(),
    transportIncluded: boolean("transportIncluded").default(false).notNull(),
    status: mysqlEnum("status", [
      "reserved",
      "checked_in",
      "checked_out",
      "cancelled",
      "no_show",
    ])
      .default("reserved")
      .notNull(),
    confirmationNumber: varchar("confirmationNumber", { length: 20 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    hotelIdx: index("ehb_hotel_idx").on(table.hotelId),
    bookingIdx: index("ehb_booking_idx").on(table.bookingId),
    flightIdx: index("ehb_flight_idx").on(table.flightId),
    passengerIdx: index("ehb_passenger_idx").on(table.passengerId),
    statusIdx: index("ehb_status_idx").on(table.status),
    confirmationIdx: index("ehb_confirmation_idx").on(table.confirmationNumber),
  })
);

export const kioskDevices = mysqlTable(
  "kiosk_devices",
  {
    id: int("id").autoincrement().primaryKey(),
    kioskCode: varchar("kioskCode", { length: 20 }).notNull().unique(),
    airportId: int("airportId").notNull(),
    terminal: varchar("terminal", { length: 50 }).notNull(),
    location: varchar("location", { length: 255 }).notNull(), // e.g., "Terminal 1, Near Gate A3"
    status: mysqlEnum("status", ["online", "offline", "maintenance"])
      .default("online")
      .notNull(),
    hardwareType: varchar("hardwareType", { length: 100 }),
    hasPrinter: boolean("hasPrinter").default(true).notNull(),
    hasScanner: boolean("hasScanner").default(true).notNull(),
    hasPayment: boolean("hasPayment").default(false).notNull(),
    lastHeartbeat: timestamp("lastHeartbeat"),
    installedAt: timestamp("installedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    airportIdIdx: index("kiosk_devices_airport_id_idx").on(table.airportId),
    statusIdx: index("kiosk_devices_status_idx").on(table.status),
    kioskCodeIdx: uniqueIndex("kiosk_devices_code_unique_idx").on(
      table.kioskCode
    ),
    airportStatusIdx: index("kiosk_devices_airport_status_idx").on(
      table.airportId,
      table.status
    ),
  })
);

export const kioskSessions = mysqlTable(
  "kiosk_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    kioskId: int("kioskId"),
    bookingId: int("bookingId").notNull(),
    passengerId: int("passengerId"),
    sessionType: mysqlEnum("sessionType", [
      "check_in",
      "seat_change",
      "bag_tag",
      "ancillary",
    ]).notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
    status: mysqlEnum("status", ["active", "completed", "abandoned", "error"])
      .default("active")
      .notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    kioskIdIdx: index("kiosk_sessions_kiosk_id_idx").on(table.kioskId),
    bookingIdIdx: index("kiosk_sessions_booking_id_idx").on(table.bookingId),
    statusIdx: index("kiosk_sessions_status_idx").on(table.status),
    sessionTypeIdx: index("kiosk_sessions_type_idx").on(table.sessionType),
    startedAtIdx: index("kiosk_sessions_started_at_idx").on(table.startedAt),
  })
);

export const kioskAnalytics = mysqlTable(
  "kiosk_analytics",
  {
    id: int("id").autoincrement().primaryKey(),
    kioskId: int("kioskId").notNull(),
    date: timestamp("date").notNull(),
    totalSessions: int("totalSessions").default(0).notNull(),
    completedSessions: int("completedSessions").default(0).notNull(),
    abandonedSessions: int("abandonedSessions").default(0).notNull(),
    avgSessionDurationSec: int("avgSessionDurationSec").default(0).notNull(),
    boardingPassesPrinted: int("boardingPassesPrinted").default(0).notNull(),
    bagTagsPrinted: int("bagTagsPrinted").default(0).notNull(),
    ancillaryRevenue: int("ancillaryRevenue").default(0).notNull(), // SAR cents
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    kioskIdIdx: index("kiosk_analytics_kiosk_id_idx").on(table.kioskId),
    dateIdx: index("kiosk_analytics_date_idx").on(table.date),
    kioskDateIdx: index("kiosk_analytics_kiosk_date_idx").on(
      table.kioskId,
      table.date
    ),
  })
);

export const warehouseExports = mysqlTable(
  "warehouse_exports",
  {
    id: int("id").autoincrement().primaryKey(),
    exportType: mysqlEnum("exportType", [
      "bookings",
      "flights",
      "revenue",
      "customers",
      "operational",
    ]).notNull(),
    dateRangeStart: datetime("dateRangeStart").notNull(),
    dateRangeEnd: datetime("dateRangeEnd").notNull(),
    format: mysqlEnum("format", ["csv", "json", "jsonl"]).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "processing",
      "completed",
      "failed",
    ])
      .notNull()
      .default("pending"),
    filePath: varchar("filePath", { length: 255 }),
    recordCount: int("recordCount").notNull().default(0),
    fileSize: int("fileSize").notNull().default(0),
    createdBy: int("createdBy").notNull(),
    requestKey: varchar("requestKey", { length: 191 }),
    checksum: varchar("checksum", { length: 64 }),
    content: longtext("content"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
  },
  t => ({
    request: uniqueIndex("warehouse_export_request").on(t.requestKey),
    created: index("warehouse_export_created").on(t.createdAt),
  })
);

export const warehouseSchedules = mysqlTable("warehouse_schedules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdBy: int("createdBy").notNull(),
  exportType: mysqlEnum("exportType", [
    "bookings",
    "flights",
    "revenue",
    "customers",
    "operational",
  ]).notNull(),
  frequency: mysqlEnum("frequency", ["daily", "weekly", "monthly"]).notNull(),
  format: mysqlEnum("format", ["csv", "json", "jsonl"]).notNull(),
  lastRunAt: datetime("lastRunAt"),
  nextRunAt: datetime("nextRunAt").notNull(),
  isActive: boolean("isActive").notNull().default(true),
  config: json("config").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const scheduledTasks = mysqlTable("scheduled_tasks", {
  name: varchar("name", { length: 100 }).primaryKey(),
  lastTick: varchar("lastTick", { length: 64 }),
  leaseToken: varchar("leaseToken", { length: 36 }),
  leaseUntil: datetime("leaseUntil"),
  lastStartedAt: datetime("lastStartedAt"),
  lastSuccessAt: datetime("lastSuccessAt"),
  lastError: text("lastError"),
});

export const eventInbox = mysqlTable("event_inbox", {
  eventId: varchar("eventId", { length: 36 }).primaryKey(),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  aggregateType: varchar("aggregateType", { length: 100 }).notNull(),
  aggregateId: varchar("aggregateId", { length: 255 }).notNull(),
  tenantId: int("tenantId"),
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const bagDropUnits = mysqlTable("bag_drop_units", {
  id: int("id").autoincrement().primaryKey(),
  unitCode: varchar("unitCode", { length: 50 }).notNull().unique(),
  airportId: int("airportId").notNull(),
  terminal: varchar("terminal", { length: 50 }).notNull(),
  zone: varchar("zone", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["online", "offline", "jam", "maintenance"])
    .notNull()
    .default("offline"),
  hasPrinter: boolean("hasPrinter").notNull().default(false),
  hasScale: boolean("hasScale").notNull().default(false),
  hasPayment: boolean("hasPayment").notNull().default(false),
  beltConnected: boolean("beltConnected").notNull().default(false),
  lastMaintenance: timestamp("lastMaintenance"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
});
export const bagDropSessions = mysqlTable(
  "bag_drop_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    unitId: int("unitId").notNull().default(0),
    bookingId: int("bookingId").notNull(),
    passengerId: int("passengerId").notNull(),
    totalBags: int("totalBags").notNull().default(0),
    totalWeight: int("totalWeight").notNull().default(0),
    bagWeights: json("bagWeights").$type<number[]>().notNull(),
    allowanceWeight: int("allowanceWeight").notNull(),
    excessWeight: int("excessWeight").notNull().default(0),
    excessFee: int("excessFee").notNull().default(0),
    paymentStatus: mysqlEnum("paymentStatus", ["none", "pending", "paid"])
      .notNull()
      .default("none"),
    status: mysqlEnum("status", [
      "started",
      "weighing",
      "payment",
      "printing",
      "complete",
      "error",
      "timeout",
    ])
      .notNull()
      .default("started"),
    version: int("version").notNull().default(0),
    startedAt: timestamp("startedAt").notNull().defaultNow(),
    completedAt: timestamp("completedAt"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  t => ({
    passenger: index("bag_drop_passenger").on(t.bookingId, t.passengerId),
    unit: index("bag_drop_unit").on(t.unitId),
  })
);
export const bagDropTags = mysqlTable(
  "bag_drop_tags",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: int("sessionId").notNull(),
    bagNumber: int("bagNumber").notNull(),
    tagNumber: varchar("tagNumber", { length: 20 }).notNull().unique(),
    weight: int("weight").notNull(),
    destination: varchar("destination", { length: 3 }).notNull(),
    connectionTags: json("connectionTags").$type<string[]>(),
    printedAt: timestamp("printedAt"),
    status: mysqlEnum("status", [
      "printed",
      "attached",
      "loaded",
      "transferred",
      "arrived",
      "lost",
    ]).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  t => ({
    bag: uniqueIndex("bag_drop_session_bag").on(t.sessionId, t.bagNumber),
  })
);
