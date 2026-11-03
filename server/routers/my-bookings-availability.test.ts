import { afterEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { bookingsRouter } from "./bookings";

afterEach(() => vi.unstubAllEnvs());

it("rejects an owned bookings read when storage is unavailable", async () => {
  vi.stubEnv("DATABASE_URL", "");
  const caller = bookingsRouter.createCaller({
    user: { id: 11, role: "user" },
    tenantId: 5,
  } as TrpcContext);
  await expect(caller.myBookings()).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "Failed to get bookings",
  });
});
