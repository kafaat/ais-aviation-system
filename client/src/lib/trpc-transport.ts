import superjson from "superjson";

export const trpcHttpBatchOptions = {
  url: "/api/trpc",
  transformer: superjson,
  // Match the server's maxBatchSize so pages with many bookings split reads
  // into accepted requests while keeping the existing server limit intact.
  maxItems: 10,
  fetch(input: RequestInfo | URL, init?: RequestInit) {
    return globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
    });
  },
};
