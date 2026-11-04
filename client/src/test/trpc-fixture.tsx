import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";

type Handler = (input: unknown) => unknown | Promise<unknown>;

/** Keep the real tRPC hooks, serialization and React Query lifecycle. Only the
 * HTTP boundary is replaced; this does not exercise a server or a provider.
 */
export function createTrpcFixture(handlers: Record<string, Handler>) {
  const requests: { path: string; input: unknown }[] = [];
  const cache = new QueryClient({
    defaultOptions: {
      // Do not garbage-collect cache entries between React notification ticks.
      // Keep cached results for the lifetime of this isolated fixture.
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "https://fixture.test/api/trpc",
        transformer: superjson,
        fetch: async (url, options) => {
          const parsed = new URL(String(url));
          const endpoint = parsed.pathname.split("/").pop();
          if (!endpoint) throw new Error("Missing tRPC procedure");
          const methods = endpoint.split(",");
          const inputs = JSON.parse(
            String(options?.body ?? parsed.searchParams.get("input") ?? "{}")
          ) as Record<string, Parameters<typeof superjson.deserialize>[0]>;
          const results = await Promise.all(
            methods.map(async (path, index) => {
              const input = inputs[index]
                ? superjson.deserialize(inputs[index])
                : undefined;
              requests.push({ path, input });
              try {
                if (!handlers[path])
                  throw new Error(`Unexpected procedure: ${path}`);
                return {
                  result: {
                    data: superjson.serialize(await handlers[path](input)),
                  },
                };
              } catch (error) {
                const code =
                  error && typeof error === "object" && "code" in error
                    ? String(error.code)
                    : "INTERNAL_SERVER_ERROR";
                return {
                  error: {
                    json: {
                      message:
                        error instanceof Error ? error.message : "Unavailable",
                      code: -32603,
                      data: { code, httpStatus: 500, path },
                    },
                  },
                };
              }
            })
          );
          return new Response(JSON.stringify(results), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <trpc.Provider client={client} queryClient={cache}>
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      </trpc.Provider>
    );
  }
  return { Wrapper, cache, client, requests };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
