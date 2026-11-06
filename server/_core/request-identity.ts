import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { mobileAuthServiceV2 } from "../services/mobile-auth-v2.service";
import { isAdmin } from "../services/rbac.service";
import { isTenantActive } from "../services/tenant.service";
import { sdk } from "./sdk";

export type RequestIdentity = {
  user: User | null;
  authMethod: "cookie" | "bearer" | null;
  tenantId: number | null;
};

const anonymous: RequestIdentity = {
  user: null,
  authMethod: null,
  tenantId: null,
};

// All consumers of a request use the same authoritative authentication result.
// In particular, an arbitrary req.user property cannot select a rate-limit tier.
const identities = new WeakMap<Request, Promise<RequestIdentity>>();

async function authenticate(req: Request): Promise<RequestIdentity> {
  try {
    const authorization = req.headers.authorization?.trim();
    const hasBearer = /^Bearer(?:\s|$)/i.test(authorization ?? "");
    let user: User | null;
    let authMethod: "cookie" | "bearer";

    if (hasBearer) {
      const token = authorization?.match(/^Bearer[ \t]+(\S+)[ \t]*$/i)?.[1];
      // A failed or malformed Bearer attempt must never inherit a cookie's
      // identity, permissions, or quota.
      if (!token) return anonymous;
      user = await mobileAuthServiceV2.authenticateAccessToken(token);
      authMethod = "bearer";
    } else {
      user = await sdk.authenticateRequest(req);
      authMethod = "cookie";
    }

    if (!user) return anonymous;
    if (
      user.tenantId != null &&
      !isAdmin(user.role) &&
      !(await isTenantActive(user.tenantId))
    ) {
      return anonymous;
    }

    return { user, authMethod, tenantId: user.tenantId ?? null };
  } catch {
    // Authentication remains optional on public endpoints. Protected procedures
    // reject this identity, and rate limits apply the anonymous IP quota.
    return anonymous;
  }
}

export function resolveRequestIdentity(req: Request): Promise<RequestIdentity> {
  let identity = identities.get(req);
  if (!identity) {
    identity = authenticate(req);
    identities.set(req, identity);
  }
  return identity;
}
