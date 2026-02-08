// Initialize Sentry first (before other imports that might throw)
import { initSentry, captureError } from "@/lib/sentry";
initSentry();

// Initialize Web Vitals tracking (async to not block render)
import { initWebVitals } from "@/lib/webVitals";
initWebVitals({
  enableAnalytics: import.meta.env.PROD,
  enableConsoleLogging: import.meta.env.DEV,
  enableBudgetWarnings: true,
});

import { trpc } from "@/lib/trpc";
import "./i18n/config";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Don't redirect if already on the login page (prevents infinite loop)
  if (window.location.pathname === "/login") return;

  window.location.href = "/login";
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
    // Capture error to Sentry (excluding auth errors which are expected)
    if (error instanceof Error && !error.message.includes(UNAUTHED_ERR_MSG)) {
      captureError(error, {
        type: "query",
        queryKey: event.query.queryKey,
      });
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
    // Capture error to Sentry (excluding auth errors which are expected)
    if (error instanceof Error && !error.message.includes(UNAUTHED_ERR_MSG)) {
      captureError(error, {
        type: "mutation",
        mutationKey: event.mutation.options.mutationKey,
      });
    }
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// Set initial direction based on detected language
const initialLang = localStorage.getItem("i18nextLng") || "ar";
document.documentElement.dir = initialLang === "ar" ? "rtl" : "ltr";
document.documentElement.lang = initialLang;

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
