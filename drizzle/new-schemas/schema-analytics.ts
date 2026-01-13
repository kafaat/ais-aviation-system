import {
  mysqlTable,
  int,
  varchar,
  decimal,
  timestamp,
  index,
  date,
} from "drizzle-orm/mysql-core";

/**
 * Analytics Events table
 * Stores all analytics events for tracking user behavior
 */
export const analyticsEvents = mysqlTable(
  "analytics_events",
  {
    id: int("id").autoincrement().primaryKey(),

    // Event details
    eventType: varchar("eventType", { length: 100 }).notNull(), // e.g., "page_view", "search", "booking_started"
    eventCategory: varchar("eventCategory", { length: 50 }).notNull(), // e.g., "user_action", "system_event"

    // User/Session details
    userId: int("userId"),
    sessionId: varchar("sessionId", { length: 64 }),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: varchar("userAgent", { length: 500 }),

    // Event data (JSON)
    metadata: varchar("metadata", { length: 2000 }), // JSON string

    // Page/URL details
    pageUrl: varchar("pageUrl", { length: 500 }),
    referrer: varchar("referrer", { length: 500 }),

    // Timestamp
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    eventTypeIdx: index("event_type_idx").on(table.eventType),
    userIdIdx: index("user_id_idx").on(table.userId),
    sessionIdIdx: index("session_id_idx").on(table.sessionId),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = typeof analyticsEvents.$inferInsert;

/**
 * Daily Metrics table
 * Pre-aggregated daily metrics for fast dashboard queries
 */
export const dailyMetrics = mysqlTable(
  "daily_metrics",
  {
    id: int("id").autoincrement().primaryKey(),

    // Date
    date: date("date").notNull(),

    // Booking metrics
    totalBookings: int("totalBookings").default(0).notNull(),
    confirmedBookings: int("confirmedBookings").default(0).notNull(),
    cancelledBookings: int("cancelledBookings").default(0).notNull(),

    // Revenue metrics (in cents)
    totalRevenue: int("totalRevenue").default(0).notNull(),
    confirmedRevenue: int("confirmedRevenue").default(0).notNull(),
    refundedAmount: int("refundedAmount").default(0).notNull(),

    // User metrics
    newUsers: int("newUsers").default(0).notNull(),
    activeUsers: int("activeUsers").default(0).notNull(),

    // Flight metrics
    totalFlights: int("totalFlights").default(0).notNull(),
    totalSeatsBooked: int("totalSeatsBooked").default(0).notNull(),

    // Average metrics
    averageBookingValue: int("averageBookingValue").default(0).notNull(), // in cents
    averagePassengersPerBooking: decimal("averagePassengersPerBooking", {
      precision: 4,
      scale: 2,
    })
      .default("0.00")
      .notNull(),

    // Conversion metrics
    searchToBookingRate: decimal("searchToBookingRate", {
      precision: 5,
      scale: 2,
    })
      .default("0.00")
      .notNull(), // percentage

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    dateIdx: index("date_idx").on(table.date),
  })
);

export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type InsertDailyMetric = typeof dailyMetrics.$inferInsert;

/**
 * Popular Routes table
 * Tracks most searched and booked routes
 */
export const popularRoutes = mysqlTable(
  "popular_routes",
  {
    id: int("id").autoincrement().primaryKey(),

    // Route details
    originId: int("originId").notNull(),
    destinationId: int("destinationId").notNull(),

    // Metrics
    searchCount: int("searchCount").default(0).notNull(),
    bookingCount: int("bookingCount").default(0).notNull(),
    totalRevenue: int("totalRevenue").default(0).notNull(), // in cents

    // Time period
    periodStart: date("periodStart").notNull(),
    periodEnd: date("periodEnd").notNull(),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    originDestIdx: index("origin_dest_idx").on(
      table.originId,
      table.destinationId
    ),
    periodIdx: index("period_idx").on(table.periodStart, table.periodEnd),
  })
);

export type PopularRoute = typeof popularRoutes.$inferSelect;
export type InsertPopularRoute = typeof popularRoutes.$inferInsert;
