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
    flights: [
      {
        id: 900,
        economyAvailable: 0,
        businessAvailable: 0,
        status: "scheduled",
        departureTime: new Date(Date.now() + 86400000),
      },
    ],
    inventory_locks: [
      {
        id: 1,
        flightId: 900,
        userId: 101,
        cabinClass: "economy",
        numberOfSeats: 1,
        status: "active",
        expiresAt: new Date(Date.now() + 60000),
      },
    ],
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

// A competing writer can commit before our locking reread; it cannot write through a held MySQL lock.
function beforeEntryLock(mutate: () => void) {
  const select = fixture.db.select;
  let done = false;
  fixture.db.select = (...args: unknown[]) => {
    const chain = select(...args),
      from = chain.from;
    chain.from = (table: Parameters<typeof getTableName>[0]) => {
      from(table);
      if (getTableName(table) === "waitlist") {
        const lock = chain.for;
        chain.for = (...values: unknown[]) => {
          if (!done) {
            done = true;
            mutate();
          }
          return lock(...values);
        };
      }
      return chain;
    };
    return chain;
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
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows("waitlist")[1].status).toBe("waiting");
  });

  it.each(["waiting", "offered"])(
    "allows the owner to withdraw a %s entry idempotently",
    async status => {
      fixture.rows("waitlist")[0].status = status;
      if (status === "offered") fixture.rows("waitlist")[0].inventoryLockId = 1;
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

  it("preserves an already transferred waitlist entry", async () => {
    fixture.rows("waitlist")[0].status = "confirmed";
    fixture.rows("waitlist")[0].bookingId = 99;
    await expect(caller.removeFromWaitlist({ waitlistId: 1 })).rejects.toThrow(
      "linked booking"
    );
    expect(fixture.rows("waitlist")[0].status).toBe("confirmed");
  });
  it("keeps an expired entry expired on withdrawal retry", async () => {
    fixture.rows("waitlist")[0].status = "expired";
    await caller.removeFromWaitlist({ waitlistId: 1 });
    expect(fixture.rows("waitlist")[0].status).toBe("expired");
  });
  it("rolls back withdrawal when the locking reread finds a booking transfer", async () => {
    beforeEntryLock(() => {
      fixture.rows("waitlist")[0].status = "confirmed";
      fixture.rows("waitlist")[0].bookingId = 99;
    });
    await expect(caller.removeFromWaitlist({ waitlistId: 1 })).rejects.toThrow(
      "linked booking"
    );
    expect(fixture.rows("waitlist")[0].status).toBe("waiting"); // This rollback double restores the entire transaction snapshot.
  });

  it("does not resurrect a cancelled entry when processing a stale candidate list", async () => {
    fixture.rows("flights")[0].economyAvailable = 2;
    beforeEntryLock(() => {
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
