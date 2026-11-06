import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "../_core/context";

const state = vi.hoisted(() => ({
  db: null as unknown,
  review: { id: 71, status: "approved", helpfulCount: 7 } as {
    id: number;
    status: string;
    helpfulCount: number;
  } | null,
  votes: [] as { id: number; reviewId: number; userId: number }[],
  locked: vi.fn(),
  addFlight: vi.fn(),
  removeFlight: vi.fn(),
  getFlights: vi.fn(),
  isFlightFavorited: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../services/favorites.service", () => ({
  addFlightFavorite: state.addFlight,
  removeFlightFavorite: state.removeFlight,
  getUserFlightFavorites: state.getFlights,
  isFlightFavorited: state.isFlightFavorited,
}));
import { favoritesRouter } from "../routers/favorites";
import { reviewsRouter } from "../routers/reviews";
import { markReviewHelpful } from "../services/reviews.service";

const dialect = new MySqlDialect();
const context = (id?: number) =>
  ({
    user: id ? { id, role: "user", tenantId: null } : null,
    req: { headers: {} },
    res: {},
    tenantId: null,
  }) as TrpcContext;

beforeEach(() => {
  state.review = { id: 71, status: "approved", helpfulCount: 7 };
  state.votes = [];
  state.locked.mockClear();
  // Controlled transaction/data boundary. Real SQL and concurrency are covered
  // separately by the guarded native consumer suite.
  const tx = {
    select() {
      let table = "";
      let params: unknown[] = [];
      const query = {
        from(value: Parameters<typeof getTableName>[0]) {
          table = getTableName(value);
          return query;
        },
        where(predicate: SQL) {
          params = dialect.sqlToQuery(predicate).params;
          return query;
        },
        async for(mode: string) {
          state.locked(mode);
          return state.review && state.review.id === params[0]
            ? [state.review]
            : [];
        },
        async limit() {
          if (table !== "flight_review_helpful_votes") throw new Error(table);
          return state.votes.filter(
            vote => vote.reviewId === params[0] && vote.userId === params[1]
          );
        },
      };
      return query;
    },
    insert() {
      return {
        values: async (value: { reviewId: number; userId: number }) => {
          state.votes.push({ id: state.votes.length + 1, ...value });
        },
      };
    },
    update() {
      return {
        set: () => ({
          where: async () => {
            state.review!.helpfulCount++;
          },
        }),
      };
    },
  };
  state.db = {
    transaction: async (work: (connection: typeof tx) => Promise<void>) =>
      work(tx),
  };
  state.addFlight.mockReset().mockImplementation(async (userId, flightId) => ({
    id: 1,
    userId,
    flightId,
    createdAt: new Date(),
  }));
  state.removeFlight.mockReset().mockResolvedValue({ success: true });
  state.getFlights.mockReset().mockResolvedValue([]);
  state.isFlightFavorited.mockReset().mockResolvedValue(false);
});

describe("flight consumer procedure and vote boundaries (controlled data fixture)", () => {
  it("uses the authenticated identity for all individual-flight favorite operations", async () => {
    const caller = favoritesRouter.createCaller(context(11));
    // Unknown client userId is stripped by the real input schema.
    await caller.addFlight({ flightId: 41, userId: 22 } as {
      flightId: number;
    });
    await caller.removeFlight({ flightId: 41 });
    await caller.getFlights();
    await caller.isFlightFavorited({ flightId: 41 });
    expect(state.addFlight).toHaveBeenCalledWith(11, 41);
    expect(state.removeFlight).toHaveBeenCalledWith(11, 41);
    expect(state.getFlights).toHaveBeenCalledWith(11);
    expect(state.isFlightFavorited).toHaveBeenCalledWith(11, 41);
    await expect(
      favoritesRouter.createCaller(context()).addFlight({ flightId: 41 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("derives the helpful voter from context and applies retries only once", async () => {
    const caller = reviewsRouter.createCaller(context(11));
    await caller.markHelpful({ reviewId: 71, userId: 22 } as {
      reviewId: number;
    });
    await caller.markHelpful({ reviewId: 71 });
    expect(state.votes).toEqual([{ id: 1, reviewId: 71, userId: 11 }]);
    expect(state.review?.helpfulCount).toBe(8);
    expect(state.locked).toHaveBeenCalledWith("update");
    await reviewsRouter.createCaller(context(22)).markHelpful({ reviewId: 71 });
    expect(state.review?.helpfulCount).toBe(9);
    expect(state.votes.map(vote => vote.userId)).toEqual([11, 22]);
  });

  it("rejects anonymous helpful voting before reaching persistence", async () => {
    await expect(
      reviewsRouter.createCaller(context()).markHelpful({ reviewId: 71 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.locked).not.toHaveBeenCalled();
    expect(state.votes).toEqual([]);
  });

  it.each(["pending", "rejected", "hidden"])(
    "refuses helpful votes on a %s review",
    async status => {
      state.review!.status = status;
      await expect(markReviewHelpful(71, 11)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(state.review?.helpfulCount).toBe(7);
      expect(state.votes).toEqual([]);
    }
  );

  it("refuses a missing review without creating a vote", async () => {
    state.review = null;
    await expect(markReviewHelpful(71, 11)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(state.votes).toEqual([]);
  });
});
