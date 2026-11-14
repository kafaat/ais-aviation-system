import { writeFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import inventoryFixture from "./fixtures/privileged-mutations.json";

/**
 * Scenario S-21 of docs/architecture/improvement-plan-2026-11.md: every
 * privileged mutation writes an audit row.
 *
 * The four privileged builders in server/_core/trpc.ts carry the audit writer
 * and a `privileged` meta mark. Part one sweeps the real application router:
 * every mutation under an administration, money or departure namespace is
 * built from a privileged builder, and the committed inventory equals the
 * router (a new privileged mutation, or one that silently lost its builder,
 * fails here with its path). Part two drives the builders through a caller
 * and checks the row that is written for refusal, failure and success.
 */
const audit = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../services/audit.service", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/audit.service")>()),
  createAuditLog: audit.create,
}));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    isConnected: () => false,
    checkRateLimit: async () => ({ allowed: true, remaining: 1 }),
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
  },
}));

type ProcedureDef = {
  _def: {
    type: "query" | "mutation" | "subscription";
    meta?: { restPublic?: unknown; privileged?: unknown };
  };
};

async function inventory() {
  const { appRouter } = await import("../routers");
  const procedures = (
    appRouter as unknown as {
      _def: { procedures: Record<string, ProcedureDef> };
    }
  )._def.procedures;
  return Object.entries(procedures)
    .map(([path, procedure]) => ({
      path,
      type: procedure._def.type,
      privileged: procedure._def.meta?.privileged,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const SCOPES = ["admin", "airline_admin", "ops", "finance"] as const;

/** Namespaces whose mutations must all come from a privileged builder:
 * platform administration, settlement, departure control, crew, security,
 * tenancy and the audit surface itself. A protectedProcedure mutation here
 * is a review finding. (softDelete is not listed: deleteBooking is a
 * user-facing mutation over the caller's own cancelled bookings.) */
const PRIVILEGED_ONLY_PREFIXES = [
  "admin.",
  "bspReporting.",
  "bspSettlement.",
  "crew.",
  "dataWarehouse.",
  "dcsOperations.",
  "disasterRecovery.",
  "loadPlanning.",
  "multiRegion.",
  "revenueAccounting.",
  "security.",
  "tenants.",
  "weightBalance.",
];

describe("privileged mutation audit (S-21 router sweep)", () => {
  it("marks every privileged procedure with one of the four scopes and nothing else", async () => {
    const rows = await inventory();
    expect(rows.length).toBeGreaterThan(800);
    const marked = rows.filter(row => row.privileged !== undefined);
    const badScope = marked.filter(
      row => !SCOPES.includes(row.privileged as (typeof SCOPES)[number])
    );
    expect(badScope.map(row => row.path)).toEqual([]);
    expect(marked.length).toBeGreaterThan(200);
  });

  it("builds every mutation of the privileged-only namespaces from a privileged builder", async () => {
    const rows = await inventory();
    const offenders = rows
      .filter(row => row.type === "mutation")
      .filter(row =>
        PRIVILEGED_ONLY_PREFIXES.some(prefix => row.path.startsWith(prefix))
      )
      .filter(row => row.privileged === undefined)
      .map(row => row.path);
    expect(offenders).toEqual([]);
    const namespaces = new Set(rows.map(row => row.path.split(".")[0] + "."));
    expect(
      PRIVILEGED_ONLY_PREFIXES.filter(prefix => !namespaces.has(prefix))
    ).toEqual([]);
  });

  it("matches the committed inventory of privileged mutations", async () => {
    const rows = await inventory();
    const actual: Record<string, string> = {};
    for (const row of rows)
      if (row.type === "mutation" && row.privileged !== undefined)
        actual[row.path] = String(row.privileged);
    if (process.env.AIS_WRITE_PRIVILEGED_INVENTORY === "1") {
      // Maintenance only: regenerate the fixture after an intentional change,
      // then review the diff like any other code.
      writeFileSync(
        new URL("./fixtures/privileged-mutations.json", import.meta.url),
        JSON.stringify({ privilegedMutations: actual }, null, 2) + "\n"
      );
    }
    const expected = inventoryFixture.privilegedMutations as Record<
      string,
      string
    >;
    const added = Object.keys(actual).filter(path => !(path in expected));
    const removed = Object.keys(expected).filter(path => !(path in actual));
    const rescoped = Object.keys(actual).filter(
      path => path in expected && expected[path] !== actual[path]
    );
    // A path listed here is a review finding: a privileged mutation appeared,
    // disappeared or changed its role scope without the fixture being updated.
    expect({ added, removed, rescoped }).toEqual({
      added: [],
      removed: [],
      rescoped: [],
    });
    expect(Object.keys(expected).length).toBeGreaterThan(200);
  });
});

describe("privileged mutation audit (builder behavior)", () => {
  const context = (
    role: string,
    tenantId: number | null = 7,
    userTenant: number | null = 7
  ) =>
    ({
      user: { id: 11, role, tenantId: userTenant },
      tenantId,
      req: {
        ip: "203.0.113.9",
        id: "req-s21",
        headers: { "user-agent": "vitest" },
      },
      res: {},
    }) as unknown as TrpcContext;

  const handler = vi.fn();

  async function gates() {
    const {
      adminProcedure,
      airlineFinanceProcedure,
      airlineOpsProcedure,
      router,
    } = await import("../_core/trpc");
    return router({
      adminWrite: adminProcedure.mutation(async () => {
        handler("adminWrite");
        return { ok: true };
      }),
      adminRead: adminProcedure.query(async () => {
        handler("adminRead");
        return { ok: true };
      }),
      financeWrite: airlineFinanceProcedure.mutation(async () => {
        handler("financeWrite");
        return { ok: true };
      }),
      opsFails: airlineOpsProcedure.mutation(async () => {
        handler("opsFails");
        throw new TRPCError({ code: "CONFLICT", message: "state moved" });
      }),
    });
  }

  beforeEach(() => {
    audit.create.mockReset();
    audit.create.mockResolvedValue(undefined);
    handler.mockReset();
  });

  it("writes one success row with actor, request and path for an admin mutation", async () => {
    const caller = (await gates()).createCaller(context("admin"));
    await expect(caller.adminWrite()).resolves.toEqual({ ok: true });
    expect(audit.create).toHaveBeenCalledTimes(1);
    expect(audit.create.mock.calls[0][0]).toMatchObject({
      eventType: "PRIVILEGED_MUTATION",
      eventCategory: "access",
      outcome: "success",
      severity: "medium",
      userId: 11,
      userRole: "admin",
      actorType: "admin",
      sourceIp: "203.0.113.9",
      userAgent: "vitest",
      requestId: "req-s21",
      resourceType: "adminWrite",
      metadata: { path: "adminWrite", scope: "admin", tenantId: 7 },
    });
  });

  it("does not audit privileged queries", async () => {
    const caller = (await gates()).createCaller(context("admin"));
    await expect(caller.adminRead()).resolves.toEqual({ ok: true });
    expect(audit.create).not.toHaveBeenCalled();
  });

  it("records a refusal before the handler runs, so a refused call changes nothing", async () => {
    const caller = (await gates()).createCaller(context("user"));
    await expect(caller.adminWrite()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(audit.create).toHaveBeenCalledTimes(1);
    expect(audit.create.mock.calls[0][0]).toMatchObject({
      outcome: "failure",
      severity: "high",
      userRole: "user",
      actorType: "user",
      metadata: { path: "adminWrite", scope: "admin", errorCode: "FORBIDDEN" },
    });
  });

  it("records a tenant refusal for scoped finance and a handler error for ops", async () => {
    const wrongTenant = (await gates()).createCaller(context("finance", 8, 7));
    await expect(wrongTenant.financeWrite()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Valid tenant context required",
    });
    expect(handler).not.toHaveBeenCalled();

    const ops = (await gates()).createCaller(context("ops"));
    await expect(ops.opsFails()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(handler).toHaveBeenCalledWith("opsFails");

    expect(audit.create).toHaveBeenCalledTimes(2);
    expect(audit.create.mock.calls[0][0]).toMatchObject({
      outcome: "failure",
      metadata: { scope: "finance", tenantId: 8, errorCode: "FORBIDDEN" },
    });
    expect(audit.create.mock.calls[1][0]).toMatchObject({
      outcome: "error",
      metadata: { scope: "ops", errorCode: "CONFLICT" },
      changeDescription: "opsFails failed (CONFLICT)",
    });
  });

  it("never lets a failing audit writer change the mutation's outcome", async () => {
    audit.create.mockRejectedValue(new Error("audit store down"));
    const caller = (await gates()).createCaller(context("admin"));
    await expect(caller.adminWrite()).resolves.toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith("adminWrite");
  });
});
