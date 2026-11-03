import superjson from "superjson";
import { TRPC_BATCH_LIMIT } from "@shared/const";

export const trpcHttpBatchOptions = {
  url: "/api/trpc",
  transformer: superjson,
  // Match the server's maxBatchSize so pages with many bookings split reads
  // into accepted requests while keeping the existing server limit intact.
  maxItems: TRPC_BATCH_LIMIT,
  fetch(input: RequestInfo | URL, init?: RequestInit) {
    return globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
    });
  },
};
