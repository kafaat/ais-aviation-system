# Historical schema proposal — not an active migration

This source was never part of the runtime schema. See the remediation register before implementing it.

```typescript
import {
  mysqlTable,
  int,
  varchar,
  decimal,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Exchange Rates table
 * Stores currency exchange rates for multi-currency support
 */
export const exchangeRates = mysqlTable(
  "exchange_rates",
  {
    id: int("id").autoincrement().primaryKey(),

    // Currency codes (ISO 4217)
    baseCurrency: varchar("baseCurrency", { length: 3 })
      .notNull()
      .default("SAR"), // Base currency (SAR)
    targetCurrency: varchar("targetCurrency", { length: 3 }).notNull(), // Target currency (USD, EUR, etc.)

    // Exchange rate (e.g., 1 SAR = 0.27 USD)
    rate: decimal("rate", { precision: 10, scale: 6 }).notNull(),

    // Metadata
    source: varchar("source", { length: 100 }), // API source (e.g., "exchangerate-api.com")
    lastUpdated: timestamp("lastUpdated").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    // Composite unique index to prevent duplicate currency pairs
    currencyPairIdx: index("currency_pair_idx").on(
      table.baseCurrency,
      table.targetCurrency
    ),
    targetCurrencyIdx: index("target_currency_idx").on(table.targetCurrency),
  })
);

export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type InsertExchangeRate = typeof exchangeRates.$inferInsert;

/**
 * User Currency Preferences table
 * Stores user's preferred currency for display
 */
export const userCurrencyPreferences = mysqlTable(
  "user_currency_preferences",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),
    preferredCurrency: varchar("preferredCurrency", { length: 3 })
      .notNull()
      .default("SAR"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
  })
);

export type UserCurrencyPreference =
  typeof userCurrencyPreferences.$inferSelect;
export type InsertUserCurrencyPreference =
  typeof userCurrencyPreferences.$inferInsert;

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

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]["code"];
```
