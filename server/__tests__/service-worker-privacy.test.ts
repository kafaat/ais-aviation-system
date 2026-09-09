import { expect, it, vi } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";

it("never caches API data or serves a legacy session response offline", async () => {
  const listeners = new Map<string, Function>();
  const put = vi.fn();
  const match = vi.fn(async () => Response.json({ owner: "previous-user" }));
  let offline = false;
  vm.runInNewContext(readFileSync("client/public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://audit.example.test" },
      addEventListener: (name: string, fn: Function) => listeners.set(name, fn),
    },
    console,
    URL,
    Request,
    Response,
    Promise,
    setTimeout,
    clearTimeout,
    caches: { open: async () => ({ put }), match },
    fetch: async () => {
      if (offline) throw new Error("offline");
      return Response.json({ owner: "current-user" });
    },
  });
  const url = "https://audit.example.test/api/trpc/bookings.myBookings";
  let response: Promise<Response>;
  const request = () =>
    listeners.get("fetch")!({
      request: new Request(url),
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
  request();
  expect(await (await response!).json()).toEqual({ owner: "current-user" });
  offline = true;
  request();
  expect((await response!).status).toBe(503);
  expect(put).not.toHaveBeenCalled();
  expect(match).not.toHaveBeenCalled();
});
