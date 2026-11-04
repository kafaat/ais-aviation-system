import type { QueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNAUTHED_ERR_MSG } from "@shared/const";

const state = vi.hoisted(() => ({
  clients: [] as unknown[],
  render: vi.fn(),
  createRoot: vi.fn(),
  initSentry: vi.fn(),
  initWebVitals: vi.fn(),
  captureError: vi.fn(),
  createClient: vi.fn(),
  language: "en" as string | undefined,
  app: () => null,
  embed: () => null,
}));

vi.mock("@/lib/sentry", () => ({
  initSentry: state.initSentry,
  captureError: state.captureError,
}));
vi.mock("@/lib/webVitals", () => ({ initWebVitals: state.initWebVitals }));
vi.mock("react-dom/client", () => ({ createRoot: state.createRoot }));
vi.mock("../App", () => ({ default: state.app }));
vi.mock("../pages/EmbedSearch", () => ({ default: state.embed }));
vi.mock("../i18n/config", () => ({
  default: {
    get resolvedLanguage() {
      return state.language;
    },
    dir: (language: string) => (language === "ar" ? "rtl" : "ltr"),
  },
}));
vi.mock("@/lib/trpc", () => ({
  createBrowserTRPCClient: state.createClient,
  trpc: { Provider: ({ children }: { children: unknown }) => children },
}));
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    QueryClient: class extends actual.QueryClient {
      constructor() {
        super();
        state.clients.push(this);
      }
    },
  };
});

let assign: ReturnType<typeof vi.fn>;
let location: { pathname: string; search: string; hash: string };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.clients.length = 0;
  state.language = "en";
  state.createRoot.mockReturnValue({ render: state.render });
  state.createClient.mockReturnValue({ fixtureClient: true });
  document.body.innerHTML = '<div id="root"></div>';
  assign = vi.fn();
  location = {
    pathname: "/my-bookings",
    search: "?status=confirmed",
    hash: "#upcoming",
  };
  // Keep navigation observable without invoking jsdom's unimplemented browser
  // navigation. The actual auth-navigation helper and real cache events run.
  vi.stubGlobal("window", { location: { ...location, assign } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const client of state.clients as QueryClient[]) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function boot() {
  await import("../main");
  expect(state.clients).toHaveLength(1);
  return state.clients[0] as QueryClient;
}

async function failRequest(
  client: QueryClient,
  kind: "query" | "mutation",
  error: unknown
) {
  if (kind === "query") {
    await expect(
      client.fetchQuery({
        queryKey: ["private-bookings"],
        queryFn: () => Promise.reject(error),
        retry: false,
      })
    ).rejects.toBe(error);
  } else {
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ["private-action"],
      mutationFn: () => Promise.reject(error),
      retry: false,
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
  }
}

describe("actual SPA entry wiring", () => {
  it.each([
    ["en", "en", "ltr"],
    ["ar", "ar", "rtl"],
    [undefined, "ar", "rtl"],
  ])(
    "initializes language %s and supplies the same cache to both providers",
    async (language, expectedLanguage, direction) => {
      state.language = language;
      const client = await boot();
      expect(document.documentElement.lang).toBe(expectedLanguage);
      expect(document.documentElement.dir).toBe(direction);
      expect(state.initSentry).toHaveBeenCalledOnce();
      expect(state.initWebVitals).toHaveBeenCalledWith(
        expect.objectContaining({ enableBudgetWarnings: true })
      );
      expect(state.createClient).toHaveBeenCalledOnce();
      expect(state.createRoot).toHaveBeenCalledWith(
        document.getElementById("root")
      );
      const outer = state.render.mock.calls[0][0] as ReactElement<{
        client: unknown;
        queryClient: QueryClient;
        children: ReactElement<{ client: QueryClient; children: ReactElement }>;
      }>;
      expect(outer.props.queryClient).toBe(client);
      expect(outer.props.client).toEqual({ fixtureClient: true });
      expect(outer.props.children.props.client).toBe(client);
      expect(outer.props.children.props.children.type).toBe(state.app);
    }
  );

  it.each(["/embed/search", "/%2565mbed%252Fsearch"])(
    "keeps %s outside the account application",
    async pathname => {
      window.location.pathname = pathname;
      await boot();
      const outer = state.render.mock.calls[0][0] as ReactElement<{
        children: ReactElement<{ children: ReactElement }>;
      }>;
      expect(outer.props.children.props.children.type).toBe(state.embed);
    }
  );

  it("fails explicitly without creating a root when the host element is missing", async () => {
    document.body.innerHTML = "";
    await expect(import("../main")).rejects.toThrow("Root element not found");
    expect(state.createRoot).not.toHaveBeenCalled();
  });

  it.each(["query", "mutation"] as const)(
    "redirects an expired %s to its complete local return path without reporting an expected auth error",
    async kind => {
      const client = await boot();
      const { TRPCClientError } = await import("@trpc/client");
      const error = new TRPCClientError(UNAUTHED_ERR_MSG);
      await failRequest(client, kind, error);
      expect(assign).toHaveBeenCalledOnce();
      const target = new URL(assign.mock.calls[0][0], "https://ais.test");
      expect(target.pathname).toBe("/login");
      expect(target.searchParams.get("returnTo")).toBe(
        location.pathname + location.search + location.hash
      );
      expect(state.captureError).not.toHaveBeenCalled();
      // Once the login document is active, repeated cache failures cannot loop.
      window.location.pathname = "/login";
      await failRequest(client, kind, error);
      expect(assign).toHaveBeenCalledOnce();
    }
  );

  it.each(["query", "mutation"] as const)(
    "reports an unexpected %s failure with its cache identity and does not navigate",
    async kind => {
      const client = await boot();
      const error = new Error("Synthetic service unavailable");
      await failRequest(client, kind, error);
      expect(assign).not.toHaveBeenCalled();
      expect(state.captureError).toHaveBeenCalledWith(
        error,
        kind === "query"
          ? { type: "query", queryKey: ["private-bookings"] }
          : { type: "mutation", mutationKey: ["private-action"] }
      );
    }
  );

  it("does not send a non-Error rejection to telemetry or infer authentication from its text", async () => {
    const client = await boot();
    await failRequest(client, "query", { message: UNAUTHED_ERR_MSG });
    await failRequest(client, "mutation", "Synthetic rejection");
    expect(assign).not.toHaveBeenCalled();
    expect(state.captureError).not.toHaveBeenCalled();
  });
});
