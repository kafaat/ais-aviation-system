import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../context";
import { rateLimitService } from "../../services/rate-limit.service";

export function sensitiveProcedureScope(path: string): string | null {
  if (/^auth\..*(?:reset|forgot)/i.test(path)) return "passwordReset";
  if (
    /^(auth|mfa)\./.test(path) &&
    !/^auth\.(me|refreshToken|logout|logoutAllDevices|sessions|getSessions)$/.test(
      path
    )
  )
    return "auth";
  if (/^(payments|wallet|splitPayments|refunds)\./.test(path)) return "payment";
  if (path === "bookings.create") return "booking";
  return null;
}

export async function enforceProcedureRateLimit(
  ctx: TrpcContext,
  path: string
): Promise<void> {
  const scope = sensitiveProcedureScope(path);
  // Trusted in-process callers have no HTTP request. Every transported call does.
  if (!scope || !ctx.req) return;
  const ip = ctx.req.ip || ctx.req.socket?.remoteAddress || "unknown";
  const identifier =
    scope === "auth" || scope === "passwordReset" || !ctx.user
      ? `ip:${ip}`
      : `user:${ctx.user.id}`;
  const result = await rateLimitService.checkStrictRateLimit(identifier, scope);
  for (const [key, value] of Object.entries(
    rateLimitService.getRateLimitHeaders(result)
  ))
    ctx.res?.setHeader(key, value);
  if (!result.allowed)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Please try again later.",
    });
}
