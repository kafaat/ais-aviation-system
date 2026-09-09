import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { mobileAuthServiceV2 } from "../services/mobile-auth-v2.service";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authMethod: "cookie" | "bearer" | null;
  /**
   * Tenant (airline) the request belongs to, derived from the authenticated
   * user. Null for anonymous requests or platform users without a tenant.
   * Use with assertTenant() to enforce per-tenant data isolation.
   */
  tenantId: number | null;
};

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/** Authoritative DB checks make revocation and role/tenant changes immediate. */
async function authenticateWithBearerToken(
  token: string
): Promise<User | null> {
  try {
    return await mobileAuthServiceV2.authenticateAccessToken(token);
  } catch {
    return null;
  }
}

export async function createContext(
  opts: Pick<CreateExpressContextOptions, "req" | "res">
): Promise<TrpcContext> {
  let user: User | null = null;
  let authMethod: "cookie" | "bearer" | null = null;

  // 1. Try Bearer token authentication first (for mobile/API clients)
  const bearerToken = extractBearerToken(opts.req.headers.authorization);
  if (bearerToken) {
    try {
      user = await authenticateWithBearerToken(bearerToken);
      if (user) {
        authMethod = "bearer";
      }
    } catch (_error) {
      // Bearer token auth failed, will try cookie auth next
      user = null;
    }
  }

  // 2. Fall back to cookie-based authentication (for web clients)
  if (!bearerToken) {
    try {
      user = await sdk.authenticateRequest(opts.req);
      if (user) {
        authMethod = "cookie";
      }
    } catch (_error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authMethod,
    tenantId: user?.tenantId ?? null,
  };
}
