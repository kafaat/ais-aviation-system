import type { RedisOptions } from "ioredis";

/** Redis URL is authoritative for every producer and worker. */
export function redisConnectionOptions(
  env: NodeJS.ProcessEnv = process.env
): RedisOptions {
  const queueUrl = env.QUEUE_REDIS_URL || env.REDIS_URL;
  if (!queueUrl && env.NODE_ENV === "production") {
    throw new Error("REDIS_URL is required in production environment");
  }
  const url = new URL(
    queueUrl ||
      `redis://${env.REDIS_HOST || "127.0.0.1"}:${env.REDIS_PORT || "6379"}`
  );
  if (!["redis:", "rediss:"].includes(url.protocol))
    throw new Error("Invalid Redis protocol");
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isInteger(db) || db < 0)
    throw new Error("Invalid Redis database");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password
      ? decodeURIComponent(url.password)
      : env.REDIS_PASSWORD || undefined,
    db,
    ...(url.protocol === "rediss:"
      ? { tls: { rejectUnauthorized: true } }
      : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
