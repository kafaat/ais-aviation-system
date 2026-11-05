import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import type { UserRole } from "../services/rbac.service";
import { ancillaryRouter } from "./ancillary";
const { read } = vi.hoisted(() => ({ read: vi.fn().mockResolvedValue([]) }));
vi.mock("../services/ancillary-services.service", () => ({
  getBookingAncillaries: read,
}));
vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => [{ tenantId: 7, userId: 33 }] }),
      }),
    }),
  }),
}));
function caller(id: number, tenantId: number | null, role: UserRole = "user") {
  return ancillaryRouter.createCaller({
    user: { id, role },
    tenantId,
  } as TrpcContext);
}

beforeEach(() => read.mockClear());

it("rejects a different booking owner or a different tenant before reading passenger/sector labels", async () => {
  await expect(
    caller(34, 7).getBookingAncillaries({ bookingId: 5 })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(33, 8).getBookingAncillaries({ bookingId: 5 })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(read).not.toHaveBeenCalled();
  await expect(
    caller(33, 7).getBookingAncillaries({ bookingId: 5 })
  ).resolves.toEqual([]);
});

it.each(["admin", "super_admin"] as const)(
  "lets %s inspect another owner's extras in the bag-drop console",
  async role => {
    for (const tenantId of [7, null]) {
      await expect(
        caller(34, tenantId, role).getBookingAncillaries({ bookingId: 5 })
      ).resolves.toEqual([]);
    }
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(5);
  }
);

it.each(["user", "finance", "airline_admin", "ops", "support"] as const)(
  "keeps another owner's extras forbidden to %s",
  async role => {
    await expect(
      caller(34, 7, role).getBookingAncillaries({ bookingId: 5 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
  }
);

it.each(["admin", "super_admin"] as const)(
  "keeps the tenant boundary for %s before reading extras",
  async role => {
    await expect(
      caller(34, 8, role).getBookingAncillaries({ bookingId: 5 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(read).not.toHaveBeenCalled();
  }
);
