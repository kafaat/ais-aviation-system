import { act, render, screen, waitFor } from "@testing-library/react";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import i18n from "@/i18n/config";
import { checkInPath } from "@shared/check-in-link";
import CheckIn from "../CheckIn";

const auth = vi.hoisted(() => ({
  user: { id: 1, tenantId: 1 } as { id: number; tenantId: number } | null,
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.user,
    isAuthenticated: auth.user !== null,
    loading: false,
  }),
}));
vi.mock("@/components/BookingAncillariesDisplay", () => ({
  BookingAncillariesDisplay: ({ bookingId }: { bookingId: number }) => (
    <p>Loaded booking {bookingId}</p>
  ),
}));
vi.mock("@/components/PassengerTravelDocuments", () => ({
  PassengerTravelDocuments: () => null,
}));

type Call = { method: string; input: unknown };
type Reply = (input: any) => unknown | Promise<unknown>;
const clients: QueryClient[] = [];
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  auth.user = { id: 1, tenantId: 1 };
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  onlineManager.setOnline(true);
});

// The real browser component and tRPC serializer run here. Responses are a
// controlled transport boundary; native owner/tenant checks belong to E2E.
function visit(path: string, overrides: Record<string, Reply> = {}) {
  const calls: Call[] = [];
  const replies: Record<string, Reply> = {
    "bookings.myBookings": () => [
      { id: 7, bookingReference: "REF123", pnr: "PNR123" },
    ],
    "bookings.getByPNR": () => ({ id: 7, cabinClass: "economy" }),
    "bookings.getDepartureState": () => [],
    "bookings.getPassengers": () => [],
    ...overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(queryClient);
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "https://local.test/api/trpc",
        transformer: superjson,
        fetch: async (url, init) => {
          const parsed = new URL(String(url));
          const methods = parsed.pathname.split("/").pop()!.split(",");
          const inputs = JSON.parse(
            typeof init?.body === "string"
              ? init.body
              : (parsed.searchParams.get("input") ?? "{}")
          );
          const results = await Promise.all(
            methods.map(async (method, index) => {
              const input = inputs[index]
                ? superjson.deserialize(inputs[index])
                : undefined;
              calls.push({ method, input });
              try {
                if (!replies[method]) throw new Error("Unexpected endpoint");
                return {
                  result: {
                    data: superjson.serialize(await replies[method](input)),
                  },
                };
              } catch {
                return {
                  error: superjson.serialize({
                    message: "Access denied",
                    code: -32003,
                    data: { code: "FORBIDDEN", httpStatus: 403, path: method },
                  }),
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
  const location = memoryLocation({ path });
  const workspace = () => (
    <Router hook={location.hook}>
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <CheckIn />
        </QueryClientProvider>
      </trpc.Provider>
    </Router>
  );
  const view = render(workspace());
  return { calls, location, refresh: () => view.rerender(workspace()) };
}

it("opens the reminder PNR through the existing read without checking in automatically", async () => {
  const { calls } = visit(checkInPath("PNR123"));
  await screen.findByText("Loaded booking 7");
  expect(screen.getByLabelText("Passenger Name Record (PNR)")).toHaveValue(
    "PNR123"
  );
  expect(calls).toContainEqual({
    method: "bookings.getByPNR",
    input: { pnr: "PNR123" },
  });
  expect(calls.some(call => call.method === "bookings.myBookings")).toBe(false);
  expect(calls.some(call => call.method === "bookings.checkIn")).toBe(false);
});

it("resolves an old booking reference only from the signed-in owner's list", async () => {
  const { calls } = visit("/check-in?booking=REF123");
  await screen.findByText("Loaded booking 7");
  expect(screen.getByLabelText("Passenger Name Record (PNR)")).toHaveValue(
    "PNR123"
  );
  expect(calls[0].method).toBe("bookings.myBookings");
  expect(calls).toContainEqual({
    method: "bookings.getByPNR",
    input: { pnr: "PNR123" },
  });
  expect(calls).not.toContainEqual({
    method: "bookings.getByPNR",
    input: { pnr: "REF123" },
  });
  expect(calls.some(call => call.method === "bookings.checkIn")).toBe(false);
});

it("does not turn an unowned legacy reference into a PNR lookup", async () => {
  const { calls } = visit("/check-in?booking=REF999");
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("Booking Not Found");
  expect(calls.map(call => call.method)).toEqual(["bookings.myBookings"]);
  expect(screen.queryByText("Loaded booking 7")).not.toBeInTheDocument();
});

it.each([
  "pnr=PNR123&pnr=PNR456",
  "pnr=PNR123&booking=REF123",
  "booking=REF123&booking=REF456",
  "pnr=%3Ctag%3E",
  "pnr=PNR123%00",
  "booking=",
])(
  "rejects ambiguous or malformed link targets before any API read: %s",
  async search => {
    const { calls } = visit(`/check-in?${search}`);
    expect(screen.getByRole("alert")).toHaveTextContent("valid PNR");
    await act(async () => {});
    expect(calls).toEqual([]);
  }
);

it("preserves the reminder target through the sign-in link and waits for authentication", async () => {
  auth.user = null;
  const path = checkInPath("PNR123");
  const { calls, refresh } = visit(path);
  const login = new URL(
    screen.getByRole("link", { name: "Login" }).getAttribute("href")!,
    "https://local.test"
  );
  expect(login.pathname).toBe("/login");
  expect(login.searchParams.get("returnTo")).toBe(path);
  expect(calls).toEqual([]);
  auth.user = { id: 1, tenantId: 1 };
  refresh();
  await screen.findByText("Loaded booking 7");
  expect(calls).toContainEqual({
    method: "bookings.getByPNR",
    input: { pnr: "PNR123" },
  });
});

it("keeps the existing My Bookings history-state handoff", async () => {
  window.history.replaceState({ checkInPnr: "STATE1" }, "", "/check-in");
  const { calls } = visit("/check-in");
  await screen.findByText("Loaded booking 7");
  expect(calls).toContainEqual({
    method: "bookings.getByPNR",
    input: { pnr: "STATE1" },
  });
});

it("uses a new link after in-app navigation instead of retaining the previous target", async () => {
  const { calls, location } = visit(checkInPath("PNR123"));
  await screen.findByText("Loaded booking 7");
  act(() => location.navigate(checkInPath("PNR456")));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "bookings.getByPNR",
      input: { pnr: "PNR456" },
    })
  );
  expect(screen.getByLabelText("Passenger Name Record (PNR)")).toHaveValue(
    "PNR456"
  );
});

it("surfaces rejection from the owner-protected read without loading downstream passenger data", async () => {
  const { calls } = visit(checkInPath("PNR123"), {
    "bookings.getByPNR": () => {
      throw new Error("Forbidden owner");
    },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(calls).toEqual([
    { method: "bookings.getByPNR", input: { pnr: "PNR123" } },
  ]);
  expect(screen.queryByText("Loaded booking 7")).not.toBeInTheDocument();
});

it("rechecks a linked PNR after an account change without rendering the previous owner's result", async () => {
  const { refresh } = visit(checkInPath("PNR123"), {
    "bookings.getByPNR": () => {
      if (auth.user?.id !== 1) throw new Error("Forbidden owner");
      return { id: 7, cabinClass: "economy" };
    },
  });
  await screen.findByText("Loaded booking 7");
  auth.user = { id: 2, tenantId: 2 };
  refresh();
  expect(screen.queryByText("Loaded booking 7")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(screen.queryByText("Loaded booking 7")).not.toBeInTheDocument();
});

it("does not reuse a private linked result when the new account's read is paused offline", async () => {
  const { refresh, calls } = visit(checkInPath("PNR123"));
  await screen.findByText("Loaded booking 7");
  const before = calls.length;
  onlineManager.setOnline(false);
  auth.user = { id: 2, tenantId: 2 };
  refresh();
  await act(async () => {});
  expect(screen.queryByText("Loaded booking 7")).not.toBeInTheDocument();
  expect(calls).toHaveLength(before);
});
