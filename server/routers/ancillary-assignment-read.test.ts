import { expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
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
it("rejects a different booking owner or a different tenant before reading passenger/sector labels", async () => {
  const caller = (id: number, tenantId: number) =>
    ancillaryRouter.createCaller({
      user: { id, role: "user" },
      tenantId,
    } as TrpcContext);
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
