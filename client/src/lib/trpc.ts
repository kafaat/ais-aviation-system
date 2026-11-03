import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpcHttpBatchOptions } from "./trpc-transport";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();

/** The browser transport used by the application and its HTTP regression tests. */
export function createBrowserTRPCClient() {
  return trpc.createClient({
    links: [httpBatchLink(trpcHttpBatchOptions)],
  });
}
