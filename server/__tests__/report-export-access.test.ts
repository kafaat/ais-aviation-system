import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { reportsRouter } from "../routers/reports";

const reports = [
  ["exportBookingsCSV", "finance", "bookings", 1],
  ["exportBookingsExcel", "finance", "bookings", 1],
  ["generateBookingsPDF", "finance", "bookings", 1],
  ["exportRevenueCSV", "finance", "bookings", 2],
  ["exportRevenueExcel", "finance", "bookings", 2],
  ["generateRevenuePDF", "finance", "bookings", 2],
  ["exportRefundsCSV", "finance", "bookings", 1],
  ["exportRefundsExcel", "finance", "bookings", 1],
  ["generateRefundsPDF", "finance", "bookings", 1],
  ["exportFlightPerformanceCSV", "ops", "flights", 1],
  ["exportFlightPerformanceExcel", "ops", "flights", 1],
  ["generateFlightPerformancePDF", "ops", "flights", 1],
] as const;
const dialect = new MySqlDialect();
let predicates: (SQL | undefined)[];

function caller(
  role: string | null,
  userTenant: number | null = 101,
  contextTenant: number | null = userTenant
) {
  return reportsRouter.createCaller({
    user: role ? { id: 9, role, tenantId: userTenant } : null,
    authMethod: "jwt",
    tenantId: contextTenant,
    req: { headers: {} },
    res: {},
  } as unknown as TrpcContext);
}

beforeEach(() => {
  predicates = [];
  const db: any = {
    select: vi.fn(() => {
      const query: any = {};
      for (const method of [
        "from",
        "innerJoin",
        "leftJoin",
        "groupBy",
        "orderBy",
        "limit",
        "offset",
      ])
        query[method] = vi.fn(() => query);
      query.where = vi.fn((predicate: SQL | undefined) => {
        predicates.push(predicate);
        return query;
      });
      query.then = (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve([]).then(resolve);
      return query;
    }),
  };
  db.transaction = vi.fn((read: (tx: any) => Promise<unknown>) => read(db));
  state.db = db;
});

describe("core report role and tenant boundaries", () => {
  it.each(reports)(
    "%s scopes every source query to the authenticated %s tenant",
    async (procedure, role, table, count) => {
      // Unknown input keys must never override the trusted context scope.
      const input = { tenantId: 999 };
      const artifact = await caller(role)[procedure](input as {});
      expect(artifact.content.length).toBeGreaterThan(0);
      expect(predicates).toHaveLength(count);
      for (const predicate of predicates) {
        expect(predicate).toBeDefined();
        const query = dialect.sqlToQuery(predicate!);
        expect(query.sql).toMatch(/(?:`tenantId`|scoped_booking\.tenantId)/);
        expect(query.sql).toContain(table);
        expect(query.params).toContain(101);
        expect(query.params).not.toContain(999);
      }
    }
  );

  it.each(reports)(
    "%s admits scoped airline administrators and retains global platform access",
    async procedure => {
      await caller("airline_admin")[procedure]({});
      expect(predicates.length).toBeGreaterThan(0);
      for (const predicate of predicates)
        expect(dialect.sqlToQuery(predicate!).params).toContain(101);

      for (const role of ["admin", "super_admin"]) {
        predicates = [];
        await caller(role)[procedure]({});
        for (const predicate of predicates) {
          if (!predicate) continue;
          expect(dialect.sqlToQuery(predicate).sql).not.toContain("tenantId");
          expect(dialect.sqlToQuery(predicate).params).not.toContain(101);
        }
      }
    }
  );

  it.each(reports)(
    "%s rejects unsupported roles and invalid airline scope before reading data",
    async (procedure, role) => {
      for (const rejectedRole of [
        "user",
        "support",
        role === "ops" ? "finance" : "ops",
      ])
        await expect(caller(rejectedRole)[procedure]({})).rejects.toMatchObject(
          {
            code: "FORBIDDEN",
          }
        );
      for (const allowedRole of [role, "airline_admin"]) {
        await expect(
          caller(allowedRole, null)[procedure]({})
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          caller(allowedRole, 101, 999)[procedure]({})
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
      await expect(caller(null)[procedure]({})).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(state.db.select).not.toHaveBeenCalled();
    }
  );
});
