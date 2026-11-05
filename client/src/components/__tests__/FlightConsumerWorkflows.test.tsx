import { useState, type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { trpcHttpBatchOptions } from "@/lib/trpc-transport";
import i18n from "@/i18n/config";
import { FlightPreviewDialog } from "../FlightPreviewDialog";
import { FlightFavorites } from "../FlightFavorites";
import { ReviewsList } from "../ReviewsList";
import type { FlightData } from "../FlightCard";
import { TooltipProvider } from "../ui/tooltip";

const auth = vi.hoisted(() => ({ user: { id: 11 } as { id: number } | null }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.user,
    isAuthenticated: Boolean(auth.user),
    loading: false,
  }),
}));

const flight: FlightData = {
  id: 41,
  flightNumber: "FC41",
  status: "scheduled",
  airline: { id: 7, code: "FC", name: "Fixture Airlines", logo: null },
  origin: {
    id: 3,
    code: "RUH",
    name: "Fixture Origin",
    city: "Riyadh",
    timezone: "Asia/Riyadh",
  },
  destination: {
    id: 4,
    code: "JED",
    name: "Fixture Destination",
    city: "Jeddah",
    timezone: "Asia/Riyadh",
  },
  departureTime: new Date("2030-01-01T10:00:00Z"),
  arrivalTime: new Date("2030-01-01T12:00:00Z"),
  economyPrice: 50000,
  businessPrice: 100000,
  economyAvailable: 10,
  businessAvailable: 5,
};
type Input =
  | {
      flightId?: number;
      reviewId?: number;
      limit?: number;
      offset?: number;
      minRating?: number;
    }
  | undefined;
type Call = { method: string; input: Input };
const clients: QueryClient[] = [];
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
beforeEach(() => {
  auth.user = { id: 11 };
});
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
});

function review(id: number, rating = 5) {
  return {
    id,
    flightId: 41,
    userId: 22,
    bookingId: null,
    rating,
    comfortRating: 4,
    serviceRating: 4,
    valueRating: 4,
    title: `Approved review ${id}`,
    comment: "A recorded flight experience.",
    helpfulCount: 7,
    isVerified: true,
    status: "approved",
    createdAt: new Date("2026-11-01T12:00:00Z"),
    updatedAt: new Date("2026-11-01T12:00:00Z"),
  };
}

function fixture() {
  const state = {
    saved: new Set<number>(),
    votes: new Set<string>(),
    reviews: [review(71), review(72, 3)],
    failReviews: false,
    failFavorites: false,
    favoriteOwnerOverride: undefined as number | undefined,
  };
  const handle = (method: string, input: Input): unknown => {
    const userId = auth.user?.id;
    switch (method) {
      case "favorites.isFlightFavorited":
        return userId ? state.saved.has(userId) : false;
      case "favorites.addFlight":
        expect(input).toEqual({ flightId: 41 });
        state.saved.add(userId!);
        return { id: 81, userId, flightId: 41, createdAt: new Date() };
      case "favorites.removeFlight":
        expect(input).toEqual({ flightId: 41 });
        state.saved.delete(userId!);
        return { success: true };
      case "favorites.getFlights":
        if (state.failFavorites)
          throw new Error("Controlled favorite read failure");
        return state.saved.has(userId!) || state.favoriteOwnerOverride
          ? [
              {
                favorite: {
                  id: 81,
                  userId: state.favoriteOwnerOverride ?? userId,
                  flightId: 41,
                  createdAt: new Date(),
                },
                flight,
                airline: flight.airline,
                origin: flight.origin,
                destination: flight.destination,
              },
            ]
          : [];
      case "reviews.canReview":
        return { canReview: false, reason: "no_completed_booking" };
      case "reviews.getFlightReviews": {
        if (state.failReviews)
          throw new Error("Controlled review read failure");
        const filtered = state.reviews.filter(
          item => item.rating >= (input?.minRating ?? 1)
        );
        return filtered
          .slice(
            input?.offset ?? 0,
            (input?.offset ?? 0) + (input?.limit ?? 20)
          )
          .map(item => ({
            ...item,
            hasVoted: state.votes.has(`${userId}:${item.id}`),
          }));
      }
      case "reviews.getFlightStats":
        return {
          totalReviews: state.reviews.length,
          averageRating:
            state.reviews.reduce((total, item) => total + item.rating, 0) /
            state.reviews.length,
          averageComfort: 4,
          averageService: 4,
          averageValue: 4,
          ratingDistribution: Object.fromEntries(
            [1, 2, 3, 4, 5].map(rating => [
              rating,
              state.reviews.filter(item => item.rating === rating).length,
            ])
          ),
        };
      case "reviews.markHelpful": {
        const key = `${userId}:${input?.reviewId}`;
        if (!state.votes.has(key)) {
          state.votes.add(key);
          state.reviews.find(item => item.id === input?.reviewId)!
            .helpfulCount++;
        }
        return { success: true };
      }
      default:
        throw new Error(`Unexpected endpoint ${method}`);
    }
  };
  return { state, handle };
}

// Real components, queries, cache invalidation, and the application's browser
// serializer run here. Responses/identity are controlled fixtures; native SQL
// authorization and concurrency are covered by flight-consumers-mysql.test.ts.
function mount(
  children: ReactNode,
  handle: (method: string, input: Input) => unknown
) {
  const calls: Call[] = [];
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
        ...trpcHttpBatchOptions,
        url: "https://controlled.test/api/trpc",
        fetch: async (url, options) => {
          const parsed = new URL(String(url));
          const methods = parsed.pathname.split("/").pop()!.split(",");
          const inputs = JSON.parse(
            String(options?.body ?? parsed.searchParams.get("input") ?? "{}")
          );
          const results = methods.map((method, index) => {
            const input = inputs[index]
              ? superjson.deserialize<Input>(inputs[index])
              : undefined;
            calls.push({ method, input });
            try {
              return {
                result: { data: superjson.serialize(handle(method, input)) },
              };
            } catch (error) {
              return {
                error: superjson.serialize({
                  message: String(error),
                  code: -32603,
                  data: {
                    code: "INTERNAL_SERVER_ERROR",
                    httpStatus: 500,
                    path: method,
                  },
                }),
              };
            }
          });
          return new Response(JSON.stringify(results), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  const rendered = render(
    <trpc.Provider queryClient={queryClient} client={client}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
  return { ...rendered, calls, queryClient };
}

function FlightJourney() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open flight preview</button>
      <FlightPreviewDialog flight={flight} open={open} onOpenChange={setOpen} />
      <FlightFavorites />
    </>
  );
}

it("saves a concrete preview flight, updates the list, reloads it and removes it from both views", async () => {
  const data = fixture();
  const page = mount(<FlightJourney />, data.handle);
  const save = await screen.findByRole("button", { name: "Save this flight" });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await screen.findByRole("button", {
    name: "Remove saved flight",
    pressed: true,
  });
  expect(page.calls).toContainEqual({
    method: "favorites.addFlight",
    input: { flightId: 41 },
  });
  expect(page.calls.some(call => call.method === "favorites.add")).toBe(false);
  await screen.findByText("Approved review 71");
  expect(screen.getByText("Rating Summary")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Write a Review" })
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await screen.findByRole("button", { name: "Remove FC41 from saved flights" });
  const before = page.calls.filter(
    call => call.method === "favorites.getFlights"
  ).length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(
      page.calls.filter(call => call.method === "favorites.getFlights").length
    ).toBeGreaterThan(before)
  );
  page.unmount();

  const reloaded = mount(<FlightJourney />, data.handle);
  await screen.findByRole("button", {
    name: "Remove saved flight",
    pressed: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Remove FC41 from saved flights",
    })
  );
  await screen.findByText("No saved flights yet");
  fireEvent.click(screen.getByRole("button", { name: "Open flight preview" }));
  await screen.findByRole("button", {
    name: "Save this flight",
    pressed: false,
  });
  expect(reloaded.calls).toContainEqual({
    method: "favorites.removeFlight",
    input: { flightId: 41 },
  });
});

it("lets anonymous visitors read preview reviews and stats without private queries or mutations", async () => {
  auth.user = null;
  const data = fixture();
  const page = mount(
    <FlightPreviewDialog flight={flight} open onOpenChange={() => {}} />,
    data.handle
  );
  await screen.findByText("Approved review 71");
  expect(screen.getByText("Rating Summary")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save this flight" }));
  fireEvent.click(screen.getAllByRole("button", { name: /Helpful/ })[0]);
  expect(
    page.calls.some(
      call =>
        call.method.startsWith("favorites.") ||
        call.method === "reviews.canReview" ||
        call.method === "reviews.markHelpful"
    )
  ).toBe(false);
});

it("uses bounded offset pages and resets to the first page when filtering", async () => {
  const data = fixture();
  data.state.reviews = [
    review(71),
    review(72, 3),
    review(73),
    review(74, 3),
    review(75, 4),
  ];
  const page = mount(
    <ReviewsList flightId={41} initialLimit={2} />,
    data.handle
  );
  await screen.findByText("Approved review 71");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Approved review 73");
  expect(screen.queryByText("Approved review 71")).not.toBeInTheDocument();
  expect(page.calls).toContainEqual({
    method: "reviews.getFlightReviews",
    input: { flightId: 41, limit: 2, offset: 2, minRating: undefined },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Approved review 75");
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("Approved review 73");
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "5 stars only" }));
  await screen.findByText("Approved review 71");
  expect(page.calls).toContainEqual({
    method: "reviews.getFlightReviews",
    input: { flightId: 41, limit: 2, offset: 0, minRating: 5 },
  });
  expect(
    screen.queryByRole("button", { name: "Next" })
  ).not.toBeInTheDocument();
});

it("never requests more than the API's 100-row page limit", async () => {
  const data = fixture();
  const page = mount(
    <ReviewsList flightId={41} initialLimit={150} />,
    data.handle
  );
  await screen.findByText("Approved review 71");
  expect(
    page.calls
      .filter(call => call.method === "reviews.getFlightReviews")
      .every(call => call.input?.limit === 100)
  ).toBe(true);
});

it("refreshes a helpful vote from the server and keeps it disabled after reload for the same viewer", async () => {
  const data = fixture();
  data.state.reviews = [review(71)];
  const page = mount(<ReviewsList flightId={41} />, data.handle);
  fireEvent.click(await screen.findByRole("button", { name: "Helpful (7)" }));
  const voted = await screen.findByRole("button", {
    name: "Marked as helpful (8)",
    pressed: true,
  });
  expect(voted).toBeDisabled();
  fireEvent.click(voted);
  expect(
    page.calls.filter(call => call.method === "reviews.markHelpful")
  ).toEqual([{ method: "reviews.markHelpful", input: { reviewId: 71 } }]);
  page.unmount();
  const reloaded = mount(<ReviewsList flightId={41} />, data.handle);
  expect(
    await screen.findByRole("button", {
      name: "Marked as helpful (8)",
      pressed: true,
    })
  ).toBeDisabled();
  expect(
    reloaded.calls.some(call => call.method === "reviews.markHelpful")
  ).toBe(false);
});

it("suppresses another owner's cached favorites and distinguishes read failures from an empty list", async () => {
  const data = fixture();
  data.state.favoriteOwnerOverride = 22;
  const page = mount(<FlightFavorites />, data.handle);
  await screen.findByText("No saved flights yet");
  expect(screen.queryByText("FC41")).not.toBeInTheDocument();
  data.state.failFavorites = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Could not load saved flights"
  );
  expect(screen.queryByText("No saved flights yet")).not.toBeInTheDocument();
  await act(async () => {
    await page.queryClient.cancelQueries();
  });
});

it("shows a retryable review error instead of a false no-reviews state", async () => {
  const data = fixture();
  data.state.failReviews = true;
  mount(<ReviewsList flightId={41} />, data.handle);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load reviews"
  );
  data.state.failReviews = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Approved review 71");
});

it("shows a completed saved flight truthfully without offering a new booking", async () => {
  const data = fixture();
  mount(
    <FlightPreviewDialog
      flight={{ ...flight, status: "completed" }}
      open
      onOpenChange={() => {}}
    />,
    data.handle
  );
  await screen.findByText("Approved review 71");
  expect(screen.getByText("Completed")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Book Now" })
  ).not.toBeInTheDocument();
});
