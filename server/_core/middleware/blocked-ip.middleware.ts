import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { RequestHandler } from "express";
import { ipBlacklist } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { logger } from "../logger";

// These public probes must report process/dependency health even when admission
// storage is unavailable. Exact paths exclude protected checks and tRPC batches.
const probePaths = new Set([
  "/rest/health/live",
  "/rest/health/ready",
  "/trpc/health.live",
  "/trpc/health.ready",
]);

export const blockedIpAdmission: RequestHandler = async (req, res, next) => {
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    probePaths.has(req.path.replace(/\/$/, ""))
  ) {
    next();
    return;
  }

  // Express resolves this address using the explicitly configured trusted
  // proxy chain. Never consume X-Forwarded-For directly here.
  const ip = req.ip || req.socket?.remoteAddress;
  try {
    if (!ip) throw new Error("Client IP is unavailable");
    const database = await getDb();
    if (!database) throw new Error("Admission database is unavailable");

    // Node may represent an IPv4 peer as IPv4-mapped IPv6. Check both spellings
    // so an operator's explicit IPv4 block also applies to that socket form.
    const addresses = [ip];
    if (ip.toLowerCase().startsWith("::ffff:")) addresses.push(ip.slice(7));
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) addresses.push(`::ffff:${ip}`);
    const [blocked] = await database
      .select({ id: ipBlacklist.id })
      .from(ipBlacklist)
      .where(
        and(
          inArray(ipBlacklist.ipAddress, addresses),
          eq(ipBlacklist.isActive, true),
          or(
            isNull(ipBlacklist.autoUnblockAt),
            gt(ipBlacklist.autoUnblockAt, new Date())
          )
        )
      )
      .limit(1);

    if (blocked) {
      res.status(403).json({ error: "IP_BLOCKED", message: "Access denied" });
      return;
    }
    next();
  } catch (error) {
    // Explicit IP blocks are a security boundary, unlike best-effort rate-limit
    // counters. Database failures cannot silently disable this boundary.
    logger.error({ error, ip }, "IP admission check failed");
    res.status(503).json({
      error: "ADMISSION_UNAVAILABLE",
      message: "Service temporarily unavailable",
    });
  }
};
