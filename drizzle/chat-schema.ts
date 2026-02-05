/**
 * AI Chat Booking Schema
 *
 * Tables for AI-powered chat booking system (SkyLink-style)
 * Supports conversational flight search and booking
 */

import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Chat conversations - tracks booking conversations
 */
export const chatConversations = mysqlTable(
  "chat_conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Conversation state
    status: mysqlEnum("status", ["active", "completed", "archived", "expired"])
      .default("active")
      .notNull(),

    // Booking context extracted from conversation
    context: json("context").$type<{
      originId?: number;
      destinationId?: number;
      departureDate?: string;
      returnDate?: string;
      passengers?: number;
      cabinClass?: "economy" | "business";
      preferences?: Record<string, unknown>;
    }>(),

    // If conversation resulted in booking
    bookingId: int("bookingId"),

    // Conversation metadata
    messageCount: int("messageCount").default(0).notNull(),
    lastMessageAt: timestamp("lastMessageAt"),

    // Session tracking for multi-device support
    sessionId: varchar("sessionId", { length: 64 }),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("chat_conv_user_idx").on(table.userId),
    statusIdx: index("chat_conv_status_idx").on(table.status),
    bookingIdx: index("chat_conv_booking_idx").on(table.bookingId),
    lastMsgIdx: index("chat_conv_last_msg_idx").on(table.lastMessageAt),
  })
);

export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatConversation = typeof chatConversations.$inferInsert;

/**
 * Chat messages - stores conversation history
 */
export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),

    // Message details
    role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
    content: text("content").notNull(),

    // Metadata for tool calls, suggestions, etc.
    metadata: json("metadata").$type<{
      toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
        result?: unknown;
      }>;
      suggestions?: number[];
      intent?: string;
      entities?: Record<string, unknown>;
    }>(),

    // Processing info
    tokensUsed: int("tokensUsed"),
    processingTimeMs: int("processingTimeMs"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    convIdx: index("chat_msg_conv_idx").on(table.conversationId),
    roleIdx: index("chat_msg_role_idx").on(table.role),
    createdIdx: index("chat_msg_created_idx").on(table.createdAt),
  })
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * Booking suggestions - AI-generated flight recommendations
 */
export const bookingSuggestions = mysqlTable(
  "booking_suggestions",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    messageId: int("messageId"),

    // Flight details
    flightId: int("flightId").notNull(),
    cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),

    // Pricing at time of suggestion
    pricePerPerson: int("pricePerPerson").notNull(), // in cents
    totalPrice: int("totalPrice").notNull(), // in cents
    currency: varchar("currency", { length: 3 }).default("SAR").notNull(),

    // AI reasoning
    reason: text("reason"), // Why AI recommended this
    rank: int("rank").default(1).notNull(), // Position in suggestions list
    score: int("score"), // AI confidence score (0-100)

    // Selection tracking
    selected: mysqlEnum("selected", [
      "pending",
      "selected",
      "rejected",
      "expired",
    ])
      .default("pending")
      .notNull(),
    selectedAt: timestamp("selectedAt"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"), // Suggestion validity period
  },
  table => ({
    convIdx: index("booking_sug_conv_idx").on(table.conversationId),
    flightIdx: index("booking_sug_flight_idx").on(table.flightId),
    selectedIdx: index("booking_sug_selected_idx").on(table.selected),
  })
);

export type BookingSuggestion = typeof bookingSuggestions.$inferSelect;
export type InsertBookingSuggestion = typeof bookingSuggestions.$inferInsert;

/**
 * Notification history - audit log for all notifications
 */
export const notificationHistory = mysqlTable(
  "notification_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    // Notification type and channel
    type: mysqlEnum("type", [
      "booking_confirmation",
      "flight_status",
      "check_in_reminder",
      "price_alert",
      "loyalty_update",
      "refund_status",
      "promotional",
      "system",
    ]).notNull(),
    channel: mysqlEnum("channel", ["email", "sms", "push", "in_app"]).notNull(),

    // Recipient details
    recipientAddress: varchar("recipientAddress", { length: 320 }), // email or phone

    // Content
    subject: varchar("subject", { length: 255 }),
    content: text("content"),
    templateId: varchar("templateId", { length: 64 }),

    // Status tracking
    status: mysqlEnum("status", [
      "queued",
      "sent",
      "delivered",
      "failed",
      "bounced",
      "opened",
      "clicked",
    ])
      .default("queued")
      .notNull(),

    // Timing
    scheduledAt: timestamp("scheduledAt"),
    sentAt: timestamp("sentAt"),
    deliveredAt: timestamp("deliveredAt"),

    // Error handling
    errorMessage: text("errorMessage"),
    retryCount: int("retryCount").default(0).notNull(),

    // Reference to related entities
    bookingId: int("bookingId"),
    flightId: int("flightId"),

    // External provider tracking
    providerMessageId: varchar("providerMessageId", { length: 128 }),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("notif_hist_user_idx").on(table.userId),
    typeIdx: index("notif_hist_type_idx").on(table.type),
    channelIdx: index("notif_hist_channel_idx").on(table.channel),
    statusIdx: index("notif_hist_status_idx").on(table.status),
    sentAtIdx: index("notif_hist_sent_idx").on(table.sentAt),
    bookingIdx: index("notif_hist_booking_idx").on(table.bookingId),
  })
);

export type NotificationHistory = typeof notificationHistory.$inferSelect;
export type InsertNotificationHistory = typeof notificationHistory.$inferInsert;

/**
 * Customer reviews - guest review management
 */
export const customerReviews = mysqlTable(
  "customer_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    bookingId: int("bookingId"),
    flightId: int("flightId"),

    // Ratings (1-5)
    overallRating: int("overallRating").notNull(),
    comfortRating: int("comfortRating"),
    serviceRating: int("serviceRating"),
    valueRating: int("valueRating"),
    punctualityRating: int("punctualityRating"),

    // Review content
    title: varchar("title", { length: 255 }),
    content: text("content"),

    // Media attachments
    images: json("images").$type<string[]>(),

    // Verification and moderation
    isVerified: mysqlEnum("isVerified", ["pending", "verified", "rejected"])
      .default("pending")
      .notNull(),
    moderationStatus: mysqlEnum("moderationStatus", [
      "pending",
      "approved",
      "rejected",
      "flagged",
    ])
      .default("pending")
      .notNull(),
    moderationNotes: text("moderationNotes"),

    // Engagement
    helpfulCount: int("helpfulCount").default(0).notNull(),
    reportCount: int("reportCount").default(0).notNull(),

    // Response from airline/admin
    responseContent: text("responseContent"),
    responseAt: timestamp("responseAt"),
    respondedBy: int("respondedBy"),

    // Language
    language: varchar("language", { length: 5 }).default("ar").notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("review_user_idx").on(table.userId),
    bookingIdx: index("review_booking_idx").on(table.bookingId),
    flightIdx: index("review_flight_idx").on(table.flightId),
    ratingIdx: index("review_rating_idx").on(table.overallRating),
    statusIdx: index("review_status_idx").on(table.moderationStatus),
  })
);

export type CustomerReview = typeof customerReviews.$inferSelect;
export type InsertCustomerReview = typeof customerReviews.$inferInsert;

/**
 * Review helpful votes - tracks which users found reviews helpful
 */
export const reviewHelpfulVotes = mysqlTable(
  "review_helpful_votes",
  {
    id: int("id").autoincrement().primaryKey(),
    reviewId: int("reviewId").notNull(),
    userId: int("userId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    reviewUserIdx: index("helpful_review_user_idx").on(
      table.reviewId,
      table.userId
    ),
  })
);

export type ReviewHelpfulVote = typeof reviewHelpfulVotes.$inferSelect;
export type InsertReviewHelpfulVote = typeof reviewHelpfulVotes.$inferInsert;
