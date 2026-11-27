import { beforeEach, describe, it, expect, vi } from "vitest";
import { auditLogs, type InsertAuditLog } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createAuditLog,
  persistAuditLog,
  auditLogin,
  auditBookingChange,
  auditPayment,
  auditRoleChange,
  auditAdminAccess,
} from "./audit.service";

const sink = vi.hoisted(() => ({
  getDb: vi.fn(),
  insert: vi.fn(),
  values: vi.fn<(row: InsertAuditLog) => Promise<void>>(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: sink.getDb }));
vi.mock("../_core/logger", () => ({
  logger: { info: sink.info, error: sink.error },
}));

beforeEach(() => {
  vi.resetAllMocks();
  sink.getDb.mockReturnValue({ insert: sink.insert });
  sink.insert.mockReturnValue({ values: sink.values });
  sink.values.mockResolvedValue(undefined);
});

type ExpectedAuditFields = Partial<
  Omit<InsertAuditLog, "previousValue" | "newValue" | "metadata">
> & {
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
};

function readSnapshot(serialized: string | null | undefined): unknown {
  return serialized == null ? serialized : JSON.parse(serialized);
}

function expectAuditInsert(fields: ExpectedAuditFields) {
  expect(sink.insert).toHaveBeenCalledExactlyOnceWith(auditLogs);
  expect(sink.values).toHaveBeenCalledTimes(1);
  const [row] = sink.values.mock.calls[0];
  expect({
    ...row,
    previousValue: readSnapshot(row.previousValue),
    newValue: readSnapshot(row.newValue),
    metadata: readSnapshot(row.metadata),
  }).toMatchObject(fields);
  return row;
}

const event = {
  eventType: "BOOKING_CREATED",
  eventCategory: "booking",
  outcome: "success",
} as const;

describe("Audit Service", () => {
  describe("createAuditLog", () => {
    it("should create an audit log entry", async () => {
      await createAuditLog({
        eventType: "LOGIN_SUCCESS",
        eventCategory: "auth",
        outcome: "success",
        severity: "low",
        userId: 1,
        userRole: "user",
        actorType: "user",
        sourceIp: "192.168.1.1",
        resourceType: "user",
        resourceId: "test@example.com",
      });

      const row = expectAuditInsert({
        eventType: "LOGIN_SUCCESS",
        eventCategory: "auth",
        outcome: "success",
        severity: "low",
        userId: 1,
        userRole: "user",
        actorType: "user",
        sourceIp: "192.168.1.1",
        resourceType: "user",
        resourceId: "test@example.com",
      });
      expect(row.eventId).toMatch(/^[\w-]{32}$/);
      expect(sink.info).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          eventId: row.eventId,
          eventType: "LOGIN_SUCCESS",
          outcome: "success",
        }),
        "Audit: LOGIN_SUCCESS"
      );
    });

    it("should handle missing optional fields", async () => {
      await createAuditLog({
        eventType: "BOOKING_CREATED",
        eventCategory: "booking",
        outcome: "success",
      });

      expectAuditInsert({
        ...event,
        actorType: "system",
        severity: "low",
        userId: null,
        userRole: null,
        sourceIp: null,
        userAgent: null,
        requestId: null,
        resourceType: null,
        resourceId: null,
        previousValue: null,
        newValue: null,
        changeDescription: null,
        metadata: null,
      });
    });

    it("should serialize previousValue and newValue as JSON", async () => {
      await createAuditLog({
        eventType: "BOOKING_MODIFIED",
        eventCategory: "booking",
        outcome: "success",
        previousValue: { status: "pending" },
        newValue: { status: "confirmed" },
      });

      expectAuditInsert({
        eventType: "BOOKING_MODIFIED",
        eventCategory: "booking",
        outcome: "success",
        previousValue: { status: "pending" },
        newValue: { status: "confirmed" },
      });
    });
  });

  describe("storage boundaries", () => {
    it("reports an unavailable database without failing the caller", async () => {
      sink.getDb.mockReturnValue(null);
      await expect(createAuditLog(event)).resolves.toBeUndefined();
      expect(sink.error).toHaveBeenCalledExactlyOnceWith(
        {},
        "Database not available for audit log"
      );
      expect(sink.insert).not.toHaveBeenCalled();
      expect(sink.info).not.toHaveBeenCalled();
    });

    it("reports a rejected best-effort write without announcing success", async () => {
      const error = new Error("Synthetic audit write failed");
      sink.values.mockRejectedValue(error);
      await expect(createAuditLog(event)).resolves.toBeUndefined();
      expectAuditInsert(event);
      expect(sink.error).toHaveBeenCalledExactlyOnceWith(
        { error, eventType: "BOOKING_CREATED" },
        "Failed to create audit log"
      );
      expect(sink.info).not.toHaveBeenCalled();
    });

    it("leaves a mandatory write's announcement to its transaction owner", async () => {
      const writer = getDb()!;
      sink.getDb.mockClear();
      const announce = await persistAuditLog(writer, event);
      const row = expectAuditInsert(event);
      expect(sink.getDb).not.toHaveBeenCalled();
      expect(sink.info).not.toHaveBeenCalled();
      announce();
      expect(sink.info).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ eventId: row.eventId, outcome: "success" }),
        "Audit: BOOKING_CREATED"
      );
    });

    it("propagates a mandatory write failure to its transaction owner", async () => {
      const error = new Error("Synthetic transaction write failed");
      sink.values.mockRejectedValue(error);
      await expect(persistAuditLog(getDb()!, event)).rejects.toBe(error);
      expectAuditInsert(event);
      expect(sink.info).not.toHaveBeenCalled();
    });
  });

  describe("auditLogin", () => {
    it("should audit successful login", async () => {
      await auditLogin(
        1,
        "user@example.com",
        "success",
        "192.168.1.1",
        "Mozilla/5.0",
        "req-123"
      );

      expectAuditInsert({
        eventType: "LOGIN_SUCCESS",
        eventCategory: "auth",
        outcome: "success",
        severity: "low",
        actorType: "user",
        userId: 1,
        resourceType: "user",
        resourceId: "user@example.com",
        sourceIp: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        requestId: "req-123",
      });
    });

    it("should audit failed login with severity medium", async () => {
      await auditLogin(
        null,
        "attacker@example.com",
        "failure",
        "192.168.1.100",
        "Mozilla/5.0",
        "req-124"
      );

      expectAuditInsert({
        eventType: "LOGIN_FAILED",
        eventCategory: "auth",
        outcome: "failure",
        severity: "medium",
        actorType: "user",
        userId: null,
        resourceType: "user",
        resourceId: "attacker@example.com",
        sourceIp: "192.168.1.100",
        requestId: "req-124",
      });
    });
  });

  describe("auditBookingChange", () => {
    it("should audit booking creation", async () => {
      await auditBookingChange(
        1,
        "ABC123",
        1,
        "user",
        "created",
        undefined,
        { status: "pending", amount: 50000 },
        "192.168.1.1",
        "req-125"
      );

      expectAuditInsert({
        eventType: "BOOKING_CREATED",
        eventCategory: "booking",
        outcome: "success",
        severity: "low",
        userId: 1,
        userRole: "user",
        actorType: "user",
        resourceType: "booking",
        resourceId: "ABC123",
        previousValue: null,
        newValue: { status: "pending", amount: 50000 },
        requestId: "req-125",
      });
    });

    it("should audit booking modification with previous and new values", async () => {
      await auditBookingChange(
        1,
        "ABC123",
        1,
        "user",
        "modified",
        { status: "pending" },
        { status: "confirmed" },
        "192.168.1.1",
        "req-126"
      );

      expectAuditInsert({
        eventType: "BOOKING_MODIFIED",
        eventCategory: "booking",
        outcome: "success",
        userId: 1,
        userRole: "user",
        resourceType: "booking",
        resourceId: "ABC123",
        previousValue: { status: "pending" },
        newValue: { status: "confirmed" },
        requestId: "req-126",
      });
    });

    it("should audit booking cancellation with medium severity", async () => {
      await auditBookingChange(
        1,
        "ABC123",
        1,
        "admin",
        "cancelled",
        { status: "confirmed" },
        { status: "cancelled" },
        "192.168.1.1",
        "req-127"
      );

      expectAuditInsert({
        eventType: "BOOKING_CANCELLED",
        eventCategory: "booking",
        outcome: "success",
        severity: "medium",
        userId: 1,
        userRole: "admin",
        resourceType: "booking",
        resourceId: "ABC123",
        previousValue: { status: "confirmed" },
        newValue: { status: "cancelled" },
        requestId: "req-127",
      });
    });
  });

  describe("auditPayment", () => {
    it("should audit successful payment", async () => {
      await auditPayment(
        1,
        "ABC123",
        50000,
        "PAYMENT_SUCCESS",
        1,
        "pi_123456",
        "192.168.1.1",
        "req-128"
      );

      expectAuditInsert({
        eventType: "PAYMENT_SUCCESS",
        eventCategory: "payment",
        outcome: "success",
        severity: "medium",
        actorType: "user",
        userId: 1,
        resourceType: "payment",
        resourceId: "pi_123456",
        newValue: {
          bookingId: 1,
          bookingReference: "ABC123",
          amount: 50000,
          paymentIntentId: "pi_123456",
        },
        requestId: "req-128",
      });
    });

    it("should audit failed payment with high severity", async () => {
      await auditPayment(
        1,
        "ABC123",
        50000,
        "PAYMENT_FAILED",
        1,
        "pi_123457",
        "192.168.1.1",
        "req-129"
      );

      expectAuditInsert({
        eventType: "PAYMENT_FAILED",
        eventCategory: "payment",
        outcome: "failure",
        severity: "high",
        actorType: "user",
        userId: 1,
        resourceType: "payment",
        resourceId: "pi_123457",
        newValue: {
          bookingId: 1,
          bookingReference: "ABC123",
          amount: 50000,
          paymentIntentId: "pi_123457",
        },
        requestId: "req-129",
      });
    });
  });

  describe("auditRoleChange", () => {
    it("should audit role change with high severity", async () => {
      await auditRoleChange(
        2,
        "user@example.com",
        1,
        "super_admin",
        "user",
        "admin",
        "192.168.1.1",
        "req-130"
      );

      expectAuditInsert({
        eventType: "USER_ROLE_CHANGED",
        eventCategory: "user_management",
        outcome: "success",
        severity: "high",
        actorType: "admin",
        userId: 1,
        userRole: "super_admin",
        resourceType: "user",
        resourceId: "user@example.com",
        previousValue: { role: "user" },
        newValue: { role: "admin" },
        requestId: "req-130",
      });
    });

    it("should include metadata for tracking", async () => {
      await auditRoleChange(
        3,
        "staff@example.com",
        1,
        "super_admin",
        "support",
        "ops",
        "192.168.1.1",
        "req-131"
      );

      expectAuditInsert({
        eventType: "USER_ROLE_CHANGED",
        actorType: "admin",
        userId: 1,
        userRole: "super_admin",
        resourceType: "user",
        resourceId: "staff@example.com",
        previousValue: { role: "support" },
        newValue: { role: "ops" },
        metadata: { targetUserId: 3, performedBy: 1 },
        requestId: "req-131",
      });
    });
  });

  describe("auditAdminAccess", () => {
    it("should audit admin access", async () => {
      await auditAdminAccess(
        1,
        "admin",
        "viewed",
        "booking",
        "ABC123",
        "192.168.1.1",
        "req-132"
      );

      expectAuditInsert({
        eventType: "ADMIN_ACCESS",
        eventCategory: "access",
        outcome: "success",
        severity: "medium",
        actorType: "admin",
        userId: 1,
        userRole: "admin",
        resourceType: "booking",
        resourceId: "ABC123",
        changeDescription: "Admin viewed on booking (ABC123)",
        requestId: "req-132",
      });
    });

    it("should audit admin deletion", async () => {
      await auditAdminAccess(
        1,
        "super_admin",
        "deleted",
        "user",
        "2",
        "192.168.1.1",
        "req-133"
      );

      expectAuditInsert({
        eventType: "ADMIN_ACCESS",
        eventCategory: "access",
        outcome: "success",
        severity: "medium",
        actorType: "admin",
        userId: 1,
        userRole: "super_admin",
        resourceType: "user",
        resourceId: "2",
        changeDescription: "Admin deleted on user (2)",
        requestId: "req-133",
      });
    });
  });
});
