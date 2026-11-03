import { createTRPCClient, httpLink } from "@trpc/client";
import type { Page } from "@playwright/test";
import superjson from "superjson";
import type { AppRouter } from "../../server/routers";

export function rpc(page: Page) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url:
          (process.env.E2E_BASE_URL ?? "http://localhost:3000") + "/api/trpc",
        transformer: superjson,
        fetch: async (url, init) => {
          const result = await page.request.fetch(String(url), {
            method: init?.method,
            data: init?.body as string | undefined,
            headers: Object.fromEntries(
              new Headers(init?.headers as HeadersInit)
            ),
          });
          return new Response(new Uint8Array(await result.body()), {
            status: result.status(),
            headers: result.headers(),
          });
        },
      }),
    ],
  });
}
