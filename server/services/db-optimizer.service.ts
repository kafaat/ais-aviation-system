/**
 * Database Optimizer Service
 *
 * Provides query analysis, slow query logging, and performance monitoring
 * for production database optimization.
 */

import { sql } from "drizzle-orm";
import { getDb, getPoolStats } from "../db";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("db-optimizer");

// ============ Configuration ============

/**
 * Slow query threshold configuration
 */
export const SLOW_QUERY_CONFIG = {
  // Queries taking longer than this are logged as slow (milliseconds)
  THRESHOLD_MS: parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "1000", 10),

  // Queries taking longer than this trigger warnings
  WARNING_THRESHOLD_MS: parseInt(
    process.env.SLOW_QUERY_WARNING_MS || "500",
    10
  ),

  // Maximum queries to keep in slow query log
  MAX_SLOW_QUERIES: parseInt(process.env.MAX_SLOW_QUERIES || "1000", 10),

  // Enable/disable slow query logging
  ENABLED: process.env.SLOW_QUERY_LOGGING !== "false",
} as const;

// ============ Types ============

/**
 * Query execution result with timing
 */
export interface QueryExecutionResult<T> {
  data: T;
  executionTimeMs: number;
  isSlow: boolean;
  queryId: string;
}

/**
 * Slow query log entry
 */
export interface SlowQueryEntry {
  queryId: string;
  sql: string;
  executionTimeMs: number;
  timestamp: Date;
  context?: Record<string, unknown>;
  stackTrace?: string;
}

/**
 * Index usage statistics
 */
export interface IndexUsageStats {
  tableName: string;
  indexName: string;
  rowsRead: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsDeleted: number;
}

/**
 * Table statistics
 */
export interface TableStats {
  tableName: string;
  rowCount: number;
  dataLength: number;
  indexLength: number;
  autoIncrement: number | null;
  avgRowLength: number;
  createTime: Date | null;
  updateTime: Date | null;
}

/**
 * Query plan from EXPLAIN
 */
export interface QueryPlan {
  id: number;
  selectType: string;
  table: string | null;
  partitions: string | null;
  type: string | null;
  possibleKeys: string | null;
  key: string | null;
  keyLen: string | null;
  ref: string | null;
  rows: number;
  filtered: number;
  extra: string | null;
}

/**
 * Query analysis result
 */
export interface QueryAnalysis {
  plan: QueryPlan[];
  warnings: string[];
  recommendations: string[];
  estimatedRows: number;
  usesIndex: boolean;
  indexUsed: string | null;
  scanType: string;
}

// ============ Slow Query Log ============

/**
 * In-memory slow query log (ring buffer)
 */
class SlowQueryLog {
  private entries: SlowQueryEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = SLOW_QUERY_CONFIG.MAX_SLOW_QUERIES) {
    this.maxEntries = maxEntries;
  }

  add(entry: SlowQueryEntry): void {
    this.entries.push(entry);

    // Trim if exceeded max entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getAll(): SlowQueryEntry[] {
    return [...this.entries];
  }

  getRecent(count: number = 100): SlowQueryEntry[] {
    return this.entries.slice(-count);
  }

  getSlowest(count: number = 10): SlowQueryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs)
      .slice(0, count);
  }

  getByTimeRange(startTime: Date, endTime: Date): SlowQueryEntry[] {
    return this.entries.filter(
      entry => entry.timestamp >= startTime && entry.timestamp <= endTime
    );
  }

  getStats(): {
    totalQueries: number;
    avgExecutionTime: number;
    maxExecutionTime: number;
    minExecutionTime: number;
  } {
    if (this.entries.length === 0) {
      return {
        totalQueries: 0,
        avgExecutionTime: 0,
        maxExecutionTime: 0,
        minExecutionTime: 0,
      };
    }

    const times = this.entries.map(e => e.executionTimeMs);
    return {
      totalQueries: this.entries.length,
      avgExecutionTime: times.reduce((a, b) => a + b, 0) / times.length,
      maxExecutionTime: Math.max(...times),
      minExecutionTime: Math.min(...times),
    };
  }

  clear(): void {
    this.entries = [];
  }
}

// Singleton slow query log
const slowQueryLog = new SlowQueryLog();

// ============ Query Execution Wrapper ============

let queryIdCounter = 0;

/**
 * Generate unique query ID
 */
function generateQueryId(): string {
  queryIdCounter++;
  return `q_${Date.now()}_${queryIdCounter}`;
}

/**
 * Execute a query with timing and slow query logging
 */
export async function executeWithTiming<T>(
  queryFn: () => Promise<T>,
  queryDescription: string,
  context?: Record<string, unknown>
): Promise<QueryExecutionResult<T>> {
  const queryId = generateQueryId();
  const startTime = performance.now();

  try {
    const data = await queryFn();
    const executionTimeMs = performance.now() - startTime;

    const isSlow = executionTimeMs >= SLOW_QUERY_CONFIG.THRESHOLD_MS;
    const isWarning = executionTimeMs >= SLOW_QUERY_CONFIG.WARNING_THRESHOLD_MS;

    // Log slow queries
    if (SLOW_QUERY_CONFIG.ENABLED && isSlow) {
      const entry: SlowQueryEntry = {
        queryId,
        sql: queryDescription,
        executionTimeMs,
        timestamp: new Date(),
        context,
        stackTrace: new Error().stack,
      };

      slowQueryLog.add(entry);

      log.warn(
        {
          event: "slow_query",
          queryId,
          executionTimeMs,
          threshold: SLOW_QUERY_CONFIG.THRESHOLD_MS,
          query: queryDescription.substring(0, 200),
          context,
        },
        `Slow query detected: ${executionTimeMs.toFixed(2)}ms`
      );
    } else if (isWarning) {
      log.info(
        {
          event: "query_warning",
          queryId,
          executionTimeMs,
          threshold: SLOW_QUERY_CONFIG.WARNING_THRESHOLD_MS,
        },
        `Query approaching slow threshold: ${executionTimeMs.toFixed(2)}ms`
      );
    }

    return {
      data,
      executionTimeMs,
      isSlow,
      queryId,
    };
  } catch (error) {
    const executionTimeMs = performance.now() - startTime;

    log.error(
      {
        event: "query_error",
        queryId,
        executionTimeMs,
        query: queryDescription.substring(0, 200),
        error,
      },
      "Query execution failed"
    );

    throw error;
  }
}

// ============ Query Analysis ============

/**
 * Analyze a query using EXPLAIN
 */
export async function analyzeQuery(
  queryString: string
): Promise<QueryAnalysis | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // Execute EXPLAIN
    const explainResult = await db.execute(sql.raw(`EXPLAIN ${queryString}`));

    const resultArray = explainResult as unknown as Array<
      Array<Record<string, unknown>>
    >;
    const rows = resultArray[0] ?? [];

    const plan: QueryPlan[] = rows.map(row => ({
      id: Number(row.id),
      selectType: String(row.select_type || ""),
      table: row.table ? String(row.table) : null,
      partitions: row.partitions ? String(row.partitions) : null,
      type: row.type ? String(row.type) : null,
      possibleKeys: row.possible_keys ? String(row.possible_keys) : null,
      key: row.key ? String(row.key) : null,
      keyLen: row.key_len ? String(row.key_len) : null,
      ref: row.ref ? String(row.ref) : null,
      rows: Number(row.rows || 0),
      filtered: Number(row.filtered || 100),
      extra: row.Extra ? String(row.Extra) : null,
    }));

    // Analyze the plan
    const warnings: string[] = [];
    const recommendations: string[] = [];

    for (const step of plan) {
      // Check for full table scans
      if (step.type === "ALL") {
        warnings.push(
          `Full table scan on ${step.table} - consider adding an index`
        );
        recommendations.push(
          `Add index on columns used in WHERE clause for table ${step.table}`
        );
      }

      // Check for index range scans (less efficient)
      if (step.type === "range" && step.rows > 10000) {
        warnings.push(`Range scan reading ${step.rows} rows on ${step.table}`);
      }

      // Check for filesort
      if (step.extra?.includes("Using filesort")) {
        warnings.push(`Query uses filesort on ${step.table}`);
        recommendations.push(
          `Consider adding an index that covers the ORDER BY columns`
        );
      }

      // Check for temporary table
      if (step.extra?.includes("Using temporary")) {
        warnings.push(`Query uses temporary table`);
        recommendations.push(
          `Consider optimizing GROUP BY or DISTINCT operations`
        );
      }

      // Check for covering index
      if (step.extra?.includes("Using index")) {
        // This is good - covering index used
      } else if (step.key && !step.extra?.includes("Using index condition")) {
        recommendations.push(
          `Consider making index ${step.key} a covering index`
        );
      }
    }

    const estimatedRows = plan.reduce((total, step) => total + step.rows, 0);
    const usesIndex = plan.some(step => step.key !== null);
    const indexUsed = plan.find(step => step.key !== null)?.key ?? null;
    const scanType = plan[0]?.type || "unknown";

    return {
      plan,
      warnings,
      recommendations,
      estimatedRows,
      usesIndex,
      indexUsed,
      scanType,
    };
  } catch (error) {
    log.error(
      { event: "query_analysis_failed", error },
      "Failed to analyze query"
    );
    return null;
  }
}

/**
 * Get EXPLAIN output as formatted JSON
 */
export async function explainQueryJson(
  queryString: string
): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.execute(
      sql.raw(`EXPLAIN FORMAT=JSON ${queryString}`)
    );

    const resultArray = result as unknown as Array<Array<{ EXPLAIN: string }>>;
    const rows = resultArray[0] ?? [];
    if (rows[0]?.EXPLAIN) {
      try {
        return JSON.parse(rows[0].EXPLAIN) as Record<string, unknown>;
      } catch {
        log.error(
          {
            event: "explain_json_parse_failed",
            raw: rows[0].EXPLAIN.substring(0, 200),
          },
          "Failed to parse EXPLAIN JSON output"
        );
        return null;
      }
    }
    return null;
  } catch (error) {
    log.error(
      { event: "explain_json_failed", error },
      "Failed to get EXPLAIN JSON"
    );
    return null;
  }
}

// ============ Index Analysis ============

/**
 * Get index usage statistics for all tables
 */
export async function getIndexUsageStats(): Promise<IndexUsageStats[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const result = await db.execute(sql`
      SELECT
        OBJECT_NAME as tableName,
        INDEX_NAME as indexName,
        COUNT_READ as rowsRead,
        COUNT_WRITE as rowsInserted,
        COUNT_FETCH as rowsUpdated,
        COUNT_DELETE as rowsDeleted
      FROM performance_schema.table_io_waits_summary_by_index_usage
      WHERE OBJECT_SCHEMA = DATABASE()
      AND INDEX_NAME IS NOT NULL
      ORDER BY COUNT_READ DESC
    `);

    const resultArray = result as unknown as Array<
      Array<Record<string, unknown>>
    >;
    const rows = resultArray[0] ?? [];
    return rows.map(row => ({
      tableName: String(row.tableName),
      indexName: String(row.indexName),
      rowsRead: Number(row.rowsRead || 0),
      rowsInserted: Number(row.rowsInserted || 0),
      rowsUpdated: Number(row.rowsUpdated || 0),
      rowsDeleted: Number(row.rowsDeleted || 0),
    }));
  } catch (error) {
    log.error(
      { event: "index_stats_failed", error },
      "Failed to get index usage stats"
    );
    return [];
  }
}

/**
 * Find unused indexes
 */
export async function findUnusedIndexes(): Promise<
  Array<{ tableName: string; indexName: string }>
> {
  const stats = await getIndexUsageStats();
  return stats
    .filter(
      stat =>
        stat.rowsRead === 0 &&
        stat.indexName !== "PRIMARY" &&
        !stat.indexName.includes("UNIQUE")
    )
    .map(stat => ({
      tableName: stat.tableName,
      indexName: stat.indexName,
    }));
}

/**
 * Find duplicate indexes
 */
export async function findDuplicateIndexes(): Promise<
  Array<{
    tableName: string;
    duplicateIndex: string;
    dominatingIndex: string;
    columns: string;
  }>
> {
  const db = await getDb();
  if (!db) return [];

  try {
    const result = await db.execute(sql`
      SELECT
        t1.TABLE_NAME as tableName,
        t1.INDEX_NAME as duplicateIndex,
        t2.INDEX_NAME as dominatingIndex,
        t1.COLUMN_NAME as columns
      FROM information_schema.STATISTICS t1
      JOIN information_schema.STATISTICS t2
        ON t1.TABLE_SCHEMA = t2.TABLE_SCHEMA
        AND t1.TABLE_NAME = t2.TABLE_NAME
        AND t1.COLUMN_NAME = t2.COLUMN_NAME
        AND t1.SEQ_IN_INDEX = t2.SEQ_IN_INDEX
        AND t1.INDEX_NAME != t2.INDEX_NAME
      WHERE t1.TABLE_SCHEMA = DATABASE()
        AND t1.SEQ_IN_INDEX = 1
        AND t1.INDEX_NAME != 'PRIMARY'
        AND t2.INDEX_NAME != 'PRIMARY'
      GROUP BY t1.TABLE_NAME, t1.INDEX_NAME, t2.INDEX_NAME
      HAVING COUNT(*) > 0
    `);

    const resultArray = result as unknown as Array<
      Array<Record<string, unknown>>
    >;
    const rows = resultArray[0] ?? [];
    return rows.map(row => ({
      tableName: String(row.tableName),
      duplicateIndex: String(row.duplicateIndex),
      dominatingIndex: String(row.dominatingIndex),
      columns: String(row.columns),
    }));
  } catch (error) {
    log.error(
      { event: "duplicate_index_check_failed", error },
      "Failed to find duplicate indexes"
    );
    return [];
  }
}

// ============ Table Statistics ============

/**
 * Get table statistics
 */
export async function getTableStats(): Promise<TableStats[]> {
  const db = await getDb();
  if (!db) return [];

  try {
    const result = await db.execute(sql`
      SELECT
        TABLE_NAME as tableName,
        TABLE_ROWS as rowCount,
        DATA_LENGTH as dataLength,
        INDEX_LENGTH as indexLength,
        AUTO_INCREMENT as autoIncrement,
        AVG_ROW_LENGTH as avgRowLength,
        CREATE_TIME as createTime,
        UPDATE_TIME as updateTime
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY DATA_LENGTH DESC
    `);

    const resultArray = result as unknown as Array<
      Array<Record<string, unknown>>
    >;
    const rows = resultArray[0] ?? [];
    return rows.map(row => ({
      tableName: String(row.tableName),
      rowCount: Number(row.rowCount || 0),
      dataLength: Number(row.dataLength || 0),
      indexLength: Number(row.indexLength || 0),
      autoIncrement: row.autoIncrement ? Number(row.autoIncrement) : null,
      avgRowLength: Number(row.avgRowLength || 0),
      createTime: row.createTime ? new Date(String(row.createTime)) : null,
      updateTime: row.updateTime ? new Date(String(row.updateTime)) : null,
    }));
  } catch (error) {
    log.error(
      { event: "table_stats_failed", error },
      "Failed to get table stats"
    );
    return [];
  }
}

/**
 * Get table size in human-readable format
 */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

// ============ Performance Monitoring ============

/**
 * Get current database performance metrics
 */
export async function getPerformanceMetrics(): Promise<{
  poolStats: Awaited<ReturnType<typeof getPoolStats>>;
  slowQueryStats: ReturnType<SlowQueryLog["getStats"]>;
  connectionStatus: "healthy" | "degraded" | "unhealthy";
  recommendations: string[];
}> {
  const poolStats = await getPoolStats();
  const slowQueryStats = slowQueryLog.getStats();
  const recommendations: string[] = [];

  // Determine connection status
  let connectionStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (poolStats) {
    const utilizationRate =
      poolStats.activeConnections / poolStats.totalConnections;

    if (utilizationRate > 0.9) {
      connectionStatus = "unhealthy";
      recommendations.push(
        "Connection pool is near capacity - consider increasing pool size"
      );
    } else if (utilizationRate > 0.7) {
      connectionStatus = "degraded";
      recommendations.push(
        "Connection pool utilization is high - monitor for potential issues"
      );
    }

    if (poolStats.queuedRequests > 0) {
      connectionStatus = "degraded";
      recommendations.push(
        `${poolStats.queuedRequests} requests are queued - pool may be undersized`
      );
    }
  }

  // Check slow query stats
  if (slowQueryStats.totalQueries > 100) {
    recommendations.push(
      `High number of slow queries (${slowQueryStats.totalQueries}) - review query patterns`
    );
  }

  if (slowQueryStats.avgExecutionTime > 2000) {
    recommendations.push(
      `Average slow query time is ${slowQueryStats.avgExecutionTime.toFixed(0)}ms - investigate slow queries`
    );
  }

  return {
    poolStats,
    slowQueryStats,
    connectionStatus,
    recommendations,
  };
}

/**
 * Health check for database connectivity
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const startTime = performance.now();

  try {
    const db = await getDb();
    if (!db) {
      return {
        healthy: false,
        latencyMs: 0,
        error: "Database connection not available",
      };
    }

    // Simple ping query
    await db.execute(sql`SELECT 1`);
    const latencyMs = performance.now() - startTime;

    return {
      healthy: true,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = performance.now() - startTime;
    return {
      healthy: false,
      latencyMs,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============ Query Optimization Helpers ============

/**
 * Build an optimized SELECT query with proper index hints
 * Note: Use sparingly - let the optimizer work in most cases
 */
export function buildOptimizedQuery(
  tableName: string,
  options: {
    useIndex?: string;
    forceIndex?: string;
    ignoreIndex?: string;
  }
): string {
  const hints: string[] = [];

  if (options.useIndex) {
    hints.push(`USE INDEX (${options.useIndex})`);
  }
  if (options.forceIndex) {
    hints.push(`FORCE INDEX (${options.forceIndex})`);
  }
  if (options.ignoreIndex) {
    hints.push(`IGNORE INDEX (${options.ignoreIndex})`);
  }

  return hints.length > 0 ? `${tableName} ${hints.join(" ")}` : tableName;
}

/**
 * Generate index recommendation for a table based on query patterns
 */
export async function suggestIndexes(tableName: string): Promise<
  Array<{
    columns: string[];
    reason: string;
    priority: "high" | "medium" | "low";
  }>
> {
  const suggestions: Array<{
    columns: string[];
    reason: string;
    priority: "high" | "medium" | "low";
  }> = [];

  // Get recent slow queries for this table
  const recentSlowQueries = slowQueryLog
    .getRecent(500)
    .filter(q => q.sql.toLowerCase().includes(tableName.toLowerCase()));

  if (recentSlowQueries.length > 10) {
    suggestions.push({
      columns: ["[analyze query WHERE clauses]"],
      reason: `Table ${tableName} appears in ${recentSlowQueries.length} slow queries`,
      priority: "high",
    });
  }

  // Check for missing indexes on foreign key columns
  const db = await getDb();
  if (db) {
    try {
      const result = await db.execute(sql`
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ${tableName}
          AND COLUMN_NAME LIKE '%Id'
          AND COLUMN_NAME NOT IN (
            SELECT COLUMN_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ${tableName}
          )
      `);

      const resultArray = result as unknown as Array<
        Array<{ COLUMN_NAME: string }>
      >;
      const rows = resultArray[0] ?? [];
      for (const row of rows) {
        suggestions.push({
          columns: [row.COLUMN_NAME],
          reason: `Foreign key column ${row.COLUMN_NAME} is not indexed`,
          priority: "medium",
        });
      }
    } catch {
      // Ignore errors in suggestion generation
    }
  }

  return suggestions;
}

// ============ Exports ============

export { slowQueryLog, SlowQueryLog };

// Re-export pagination utilities from db.ts for convenience
export {
  PAGINATION_DEFAULTS,
  normalizePaginationLimit,
  buildCursorCondition,
  createCursorPaginatedResponse,
  createOffsetPaginatedResponse,
  calculateOffset,
} from "../db";
