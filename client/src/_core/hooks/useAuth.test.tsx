import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getQueryKey } from "@trpc/react-query";
import { useAuth } from "./useAuth";
import { trpc } from "@/lib/trpc";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";

const owner = { id: 23, name: "Private owner", tenantId: 7, role: "user" };
const workerDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "serviceWorker"
);
let storageDescriptor: PropertyDescriptor | undefined;
let stored: Map<string, string>;
const postMessage = vi.fn();

beforeEach(() => {
  stored = new Map();
  storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { controller: { postMessage } },
  });
});
afterEach(() => {
  cleanup();
  if (storageDescriptor)
    Object.defineProperty(window, "localStorage", storageDescriptor);
  if (workerDescriptor)
    Object.defineProperty(navigator, "serviceWorker", workerDescriptor);
  else Reflect.deleteProperty(navigator, "serviceWorker");
});

it.each(["success", "UNAUTHORIZED", "INTERNAL_SERVER_ERROR"])(
  "clears private queries, local identity and service-worker data after logout returns %s",
  async outcome => {
    const fixture = createTrpcFixture({
      "auth.me": () => owner,
      "auth.logoutCookie": () => {
        if (outcome !== "success")
          throw Object.assign(new Error("Fixture logout failure"), {
            code: outcome,
          });
        return { success: true };
      },
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: fixture.Wrapper,
    });
    await waitFor(() => expect(result.current.user).toEqual(owner));
    expect(stored.get("manus-runtime-user-info")).toContain("Private owner");
    fixture.cache.setQueryData(
      ["private-bookings"],
      [{ passenger: "Private" }]
    );
    fixture.cache.setQueryData(["private-wallet"], { balance: 20000 });

    const pending = deferred<{ passenger: string }>();
    const aborted = vi.fn();
    const request = fixture.cache
      .fetchQuery({
        queryKey: ["private-in-flight"],
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", aborted);
          return pending.promise;
        },
      })
      .catch(() => undefined);

    await act(async () => {
      if (outcome === "INTERNAL_SERVER_ERROR")
        await expect(result.current.logout()).rejects.toThrow(
          "Fixture logout failure"
        );
      else await result.current.logout();
    });

    expect(aborted).toHaveBeenCalledTimes(1);
    expect(fixture.cache.getQueryData(["private-bookings"])).toBeUndefined();
    expect(fixture.cache.getQueryData(["private-wallet"])).toBeUndefined();
    expect(
      fixture.cache.getQueryData(
        getQueryKey(trpc.auth.me, undefined, "query")
      ) ?? null
    ).toBeNull();
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.isAuthenticated).toBe(false);
    expect(fixture.cache.getMutationCache().getAll()).toHaveLength(0);
    expect(stored.get("manus-runtime-user-info") ?? "").not.toContain(
      "Private owner"
    );
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "CLEAR_PRIVATE_DATA",
    });

    await act(async () => {
      pending.resolve({ passenger: "Late private response" });
      await request;
    });
    expect(fixture.cache.getQueryData(["private-in-flight"])).toBeUndefined();
    expect(
      fixture.requests.filter(r => r.path === "auth.logoutCookie")
    ).toEqual([{ path: "auth.logoutCookie", input: undefined }]);
  }
);

it("logs out without a controlling service worker", async () => {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  });
  const fixture = createTrpcFixture({
    "auth.me": () => owner,
    "auth.logoutCookie": () => ({ success: true }),
  });
  const { result } = renderHook(() => useAuth(), { wrapper: fixture.Wrapper });
  await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  await act(() => result.current.logout());
  expect(
    fixture.cache.getQueryData(getQueryKey(trpc.auth.me, undefined, "query")) ??
      null
  ).toBeNull();
  await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
  expect(stored.get("manus-runtime-user-info") ?? "").not.toContain(
    "Private owner"
  );
});

it("publishes the logout to every mounted identity observer", async () => {
  const fixture = createTrpcFixture({
    "auth.me": () => owner,
    "auth.logoutCookie": () => ({ success: true }),
  });
  const { result } = renderHook(() => ({ menu: useAuth(), page: useAuth() }), {
    wrapper: fixture.Wrapper,
  });
  await waitFor(() => expect(result.current.page.isAuthenticated).toBe(true));
  expect(result.current.menu.user).toEqual(owner);
  await act(() => result.current.menu.logout());
  await waitFor(() => {
    expect(result.current.menu.isAuthenticated).toBe(false);
    expect(result.current.page.isAuthenticated).toBe(false);
  });
  expect(
    fixture.requests.filter(request => request.path === "auth.me")
  ).toHaveLength(1);
});
