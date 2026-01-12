import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, index } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Airlines table
 */
export const airlines = mysqlTable("airlines", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 3 }).notNull().unique(), // IATA code (e.g., SV, MS)
  name: varchar("name", { length: 255 }).notNull(),
  country: varchar("country", { length: 100 }),
  logo: text("logo"), // URL to airline logo
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Airline = typeof airlines.$inferSelect;
export type InsertAirline = typeof airlines.$inferInsert;

/**
 * Airports table
 */
export const airports = mysqlTable("airports", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 3 }).notNull().unique(), // IATA code (e.g., JED, RUH)
  name: varchar("name", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  country: varchar("country", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 50 }), // e.g., "Asia/Riyadh"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Airport = typeof airports.$inferSelect;
export type InsertAirport = typeof airports.$inferInsert;

/**
 * Flights table
 */
export const flights = mysqlTable("flights", {
  id: int("id").autoincrement().primaryKey(),
  flightNumber: varchar("flightNumber", { length: 10 }).notNull(),
  airlineId: int("airlineId").notNull(),
  originId: int("originId").notNull(),
  destinationId: int("destinationId").notNull(),
  departureTime: timestamp("departureTime").notNull(),
  arrivalTime: timestamp("arrivalTime").notNull(),
  aircraftType: varchar("aircraftType", { length: 50 }), // e.g., "Boeing 777"
  status: mysqlEnum("status", ["scheduled", "delayed", "cancelled", "completed"]).default("scheduled").notNull(),
  economySeats: int("economySeats").notNull(),
  businessSeats: int("businessSeats").notNull(),
  economyPrice: int("economyPrice").notNull(), // Price in SAR (stored as integer, e.g., 50000 = 500.00 SAR)
  businessPrice: int("businessPrice").notNull(),
  economyAvailable: int("economyAvailable").notNull(),
  businessAvailable: int("businessAvailable").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  flightNumberIdx: index("flight_number_idx").on(table.flightNumber),
  departureTimeIdx: index("departure_time_idx").on(table.departureTime),
  routeIdx: index("route_idx").on(table.originId, table.destinationId),
  airlineIdx: index("airline_idx").on(table.airlineId),
  statusIdx: index("status_idx").on(table.status),
  // Composite index for common search pattern: route + date + status
  routeDateStatusIdx: index("route_date_status_idx").on(table.originId, table.destinationId, table.departureTime, table.status),
}));

export type Flight = typeof flights.$inferSelect;
export type InsertFlight = typeof flights.$inferInsert;

/**
 * Bookings table
 */
export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  flightId: int("flightId").notNull(),
  bookingReference: varchar("bookingReference", { length: 6 }).notNull().unique(), // e.g., "ABC123"
  pnr: varchar("pnr", { length: 6 }).notNull().unique(), // Passenger Name Record
  status: mysqlEnum("status", ["pending", "confirmed", "cancelled", "completed"]).default("pending").notNull(),
  totalAmount: int("totalAmount").notNull(), // Total price in SAR cents
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "refunded", "failed"]).default("pending").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 255 }),
  cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),
  numberOfPassengers: int("numberOfPassengers").notNull(),
  checkedIn: boolean("checkedIn").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  pnrIdx: index("pnr_idx").on(table.pnr),
}));

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/**
 * Passengers table
 */
export const passengers = mysqlTable("passengers", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  type: mysqlEnum("type", ["adult", "child", "infant"]).default("adult").notNull(),
  title: varchar("title", { length: 10 }), // Mr, Mrs, Ms, Dr
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  dateOfBirth: timestamp("dateOfBirth"),
  passportNumber: varchar("passportNumber", { length: 20 }),
  nationality: varchar("nationality", { length: 3 }), // ISO country code
  seatNumber: varchar("seatNumber", { length: 5 }), // e.g., "12A"
  ticketNumber: varchar("ticketNumber", { length: 13 }), // IATA 13-digit ticket number
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  bookingIdIdx: index("booking_id_idx").on(table.bookingId),
}));

export type Passenger = typeof passengers.$inferSelect;
export type InsertPassenger = typeof passengers.$inferInsert;

/**
 * Flight Status History table
 * Tracks all status changes for flights
 */
export const flightStatusHistory = mysqlTable("flight_status_history", {
  id: int("id").autoincrement().primaryKey(),
  flightId: int("flightId").notNull(),
  oldStatus: mysqlEnum("oldStatus", ["scheduled", "delayed", "cancelled", "completed"]),
  newStatus: mysqlEnum("newStatus", ["scheduled", "delayed", "cancelled", "completed"]).notNull(),
  delayMinutes: int("delayMinutes"),
  reason: text("reason"),
  changedBy: int("changedBy"), // User ID who made the change (admin)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FlightStatusHistory = typeof flightStatusHistory.$inferSelect;
export type InsertFlightStatusHistory = typeof flightStatusHistory.$inferInsert;

/**
 * Payments table
 */
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  amount: int("amount").notNull(), // Amount in SAR cents
  currency: varchar("currency", { length: 3 }).default("SAR").notNull(),
  method: mysqlEnum("method", ["card", "wallet", "bank_transfer"]).notNull(),
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded"]).default("pending").notNull(),
  transactionId: varchar("transactionId", { length: 100 }), // External payment gateway transaction ID
  idempotencyKey: varchar("idempotencyKey", { length: 100 }).unique(), // For preventing duplicate payments
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  bookingIdIdx: index("booking_id_idx").on(table.bookingId),
  idempotencyKeyIdx: index("idempotency_key_idx").on(table.idempotencyKey),
}));

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Booking Modification Requests table
 * Tracks all modification requests for bookings
 */
export const bookingModifications = mysqlTable("booking_modifications", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  userId: int("userId").notNull(),
  
  // Modification type
  modificationType: mysqlEnum("modificationType", [
    "change_date",
    "upgrade_cabin",
    "change_flight",
    "add_services"
  ]).notNull(),
  
  // Original values
  originalFlightId: int("originalFlightId"),
  originalCabinClass: mysqlEnum("originalCabinClass", ["economy", "business"]),
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
  status: mysqlEnum("status", ["pending", "approved", "rejected", "completed"]).notNull().default("pending"),
  
  // Payment
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "refunded"]).default("pending"),
  
  // Metadata
  reason: text("reason"),
  adminNotes: text("adminNotes"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  bookingIdIdx: index("booking_id_idx").on(table.bookingId),
  userIdIdx: index("user_id_idx").on(table.userId),
  statusIdx: index("status_idx").on(table.status),
}));

export type BookingModification = typeof bookingModifications.$inferSelect;
export type InsertBookingModification = typeof bookingModifications.$inferInsert;

/**
 * Loyalty Accounts table
 * Tracks user loyalty program membership and tier
 */
export const loyaltyAccounts = mysqlTable("loyalty_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  
  // Miles balance
  totalMilesEarned: int("totalMilesEarned").notNull().default(0),
  currentMilesBalance: int("currentMilesBalance").notNull().default(0),
  milesRedeemed: int("milesRedeemed").notNull().default(0),
  
  // Tier system
  tier: mysqlEnum("tier", ["bronze", "silver", "gold", "platinum"]).notNull().default("bronze"),
  tierPoints: int("tierPoints").notNull().default(0), // Points for tier qualification
  
  // Metadata
  memberSince: timestamp("memberSince").defaultNow().notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  tierIdx: index("tier_idx").on(table.tier),
}));

export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type InsertLoyaltyAccount = typeof loyaltyAccounts.$inferInsert;

/**
 * Miles Transactions table
 * Tracks all miles earning and redemption transactions
 */
export const milesTransactions = mysqlTable("miles_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  loyaltyAccountId: int("loyaltyAccountId").notNull(),
  
  // Transaction details
  type: mysqlEnum("type", ["earn", "redeem", "expire", "bonus", "adjustment"]).notNull(),
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
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  loyaltyAccountIdIdx: index("loyalty_account_id_idx").on(table.loyaltyAccountId),
  typeIdx: index("type_idx").on(table.type),
}));

export type MilesTransaction = typeof milesTransactions.$inferSelect;
export type InsertMilesTransaction = typeof milesTransactions.$inferInsert;

/**
 * Inventory Locks table
 * Prevents double booking by temporarily locking seats during checkout
 */
export const inventoryLocks = mysqlTable("inventory_locks", {
  id: int("id").autoincrement().primaryKey(),
  
  // Flight and seat info
  flightId: int("flightId").notNull(),
  numberOfSeats: int("numberOfSeats").notNull(),
  cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),
  
  // User and session info
  userId: int("userId"),
  sessionId: varchar("sessionId", { length: 64 }).notNull(), // For anonymous users
  
  // Lock status
  status: mysqlEnum("status", ["active", "released", "expired", "converted"]).notNull().default("active"),
  
  // Timing
  lockedAt: timestamp("lockedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(), // Auto-release after 15 minutes
  releasedAt: timestamp("releasedAt"),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  flightIdIdx: index("flight_id_idx").on(table.flightId),
  sessionIdIdx: index("session_id_idx").on(table.sessionId),
  statusIdx: index("status_idx").on(table.status),
  expiresAtIdx: index("expires_at_idx").on(table.expiresAt),
}));

export type InventoryLock = typeof inventoryLocks.$inferSelect;
export type InsertInventoryLock = typeof inventoryLocks.$inferInsert;

/**
 * User Preferences table - stores user travel preferences
 */
export const userPreferences = mysqlTable("user_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  
  // Seat preferences
  preferredSeatType: mysqlEnum("preferredSeatType", ["window", "aisle", "middle"]),
  preferredCabinClass: mysqlEnum("preferredCabinClass", ["economy", "business", "first"]),
  
  // Meal preferences
  mealPreference: mysqlEnum("mealPreference", ["regular", "vegetarian", "vegan", "halal", "kosher", "gluten_free"]),
  
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
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
}));

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * Ancillary Services Catalog
 * Defines available add-on services (baggage, meals, seats, insurance)
 */
export const ancillaryServices = mysqlTable("ancillary_services", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(), // e.g., "BAG_20KG", "MEAL_VEG", "SEAT_EXTRA_LEG"
  category: mysqlEnum("category", ["baggage", "meal", "seat", "insurance", "lounge", "priority_boarding"]).notNull(),
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
}, (table) => ({
  categoryIdx: index("category_idx").on(table.category),
  availableIdx: index("available_idx").on(table.available),
}));

export type AncillaryService = typeof ancillaryServices.$inferSelect;
export type InsertAncillaryService = typeof ancillaryServices.$inferInsert;

/**
 * Booking Ancillaries
 * Links ancillary services to bookings
 */
export const bookingAncillaries = mysqlTable("booking_ancillaries", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  passengerId: int("passengerId"), // Optional: link to specific passenger
  ancillaryServiceId: int("ancillaryServiceId").notNull(),
  quantity: int("quantity").default(1).notNull(),
  unitPrice: int("unitPrice").notNull(), // Price at time of purchase (in SAR cents)
  totalPrice: int("totalPrice").notNull(), // quantity * unitPrice
  status: mysqlEnum("status", ["active", "cancelled", "refunded"]).default("active").notNull(),
  // Additional data (e.g., seat number, meal preference)
  metadata: text("metadata"), // JSON object for flexible data
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  bookingIdIdx: index("booking_id_idx").on(table.bookingId),
  passengerIdIdx: index("passenger_id_idx").on(table.passengerId),
  ancillaryServiceIdIdx: index("ancillary_service_id_idx").on(table.ancillaryServiceId),
}));

export type BookingAncillary = typeof bookingAncillaries.$inferSelect;
export type InsertBookingAncillary = typeof bookingAncillaries.$inferInsert;

/**
 * Exchange Rates table
 * Stores currency exchange rates for multi-currency support
 */
export const exchangeRates = mysqlTable("exchange_rates", {
  id: int("id").autoincrement().primaryKey(),
  
  // Currency codes (ISO 4217)
  baseCurrency: varchar("baseCurrency", { length: 3 }).notNull().default("SAR"), // Base currency (SAR)
  targetCurrency: varchar("targetCurrency", { length: 3 }).notNull(), // Target currency (USD, EUR, etc.)
  
  // Exchange rate (e.g., 1 SAR = 0.27 USD)
  rate: decimal("rate", { precision: 10, scale: 6 }).notNull(),
  
  // Metadata
  source: varchar("source", { length: 100 }), // API source (e.g., "exchangerate-api.com")
  lastUpdated: timestamp("lastUpdated").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // Composite unique index to prevent duplicate currency pairs
  currencyPairIdx: index("currency_pair_idx").on(table.baseCurrency, table.targetCurrency),
  targetCurrencyIdx: index("target_currency_idx").on(table.targetCurrency),
}));

export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type InsertExchangeRate = typeof exchangeRates.$inferInsert;

/**
 * User Currency Preferences table
 * Stores user's preferred currency for display
 */
export const userCurrencyPreferences = mysqlTable("user_currency_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  preferredCurrency: varchar("preferredCurrency", { length: 3 }).notNull().default("SAR"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
}));

export type UserCurrencyPreference = typeof userCurrencyPreferences.$inferSelect;
export type InsertUserCurrencyPreference = typeof userCurrencyPreferences.$inferInsert;

/**
 * Supported currencies configuration
 */
export const SUPPORTED_CURRENCIES = [
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", flag: "🇸🇦" },
  { code: "USD", name: "US Dollar", symbol: "$", flag: "🇺🇸" },
  { code: "EUR", name: "Euro", symbol: "€", flag: "🇪🇺" },
  { code: "GBP", name: "British Pound", symbol: "£", flag: "🇬🇧" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", flag: "🇦🇪" },
  { code: "KWD", name: "Kuwaiti Dinar", symbol: "د.ك", flag: "🇰🇼" },
  { code: "BHD", name: "Bahraini Dinar", symbol: "د.ب", flag: "🇧🇭" },
  { code: "OMR", name: "Omani Rial", symbol: "ر.ع.", flag: "🇴🇲" },
  { code: "QAR", name: "Qatari Riyal", symbol: "ر.ق", flag: "🇶🇦" },
  { code: "EGP", name: "Egyptian Pound", symbol: "ج.م", flag: "🇪🇬" },
] as const;

export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number]["code"];

/**
 * Login Attempts table
 * Tracks failed login attempts for account security
 */
export const loginAttempts = mysqlTable("login_attempts", {
  id: int("id").autoincrement().primaryKey(),
  
  // User identification
  email: varchar("email", { length: 320 }),
  openId: varchar("openId", { length: 64 }),
  
  // Attempt details
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(), // IPv6 max length
  userAgent: text("userAgent"),
  
  // Result
  success: boolean("success").notNull(),
  failureReason: varchar("failureReason", { length: 255 }),
  
  // Timestamp
  attemptedAt: timestamp("attemptedAt").defaultNow().notNull(),
}, (table) => ({
  emailIdx: index("email_idx").on(table.email),
  openIdIdx: index("open_id_idx").on(table.openId),
  ipAddressIdx: index("ip_address_idx").on(table.ipAddress),
  attemptedAtIdx: index("attempted_at_idx").on(table.attemptedAt),
}));

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type InsertLoginAttempt = typeof loginAttempts.$inferInsert;

/**
 * Account Locks table
 * Tracks locked accounts due to suspicious activity
 */
export const accountLocks = mysqlTable("account_locks", {
  id: int("id").autoincrement().primaryKey(),
  
  // User identification
  userId: int("userId").notNull().unique(),
  
  // Lock details
  reason: varchar("reason", { length: 255 }).notNull(),
  lockedBy: varchar("lockedBy", { length: 50 }).notNull(), // "system" or admin user ID
  
  // Lock status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Unlock details
  unlockedAt: timestamp("unlockedAt"),
  unlockedBy: varchar("unlockedBy", { length: 50 }),
  
  // Auto-unlock
  autoUnlockAt: timestamp("autoUnlockAt"), // Automatic unlock time
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  isActiveIdx: index("is_active_idx").on(table.isActive),
}));

export type AccountLock = typeof accountLocks.$inferSelect;
export type InsertAccountLock = typeof accountLocks.$inferInsert;

/**
 * Security Events table
 * Logs security-related events for audit trail
 */
export const securityEvents = mysqlTable("security_events", {
  id: int("id").autoincrement().primaryKey(),
  
  // Event details
  eventType: varchar("eventType", { length: 100 }).notNull(), // e.g., "account_locked", "suspicious_login"
  severity: varchar("severity", { length: 20 }).notNull(), // "low", "medium", "high", "critical"
  
  // User/IP details
  userId: int("userId"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  
  // Event data
  description: text("description"),
  metadata: text("metadata"), // JSON string for additional data
  
  // Action taken
  actionTaken: varchar("actionTaken", { length: 255 }),
  
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index("event_type_idx").on(table.eventType),
  severityIdx: index("severity_idx").on(table.severity),
  userIdIdx: index("user_id_idx").on(table.userId),
  ipAddressIdx: index("ip_address_idx").on(table.ipAddress),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = typeof securityEvents.$inferInsert;

/**
 * IP Blacklist table
 * Tracks blocked IP addresses
 */
export const ipBlacklist = mysqlTable("ip_blacklist", {
  id: int("id").autoincrement().primaryKey(),
  
  // IP details
  ipAddress: varchar("ipAddress", { length: 45 }).notNull().unique(),
  
  // Block details
  reason: text("reason").notNull(),
  blockedBy: varchar("blockedBy", { length: 50 }).notNull(), // "system" or admin user ID
  
  // Block status
  isActive: boolean("isActive").default(true).notNull(),
  
  // Unblock details
  unblockedAt: timestamp("unblockedAt"),
  unblockedBy: varchar("unblockedBy", { length: 50 }),
  
  // Auto-unblock
  autoUnblockAt: timestamp("autoUnblockAt"),
  
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ipAddressIdx: index("ip_address_idx").on(table.ipAddress),
  isActiveIdx: index("is_active_idx").on(table.isActive),
}));

export type IpBlacklist = typeof ipBlacklist.$inferSelect;
export type InsertIpBlacklist = typeof ipBlacklist.$inferInsert;
