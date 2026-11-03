import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { beforeAll, expect, it, vi } from "vitest";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import i18n from "@/i18n/config";
import CheckIn from "@/pages/CheckIn";
import APISManagement from "@/pages/admin/APISManagement";
import { downloadFile } from "@/lib/downloadFile";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, role: "admin", tenantId: 1 },
    isAuthenticated: true,
    loading: false,
  }),
}));
vi.mock("@/lib/downloadFile", () => ({ downloadFile: vi.fn() }));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("qrcode", () => ({
  default: {
    toDataURL: (token: string) =>
      Promise.resolve(`data:image/png;base64,${btoa(token)}`),
  },
}));
vi.mock("@/lib/boarding-pass-pdf417", () => ({
  renderBoardingPassPDF417: () => '<svg xmlns="http://www.w3.org/2000/svg"/>',
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

type Reply = (input: any) => unknown | Promise<unknown>;
function visit(element: React.ReactElement, replies: Record<string, Reply>) {
  const calls: Array<{ method: string; input: any }> = [];
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
                if (!replies[method]) throw new Error("Unknown test endpoint");
                return {
                  result: {
                    data: superjson.serialize(await replies[method](input)),
                  },
                };
              } catch {
                return {
                  error: {
                    json: {
                      message: "Synthetic source unavailable",
                      code: -32603,
                      data: {
                        code: "INTERNAL_SERVER_ERROR",
                        httpStatus: 500,
                        path: method,
                      },
                    },
                  },
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
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
    </trpc.Provider>
  );
  return calls;
}

const passengers = [
  { id: 11, firstName: "First", lastName: "Traveler" },
  { id: 12, firstName: "Second", lastName: "Traveler" },
];
const savedDocument = {
  documentType: "passport",
  documentNumber: "FIRST123",
  issuingCountry: "YE",
  nationality: "YE",
  dateOfBirth: "1990-01-01T00:00:00.000Z",
  gender: "U",
  expiryDate: "2099-01-01T00:00:00.000Z",
  givenNames: "First",
  surname: "Traveler",
  residenceCountry: "YE",
  residenceAddress: "Fixture residence",
  destinationAddress: "Fixture destination",
  redressNumber: null,
  knownTravelerNumber: null,
};

function passengerReplies() {
  let document = { ...savedDocument };
  let saved = false;
  const replies: Record<string, Reply> = {
    "bookings.getByPNR": () => ({ id: 7, cabinClass: "economy" }),
    "bookings.getPassengers": () => passengers,
    "ancillary.getBookingAncillaries": () => [],
    "bookings.getDepartureState": () =>
      [42, 43].map(flightId => ({
        flightId,
        flightNumber: `AIS${flightId}`,
        departureTime: new Date("2090-06-15T10:00:00Z"),
        status: "scheduled",
        open: true,
        passengers: passengers.map(person => ({
          passengerId: person.id,
          seatNumber: null,
          checkedIn: false,
          departureState: "not_checked_in",
        })),
      })),
    "seatMap.getFlightSeatMap": () => ({ cabins: [] }),
    "apis.getMyAPISStatus": ({ passengerId }) => ({
      passengerId,
      passengerName: `${passengers.find(person => person.id === passengerId)?.firstName} Traveler`,
      bookingId: 7,
      hasData: passengerId === 11,
      status:
        passengerId === 11 ? (saved ? "complete" : "validated") : "incomplete",
      data: passengerId === 11 ? document : null,
      completeness: passengerId === 11 ? 85 : 0,
      missingFields: [],
      validatedAt: saved ? null : "2026-10-01T00:00:00Z",
      submittedAt: null,
    }),
    "apis.getMyJourneyStatus": ({ passengerId, flightId }) => ({
      bookingId: 7,
      passengerId,
      flightId,
      flightNumber: `AIS${flightId}`,
      originAirport: flightId === 42 ? "ADE" : "AUH",
      destinationAirport: flightId === 42 ? "AUH" : "LHR",
      originCountry: flightId === 42 ? "YE" : "AE",
      destinationCountry: flightId === 42 ? "AE" : "GB",
      clearanceRequired: true,
      clearanceStatus: "not_cleared",
      checkedAt: "2026-11-03T12:00:00Z",
    }),
    "apis.getRequirements": input => ({
      ...input,
      requiredFields: [
        "documentType",
        "documentNumber",
        "issuingCountry",
        "nationality",
        "dateOfBirth",
        "gender",
        "expiryDate",
        "givenNames",
        "surname",
      ],
      submissionDeadlineMinutes: 60,
      format: "paxlst",
      source: "default",
    }),
    "apis.submitInfo": input => {
      document = { ...document, ...input };
      saved = true;
      return {
        id: 1,
        passengerId: input.passengerId,
        bookingId: 7,
        status: "complete",
        message: "Saved",
      };
    },
  };
  return replies;
}

it("reaches the saved APIS form from real check-in passengers and refreshes clearance after saving", async () => {
  const calls = visit(<CheckIn />, passengerReplies());
  fireEvent.change(screen.getByLabelText("Booking Reference (PNR)"), {
    target: { value: "ABC123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Review or edit travel documents",
    })
  );
  expect(screen.getByLabelText(/^Document Number/)).toHaveValue("FIRST123");
  expect(screen.getByLabelText(/^Date of Birth/)).toHaveValue("1990-01-01");
  expect(screen.getByLabelText(/^Expiry Date/)).toHaveValue("2099-01-01");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save Information" })
    ).toBeEnabled()
  );
  fireEvent.change(screen.getByLabelText(/^Document Number/), {
    target: { value: "UPDATED123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Information" }));
  await screen.findByText("Saved — awaiting format validation");
  expect(
    calls.find(call => call.method === "apis.submitInfo")?.input
  ).toMatchObject({
    passengerId: 11,
    documentNumber: "UPDATED123",
    nationality: "YE",
    gender: "U",
    dateOfBirth: "1990-01-01",
    expiryDate: "2099-01-01",
  });
  expect(
    screen.getByText("Current operator clearance has not been verified")
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Current operator clearance verified")
  ).not.toBeInTheDocument();
  expect(
    calls.filter(
      call =>
        call.method === "apis.getMyAPISStatus" && call.input.passengerId === 11
    ).length
  ).toBeGreaterThan(1);
  expect(
    calls.filter(
      call =>
        call.method === "apis.getMyJourneyStatus" &&
        call.input.passengerId === 11
    ).length
  ).toBeGreaterThan(1);

  fireEvent.change(screen.getByLabelText("Passenger"), {
    target: { value: "12" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Add travel documents" })
  );
  expect(screen.getByLabelText(/^Document Number/)).toHaveValue("");
  expect(screen.getByLabelText(/^Given Names/)).toHaveValue("Second");
  fireEvent.click(screen.getByRole("button", { name: /AIS43/ }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Review or edit travel documents",
    })
  );
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "apis.getRequirements",
      input: { originCountry: "AE", destinationCountry: "GB" },
    })
  );
  expect(screen.getByLabelText(/^Document Number/)).toHaveValue("UPDATED123");
  expect(calls).toContainEqual({
    method: "apis.getMyJourneyStatus",
    input: { passengerId: 11, flightId: 43 },
  });
});

it("shows a failed document read instead of opening an empty editor over saved documents", async () => {
  const replies = passengerReplies();
  replies["apis.getMyAPISStatus"] = () => {
    throw new Error("offline");
  };
  visit(<CheckIn />, replies);
  fireEvent.change(screen.getByLabelText("Booking Reference (PNR)"), {
    target: { value: "ABC123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText(
    "Travel document or clearance status could not be verified."
  );
  expect(
    screen.queryByRole("button", { name: "Add travel documents" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save Information" })
  ).not.toBeInTheDocument();
});

it("rechecks an uncertain save and hides old clearance until the saved document is read again", async () => {
  const replies = passengerReplies();
  const savedStatus = replies["apis.getMyAPISStatus"];
  const journeyStatus = replies["apis.getMyJourneyStatus"];
  const save = replies["apis.submitInfo"];
  let committed = false;
  let releaseReads!: () => void;
  const pendingRead = new Promise<void>(resolve => {
    releaseReads = resolve;
  });
  replies["apis.getMyAPISStatus"] = async input => {
    if (committed) await pendingRead;
    return savedStatus(input);
  };
  replies["apis.getMyJourneyStatus"] = async input => {
    if (committed) await pendingRead;
    return {
      ...((await journeyStatus(input)) as Record<string, unknown>),
      clearanceStatus: committed ? "not_cleared" : "cleared",
    };
  };
  replies["apis.submitInfo"] = input => {
    save(input);
    committed = true;
    throw new Error("The server committed but the response was lost");
  };
  const calls = visit(<CheckIn />, replies);
  fireEvent.change(screen.getByLabelText("Booking Reference (PNR)"), {
    target: { value: "ABC123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Current operator clearance verified");
  fireEvent.click(
    screen.getByRole("button", { name: "Review or edit travel documents" })
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save Information" })
    ).toBeEnabled()
  );
  fireEvent.change(screen.getByLabelText(/^Document Number/), {
    target: { value: "UPDATED123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Information" }));
  await waitFor(() =>
    expect(
      calls.filter(call => call.method === "apis.getMyJourneyStatus").length
    ).toBeGreaterThan(1)
  );
  expect(
    screen.queryByText("Current operator clearance verified")
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Document format validated")
  ).not.toBeInTheDocument();
  await act(async () => {
    releaseReads();
    await pendingRead;
  });
  await screen.findByText("Saved — awaiting format validation");
  expect(
    screen.getByText("Current operator clearance has not been verified")
  ).toBeInTheDocument();
  expect(screen.getByLabelText(/^Document Number/)).toHaveValue("UPDATED123");
});

/** A second active flight read verifies that document changes invalidate the
 * passenger's whole itinerary, while the companion's pass remains untouched.
 */
function AnotherFlightPass() {
  const query = trpc.seatMap.getBoardingPass.useQuery(
    { flightId: 43, passengerId: 11 },
    { retry: false }
  );
  return (
    <output data-testid="another-flight-pass">
      {query.error
        ? "unavailable"
        : query.isFetching
          ? "checking"
          : query.data?.barcodeData}
    </output>
  );
}

function boardingPassFixture(passengerId: number, flightId: number) {
  return {
    flightNumber: `AIS${flightId}`,
    passenger: {
      firstName: passengerId === 11 ? "First" : "Second",
      lastName: "Traveler",
    },
    airline: { code: "AI", name: "Fixture airline" },
    origin: { code: "ADE" },
    destination: { code: "AUH" },
    departureTime: new Date("2090-06-15T10:00:00Z"),
    seat: {
      seatNumber: passengerId === 11 ? "1A" : "1B",
      cabinClass: "economy",
    },
    barcodeData: `token-${passengerId}-${flightId}-before`,
    bcbp: `BCBP-${passengerId}-${flightId}-before`,
  };
}

it.each(["boarding_denied", "boarded", "checked_in"])(
  "checks in only the eligible companion when another traveler is %s",
  async state => {
    const replies = passengerReplies();
    replies["bookings.getDepartureState"] = () => [
      {
        flightId: 42,
        flightNumber: "AIS42",
        departureTime: new Date("2090-06-15T10:00:00Z"),
        status: "scheduled",
        open: true,
        passengers: [
          {
            passengerId: 11,
            seatNumber: "1A",
            checkedIn: true,
            departureState: state,
          },
          {
            passengerId: 12,
            seatNumber: null,
            checkedIn: false,
            departureState: "not_checked_in",
          },
        ],
      },
    ];
    replies["bookings.checkIn"] = () => ({ success: true });
    replies["bookings.baggageEntitlements"] = () => [];
    replies["seatMap.getBoardingPass"] = ({ passengerId, flightId }) =>
      boardingPassFixture(passengerId, flightId);
    const calls = visit(<CheckIn />, replies);
    fireEvent.change(screen.getByLabelText("Booking Reference (PNR)"), {
      target: { value: "ABC123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const companion = await screen.findByRole("checkbox", {
      name: "Second Traveler",
    });
    expect(
      screen.queryByRole("checkbox", { name: "First Traveler" })
    ).toBeNull();
    const submit = screen.getByRole("button", { name: "Check-in" });
    fireEvent.click(companion);
    expect(submit).toBeDisabled();
    fireEvent.click(companion);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(
        calls.filter(c => c.method === "bookings.checkIn").map(c => c.input)
      ).toEqual([
        {
          bookingId: 7,
          flightId: 42,
          seatAssignments: [{ passengerId: 12, seatNumber: undefined }],
        },
      ])
    );
    if (state !== "checked_in")
      expect(calls.some(c => c.method === "seatMap.getBoardingPass")).toBe(
        false
      );
  }
);

function PausePassRefresh() {
  const utils = trpc.useUtils();
  return (
    <button
      onClick={() => {
        onlineManager.setOnline(false);
        void utils.seatMap.getBoardingPass.invalidate({ passengerId: 11 });
      }}
    >
      Recheck while offline
    </button>
  );
}

it("does not display a cached printable pass when its verification is paused offline", async () => {
  const replies = passengerReplies();
  replies["bookings.getDepartureState"] = () => [
    {
      flightId: 42,
      flightNumber: "AIS42",
      departureTime: new Date("2090-06-15T10:00:00Z"),
      status: "scheduled",
      open: true,
      passengers: [
        {
          passengerId: 11,
          seatNumber: "1A",
          checkedIn: true,
          departureState: "checked_in",
        },
      ],
    },
  ];
  replies["bookings.baggageEntitlements"] = () => [];
  replies["seatMap.getBoardingPass"] = ({ passengerId, flightId }) =>
    boardingPassFixture(passengerId, flightId);
  visit(
    <>
      <CheckIn />
      <PausePassRefresh />
    </>,
    replies
  );
  fireEvent.change(screen.getByLabelText("Booking Reference (PNR)"), {
    target: { value: "ABC123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("BCBP-11-42-before");
  expect(
    screen.getByRole("button", { name: "Print Boarding Pass" })
  ).toBeInTheDocument();
  try {
    fireEvent.click(
      screen.getByRole("button", { name: "Recheck while offline" })
    );
    await waitFor(() =>
      expect(screen.queryByText("BCBP-11-42-before")).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole("button", { name: "Print Boarding Pass" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Boarding Pass" })
    ).not.toBeInTheDocument();
  } finally {
    await act(async () => {
      onlineManager.setOnline(true);
    });
  }
});

it.each(["acknowledged", "lost response"])(
  "hides and rechecks every flight pass for the edited passenger after an APIS save with %s",
  async outcome => {
    const replies = passengerReplies();
    const save = replies["apis.submitInfo"];
    let committed = false;
    let releasePassReads!: () => void;
    const pendingPassRead = new Promise<void>(resolve => {
      releasePassReads = resolve;
    });
    replies["bookings.getDepartureState"] = () =>
      [42, 43].map(flightId => ({
        flightId,
        flightNumber: `AIS${flightId}`,
        departureTime: new Date("2090-06-15T10:00:00Z"),
        status: "scheduled",
        open: true,
        passengers: passengers.map(person => ({
          passengerId: person.id,
          seatNumber: person.id === 11 ? "1A" : "1B",
          checkedIn: true,
          departureState: "checked_in",
        })),
      }));
    replies["bookings.baggageEntitlements"] = () => [];
    replies["seatMap.getBoardingPass"] = async ({ passengerId, flightId }) => {
      if (committed && passengerId === 11) {
        await pendingPassRead;
        throw new Error(
          "Current operator clearance is required for the updated documents"
        );
      }
      return boardingPassFixture(passengerId, flightId);
    };
    replies["apis.submitInfo"] = input => {
      const result = save(input);
      committed = true;
      if (outcome === "lost response")
        throw new Error("Save response was lost after commit");
      return result;
    };
    const calls = visit(
      <>
        <CheckIn />
        <AnotherFlightPass />
      </>,
      replies
    );
    fireEvent.change(screen.getByLabelText("Booking Reference (PNR)"), {
      target: { value: "ABC123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("BCBP-11-42-before");
    await screen.findByText("BCBP-12-42-before");
    expect(
      screen.getAllByRole("button", { name: "Print Boarding Pass" })
    ).toHaveLength(2);
    expect(screen.getByTestId("another-flight-pass")).toHaveTextContent(
      "token-11-43-before"
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review or edit travel documents" })
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save Information" })
      ).toBeEnabled()
    );
    fireEvent.change(screen.getByLabelText(/^Document Number/), {
      target: { value: "UPDATED123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Information" }));
    await waitFor(() => {
      for (const flightId of [42, 43]) {
        expect(
          calls.filter(
            call =>
              call.method === "seatMap.getBoardingPass" &&
              call.input.passengerId === 11 &&
              call.input.flightId === flightId
          )
        ).toHaveLength(2);
      }
    });
    expect(screen.queryByText("BCBP-11-42-before")).not.toBeInTheDocument();
    expect(
      screen
        .queryByRole("img", {
          name: "Boarding Pass",
          hidden: true,
        })
        ?.getAttribute("src")
    ).not.toContain(btoa("token-11-42-before"));
    expect(
      screen.getAllByRole("button", { name: "Print Boarding Pass" })
    ).toHaveLength(1);
    expect(screen.getByTestId("another-flight-pass")).toHaveTextContent(
      "checking"
    );
    expect(
      calls.filter(
        call =>
          call.method === "seatMap.getBoardingPass" &&
          call.input.passengerId === 12
      )
    ).toHaveLength(1);
    await act(async () => {
      releasePassReads();
      await pendingPassRead;
    });
    await screen.findByText("Synthetic source unavailable");
    expect(screen.queryByText("BCBP-11-42-before")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Print Boarding Pass" })
    ).toHaveLength(1);
    expect(screen.getByText("BCBP-12-42-before")).toBeInTheDocument();
    expect(screen.getByTestId("another-flight-pass")).toHaveTextContent(
      "unavailable"
    );
  }
);

function adminReplies(overrides: Record<string, Reply> = {}) {
  return {
    "apis.getSubmissions": () => [],
    "apis.getSubmissionCapability": () => ({
      available: false,
      reason: "authority_transport_unavailable",
    }),
    "apis.getFlightStatus": ({ flightId }: { flightId: number }) => ({
      flightId,
      flightNumber: `AIS${flightId}`,
      departureTime: new Date("2090-06-15T10:00:00Z"),
      totalPassengers: 2,
      passengerStatuses: [],
      summary: {
        incomplete: 0,
        complete: 0,
        validated: 2,
        submitted: 0,
        rejected: 0,
      },
      readyForSubmission: true,
    }),
    ...overrides,
  };
}
const messageContent =
  "UNH+001+PAXLST:D:02B:UN'\r\nNAD+FL+++FIRST?+TRAVELER'\r\n<literal>نور</literal>\r\nUNT+3+001'";
const draft = (flightId: number, format: string) => ({
  flightId,
  flightNumber: `AIS${flightId}`,
  format,
  messageContent,
  passengerCount: 2,
  validatedCount: 2,
  missingCount: 0,
  generatedAt: "2026-11-03T12:00:00Z",
});

it.each(["paxlst", "pnrgov"])(
  "reviews and downloads exact %s output without enabling authority submission",
  async format => {
    const calls = visit(
      <APISManagement />,
      adminReplies({
        "apis.generateMessage": input => draft(input.flightId, input.format),
      })
    );
    fireEvent.change(screen.getByPlaceholderText("Enter Flight ID"), {
      target: { value: "42" },
    });
    const submit = await screen.findByRole("button", {
      name: "Submit to Authorities",
    });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(calls.some(call => call.method === "apis.submitToAuthorities")).toBe(
      false
    );
    expect(screen.queryByText("Ready for submission")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name:
          format === "paxlst"
            ? "Generate PAXLST draft"
            : "Generate PNR/GOV draft",
      })
    );
    const preview = await screen.findByLabelText(
      "Generated APIS draft content"
    );
    expect(preview.textContent).toBe(messageContent);
    expect(preview.querySelector("literal")).toBeNull();
    expect(
      screen.getByText(
        "Not transmitted. This draft has no authority acknowledgment."
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Download exact draft" })
    );
    expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
      messageContent,
      `apis-draft-${format}-42.txt`,
      "text/plain;charset=utf-8"
    );
    fireEvent.change(screen.getByPlaceholderText("Enter Flight ID"), {
      target: { value: "43" },
    });
    expect(
      screen.queryByRole("button", { name: "Download exact draft" })
    ).not.toBeInTheDocument();
  }
);

it("keeps submission disabled when capability readiness fails even with validated data", async () => {
  visit(
    <APISManagement />,
    adminReplies({
      "apis.getSubmissionCapability": () => {
        throw new Error("offline");
      },
    })
  );
  fireEvent.change(screen.getByPlaceholderText("Enter Flight ID"), {
    target: { value: "42" },
  });
  await screen.findByText(
    "Authority connection readiness could not be verified. Submission remains disabled."
  );
  expect(
    screen.getByRole("button", { name: "Submit to Authorities" })
  ).toBeDisabled();
});

it("does not expose a late draft under a different selected flight", async () => {
  let resolveDraft!: (value: ReturnType<typeof draft>) => void;
  const pending = new Promise<ReturnType<typeof draft>>(resolve => {
    resolveDraft = resolve;
  });
  const calls = visit(
    <APISManagement />,
    adminReplies({ "apis.generateMessage": () => pending })
  );
  fireEvent.change(screen.getByPlaceholderText("Enter Flight ID"), {
    target: { value: "42" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Generate PAXLST draft" })
  );
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "apis.generateMessage",
      input: { flightId: 42, format: "paxlst" },
    })
  );
  fireEvent.change(screen.getByPlaceholderText("Enter Flight ID"), {
    target: { value: "43" },
  });
  await act(async () => {
    resolveDraft(draft(42, "paxlst"));
    await pending;
  });
  await screen.findByRole("button", { name: "Generate PAXLST draft" });
  expect(
    screen.queryByLabelText("Generated APIS draft content")
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Download exact draft" })
  ).not.toBeInTheDocument();
});
