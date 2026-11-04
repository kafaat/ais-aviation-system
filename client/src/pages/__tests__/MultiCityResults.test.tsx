import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { beforeAll, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AppRouter } from "../../../../server/routers";
import i18n from "@/i18n/config";
import { trpc } from "@/lib/trpc";
import { createTrpcFixture, deferred } from "@/test/trpc-fixture";
import MultiCityResults from "../MultiCityResults";

const notices = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: notices }));
beforeAll(async () => {
  await i18n.changeLanguage("en");
});

type Inputs = inferRouterInputs<AppRouter>["multiCity"];
type Outputs = inferRouterOutputs<AppRouter>["multiCity"];
const itinerary = [
  { originId: 1, destinationId: 2, departureDate: "2030-01-10" },
  { originId: 2, destinationId: 3, departureDate: "2030-01-12" },
  { originId: 3, destinationId: 1, departureDate: "2030-01-15" },
];
const economyCodes = ["Y", "M", "K"];
const businessCodes = ["J", "C", "D"];
const airports = [
  {
    code: "JFK",
    name: "New York",
    city: "New York",
    timezone: "America/New_York",
  },
  { code: "LHR", name: "London", city: "London", timezone: "Europe/London" },
  { code: "RUH", name: "Riyadh", city: "Riyadh", timezone: "Asia/Riyadh" },
];

// Synthetic server responses test UI transitions, serialization and handoff.
// Fare arithmetic and booking acceptance remain server/E2E responsibilities.
function results(count = 3): Outputs["search"] {
  return itinerary.slice(0, count).map((segment, index) => ({
    segmentIndex: index,
    flights: [
      {
        id: 101 + index,
        flightNumber: `TEST${index + 1}`,
        // Sector 1 leaves New York on Jan 10 and lands in London on Jan 11.
        departureTime: new Date(
          index === 0
            ? "2030-01-11T03:30:00Z"
            : `${segment.departureDate}T10:00:00Z`
        ),
        arrivalTime: new Date(
          index === 0
            ? "2030-01-11T10:00:00Z"
            : `${segment.departureDate}T16:00:00Z`
        ),
        aircraftType: "TEST",
        status: "scheduled",
        economyPrice: 10000,
        businessPrice: 30000,
        economyAvailable: 9,
        businessAvailable: 9,
        fareClassAvailability: (["economy", "business"] as const).map(
          (cabinClass, cabinIndex) => ({
            fareClassId: index * 10 + cabinIndex + 1,
            code:
              cabinClass === "economy"
                ? economyCodes[index]
                : businessCodes[index],
            cabinClass,
            fareFamily: `Sector ${index + 1} ${cabinClass === "economy" ? "Economy" : "Business"}`,
            priority: 1,
            totalAllocated: 9,
            availableSeats: 9,
          })
        ),
        airline: { code: "TT", name: "Fixture Air", logo: null },
        origin: airports[index],
        destination: airports[(index + 1) % airports.length],
      },
    ],
  }));
}

function quote(
  input: Inputs["calculatePrice"],
  totalPrice = 123456
): Outputs["calculatePrice"] {
  return {
    segments: input.segments.map((segment, index) => ({
      ...segment,
      segmentIndex: index,
      basePrice: 10000,
      discountedPrice: 9500,
    })),
    subtotal: 130000,
    discount: 6544,
    discountPercentage: 5,
    totalPrice,
  };
}

function searchPath(count = 3, preferences: Record<string, string> = {}) {
  return `/multi-city?${new URLSearchParams({
    segments: JSON.stringify(itinerary.slice(0, count)),
    adults: "1",
    children: "0",
    infants: "0",
    currency: "SAR",
    country: "SA",
    ...preferences,
  })}`;
}

function visit(
  path = searchPath(),
  overrides: Parameters<typeof createTrpcFixture>[0] = {}
) {
  const fixture = createTrpcFixture({
    "ibePublic.config": () => ({
      brandName: "Fixture Air",
      logoPath: null,
      embedSearchEnabled: false,
    }),
    "multiCity.search": input =>
      results((input as Inputs["search"]).segments.length),
    "multiCity.calculatePrice": input =>
      quote(input as Inputs["calculatePrice"]),
    ...overrides,
  });
  const route = memoryLocation({ path, record: true });
  render(
    <fixture.Wrapper>
      <Router hook={route.hook} searchHook={route.searchHook}>
        <Switch>
          <Route path="/multi-city">
            <MultiCityResults />
          </Route>
          <Route path="/booking/multi-city">
            <p>Checkout handoff</p>
          </Route>
        </Switch>
      </Router>
    </fixture.Wrapper>
  );
  return { ...fixture, route };
}

const fare = (sector: number, cabin = "Economy") =>
  screen.getByRole("button", { name: new RegExp(`Sector ${sector} ${cabin}`) });
const proceed = () =>
  screen.getByRole("button", { name: i18n.t("multiCity.proceedToBooking") });
const total = () => screen.getByTestId("multi-city-quoted-total");
const quoteRequests = (fixture: ReturnType<typeof visit>) =>
  fixture.requests.filter(
    request => request.path === "multiCity.calculatePrice"
  );
async function selectSectors(count = 3) {
  await screen.findByRole("button", { name: /Sector 1 Economy/ });
  for (let sector = 1; sector <= count; sector++) fireEvent.click(fare(sector));
}

it("quotes three selected sectors in itinerary order and carries traveler types and an overnight departure day into booking", async () => {
  const path = searchPath(3, { adults: "1", children: "1", infants: "1" });
  const fixture = visit(path);
  await screen.findByRole("button", { name: /Sector 3 Economy/ });
  expect(screen.getByText("22:30")).toBeVisible();
  expect(screen.getByText("January 10, 2030")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Passengers" })).toHaveValue("3");
  expect(
    screen.getByRole("combobox", { name: "Passenger Type 2" })
  ).toHaveValue("child");
  expect(
    screen.getByRole("combobox", { name: "Passenger Type 3" })
  ).toHaveValue("infant");
  fireEvent.click(fare(3));
  fireEvent.click(fare(1));
  expect(proceed()).toBeDisabled();
  expect(quoteRequests(fixture)).toHaveLength(0);
  fireEvent.click(fare(2));
  await waitFor(() => expect(proceed()).toBeEnabled());
  expect(total()).toHaveTextContent("1,234.56 SAR");
  expect(quoteRequests(fixture)).toEqual([
    {
      path: "multiCity.calculatePrice",
      input: {
        segments: [101, 102, 103].map((flightId, index) => ({
          flightId,
          cabinClass: "economy",
          fareClassCode: economyCodes[index],
        })),
        passengerCount: 3,
        passengerTypes: ["adult", "child", "infant"],
      },
    },
  ]);
  expect(fixture.requests).toContainEqual({
    path: "multiCity.search",
    input: {
      segments: itinerary.map(segment => ({
        ...segment,
        departureDate: new Date(`${segment.departureDate}T00:00:00Z`),
      })),
    },
  });
  fireEvent.click(proceed());
  expect(await screen.findByText("Checkout handoff")).toBeVisible();
  const destination = new URL(
    fixture.route.history.at(-1)!,
    "https://fixture.test"
  );
  expect(JSON.parse(destination.searchParams.get("data")!)).toEqual({
    version: 1,
    sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    passengerCount: 3,
    passengerTypes: ["adult", "child", "infant"],
    segments: itinerary.map((segment, index) => ({
      flightId: 101 + index,
      departureDate: `${segment.departureDate}T00:00:00.000Z`,
      fareClassCode: economyCodes[index],
    })),
    cabinClass: "economy",
  });
  expect(destination.searchParams.get("search")).toBe(path.split("?")[1]);
  expect(
    ["adults", "children", "infants"].map(key =>
      destination.searchParams.get(key)
    )
  ).toEqual(["1", "1", "1"]);
});

it("invalidates incompatible selections when the cabin changes and quotes only the rebuilt cabin", async () => {
  const fixture = visit();
  await screen.findByRole("button", { name: /Sector 3 Business/ });
  fireEvent.click(fare(1));
  fireEvent.click(fare(2));
  fireEvent.click(fare(3, "Business"));
  expect(fare(1)).toHaveAttribute("aria-pressed", "false");
  expect(fare(2)).toHaveAttribute("aria-pressed", "false");
  expect(fare(3, "Business")).toHaveAttribute("aria-pressed", "true");
  expect(proceed()).toBeDisabled();
  expect(total()).toHaveTextContent("—");
  expect(quoteRequests(fixture)).toHaveLength(0);
  fireEvent.click(fare(2, "Business"));
  fireEvent.click(fare(1, "Business"));
  await waitFor(() => expect(proceed()).toBeEnabled());
  expect(quoteRequests(fixture)).toEqual([
    {
      path: "multiCity.calculatePrice",
      input: {
        segments: [101, 102, 103].map((flightId, index) => ({
          flightId,
          cabinClass: "business",
          fareClassCode: businessCodes[index],
        })),
        passengerCount: 1,
        passengerTypes: ["adult"],
      },
    },
  ]);
});

it("blocks pending quotes and ignores a late quote for the previous passenger count", async () => {
  const oldResponse = deferred<Outputs["calculatePrice"]>();
  const newResponse = deferred<Outputs["calculatePrice"]>();
  const inputs: Inputs["calculatePrice"][] = [];
  const fixture = visit(searchPath(2), {
    "multiCity.calculatePrice": input => {
      inputs.push(input as Inputs["calculatePrice"]);
      return inputs.length === 1 ? oldResponse.promise : newResponse.promise;
    },
  });
  await selectSectors(2);
  await waitFor(() => expect(inputs).toHaveLength(1));
  expect(proceed()).toBeDisabled();
  expect(total()).toHaveTextContent("—");
  fireEvent.click(proceed());
  expect(fixture.route.history).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox", { name: "Passengers" }), {
    target: { value: "2" },
  });
  await waitFor(() => expect(inputs).toHaveLength(2));
  expect(inputs[1]).toMatchObject({
    passengerCount: 2,
    passengerTypes: ["adult", "adult"],
  });
  expect(proceed()).toBeDisabled();
  await act(async () => newResponse.resolve(quote(inputs[1], 22222)));
  await waitFor(() => expect(total()).toHaveTextContent("222.22 SAR"));
  expect(proceed()).toBeEnabled();
  await act(async () => oldResponse.resolve(quote(inputs[0], 11111)));
  await waitFor(() =>
    expect(
      fixture.cache.getQueryData<Outputs["calculatePrice"]>(
        getQueryKey(trpc.multiCity.calculatePrice, inputs[0], "query")
      )?.totalPrice
    ).toBe(11111)
  );
  expect(total()).toHaveTextContent("222.22 SAR");
  expect(proceed()).toBeEnabled();
  expect(quoteRequests(fixture)).toHaveLength(2);
});

it("hides an existing quote while it is revalidated and keeps booking blocked after failure", async () => {
  const revalidation = deferred<Outputs["calculatePrice"]>();
  let quoteCount = 0;
  const fixture = visit(searchPath(2), {
    "multiCity.calculatePrice": input =>
      ++quoteCount === 1
        ? quote(input as Inputs["calculatePrice"], 11111)
        : revalidation.promise,
  });
  await selectSectors(2);
  await waitFor(() => expect(proceed()).toBeEnabled());
  expect(total()).toHaveTextContent("111.11 SAR");
  act(() => {
    void fixture.cache.invalidateQueries({
      queryKey: getQueryKey(trpc.multiCity.calculatePrice),
    });
  });
  await waitFor(() => expect(quoteCount).toBe(2));
  expect(proceed()).toBeDisabled();
  expect(total()).toHaveTextContent("—");
  await act(async () =>
    revalidation.reject(new Error("The selected fare is no longer available"))
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The selected fare is no longer available"
  );
  expect(total()).toHaveTextContent("—");
  expect(proceed()).toBeDisabled();
  fireEvent.click(proceed());
  expect(fixture.route.history).toHaveLength(1);
  expect(quoteRequests(fixture)).toHaveLength(2);
});

it("does not display a cached two-sector total for an incomplete three-sector itinerary", async () => {
  const fixture = visit(searchPath(2));
  await selectSectors(2);
  await waitFor(() => expect(proceed()).toBeEnabled());
  expect(total()).toHaveTextContent("1,234.56 SAR");
  act(() => fixture.route.navigate(searchPath(3)));
  await screen.findByRole("button", { name: /Sector 3 Economy/ });
  fireEvent.click(fare(1));
  fireEvent.click(fare(2));
  expect(proceed()).toBeDisabled();
  expect(total()).toHaveTextContent("—");
  expect(quoteRequests(fixture)).toHaveLength(1);
  fireEvent.click(fare(3));
  await waitFor(() => expect(proceed()).toBeEnabled());
  expect(quoteRequests(fixture)).toHaveLength(2);
});

it.each([
  ["malformed JSON", "not-json"],
  ["only one sector", JSON.stringify(itinerary.slice(0, 1))],
  [
    "an impossible date",
    JSON.stringify([
      { ...itinerary[0], departureDate: "2030-02-30" },
      itinerary[1],
    ]),
  ],
])(
  "rejects %s before any search or quote request",
  async (_reason, segments) => {
    const fixture = visit(`/multi-city?${new URLSearchParams({ segments })}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("multiCity.invalidItinerary")
    );
    expect(
      screen.getByRole("link", { name: i18n.t("nav.searchFlights") })
    ).toHaveAttribute("href", "/");
    expect(fixture.requests).toHaveLength(0);
  }
);

it("shows an empty sector without enabling a partial itinerary or requesting its price", async () => {
  const available = results();
  available[1].flights = [];
  const fixture = visit(searchPath(), { "multiCity.search": () => available });
  expect(await screen.findByText(i18n.t("search.noFlights"))).toBeVisible();
  fireEvent.click(fare(1));
  fireEvent.click(fare(3));
  expect(proceed()).toBeDisabled();
  expect(total()).toHaveTextContent("—");
  expect(quoteRequests(fixture)).toHaveLength(0);
});
