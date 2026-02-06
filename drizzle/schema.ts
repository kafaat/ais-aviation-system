import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", [
      "user",
      "admin",
      "super_admin",
      "airline_admin",
      "finance",
      "ops",
      "support",
    ])
      .default("user")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => ({
    // Index for email lookups (login, password reset)
    emailIdx: index("users_email_idx").on(table.email),
    // Index for role-based queries (admin panels, RBAC)
    roleIdx: index("users_role_idx").on(table.role),
    // Index for user listing sorted by creation date
    createdAtIdx: index("users_created_at_idx").on(table.createdAt),
    // Composite index for role + createdAt (admin user listing with filters)
    roleCreatedAtIdx: index("users_role_created_at_idx").on(
      table.role,
      table.createdAt
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Airlines table
 */
export const airlines = mysqlTable(
  "airlines",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 3 }).notNull().unique(), // IATA code (e.g., SV, MS)
    name: varchar("name", { length: 255 }).notNull(),
    country: varchar("country", { length: 100 }),
    logo: text("logo"), // URL to airline logo
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    // Index for active airlines lookup (common filter)
    activeIdx: index("airlines_active_idx").on(table.active),
    // Index for country-based filtering
    countryIdx: index("airlines_country_idx").on(table.country),
    // Composite index for active airlines by country
    activeCountryIdx: index("airlines_active_country_idx").on(
      table.active,
      table.country
    ),
  })
);

export type Airline = typeof airlines.$inferSelect;
export type InsertAirline = typeof airlines.$inferInsert;

/**
 * Airports table
 */
export const airports = mysqlTable(
  "airports",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 3 }).notNull().unique(), // IATA code (e.g., JED, RUH)
    name: varchar("name", { length: 255 }).notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    timezone: varchar("timezone", { length: 50 }), // e.g., "Asia/Riyadh"
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    // Index for city search (autocomplete, search)
    cityIdx: index("airports_city_idx").on(table.city),
    // Index for country filtering
    countryIdx: index("airports_country_idx").on(table.country),
    // Composite index for country + city (location-based search)
    countryCity: index("airports_country_city_idx").on(
      table.country,
      table.city
    ),
  })
);

export type Airport = typeof airports.$inferSelect;
export type InsertAirport = typeof airports.$inferInsert;

/**
 * Flights table
 */
export const flights = mysqlTable(
  "flights",
  {
    id: int("id").autoincrement().primaryKey(),
    flightNumber: varchar("flightNumber", { length: 10 }).notNull(),
    airlineId: int("airlineId").notNull(),
    originId: int("originId").notNull(),
    destinationId: int("destinationId").notNull(),
    departureTime: timestamp("departureTime").notNull(),
    arrivalTime: timestamp("arrivalTime").notNull(),
    aircraftType: varchar("aircraftType", { length: 50 }), // e.g., "Boeing 777"
    status: mysqlEnum("status", [
      "scheduled",
      "delayed",
      "cancelled",
      "completed",
    ])
      .default("scheduled")
      .notNull(),
    economySeats: int("economySeats").notNull(),
    businessSeats: int("businessSeats").notNull(),
    economyPrice: int("economyPrice").notNull(), // Price in SAR (stored as integer, e.g., 50000 = 500.00 SAR)
    businessPrice: int("businessPrice").notNull(),
    economyAvailable: int("economyAvailable").notNull(),
    businessAvailable: int("businessAvailable").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    flightNumberIdx: index("flight_number_idx").on(table.flightNumber),
    departureTimeIdx: index("departure_time_idx").on(table.departureTime),
    routeIdx: index("route_idx").on(table.originId, table.destinationId),
    airlineIdx: index("airline_idx").on(table.airlineId),
    statusIdx: index("status_idx").on(table.status),
    // Composite index for common search pattern: route + date + status
    routeDateStatusIdx: index("route_date_status_idx").on(
      table.originId,
      table.destinationId,
      table.departureTime,
      table.status
    ),
  })
);

export type Flight = typeof flights.$inferSelect;
export type InsertFlight = typeof flights.$inferInsert;

/**
 * Bookings table
 */
export const bookings = mysqlTable(
  "bookings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    flightId: int("flightId").notNull(),
    bookingReference: varchar("bookingReference", { length: 6 })
      .notNull()
      .unique(), // e.g., "ABC123"
    pnr: varchar("pnr", { length: 6 }).notNull().unique(), // Passenger Name Record
    status: mysqlEnum("status", [
      "pending",
      "confirmed",
      "cancelled",
      "completed",
    ])
      .default("pending")
      .notNull(),
    totalAmount: int("totalAmount").notNull(), // Total price in SAR cents
    paymentStatus: mysqlEnum("paymentStatus", [
      "pending",
      "paid",
      "refunded",
      "failed",
    ])
      .default("pending")
      .notNull(),
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
    stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", {
      length: 255,
    }),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).unique(), // For preventing duplicate bookings
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),
    numberOfPassengers: int("numberOfPassengers").notNull(),
    checkedIn: boolean("checkedIn").default(false).notNull(),
    checkInReminderSentAt: timestamp("checkInReminderSentAt"), // When check-in reminder email was sent
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    pnrIdx: index("pnr_idx").on(table.pnr),
    // Index for flight-based queries (flight manifest, seat availability)
    flightIdIdx: index("bookings_flight_id_idx").on(table.flightId),
    // Index for status filtering (admin panels, reports)
    statusIdx: index("bookings_status_idx").on(table.status),
    // Index for payment status queries
    paymentStatusIdx: index("bookings_payment_status_idx").on(
      table.paymentStatus
    ),
    // Index for Stripe checkout session lookups (webhook processing)
    stripeCheckoutIdx: index("bookings_stripe_checkout_idx").on(
      table.stripeCheckoutSessionId
    ),
    // Index for Stripe payment intent lookups (webhook processing)
    stripePaymentIntentIdx: index("bookings_stripe_payment_intent_idx").on(
      table.stripePaymentIntentId
    ),
    // Index for creation date sorting (user booking history)
    createdAtIdx: index("bookings_created_at_idx").on(table.createdAt),
    // Composite index for user bookings sorted by date
    userCreatedAtIdx: index("bookings_user_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
    // Composite index for user + status filtering
    userStatusIdx: index("bookings_user_status_idx").on(
      table.userId,
      table.status
    ),
    // Composite index for flight + status (seat availability calculation)
    flightStatusIdx: index("bookings_flight_status_idx").on(
      table.flightId,
      table.status
    ),
    // Index for check-in status queries
    checkedInIdx: index("bookings_checked_in_idx").on(table.checkedIn),
    // Composite index for check-in reminder queries
    checkInReminderIdx: index("bookings_check_in_reminder_idx").on(
      table.status,
      table.checkedIn,
      table.checkInReminderSentAt
    ),
  })
);

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/**
 * Passengers table
 */
export const passengers = mysqlTable(
  "passengers",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    type: mysqlEnum("type", ["adult", "child", "infant"])
      .default("adult")
      .notNull(),
    title: varchar("title", { length: 10 }), // Mr, Mrs, Ms, Dr
    firstName: varchar("firstName", { length: 100 }).notNull(),
    lastName: varchar("lastName", { length: 100 }).notNull(),
    dateOfBirth: timestamp("dateOfBirth"),
    passportNumber: varchar("passportNumber", { length: 20 }),
    nationality: varchar("nationality", { length: 3 }), // ISO country code
    seatNumber: varchar("seatNumber", { length: 5 }), // e.g., "12A"
    ticketNumber: varchar("ticketNumber", { length: 13 }), // IATA 13-digit ticket number
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("booking_id_idx").on(table.bookingId),
    // Index for ticket number lookups (e-ticket verification)
    ticketNumberIdx: index("passengers_ticket_number_idx").on(
      table.ticketNumber
    ),
    // Index for passport lookups (identity verification)
    passportIdx: index("passengers_passport_idx").on(table.passportNumber),
    // Composite index for name search (customer lookup)
    nameIdx: index("passengers_name_idx").on(table.lastName, table.firstName),
    // Index for passenger type filtering (pricing calculations)
    typeIdx: index("passengers_type_idx").on(table.type),
  })
);

export type Passenger = typeof passengers.$inferSelect;
export type InsertPassenger = typeof passengers.$inferInsert;

/**
 * Flight Status History table
 * Tracks all status changes for flights
 */
export const flightStatusHistory = mysqlTable(
  "flight_status_history",
  {
    id: int("id").autoincrement().primaryKey(),
    flightId: int("flightId").notNull(),
    oldStatus: mysqlEnum("oldStatus", [
      "scheduled",
      "delayed",
      "cancelled",
      "completed",
    ]),
    newStatus: mysqlEnum("newStatus", [
      "scheduled",
      "delayed",
      "cancelled",
      "completed",
    ]).notNull(),
    delayMinutes: int("delayMinutes"),
    reason: text("reason"),
    changedBy: int("changedBy"), // User ID who made the change (admin)
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    // Index for flight history lookup
    flightIdIdx: index("flight_status_history_flight_idx").on(table.flightId),
    // Index for status filtering
    newStatusIdx: index("flight_status_history_new_status_idx").on(
      table.newStatus
    ),
    // Index for admin audit trail
    changedByIdx: index("flight_status_history_changed_by_idx").on(
      table.changedBy
    ),
    // Index for chronological queries
    createdAtIdx: index("flight_status_history_created_at_idx").on(
      table.createdAt
    ),
    // Composite index for flight status timeline
    flightCreatedAtIdx: index("flight_status_history_flight_created_idx").on(
      table.flightId,
      table.createdAt
    ),
  })
);

export type FlightStatusHistory = typeof flightStatusHistory.$inferSelect;
export type InsertFlightStatusHistory = typeof flightStatusHistory.$inferInsert;

/**
 * Payments table
 */
export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    amount: int("amount").notNull(), // Amount in SAR cents
    currency: varchar("currency", { length: 3 }).default("SAR").notNull(),
    method: mysqlEnum("method", ["card", "wallet", "bank_transfer"]).notNull(),
    status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"])
      .default("pending")
      .notNull(),
    transactionId: varchar("transactionId", { length: 100 }), // External payment gateway transaction ID
    idempotencyKey: varchar("idempotencyKey", { length: 100 }).unique(), // For preventing duplicate payments
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }), // Stripe Payment Intent ID
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("booking_id_idx").on(table.bookingId),
    idempotencyKeyIdx: index("idempotency_key_idx").on(table.idempotencyKey),
    // Index for status filtering (reconciliation, reports)
    statusIdx: index("payments_status_idx").on(table.status),
    // Index for Stripe payment intent lookups
    stripePaymentIntentIdx: index("payments_stripe_payment_intent_idx").on(
      table.stripePaymentIntentId
    ),
    // Index for transaction ID lookups
    transactionIdIdx: index("payments_transaction_id_idx").on(
      table.transactionId
    ),
    // Index for date range queries (financial reports)
    createdAtIdx: index("payments_created_at_idx").on(table.createdAt),
    // Composite index for status + date (report filtering)
    statusCreatedAtIdx: index("payments_status_created_at_idx").on(
      table.status,
      table.createdAt
    ),
    // Index for payment method filtering
    methodIdx: index("payments_method_idx").on(table.method),
  })
);

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Booking Modification Requests table
 * Tracks all modification requests for bookings
 */
export const bookingModifications = mysqlTable(
  "booking_modifications",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    userId: int("userId").notNull(),

    // Modification type
    modificationType: mysqlEnum("modificationType", [
      "change_date",
      "upgrade_cabin",
      "change_flight",
      "add_services",
    ]).notNull(),

    // Original values
    originalFlightId: int("originalFlightId"),
    originalCabinClass: mysqlEnum("originalCabinClass", [
      "economy",
      "business",
    ]),
    originalAmount: int("originalAmount").notNull(), // in cents

    // New values
    newFlightId: int("newFlightId"),
    newCabinClass: mysqlEnum("newCabinClass", ["economy", "business"]),
    newAmount: int("newAmount").notNull(), // in cents

    // Price difference
    priceDifference: int("priceDifference").notNull(), // positive = pay more, negative = refund
    modificationFee: int("modificationFee").notNull().default(0), // in cents
    totalCost: int("totalCost").notNull(), // priceDifference + modificationFee

    // Status
    status: mysqlEnum("status", [
      "pending",
      "approved",
      "rejected",
      "completed",
    ])
      .notNull()
      .default("pending"),

    // Payment
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
    paymentStatus: mysqlEnum("paymentStatus", [
      "pending",
      "paid",
      "refunded",
    ]).default("pending"),

    // Metadata
    reason: text("reason"),
    adminNotes: text("adminNotes"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    bookingIdIdx: index("booking_id_idx").on(table.bookingId),
    userIdIdx: index("user_id_idx").on(table.userId),
    statusIdx: index("status_idx").on(table.status),
  })
);

export type BookingModification = typeof bookingModifications.$inferSelect;
export type InsertBookingModification =
  typeof bookingModifications.$inferInsert;

/**
 * Loyalty Accounts table
 * Tracks user loyalty program membership and tier
 */
export const loyaltyAccounts = mysqlTable(
  "loyalty_accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),

    // Miles balance
    totalMilesEarned: int("totalMilesEarned").notNull().default(0),
    currentMilesBalance: int("currentMilesBalance").notNull().default(0),
    milesRedeemed: int("milesRedeemed").notNull().default(0),

    // Tier system
    tier: mysqlEnum("tier", ["bronze", "silver", "gold", "platinum"])
      .notNull()
      .default("bronze"),
    tierPoints: int("tierPoints").notNull().default(0), // Points for tier qualification

    // Metadata
    memberSince: timestamp("memberSince").defaultNow().notNull(),
    lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    tierIdx: index("tier_idx").on(table.tier),
  })
);

export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type InsertLoyaltyAccount = typeof loyaltyAccounts.$inferInsert;

/**
 * Miles Transactions table
 * Tracks all miles earning and redemption transactions
 */
export const milesTransactions = mysqlTable(
  "miles_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    loyaltyAccountId: int("loyaltyAccountId").notNull(),

    // Transaction details
    type: mysqlEnum("type", [
      "earn",
      "redeem",
      "expire",
      "bonus",
      "adjustment",
    ]).notNull(),
    amount: int("amount").notNull(), // Positive for earn, negative for redeem
    balanceAfter: int("balanceAfter").notNull(),

    // Related entities
    bookingId: int("bookingId"),
    flightId: int("flightId"),

    // Description
    description: text("description").notNull(),
    reason: text("reason"),

    // Expiry
    expiresAt: timestamp("expiresAt"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    loyaltyAccountIdIdx: index("loyalty_account_id_idx").on(
      table.loyaltyAccountId
    ),
    typeIdx: index("type_idx").on(table.type),
  })
);

export type MilesTransaction = typeof milesTransactions.$inferSelect;
export type InsertMilesTransaction = typeof milesTransactions.$inferInsert;

/**
 * Inventory Locks table
 * Prevents double booking by temporarily locking seats during checkout
 */
export const inventoryLocks = mysqlTable(
  "inventory_locks",
  {
    id: int("id").autoincrement().primaryKey(),

    // Flight and seat info
    flightId: int("flightId").notNull(),
    numberOfSeats: int("numberOfSeats").notNull(),
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),

    // User and session info
    userId: int("userId"),
    sessionId: varchar("sessionId", { length: 64 }).notNull(), // For anonymous users

    // Lock status
    status: mysqlEnum("status", ["active", "released", "expired", "converted"])
      .notNull()
      .default("active"),

    // Timing
    lockedAt: timestamp("lockedAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(), // Auto-release after 15 minutes
    releasedAt: timestamp("releasedAt"),

    // Metadata
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    flightIdIdx: index("flight_id_idx").on(table.flightId),
    sessionIdIdx: index("session_id_idx").on(table.sessionId),
    statusIdx: index("status_idx").on(table.status),
    expiresAtIdx: index("expires_at_idx").on(table.expiresAt),
  })
);

export type InventoryLock = typeof inventoryLocks.$inferSelect;
export type InsertInventoryLock = typeof inventoryLocks.$inferInsert;

/**
 * User Preferences table - stores user travel preferences
 */
export const userPreferences = mysqlTable(
  "user_preferences",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),

    // Seat preferences
    preferredSeatType: mysqlEnum("preferredSeatType", [
      "window",
      "aisle",
      "middle",
    ]),
    preferredCabinClass: mysqlEnum("preferredCabinClass", [
      "economy",
      "business",
      "first",
    ]),

    // Meal preferences
    mealPreference: mysqlEnum("mealPreference", [
      "regular",
      "vegetarian",
      "vegan",
      "halal",
      "kosher",
      "gluten_free",
    ]),

    // Special services
    wheelchairAssistance: boolean("wheelchairAssistance").default(false),
    extraLegroom: boolean("extraLegroom").default(false),

    // Saved passport info
    passportNumber: varchar("passportNumber", { length: 50 }),
    passportExpiry: timestamp("passportExpiry"),
    nationality: varchar("nationality", { length: 100 }),

    // Contact preferences
    phoneNumber: varchar("phoneNumber", { length: 20 }),
    emergencyContact: varchar("emergencyContact", { length: 100 }),
    emergencyPhone: varchar("emergencyPhone", { length: 20 }),

    // Notification preferences
    emailNotifications: boolean("emailNotifications").default(true),
    smsNotifications: boolean("smsNotifications").default(false),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
  })
);

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * Ancillary Services Catalog
 * Defines available add-on services (baggage, meals, seats, insurance)
 */
export const ancillaryServices = mysqlTable(
  "ancillary_services",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 50 }).notNull().unique(), // e.g., "BAG_20KG", "MEAL_VEG", "SEAT_EXTRA_LEG"
    category: mysqlEnum("category", [
      "baggage",
      "meal",
      "seat",
      "insurance",
      "lounge",
      "priority_boarding",
    ]).notNull(),
    name: varchar("name", { length: 255 }).notNull(), // e.g., "20kg Checked Baggage"
    description: text("description"),
    price: int("price").notNull(), // Price in SAR cents (e.g., 5000 = 50.00 SAR)
    currency: varchar("currency", { length: 3 }).default("SAR").notNull(),
    available: boolean("available").default(true).notNull(),
    // Optional: restrict by cabin class
    applicableCabinClasses: text("applicableCabinClasses"), // JSON array: ["economy", "business"]
    // Optional: restrict by route or airline
    applicableAirlines: text("applicableAirlines"), // JSON array of airline IDs
    icon: varchar("icon", { length: 255 }), // Icon name or URL
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    categoryIdx: index("category_idx").on(table.category),
    availableIdx: index("available_idx").on(table.available),
  })
);

export type AncillaryService = typeof ancillaryServices.$inferSelect;
export type InsertAncillaryService = typeof ancillaryServices.$inferInsert;

/**
 * Booking Ancillaries
 * Links ancillary services to bookings
 */
export const bookingAncillaries = mysqlTable(
  "booking_ancillaries",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    passengerId: int("passengerId"), // Optional: link to specific passenger
    ancillaryServiceId: int("ancillaryServiceId").notNull(),
    quantity: int("quantity").default(1).notNull(),
    unitPrice: int("unitPrice").notNull(), // Price at time of purchase (in SAR cents)
    totalPrice: int("totalPrice").notNull(), // quantity * unitPrice
    status: mysqlEnum("status", ["active", "cancelled", "refunded"])
      .default("active")
      .notNull(),
    // Additional data (e.g., seat number, meal preference)
    metadata: text("metadata"), // JSON object for flexible data
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("booking_id_idx").on(table.bookingId),
    passengerIdIdx: index("passenger_id_idx").on(table.passengerId),
    ancillaryServiceIdIdx: index("ancillary_service_id_idx").on(
      table.ancillaryServiceId
    ),
  })
);

export type BookingAncillary = typeof bookingAncillaries.$inferSelect;
export type InsertBookingAncillary = typeof bookingAncillaries.$inferInsert;

/**
 * Flight Reviews
 * User reviews and ratings for flights
 */
export const flightReviews = mysqlTable(
  "flight_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    flightId: int("flightId").notNull(),
    bookingId: int("bookingId"), // Optional: link to booking for verified reviews
    rating: int("rating").notNull(), // 1-5 stars
    // Individual aspect ratings
    comfortRating: int("comfortRating"), // 1-5
    serviceRating: int("serviceRating"), // 1-5
    valueRating: int("valueRating"), // 1-5
    // Review content
    title: varchar("title", { length: 200 }),
    comment: text("comment"),
    // Helpful votes
    helpfulCount: int("helpfulCount").default(0).notNull(),
    // Verification
    isVerified: boolean("isVerified").default(false).notNull(), // True if linked to actual booking
    // Moderation
    status: mysqlEnum("status", ["pending", "approved", "rejected", "hidden"])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    flightIdIdx: index("flight_id_idx").on(table.flightId),
    bookingIdIdx: index("booking_id_idx").on(table.bookingId),
    ratingIdx: index("rating_idx").on(table.rating),
    statusIdx: index("status_idx").on(table.status),
    // Unique constraint: one review per user per flight
    userFlightUnique: index("user_flight_unique").on(
      table.userId,
      table.flightId
    ),
  })
);

export type FlightReview = typeof flightReviews.$inferSelect;
export type InsertFlightReview = typeof flightReviews.$inferInsert;

/**
 * Favorite Flights
 * User's saved favorite flight routes
 */
export const favoriteFlights = mysqlTable(
  "favorite_flights",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    originId: int("originId").notNull(),
    destinationId: int("destinationId").notNull(),
    // Optional: specific flight or just the route
    airlineId: int("airlineId"), // Favorite specific airline
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]),
    // Price alert settings
    enablePriceAlert: boolean("enablePriceAlert").default(false).notNull(),
    maxPrice: int("maxPrice"), // Alert when price drops below this (in SAR cents)
    lastAlertSent: timestamp("lastAlertSent"),
    // Notification preferences
    emailNotifications: boolean("emailNotifications").default(true).notNull(),
    // Additional notes
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    routeIdx: index("route_idx").on(table.originId, table.destinationId),
    airlineIdIdx: index("airline_id_idx").on(table.airlineId),
    priceAlertIdx: index("price_alert_idx").on(
      table.enablePriceAlert,
      table.maxPrice
    ),
    // Unique constraint: one favorite per user per route/airline combination
    userRouteFavoriteUnique: index("user_route_favorite_unique").on(
      table.userId,
      table.originId,
      table.destinationId,
      table.airlineId
    ),
  })
);

export type FavoriteFlight = typeof favoriteFlights.$inferSelect;
export type InsertFavoriteFlight = typeof favoriteFlights.$inferInsert;

/**
 * Price Alert History
 * Track when price alerts were triggered
 */
export const priceAlertHistory = mysqlTable(
  "price_alert_history",
  {
    id: int("id").autoincrement().primaryKey(),
    favoriteFlightId: int("favoriteFlightId").notNull(),
    flightId: int("flightId").notNull(), // The specific flight that triggered the alert
    previousPrice: int("previousPrice").notNull(), // Previous lowest price
    newPrice: int("newPrice").notNull(), // New lower price
    priceChange: int("priceChange").notNull(), // Difference (negative number)
    alertSent: boolean("alertSent").default(false).notNull(),
    sentAt: timestamp("sentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    favoriteFlightIdIdx: index("favorite_flight_id_idx").on(
      table.favoriteFlightId
    ),
    flightIdIdx: index("flight_id_idx").on(table.flightId),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

export type PriceAlertHistory = typeof priceAlertHistory.$inferSelect;
export type InsertPriceAlertHistory = typeof priceAlertHistory.$inferInsert;

/**
 * Audit Logs
 * Track all sensitive operations for security and compliance
 */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),

    // Event identification
    eventId: varchar("eventId", { length: 64 }).notNull().unique(), // Unique identifier for the event
    eventType: varchar("eventType", { length: 100 }).notNull(), // e.g., "BOOKING_CREATED", "PAYMENT_PROCESSED", "USER_ROLE_CHANGED"
    eventCategory: mysqlEnum("eventCategory", [
      "auth",
      "booking",
      "payment",
      "user_management",
      "flight_management",
      "refund",
      "modification",
      "access",
      "system",
    ]).notNull(),

    // Outcome and severity
    outcome: mysqlEnum("outcome", ["success", "failure", "error"]).notNull(),
    severity: mysqlEnum("severity", ["low", "medium", "high", "critical"])
      .default("low")
      .notNull(),

    // Actor information
    userId: int("userId"), // User who performed the action
    userRole: varchar("userRole", { length: 50 }), // Role at time of action
    actorType: mysqlEnum("actorType", ["user", "admin", "system", "api"])
      .default("user")
      .notNull(),

    // Request context
    sourceIp: varchar("sourceIp", { length: 45 }), // IPv4 or IPv6
    userAgent: text("userAgent"),
    requestId: varchar("requestId", { length: 64 }), // For correlation

    // Resource information
    resourceType: varchar("resourceType", { length: 100 }), // e.g., "booking", "flight", "user"
    resourceId: varchar("resourceId", { length: 100 }), // ID of the affected resource

    // Change details
    previousValue: text("previousValue"), // JSON of old state (for updates)
    newValue: text("newValue"), // JSON of new state
    changeDescription: text("changeDescription"), // Human-readable description

    // Metadata
    metadata: text("metadata"), // Additional JSON data

    // Timestamps
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    eventTypeIdx: index("event_type_idx").on(table.eventType),
    eventCategoryIdx: index("event_category_idx").on(table.eventCategory),
    userIdIdx: index("user_id_idx").on(table.userId),
    resourceTypeIdx: index("resource_type_idx").on(table.resourceType),
    resourceIdIdx: index("resource_id_idx").on(table.resourceId),
    timestampIdx: index("timestamp_idx").on(table.timestamp),
    outcomeIdx: index("outcome_idx").on(table.outcome),
    severityIdx: index("severity_idx").on(table.severity),
    // Composite index for common queries
    categoryOutcomeIdx: index("category_outcome_idx").on(
      table.eventCategory,
      table.outcome
    ),
  })
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Booking Status History
 * Tracks all status transitions for bookings (state machine)
 */
export const bookingStatusHistory = mysqlTable(
  "booking_status_history",
  {
    id: int("id").autoincrement().primaryKey(),

    // Booking reference
    bookingId: int("bookingId").notNull(),
    bookingReference: varchar("bookingReference", { length: 6 }).notNull(),

    // State transition
    previousStatus: mysqlEnum("previousStatus", [
      "initiated",
      "pending",
      "reserved",
      "paid",
      "confirmed",
      "checked_in",
      "boarded",
      "completed",
      "cancelled",
      "refunded",
      "expired",
      "payment_failed",
      "no_show",
    ]),
    newStatus: mysqlEnum("newStatus", [
      "initiated",
      "pending",
      "reserved",
      "paid",
      "confirmed",
      "checked_in",
      "boarded",
      "completed",
      "cancelled",
      "refunded",
      "expired",
      "payment_failed",
      "no_show",
    ]).notNull(),

    // Transition metadata
    transitionReason: text("transitionReason"), // Why the status changed
    isValidTransition: boolean("isValidTransition").default(true).notNull(),

    // Actor information
    changedBy: int("changedBy"), // User ID who triggered the change
    changedByRole: varchar("changedByRole", { length: 50 }), // Role at time of change
    actorType: mysqlEnum("actorType", [
      "user",
      "admin",
      "system",
      "payment_gateway",
    ])
      .default("system")
      .notNull(),

    // Additional context
    paymentIntentId: varchar("paymentIntentId", { length: 255 }), // If triggered by payment
    metadata: text("metadata"), // Additional JSON data

    // Timestamps
    transitionedAt: timestamp("transitionedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("booking_id_idx").on(table.bookingId),
    bookingReferenceIdx: index("booking_reference_idx").on(
      table.bookingReference
    ),
    newStatusIdx: index("new_status_idx").on(table.newStatus),
    transitionedAtIdx: index("transitioned_at_idx").on(table.transitionedAt),
    changedByIdx: index("changed_by_idx").on(table.changedBy),
    // Composite index for common queries
    bookingStatusIdx: index("booking_status_idx").on(
      table.bookingId,
      table.newStatus
    ),
  })
);

export type BookingStatusHistory = typeof bookingStatusHistory.$inferSelect;
export type InsertBookingStatusHistory =
  typeof bookingStatusHistory.$inferInsert;

/**
 * Stripe Events
 * Stores all Stripe webhook events for de-duplication and audit
 */
export const stripeEvents = mysqlTable(
  "stripe_events",
  {
    id: varchar("id", { length: 255 }).primaryKey(), // Stripe event ID
    type: varchar("type", { length: 100 }).notNull(), // e.g., "payment_intent.succeeded"
    apiVersion: varchar("apiVersion", { length: 20 }), // Stripe API version
    data: text("data").notNull(), // JSON stringified event data
    processed: boolean("processed").default(false).notNull(),
    processedAt: timestamp("processedAt"),
    error: text("error"), // Error message if processing failed
    retryCount: int("retryCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    typeIdx: index("stripe_events_type_idx").on(table.type),
    processedIdx: index("stripe_events_processed_idx").on(table.processed),
    createdAtIdx: index("stripe_events_created_at_idx").on(table.createdAt),
  })
);

export type StripeEvent = typeof stripeEvents.$inferSelect;
export type InsertStripeEvent = typeof stripeEvents.$inferInsert;

/**
 * Financial Ledger
 * Complete audit trail of all financial transactions
 */
export const financialLedger = mysqlTable(
  "financial_ledger",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId"), // Nullable for non-booking transactions
    userId: int("userId"),
    type: mysqlEnum("type", [
      "charge",
      "refund",
      "partial_refund",
      "fee",
      "adjustment",
    ]).notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("SAR").notNull(),

    // Stripe references
    stripeEventId: varchar("stripeEventId", { length: 255 }),
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
    stripeChargeId: varchar("stripeChargeId", { length: 255 }),
    stripeRefundId: varchar("stripeRefundId", { length: 255 }),

    // Description and metadata
    description: text("description"),
    metadata: text("metadata"), // JSON stringified additional data

    // Balance tracking
    balanceBefore: decimal("balanceBefore", { precision: 10, scale: 2 }),
    balanceAfter: decimal("balanceAfter", { precision: 10, scale: 2 }),

    // Timestamps
    transactionDate: timestamp("transactionDate").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("financial_ledger_booking_id_idx").on(table.bookingId),
    userIdIdx: index("financial_ledger_user_id_idx").on(table.userId),
    typeIdx: index("financial_ledger_type_idx").on(table.type),
    stripeEventIdIdx: index("financial_ledger_stripe_event_id_idx").on(
      table.stripeEventId
    ),
    transactionDateIdx: index("financial_ledger_transaction_date_idx").on(
      table.transactionDate
    ),
  })
);

export type FinancialLedger = typeof financialLedger.$inferSelect;
export type InsertFinancialLedger = typeof financialLedger.$inferInsert;

/**
 * Refresh Tokens
 * Stores refresh tokens for mobile authentication
 */
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    token: varchar("token", { length: 500 }).notNull().unique(),
    deviceInfo: text("deviceInfo"), // JSON: device type, OS, app version
    ipAddress: varchar("ipAddress", { length: 45 }),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    lastUsedAt: timestamp("lastUsedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
    tokenIdx: index("refresh_tokens_token_idx").on(table.token),
    expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
  })
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = typeof refreshTokens.$inferInsert;

/**
 * Idempotency Requests
 * Stores idempotency keys for all critical operations
 * Prevents duplicate processing of the same request
 */
export const idempotencyRequests = mysqlTable(
  "idempotency_requests",
  {
    id: int("id").autoincrement().primaryKey(),

    // Idempotency key and scope
    scope: varchar("scope", { length: 100 }).notNull(), // e.g., "booking.create", "payment.intent", "webhook.stripe"
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),

    // User/tenant context (nullable for webhooks)
    userId: int("userId"),

    // Request hash to detect payload changes
    requestHash: varchar("requestHash", { length: 64 }).notNull(), // SHA256

    // Processing status
    status: mysqlEnum("status", ["STARTED", "COMPLETED", "FAILED"])
      .default("STARTED")
      .notNull(),

    // Response storage
    responseJson: text("responseJson"), // JSON stringified response
    errorMessage: text("errorMessage"), // Error message if FAILED

    // Timestamps
    expiresAt: timestamp("expiresAt").notNull(), // TTL for cleanup
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Unique constraint on scope + userId + idempotencyKey
    scopeUserKeyIdx: index("idempotency_scope_user_key_idx").on(
      table.scope,
      table.userId,
      table.idempotencyKey
    ),
    // For webhook lookups (no userId)
    scopeKeyIdx: index("idempotency_scope_key_idx").on(
      table.scope,
      table.idempotencyKey
    ),
    statusIdx: index("idempotency_status_idx").on(table.status),
    expiresAtIdx: index("idempotency_expires_at_idx").on(table.expiresAt),
  })
);

export type IdempotencyRequest = typeof idempotencyRequests.$inferSelect;
export type InsertIdempotencyRequest = typeof idempotencyRequests.$inferInsert;

// ============================================================================
// P0 Critical Features - Dynamic Pricing, Multi-Currency, Inventory Management
// ============================================================================

/**
 * Pricing Rules
 * Defines dynamic pricing rules for revenue management
 */
export const pricingRules = mysqlTable(
  "pricing_rules",
  {
    id: int("id").autoincrement().primaryKey(),

    // Rule identification
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    // Rule type
    ruleType: mysqlEnum("ruleType", [
      "demand_multiplier",
      "time_based",
      "seasonal",
      "route_specific",
      "cabin_class",
      "advance_purchase",
      "load_factor",
    ]).notNull(),

    // Scope
    airlineId: int("airlineId"), // Null = all airlines
    originId: int("originId"), // Null = all origins
    destinationId: int("destinationId"), // Null = all destinations
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]), // Null = both

    // Rule parameters (JSON)
    parameters: text("parameters").notNull(), // JSON: thresholds, multipliers, etc.

    // Priority (higher = applied first)
    priority: int("priority").default(0).notNull(),

    // Validity
    validFrom: timestamp("validFrom"),
    validTo: timestamp("validTo"),
    isActive: boolean("isActive").default(true).notNull(),

    // Audit
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ruleTypeIdx: index("pricing_rules_type_idx").on(table.ruleType),
    airlineIdx: index("pricing_rules_airline_idx").on(table.airlineId),
    routeIdx: index("pricing_rules_route_idx").on(
      table.originId,
      table.destinationId
    ),
    activeIdx: index("pricing_rules_active_idx").on(table.isActive),
    priorityIdx: index("pricing_rules_priority_idx").on(table.priority),
    validityIdx: index("pricing_rules_validity_idx").on(
      table.validFrom,
      table.validTo
    ),
  })
);

export type PricingRule = typeof pricingRules.$inferSelect;
export type InsertPricingRule = typeof pricingRules.$inferInsert;

/**
 * Pricing History
 * Tracks all price calculations for analytics and auditing
 */
export const pricingHistory = mysqlTable(
  "pricing_history",
  {
    id: int("id").autoincrement().primaryKey(),

    // Flight reference
    flightId: int("flightId").notNull(),
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),

    // Pricing details
    basePrice: int("basePrice").notNull(), // Original price in cents
    finalPrice: int("finalPrice").notNull(), // Calculated price in cents
    totalMultiplier: decimal("totalMultiplier", {
      precision: 10,
      scale: 4,
    }).notNull(),

    // Applied rules (JSON array of rule IDs and their contributions)
    appliedRules: text("appliedRules").notNull(), // JSON

    // Context at calculation time
    occupancyRate: decimal("occupancyRate", { precision: 5, scale: 4 }),
    daysUntilDeparture: int("daysUntilDeparture"),
    demandScore: decimal("demandScore", { precision: 5, scale: 2 }),

    // Booking reference (if price was used)
    bookingId: int("bookingId"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    flightIdx: index("pricing_history_flight_idx").on(table.flightId),
    bookingIdx: index("pricing_history_booking_idx").on(table.bookingId),
    createdAtIdx: index("pricing_history_created_idx").on(table.createdAt),
  })
);

export type PricingHistoryRecord = typeof pricingHistory.$inferSelect;
export type InsertPricingHistory = typeof pricingHistory.$inferInsert;

/**
 * Seasonal Pricing
 * Defines seasonal price adjustments
 */
export const seasonalPricing = mysqlTable(
  "seasonal_pricing",
  {
    id: int("id").autoincrement().primaryKey(),

    name: varchar("name", { length: 255 }).notNull(), // e.g., "Hajj Season", "Summer Peak"
    nameAr: varchar("nameAr", { length: 255 }), // Arabic name

    // Date range
    startDate: timestamp("startDate").notNull(),
    endDate: timestamp("endDate").notNull(),

    // Multiplier
    multiplier: decimal("multiplier", { precision: 5, scale: 2 }).notNull(), // e.g., 1.50 = 50% increase

    // Scope
    airlineId: int("airlineId"), // Null = all airlines
    originId: int("originId"), // Null = all origins
    destinationId: int("destinationId"), // Null = all destinations

    // Status
    isActive: boolean("isActive").default(true).notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    dateRangeIdx: index("seasonal_pricing_dates_idx").on(
      table.startDate,
      table.endDate
    ),
    activeIdx: index("seasonal_pricing_active_idx").on(table.isActive),
  })
);

export type SeasonalPricingRecord = typeof seasonalPricing.$inferSelect;
export type InsertSeasonalPricing = typeof seasonalPricing.$inferInsert;

/**
 * Currencies
 * Supported currencies for multi-currency transactions
 */
export const currencies = mysqlTable(
  "currencies",
  {
    id: int("id").autoincrement().primaryKey(),

    code: varchar("code", { length: 3 }).notNull().unique(), // ISO 4217 code
    name: varchar("name", { length: 100 }).notNull(),
    nameAr: varchar("nameAr", { length: 100 }),
    symbol: varchar("symbol", { length: 10 }).notNull(),
    decimalPlaces: int("decimalPlaces").default(2).notNull(),

    // Display settings
    symbolPosition: mysqlEnum("symbolPosition", ["before", "after"])
      .default("before")
      .notNull(),
    thousandsSeparator: varchar("thousandsSeparator", { length: 1 }).default(
      ","
    ),
    decimalSeparator: varchar("decimalSeparator", { length: 1 }).default("."),

    // Status
    isActive: boolean("isActive").default(true).notNull(),
    isBaseCurrency: boolean("isBaseCurrency").default(false).notNull(), // SAR is base

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeIdx: index("currencies_code_idx").on(table.code),
    activeIdx: index("currencies_active_idx").on(table.isActive),
  })
);

export type Currency = typeof currencies.$inferSelect;
export type InsertCurrency = typeof currencies.$inferInsert;

/**
 * Exchange Rates
 * Stores exchange rates between currencies
 */
export const exchangeRates = mysqlTable(
  "exchange_rates",
  {
    id: int("id").autoincrement().primaryKey(),

    fromCurrency: varchar("fromCurrency", { length: 3 }).notNull(),
    toCurrency: varchar("toCurrency", { length: 3 }).notNull(),
    rate: decimal("rate", { precision: 18, scale: 8 }).notNull(),

    // Source of the rate
    source: varchar("source", { length: 100 }), // e.g., "openexchangerates", "manual"

    // Validity
    validFrom: timestamp("validFrom").defaultNow().notNull(),
    validTo: timestamp("validTo"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    currencyPairIdx: index("exchange_rates_pair_idx").on(
      table.fromCurrency,
      table.toCurrency
    ),
    validFromIdx: index("exchange_rates_valid_idx").on(table.validFrom),
  })
);

export type ExchangeRateRecord = typeof exchangeRates.$inferSelect;
export type InsertExchangeRate = typeof exchangeRates.$inferInsert;

/**
 * Seat Holds
 * Temporary seat reservations before payment
 */
export const seatHolds = mysqlTable(
  "seat_holds",
  {
    id: int("id").autoincrement().primaryKey(),

    flightId: int("flightId").notNull(),
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),
    seats: int("seats").notNull(),

    // User/session reference
    userId: int("userId"),
    sessionId: varchar("sessionId", { length: 255 }).notNull(),

    // Status
    status: mysqlEnum("status", ["active", "converted", "expired", "released"])
      .default("active")
      .notNull(),

    // Expiration
    expiresAt: timestamp("expiresAt").notNull(),

    // Conversion reference
    bookingId: int("bookingId"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    flightIdx: index("seat_holds_flight_idx").on(table.flightId),
    userIdx: index("seat_holds_user_idx").on(table.userId),
    sessionIdx: index("seat_holds_session_idx").on(table.sessionId),
    statusIdx: index("seat_holds_status_idx").on(table.status),
    expiresIdx: index("seat_holds_expires_idx").on(table.expiresAt),
  })
);

export type SeatHold = typeof seatHolds.$inferSelect;
export type InsertSeatHold = typeof seatHolds.$inferInsert;

/**
 * Waitlist
 * Manages waitlist for fully booked flights
 */
export const waitlist = mysqlTable(
  "waitlist",
  {
    id: int("id").autoincrement().primaryKey(),

    flightId: int("flightId").notNull(),
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),

    userId: int("userId").notNull(),
    seats: int("seats").notNull(),

    // Priority (lower = higher priority)
    priority: int("priority").notNull(),

    // Status
    status: mysqlEnum("status", [
      "waiting",
      "offered",
      "confirmed",
      "expired",
      "cancelled",
    ])
      .default("waiting")
      .notNull(),

    // Offer details
    offeredAt: timestamp("offeredAt"),
    offerExpiresAt: timestamp("offerExpiresAt"),
    confirmedAt: timestamp("confirmedAt"),

    // Contact preferences
    notifyByEmail: boolean("notifyByEmail").default(true).notNull(),
    notifyBySms: boolean("notifyBySms").default(false).notNull(),

    // Resulting booking
    bookingId: int("bookingId"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    flightIdx: index("waitlist_flight_idx").on(table.flightId),
    userIdx: index("waitlist_user_idx").on(table.userId),
    statusIdx: index("waitlist_status_idx").on(table.status),
    priorityIdx: index("waitlist_priority_idx").on(
      table.flightId,
      table.cabinClass,
      table.priority
    ),
  })
);

export type WaitlistEntry = typeof waitlist.$inferSelect;
export type InsertWaitlistEntry = typeof waitlist.$inferInsert;

/**
 * Overbooking Configuration
 * Per-route overbooking settings
 */
export const overbookingConfig = mysqlTable(
  "overbooking_config",
  {
    id: int("id").autoincrement().primaryKey(),

    // Scope
    airlineId: int("airlineId"), // Null = all airlines
    originId: int("originId"), // Null = all origins
    destinationId: int("destinationId"), // Null = all destinations

    // Overbooking rates
    economyRate: decimal("economyRate", { precision: 5, scale: 4 })
      .default("0.05")
      .notNull(), // 5%
    businessRate: decimal("businessRate", { precision: 5, scale: 4 })
      .default("0.02")
      .notNull(), // 2%
    maxOverbooking: int("maxOverbooking").default(10).notNull(),

    // Historical data
    historicalNoShowRate: decimal("historicalNoShowRate", {
      precision: 5,
      scale: 4,
    }),

    // Status
    isActive: boolean("isActive").default(true).notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    routeIdx: index("overbooking_route_idx").on(
      table.originId,
      table.destinationId
    ),
    airlineIdx: index("overbooking_airline_idx").on(table.airlineId),
    activeIdx: index("overbooking_active_idx").on(table.isActive),
  })
);

export type OverbookingConfigRecord = typeof overbookingConfig.$inferSelect;
export type InsertOverbookingConfig = typeof overbookingConfig.$inferInsert;

/**
 * Inventory Snapshots
 * Daily snapshots of inventory for analytics
 */
export const inventorySnapshots = mysqlTable(
  "inventory_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),

    flightId: int("flightId").notNull(),
    snapshotDate: timestamp("snapshotDate").notNull(),

    // Economy class
    economyTotal: int("economyTotal").notNull(),
    economySold: int("economySold").notNull(),
    economyHeld: int("economyHeld").notNull(),
    economyAvailable: int("economyAvailable").notNull(),
    economyWaitlist: int("economyWaitlist").notNull(),

    // Business class
    businessTotal: int("businessTotal").notNull(),
    businessSold: int("businessSold").notNull(),
    businessHeld: int("businessHeld").notNull(),
    businessAvailable: int("businessAvailable").notNull(),
    businessWaitlist: int("businessWaitlist").notNull(),

    // Pricing at snapshot time
    economyPrice: int("economyPrice").notNull(),
    businessPrice: int("businessPrice").notNull(),

    // Days until departure
    daysUntilDeparture: int("daysUntilDeparture").notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    flightIdx: index("inventory_snapshots_flight_idx").on(table.flightId),
    dateIdx: index("inventory_snapshots_date_idx").on(table.snapshotDate),
    flightDateIdx: index("inventory_snapshots_flight_date_idx").on(
      table.flightId,
      table.snapshotDate
    ),
  })
);

export type InventorySnapshot = typeof inventorySnapshots.$inferSelect;
export type InsertInventorySnapshot = typeof inventorySnapshots.$inferInsert;

/**
 * Denied Boarding Records
 * Tracks denied boarding incidents for overbooking
 */
export const deniedBoardingRecords = mysqlTable(
  "denied_boarding_records",
  {
    id: int("id").autoincrement().primaryKey(),

    flightId: int("flightId").notNull(),
    bookingId: int("bookingId").notNull(),
    userId: int("userId").notNull(),

    // Type
    type: mysqlEnum("type", ["voluntary", "involuntary"]).notNull(),

    // Compensation
    compensationAmount: int("compensationAmount").notNull(), // In cents
    compensationCurrency: varchar("compensationCurrency", { length: 3 })
      .default("SAR")
      .notNull(),
    compensationType: mysqlEnum("compensationType", [
      "cash",
      "voucher",
      "miles",
    ]).notNull(),

    // Alternative flight
    alternativeFlightId: int("alternativeFlightId"),

    // Status
    status: mysqlEnum("status", [
      "pending",
      "accepted",
      "rejected",
      "completed",
    ])
      .default("pending")
      .notNull(),

    // Notes
    notes: text("notes"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    flightIdx: index("denied_boarding_flight_idx").on(table.flightId),
    userIdx: index("denied_boarding_user_idx").on(table.userId),
    statusIdx: index("denied_boarding_status_idx").on(table.status),
  })
);

export type DeniedBoardingRecord = typeof deniedBoardingRecords.$inferSelect;
export type InsertDeniedBoardingRecord =
  typeof deniedBoardingRecords.$inferInsert;

// ============================================================================
// GDPR Compliance Tables
// ============================================================================

/**
 * User Consent Records
 * Tracks user consent preferences for GDPR compliance
 */
export const userConsents = mysqlTable(
  "user_consents",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),

    // Marketing consent
    marketingEmails: boolean("marketingEmails").default(false).notNull(),
    marketingSms: boolean("marketingSms").default(false).notNull(),
    marketingPush: boolean("marketingPush").default(false).notNull(),

    // Analytics consent
    analyticsTracking: boolean("analyticsTracking").default(false).notNull(),
    performanceCookies: boolean("performanceCookies").default(false).notNull(),

    // Third-party data sharing
    thirdPartySharing: boolean("thirdPartySharing").default(false).notNull(),
    partnerOffers: boolean("partnerOffers").default(false).notNull(),

    // Essential consent (always true for service operation)
    essentialCookies: boolean("essentialCookies").default(true).notNull(),

    // Personalization
    personalizedAds: boolean("personalizedAds").default(false).notNull(),
    personalizedContent: boolean("personalizedContent")
      .default(false)
      .notNull(),

    // Consent metadata
    consentVersion: varchar("consentVersion", { length: 20 })
      .default("1.0")
      .notNull(),
    ipAddressAtConsent: varchar("ipAddressAtConsent", { length: 45 }),
    userAgentAtConsent: text("userAgentAtConsent"),

    // Timestamps
    consentGivenAt: timestamp("consentGivenAt").defaultNow().notNull(),
    lastUpdatedAt: timestamp("lastUpdatedAt")
      .defaultNow()
      .onUpdateNow()
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_consents_user_id_idx").on(table.userId),
    consentVersionIdx: index("user_consents_version_idx").on(
      table.consentVersion
    ),
  })
);

export type UserConsent = typeof userConsents.$inferSelect;
export type InsertUserConsent = typeof userConsents.$inferInsert;

/**
 * Consent Change History
 * Audit trail of all consent changes for compliance reporting
 */
export const consentHistory = mysqlTable(
  "consent_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Change details
    consentType: varchar("consentType", { length: 50 }).notNull(), // e.g., "marketingEmails", "analyticsTracking"
    previousValue: boolean("previousValue"),
    newValue: boolean("newValue").notNull(),

    // Request context
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),

    // Consent version at time of change
    consentVersion: varchar("consentVersion", { length: 20 }).notNull(),

    // Change reason
    changeReason: mysqlEnum("changeReason", [
      "user_update",
      "initial_consent",
      "withdrawal",
      "account_deletion",
      "system_update",
    ])
      .default("user_update")
      .notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("consent_history_user_id_idx").on(table.userId),
    consentTypeIdx: index("consent_history_type_idx").on(table.consentType),
    createdAtIdx: index("consent_history_created_at_idx").on(table.createdAt),
  })
);

export type ConsentHistoryRecord = typeof consentHistory.$inferSelect;
export type InsertConsentHistory = typeof consentHistory.$inferInsert;

/**
 * Data Export Requests
 * Tracks user data export requests (GDPR Article 20 - Right to Data Portability)
 */
export const dataExportRequests = mysqlTable(
  "data_export_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Request status
    status: mysqlEnum("status", [
      "pending",
      "processing",
      "completed",
      "failed",
      "expired",
    ])
      .default("pending")
      .notNull(),

    // Export format
    format: mysqlEnum("format", ["json", "csv"]).default("json").notNull(),

    // Export details
    downloadUrl: text("downloadUrl"), // Temporary signed URL
    downloadExpiresAt: timestamp("downloadExpiresAt"),
    fileSizeBytes: int("fileSizeBytes"),

    // Request context
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),

    // Error tracking
    errorMessage: text("errorMessage"),

    // Timestamps
    requestedAt: timestamp("requestedAt").defaultNow().notNull(),
    processedAt: timestamp("processedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("data_export_requests_user_id_idx").on(table.userId),
    statusIdx: index("data_export_requests_status_idx").on(table.status),
    requestedAtIdx: index("data_export_requests_requested_at_idx").on(
      table.requestedAt
    ),
  })
);

export type DataExportRequest = typeof dataExportRequests.$inferSelect;
export type InsertDataExportRequest = typeof dataExportRequests.$inferInsert;

/**
 * Account Deletion Requests
 * Tracks user account deletion requests (GDPR Article 17 - Right to Erasure)
 */
export const accountDeletionRequests = mysqlTable(
  "account_deletion_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Request status
    status: mysqlEnum("status", [
      "pending",
      "processing",
      "completed",
      "cancelled",
      "failed",
    ])
      .default("pending")
      .notNull(),

    // Deletion type
    deletionType: mysqlEnum("deletionType", ["full", "anonymize"])
      .default("anonymize")
      .notNull(),

    // Reason for deletion
    reason: text("reason"),

    // Request context
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),

    // Confirmation
    confirmationToken: varchar("confirmationToken", { length: 64 }),
    confirmedAt: timestamp("confirmedAt"),

    // Processing details
    dataAnonymizedAt: timestamp("dataAnonymizedAt"),
    errorMessage: text("errorMessage"),

    // Scheduled deletion (grace period)
    scheduledDeletionAt: timestamp("scheduledDeletionAt"),

    // Timestamps
    requestedAt: timestamp("requestedAt").defaultNow().notNull(),
    processedAt: timestamp("processedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("account_deletion_requests_user_id_idx").on(table.userId),
    statusIdx: index("account_deletion_requests_status_idx").on(table.status),
    scheduledIdx: index("account_deletion_requests_scheduled_idx").on(
      table.scheduledDeletionAt
    ),
  })
);

export type AccountDeletionRequest =
  typeof accountDeletionRequests.$inferSelect;
export type InsertAccountDeletionRequest =
  typeof accountDeletionRequests.$inferInsert;

// ============================================================================
// Group Bookings System
// ============================================================================

/**
 * Group Bookings table
 * Handles booking requests for groups (10+ passengers) with special pricing
 */
export const groupBookings = mysqlTable(
  "group_bookings",
  {
    id: int("id").autoincrement().primaryKey(),

    // Organizer information
    organizerName: varchar("organizerName", { length: 255 }).notNull(),
    organizerEmail: varchar("organizerEmail", { length: 320 }).notNull(),
    organizerPhone: varchar("organizerPhone", { length: 20 }).notNull(),

    // Group details
    groupSize: int("groupSize").notNull(), // Minimum 10 passengers

    // Flight reference
    flightId: int("flightId").notNull(),

    // Status tracking
    status: mysqlEnum("status", ["pending", "confirmed", "cancelled"])
      .default("pending")
      .notNull(),

    // Pricing
    discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }), // e.g., 5.00, 10.00, 15.00
    totalPrice: int("totalPrice"), // Total price in SAR cents after discount

    // Additional information
    notes: text("notes"), // Special requests or admin notes
    rejectionReason: text("rejectionReason"), // Reason if rejected

    // Audit fields
    approvedBy: int("approvedBy"), // Admin user ID who approved
    approvedAt: timestamp("approvedAt"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Index for organizer email lookups
    organizerEmailIdx: index("group_bookings_organizer_email_idx").on(
      table.organizerEmail
    ),
    // Index for flight-based queries
    flightIdIdx: index("group_bookings_flight_id_idx").on(table.flightId),
    // Index for status filtering (admin panels)
    statusIdx: index("group_bookings_status_idx").on(table.status),
    // Index for creation date sorting
    createdAtIdx: index("group_bookings_created_at_idx").on(table.createdAt),
    // Composite index for status + date (admin filtering)
    statusCreatedAtIdx: index("group_bookings_status_created_at_idx").on(
      table.status,
      table.createdAt
    ),
  })
);

export type GroupBooking = typeof groupBookings.$inferSelect;
export type InsertGroupBooking = typeof groupBookings.$inferInsert;

// ============================================================================
// Special Services System
// ============================================================================

/**
 * Special Services
 * Tracks special service requests for passengers (meals, wheelchair, UMNR, etc.)
 */
export const specialServices = mysqlTable(
  "special_services",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    passengerId: int("passengerId").notNull(),

    // Service identification
    serviceType: mysqlEnum("serviceType", [
      "meal",
      "wheelchair",
      "unaccompanied_minor",
      "extra_legroom",
      "pet_in_cabin",
      "medical_assistance",
    ]).notNull(),

    // Service code (IATA standard codes where applicable)
    serviceCode: varchar("serviceCode", { length: 20 }).notNull(),
    // Examples:
    // Meals: VGML (vegetarian), VVML (vegan), MOML (Muslim/halal), KSML (kosher), GFML (gluten-free), DBML (diabetic), CHML (child)
    // Wheelchair: WCHR (can walk short distance), WCHS (cannot walk, can climb stairs), WCHC (immobile)
    // UMNR: UMNR (unaccompanied minor)
    // Pet: PETC (pet in cabin)
    // Medical: MEDA (medical assistance)
    // Extra legroom: EXST (extra seat)

    // Additional details (JSON for flexibility)
    details: text("details"), // JSON: additional information like age for UMNR, pet type, medical equipment, etc.

    // Request status
    status: mysqlEnum("status", [
      "pending",
      "confirmed",
      "rejected",
      "cancelled",
    ])
      .default("pending")
      .notNull(),

    // Admin notes for rejection reasons or special handling
    adminNotes: text("adminNotes"),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("special_services_booking_id_idx").on(table.bookingId),
    passengerIdIdx: index("special_services_passenger_id_idx").on(
      table.passengerId
    ),
    serviceTypeIdx: index("special_services_type_idx").on(table.serviceType),
    serviceCodeIdx: index("special_services_code_idx").on(table.serviceCode),
    statusIdx: index("special_services_status_idx").on(table.status),
    // Composite index for booking + passenger lookups
    bookingPassengerIdx: index("special_services_booking_passenger_idx").on(
      table.bookingId,
      table.passengerId
    ),
  })
);

export type SpecialService = typeof specialServices.$inferSelect;
export type InsertSpecialService = typeof specialServices.$inferInsert;

// ============================================================================
// User Flight Favorites & Price Alerts
// ============================================================================

/**
 * User Flight Favorites
 * Allows users to favorite specific individual flights
 */
export const userFlightFavorites = mysqlTable(
  "user_flight_favorites",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    flightId: int("flightId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_flight_favorites_user_id_idx").on(table.userId),
    flightIdIdx: index("user_flight_favorites_flight_id_idx").on(
      table.flightId
    ),
    // Unique constraint: one favorite per user per flight
    userFlightUnique: index("user_flight_favorites_unique_idx").on(
      table.userId,
      table.flightId
    ),
  })
);

export type UserFlightFavorite = typeof userFlightFavorites.$inferSelect;
export type InsertUserFlightFavorite = typeof userFlightFavorites.$inferInsert;

/**
 * Price Alerts
 * Standalone price alerts for routes (separate from favorites)
 */
export const priceAlerts = mysqlTable(
  "price_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    originId: int("originId").notNull(),
    destinationId: int("destinationId").notNull(),
    targetPrice: int("targetPrice").notNull(), // Price in SAR cents
    currentPrice: int("currentPrice"), // Last checked price in SAR cents
    isActive: boolean("isActive").default(true).notNull(),
    lastChecked: timestamp("lastChecked"),
    notifiedAt: timestamp("notifiedAt"), // When user was last notified
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"])
      .default("economy")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("price_alerts_user_id_idx").on(table.userId),
    routeIdx: index("price_alerts_route_idx").on(
      table.originId,
      table.destinationId
    ),
    activeIdx: index("price_alerts_active_idx").on(table.isActive),
    lastCheckedIdx: index("price_alerts_last_checked_idx").on(
      table.lastChecked
    ),
    // Unique constraint: one alert per user per route per cabin class
    userRouteUnique: index("price_alerts_user_route_unique_idx").on(
      table.userId,
      table.originId,
      table.destinationId,
      table.cabinClass
    ),
  })
);

export type PriceAlert = typeof priceAlerts.$inferSelect;
export type InsertPriceAlert = typeof priceAlerts.$inferInsert;

// ============================================================================
// In-App Notifications System
// ============================================================================

/**
 * Notifications table
 * Stores in-app notifications for users
 */
export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Notification type
    type: mysqlEnum("type", [
      "booking",
      "flight",
      "payment",
      "promo",
      "system",
    ]).notNull(),

    // Content
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),

    // Additional data (JSON for flexibility - booking IDs, flight details, etc.)
    data: text("data"), // JSON stringified additional data

    // Read status
    isRead: boolean("isRead").default(false).notNull(),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    readAt: timestamp("readAt"),
  },
  table => ({
    userIdIdx: index("notifications_user_id_idx").on(table.userId),
    typeIdx: index("notifications_type_idx").on(table.type),
    isReadIdx: index("notifications_is_read_idx").on(table.isRead),
    createdAtIdx: index("notifications_created_at_idx").on(table.createdAt),
    // Composite index for common queries: user's unread notifications sorted by date
    userUnreadIdx: index("notifications_user_unread_idx").on(
      table.userId,
      table.isRead,
      table.createdAt
    ),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ============================================================================
// Multi-City Booking System
// ============================================================================

/**
 * Booking Segments table
 * Stores individual flight segments for multi-city bookings
 */
export const bookingSegments = mysqlTable(
  "booking_segments",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    segmentOrder: int("segmentOrder").notNull(), // Order of segment in the trip (1, 2, 3, etc.)
    flightId: int("flightId").notNull(),
    departureDate: timestamp("departureDate").notNull(),
    status: mysqlEnum("status", [
      "pending",
      "confirmed",
      "cancelled",
      "completed",
    ])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Index for booking-based queries
    bookingIdIdx: index("booking_segments_booking_id_idx").on(table.bookingId),
    // Index for flight-based queries
    flightIdIdx: index("booking_segments_flight_id_idx").on(table.flightId),
    // Composite index for booking + order
    bookingOrderIdx: index("booking_segments_booking_order_idx").on(
      table.bookingId,
      table.segmentOrder
    ),
    // Index for status filtering
    statusIdx: index("booking_segments_status_idx").on(table.status),
  })
);

export type BookingSegment = typeof bookingSegments.$inferSelect;
export type InsertBookingSegment = typeof bookingSegments.$inferInsert;

// ============================================================================
// Baggage Handling & Tracking System
// ============================================================================

/**
 * Baggage Items table
 * Tracks individual baggage items for passengers
 */
export const baggageItems = mysqlTable(
  "baggage_items",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),
    passengerId: int("passengerId").notNull(),
    tagNumber: varchar("tagNumber", { length: 20 }).notNull().unique(), // Unique baggage tag (e.g., "AIS123456")
    weight: decimal("weight", { precision: 5, scale: 2 }).notNull(), // Weight in kg
    status: mysqlEnum("status", [
      "checked_in",
      "security_screening",
      "loading",
      "in_transit",
      "arrived",
      "customs",
      "ready_for_pickup",
      "claimed",
      "lost",
      "found",
      "damaged",
    ])
      .default("checked_in")
      .notNull(),
    lastLocation: varchar("lastLocation", { length: 255 }), // Last known location (e.g., "JED Terminal 1 Belt 3")
    description: text("description"), // Baggage description (color, size, brand)
    specialHandling: text("specialHandling"), // Special handling instructions (fragile, oversized, etc.)
    lostReportedAt: timestamp("lostReportedAt"), // When baggage was reported lost
    lostDescription: text("lostDescription"), // Description for lost baggage report
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("baggage_items_booking_id_idx").on(table.bookingId),
    passengerIdIdx: index("baggage_items_passenger_id_idx").on(
      table.passengerId
    ),
    tagNumberIdx: index("baggage_items_tag_number_idx").on(table.tagNumber),
    statusIdx: index("baggage_items_status_idx").on(table.status),
    // Composite index for booking + passenger lookups
    bookingPassengerIdx: index("baggage_items_booking_passenger_idx").on(
      table.bookingId,
      table.passengerId
    ),
    // Index for lost baggage queries
    lostStatusIdx: index("baggage_items_lost_status_idx").on(
      table.status,
      table.lostReportedAt
    ),
  })
);

export type BaggageItem = typeof baggageItems.$inferSelect;
export type InsertBaggageItem = typeof baggageItems.$inferInsert;

/**
 * Baggage Tracking table
 * Tracks all location and status updates for baggage items
 */
export const baggageTracking = mysqlTable(
  "baggage_tracking",
  {
    id: int("id").autoincrement().primaryKey(),
    baggageId: int("baggageId").notNull(), // References baggageItems.id
    location: varchar("location", { length: 255 }).notNull(), // Location where scanned (e.g., "JED Terminal 1 Check-in")
    status: mysqlEnum("status", [
      "checked_in",
      "security_screening",
      "loading",
      "in_transit",
      "arrived",
      "customs",
      "ready_for_pickup",
      "claimed",
      "lost",
      "found",
      "damaged",
    ]).notNull(),
    scannedAt: timestamp("scannedAt").defaultNow().notNull(),
    scannedBy: int("scannedBy"), // User ID of the handler who scanned (nullable for automated scans)
    notes: text("notes"), // Additional notes about the scan/status update
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    baggageIdIdx: index("baggage_tracking_baggage_id_idx").on(table.baggageId),
    statusIdx: index("baggage_tracking_status_idx").on(table.status),
    scannedAtIdx: index("baggage_tracking_scanned_at_idx").on(table.scannedAt),
    scannedByIdx: index("baggage_tracking_scanned_by_idx").on(table.scannedBy),
    // Composite index for baggage timeline queries
    baggageTimelineIdx: index("baggage_tracking_baggage_timeline_idx").on(
      table.baggageId,
      table.scannedAt
    ),
  })
);

export type BaggageTracking = typeof baggageTracking.$inferSelect;
export type InsertBaggageTracking = typeof baggageTracking.$inferInsert;

// ============================================================================
// Split Payments System
// ============================================================================

/**
 * Payment Splits
 * Allows a booking payment to be split among multiple payers
 */
export const paymentSplits = mysqlTable(
  "payment_splits",
  {
    id: int("id").autoincrement().primaryKey(),
    bookingId: int("bookingId").notNull(),

    // Payer information
    payerEmail: varchar("payerEmail", { length: 320 }).notNull(),
    payerName: varchar("payerName", { length: 255 }).notNull(),

    // Payment details
    amount: int("amount").notNull(), // Amount in SAR cents
    percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(), // e.g., 33.33%

    // Status tracking
    status: mysqlEnum("status", [
      "pending",
      "email_sent",
      "paid",
      "failed",
      "cancelled",
      "expired",
    ])
      .default("pending")
      .notNull(),

    // Stripe payment reference
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
    stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", {
      length: 255,
    }),

    // Payment token for payer access (unique link)
    paymentToken: varchar("paymentToken", { length: 64 }).notNull().unique(),

    // Timestamps
    paidAt: timestamp("paidAt"),
    emailSentAt: timestamp("emailSentAt"),
    expiresAt: timestamp("expiresAt"), // Payment request expiration
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    bookingIdIdx: index("payment_splits_booking_id_idx").on(table.bookingId),
    payerEmailIdx: index("payment_splits_payer_email_idx").on(table.payerEmail),
    statusIdx: index("payment_splits_status_idx").on(table.status),
    paymentTokenIdx: index("payment_splits_token_idx").on(table.paymentToken),
    // Composite index for booking + status queries
    bookingStatusIdx: index("payment_splits_booking_status_idx").on(
      table.bookingId,
      table.status
    ),
    // Index for expiration queries
    expiresAtIdx: index("payment_splits_expires_at_idx").on(table.expiresAt),
    // Stripe session lookup
    stripeCheckoutIdx: index("payment_splits_stripe_checkout_idx").on(
      table.stripeCheckoutSessionId
    ),
  })
);

export type PaymentSplit = typeof paymentSplits.$inferSelect;
export type InsertPaymentSplit = typeof paymentSplits.$inferInsert;

// Export chat and notification schemas
export * from "./chat-schema";

// ============================================================================
// Saved Passengers
// ============================================================================

/**
 * Saved Passengers table
 * Stores user's saved passenger profiles for quick booking
 */
export const savedPassengers = mysqlTable(
  "saved_passengers",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Passenger details
    firstName: varchar("firstName", { length: 100 }).notNull(),
    lastName: varchar("lastName", { length: 100 }).notNull(),
    dateOfBirth: timestamp("dateOfBirth"),
    nationality: varchar("nationality", { length: 100 }),

    // Passport information
    passportNumber: varchar("passportNumber", { length: 50 }),
    passportExpiry: timestamp("passportExpiry"),

    // Contact information
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 20 }),

    // Default flag
    isDefault: boolean("isDefault").default(false).notNull(),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("saved_passengers_user_id_idx").on(table.userId),
    // Index for default passenger lookup
    userDefaultIdx: index("saved_passengers_user_default_idx").on(
      table.userId,
      table.isDefault
    ),
    // Index for name search
    nameIdx: index("saved_passengers_name_idx").on(
      table.lastName,
      table.firstName
    ),
  })
);

export type SavedPassenger = typeof savedPassengers.$inferSelect;
export type InsertSavedPassenger = typeof savedPassengers.$inferInsert;

// ============================================================================
// Corporate Travel Accounts System
// ============================================================================

/**
 * Corporate Accounts table
 * Manages corporate/business travel accounts with credit limits and discounts
 */
export const corporateAccounts = mysqlTable(
  "corporate_accounts",
  {
    id: int("id").autoincrement().primaryKey(),

    // Company information
    companyName: varchar("companyName", { length: 255 }).notNull(),
    taxId: varchar("taxId", { length: 50 }).notNull().unique(), // Company tax ID / registration number
    address: text("address"),

    // Primary contact
    contactName: varchar("contactName", { length: 255 }).notNull(),
    contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
    contactPhone: varchar("contactPhone", { length: 20 }),

    // Financial settings
    creditLimit: int("creditLimit").notNull().default(0), // Credit limit in SAR cents
    balance: int("balance").notNull().default(0), // Current balance (negative = credit used)
    discountPercent: decimal("discountPercent", { precision: 5, scale: 2 })
      .default("0.00")
      .notNull(), // Corporate discount percentage

    // Account status
    status: mysqlEnum("status", ["pending", "active", "suspended", "closed"])
      .default("pending")
      .notNull(),

    // Approval tracking
    approvedBy: int("approvedBy"), // Admin user ID who approved
    approvedAt: timestamp("approvedAt"),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    companyNameIdx: index("corporate_accounts_company_name_idx").on(
      table.companyName
    ),
    taxIdIdx: index("corporate_accounts_tax_id_idx").on(table.taxId),
    statusIdx: index("corporate_accounts_status_idx").on(table.status),
    contactEmailIdx: index("corporate_accounts_contact_email_idx").on(
      table.contactEmail
    ),
    createdAtIdx: index("corporate_accounts_created_at_idx").on(
      table.createdAt
    ),
  })
);

export type CorporateAccount = typeof corporateAccounts.$inferSelect;
export type InsertCorporateAccount = typeof corporateAccounts.$inferInsert;

/**
 * Corporate Users table
 * Links users to corporate accounts with roles
 */
export const corporateUsers = mysqlTable(
  "corporate_users",
  {
    id: int("id").autoincrement().primaryKey(),

    // Account and user reference
    corporateAccountId: int("corporateAccountId").notNull(),
    userId: int("userId").notNull(),

    // Role within the corporate account
    role: mysqlEnum("role", ["admin", "booker", "traveler"])
      .default("traveler")
      .notNull(),
    // admin: Can manage users and view all bookings
    // booker: Can book for others in the company
    // traveler: Can only book for themselves

    // Status
    isActive: boolean("isActive").default(true).notNull(),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    corporateAccountIdIdx: index("corporate_users_account_id_idx").on(
      table.corporateAccountId
    ),
    userIdIdx: index("corporate_users_user_id_idx").on(table.userId),
    roleIdx: index("corporate_users_role_idx").on(table.role),
    // Unique constraint: one user can only be in one corporate account
    userAccountUnique: index("corporate_users_user_account_unique_idx").on(
      table.userId,
      table.corporateAccountId
    ),
    isActiveIdx: index("corporate_users_is_active_idx").on(table.isActive),
  })
);

export type CorporateUser = typeof corporateUsers.$inferSelect;
export type InsertCorporateUser = typeof corporateUsers.$inferInsert;

/**
 * Corporate Bookings table
 * Links bookings to corporate accounts with approval workflow
 */
export const corporateBookings = mysqlTable(
  "corporate_bookings",
  {
    id: int("id").autoincrement().primaryKey(),

    // Corporate account reference
    corporateAccountId: int("corporateAccountId").notNull(),

    // Booking reference
    bookingId: int("bookingId").notNull().unique(),

    // Corporate tracking fields
    costCenter: varchar("costCenter", { length: 50 }), // Cost center code for accounting
    projectCode: varchar("projectCode", { length: 50 }), // Project/department code
    travelPurpose: text("travelPurpose"), // Business reason for travel

    // Approval workflow
    approvalStatus: mysqlEnum("approvalStatus", [
      "pending",
      "approved",
      "rejected",
    ])
      .default("pending")
      .notNull(),
    approvedBy: int("approvedBy"), // Corporate admin user ID who approved
    approvedAt: timestamp("approvedAt"),
    rejectionReason: text("rejectionReason"),

    // Booked by (may be different from traveler)
    bookedByUserId: int("bookedByUserId").notNull(),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    corporateAccountIdIdx: index("corporate_bookings_account_id_idx").on(
      table.corporateAccountId
    ),
    bookingIdIdx: index("corporate_bookings_booking_id_idx").on(
      table.bookingId
    ),
    approvalStatusIdx: index("corporate_bookings_approval_status_idx").on(
      table.approvalStatus
    ),
    costCenterIdx: index("corporate_bookings_cost_center_idx").on(
      table.costCenter
    ),
    projectCodeIdx: index("corporate_bookings_project_code_idx").on(
      table.projectCode
    ),
    bookedByUserIdIdx: index("corporate_bookings_booked_by_idx").on(
      table.bookedByUserId
    ),
    createdAtIdx: index("corporate_bookings_created_at_idx").on(
      table.createdAt
    ),
    // Composite index for common queries
    accountApprovalIdx: index("corporate_bookings_account_approval_idx").on(
      table.corporateAccountId,
      table.approvalStatus
    ),
  })
);

export type CorporateBooking = typeof corporateBookings.$inferSelect;
export type InsertCorporateBooking = typeof corporateBookings.$inferInsert;

/**
 * Travel Agents table
 * Represents travel agencies that can book flights via API
 */
export const travelAgents = mysqlTable(
  "travel_agents",
  {
    id: int("id").autoincrement().primaryKey(),
    agencyName: varchar("agencyName", { length: 255 }).notNull(),
    iataNumber: varchar("iataNumber", { length: 20 }).notNull().unique(), // IATA accreditation number
    contactName: varchar("contactName", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    phone: varchar("phone", { length: 50 }).notNull(),
    commissionRate: decimal("commissionRate", { precision: 5, scale: 2 })
      .default("5.00")
      .notNull(), // Commission percentage (e.g., 5.00 = 5%)
    // API credentials
    apiKey: varchar("apiKey", { length: 64 }).notNull().unique(), // Unique API key for authentication
    apiSecret: varchar("apiSecret", { length: 128 }).notNull(), // Hashed API secret
    // Status
    isActive: boolean("isActive").default(true).notNull(),
    // Rate limiting
    dailyBookingLimit: int("dailyBookingLimit").default(100).notNull(),
    monthlyBookingLimit: int("monthlyBookingLimit").default(2000).notNull(),
    // Statistics
    totalBookings: int("totalBookings").default(0).notNull(),
    totalRevenue: int("totalRevenue").default(0).notNull(), // In SAR cents
    totalCommission: int("totalCommission").default(0).notNull(), // In SAR cents
    // Timestamps
    lastActiveAt: timestamp("lastActiveAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    iataNumberIdx: index("travel_agents_iata_number_idx").on(table.iataNumber),
    emailIdx: index("travel_agents_email_idx").on(table.email),
    apiKeyIdx: index("travel_agents_api_key_idx").on(table.apiKey),
    isActiveIdx: index("travel_agents_is_active_idx").on(table.isActive),
    createdAtIdx: index("travel_agents_created_at_idx").on(table.createdAt),
  })
);

export type TravelAgent = typeof travelAgents.$inferSelect;
export type InsertTravelAgent = typeof travelAgents.$inferInsert;

/**
 * Agent Bookings table
 * Links bookings made by travel agents with commission tracking
 */
export const agentBookings = mysqlTable(
  "agent_bookings",
  {
    id: int("id").autoincrement().primaryKey(),
    agentId: int("agentId").notNull(),
    bookingId: int("bookingId").notNull().unique(),
    // Commission details
    commissionRate: decimal("commissionRate", {
      precision: 5,
      scale: 2,
    }).notNull(), // Rate at time of booking
    commissionAmount: int("commissionAmount").notNull(), // In SAR cents
    bookingAmount: int("bookingAmount").notNull(), // Original booking amount in SAR cents
    // Commission payment status
    commissionStatus: mysqlEnum("commissionStatus", [
      "pending",
      "approved",
      "paid",
      "cancelled",
    ])
      .default("pending")
      .notNull(),
    commissionPaidAt: timestamp("commissionPaidAt"),
    // External reference (agent's internal booking ID)
    externalReference: varchar("externalReference", { length: 100 }),
    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    agentIdIdx: index("agent_bookings_agent_id_idx").on(table.agentId),
    bookingIdIdx: index("agent_bookings_booking_id_idx").on(table.bookingId),
    commissionStatusIdx: index("agent_bookings_commission_status_idx").on(
      table.commissionStatus
    ),
    createdAtIdx: index("agent_bookings_created_at_idx").on(table.createdAt),
    // Composite index for agent commission queries
    agentCommissionIdx: index("agent_bookings_agent_commission_idx").on(
      table.agentId,
      table.commissionStatus
    ),
  })
);

export type AgentBooking = typeof agentBookings.$inferSelect;
export type InsertAgentBooking = typeof agentBookings.$inferInsert;

// ============================================================================
// SMS Notification Logs
// ============================================================================

/**
 * SMS Logs table
 * Tracks all SMS notifications sent through the system
 */
export const smsLogs = mysqlTable(
  "sms_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"), // Nullable for system-generated SMS

    // Recipient details
    phoneNumber: varchar("phoneNumber", { length: 20 }).notNull(),

    // Message content
    message: text("message").notNull(),

    // Message type/category
    type: mysqlEnum("type", [
      "booking_confirmation",
      "flight_reminder",
      "flight_status",
      "boarding_pass",
      "check_in_reminder",
      "payment_received",
      "refund_processed",
      "loyalty_update",
      "promotional",
      "system",
    ]).notNull(),

    // Status tracking
    status: mysqlEnum("status", [
      "pending",
      "sent",
      "delivered",
      "failed",
      "rejected",
    ])
      .default("pending")
      .notNull(),

    // Provider information
    provider: varchar("provider", { length: 50 }).notNull(), // e.g., "twilio", "mock"
    providerMessageId: varchar("providerMessageId", { length: 128 }), // External message ID from provider

    // Error handling
    errorMessage: text("errorMessage"),
    retryCount: int("retryCount").default(0).notNull(),

    // Related entities
    bookingId: int("bookingId"),
    flightId: int("flightId"),

    // Template used
    templateId: varchar("templateId", { length: 64 }),

    // Timing
    sentAt: timestamp("sentAt"),
    deliveredAt: timestamp("deliveredAt"),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("sms_logs_user_id_idx").on(table.userId),
    phoneNumberIdx: index("sms_logs_phone_number_idx").on(table.phoneNumber),
    typeIdx: index("sms_logs_type_idx").on(table.type),
    statusIdx: index("sms_logs_status_idx").on(table.status),
    providerIdx: index("sms_logs_provider_idx").on(table.provider),
    sentAtIdx: index("sms_logs_sent_at_idx").on(table.sentAt),
    bookingIdIdx: index("sms_logs_booking_id_idx").on(table.bookingId),
    createdAtIdx: index("sms_logs_created_at_idx").on(table.createdAt),
    // Composite index for user SMS history
    userCreatedAtIdx: index("sms_logs_user_created_at_idx").on(
      table.userId,
      table.createdAt
    ),
    // Composite index for admin status filtering
    statusCreatedAtIdx: index("sms_logs_status_created_at_idx").on(
      table.status,
      table.createdAt
    ),
  })
);

export type SMSLog = typeof smsLogs.$inferSelect;
export type InsertSMSLog = typeof smsLogs.$inferInsert;

// ============================================================================
// Gate Assignment System
// ============================================================================

/**
 * Airport Gates table
 * Stores information about gates at each airport
 */
export const airportGates = mysqlTable(
  "airport_gates",
  {
    id: int("id").autoincrement().primaryKey(),
    airportId: int("airportId").notNull(),
    gateNumber: varchar("gateNumber", { length: 10 }).notNull(), // e.g., "A1", "B12", "T1-G5"
    terminal: varchar("terminal", { length: 50 }), // e.g., "Terminal 1", "T1", "North"
    type: mysqlEnum("type", ["domestic", "international", "both"])
      .default("both")
      .notNull(),
    status: mysqlEnum("status", ["available", "occupied", "maintenance"])
      .default("available")
      .notNull(),
    capacity: varchar("capacity", { length: 50 }), // Aircraft size capability, e.g., "narrow-body", "wide-body"
    amenities: text("amenities"), // JSON array of amenities like "jet_bridge", "wheelchair_access"
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Index for airport-based queries
    airportIdIdx: index("airport_gates_airport_id_idx").on(table.airportId),
    // Index for gate number lookups
    gateNumberIdx: index("airport_gates_gate_number_idx").on(table.gateNumber),
    // Index for status filtering
    statusIdx: index("airport_gates_status_idx").on(table.status),
    // Index for type filtering
    typeIdx: index("airport_gates_type_idx").on(table.type),
    // Composite index for airport + status (finding available gates)
    airportStatusIdx: index("airport_gates_airport_status_idx").on(
      table.airportId,
      table.status
    ),
    // Composite index for airport + type (domestic/international filtering)
    airportTypeIdx: index("airport_gates_airport_type_idx").on(
      table.airportId,
      table.type
    ),
    // Unique constraint: one gate number per airport
    airportGateUnique: index("airport_gates_airport_gate_unique_idx").on(
      table.airportId,
      table.gateNumber
    ),
  })
);

export type AirportGate = typeof airportGates.$inferSelect;
export type InsertAirportGate = typeof airportGates.$inferInsert;

/**
 * Gate Assignments table
 * Tracks gate assignments for flights
 */
export const gateAssignments = mysqlTable(
  "gate_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    flightId: int("flightId").notNull(),
    gateId: int("gateId").notNull(),

    // Assignment timing
    assignedAt: timestamp("assignedAt").defaultNow().notNull(),
    boardingStartTime: timestamp("boardingStartTime"),
    boardingEndTime: timestamp("boardingEndTime"),

    // Status tracking
    status: mysqlEnum("status", [
      "assigned",
      "boarding",
      "departed",
      "cancelled",
      "changed",
    ])
      .default("assigned")
      .notNull(),

    // Admin tracking
    assignedBy: int("assignedBy"), // User ID who made the assignment (admin)

    // Change tracking
    previousGateId: int("previousGateId"), // For gate changes
    changeReason: text("changeReason"), // Reason for gate change

    // Notifications
    notificationSentAt: timestamp("notificationSentAt"), // When gate change notification was sent

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Index for flight-based queries
    flightIdIdx: index("gate_assignments_flight_id_idx").on(table.flightId),
    // Index for gate-based queries
    gateIdIdx: index("gate_assignments_gate_id_idx").on(table.gateId),
    // Index for status filtering
    statusIdx: index("gate_assignments_status_idx").on(table.status),
    // Index for assigned by (admin queries)
    assignedByIdx: index("gate_assignments_assigned_by_idx").on(
      table.assignedBy
    ),
    // Index for boarding times (schedule queries)
    boardingStartIdx: index("gate_assignments_boarding_start_idx").on(
      table.boardingStartTime
    ),
    // Composite index for gate + status (finding current assignments)
    gateStatusIdx: index("gate_assignments_gate_status_idx").on(
      table.gateId,
      table.status
    ),
    // Composite index for flight + status (getting active assignment)
    flightStatusIdx: index("gate_assignments_flight_status_idx").on(
      table.flightId,
      table.status
    ),
    // Index for assignment date
    assignedAtIdx: index("gate_assignments_assigned_at_idx").on(
      table.assignedAt
    ),
  })
);

export type GateAssignment = typeof gateAssignments.$inferSelect;
export type InsertGateAssignment = typeof gateAssignments.$inferInsert;

// ============================================================================
// Voucher & Credit System
// ============================================================================

/**
 * Vouchers table
 * Stores promotional codes and discounts for bookings
 */
export const vouchers = mysqlTable(
  "vouchers",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 50 }).notNull().unique(), // Unique voucher code
    type: mysqlEnum("type", ["fixed", "percentage"]).notNull(), // Type of discount
    value: int("value").notNull(), // For fixed: amount in cents, for percentage: percentage value (e.g., 10 = 10%)
    minPurchase: int("minPurchase").default(0).notNull(), // Minimum purchase amount in cents
    maxDiscount: int("maxDiscount"), // Maximum discount amount in cents (for percentage vouchers)
    maxUses: int("maxUses"), // Maximum number of times voucher can be used (null = unlimited)
    usedCount: int("usedCount").default(0).notNull(), // Number of times voucher has been used
    validFrom: timestamp("validFrom").notNull(), // Start date
    validUntil: timestamp("validUntil").notNull(), // Expiration date
    isActive: boolean("isActive").default(true).notNull(), // Active status
    description: text("description"), // Admin notes/description
    createdBy: int("createdBy"), // Admin who created the voucher
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeIdx: index("vouchers_code_idx").on(table.code),
    isActiveIdx: index("vouchers_is_active_idx").on(table.isActive),
    validFromIdx: index("vouchers_valid_from_idx").on(table.validFrom),
    validUntilIdx: index("vouchers_valid_until_idx").on(table.validUntil),
    // Composite index for voucher validation queries
    activeValidIdx: index("vouchers_active_valid_idx").on(
      table.isActive,
      table.validFrom,
      table.validUntil
    ),
  })
);

export type Voucher = typeof vouchers.$inferSelect;
export type InsertVoucher = typeof vouchers.$inferInsert;

/**
 * User Credits table
 * Tracks credit balances for users (from refunds, promotions, compensation)
 */
export const userCredits = mysqlTable(
  "user_credits",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(), // User who owns the credit
    amount: int("amount").notNull(), // Credit amount in cents
    source: mysqlEnum("source", [
      "refund",
      "promo",
      "compensation",
      "bonus",
    ]).notNull(), // Source of credit
    description: text("description"), // Description of why credit was given
    expiresAt: timestamp("expiresAt"), // Expiration date (null = never expires)
    usedAmount: int("usedAmount").default(0).notNull(), // Amount already used
    bookingId: int("bookingId"), // Related booking ID (for refunds)
    createdBy: int("createdBy"), // Admin who issued the credit (for manual credits)
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_credits_user_id_idx").on(table.userId),
    sourceIdx: index("user_credits_source_idx").on(table.source),
    expiresAtIdx: index("user_credits_expires_at_idx").on(table.expiresAt),
    bookingIdIdx: index("user_credits_booking_id_idx").on(table.bookingId),
    // Composite index for finding available credits
    userAvailableIdx: index("user_credits_user_available_idx").on(
      table.userId,
      table.expiresAt
    ),
  })
);

export type UserCredit = typeof userCredits.$inferSelect;
export type InsertUserCredit = typeof userCredits.$inferInsert;

/**
 * Voucher Usage table
 * Tracks when and how vouchers are used
 */
export const voucherUsage = mysqlTable(
  "voucher_usage",
  {
    id: int("id").autoincrement().primaryKey(),
    voucherId: int("voucherId").notNull(), // Voucher that was used
    userId: int("userId").notNull(), // User who used the voucher
    bookingId: int("bookingId").notNull(), // Booking where voucher was applied
    discountApplied: int("discountApplied").notNull(), // Actual discount amount in cents
    usedAt: timestamp("usedAt").defaultNow().notNull(), // When voucher was used
  },
  table => ({
    voucherIdIdx: index("voucher_usage_voucher_id_idx").on(table.voucherId),
    userIdIdx: index("voucher_usage_user_id_idx").on(table.userId),
    bookingIdIdx: index("voucher_usage_booking_id_idx").on(table.bookingId),
    usedAtIdx: index("voucher_usage_used_at_idx").on(table.usedAt),
    // Unique constraint: one voucher use per booking
    voucherBookingUnique: index("voucher_usage_voucher_booking_unique").on(
      table.voucherId,
      table.bookingId
    ),
  })
);

export type VoucherUsage = typeof voucherUsage.$inferSelect;
export type InsertVoucherUsage = typeof voucherUsage.$inferInsert;

/**
 * Credit Usage table
 * Tracks when and how user credits are used
 */
export const creditUsage = mysqlTable(
  "credit_usage",
  {
    id: int("id").autoincrement().primaryKey(),
    userCreditId: int("userCreditId").notNull(), // Credit record that was used
    userId: int("userId").notNull(), // User who used the credit
    bookingId: int("bookingId").notNull(), // Booking where credit was applied
    amountUsed: int("amountUsed").notNull(), // Amount of credit used in cents
    usedAt: timestamp("usedAt").defaultNow().notNull(), // When credit was used
  },
  table => ({
    userCreditIdIdx: index("credit_usage_user_credit_id_idx").on(
      table.userCreditId
    ),
    userIdIdx: index("credit_usage_user_id_idx").on(table.userId),
    bookingIdIdx: index("credit_usage_booking_id_idx").on(table.bookingId),
    usedAtIdx: index("credit_usage_used_at_idx").on(table.usedAt),
  })
);

export type CreditUsage = typeof creditUsage.$inferSelect;
export type InsertCreditUsage = typeof creditUsage.$inferInsert;

// ============================================================================
// Price Lock System
// ============================================================================

/**
 * Price Locks table
 * Allows users to freeze a flight price for 48 hours before booking
 */
export const priceLocks = mysqlTable(
  "price_locks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    flightId: int("flightId").notNull(),
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),

    // Locked price (SAR cents)
    lockedPrice: int("lockedPrice").notNull(),
    originalPrice: int("originalPrice").notNull(),

    // Lock fee (SAR cents) - small fee to lock the price
    lockFee: int("lockFee").notNull().default(0),

    // Lock status
    status: mysqlEnum("status", ["active", "used", "expired", "cancelled"])
      .default("active")
      .notNull(),

    // Resulting booking
    bookingId: int("bookingId"),

    // Expiry
    expiresAt: timestamp("expiresAt").notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("price_locks_user_idx").on(table.userId),
    flightIdx: index("price_locks_flight_idx").on(table.flightId),
    statusIdx: index("price_locks_status_idx").on(table.status),
    expiresAtIdx: index("price_locks_expires_at_idx").on(table.expiresAt),
    userFlightIdx: index("price_locks_user_flight_idx").on(
      table.userId,
      table.flightId,
      table.cabinClass
    ),
  })
);

export type PriceLock = typeof priceLocks.$inferSelect;
export type InsertPriceLock = typeof priceLocks.$inferInsert;

// ============================================================================
// Family Mile Pooling System
// ============================================================================

/**
 * Family Groups table
 * Groups for sharing loyalty miles among family members
 */
export const familyGroups = mysqlTable(
  "family_groups",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    ownerId: int("ownerId").notNull(), // Head of family

    // Pool balance (aggregated from members)
    pooledMiles: int("pooledMiles").notNull().default(0),

    // Limits
    maxMembers: int("maxMembers").notNull().default(6),

    // Status
    status: mysqlEnum("status", ["active", "inactive"])
      .default("active")
      .notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdx: index("family_groups_owner_idx").on(table.ownerId),
    statusIdx: index("family_groups_status_idx").on(table.status),
  })
);

export type FamilyGroup = typeof familyGroups.$inferSelect;
export type InsertFamilyGroup = typeof familyGroups.$inferInsert;

/**
 * Family Group Members table
 * Links users to family groups
 */
export const familyGroupMembers = mysqlTable(
  "family_group_members",
  {
    id: int("id").autoincrement().primaryKey(),
    groupId: int("groupId").notNull(),
    userId: int("userId").notNull(),

    // Role
    role: mysqlEnum("role", ["owner", "member"]).default("member").notNull(),

    // Contribution tracking
    milesContributed: int("milesContributed").notNull().default(0),
    milesRedeemed: int("milesRedeemed").notNull().default(0),

    // Status
    status: mysqlEnum("status", ["active", "invited", "removed"])
      .default("active")
      .notNull(),

    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    groupIdx: index("family_group_members_group_idx").on(table.groupId),
    userIdx: index("family_group_members_user_idx").on(table.userId),
    statusIdx: index("family_group_members_status_idx").on(table.status),
    groupUserIdx: index("family_group_members_group_user_idx").on(
      table.groupId,
      table.userId
    ),
  })
);

export type FamilyGroupMember = typeof familyGroupMembers.$inferSelect;
export type InsertFamilyGroupMember = typeof familyGroupMembers.$inferInsert;

// ============================================================================
// Digital Wallet System
// ============================================================================

/**
 * Wallets table
 * Stores user wallet balances for quick payments and refunds
 */
export const wallets = mysqlTable(
  "wallets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),

    // Balance (SAR cents)
    balance: int("balance").notNull().default(0),
    currency: varchar("currency", { length: 3 }).default("SAR").notNull(),

    // Status
    status: mysqlEnum("status", ["active", "frozen", "closed"])
      .default("active")
      .notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("wallets_user_idx").on(table.userId),
    statusIdx: index("wallets_status_idx").on(table.status),
  })
);

export type Wallet = typeof wallets.$inferSelect;
export type InsertWallet = typeof wallets.$inferInsert;

/**
 * Wallet Transactions table
 * Tracks all wallet transactions (top-up, payment, refund)
 */
export const walletTransactions = mysqlTable(
  "wallet_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    walletId: int("walletId").notNull(),
    userId: int("userId").notNull(),

    // Transaction type
    type: mysqlEnum("type", [
      "top_up",
      "payment",
      "refund",
      "bonus",
      "withdrawal",
    ]).notNull(),

    // Amount (positive for top_up/refund/bonus, negative for payment/withdrawal)
    amount: int("amount").notNull(),
    balanceAfter: int("balanceAfter").notNull(),

    // Description
    description: varchar("description", { length: 500 }).notNull(),

    // Related entities
    bookingId: int("bookingId"),
    stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),

    // Status
    status: mysqlEnum("status", ["completed", "pending", "failed"])
      .default("completed")
      .notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    walletIdx: index("wallet_transactions_wallet_idx").on(table.walletId),
    userIdx: index("wallet_transactions_user_idx").on(table.userId),
    typeIdx: index("wallet_transactions_type_idx").on(table.type),
    bookingIdx: index("wallet_transactions_booking_idx").on(table.bookingId),
    createdAtIdx: index("wallet_transactions_created_at_idx").on(
      table.createdAt
    ),
  })
);

export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type InsertWalletTransaction = typeof walletTransactions.$inferInsert;

// ============================================================================
// Flight Disruption Management
// ============================================================================

/**
 * Flight Disruptions table
 * Tracks flight disruptions (delays, cancellations) with rebooking options
 */
export const flightDisruptions = mysqlTable(
  "flight_disruptions",
  {
    id: int("id").autoincrement().primaryKey(),
    flightId: int("flightId").notNull(),

    // Disruption type
    type: mysqlEnum("type", ["delay", "cancellation", "diversion"]).notNull(),

    // Details
    reason: varchar("reason", { length: 500 }).notNull(),
    severity: mysqlEnum("severity", ["minor", "moderate", "severe"]).notNull(),

    // Delay info
    originalDepartureTime: timestamp("originalDepartureTime"),
    newDepartureTime: timestamp("newDepartureTime"),
    delayMinutes: int("delayMinutes"),

    // Status
    status: mysqlEnum("status", ["active", "resolved", "cancelled"])
      .default("active")
      .notNull(),

    // Admin
    createdBy: int("createdBy"),
    resolvedAt: timestamp("resolvedAt"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    flightIdx: index("flight_disruptions_flight_idx").on(table.flightId),
    typeIdx: index("flight_disruptions_type_idx").on(table.type),
    statusIdx: index("flight_disruptions_status_idx").on(table.status),
    createdAtIdx: index("flight_disruptions_created_at_idx").on(
      table.createdAt
    ),
  })
);

export type FlightDisruption = typeof flightDisruptions.$inferSelect;
export type InsertFlightDisruption = typeof flightDisruptions.$inferInsert;
