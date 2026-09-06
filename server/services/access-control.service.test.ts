import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import * as rbac from "./rbac.service";
import {
  assertBookingOwnership,
  assertSplitOwnership,
  assertPassengerOwnership,
  assertModificationOwnership,
  assertTenant,
} from "./access-control.service";

vi.mock("../db");
vi.mock("./rbac.service");

/**
 * Build a chainable Drizzle query-builder mock whose terminal `.limit()`
 * resolves to the provided rows. Supports the .select().from().where()
 * [.innerJoin()].limit() chain used by access-control.service.
 */
function mockDb(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "innerJoin"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.limit = vi.fn(() => Promise.resolve(rows));
  return builder as unknown as Awaited<ReturnType<typeof db.getDb>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller is a normal user (admin bypass disabled)
  vi.mocked(rbac.isAdmin).mockReturnValue(false);
});

describe("access-control.service — tenant isolation", () => {
  describe("assertBookingOwnership", () => {
    it("allows the owner", async () => {
      vi.mocked(db.getDb).mockResolvedValue(mockDb([{ userId: 42 }]));
      await expect(assertBookingOwnership(1, 42)).resolves.toBe(42);
    });

    it("rejects a different user with FORBIDDEN", async () => {
      vi.mocked(db.getDb).mockResolvedValue(mockDb([{ userId: 99 }]));
      await expect(assertBookingOwnership(1, 42)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("throws NOT_FOUND when the booking does not exist", async () => {
      vi.mocked(db.getDb).mockResolvedValue(mockDb([]));
      await expect(assertBookingOwnership(1, 42)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("allows an admin to access another user's booking", async () => {
      vi.mocked(rbac.isAdmin).mockReturnValue(true);
      vi.mocked(db.getDb).mockResolvedValue(mockDb([{ userId: 99 }]));
      await expect(assertBookingOwnership(1, 42, "admin")).resolves.toBe(99);
    });
  });

  describe("assertSplitOwnership", () => {
    it("allows the booking owner", async () => {
      vi.mocked(db.getDb).mockResolvedValue(
        mockDb([{ bookingId: 7, ownerId: 42 }])
      );
      await expect(assertSplitOwnership(5, 42)).resolves.toBe(7);
    });

    it("rejects a non-owner", async () => {
      vi.mocked(db.getDb).mockResolvedValue(
        mockDb([{ bookingId: 7, ownerId: 99 }])
      );
      await expect(assertSplitOwnership(5, 42)).rejects.toBeInstanceOf(
        TRPCError
      );
    });

    it("throws NOT_FOUND for unknown split", async () => {
      vi.mocked(db.getDb).mockResolvedValue(mockDb([]));
      await expect(assertSplitOwnership(5, 42)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("assertPassengerOwnership", () => {
    it("allows when passenger's booking belongs to the user", async () => {
      vi.mocked(db.getDb).mockResolvedValue(
        mockDb([{ bookingId: 3, ownerId: 42 }])
      );
      await expect(assertPassengerOwnership(8, 42)).resolves.toBe(3);
    });

    it("rejects a non-owner", async () => {
      vi.mocked(db.getDb).mockResolvedValue(
        mockDb([{ bookingId: 3, ownerId: 1 }])
      );
      await expect(assertPassengerOwnership(8, 42)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("assertModificationOwnership", () => {
    it("allows the owner", async () => {
      vi.mocked(db.getDb).mockResolvedValue(mockDb([{ userId: 42 }]));
      await expect(assertModificationOwnership(2, 42)).resolves.toBeUndefined();
    });

    it("rejects a non-owner", async () => {
      vi.mocked(db.getDb).mockResolvedValue(mockDb([{ userId: 5 }]));
      await expect(assertModificationOwnership(2, 42)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("assertTenant", () => {
    it("allows when tenants match", () => {
      expect(() => assertTenant(7, 7)).not.toThrow();
    });

    it("rejects when tenants differ", () => {
      expect(() => assertTenant(7, 8)).toThrow();
    });

    it("rejects a caller with no tenant accessing tenant data", () => {
      expect(() => assertTenant(7, null)).toThrow();
    });

    it("allows legacy/unassigned (null) resource tenant through", () => {
      expect(() => assertTenant(null, 8)).not.toThrow();
    });

    it("lets admins cross tenants", () => {
      vi.mocked(rbac.isAdmin).mockReturnValue(true);
      expect(() => assertTenant(7, 8, "admin")).not.toThrow();
    });
  });
});
