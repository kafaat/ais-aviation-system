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
 * Flight Reviews
 * User reviews and ratings for flights
 */
export const flightReviews = mysqlTable("flight_reviews", {
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
  status: mysqlEnum("status", ["pending", "approved", "rejected", "hidden"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  flightIdIdx: index("flight_id_idx").on(table.flightId),
  bookingIdIdx: index("booking_id_idx").on(table.bookingId),
  ratingIdx: index("rating_idx").on(table.rating),
  statusIdx: index("status_idx").on(table.status),
  // Unique constraint: one review per user per flight
  userFlightUnique: index("user_flight_unique").on(table.userId, table.flightId),
}));

export type FlightReview = typeof flightReviews.$inferSelect;
export type InsertFlightReview = typeof flightReviews.$inferInsert;

/**
 * Favorite Flights
 * User's saved favorite flight routes
 */
export const favoriteFlights = mysqlTable("favorite_flights", {
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
}, (table) => ({
  userIdIdx: index("user_id_idx").on(table.userId),
  routeIdx: index("route_idx").on(table.originId, table.destinationId),
  airlineIdIdx: index("airline_id_idx").on(table.airlineId),
  priceAlertIdx: index("price_alert_idx").on(table.enablePriceAlert, table.maxPrice),
  // Unique constraint: one favorite per user per route/airline combination
  userRouteFavoriteUnique: index("user_route_favorite_unique").on(table.userId, table.originId, table.destinationId, table.airlineId),
}));

export type FavoriteFlight = typeof favoriteFlights.$inferSelect;
export type InsertFavoriteFlight = typeof favoriteFlights.$inferInsert;

/**
 * Price Alert History
 * Track when price alerts were triggered
 */
export const priceAlertHistory = mysqlTable("price_alert_history", {
  id: int("id").autoincrement().primaryKey(),
  favoriteFlightId: int("favoriteFlightId").notNull(),
  flightId: int("flightId").notNull(), // The specific flight that triggered the alert
  previousPrice: int("previousPrice").notNull(), // Previous lowest price
  newPrice: int("newPrice").notNull(), // New lower price
  priceChange: int("priceChange").notNull(), // Difference (negative number)
  alertSent: boolean("alertSent").default(false).notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  favoriteFlightIdIdx: index("favorite_flight_id_idx").on(table.favoriteFlightId),
  flightIdIdx: index("flight_id_idx").on(table.flightId),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type PriceAlertHistory = typeof priceAlertHistory.$inferSelect;
export type InsertPriceAlertHistory = typeof priceAlertHistory.$inferInsert;
