import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

import { inventoryRouter } from "../routers/inventory.router";
import { processWaitlist } from "../services/inventory/inventory.service";

let fixture: ReturnType<typeof transactionMemory>;
const ctx = {
  user: { id: 101, role: "user", tenantId: 1 },
  tenantId: 1,
  req: { headers: {} },
  res: {},
} as TrpcContext;
const caller = inventoryRouter.createCaller(ctx);

beforeEach(() => {
  fixture = transactionMemory({
    seat_holds: [
      {
        id: 1,
        userId: 101,
        flightId: 900,
        cabinClass: "economy",
        seats: 1,
        status: "active",
      },
      {
        id: 2,
        userId: 202,
        flightId: 900,
        cabinClass: "economy",
        seats: 1,
        status: "active",
      },
    ],
    waitlist: [
      {
        id: 1,
        userId: 101,
        flightId: 900,
        cabinClass: "economy",
        seats: 1,
        status: "waiting",
        priority: 1,
      },
      {
        id: 2,
        userId: 202,
        flightId: 900,
        cabinClass: "economy",
        seats: 1,
        status: "waiting",
        priority: 2,
      },
    ],
  });
  boundary.db = fixture.db;
  boundary.db.query = {
    flights: {
      findFirst: () =>
        Promise.resolve({
          id: 900,
          economySeats: 10,
          economyAvailable: 10,
          businessSeats: 0,
          businessAvailable: 0,
          originId: 1,
          destinationId: 2,
          airlineId: 1,
        }),
    },
  };
});

// Change persisted state after the service's read but before its conditional write.
function beforeWrite(tableName: string, mutate: () => void) {
  const update = fixture.db.update;
  boundary.db.update = (table: Parameters<typeof getTableName>[0]) => {
    if (getTableName(table) === tableName) mutate();
    return update(table);
  };
}

describe("inventory owner mutations through the real router and service", () => {
  it("rejects releasing another user's hold without modifying inventory", async () => {
    await expect(caller.releaseHold({ holdId: 2 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.rows("seat_holds")[1].status).toBe("active");
    expect(
      fixture.rows("waitlist").every(row => row.status === "waiting")
    ).toBe(true);
  });

  it("releases the owner's hold once and preserves another user's hold", async () => {
    await expect(caller.releaseHold({ holdId: 1 })).resolves.toMatchObject({
      success: true,
    });
    expect(fixture.rows("seat_holds").map(row => row.status)).toEqual([
      "released",
      "active",
    ]);
    await expect(caller.releaseHold({ holdId: 1 })).resolves.toMatchObject({
      success: true,
    });
  });

  it.each(["converted", "expired"])(
    "does not release a %s hold",
    async status => {
      fixture.rows("seat_holds")[0].status = status;
      await expect(caller.releaseHold({ holdId: 1 })).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(fixture.rows("seat_holds")[0].status).toBe(status);
    }
  );

  it("rolls back the transaction when the conditional hold write loses a race", async () => {
    beforeWrite("seat_holds", () => {
      fixture.rows("seat_holds")[0].status = "converted";
    });
    await expect(caller.releaseHold({ holdId: 1 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(fixture.rows("seat_holds")[0].status).toBe("active");
    expect(fixture.rows("waitlist")[0].status).toBe("waiting");
  });

  it("rejects cancelling another user's waitlist entry", async () => {
    await expect(
      caller.removeFromWaitlist({ waitlistId: 2, reason: "cancelled" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.rows("waitlist")[1].status).toBe("waiting");
  });

  it.each(["waiting", "offered"])(
    "allows the owner to withdraw a %s entry idempotently",
    async status => {
      fixture.rows("waitlist")[0].status = status;
      await caller.removeFromWaitlist({ waitlistId: 1, reason: "cancelled" });
      await caller.removeFromWaitlist({ waitlistId: 1 });
      expect(fixture.rows("waitlist").map(row => row.status)).toEqual([
        "cancelled",
        "waiting",
      ]);
    }
  );

  it.each(["confirmed", "expired"])(
    "rejects passenger-requested %s transitions",
    async reason => {
      await expect(
        caller.removeFromWaitlist({ waitlistId: 1, reason } as any)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixture.rows("waitlist")[0].status).toBe("waiting");
    }
  );

  it.each(["confirmed", "expired"])(
    "preserves an already %s waitlist entry",
    async status => {
      fixture.rows("waitlist")[0].status = status;
      await expect(
        caller.removeFromWaitlist({ waitlistId: 1 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixture.rows("waitlist")[0].status).toBe(status);
    }
  );

  it("does not overwrite waitlist confirmation between read and write", async () => {
    beforeWrite("waitlist", () => {
      fixture.rows("waitlist")[0].status = "confirmed";
    });
    await expect(
      caller.removeFromWaitlist({ waitlistId: 1 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.rows("waitlist")[0].status).toBe("confirmed");
  });

  it("does not resurrect a cancelled entry when processing a stale candidate list", async () => {
    beforeWrite("waitlist", () => {
      fixture.rows("waitlist")[0].status = "cancelled";
    });
    await expect(processWaitlist(900, "economy")).resolves.toBe(1);
    expect(fixture.rows("waitlist").map(row => row.status)).toEqual([
      "cancelled",
      "offered",
    ]);
  });

  it("returns NOT_FOUND for unknown resources", async () => {
    await expect(caller.releaseHold({ holdId: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller.removeFromWaitlist({ waitlistId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
