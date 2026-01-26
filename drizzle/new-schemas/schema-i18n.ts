import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  index,
  boolean,
} from "drizzle-orm/mysql-core";

/**
 * Translatable Content Types
 * Defines what types of content can be translated
 */
export const contentTypes = mysqlTable(
  "content_types",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(), // e.g., "airline_description", "airport_info"
    description: text("description"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    nameIdx: index("name_idx").on(table.name),
  })
);

export type ContentType = typeof contentTypes.$inferSelect;
export type InsertContentType = typeof contentTypes.$inferInsert;

/**
 * Translations table
 * Stores all translations for dynamic content
 */
export const translations = mysqlTable(
  "translations",
  {
    id: int("id").autoincrement().primaryKey(),

    // Content identification
    contentTypeId: int("contentTypeId").notNull(),
    entityId: int("entityId").notNull(), // ID of the entity (airline, airport, etc.)
    fieldName: varchar("fieldName", { length: 100 }).notNull(), // e.g., "name", "description"

    // Language and translation
    locale: varchar("locale", { length: 5 }).notNull(), // e.g., "ar", "en", "fr"
    value: text("value").notNull(),

    // Metadata
    isDefault: boolean("isDefault").default(false).notNull(),
    isApproved: boolean("isApproved").default(true).notNull(),
    translatedBy: varchar("translatedBy", { length: 100 }), // "system", "admin", or user ID

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    contentTypeIdx: index("content_type_idx").on(table.contentTypeId),
    entityIdx: index("entity_idx").on(table.entityId),
    localeIdx: index("locale_idx").on(table.locale),
    // Composite index for fast lookups
    lookupIdx: index("lookup_idx").on(
      table.contentTypeId,
      table.entityId,
      table.fieldName,
      table.locale
    ),
  })
);

export type Translation = typeof translations.$inferSelect;
export type InsertTranslation = typeof translations.$inferInsert;

/**
 * Supported Locales
 */
export const SUPPORTED_LOCALES = [
  { code: "ar", name: "العربية", nativeName: "العربية", direction: "rtl" },
  { code: "en", name: "English", nativeName: "English", direction: "ltr" },
  { code: "fr", name: "French", nativeName: "Français", direction: "ltr" },
  { code: "es", name: "Spanish", nativeName: "Español", direction: "ltr" },
  { code: "de", name: "German", nativeName: "Deutsch", direction: "ltr" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

/**
 * Default locale
 */
export const DEFAULT_LOCALE: SupportedLocale = "ar";

/**
 * Fallback locale (if translation not found)
 */
export const FALLBACK_LOCALE: SupportedLocale = "en";
