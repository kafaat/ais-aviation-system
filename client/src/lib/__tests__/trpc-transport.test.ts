// @vitest-environment node
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { trpcHttpBatchOptions } from "../trpc-transport";

afterEach(() => vi.unstubAllGlobals());

it("splits 19 queued browser reads into accepted batches and returns every result", async () => {
  const t = initTRPC.create({ transformer: superjson });
  const timestamp = new Date("2026-11-03T00:00:00.000Z");
  const router = t.router({
    read: t.procedure
      .input(z.object({ id: z.number().int() }))
      .query(({ input }) => ({ id: input.id, timestamp })),
  });
  const requests: Array<{
    size: number;
    status: number;
    credentials: RequestCredentials | undefined;
  }> = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://local.test");
      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req: new Request(url, init),
        router,
        createContext: () => ({}),
        // Production's existing server/_core/index.ts request limit.
        maxBatchSize: 10,
      });
      requests.push({
        size: url.pathname.split("/").at(-1)!.split(",").length,
        status: response.status,
        credentials: init?.credentials,
      });
      return response;
    }
  );
  const client = createTRPCClient<typeof router>({
    links: [httpBatchLink(trpcHttpBatchOptions)],
  });
  const results = await Promise.all(
    Array.from({ length: 19 }, (_, id) => client.read.query({ id }))
  );

  expect(results).toEqual(
    Array.from({ length: 19 }, (_, id) => ({ id, timestamp }))
  );
  expect(requests.map(request => request.size).sort((a, b) => a - b)).toEqual([
    9, 10,
  ]);
  expect(requests.every(request => request.status === 200)).toBe(true);
  expect(requests.every(request => request.credentials === "include")).toBe(
    true
  );
});
