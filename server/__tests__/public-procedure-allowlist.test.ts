import { describe, expect, it, vi } from "vitest";
import allowlist from "./fixtures/public-procedures.json";

/**
 * Scenario S-20 of docs/architecture/improvement-plan-2026-11.md: a sweep of
 * the real application router rather than a sample of chosen routers.
 *
 * publicProcedure marks its meta `restPublic: true`; protectedProcedure and
 * every builder derived from it override that with `false`. The sweep proves
 * three things about the whole surface: every procedure carries that mark,
 * the set of public procedures equals the committed allowlist (so a new
 * public procedure, or one that silently became public, fails here with its
 * path), and every public mutation in the allowlist names the handler-level
 * control that stands in for a session.
 */
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
    meta?: { restPublic?: unknown };
  };
};

async function inventory() {
  const { appRouter } = await import("../routers");
  const procedures = (
    appRouter as unknown as {
      _def: { procedures: Record<string, ProcedureDef> };
    }
  )._def.procedures;
  const rows = Object.entries(procedures).map(([path, procedure]) => ({
    path,
    type: procedure._def.type,
    restPublic: procedure._def.meta?.restPublic,
  }));
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

/** Namespaces whose procedures are never public: administration, money
 * movement, settlement, departure control, crew and audit surfaces. */
const NEVER_PUBLIC_PREFIXES = [
  "admin.",
  "agentGovernance.",
  "bookings.",
  "bspReporting.",
  "bspSettlement.",
  "crew.",
  "dataWarehouse.",
  "dcs.",
  "dcsOperations.",
  "disasterRecovery.",
  "eticket.",
  "gdpr.",
  "loadPlanning.",
  "metrics.",
  "mfa.",
  "multiRegion.",
  "refunds.",
  "reports.",
  "revenueAccounting.",
  "security.",
  "softDelete.",
  "standardReports.",
  "tenants.",
  "wallet.",
  "weightBalance.",
];

describe("public procedure allowlist (S-20 router sweep)", () => {
  it("marks every procedure of the real router as public or authenticated", async () => {
    const rows = await inventory();
    expect(rows.length).toBeGreaterThan(800);
    const unmarked = rows.filter(row => typeof row.restPublic !== "boolean");
    expect(unmarked.map(row => row.path)).toEqual([]);
  });

  it("exposes exactly the committed public mutations and queries", async () => {
    const rows = await inventory();
    const publicRows = rows.filter(row => row.restPublic === true);
    const actualMutations = publicRows
      .filter(row => row.type === "mutation")
      .map(row => row.path);
    const actualQueries = publicRows
      .filter(row => row.type === "query")
      .map(row => row.path);
    const expectedMutations = Object.keys(allowlist.publicMutations).sort();
    const expectedQueries = [...allowlist.publicQueries].sort();

    const added = (actual: string[], expected: string[]) =>
      actual.filter(path => !expected.includes(path));
    const removed = (actual: string[], expected: string[]) =>
      expected.filter(path => !actual.includes(path));

    // A path listed here is a review finding: either justify the control in
    // the fixture or make the procedure authenticated.
    expect({
      newPublicMutations: added(actualMutations, expectedMutations),
      newPublicQueries: added(actualQueries, expectedQueries),
      staleAllowlistMutations: removed(actualMutations, expectedMutations),
      staleAllowlistQueries: removed(actualQueries, expectedQueries),
    }).toEqual({
      newPublicMutations: [],
      newPublicQueries: [],
      staleAllowlistMutations: [],
      staleAllowlistQueries: [],
    });
    expect(publicRows.filter(row => row.type === "subscription")).toEqual([]);
  });

  it("names a handler-level control for every public mutation", () => {
    for (const [path, reason] of Object.entries(allowlist.publicMutations)) {
      expect(typeof reason, path).toBe("string");
      expect(reason.trim().length, path).toBeGreaterThan(20);
    }
  });

  it("keeps administration, money, settlement, departure and audit surfaces authenticated", async () => {
    const rows = await inventory();
    const offenders = rows
      .filter(row => row.restPublic === true)
      .filter(row =>
        NEVER_PUBLIC_PREFIXES.some(prefix => row.path.startsWith(prefix))
      )
      .map(row => row.path);
    expect(offenders).toEqual([]);
    // The guard list must name real namespaces, or it protects nothing.
    const namespaces = new Set(rows.map(row => row.path.split(".")[0] + "."));
    const unknown = NEVER_PUBLIC_PREFIXES.filter(
      prefix => !namespaces.has(prefix)
    );
    expect(unknown).toEqual([]);
  });
});
