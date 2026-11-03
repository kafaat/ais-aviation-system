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

import { createBrowserTRPCClient, trpc } from "@/lib/trpc";
import { redirectToLoginIfUnauthorized } from "@/lib/auth-navigation";
import "./i18n/config";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import App from "./App";
import EmbedSearch from "./pages/EmbedSearch";
import { isEmbeddedSearchDocument } from "@/lib/embedded-entry";
import "./index.css";

const queryClient = new QueryClient();

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

const trpcClient = createBrowserTRPCClient();

// Set initial direction based on detected language
const initialLang = localStorage.getItem("i18nextLng") || "ar";
document.documentElement.dir = initialLang === "ar" ? "rtl" : "ltr";
document.documentElement.lang = initialLang;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

// Keep the allowed iframe document isolated from the account SPA router and
// its navigation. Search submission opens the normal application at the top.
const page = isEmbeddedSearchDocument(window.location.pathname) ? (
  <EmbedSearch />
) : (
  <App />
);

createRoot(rootElement).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>{page}</QueryClientProvider>
  </trpc.Provider>
);
