import { beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({
  db: null as any,
  cookie: vi.fn(),
  bearer: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: state.cookie } }));
vi.mock("../services/mobile-auth-v2.service", () => ({
  mobileAuthServiceV2: { authenticateAccessToken: state.bearer },
}));
import { auditLogs } from "../../drizzle/schema";
import { createContext } from "../_core/context";
import { setTenantStatus, assignUserTenant } from "../services/tenant.service";
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    tenants: [
      { id: 1, status: "active" },
      { id: 2, status: "pending" },
    ],
    users: [{ id: 3, tenantId: 1, role: "user" }],
  });
  state.db = fixture.db;
  state.cookie.mockReset().mockImplementation(() => fixture.rows("users")[0]);
  state.bearer.mockReset().mockImplementation(() => fixture.rows("users")[0]);
});
it.each(["cookie", "bearer"])(
  "suspension blocks the next %s request while preserving platform administration",
  async method => {
    // Each HTTP request owns one cached identity. A later request must use a
    // new request object so tenant suspension is checked again.
    const nextRequest = () =>
      createContext({
        req: {
          headers:
            method === "bearer" ? { authorization: "Bearer fixture" } : {},
        },
        res: {},
      } as any);
    expect((await nextRequest()).user?.id).toBe(3);
    await setTenantStatus(1, "suspended", 99);
    expect((await nextRequest()).user).toBeNull();
    expect(fixture.rows("outbox")[0].eventType).toBe("tenant.status_changed");
    fixture.rows("users")[0].role = "admin";
    expect((await nextRequest()).user?.id).toBe(3);
    expect(
      method === "bearer" ? state.bearer : state.cookie
    ).toHaveBeenCalledTimes(3);
  }
);
it("rejects pending tenant assignment and rolls back when the audit event fails", async () => {
  await expect(assignUserTenant(3, 2, 99)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  fixture.failInsert("outbox");
  await expect(setTenantStatus(1, "suspended", 99)).rejects.toThrow("Injected");
  expect(fixture.rows("tenants")[0].status).toBe("active");
});

it.each(["airline_admin", "ops", "finance", "user"] as const)(
  "rejects %s at every global tenant administration endpoint",
  async role => {
    const { tenantsRouter } = await import("../routers/tenants");
    fixture.rows("users")[0].role = role;
    const ctx = await createContext({ req: { headers: {} }, res: {} } as any);
    const caller = tenantsRouter.createCaller(ctx);
    for (const action of [
      () => caller.list(),
      () => caller.create({ slug: "test-air", name: "Test Air" }),
      () => caller.setStatus({ tenantId: 2, status: "active" }),
      () => caller.assignUser({ tenantId: 2, userId: 3 }),
    ])
      await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.rows("tenants")[1].status).toBe("pending");
    expect(fixture.rows("users")[0].tenantId).toBe(1);
  }
);

it.each([
  { slug: "a".repeat(65), name: "Test Air" },
  { slug: "test-air", name: "   " },
])("rejects invalid tenant identity before storage", async input => {
  const { tenantsRouter } = await import("../routers/tenants");
  fixture.rows("users")[0].role = "admin";
  const ctx = await createContext({ req: { headers: {} }, res: {} } as any);
  const select = vi.spyOn(fixture.db, "select");
  const insert = vi.spyOn(fixture.db, "insert");
  await expect(
    tenantsRouter.createCaller(ctx).create(input)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(select).not.toHaveBeenCalled();
  // The privileged builder records the refused attempt in audit_logs (S-21);
  // no tenant storage may be touched before validation.
  const storageInserts = insert.mock.calls.filter(
    ([table]) => table !== auditLogs
  );
  expect(storageInserts).toEqual([]);
  expect(insert).toHaveBeenCalledTimes(1);
});
