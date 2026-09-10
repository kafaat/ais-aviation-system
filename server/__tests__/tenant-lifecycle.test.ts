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
    const options = {
      req: {
        headers: method === "bearer" ? { authorization: "Bearer fixture" } : {},
      },
      res: {},
    } as any;
    expect((await createContext(options)).user?.id).toBe(3);
    await setTenantStatus(1, "suspended", 99);
    expect((await createContext(options)).user).toBeNull();
    expect(fixture.rows("outbox")[0].eventType).toBe("tenant.status_changed");
    fixture.rows("users")[0].role = "admin";
    expect((await createContext(options)).user?.id).toBe(3);
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
