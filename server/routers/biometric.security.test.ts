import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { biometricRouter } from "./biometric";
import * as biometric from "../services/biometric.service";

const boundary = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: boundary.getDb }));

const hash = "synthetic-template-for-tests-only";
let passengerId = 700;
let row:
  | {
      bookingId: number;
      ownerId: number;
      passengerTenantId: number | null;
      bookingTenantId: number | null;
    }
  | undefined;

function context(
  userId = 42,
  tenantId: number | null = 7,
  role = "user"
): TrpcContext {
  return {
    user: { id: userId, role, tenantId } as NonNullable<TrpcContext["user"]>,
    tenantId,
    authMethod: "bearer",
    req: { headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function operations(ctx: TrpcContext) {
  const caller = biometricRouter.createCaller(ctx);
  // Zod must discard forged authority and the router must use trusted context.
  const input = {
    passengerId,
    biometricType: "face" as const,
    templateHash: hash,
    consentGiven: true,
    flightId: 9,
    userId: 42,
    role: "admin",
    tenantId: 7,
    actor: { userId: 42, role: "admin", tenantId: 7 },
  };
  return {
    enroll: () => caller.enroll(input),
    verify: () => caller.verify(input),
    token: () => caller.getBoardingToken(input),
    status: () => caller.getMyEnrollment(input),
    revoke: () => caller.revokeEnrollment(input),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AIS_ENABLE_DEMOS", "true");
  passengerId++;
  row = { bookingId: 3, ownerId: 42, passengerTenantId: 7, bookingTenantId: 7 };
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(row ? [row] : [])),
  };
  boundary.getDb.mockResolvedValue(query);
  await operations(context()).enroll();
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  { name: "another user", userId: 99, tenantId: 7, role: "user" },
  {
    name: "airline admin who does not own the booking",
    userId: 99,
    tenantId: 7,
    role: "airline_admin",
  },
  {
    name: "owner in a different tenant",
    userId: 42,
    tenantId: 8,
    role: "user",
  },
  {
    name: "owner without tenant context",
    userId: 42,
    tenantId: null,
    role: "user",
  },
])("biometric access: $name", ({ userId, tenantId, role }) => {
  it.each(["enroll", "verify", "token", "status", "revoke"] as const)(
    "rejects %s without changing enrollment or events",
    async operation => {
      const eventsBefore = biometric.getBiometricEvents({ passengerId }).total;
      await expect(
        operations(context(userId, tenantId, role))[operation]()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(biometric.getBiometricEvents({ passengerId }).total).toBe(
        eventsBefore
      );
      expect((await operations(context()).status()).hasActiveEnrollment).toBe(
        true
      );
    }
  );
});

it.each([
  { passengerTenantId: null, bookingTenantId: 7 },
  { passengerTenantId: 7, bookingTenantId: null },
  { passengerTenantId: 8, bookingTenantId: 7 },
  { passengerTenantId: 7, bookingTenantId: 8 },
])("rejects inconsistent or unassigned tenant records: %j", async tenants => {
  if (!row) throw new Error("Missing passenger fixture");
  Object.assign(row, tenants);
  for (const operation of Object.values(operations(context()))) {
    await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});

it("fails closed when the passenger no longer exists", async () => {
  row = undefined;
  for (const operation of Object.values(operations(context()))) {
    await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
});

it("requires authentication on every passenger endpoint", async () => {
  const ctx = context();
  ctx.user = null;
  boundary.getDb.mockClear();
  for (const operation of Object.values(operations(ctx))) {
    await expect(operation()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }
  expect(boundary.getDb).not.toHaveBeenCalled();
});

it("supports the owning passenger workflow in explicitly enabled demo mode", async () => {
  const owner = operations(context());
  expect((await owner.status()).hasActiveEnrollment).toBe(true);
  await expect(owner.verify()).resolves.toMatchObject({ verified: true });
  expect((await owner.token()).token).toMatch(/^[a-f0-9]{64}$/);
  await expect(owner.revoke()).resolves.toEqual({ revoked: 1 });
  expect((await owner.status()).hasActiveEnrollment).toBe(false);
});

it.each(["admin", "super_admin"])(
  "preserves the explicit platform %s override",
  async role => {
    expect(
      (await operations(context(99, 8, role)).status()).hasActiveEnrollment
    ).toBe(true);
  }
);

it("checks ownership on direct service calls as well as router calls", async () => {
  const actor = { userId: 99, role: "user", tenantId: 7 };
  const calls = [
    () => biometric.enrollPassenger(passengerId, "face", hash, actor, true),
    () => biometric.verifyIdentity(passengerId, "face", hash, actor),
    () => biometric.getBoardingToken(passengerId, 9, actor),
    () => biometric.getEnrollmentStatus(passengerId, actor),
    () => biometric.revokeEnrollment(passengerId, actor),
  ];
  for (const call of calls) {
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});

it("requires a fresh database authorization check and fails closed on database loss", async () => {
  boundary.getDb.mockResolvedValue(null);
  for (const operation of Object.values(operations(context()))) {
    await expect(operation()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  }
});

it("rejects the full passenger surface in production even with demos enabled", async () => {
  vi.stubEnv("NODE_ENV", "production");
  boundary.getDb.mockClear();
  for (const operation of Object.values(operations(context()))) {
    await expect(operation()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  }
  expect(boundary.getDb).not.toHaveBeenCalled();
});
