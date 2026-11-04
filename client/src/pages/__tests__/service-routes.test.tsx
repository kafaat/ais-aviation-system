import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import superjson from "superjson";
import { beforeAll, expect, it, vi } from "vitest";
import App from "@/App";
import i18n from "@/i18n/config";
import { trpc } from "@/lib/trpc";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

/** Exercise the real App, guards, lazy pages and query lifecycle. Substitute
 * only the HTTP transport so the test can distinguish a failure from [].
 */
function visit(
  path: string,
  role: string,
  replies: Record<string, () => unknown> = {}
) {
  const route = memoryLocation({ path, record: true });
  const responses: Record<string, () => unknown> = {
    "ibePublic.config": () => ({
      brandName: "Journey Air",
      logoPath: null,
      embedSearchEnabled: false,
    }),
    "auth.me": () => ({ id: 1, name: "Test user", tenantId: 1, role }),
    "consent.getMyConsent": () => ({ needsReconsent: false }),
    "operations.airlineFlights": () => [],
    ...replies,
  };
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "https://local.test/api/trpc",
        transformer: superjson,
        fetch: async url => {
          const methods = new URL(String(url)).pathname
            .split("/")
            .pop()!
            .split(",");
          const results = methods.map(path => {
            const reply = responses[path];
            if (reply) {
              try {
                return { result: { data: superjson.serialize(reply()) } };
              } catch {
                // Simulate a procedure error inside an otherwise valid tRPC batch.
              }
            }
            return {
              error: {
                json: {
                  message: "Service unavailable",
                  code: -32603,
                  data: {
                    code: "INTERNAL_SERVER_ERROR",
                    httpStatus: 500,
                    path,
                  },
                },
              },
            };
          });
          return new Response(JSON.stringify(results), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <trpc.Provider client={client} queryClient={cache}>
      <QueryClientProvider client={cache}>
        <Router hook={route.hook}>
          <App />
        </Router>
      </QueryClientProvider>
    </trpc.Provider>
  );
  return route;
}

it.each([
  ["ops", "Company flights", "Booking coupon month-end review"],
  ["finance", "Booking coupon month-end review", "Company flights"],
])(
  "renders only the permitted airline workspace for %s",
  async (role, allowed, forbidden) => {
    visit("/airline", role);
    await screen.findByRole("heading", { name: allowed }, { timeout: 6000 });
    expect(
      screen.getByRole("button", { name: i18n.t("nav.reports") })
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: forbidden })
    ).not.toBeInTheDocument();
  }
);

it.each([
  ["finance", "/admin/revenue-accounting"],
  ["ops", "/admin/dcs"],
  ["user", "/airline"],
])("keeps %s out of %s", async (role, path) => {
  const route = visit(path, role);
  await waitFor(() => expect(route.history.at(-1)).toBe("/"));
});

it("distinguishes a failed payment read from an empty account and retries the read", async () => {
  let available = false;
  const history = vi.fn(() => {
    if (!available) throw new Error("interrupted");
    return [];
  });
  visit("/payment-history", "user", { "payments.getHistory": history });
  const failure = await screen.findByText(
    /payment history could not be loaded/i,
    {},
    { timeout: 6000 }
  );
  expect(screen.queryByText("No payments found")).not.toBeInTheDocument();
  const alert = failure.closest('[role="alert"]');
  expect(alert).not.toBeNull();
  const failedReads = history.mock.calls.length;
  available = true;
  fireEvent.click(
    within(alert as HTMLElement).getByRole("button", { name: /retry/i })
  );
  await screen.findByText("No payments found");
  expect(
    screen.queryByText(/payment history could not be loaded/i)
  ).not.toBeInTheDocument();
  expect(history).toHaveBeenCalledTimes(failedReads + 1);
});

it("runs the search encoded by the URL and locks the available cabin", async () => {
  const departureTime = new Date(Date.now() + 72 * 3600_000);
  const reserve = vi.fn(() => ({
    isNew: true,
    lock: { flightId: 7, cabinClass: "economy", expiresAt: departureTime },
  }));
  visit("/search?origin=1&destination=2&date=2030-11-15", "user", {
    "flights.search": () => [
      {
        id: 7,
        flightNumber: "AIS007",
        status: "scheduled",
        departureTime,
        arrivalTime: new Date(departureTime.getTime() + 3600_000),
        economyAvailable: 2,
        businessAvailable: 0,
        economyPrice: 12000,
        businessPrice: 24000,
        airline: { name: "Audit Air", code: "AA" },
        origin: { id: 1, code: "RUH", city: "Riyadh", timezone: "Asia/Riyadh" },
        destination: {
          id: 2,
          code: "JED",
          city: "Jeddah",
          timezone: "Asia/Riyadh",
        },
      },
    ],
    "favorites.getAll": () => [],
    "flights.statusBatch": () => [],
    "priceLock.create": reserve,
  });
  const button = await screen.findByRole(
    "button",
    { name: /lock price/i },
    { timeout: 6000 }
  );
  fireEvent.click(button);
  await screen.findByText("Price Locked");
  expect(reserve).toHaveBeenCalledTimes(1);
});

it("shows family pool errors separately and offers creation after a verified empty result", async () => {
  const group = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("offline");
    })
    .mockReturnValue(null);
  visit("/loyalty", "user", {
    "loyalty.myAccount": () => ({
      id: 1,
      userId: 1,
      tier: "bronze",
      totalMilesEarned: 0,
      currentMilesBalance: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
    "loyalty.myTransactions": () => [],
    "familyPool.myGroup": group,
  });
  const title = await screen.findByRole(
    "heading",
    { name: "Family Miles Pool" },
    { timeout: 6000 }
  );
  expect(
    screen.queryByRole("button", { name: "Create Family Group" })
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(title.closest('[role="alert"]') as HTMLElement).getByRole("button", {
      name: "Retry",
    })
  );
  await screen.findByRole("button", { name: "Create Family Group" });
  expect(group).toHaveBeenCalledTimes(2);
});

it("connects the routed analytics page to upcoming flight occupancy", async () => {
  const occupancy = vi.fn(() => [
    {
      flightId: 17,
      flightNumber: "ZZ0017",
      departureTime: new Date("2030-11-15T08:30:00Z"),
      totalSeats: 40,
      bookedSeats: 10,
      occupancyRate: 25,
    },
  ]);
  visit("/analytics", "admin", {
    "analytics.getKPIs": () => ({
      totalBookings: 0,
      totalRevenue: 0,
      totalPassengers: 0,
      averageOccupancyRate: 0,
      cancellationRate: 0,
    }),
    "analytics.getRevenueOverTime": () => [],
    "analytics.getPopularDestinations": () => [],
    "analytics.getBookingTrends": () => [],
    "analytics.getAncillaryMetrics": () => ({}),
    "analytics.getAncillaryRevenueByCategory": () => [],
    "analytics.getPopularAncillaries": () => [],
    "analytics.getFlightOccupancy": occupancy,
  });
  const flight = await screen.findByText("ZZ0017", {}, { timeout: 6000 });
  expect(within(flight.closest("tr")!).getByText("25%")).toBeVisible();
  expect(
    screen.getByText(i18n.t("admin.analytics.upcomingOccupancyScope"))
  ).toBeVisible();
  expect(occupancy).toHaveBeenCalledOnce();
});

it.each([
  ["finance", ["bookings", "revenue", "refunds"]],
  ["ops", ["flights"]],
  ["airline_admin", ["bookings", "revenue", "flights", "refunds"]],
  ["admin", ["bookings", "revenue", "flights", "refunds"]],
  ["super_admin", ["bookings", "revenue", "flights", "refunds"]],
] as const)(
  "exposes only permitted report families to %s",
  async (role, allowed) => {
    visit("/admin/reports", role);
    await screen.findByRole(
      "heading",
      { name: i18n.t("reports.title") },
      { timeout: 6000 }
    );
    for (const type of ["bookings", "revenue", "flights", "refunds"]) {
      const tab = screen.queryByRole("tab", {
        name: i18n.t(`reports.${type}`),
      });
      if ((allowed as readonly string[]).includes(type))
        expect(tab).toBeVisible();
      else expect(tab).not.toBeInTheDocument();
    }
    const selected = role === "ops" ? "flights" : "bookings";
    expect(
      screen.getByRole("tab", { name: i18n.t(`reports.${selected}`) })
    ).toHaveAttribute("aria-selected", "true");
  }
);

it("keeps passenger accounts out of the report export page", async () => {
  const route = visit("/admin/reports", "user");
  await waitFor(() => expect(route.history.at(-1)).toBe("/"));
  expect(
    screen.queryByRole("heading", { name: i18n.t("reports.title") })
  ).not.toBeInTheDocument();
});

it("exports the permitted flight report from the operations default tab", async () => {
  const exportFlights = vi.fn(() => ({
    filename: "flights.csv",
    content: "Flight\nSV1",
    contentType: "text/csv",
  }));
  const download = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => "blob:report-test");
  URL.revokeObjectURL = vi.fn();
  try {
    visit("/admin/reports", "ops", {
      "reports.exportFlightPerformanceCSV": exportFlights,
    });
    const button = await screen.findByRole(
      "button",
      { name: i18n.t("reports.exportCSV") },
      { timeout: 6000 }
    );
    fireEvent.click(button);
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(exportFlights).toHaveBeenCalledOnce();
  } finally {
    download.mockRestore();
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
  }
});
