import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
  gt,
  lt,
  isNull,
  SQL,
} from "drizzle-orm";
import { drizzle, MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";
import {
  InsertUser,
  users,
  airlines,
  airports,
  flights,
  bookings,
  passengers,
  payments,
  type InsertAirline,
  type InsertAirport,
  type InsertFlight,
  type InsertBooking,
  type InsertPassenger,
  type InsertPayment,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { createServiceLogger } from "./_core/logger";

const log = createServiceLogger("database");

// ============ Connection Pool Configuration ============

/**
 * Production-optimized connection pool configuration
 * These settings are tuned for high-traffic aviation booking systems
 */
export const POOL_CONFIG = {
  // Connection limits
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || "20", 10),
  maxIdle: parseInt(process.env.DB_MAX_IDLE || "10", 10),
  idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || "60000", 10), // 60 seconds

  // Queue management
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || "0", 10), // 0 = unlimited
  waitForConnections: true,

  // Connection health
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10 seconds

  // Timeouts
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || "10000", 10), // 10 seconds

  // MySQL specific
  multipleStatements: false, // Prevent SQL injection via multiple statements
  namedPlaceholders: true,

  // Timezone handling
  timezone: "Z", // UTC
  dateStrings: false,
} as const;

let _pool: mysql.Pool | null = null;
let _db: MySql2Database<typeof schema> | null = null;

/**
 * Get the MySQL connection pool (singleton)
 * Uses connection pooling for better performance under load
 */
export function getPool(): mysql.Pool | null {
  if (!_pool && process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);

      _pool = mysql.createPool({
        host: url.hostname,
        port: parseInt(url.port || "3306", 10),
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1), // Remove leading /
        ssl:
          url.searchParams.get("ssl") === "true"
            ? { rejectUnauthorized: false }
            : undefined,
        ...POOL_CONFIG,
      });

      // Monitor pool events
      _pool.on("connection", () => {
        log.debug(
          { event: "pool_connection_created" },
          "New pool connection created"
        );
      });

      _pool.on("release", () => {
        log.debug(
          { event: "pool_connection_released" },
          "Pool connection released"
        );
      });

      _pool.on("enqueue", () => {
        log.warn(
          { event: "pool_connection_queued" },
          "Connection request queued - pool may be exhausted"
        );
      });

      log.info(
        {
          event: "pool_initialized",
          connectionLimit: POOL_CONFIG.connectionLimit,
          maxIdle: POOL_CONFIG.maxIdle,
        },
        "Database connection pool initialized"
      );
    } catch (error) {
      log.error(
        { event: "pool_init_failed", error },
        "Failed to initialize connection pool"
      );
      _pool = null;
    }
  }
  return _pool;
}

/**
 * Get pool statistics for monitoring
 */
export async function getPoolStats(): Promise<{
  activeConnections: number;
  idleConnections: number;
  queuedRequests: number;
  totalConnections: number;
} | null> {
  const pool = getPool();
  if (!pool) return null;

  // Note: mysql2 pool stats are accessed through internal properties
  const poolInternal = pool.pool as {
    _allConnections?: { length: number };
    _freeConnections?: { length: number };
    _connectionQueue?: { length: number };
  };

  return {
    totalConnections: poolInternal._allConnections?.length ?? 0,
    idleConnections: poolInternal._freeConnections?.length ?? 0,
    activeConnections:
      (poolInternal._allConnections?.length ?? 0) -
      (poolInternal._freeConnections?.length ?? 0),
    queuedRequests: poolInternal._connectionQueue?.length ?? 0,
  };
}

export async function getDb(): Promise<MySql2Database<typeof schema> | null> {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      if (pool) {
        _db = drizzle(pool, { schema, mode: "default" });
      } else {
        // Fallback to direct connection if pool fails
        _db = drizzle(process.env.DATABASE_URL, { schema, mode: "default" });
      }
    } catch (error) {
      log.warn(
        { event: "db_connection_failed", error },
        "Failed to connect to database"
      );
      _db = null;
    }
  }
  return _db;
}

/**
 * Gracefully close the connection pool
 * Call this during application shutdown
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    try {
      await _pool.end();
      _pool = null;
      _db = null;
      log.info({ event: "pool_closed" }, "Database connection pool closed");
    } catch (error) {
      log.error(
        { event: "pool_close_failed", error },
        "Failed to close connection pool"
      );
    }
  }
}

// ============ Pagination Types & Helpers ============

/**
 * Cursor-based pagination parameters
 */
export interface CursorPaginationParams {
  cursor?: string | number | null;
  limit?: number;
  direction?: "forward" | "backward";
}

/**
 * Offset-based pagination parameters
 */
export interface OffsetPaginationParams {
  page?: number;
  limit?: number;
}

/**
 * Paginated result with metadata
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor?: string | number | null;
    previousCursor?: string | number | null;
    total?: number;
    page?: number;
    totalPages?: number;
  };
}

/**
 * Default pagination limits
 */
export const PAGINATION_DEFAULTS = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
} as const;

/**
 * Normalize pagination limit to safe bounds
 */
export function normalizePaginationLimit(
  limit?: number,
  defaultLimit = PAGINATION_DEFAULTS.DEFAULT_LIMIT
): number {
  if (!limit || limit < PAGINATION_DEFAULTS.MIN_LIMIT) {
    return defaultLimit;
  }
  return Math.min(limit, PAGINATION_DEFAULTS.MAX_LIMIT);
}

/**
 * Build cursor-based pagination query conditions
 * @param cursorColumn - The column to use for cursor (typically id or createdAt)
 * @param cursor - The cursor value
 * @param direction - Pagination direction
 * @returns SQL condition for cursor pagination
 */
export function buildCursorCondition<T>(
  cursorColumn: T,
  cursor: string | number | null | undefined,
  direction: "forward" | "backward" = "forward"
): SQL | undefined {
  if (cursor === null || cursor === undefined) {
    return undefined;
  }

  // For forward pagination, get items after cursor
  // For backward pagination, get items before cursor
  if (direction === "forward") {
    return gt(cursorColumn as SQL, cursor);
  }
  return lt(cursorColumn as SQL, cursor);
}

/**
 * Create a paginated response with cursor metadata
 * @param data - The query results (fetch limit + 1 to detect hasMore)
 * @param limit - The requested limit
 * @param getCursor - Function to extract cursor from an item
 * @param direction - Pagination direction
 */
export function createCursorPaginatedResponse<T, C extends string | number>(
  data: T[],
  limit: number,
  getCursor: (item: T) => C,
  direction: "forward" | "backward" = "forward"
): PaginatedResult<T> {
  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;

  const result: PaginatedResult<T> = {
    data: items,
    pagination: {
      hasMore,
    },
  };

  if (items.length > 0) {
    if (direction === "forward") {
      result.pagination.nextCursor = hasMore
        ? getCursor(items[items.length - 1])
        : null;
      result.pagination.previousCursor = getCursor(items[0]);
    } else {
      result.pagination.previousCursor = hasMore ? getCursor(items[0]) : null;
      result.pagination.nextCursor = getCursor(items[items.length - 1]);
    }
  }

  return result;
}

/**
 * Create offset-based paginated response
 * @param data - The query results
 * @param total - Total count of items
 * @param page - Current page number (1-indexed)
 * @param limit - Items per page
 */
export function createOffsetPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      hasMore: page < totalPages,
      total,
      page,
      totalPages,
    },
  };
}

/**
 * Calculate offset from page number
 */
export function calculateOffset(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit);
}

// ============ Efficient Count Queries ============

/**
 * Perform an efficient count query using SQL COUNT(*)
 * More efficient than fetching all rows and counting
 */
export async function efficientCount(
  tableName: string,
  whereClause?: SQL
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    log.error(
      { event: "invalid_table_name", tableName },
      "Invalid table name for count query"
    );
    return 0;
  }

  try {
    const tableIdentifier = sql.raw(tableName);
    const countQuery = whereClause
      ? sql`SELECT COUNT(*) as count FROM ${tableIdentifier} WHERE ${whereClause}`
      : sql`SELECT COUNT(*) as count FROM ${tableIdentifier}`;

    const result = await db.execute(countQuery);
    const rows = result as unknown as Array<Array<{ count: number | bigint }>>;
    return Number(rows[0]?.[0]?.count ?? 0);
  } catch (error) {
    log.error(
      { event: "count_query_failed", tableName, error },
      "Failed to execute count query"
    );
    return 0;
  }
}

/**
 * Perform count with estimate for very large tables
 * Uses EXPLAIN to get row estimate (much faster but approximate)
 */
export async function estimatedCount(tableName: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  try {
    const result = await db.execute(
      sql`SELECT TABLE_ROWS as count
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${tableName}`
    );
    const rows = result as unknown as Array<
      Array<{ count: number | bigint | null }>
    >;
    return Number(rows[0]?.[0]?.count ?? 0);
  } catch (error) {
    log.error(
      { event: "estimated_count_failed", tableName, error },
      "Failed to get estimated count"
    );
    return 0;
  }
}

// ============ User Functions ============
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    log.warn(
      { event: "db_unavailable", operation: "upsert_user" },
      "Cannot upsert user: database not available"
    );
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    log.error({ event: "upsert_user_failed", error }, "Failed to upsert user");
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    log.warn(
      { event: "db_unavailable", operation: "get_user" },
      "Cannot get user: database not available"
    );
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    log.warn(
      { event: "db_unavailable", operation: "get_user" },
      "Cannot get user: database not available"
    );
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    log.warn(
      { event: "db_unavailable", operation: "get_user" },
      "Cannot get user: database not available"
    );
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============ Flight Functions ============
export async function searchFlights(params: {
  originId: number;
  destinationId: number;
  departureDate: Date;
}) {
  const db = await getDb();
  if (!db) return [];

  const startOfDay = new Date(params.departureDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(params.departureDate);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airline: {
        code: airlines.code,
        name: airlines.name,
        logo: airlines.logo,
      },
      origin: {
        code: airports.code,
        name: airports.name,
        city: airports.city,
      },
      destination: {
        code: sql<string>`dest.code`,
        name: sql<string>`dest.name`,
        city: sql<string>`dest.city`,
      },
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(
      and(
        eq(flights.originId, params.originId),
        eq(flights.destinationId, params.destinationId),
        gte(flights.departureTime, startOfDay),
        lte(flights.departureTime, endOfDay),
        eq(flights.status, "scheduled")
      )
    )
    .orderBy(asc(flights.departureTime));

  return result;
}

export async function getFlightById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airline: {
        id: airlines.id,
        code: airlines.code,
        name: airlines.name,
        logo: airlines.logo,
      },
      origin: {
        id: airports.id,
        code: airports.code,
        name: airports.name,
        city: airports.city,
        country: airports.country,
      },
      destination: {
        id: sql<number>`dest.id`,
        code: sql<string>`dest.code`,
        name: sql<string>`dest.name`,
        city: sql<string>`dest.city`,
        country: sql<string>`dest.country`,
      },
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(flights.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ============ Booking Functions ============
export async function createBooking(data: InsertBooking) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(bookings).values(data);
  return result;
}

export async function getBookingsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      status: bookings.status,
      totalAmount: bookings.totalAmount,
      paymentStatus: bookings.paymentStatus,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      checkedIn: bookings.checkedIn,
      createdAt: bookings.createdAt,
      flightId: bookings.flightId,
      flight: {
        id: flights.id,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        status: flights.status,
        origin: airports.code,
        destination: sql<string>`dest.code`,
      },
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(and(eq(bookings.userId, userId), isNull(bookings.deletedAt)))
    .orderBy(desc(bookings.createdAt));

  // Fetch passengers for each booking
  const bookingsWithPassengers = await Promise.all(
    result.map(async booking => {
      const bookingPassengers = await db
        .select()
        .from(passengers)
        .where(eq(passengers.bookingId, booking.id));
      return {
        ...booking,
        passengers: bookingPassengers,
      };
    })
  );

  return bookingsWithPassengers;
}

export async function getBookingByPNR(pnr: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.pnr, pnr), isNull(bookings.deletedAt)))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getBookingByIdWithDetails(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, id), isNull(bookings.deletedAt)))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateBookingStatus(
  id: number,
  status: "pending" | "confirmed" | "cancelled" | "completed"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(bookings)
    .set({ status, updatedAt: new Date() })
    .where(eq(bookings.id, id));
}

// ============ Passenger Functions ============
export async function createPassengers(passengerList: InsertPassenger[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(passengers).values(passengerList);
}

export async function getPassengersByBookingId(bookingId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));
}

// ============ Payment Functions ============
export async function createPayment(data: InsertPayment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(payments).values(data);
  return result;
}

export async function updatePaymentStatus(
  id: number,
  status: "pending" | "completed" | "failed" | "refunded",
  transactionId?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: Partial<InsertPayment> & { updatedAt: Date } = {
    status,
    updatedAt: new Date(),
  };
  if (transactionId) {
    updateData.transactionId = transactionId;
  }

  await db.update(payments).set(updateData).where(eq(payments.id, id));
}

export async function getPaymentByIdempotencyKey(idempotencyKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, idempotencyKey))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ============ Admin Functions ============
export async function getAllAirlines() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(airlines).where(eq(airlines.active, true));
}

export async function getAllAirports() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(airports);
}

export async function createFlight(data: InsertFlight) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(flights).values(data);
  return result;
}

export async function updateFlightAvailability(
  flightId: number,
  cabinClass: string,
  seats: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (cabinClass === "economy") {
    await db
      .update(flights)
      .set({ economyAvailable: seats, updatedAt: new Date() })
      .where(eq(flights.id, flightId));
  } else {
    await db
      .update(flights)
      .set({ businessAvailable: seats, updatedAt: new Date() })
      .where(eq(flights.id, flightId));
  }
}

// Helper function to generate unique booking reference
export function generateBookingReference(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============ Stripe-related Functions ============
export async function getBookingByPaymentIntentId(paymentIntentId: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.stripePaymentIntentId, paymentIntentId),
        isNull(bookings.deletedAt)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getBookingByCheckoutSessionId(sessionId: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.stripeCheckoutSessionId, sessionId),
        isNull(bookings.deletedAt)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// Export the db instance for direct access when needed
export { getDb as db };
