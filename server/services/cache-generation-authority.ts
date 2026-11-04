import { createHash, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { cacheNamespaceGenerations } from "../../drizzle/schema";
import { getDb } from "../db";

// Cache reads must not wait indefinitely for an unavailable authority. Timed
// out queries retain their slot until they actually finish, limiting outstanding
// work instead of accumulating unbounded abandoned pool acquisitions.
const READ_TIMEOUT_MS = 250;
const WRITE_TIMEOUT_MS = 2000;
const MAX_PENDING_OPERATIONS = 8;
let pendingOperations = 0;

async function bounded<T>(
  operation: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  if (pendingOperations >= MAX_PENDING_OPERATIONS) {
    throw new Error("Cache generation authority is busy");
  }
  pendingOperations++;
  const pending = Promise.resolve().then(operation);
  void pending.then(
    () => pendingOperations--,
    () => pendingOperations--
  );
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Cache generation authority timed out")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function scopeHash(prefix: string, namespace: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify([prefix, namespace]))
    .digest("hex");
}

/**
 * One primary-key lookup for both the global and namespace generations. A
 * successful empty read denotes the initial generation; failed/unmigrated DB
 * reads must throw and may never be interpreted as an initial generation.
 * Tokens are deliberately not cached or coalesced across requests: a read that
 * starts after an invalidation completes must consult the authority again.
 */
export function readCacheGeneration(
  prefix: string,
  namespace: string
): Promise<string> {
  return bounded(async () => {
    const db = await getDb();
    if (!db) throw new Error("Cache generation database is unavailable");
    const globalKey = scopeHash(prefix, null);
    const namespaceKey = scopeHash(prefix, namespace);
    const rows = await db
      .select({
        key: cacheNamespaceGenerations.scopeHash,
        generation: cacheNamespaceGenerations.generation,
      })
      .from(cacheNamespaceGenerations)
      .where(
        inArray(cacheNamespaceGenerations.scopeHash, [globalKey, namespaceKey])
      );
    const generations = new Map(rows.map(row => [row.key, row.generation]));
    return `${generations.get(globalKey) ?? "0"}.${generations.get(namespaceKey) ?? "0"}`;
  }, READ_TIMEOUT_MS);
}

/**
 * A completed invalidation is durable before any Redis operation is attempted.
 * This is a cache administration boundary, not an atomic source mutation. A
 * timeout means unconfirmed completion (retry is safe); it never claims success.
 */
export function advanceCacheGeneration(
  prefix: string,
  namespace: string | null
): Promise<void> {
  return bounded(async () => {
    const db = await getDb();
    if (!db) throw new Error("Cache generation database is unavailable");
    const generation = randomUUID();
    await db
      .insert(cacheNamespaceGenerations)
      .values({ scopeHash: scopeHash(prefix, namespace), generation })
      .onDuplicateKeyUpdate({ set: { generation, updatedAt: new Date() } });
  }, WRITE_TIMEOUT_MS);
}
