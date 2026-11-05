import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { resolveRequestIdentity } from "./request-identity";

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

export async function createContext(
  opts: Pick<CreateExpressContextOptions, "req" | "res">
): Promise<TrpcContext> {
  const identity = await resolveRequestIdentity(opts.req);
  return {
    req: opts.req,
    res: opts.res,
    ...identity,
  };
}
