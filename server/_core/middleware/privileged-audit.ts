import type { TRPCError } from "@trpc/server";
import { createAuditLog } from "../../services/audit.service";
import { isAdmin } from "../../services/rbac.service";
import { logger } from "../logger";
import type { TrpcContext } from "../context";

/**
 * Scenario S-21: every privileged mutation writes an audit row.
 *
 * The privileged builders in trpc.ts (admin, airline admin, ops, finance)
 * attach this writer instead of relying on each handler to call the audit
 * service by hand. One row is written per privileged mutation call, whether
 * the role check refused it, the handler failed, or it succeeded. Queries are
 * not audited here. The write is best effort by the audit service's own
 * design: a failed audit insert is logged and never changes the mutation's
 * outcome, and a mocked or missing audit module cannot break a procedure.
 */
export type PrivilegedScope = "admin" | "airline_admin" | "ops" | "finance";

export const PRIVILEGED_MUTATION_EVENT = "PRIVILEGED_MUTATION" as const;

export type PrivilegedAuditRecord = {
  path: string;
  scope: PrivilegedScope;
  outcome: "success" | "failure" | "error";
  ctx: TrpcContext;
  durationMs: number;
  error?: TRPCError | Error | null;
};

function headerValue(ctx: TrpcContext, name: string): string | undefined {
  const headers = (ctx.req as { headers?: Record<string, unknown> } | undefined)
    ?.headers;
  const value = headers?.[name];
  if (Array.isArray(value)) return String(value[0] ?? "");
  return typeof value === "string" ? value : undefined;
}

export function describePrivilegedAudit(record: PrivilegedAuditRecord) {
  const { path, scope, outcome, ctx, durationMs, error } = record;
  const req = ctx.req as
    { ip?: string; id?: string; headers?: Record<string, unknown> } | undefined;
  const code = (error as TRPCError | undefined)?.code;
  const namespace = path.includes(".") ? path.split(".")[0] : path;
  return {
    eventType: PRIVILEGED_MUTATION_EVENT,
    eventCategory: "access" as const,
    outcome,
    severity: outcome === "success" ? ("medium" as const) : ("high" as const),
    userId: ctx.user?.id,
    userRole: ctx.user?.role,
    actorType: (ctx.user && isAdmin(ctx.user.role) ? "admin" : "user") as
      "admin" | "user",
    sourceIp: req?.ip,
    userAgent: headerValue(ctx, "user-agent"),
    requestId: req?.id ?? headerValue(ctx, "x-request-id"),
    resourceType: namespace,
    changeDescription:
      outcome === "success"
        ? `${path} completed`
        : `${path} ${outcome === "failure" ? "refused" : "failed"}${
            code ? ` (${code})` : ""
          }`,
    metadata: {
      path,
      scope,
      procedureType: "mutation",
      tenantId: ctx.tenantId ?? null,
      durationMs,
      ...(code ? { errorCode: code } : {}),
    },
  };
}

export async function recordPrivilegedMutation(
  record: PrivilegedAuditRecord
): Promise<void> {
  try {
    await createAuditLog(describePrivilegedAudit(record));
  } catch (error) {
    // The audit service already swallows database errors; this guards the
    // procedure against a mocked or partially loaded audit module.
    logger.error(
      { error, path: record.path },
      "Privileged mutation audit could not be recorded"
    );
  }
}
