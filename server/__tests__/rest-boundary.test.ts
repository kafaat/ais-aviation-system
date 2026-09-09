import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { z } from "zod";
const boundary = vi.hoisted(() => ({ allowed: true }));
vi.mock("../services/cache.service", () => ({
  cacheService: {
    isConnected: () => true,
    checkRateLimit: async () => ({
      allowed: boundary.allowed,
      remaining: boundary.allowed ? 4 : 0,
    }),
  },
}));
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import { createRestMiddleware, openApiProcedures } from "../_core/rest";
import { buildOpenApiDocument } from "../openapi";

const searchInput = z
  .object({
    id: z.number(),
    otherId: z.number(),
    date: z.date(),
    enabled: z.boolean(),
  })
  .refine(value => value.id !== value.otherId, "Different IDs required");
const testRouter = router({
  item: publicProcedure
    .meta({ openapi: { method: "GET", path: "/items/{id}" } })
    .input(z.object({ id: z.number() }))
    .query(({ input }) => input),
  search: publicProcedure
    .meta({ openapi: { method: "GET", path: "/items/search" } })
    .input(searchInput)
    .query(({ input }) => input),
  nested: publicProcedure
    .meta({ openapi: { method: "GET", path: "/nested" } })
    .input(z.object({ segments: z.array(z.object({ id: z.number() })) }))
    .query(({ input }) => input),
  update: protectedProcedure
    .meta({ openapi: { method: "POST", path: "/items/{id}" } })
    .input(
      z.object({ id: z.number(), quantity: z.number(), enabled: z.boolean() })
    )
    .mutation(({ input, ctx }) => ({ ...input, tenant: ctx.tenantId })),
  admin: adminProcedure
    .meta({ openapi: { method: "GET", path: "/admin" } })
    .query(() => ({ secret: true })),
  auth: router({
    login: publicProcedure
      .meta({ openapi: { method: "POST", path: "/login" } })
      .input(z.object({ email: z.string().email() }))
      .mutation(() => ({ success: true })),
  }),
});

async function withHttp(run: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/rest",
    createRestMiddleware({
      router: testRouter,
      createContext: ({ req, res }) => ({
        req,
        res,
        user: req.headers.authorization
          ? ({ id: 1, role: "airline_admin", tenantId: 7 } as any)
          : null,
        tenantId: req.headers.authorization ? 7 : null,
        authMethod: req.headers.authorization ? "bearer" : null,
      }),
    })
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    await run(`http://127.0.0.1:${(server.address() as any).port}/api/rest`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
beforeEach(() => {
  boundary.allowed = true;
});
describe("REST authority and serialization boundary", () => {
  it("serves static routes, numbers, dates and false without mutating tRPC input rules", async () => {
    await withHttp(async base => {
      const response = await fetch(
        base + "/items/search?id=1&otherId=2&date=2026-09-09&enabled=false"
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: 1,
        otherId: 2,
        date: "2026-09-09T00:00:00.000Z",
        enabled: false,
      });
      expect(
        (
          await fetch(
            base + "/items/search?id=1&otherId=1&date=2026-09-09&enabled=false"
          )
        ).status
      ).toBe(400);
      expect(
        (
          await fetch(
            base +
              "/items/search?id=1&otherId=2&date=2026-09-09&enabled=nonsense"
          )
        ).status
      ).toBe(400);
      expect((await fetch(base + "/missing")).status).toBe(404);
    });
    expect(
      searchInput.safeParse({
        id: "1",
        otherId: 2,
        date: new Date(),
        enabled: false,
      }).success
    ).toBe(false);
  });
  it("retains authorization, tenant context, strict JSON types and path precedence", async () => {
    await withHttp(async base => {
      const request = (body: unknown, authenticated = true) =>
        fetch(base + "/items/12", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authenticated ? { authorization: "Bearer fixture" } : {}),
          },
          body: JSON.stringify(body),
        });
      expect(
        (await request({ quantity: 2, enabled: false }, false)).status
      ).toBe(401);
      const response = await request({ id: 999, quantity: 2, enabled: false });
      expect(await response.json()).toEqual({
        id: 12,
        quantity: 2,
        enabled: false,
        tenant: 7,
      });
      expect((await request({ quantity: "2", enabled: "false" })).status).toBe(
        400
      );
      expect(
        (
          await fetch(base + "/admin", {
            headers: { authorization: "Bearer fixture" },
          })
        ).status
      ).toBe(403);
      const nested = await fetch(
        base + "/nested?segments=" + encodeURIComponent('[{"id":4}]')
      );
      expect(await nested.json()).toEqual({ segments: [{ id: 4 }] });
    });
  });
  it("enforces the existing sensitive procedure quota on REST calls", async () => {
    boundary.allowed = false;
    await withHttp(async base => {
      const response = await fetch(base + "/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      });
      expect(response.status).toBe(429);
    });
  });
  it("documents all real routes, public/protected access and unspecified responses honestly", () => {
    const doc = buildOpenApiDocument(testRouter);
    expect(Object.keys(doc.paths!)).toHaveLength(5);
    expect(doc.paths!["/items/search"].get!.security).toBeUndefined();
    expect(doc.paths!["/items/{id}"].post!.security).toHaveLength(2);
    expect(
      doc.paths!["/items/search"].get!["x-response-schema-unavailable"]
    ).toBe(true);
    expect(doc.components!.securitySchemes!.cookieAuth).toMatchObject({
      name: "app_session_id",
    });
    expect(() => buildOpenApiDocument(router({}))).toThrow("no endpoints");
  });
  it("generates the complete application document and registers every enabled route", async () => {
    const { appRouter } = await import("../routers");
    const doc = buildOpenApiDocument(appRouter);
    const operations = Object.values(doc.paths!).flatMap(path =>
      Object.keys(path).filter(key =>
        ["get", "post", "put", "patch", "delete"].includes(key)
      )
    );
    expect(operations).toHaveLength(openApiProcedures(appRouter).length);
    expect(Object.keys(doc.paths!).length).toBeGreaterThan(200);
    expect(() =>
      createRestMiddleware({
        router: appRouter,
        createContext: () => ({}) as any,
      })
    ).not.toThrow();
  });
});
