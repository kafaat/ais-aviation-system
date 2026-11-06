import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import { trpcHttpBatchOptions } from "../../client/src/lib/trpc-transport";

const state = vi.hoisted(() => ({
  db: null as MySql2Database<typeof schema> | null,
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { router } from "../_core/trpc";
import { favoritesRouter } from "../routers/favorites";
import { reviewsRouter } from "../routers/reviews";

const consumerRouter = router({
  favorites: favoritesRouter,
  reviews: reviewsRouter,
});
const tables = [
  schema.users,
  schema.airlines,
  schema.airports,
  schema.flights,
  schema.bookings,
  schema.userFlightFavorites,
  schema.flightReviews,
  schema.flightReviewHelpfulVotes,
];
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

nativeDescribe(
  "flight consumers: real routers, browser serialization and native MySQL",
  () => {
    let admin: mysql.Connection | undefined;
    let pool: mysql.Pool | undefined;
    let api: Server | undefined;
    let databaseName = "";
    let created = false;
    let baseUrl = "";
    const db = () => state.db!;
    const client = (userId?: number) =>
      createTRPCClient<typeof consumerRouter>({
        links: [
          httpBatchLink({
            ...trpcHttpBatchOptions,
            url: `${baseUrl}/api/trpc`,
            headers: userId ? { "x-fixture-user": String(userId) } : {},
          }),
        ],
      });

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const source = url.pathname.slice(1);
      if (
        !/^ais_[a-z0-9_]*test$/.test(source) ||
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      ) {
        throw new Error(
          "Flight consumer acceptance requires an explicitly owned loopback ais_*test database"
        );
      }
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName = "ais_flight_consumers_" + randomBytes(6).toString("hex");
      admin = await mysql.createConnection(options);
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      for (const table of tables) {
        const name = getTableName(table);
        if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid fixture table");
        // Clone the migration-verified columns and indexes, not application data.
        await admin.query(
          `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
        );
      }
      pool = mysql.createPool({
        ...options,
        database: databaseName,
        connectionLimit: 6,
      });
      state.db = drizzle(pool, { schema, mode: "default" });
      const app = express();
      app.use(
        "/api/trpc",
        createExpressMiddleware({
          router: consumerRouter,
          // This is a controlled identity fixture, not a session/provider acceptance
          // claim. The actual procedure authorization and SQL ownership run below.
          createContext: async ({ req, res }) => {
            const id = Number(req.header("x-fixture-user"));
            const [user] =
              Number.isSafeInteger(id) && id > 0
                ? await db()
                    .select()
                    .from(schema.users)
                    .where(eq(schema.users.id, id))
                : [];
            return {
              req,
              res,
              user: user ?? null,
              tenantId: null,
              authMethod: user ? ("cookie" as const) : null,
            };
          },
        })
      );
      api = await new Promise<Server>(resolve => {
        const server = app.listen(0, "127.0.0.1", () => resolve(server));
      });
      baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    }, 30_000);

    beforeEach(async () => {
      for (const table of [...tables].reverse()) await db().delete(table);
      await db()
        .insert(schema.users)
        .values(
          [11, 22, 33, 44, 55, 66, 77].map(id => ({
            id,
            openId: `consumer-${id}`,
            name: `Consumer ${id}`,
            role: "user" as const,
          }))
        );
      await db()
        .insert(schema.airlines)
        .values({ id: 7, code: "FC", name: "Fixture Airlines" });
      await db()
        .insert(schema.airports)
        .values([
          {
            id: 3,
            code: "RUH",
            name: "Fixture origin",
            city: "Riyadh",
            country: "SA",
            timezone: "Asia/Riyadh",
          },
          {
            id: 4,
            code: "JED",
            name: "Fixture destination",
            city: "Jeddah",
            country: "SA",
            timezone: "Asia/Riyadh",
          },
        ]);
      await db()
        .insert(schema.flights)
        .values(
          [41, 42].map(id => ({
            id,
            flightNumber: `FC${id}`,
            airlineId: 7,
            originId: 3,
            destinationId: 4,
            departureTime: new Date("2030-01-01T10:00:00Z"),
            arrivalTime: new Date("2030-01-01T12:00:00Z"),
            economySeats: 100,
            businessSeats: 10,
            economyAvailable: 100,
            businessAvailable: 10,
            economyPrice: 50000,
            businessPrice: 100000,
          }))
        );
      await db()
        .insert(schema.flightReviews)
        .values([
          {
            id: 101,
            userId: 11,
            flightId: 41,
            rating: 5,
            status: "approved",
            title: "Approved five",
            isVerified: true,
          },
          {
            id: 102,
            userId: 22,
            flightId: 41,
            rating: 3,
            status: "approved",
            title: "Approved three",
            helpfulCount: 7,
          },
          {
            id: 103,
            userId: 33,
            flightId: 41,
            rating: 1,
            status: "pending",
            title: "Pending private",
          },
          {
            id: 104,
            userId: 44,
            flightId: 41,
            rating: 1,
            status: "hidden",
            title: "Hidden private",
          },
          {
            id: 105,
            userId: 55,
            flightId: 41,
            rating: 1,
            status: "rejected",
            title: "Rejected private",
          },
          {
            id: 106,
            userId: 11,
            flightId: 42,
            rating: 1,
            status: "approved",
            title: "Other flight",
          },
        ]);
    });

    afterAll(async () => {
      if (api) {
        api.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          api!.close(error => (error ? reject(error) : resolve()))
        );
      }
      state.db = null;
      await pool?.end();
      if (admin) {
        try {
          if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await admin.end();
        }
      }
    });

    it("saves, reloads, and removes only the caller's individual flight over serialized HTTP", async () => {
      const owner = client(11);
      const other = client(22);
      const saved = await owner.favorites.addFlight.mutate({ flightId: 41 });
      expect(saved).toMatchObject({
        userId: 11,
        flightId: 41,
        createdAt: expect.any(Date),
      });
      const reloaded = await client(11).favorites.getFlights.query();
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0].favorite.id).toBe(saved.id);
      expect(reloaded[0].flight.departureTime).toEqual(
        new Date("2030-01-01T10:00:00Z")
      );
      expect(reloaded[0].origin.timezone).toBe("Asia/Riyadh");
      expect(
        await owner.favorites.isFlightFavorited.query({ flightId: 41 })
      ).toBe(true);
      expect(await other.favorites.getFlights.query()).toEqual([]);
      expect(
        await other.favorites.isFlightFavorited.query({ flightId: 41 })
      ).toBe(false);
      await expect(
        other.favorites.removeFlight.mutate({ flightId: 41 })
      ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
      expect(await owner.favorites.getFlights.query()).toHaveLength(1);
      await owner.favorites.removeFlight.mutate({ flightId: 41 });
      expect(await client(11).favorites.getFlights.query()).toEqual([]);
      expect(
        await owner.favorites.isFlightFavorited.query({ flightId: 41 })
      ).toBe(false);
      await expect(client().favorites.getFlights.query()).rejects.toMatchObject(
        { data: { code: "UNAUTHORIZED" } }
      );
      await expect(
        client().favorites.addFlight.mutate({ flightId: 41 })
      ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
    });

    it("makes repeated/concurrent saves idempotent under the actual owner/flight unique index", async () => {
      const [indexes] = await pool!.query<mysql.RowDataPacket[]>(
        "SHOW INDEX FROM user_flight_favorites"
      );
      expect(
        indexes
          .filter(
            index =>
              Number(index.Non_unique) === 0 &&
              index.Key_name === "user_flight_favorites_unique_idx"
          )
          .map(index => index.Column_name)
      ).toEqual(["userId", "flightId"]);
      const saved = await Promise.all(
        Array.from({ length: 4 }, () =>
          client(11).favorites.addFlight.mutate({ flightId: 41 })
        )
      );
      expect(new Set(saved.map(favorite => favorite.id)).size).toBe(1);
      await client(22).favorites.addFlight.mutate({ flightId: 41 });
      await client(11).favorites.removeFlight.mutate({ flightId: 41 });
      expect(await client(22).favorites.getFlights.query()).toHaveLength(1);
      expect(await client(11).favorites.getFlights.query()).toEqual([]);
    });

    it("publishes only approved reviews and matching stats with stable filtered pages", async () => {
      const anonymous = client();
      const first = await anonymous.reviews.getFlightReviews.query({
        flightId: 41,
        limit: 1,
        offset: 0,
      });
      const second = await anonymous.reviews.getFlightReviews.query({
        flightId: 41,
        limit: 1,
        offset: 1,
      });
      expect(first.map(review => review.id)).toEqual([102]);
      expect(second.map(review => review.id)).toEqual([101]);
      expect(first[0]).toMatchObject({
        status: "approved",
        hasVoted: false,
        createdAt: expect.any(Date),
      });
      expect(
        await anonymous.reviews.getFlightReviews.query({
          flightId: 41,
          minRating: 5,
        })
      ).toMatchObject([{ id: 101 }]);
      expect(
        await anonymous.reviews.getFlightStats.query({ flightId: 41 })
      ).toMatchObject({
        totalReviews: 2,
        averageRating: 4,
        ratingDistribution: { 1: 0, 3: 1, 5: 1 },
      });
    });

    it("records one helpful effect per authenticated user, retains historical counts and rejects nonpublic reviews", async () => {
      const [indexes] = await pool!.query<mysql.RowDataPacket[]>(
        "SHOW INDEX FROM flight_review_helpful_votes"
      );
      expect(
        indexes
          .filter(
            index =>
              Number(index.Non_unique) === 0 &&
              index.Key_name === "flight_review_helpful_votes_unique_idx"
          )
          .map(index => index.Column_name)
      ).toEqual(["reviewId", "userId"]);
      await expect(
        client().reviews.markHelpful.mutate({ reviewId: 102 })
      ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
      await Promise.all(
        Array.from({ length: 5 }, () =>
          client(11).reviews.markHelpful.mutate({ reviewId: 102 })
        )
      );
      await client(11).reviews.markHelpful.mutate({ reviewId: 102 });
      let [review] = await db()
        .select()
        .from(schema.flightReviews)
        .where(eq(schema.flightReviews.id, 102));
      expect(review.helpfulCount).toBe(8);
      expect(
        await db().select().from(schema.flightReviewHelpfulVotes)
      ).toMatchObject([{ reviewId: 102, userId: 11 }]);
      expect(
        (await client(11).reviews.getFlightReviews.query({ flightId: 41 }))[0]
      ).toMatchObject({ hasVoted: true, helpfulCount: 8 });
      expect(
        (await client(22).reviews.getFlightReviews.query({ flightId: 41 }))[0]
          .hasVoted
      ).toBe(false);
      await client(22).reviews.markHelpful.mutate({ reviewId: 102 });
      [review] = await db()
        .select()
        .from(schema.flightReviews)
        .where(eq(schema.flightReviews.id, 102));
      expect(review.helpfulCount).toBe(9);
      for (const reviewId of [103, 104, 105, 999]) {
        await expect(
          client(11).reviews.markHelpful.mutate({ reviewId })
        ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
      }
      expect(
        await db().select().from(schema.flightReviewHelpfulVotes)
      ).toHaveLength(2);
    });

    it("deletes votes with the owned review atomically while preserving other reviews", async () => {
      await client(11).reviews.markHelpful.mutate({ reviewId: 102 });
      await client(22).reviews.markHelpful.mutate({ reviewId: 101 });
      await expect(
        client(11).reviews.delete.mutate({ reviewId: 102 })
      ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
      expect(
        await db().select().from(schema.flightReviewHelpfulVotes)
      ).toHaveLength(2);
      const results = await Promise.allSettled([
        client(22).reviews.delete.mutate({ reviewId: 102 }),
        client(33).reviews.markHelpful.mutate({ reviewId: 102 }),
      ]);
      expect(results[0].status).toBe("fulfilled");
      expect(
        await db().select().from(schema.flightReviewHelpfulVotes)
      ).toMatchObject([{ reviewId: 101, userId: 22 }]);
      expect(
        await db()
          .select()
          .from(schema.flightReviews)
          .where(eq(schema.flightReviews.id, 102))
      ).toEqual([]);
      await expect(
        client(33).reviews.markHelpful.mutate({ reviewId: 102 })
      ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    });

    it("keeps authenticated completed-booking eligibility separate from public reading", async () => {
      await expect(
        client().reviews.canReview.query({ flightId: 41 })
      ).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
      expect(
        await client(66).reviews.canReview.query({ flightId: 41 })
      ).toMatchObject({ canReview: false });
      await db().insert(schema.bookings).values({
        id: 301,
        userId: 77,
        flightId: 41,
        bookingReference: "FC77AA",
        pnr: "FC77AA",
        status: "completed",
        totalAmount: 50000,
        paymentStatus: "paid",
      });
      expect(
        await client(77).reviews.canReview.query({ flightId: 41 })
      ).toMatchObject({ canReview: true, bookingId: 301 });
      expect(
        await client(11).reviews.canReview.query({ flightId: 41 })
      ).toMatchObject({ canReview: false, reason: "already_reviewed" });
    });
  }
);
