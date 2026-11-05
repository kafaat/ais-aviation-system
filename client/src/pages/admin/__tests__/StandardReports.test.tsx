import {
  act,
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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StandardReportDefinition,
  StandardReportResult,
} from "@shared/standard-reports";
import StandardReports from "../StandardReports";
import { trpc } from "@/lib/trpc";
import { downloadFile } from "@/lib/downloadFile";
import { deferred } from "@/test/trpc-fixture";

const auth = vi.hoisted(() => ({
  user: {
    id: 11,
    role: "airline_admin",
    tenantId: 101,
    email: "owner@example.test",
  } as {
    id: number;
    role: string;
    tenantId: number | null;
    email: string | null;
  } | null,
  language: "en",
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: false }),
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/lib/downloadFile", () => ({ downloadFile: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: auth.language } }),
}));

const definitions: StandardReportDefinition[] = [
  {
    id: 55,
    title: "Payments",
    category: "finance",
    availability: "partial",
    description: "Every recorded payment in the period.",
    limitations: ["Sales-office attribution is not recorded."],
    filters: ["startDate", "endDate", "status"],
  },
  {
    id: 22,
    title: "Flight ID",
    category: "operations",
    availability: "available",
    description: "The flight with the requested database ID.",
    limitations: [],
    filters: ["flightId"],
  },
  {
    id: 10,
    title: "Expired Tickets",
    category: "finance",
    availability: "blocked",
    description: "Expired ticket documents.",
    limitations: ["Actual ticket expiration is not recorded."],
    filters: [],
  },
];
function result(input: {
  reportId: number;
  filters: Record<string, unknown>;
}): StandardReportResult {
  return {
    reportId: input.reportId,
    title:
      definitions.find(report => report.id === input.reportId)?.title ??
      "Report",
    generatedAt: "2026-11-04T08:00:00.000Z",
    filters: input.filters,
    total: 1,
    columns: [
      { key: "paymentId", label: "Payment ID", type: "number" },
      { key: "bookingReference", label: "Booking reference", type: "text" },
      { key: "amountMinor", label: "Amount (minor units)", type: "number" },
      { key: "officeId", label: "Sales office (unknown)", type: "number" },
    ],
    rows: [
      {
        paymentId: 7,
        bookingReference: "<script>alert('x')</script>",
        amountMinor: 0,
        officeId: null,
      },
    ],
    notes: ["Source amounts are minor units; unknown is not zero."],
  };
}
type Handler = (input: any) => unknown | Promise<unknown>;
let handlers: Record<string, Handler>;
let calls: Array<{ path: string; input: any }>;
let templates: any[];
let runs: any[];
beforeEach(() => {
  auth.user = {
    id: 11,
    role: "airline_admin",
    tenantId: 101,
    email: "owner@example.test",
  };
  auth.language = "en";
  calls = [];
  templates = [];
  runs = [];
  handlers = {
    "standardReports.catalog": () => definitions,
    "standardReports.templates": () => templates,
    "standardReports.runs": ({ beforeId }) =>
      runs
        .filter(run => beforeId === undefined || run.id < beforeId)
        .slice(0, 100),
    "standardReports.run": input => result(input),
    "standardReports.export": input => ({
      filename: `report-55.${input.format}`,
      contentType:
        input.format === "csv"
          ? "text/csv"
          : input.format === "html"
            ? "text/html"
            : "application/xml",
      content: `safe-${input.format}`,
      checksum: "a".repeat(64),
      recordCount: 1,
    }),
    "standardReports.saveTemplate": ({ id, template }) => {
      const saved = {
        ...template,
        id: id ?? 30,
        createdAt: new Date("2026-11-04T08:00:00Z"),
        updatedAt: new Date("2026-11-04T08:00:00Z"),
        nextRunAt:
          template.cadence !== "manual" && template.enabled
            ? new Date("2026-11-05T08:00:00Z")
            : null,
      };
      templates = [...templates.filter(item => item.id !== saved.id), saved];
      return saved;
    },
    "standardReports.setTemplateEnabled": ({ id, enabled }) => {
      const saved = templates.find(item => item.id === id);
      Object.assign(saved, {
        enabled,
        nextRunAt: enabled ? new Date("2026-11-05T08:00:00Z") : null,
      });
      return saved;
    },
    "standardReports.deleteTemplate": ({ id }) => {
      templates = templates.filter(item => item.id !== id);
      return { deleted: true };
    },
    "standardReports.runTemplate": ({ id }) => {
      const saved = templates.find(item => item.id === id);
      const run = makeRun({
        templateId: id,
        reportId: saved.reportId,
        name: saved.name,
      });
      runs = [run, ...runs];
      return run;
    },
    "standardReports.downloadRun": () => ({
      filename: "saved.csv",
      contentType: "text/csv",
      content: "saved output",
      checksum: "b".repeat(64),
      recordCount: 1,
    }),
  };
});

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 80,
    templateId: 30,
    reportId: 55,
    name: "Morning payments",
    format: "csv",
    status: "ready",
    recordCount: 1,
    checksum: "b".repeat(64),
    deliveryStatus: "none",
    emailReceiptId: null,
    emailAcceptedAt: null,
    createdAt: new Date("2026-11-04T08:00:00Z"),
    completedAt: new Date("2026-11-04T08:00:01Z"),
    errorMessage: null,
    ...overrides,
  };
}

/** The component uses real tRPC/React Query lifecycles; only the HTTP endpoint is substituted. */
function visit() {
  const route = memoryLocation({
    path: "/admin/standard-reports",
    record: true,
  });
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "https://local.test/api/trpc",
        transformer: superjson,
        fetch: async (url, options) => {
          const address = new URL(String(url));
          const methods = address.pathname.split("/").pop()!.split(",");
          const input = JSON.parse(
            typeof options?.body === "string"
              ? options.body
              : (address.searchParams.get("input") ?? "{}")
          );
          const response = await Promise.all(
            methods.map(async (path, index) => {
              const value = input[index]
                ? superjson.deserialize(input[index])
                : undefined;
              calls.push({ path, input: value });
              try {
                if (!handlers[path])
                  throw new Error("Unconfigured test endpoint");
                return {
                  result: {
                    data: superjson.serialize(await handlers[path](value)),
                  },
                };
              } catch (error) {
                return {
                  error: {
                    json: {
                      message:
                        error instanceof Error
                          ? error.message
                          : "Service unavailable",
                      code: -32603,
                      data: {
                        code: "INTERNAL_SERVER_ERROR",
                        httpStatus: 500,
                        path,
                      },
                    },
                  },
                };
              }
            })
          );
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const workspace = () => (
    <trpc.Provider client={client} queryClient={cache}>
      <QueryClientProvider client={cache}>
        <Router hook={route.hook}>
          <StandardReports />
        </Router>
      </QueryClientProvider>
    </trpc.Provider>
  );
  const view = render(workspace());
  return Object.assign(route, {
    refreshAuth: () => view.rerender(workspace()),
  });
}

async function preview() {
  fireEvent.click(await screen.findByTestId("standard-run-report"));
  return screen.findByTestId("standard-report-table");
}

async function save(name = "Morning payments") {
  await preview();
  fireEvent.change(screen.getByLabelText("Report name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save report" }));
  return screen.findByTestId("standard-template-30");
}

describe("standard report workspace", () => {
  it.each([
    { id: 1, role: "user", tenantId: 101, email: null },
    { id: 1, role: "support", tenantId: 101, email: null },
    { id: 1, role: "ops", tenantId: null, email: null },
  ])(
    "does not request reports for unauthorized or unscoped $role",
    async user => {
      auth.user = user;
      const route = visit();
      await waitFor(() => expect(route.history.at(-1)).toBe("/"));
      expect(calls).toEqual([]);
    }
  );

  it("shows partial-source limitations, preserves zero and unknown, and makes blocked reports non-executable", async () => {
    visit();
    expect(
      await screen.findByText("Sales-office attribution is not recorded.")
    ).toBeVisible();
    const table = await preview();
    expect(within(table).getByRole("cell", { name: "0" })).toBeVisible();
    expect(
      within(table).getByRole("cell", { name: "Not recorded" })
    ).toBeVisible();
    expect(
      within(table).getByText("<script>alert('x')</script>")
    ).toBeVisible();
    expect(table.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByTestId("standard-report-option-10"));
    expect(
      screen.getByText("Actual ticket expiration is not recorded.")
    ).toBeVisible();
    expect(screen.queryByTestId("standard-run-report")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("standard-report-table")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download CSV" })
    ).not.toBeInTheDocument();
    expect(
      calls.filter(call => call.path === "standardReports.run")
    ).toHaveLength(1);
  });

  it("does not render a failed catalog or history as an empty success", async () => {
    handlers["standardReports.catalog"] = () => {
      throw new Error("temporarily unavailable");
    };
    visit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "catalog could not be loaded"
    );
    expect(
      screen.queryByText("No reports are available for this workspace.")
    ).not.toBeInTheDocument();
    handlers["standardReports.catalog"] = () => definitions;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("standard-report-option-55");
    handlers["standardReports.runs"] = () => {
      throw new Error("history unavailable");
    };
    fireEvent.click(screen.getByRole("button", { name: "Run history" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Run history could not be loaded"
    );
    expect(screen.queryByText("No report runs yet.")).not.toBeInTheDocument();
  });

  it("discards an in-flight preview and download after filters change", async () => {
    let completeRead: ((value: StandardReportResult) => void) | undefined;
    handlers["standardReports.run"] = () =>
      new Promise(resolve => {
        completeRead = resolve;
      });
    visit();
    fireEvent.click(await screen.findByTestId("standard-run-report"));
    await waitFor(() => expect(completeRead).toBeDefined());
    fireEvent.change(screen.getByLabelText("Start date (UTC)"), {
      target: { value: "2026-10-01" },
    });
    await act(async () =>
      completeRead?.(result({ reportId: 55, filters: {} }))
    );
    await waitFor(() =>
      expect(screen.getByTestId("standard-run-report")).toBeEnabled()
    );
    expect(
      screen.queryByTestId("standard-report-table")
    ).not.toBeInTheDocument();
    handlers["standardReports.run"] = input => result(input);
    await preview();
    expect(
      calls.filter(call => call.path === "standardReports.run").at(-1)?.input
        .filters.startDate
    ).toBe("2026-10-01");
    let completeExport: ((value: unknown) => void) | undefined;
    handlers["standardReports.export"] = () =>
      new Promise(resolve => {
        completeExport = resolve;
      });
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(completeExport).toBeDefined());
    fireEvent.change(screen.getByLabelText("End date (UTC)"), {
      target: { value: "2026-10-31" },
    });
    await act(async () =>
      completeExport?.({
        filename: "old.csv",
        content: "old data",
        contentType: "text/csv",
        checksum: "a".repeat(64),
        recordCount: 1,
      })
    );
    expect(downloadFile).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("standard-report-table")
    ).not.toBeInTheDocument();
  });

  it("exports only chosen columns in their displayed order through all formats", async () => {
    visit();
    await preview();
    fireEvent.click(screen.getByLabelText("Select column Payment ID"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move column up: Amount (minor units)",
      })
    );
    expect(
      within(screen.getByTestId("standard-report-table"))
        .getAllByRole("columnheader")
        .map(element => element.textContent)
    ).toEqual([
      "Amount (minor units)",
      "Booking reference",
      "Sales office (unknown)",
    ]);
    for (const format of ["csv", "html", "xml"]) {
      fireEvent.click(
        screen.getByRole("button", { name: `Download ${format.toUpperCase()}` })
      );
      await waitFor(() =>
        expect(
          calls.filter(call => call.path === "standardReports.export").at(-1)
            ?.input
        ).toMatchObject({
          format,
          columns: ["amountMinor", "bookingReference", "officeId"],
        })
      );
      await waitFor(() =>
        expect(downloadFile).toHaveBeenCalledWith(
          `safe-${format}`,
          `report-55.${format}`,
          format === "csv"
            ? "text/csv"
            : format === "html"
              ? "text/html"
              : "application/xml"
        )
      );
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Clear column selection" })
    );
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save report" })).toBeDisabled();
  });

  it("pages a complete 105-row result without dropping the later rows", async () => {
    handlers["standardReports.run"] = input => ({
      ...result(input),
      total: 105,
      rows: Array.from({ length: 105 }, (_, index) => ({
        paymentId: index + 1,
        bookingReference: `REF${String(index + 1).padStart(3, "0")}`,
        amountMinor: index,
        officeId: null,
      })),
    });
    visit();
    const table = await preview();
    expect(within(table).getByText("REF100")).toBeVisible();
    expect(within(table).queryByText("REF101")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(within(table).getByText("REF105")).toBeVisible();
    expect(within(table).queryByText("REF100")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(
      calls.filter(call => call.path === "standardReports.run")
    ).toHaveLength(1);
  });

  it("saves, edits and schedules the same template, preserving columns and owner-only email defaults", async () => {
    visit();
    await save();
    const initial = calls.find(
      call => call.path === "standardReports.saveTemplate"
    )?.input;
    expect(initial.template).toMatchObject({
      name: "Morning payments",
      cadence: "manual",
      emailToOwner: false,
      lookbackDays: null,
      columns: ["paymentId", "bookingReference", "amountMinor", "officeId"],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Morning payments" })
    );
    expect(screen.getByLabelText("Report name")).toHaveValue(
      "Morning payments"
    );
    expect(
      screen.getByRole("button", { name: "Update report" })
    ).toBeDisabled();
    await preview();
    fireEvent.change(screen.getByLabelText("Saved format"), {
      target: { value: "xml" },
    });
    fireEvent.change(screen.getByLabelText("Run frequency"), {
      target: { value: "daily" },
    });
    fireEvent.change(screen.getByLabelText("Run time (UTC)"), {
      target: { value: "09:30" },
    });
    fireEvent.click(screen.getByLabelText("Use previous complete UTC days"));
    fireEvent.change(screen.getByLabelText("Number of previous days"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update report" }));
    await screen.findByTestId("standard-template-30");
    expect(
      calls.filter(call => call.path === "standardReports.saveTemplate").at(-1)
        ?.input
    ).toMatchObject({
      id: 30,
      template: {
        format: "xml",
        cadence: "daily",
        hourUtc: 9,
        minuteUtc: 30,
        lookbackDays: 7,
        emailToOwner: false,
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Pause schedule Morning payments" })
    );
    await screen.findByRole("button", {
      name: "Enable schedule Morning payments",
    });
    expect(
      calls
        .filter(call => call.path === "standardReports.setTemplateEnabled")
        .at(-1)?.input
    ).toEqual({ id: 30, enabled: false });
    expect(
      calls.filter(call => call.path === "standardReports.saveTemplate")
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Morning payments" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText("No saved reports yet.")).toBeVisible();
  });

  it("shows a failed manual run without a download and reuses an uncertain request ID", async () => {
    visit();
    await save();
    let attempt = 0;
    handlers["standardReports.runTemplate"] = () => {
      attempt += 1;
      if (attempt === 1) throw new Error("connection interrupted");
      const run = makeRun({
        status: "failed",
        checksum: null,
        recordCount: 0,
        errorMessage: "Required source unavailable.",
      });
      runs = [run];
      return run;
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Run now Morning payments" })
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "could not be confirmed"
      )
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run now Morning payments" })
    );
    const runCard = await screen.findByTestId("standard-run-80");
    expect(within(runCard).getByText("Failed", { exact: true })).toBeVisible();
    expect(
      within(runCard).queryByRole("button", {
        name: "Download Morning payments",
      })
    ).not.toBeInTheDocument();
    const requests = calls.filter(
      call => call.path === "standardReports.runTemplate"
    );
    expect(requests).toHaveLength(2);
    expect(requests[0].input.requestId).toBe(requests[1].input.requestId);
  });

  it("exposes a ready saved output and provider receipt without claiming recipient delivery", async () => {
    runs = [
      makeRun({
        deliveryStatus: "accepted",
        emailReceiptId: "provider-receipt-7",
        emailAcceptedAt: new Date("2026-11-04T08:00:02Z"),
      }),
    ];
    visit();
    await screen.findByTestId("standard-report-option-55");
    fireEvent.click(screen.getByRole("button", { name: "Run history" }));
    const runCard = await screen.findByTestId("standard-run-80");
    expect(within(runCard).getByText("Provider accepted")).toBeVisible();
    expect(within(runCard).queryByText(/delivered/i)).not.toBeInTheDocument();
    fireEvent.click(within(runCard).getByText("Output details"));
    expect(within(runCard).getByText("provider-receipt-7")).toBeVisible();
    expect(within(runCard).getByText("b".repeat(64))).toBeVisible();
    fireEvent.click(
      within(runCard).getByRole("button", { name: "Download Morning payments" })
    );
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
        "saved output",
        "saved.csv",
        "text/csv"
      )
    );
  });

  it.each([
    { change: "tenant reassignment", role: "airline_admin", tenantId: 202 },
    { change: "role demotion", role: "ops", tenantId: 101 },
  ])(
    "never displays cached report metadata after $change on the same account",
    async next => {
      const route = visit();
      const privateName = "Previous scope confidential payments";
      await save(privateName);
      runs = [makeRun({ name: privateName })];
      fireEvent.click(screen.getByRole("button", { name: "Run history" }));
      await screen.findByTestId("standard-run-80");
      fireEvent.click(screen.getByRole("button", { name: "Report catalog" }));
      await screen.findByTestId("standard-report-option-55");

      let completeCatalog: ((value: unknown) => void) | undefined;
      let completeTemplates: ((value: unknown) => void) | undefined;
      let completeRuns: ((value: unknown) => void) | undefined;
      handlers["standardReports.catalog"] = () =>
        new Promise(resolve => {
          completeCatalog = resolve;
        });
      handlers["standardReports.templates"] = () =>
        new Promise(resolve => {
          completeTemplates = resolve;
        });
      handlers["standardReports.runs"] = () =>
        new Promise(resolve => {
          completeRuns = resolve;
        });
      auth.user = {
        id: 11,
        email: "owner@example.test",
        role: next.role,
        tenantId: next.tenantId,
      };
      route.refreshAuth();
      // Check the first render, while the new scope's HTTP response is still pending.
      expect(
        screen.queryByTestId("standard-report-option-55")
      ).not.toBeInTheDocument();
      expect(screen.queryByText(privateName)).not.toBeInTheDocument();
      await waitFor(() => expect(completeCatalog).toBeDefined());
      await act(async () => completeCatalog?.([definitions[1]]));
      await screen.findByTestId("standard-report-option-22");

      fireEvent.click(screen.getByRole("button", { name: "Saved reports" }));
      expect(screen.queryByText(privateName)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("standard-template-30")
      ).not.toBeInTheDocument();
      await waitFor(() => expect(completeTemplates).toBeDefined());
      await act(async () => completeTemplates?.([]));
      expect(await screen.findByText("No saved reports yet.")).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Run history" }));
      expect(screen.queryByText(privateName)).not.toBeInTheDocument();
      expect(screen.queryByTestId("standard-run-80")).not.toBeInTheDocument();
      await waitFor(() => expect(completeRuns).toBeDefined());
      await act(async () => completeRuns?.([]));
      expect(await screen.findByText("No report runs yet.")).toBeVisible();
    }
  );

  it("cannot reuse or repopulate a new scope from an older in-flight template request", async () => {
    let finishOldScope: ((value: unknown) => void) | undefined;
    handlers["standardReports.templates"] = () =>
      new Promise(resolve => {
        finishOldScope = resolve;
      });
    const route = visit();
    await screen.findByTestId("standard-report-option-55");
    fireEvent.click(screen.getByRole("button", { name: "Saved reports" }));
    await waitFor(() => expect(finishOldScope).toBeDefined());
    handlers["standardReports.catalog"] = () => [definitions[1]];
    handlers["standardReports.templates"] = () => [];
    auth.user = {
      id: 11,
      email: "owner@example.test",
      role: "ops",
      tenantId: 202,
    };
    route.refreshAuth();
    await screen.findByTestId("standard-report-option-22");
    fireEvent.click(screen.getByRole("button", { name: "Saved reports" }));
    await waitFor(() =>
      expect(
        calls.filter(call => call.path === "standardReports.templates")
      ).toHaveLength(2)
    );
    expect(await screen.findByText("No saved reports yet.")).toBeVisible();
    await act(async () =>
      finishOldScope?.([
        {
          id: 30,
          reportId: 55,
          name: "Late confidential prior-scope template",
          filters: {},
          columns: ["paymentId"],
          format: "csv",
          cadence: "manual",
          hourUtc: 8,
          minuteUtc: 0,
          lookbackDays: null,
          emailToOwner: false,
          enabled: true,
          nextRunAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
    );
    expect(
      screen.queryByText("Late confidential prior-scope template")
    ).not.toBeInTheDocument();
    expect(screen.getByText("No saved reports yet.")).toBeVisible();
  });

  it("renders Arabic controls in RTL while preserving reference report titles", async () => {
    auth.language = "ar";
    visit();
    expect(
      await screen.findByRole("heading", { name: "التقارير القياسية" })
    ).toBeVisible();
    expect(await screen.findByLabelText("البحث عن تقرير")).toBeVisible();
    expect(screen.getByTestId("standard-report-option-55")).toHaveTextContent(
      "Payments"
    );
    expect(
      screen.getByTestId("standard-report-definition").closest('[dir="rtl"]')
    ).not.toBeNull();
  });

  it("recovers failed previews and exports without showing output or a success before a retry", async () => {
    handlers["standardReports.run"] = () => {
      throw new Error("Source temporarily unavailable");
    };
    visit();
    fireEvent.click(await screen.findByTestId("standard-run-report"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report could not be generated."
    );
    expect(
      screen.queryByTestId("standard-report-table")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download CSV" })
    ).not.toBeInTheDocument();
    handlers["standardReports.run"] = input => result(input);
    await preview();
    const original = handlers["standardReports.export"];
    handlers["standardReports.export"] = () => {
      throw new Error("Export temporarily unavailable");
    };
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report could not be downloaded."
    );
    expect(downloadFile).not.toHaveBeenCalled();
    expect(screen.queryByText("Report downloaded.")).not.toBeInTheDocument();
    handlers["standardReports.export"] = original;
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await screen.findByText("Report downloaded.");
    expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
      "safe-csv",
      "report-55.csv",
      "text/csv"
    );
    expect(
      calls.filter(call => call.path === "standardReports.run")
    ).toHaveLength(2);
    expect(
      calls.filter(call => call.path === "standardReports.export")
    ).toHaveLength(2);
  });

  it.each([
    {
      field: "name",
      value: "   ",
      expected: "Enter a name for the saved report.",
    },
    { field: "time", value: "", expected: "Enter a valid UTC run time." },
    { field: "time", value: "24:00", expected: "Enter a valid UTC run time." },
    {
      field: "days",
      value: "0",
      expected: "Choose between 1 and 366 complete UTC days.",
    },
    {
      field: "days",
      value: "367",
      expected: "Choose between 1 and 366 complete UTC days.",
    },
    {
      field: "days",
      value: "1.5",
      expected: "Choose between 1 and 366 complete UTC days.",
    },
    {
      field: "days",
      value: "",
      expected: "Choose between 1 and 366 complete UTC days.",
    },
    {
      field: "days",
      value: "not-a-number",
      expected: "Choose between 1 and 366 complete UTC days.",
    },
  ])(
    "rejects invalid saved configuration $field=$value before sending a mutation",
    async ({ field, value, expected }) => {
      visit();
      await preview();
      fireEvent.change(screen.getByLabelText("Report name"), {
        target: { value: field === "name" ? value : "Validated report" },
      });
      if (field === "time") {
        fireEvent.change(screen.getByLabelText("Run frequency"), {
          target: { value: "daily" },
        });
        fireEvent.change(screen.getByLabelText("Run time (UTC)"), {
          target: { value },
        });
        // The native time input rejects 24:00 and exposes an empty value.
        if (value === "24:00")
          expect(screen.getByLabelText("Run time (UTC)")).toHaveValue("");
      }
      if (field === "days") {
        fireEvent.click(
          screen.getByLabelText("Use previous complete UTC days")
        );
        fireEvent.change(screen.getByLabelText("Number of previous days"), {
          target: { value },
        });
        // Invalid numeric text is likewise normalized by the real input.
        if (value === "not-a-number")
          expect(screen.getByLabelText("Number of previous days")).toHaveValue(
            null
          );
      }
      // Exercise the submit handler even if native constraint validation is
      // bypassed; the application must reject before it constructs a mutation.
      fireEvent.submit(screen.getByTestId("standard-template-editor"));
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(
        calls.filter(call => call.path === "standardReports.saveTemplate")
      ).toEqual([]);
      expect(screen.getByRole("button", { name: "Save report" })).toBeEnabled();
    }
  );

  it("preserves the saved-report draft after a failed mutation and allows retry", async () => {
    const original = handlers["standardReports.saveTemplate"];
    handlers["standardReports.saveTemplate"] = () => {
      throw new Error("Temporary storage outage");
    };
    visit();
    await preview();
    fireEvent.change(screen.getByLabelText("Report name"), {
      target: { value: "Preserved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report configuration could not be saved."
    );
    expect(screen.getByLabelText("Report name")).toHaveValue("Preserved draft");
    expect(
      screen.queryByText("Report configuration saved.")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("standard-template-30")
    ).not.toBeInTheDocument();
    handlers["standardReports.saveTemplate"] = original;
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    expect(await screen.findByTestId("standard-template-30")).toHaveTextContent(
      "Preserved draft"
    );
    expect(
      calls.filter(call => call.path === "standardReports.saveTemplate")
    ).toHaveLength(2);
  });

  it("retains a scheduled template when pause or deletion fails and retries the same identity", async () => {
    visit();
    await preview();
    fireEvent.change(screen.getByLabelText("Report name"), {
      target: { value: "Morning payments" },
    });
    fireEvent.change(screen.getByLabelText("Run frequency"), {
      target: { value: "daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    await screen.findByTestId("standard-template-30");
    const pause = handlers["standardReports.setTemplateEnabled"];
    handlers["standardReports.setTemplateEnabled"] = () => {
      throw new Error("Temporary schedule outage");
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Pause schedule Morning payments" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report configuration could not be saved."
    );
    expect(
      screen.getByRole("button", { name: "Pause schedule Morning payments" })
    ).toBeEnabled();
    expect(templates[0].enabled).toBe(true);
    handlers["standardReports.setTemplateEnabled"] = pause;
    fireEvent.click(
      screen.getByRole("button", { name: "Pause schedule Morning payments" })
    );
    await screen.findByRole("button", {
      name: "Enable schedule Morning payments",
    });
    const remove = handlers["standardReports.deleteTemplate"];
    handlers["standardReports.deleteTemplate"] = () => ({ deleted: false });
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Morning payments" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The saved report could not be deleted."
    );
    expect(screen.getByTestId("standard-template-30")).toBeVisible();
    expect(screen.queryByText("Saved report deleted.")).not.toBeInTheDocument();
    handlers["standardReports.deleteTemplate"] = remove;
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await screen.findByText("No saved reports yet.");
    expect(
      calls
        .filter(call => call.path === "standardReports.deleteTemplate")
        .map(call => call.input)
    ).toEqual([{ id: 30 }, { id: 30 }]);
  });

  it("retains a generating request identity until a ready result, then allocates a new run", async () => {
    visit();
    await save();
    let attempt = 0;
    handlers["standardReports.runTemplate"] = () => {
      attempt += 1;
      const run = makeRun(
        attempt === 1
          ? {
              status: "generating",
              checksum: null,
              recordCount: 0,
              completedAt: null,
            }
          : { id: attempt === 2 ? 80 : 81 }
      );
      runs = [run];
      return run;
    };
    fireEvent.click(
      screen.getByRole("button", { name: "Run now Morning payments" })
    );
    let card = await screen.findByTestId("standard-run-80");
    expect(
      within(card).queryByRole("button", { name: "Download Morning payments" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Report generation is in progress. Refresh run history to check its result."
      )
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Saved reports" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Run now Morning payments" })
    );
    await screen.findByText("The report output is ready in run history.");
    card = await screen.findByTestId("standard-run-80");
    expect(
      await within(card).findByRole("button", {
        name: "Download Morning payments",
      })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Saved reports" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Run now Morning payments" })
    );
    await screen.findByTestId("standard-run-81");
    const requests = calls.filter(
      call => call.path === "standardReports.runTemplate"
    );
    expect(requests).toHaveLength(3);
    expect(requests[0].input.requestId).toBe(requests[1].input.requestId);
    expect(requests[2].input.requestId).not.toBe(requests[1].input.requestId);
  });

  it("keeps a failed saved download retryable without claiming success", async () => {
    runs = [makeRun()];
    visit();
    await screen.findByTestId("standard-report-option-55");
    fireEvent.click(screen.getByRole("button", { name: "Run history" }));
    const button = await screen.findByRole("button", {
      name: "Download Morning payments",
    });
    const original = handlers["standardReports.downloadRun"];
    handlers["standardReports.downloadRun"] = () => {
      throw new Error("Output temporarily unavailable");
    };
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The report could not be downloaded.");
    expect(alert).toHaveTextContent("Output temporarily unavailable");
    expect(downloadFile).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
    handlers["standardReports.downloadRun"] = original;
    fireEvent.click(button);
    await screen.findByText("Report downloaded.");
    expect(downloadFile).toHaveBeenCalledExactlyOnceWith(
      "saved output",
      "saved.csv",
      "text/csv"
    );
    expect(
      calls
        .filter(call => call.path === "standardReports.downloadRun")
        .map(call => call.input)
    ).toEqual([{ id: 80 }, { id: 80 }]);
  });

  it("does not navigate or populate another account from a late save response", async () => {
    const response = deferred<unknown>();
    handlers["standardReports.saveTemplate"] = () => response.promise;
    const route = visit();
    await preview();
    fireEvent.change(screen.getByLabelText("Report name"), {
      target: { value: "Previous account private report" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report" }));
    await waitFor(() =>
      expect(
        calls.filter(call => call.path === "standardReports.saveTemplate")
      ).toHaveLength(1)
    );
    const saved = calls.find(
      call => call.path === "standardReports.saveTemplate"
    )!.input.template;
    auth.user = {
      id: 12,
      role: "finance",
      tenantId: 202,
      email: "other@example.test",
    };
    route.refreshAuth();
    await screen.findByTestId("standard-report-option-55");
    await act(async () =>
      response.resolve({
        ...saved,
        id: 30,
        createdAt: new Date(),
        updatedAt: new Date(),
        nextRunAt: null,
      })
    );
    expect(
      screen.queryByText("Report configuration saved.")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("standard-run-report")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Saved reports" }));
    expect(await screen.findByText("No saved reports yet.")).toBeVisible();
    expect(
      screen.queryByText("Previous account private report")
    ).not.toBeInTheDocument();
  });

  it.each(["filters", "account"])(
    "discards a saved download that finishes after %s change",
    async change => {
      runs = [makeRun()];
      const response = deferred<unknown>();
      handlers["standardReports.downloadRun"] = () => response.promise;
      const route = visit();
      await screen.findByTestId("standard-report-option-55");
      fireEvent.click(screen.getByRole("button", { name: "Run history" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Download Morning payments" })
      );
      await waitFor(() =>
        expect(
          calls.filter(call => call.path === "standardReports.downloadRun")
        ).toHaveLength(1)
      );
      if (change === "account") {
        auth.user = {
          id: 12,
          role: "finance",
          tenantId: 202,
          email: "other@example.test",
        };
        runs = [];
        route.refreshAuth();
        await screen.findByTestId("standard-report-option-55");
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Report catalog" }));
        fireEvent.change(await screen.findByLabelText("Start date (UTC)"), {
          target: { value: "2026-10-01" },
        });
      }
      await act(async () =>
        response.resolve({
          filename: "old.csv",
          contentType: "text/csv",
          content: "private prior context",
          checksum: "b".repeat(64),
          recordCount: 1,
        })
      );
      expect(downloadFile).not.toHaveBeenCalled();
      expect(screen.queryByText("Report downloaded.")).not.toBeInTheDocument();
    }
  );

  it.each(["filters", "report"])(
    "discards a saved download error that arrives after %s change",
    async change => {
      runs = [makeRun()];
      const response = deferred<unknown>();
      handlers["standardReports.downloadRun"] = () => response.promise;
      visit();
      await screen.findByTestId("standard-report-option-55");
      fireEvent.click(screen.getByRole("button", { name: "Run history" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Download Morning payments" })
      );
      await waitFor(() =>
        expect(
          calls.filter(call => call.path === "standardReports.downloadRun")
        ).toHaveLength(1)
      );
      fireEvent.click(screen.getByRole("button", { name: "Report catalog" }));
      if (change === "filters") {
        const startDate = await screen.findByLabelText("Start date (UTC)");
        fireEvent.change(startDate, { target: { value: "2026-10-01" } });
        expect(startDate).toHaveValue("2026-10-01");
      } else {
        fireEvent.click(screen.getByTestId("standard-report-option-22"));
        expect(
          screen.getByTestId("standard-report-definition")
        ).toHaveTextContent("Flight ID");
      }
      fireEvent.click(screen.getByRole("button", { name: "Run history" }));
      const button = await screen.findByRole("button", {
        name: "Download Morning payments",
      });
      await waitFor(() => expect(button).toBeDisabled());
      await act(async () =>
        response.reject(new Error("Previous report download failed"))
      );
      // Wait for the mutation to settle before asserting absence of its error.
      await waitFor(() => expect(button).toBeEnabled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(downloadFile).not.toHaveBeenCalled();
      expect(screen.queryByText("Report downloaded.")).not.toBeInTheDocument();
    }
  );
});
